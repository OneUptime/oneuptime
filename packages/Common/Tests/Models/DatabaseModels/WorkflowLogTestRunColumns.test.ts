import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddWorkflowLogTestRun1801400000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1801400000000-AddWorkflowLogTestRun";
import { AddWorkflowLogStartedByForeignKey1801450000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1801450000000-AddWorkflowLogStartedByForeignKey";
import OnlineDdl from "../../../Server/Infrastructure/Postgres/OnlineDdl";
import User from "../../../Models/DatabaseModels/User";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import UserAttribution from "../../../Types/Database/UserAttribution";
import Permission from "../../../Types/Permission";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A run's record says whether it was a test run, and who started it.
 *
 * "Why do I have to enable a workflow in order to test run it?" A person may
 * now run a workflow from its Builder while it is turned off: a test run.
 * The run's WorkflowLog row says so (isTestRun), and who started it by hand
 * (startedByUserId, and the startedByUser relation the run views read the
 * name through). OneUptime writes both when it queues the run, and no
 * request writes either. Two migrations add them: the columns, and then the
 * foreign key, online, so the table every run writes is never blocked.
 */

type QueryRunnerAndStatements = {
  runner: QueryRunner;
  statements: Array<string>;
};

function makeQueryRunner(): QueryRunnerAndStatements {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements: statements,
  };
}

function registeredNames(): Array<string> {
  return (
    SchemaMigrations as unknown as Array<new () => MigrationInterface>
  ).map((type: new () => MigrationInterface): string => {
    return type.name;
  });
}

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

const FOREIGN_KEY: string = `ALTER TABLE "WorkflowLog" ADD CONSTRAINT "FK_5ec2cc2bd5a20e34795ebf4bb89" FOREIGN KEY ("startedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

const READERS_OF_A_RUN: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.WorkflowAdmin,
  Permission.WorkflowMember,
  Permission.WorkflowViewer,
  Permission.ReadWorkflowLog,
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkflowLog.isTestRun", () => {
  const log: WorkflowLog = new WorkflowLog();

  test("is a switch that is off unless OneUptime turns it on", () => {
    const metadata: TableColumnMetadata =
      log.getTableColumnMetadata("isTestRun");

    expect(metadata.type).toBe(TableColumnType.Boolean);
    expect(metadata.isDefaultValueColumn).toBe(true);
    expect(metadata.defaultValue).toBe(false);
  });

  test("is read by whoever may read the run, and written by no request", () => {
    const access: ColumnAccessControl | null =
      log.getColumnAccessControlFor("isTestRun");

    expect(access?.create).toEqual([]);
    expect(access?.update).toEqual([]);
    expect(access?.read).toEqual(READERS_OF_A_RUN);
  });
});

describe("WorkflowLog.startedByUserId and startedByUser", () => {
  const log: WorkflowLog = new WorkflowLog();

  test("name a user, the relation over the id", () => {
    expect(log.getTableColumnMetadata("startedByUserId").type).toBe(
      TableColumnType.ObjectID,
    );

    const relation: TableColumnMetadata =
      log.getTableColumnMetadata("startedByUser");

    expect(relation.type).toBe(TableColumnType.Entity);
    expect(relation.modelType).toBe(User);
    expect(relation.manyToOneRelationColumn).toBe("startedByUserId");
  });

  test("are OneUptime's to decide: computed, closed to every write, under both names", () => {
    for (const column of ["startedByUserId", "startedByUser"]) {
      const access: ColumnAccessControl | null =
        log.getColumnAccessControlFor(column);

      expect({ column, create: access?.create }).toEqual({
        column,
        create: [],
      });
      expect({ column, update: access?.update }).toEqual({
        column,
        update: [],
      });
      expect({ column, computed: log.getTableColumnMetadata(column).computed })
        .toEqual({ column, computed: true });
      expect({ column, read: access?.read }).toEqual({
        column,
        read: READERS_OF_A_RUN,
      });
    }

    expect(UserAttribution.getColumns(log)).toEqual(
      expect.arrayContaining(["startedByUser", "startedByUserId"]),
    );
  });
});

describe("the migration that adds the columns", () => {
  const migration: AddWorkflowLogTestRun1801400000000 =
    new AddWorkflowLogTestRun1801400000000();

  test("adds the switch, off for every run before it, and the person, empty", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "WorkflowLog" ADD "isTestRun" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "WorkflowLog" ADD "startedByUserId" uuid`,
    ]);
  });

  test("takes both away on the way down, in the other order", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "WorkflowLog" DROP COLUMN "startedByUserId"`,
      `ALTER TABLE "WorkflowLog" DROP COLUMN "isTestRun"`,
    ]);
  });

  test("builds no index and no foreign key: those block the table", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.up(runner);

    for (const statement of statements) {
      expect(statement).not.toMatch(/CREATE INDEX|FOREIGN KEY/);
    }
  });
});

describe("the migration that adds the foreign key", () => {
  const migration: AddWorkflowLogStartedByForeignKey1801450000000 =
    new AddWorkflowLogStartedByForeignKey1801450000000();

  test("adds it online, as generated: a person who is deleted leaves the run naming nobody", async () => {
    const addForeignKey: SpyInstance<typeof OnlineDdl.addForeignKey> = jest
      .spyOn(OnlineDdl, "addForeignKey")
      .mockResolvedValue(undefined);
    const { runner, statements } = makeQueryRunner();

    await migration.up(runner);

    expect(addForeignKey).toHaveBeenCalledTimes(1);
    expect(addForeignKey.mock.calls[0]![0]).toBe(runner);
    expect(addForeignKey.mock.calls[0]![1]).toBe(FOREIGN_KEY);
    expect(statements).toEqual([]);
  });

  test("runs outside a transaction, as the online validation needs", () => {
    expect(
      (migration as unknown as { transaction?: boolean }).transaction,
    ).toBe(false);
  });

  test("drops it on the way down", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "WorkflowLog" DROP CONSTRAINT "FK_5ec2cc2bd5a20e34795ebf4bb89"`,
    ]);
  });
});

describe("both migrations", () => {
  test("are named after their classes and timestamps", () => {
    expect(new AddWorkflowLogTestRun1801400000000().name).toBe(
      "AddWorkflowLogTestRun1801400000000",
    );
    expect(new AddWorkflowLogStartedByForeignKey1801450000000().name).toBe(
      "AddWorkflowLogStartedByForeignKey1801450000000",
    );
  });

  test("are registered, the columns before their foreign key, after every migration before them", () => {
    const names: Array<string> = registeredNames();
    const columns: number = names.indexOf("AddWorkflowLogTestRun1801400000000");
    const foreignKey: number = names.indexOf(
      "AddWorkflowLogStartedByForeignKey1801450000000",
    );

    expect(columns).toBeGreaterThan(-1);
    expect(foreignKey).toBe(columns + 1);

    const timestampOf: (name: string) => number = (name: string): number => {
      return Number(name.match(CLASS_TIMESTAMP)?.[1] || 0);
    };

    for (const name of names.slice(0, columns)) {
      expect({ name, before: timestampOf(name) < 1801400000000 }).toEqual({
        name,
        before: true,
      });
    }
  });
});
