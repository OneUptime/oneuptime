import {
  MONITOR_GROUP_AND_RUNNER_OWNER_TABLES,
  MarkMonitorGroupAndRunnerOwnersAsTold1809185100000,
  getMarkMonitorGroupAndRunnerOwnersToldStatement,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185100000-MarkMonitorGroupAndRunnerOwnersAsTold";
import { DropIncidentTemplateOwnerNotifiedFlag1809185110000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185110000-DropIncidentTemplateOwnerNotifiedFlag";
import { RESOURCE_OWNER_TABLES } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185010000-MarkOwnersAddedBeforeNotificationsAsTold";
import { DATA_OWNER_TABLES } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184930000-MarkDataOwnersAddedBeforeNotificationsAsTold";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import IncidentTemplateOwnerTeam from "../../../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * THE OWNER ROWS OF MONITOR GROUPS, RUNNERS AND INCIDENT TEMPLATES WAIT FOR
 * NOTHING ANY MORE (#9758).
 *
 * An owner added on a monitor group's, a Runner's or an incident template's
 * Owners page was written not told yet (isOwnerNotified false), and no job
 * read those rows, so the tables collected rows waiting for nothing:
 *
 *   - monitor groups' and Runners' new owners are told now, by jobs of their
 *     own (Workers MonitorGroupOwners, RunnerOwners), and
 *     MarkMonitorGroupAndRunnerOwnersAsTold marks every row already waiting
 *     told first, so their first run sends no news that is months old;
 *   - nobody is told they were made an owner of a template - its owners
 *     hear of each incident declared from it - so
 *     DropIncidentTemplateOwnerNotifiedFlag takes the column, and its index,
 *     off the template's owner tables, as a scheduled maintenance
 *     template's never had one.
 *
 * Registered once each, in that order. Fake QueryRunner here; the Schema
 * Drift job applies them to a migrated database.
 */

const MARK_NAME: string = "MarkMonitorGroupAndRunnerOwnersAsTold1809185100000";
const DROP_NAME: string = "DropIncidentTemplateOwnerNotifiedFlag1809185110000";

const MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: true,
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner);

  return statements;
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as unknown as Array<{ name: string }>).map(
    (registered: { name: string }): string => {
      return registered.name;
    },
  );
}

function timesRegistered(name: string): number {
  return registeredNames().filter((registered: string): boolean => {
    return registered === name;
  }).length;
}

// A model of the server, by its table: "RunnerOwnerUser".
function modelOf(table: string): BaseModel {
  const modelType: (new () => BaseModel) | undefined = (
    AllModelTypes as unknown as Array<new () => BaseModel>
  ).find((candidate: new () => BaseModel): boolean => {
    return new candidate().tableName === table;
  });

  if (!modelType) {
    throw new Error(`No model has the table ${table}.`);
  }

  return new modelType();
}

describe("MarkMonitorGroupAndRunnerOwnersAsTold1809185100000", () => {
  test("is registered once, under the name its class carries, after every earlier owner backfill", () => {
    expect(new MarkMonitorGroupAndRunnerOwnersAsTold1809185100000().name).toBe(
      MARK_NAME,
    );
    expect(SchemaMigrations).toContain(
      MarkMonitorGroupAndRunnerOwnersAsTold1809185100000,
    );
    expect(timesRegistered(MARK_NAME)).toBe(1);

    const names: Array<string> = registeredNames();

    for (const earlier of [
      "MarkDataOwnersAddedBeforeNotificationsAsTold1809184930000",
      "MarkOwnersAddedBeforeNotificationsAsTold1809185010000",
    ]) {
      expect(names.indexOf(MARK_NAME)).toBeGreaterThan(names.indexOf(earlier));
    }
  });

  test("marks the owner tables of exactly a monitor group and a Runner, a user's and a team's", () => {
    expect([...MONITOR_GROUP_AND_RUNNER_OWNER_TABLES].sort()).toEqual([
      "MonitorGroupOwnerTeam",
      "MonitorGroupOwnerUser",
      "RunnerOwnerTeam",
      "RunnerOwnerUser",
    ]);

    // Never another record's rows, which were marked with their own jobs.
    for (const table of [...RESOURCE_OWNER_TABLES, ...DATA_OWNER_TABLES]) {
      expect(MONITOR_GROUP_AND_RUNNER_OWNER_TABLES).not.toContain(table);
    }
  });

  test("marks the not-told rows of each table, one statement each", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new MarkMonitorGroupAndRunnerOwnersAsTold1809185100000().up(
          runner,
        );
      }),
    ).toEqual(
      MONITOR_GROUP_AND_RUNNER_OWNER_TABLES.map((table: string): string => {
        return `UPDATE "${table}" SET "isOwnerNotified" = true WHERE "isOwnerNotified" = false`;
      }),
    );
  });

  test("sets the one column and picks only the rows still waiting", () => {
    const statement: string =
      getMarkMonitorGroupAndRunnerOwnersToldStatement("RunnerOwnerUser");
    const assignments: string = statement.slice(
      statement.indexOf(" SET "),
      statement.indexOf(" WHERE "),
    );

    expect(assignments.split("=")).toHaveLength(2);
    expect(assignments).toContain(`"isOwnerNotified" = true`);
    expect(statement.slice(statement.indexOf(" WHERE "))).toBe(
      ` WHERE "isOwnerNotified" = false`,
    );
    expect(statement).not.toContain(" OR ");
  });

  test("the column it reads and writes is each owner table's own boolean, which nobody may write", () => {
    for (const table of MONITOR_GROUP_AND_RUNNER_OWNER_TABLES) {
      const model: BaseModel = modelOf(table);

      expect({
        table: model.tableName,
        type: model.getTableColumnMetadata("isOwnerNotified")?.type,
        create: model.getColumnAccessControlFor("isOwnerNotified")?.create,
        update: model.getColumnAccessControlFor("isOwnerNotified")?.update,
      }).toEqual({
        table: table,
        type: TableColumnType.Boolean,
        create: [],
        update: [],
      });
    }
  });

  test("down() changes nothing", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new MarkMonitorGroupAndRunnerOwnersAsTold1809185100000().down(
          runner,
        );
      }),
    ).toEqual([]);
  });
});

describe("DropIncidentTemplateOwnerNotifiedFlag1809185110000", () => {
  test("is registered once, under the name its class carries, after the backfill", () => {
    expect(new DropIncidentTemplateOwnerNotifiedFlag1809185110000().name).toBe(
      DROP_NAME,
    );
    expect(timesRegistered(DROP_NAME)).toBe(1);

    const names: Array<string> = registeredNames();

    expect(names.indexOf(DROP_NAME)).toBeGreaterThan(names.indexOf(MARK_NAME));
  });

  test("drops each index, then the column it is on, of both template owner tables", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new DropIncidentTemplateOwnerNotifiedFlag1809185110000().up(
          runner,
        );
      }),
    ).toEqual([
      `DROP INDEX "public"."IDX_2cb2fc022da183b99cf06f0043"`,
      `DROP INDEX "public"."IDX_38583ea60d2df4a525098065f3"`,
      `ALTER TABLE "IncidentTemplateOwnerTeam" DROP COLUMN "isOwnerNotified"`,
      `ALTER TABLE "IncidentTemplateOwnerUser" DROP COLUMN "isOwnerNotified"`,
    ]);
  });

  test("the indexes it drops are the ones made on that column of those tables", () => {
    const initial: string = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "1717605043663-InitialMigration.ts"),
      "utf8",
    );

    expect(initial).toContain(
      `CREATE INDEX "IDX_2cb2fc022da183b99cf06f0043" ON "IncidentTemplateOwnerTeam" ("isOwnerNotified") `,
    );
    expect(initial).toContain(
      `CREATE INDEX "IDX_38583ea60d2df4a525098065f3" ON "IncidentTemplateOwnerUser" ("isOwnerNotified") `,
    );
  });

  test("down() puts back the column, not told, and its index", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new DropIncidentTemplateOwnerNotifiedFlag1809185110000().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "IncidentTemplateOwnerUser" ADD "isOwnerNotified" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "IncidentTemplateOwnerTeam" ADD "isOwnerNotified" boolean NOT NULL DEFAULT false`,
      `CREATE INDEX "IDX_38583ea60d2df4a525098065f3" ON "IncidentTemplateOwnerUser" ("isOwnerNotified") `,
      `CREATE INDEX "IDX_2cb2fc022da183b99cf06f0043" ON "IncidentTemplateOwnerTeam" ("isOwnerNotified") `,
    ]);
  });

  test("the template owner models have no told-yet column, and no index on one", () => {
    for (const model of [
      new IncidentTemplateOwnerUser(),
      new IncidentTemplateOwnerTeam(),
    ]) {
      expect({
        table: model.tableName,
        hasFlag: model.isTableColumn("isOwnerNotified"),
      }).toEqual({ table: model.tableName, hasFlag: false });
    }

    const columns: Array<ColumnMetadataArgs> =
      getMetadataArgsStorage().columns.filter(
        (column: ColumnMetadataArgs): boolean => {
          return (
            (column.target === IncidentTemplateOwnerUser ||
              column.target === IncidentTemplateOwnerTeam) &&
            column.propertyName === "isOwnerNotified"
          );
        },
      );

    expect(columns).toHaveLength(0);

    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return (
            (index.target === IncidentTemplateOwnerUser ||
              index.target === IncidentTemplateOwnerTeam) &&
            JSON.stringify(index.columns) === JSON.stringify(["isOwnerNotified"])
          );
        },
      );

    expect(indexes).toHaveLength(0);
  });
});
