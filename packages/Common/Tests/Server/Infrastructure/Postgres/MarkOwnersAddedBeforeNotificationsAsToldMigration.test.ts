import {
  RESOURCE_OWNER_TABLES,
  getMarkOwnersToldStatement,
  MarkOwnersAddedBeforeNotificationsAsTold1809185010000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185010000-MarkOwnersAddedBeforeNotificationsAsTold";
import { AddServiceOwnerIsOwnerNotified1809185000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185000000-AddServiceOwnerIsOwnerNotified";
import { AddServiceOwnerIsOwnerNotifiedIndexes1809185020000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185020000-AddServiceOwnerIsOwnerNotifiedIndexes";
import { DATA_OWNER_TABLES } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184930000-MarkDataOwnersAddedBeforeNotificationsAsTold";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import ServiceOwnerTeam from "../../../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "../../../../Models/DatabaseModels/ServiceOwnerUser";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * THE OWNERS ALREADY WAITING ARE MARKED TOLD, AND A SERVICE'S OWNER ROWS
 * SAY WHETHER THEY WERE (#9700).
 *
 * Owner rules of 23 kinds of record - services, hosts, clusters, dashboards,
 * on-call policies and the rest - wrote each owner they added not told yet,
 * and so did every owner added on an Owners page, but no job read them. The
 * jobs that tell them come in the same release (Workers ResourceOwnersAdded),
 * and these migrations, run before any worker of the release:
 *
 *   - AddServiceOwnerIsOwnerNotified gives a service's owner rows the
 *     column every other record's have: a boolean, not null, false - what
 *     the model says;
 *   - MarkOwnersAddedBeforeNotificationsAsTold marks every row of the 46
 *     owner tables the jobs read told, and only rows not told yet - never
 *     another column, nor another record's owner rows - so nobody is sent
 *     news that is months old;
 *   - AddServiceOwnerIsOwnerNotifiedIndexes builds the new column's
 *     indexes online, outside a transaction, under the names the model
 *     generates.
 *
 * Registered once each, in that order. Fake QueryRunner here; the Schema
 * Drift job applies them to a migrated database.
 */

const MIGRATION_NAME: string =
  "MarkOwnersAddedBeforeNotificationsAsTold1809185010000";

// The 23 records whose owner rules had no owner-added job (#9700).
const RECORDS: ReadonlyArray<string> = [
  "CephCluster",
  "CloudResource",
  "Dashboard",
  "DatabaseServer",
  "DockerHost",
  "DockerSwarmCluster",
  "Host",
  "IncomingCallPolicy",
  "IoTFleet",
  "KubernetesCluster",
  "MessageQueue",
  "OnCallDutyPolicy",
  "OnCallDutyPolicySchedule",
  "OpenStackCloud",
  "PodmanHost",
  "ProxmoxCluster",
  "RumApplication",
  "Runbook",
  "ServerlessFunction",
  "Service",
  "StorageArray",
  "VMwareVCenter",
  "Workflow",
];

const INDEX_STATEMENTS: Array<string> = [
  `CREATE INDEX "IDX_a74b37f8142004dcdd4584c4fe" ON "ServiceOwnerTeam" ("isOwnerNotified") `,
  `CREATE INDEX "IDX_bafacc1ebabdeea91791639fb0" ON "ServiceOwnerUser" ("isOwnerNotified") `,
];

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: false,
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

// A model of the server, by its table: "HostOwnerUser".
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddServiceOwnerIsOwnerNotified1809185000000", () => {
  test("adds the column to both service owner tables, a boolean that starts not told", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddServiceOwnerIsOwnerNotified1809185000000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "ServiceOwnerTeam" ADD "isOwnerNotified" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "ServiceOwnerUser" ADD "isOwnerNotified" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("is the column the models declare: a boolean, false by default, that nobody may write", () => {
    for (const model of [new ServiceOwnerUser(), new ServiceOwnerTeam()]) {
      expect({
        table: model.tableName,
        type: model.getTableColumnMetadata("isOwnerNotified").type,
        defaultValue:
          model.getTableColumnMetadata("isOwnerNotified").defaultValue,
        create: model.getColumnAccessControlFor("isOwnerNotified")?.create,
        update: model.getColumnAccessControlFor("isOwnerNotified")?.update,
      }).toEqual({
        table: model.tableName,
        type: TableColumnType.Boolean,
        defaultValue: false,
        create: [],
        update: [],
      });
    }

    const columns: Array<ColumnMetadataArgs> =
      getMetadataArgsStorage().columns.filter(
        (column: ColumnMetadataArgs): boolean => {
          return (
            (column.target === ServiceOwnerUser ||
              column.target === ServiceOwnerTeam) &&
            column.propertyName === "isOwnerNotified"
          );
        },
      );

    expect(columns).toHaveLength(2);

    for (const column of columns) {
      expect(column.options.nullable).toBe(false);
      expect(column.options.default).toBe(false);
    }
  });

  test("the people who can read a service's owners can read it", () => {
    for (const [model, readOwners] of [
      [new ServiceOwnerUser(), Permission.ReadServiceOwnerUser],
      [new ServiceOwnerTeam(), Permission.ReadServiceOwnerTeam],
    ] as Array<[BaseModel, Permission]>) {
      expect(model.getColumnAccessControlFor("isOwnerNotified")?.read).toEqual(
        expect.arrayContaining([Permission.ProjectMember, readOwners]),
      );
    }
  });

  test("down drops the columns up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddServiceOwnerIsOwnerNotified1809185000000().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "ServiceOwnerUser" DROP COLUMN "isOwnerNotified"`,
      `ALTER TABLE "ServiceOwnerTeam" DROP COLUMN "isOwnerNotified"`,
    ]);
  });
});

describe("MarkOwnersAddedBeforeNotificationsAsTold1809185010000", () => {
  test("is registered once, under the name its class carries, after the service owner column and before its indexes", () => {
    expect(new MarkOwnersAddedBeforeNotificationsAsTold1809185010000().name).toBe(
      MIGRATION_NAME,
    );
    expect(SchemaMigrations).toContain(
      MarkOwnersAddedBeforeNotificationsAsTold1809185010000,
    );

    const names: Array<string> = registeredNames();

    for (const name of [
      MIGRATION_NAME,
      "AddServiceOwnerIsOwnerNotified1809185000000",
      "AddServiceOwnerIsOwnerNotifiedIndexes1809185020000",
    ]) {
      expect({
        name,
        times: names.filter((registered: string): boolean => {
          return registered === name;
        }).length,
      }).toEqual({ name, times: 1 });
    }

    expect(names.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      names.indexOf("AddServiceOwnerIsOwnerNotified1809185000000"),
    );
    expect(names.indexOf(MIGRATION_NAME)).toBeLessThan(
      names.indexOf("AddServiceOwnerIsOwnerNotifiedIndexes1809185020000"),
    );
    // After the data owners' own backfill, which it never repeats.
    expect(names.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      names.indexOf("MarkDataOwnersAddedBeforeNotificationsAsTold1809184930000"),
    );
  });

  test("marks the owner tables of exactly the 23 records, both a user's and a team's", () => {
    expect([...RESOURCE_OWNER_TABLES].sort()).toEqual(
      RECORDS.flatMap((record: string): Array<string> => {
        return [`${record}OwnerTeam`, `${record}OwnerUser`];
      }).sort(),
    );
    expect(new Set(RESOURCE_OWNER_TABLES).size).toBe(46);

    // Never a data owner table again: those were marked with their jobs (#9681).
    for (const table of DATA_OWNER_TABLES) {
      expect(RESOURCE_OWNER_TABLES).not.toContain(table);
    }
  });

  test("marks the not-notified rows of each table, one statement each", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new MarkOwnersAddedBeforeNotificationsAsTold1809185010000().up(
          runner,
        );
      }),
    ).toEqual(
      RESOURCE_OWNER_TABLES.map((table: string): string => {
        return `UPDATE "${table}" SET "isOwnerNotified" = true WHERE "isOwnerNotified" = false`;
      }),
    );
  });

  test("sets the one column and picks only the rows still waiting", () => {
    const statement: string = getMarkOwnersToldStatement("HostOwnerUser");
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

  test("the column it reads and writes is each owner table's own boolean: whether its owners were told", () => {
    for (const table of RESOURCE_OWNER_TABLES) {
      const model: BaseModel = modelOf(table);

      expect({
        table: model.tableName,
        type: model.getTableColumnMetadata("isOwnerNotified")?.type,
      }).toEqual({ table: table, type: TableColumnType.Boolean });
    }
  });

  test("down() changes nothing", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new MarkOwnersAddedBeforeNotificationsAsTold1809185010000().down(
          runner,
        );
      }),
    ).toEqual([]);
  });
});

describe("AddServiceOwnerIsOwnerNotifiedIndexes1809185020000", () => {
  test("builds each index online, outside a transaction", async () => {
    const migration: AddServiceOwnerIsOwnerNotifiedIndexes1809185020000 =
      new AddServiceOwnerIsOwnerNotifiedIndexes1809185020000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual(
      INDEX_STATEMENTS.map((statement: string): string => {
        return `online: ${statement}`;
      }),
    );
  });

  test("OnlineDdl reads each build as one it can run concurrently, on its table's column", () => {
    for (const [statement, table, name] of [
      [INDEX_STATEMENTS[0]!, "ServiceOwnerTeam", "IDX_a74b37f8142004dcdd4584c4fe"],
      [INDEX_STATEMENTS[1]!, "ServiceOwnerUser", "IDX_bafacc1ebabdeea91791639fb0"],
    ]) {
      const index: OnlineIndex = OnlineDdl.parseCreateIndex(statement!);

      expect(index.name).toBe(name);
      expect(index.quotedTable).toBe(`"${table}"`);
      expect(index.build).toBe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ON "${table}" ("isOwnerNotified")`,
      );
    }
  });

  test("the models declare an index on the column of each table", () => {
    for (const target of [ServiceOwnerUser, ServiceOwnerTeam]) {
      const indexes: Array<IndexMetadataArgs> =
        getMetadataArgsStorage().indices.filter(
          (index: IndexMetadataArgs): boolean => {
            return (
              index.target === target &&
              JSON.stringify(index.columns) === JSON.stringify(["isOwnerNotified"])
            );
          },
        );

      expect(indexes).toHaveLength(1);
    }
  });

  test("down drops both, online", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddServiceOwnerIsOwnerNotifiedIndexes1809185020000().down(
          runner,
        );
      }),
    ).toEqual([
      `online: DROP INDEX "public"."IDX_bafacc1ebabdeea91791639fb0"`,
      `online: DROP INDEX "public"."IDX_a74b37f8142004dcdd4584c4fe"`,
    ]);
  });
});
