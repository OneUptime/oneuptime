import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSecurityHuntRunHistory1808992040000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1808992040000-AddSecurityHuntRunHistory";
import Project from "../../../Models/DatabaseModels/Project";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import SecurityHuntRun from "../../../Models/DatabaseModels/SecurityHuntRun";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A HUNT'S RUN HISTORY (SecurityHuntRun), AND THE STARTER IT WAS ADDED FROM.
 *
 * Each scheduled run of a hunt keeps a row: the window it searched, how
 * many events it found there, or why it could not be made. OneUptime alone
 * writes one, as a run is recorded, and no request may make, change or
 * delete it; whoever may read the hunt reads its runs. A hunt deleted takes
 * its runs with it, as a project does.
 *
 * A hunt added from the Hunt Library keeps the starter's id
 * (SecurityHunt.libraryHuntId): sent once, by whoever may add a hunt, and
 * never changed after.
 */

function makeQueryRunner(): { runner: QueryRunner; statements: Array<string> } {
  const statements: Array<string> = [];

  return {
    runner: {
      query: (sql: string): Promise<undefined> => {
        statements.push(sql);
        return Promise.resolve(undefined);
      },
    } as unknown as QueryRunner,
    statements,
  };
}

// A statement on the hunts' own table, not on their runs'.
const HUNT_TABLE: RegExp = /"SecurityHunt"(?!Run)/;

const RUN_COLUMNS: Array<string> = [
  "project",
  "projectId",
  "securityHunt",
  "securityHuntId",
  "windowStartAt",
  "windowEndAt",
  "eventCount",
  "error",
];

describe("a hunt's run", () => {
  const run: SecurityHuntRun = new SecurityHuntRun();
  const hunt: SecurityHunt = new SecurityHunt();

  test("is read by whoever may read its hunt, through its own API", () => {
    expect(run.getReadPermissions()).toEqual(hunt.getReadPermissions());
    expect(run.getCrudApiPath()?.toString()).toBe("/security-hunt-run");
    expect(run.getTenantColumn()).toBe("projectId");
    expect(run.tableName).toBe("SecurityHuntRun");
    expect(run.singularName).toBe("Hunt Run");
    expect(run.pluralName).toBe("Hunt Runs");
  });

  test("is OneUptime's to write: no request makes, changes or deletes one", () => {
    expect(run.getCreatePermissions()).toEqual([]);
    expect(run.getUpdatePermissions()).toEqual([]);
    expect(run.getDeletePermissions()).toEqual([]);

    for (const column of RUN_COLUMNS) {
      const access: ColumnAccessControl | null =
        run.getColumnAccessControlFor(column);

      expect({
        column,
        create: access?.create,
        update: access?.update,
      }).toEqual({ column, create: [], update: [] });
      expect({ column, read: access?.read }).toEqual({
        column,
        read: hunt.getReadPermissions(),
      });
    }
  });

  test("names its hunt and its project, and says what it searched and found", () => {
    const huntRelation: TableColumnMetadata =
      run.getTableColumnMetadata("securityHunt");

    expect(huntRelation.type).toBe(TableColumnType.Entity);
    expect(huntRelation.modelType).toBe(SecurityHunt);
    expect(huntRelation.manyToOneRelationColumn).toBe("securityHuntId");
    expect(run.getTableColumnMetadata("project").modelType).toBe(Project);

    expect(run.getTableColumnMetadata("windowStartAt").type).toBe(
      TableColumnType.Date,
    );
    expect(run.getTableColumnMetadata("windowEndAt").type).toBe(
      TableColumnType.Date,
    );
    expect(run.getTableColumnMetadata("eventCount").type).toBe(
      TableColumnType.Number,
    );
    // A run that could not be made found no count: it says why instead.
    expect(run.getTableColumnMetadata("eventCount").required).toBe(false);
    expect(run.getTableColumnMetadata("error").required).toBe(false);
    expect(run.getTableColumnMetadata("windowStartAt").required).toBe(true);
    expect(run.getTableColumnMetadata("windowEndAt").required).toBe(true);
  });
});

describe("the starter a hunt was added from", () => {
  const hunt: SecurityHunt = new SecurityHunt();

  test("is sent once, by whoever may add a hunt, and never changed after", () => {
    const access: ColumnAccessControl | null =
      hunt.getColumnAccessControlFor("libraryHuntId");

    expect(access?.create).toEqual(hunt.getCreatePermissions());
    expect(access?.update).toEqual([]);
    expect(access?.read).toEqual(hunt.getReadPermissions());
    expect(hunt.getTableColumnMetadata("libraryHuntId").type).toBe(
      TableColumnType.ShortText,
    );
    expect(hunt.getTableColumnMetadata("libraryHuntId").required).toBe(false);
  });
});

describe("the migration", () => {
  const migration: AddSecurityHuntRunHistory1808992040000 =
    new AddSecurityHuntRunHistory1808992040000();

  test("makes the runs table, read by hunt and newest first, cleared by age, deleted with its hunt or project", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.up(runner);

    expect(statements[0]).toMatch(/^CREATE TABLE "SecurityHuntRun" /);
    expect(statements).toContain(
      `CREATE INDEX "IDX_22819188a47a765f3590ff1788" ON "SecurityHuntRun" ("securityHuntId", "createdAt") `,
    );
    expect(statements).toContain(
      `CREATE INDEX "IDX_c5070015832151e71b8435e795" ON "SecurityHuntRun" ("createdAt") `,
    );
    expect(
      statements.filter((statement: string): boolean => {
        // A foreign key that deletes the run with what it names.
        return (
          statement.includes("FOREIGN KEY") &&
          statement.includes("ON DELETE CASCADE")
        );
      }),
    ).toHaveLength(2);
  });

  test("gives an existing hunt only a nullable column: no index, no foreign key, nothing that locks or scans it", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.up(runner);

    const onHunts: Array<string> = statements.filter(
      (statement: string): boolean => {
        return HUNT_TABLE.test(statement.split(" REFERENCES ")[0]!);
      },
    );

    expect(onHunts).toEqual([
      `ALTER TABLE "SecurityHunt" ADD "libraryHuntId" character varying(100)`,
    ]);
  });

  test("takes it all away on the way down, the table last", async () => {
    const { runner, statements } = makeQueryRunner();

    await migration.down(runner);

    expect(statements).toContain(
      `ALTER TABLE "SecurityHunt" DROP COLUMN "libraryHuntId"`,
    );
    expect(statements[statements.length - 1]).toBe(
      `DROP TABLE "SecurityHuntRun"`,
    );
  });

  test("is named after its class, and registered after every migration before it", () => {
    expect(migration.name).toBe("AddSecurityHuntRunHistory1808992040000");

    const names: Array<string> = (
      SchemaMigrations as unknown as Array<new () => MigrationInterface>
    ).map((type: new () => MigrationInterface): string => {
      return type.name;
    });
    const index: number = names.indexOf(
      "AddSecurityHuntRunHistory1808992040000",
    );

    expect(index).toBeGreaterThan(-1);

    for (const name of names.slice(0, index)) {
      const timestamp: number = Number(name.match(/(\d{13})$/)?.[1] || 0);

      expect({ name, before: timestamp < 1808992040000 }).toEqual({
        name,
        before: true,
      });
    }
  });
});
