import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180100000-AddIsSnmpReachableToNetworkDeviceStatusIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE STATUS INDEX NAMES THE WALK'S VERDICT (issue #8091).
 *
 * The Network Overview's "SNMP failing" list - reachable devices whose last
 * walk failed - and the device list's SNMP facet narrowed only by
 * ("projectId", "isArchived", "isReachable"), so they read the heap row of
 * every reachable device to find the few whose walk is failing.
 * "isSnmpReachable" is now that index's fourth column. Every poll's verdict
 * writes it, but HOT is blocked only by a changed value, and it changes
 * only when a walk starts or stops failing (ProbeTablesHotUpdatesPostgres
 * runs both against Postgres).
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>". The names are TypeORM's own,
 * so the drift check finds nothing to change.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const STATUS_INDEX: string = namingStrategy.indexName("NetworkDevice", [
  "projectId",
  "isArchived",
  "isReachable",
  "isSnmpReachable",
]);

const OLD_STATUS_INDEX: string = namingStrategy.indexName("NetworkDevice", [
  "projectId",
  "isArchived",
  "isReachable",
]);

const BUILD: string = `CREATE INDEX "${STATUS_INDEX}" ON "NetworkDevice" ("projectId", "isArchived", "isReachable", "isSnmpReachable") `;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
  options: { isTransactionActive: boolean },
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
    isTransactionActive: options.isTransactionActive,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000", () => {
  test("the indexes are named as TypeORM names them", () => {
    expect(STATUS_INDEX).toBe("IDX_cdebf2a6205db74d9b8e80316c");
    expect(OLD_STATUS_INDEX).toBe("IDX_2eb97a5af768174a679a32b011");
  });

  test("builds the new Status index before dropping the old one, both online, outside a transaction", async () => {
    const migration: AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000 =
      new AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: false },
      ),
    ).toEqual([
      `online: ${BUILD}`,
      `online: DROP INDEX "public"."${OLD_STATUS_INDEX}"`,
    ]);
  });

  test("OnlineDdl reads the build as one it can run concurrently", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(BUILD);

    expect(parsed.name).toBe(STATUS_INDEX);
    expect(parsed.quotedTable).toBe(`"NetworkDevice"`);
    expect(parsed.build).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${STATUS_INDEX}" ON "NetworkDevice" ("projectId", "isArchived", "isReachable", "isSnmpReachable")`,
    );
  });

  test("down() puts the old index back, columns in their order, before the new one goes", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      `CREATE INDEX "${OLD_STATUS_INDEX}" ON "NetworkDevice" ("projectId", "isArchived", "isReachable") `,
      `online: DROP INDEX "public"."${STATUS_INDEX}"`,
    ]);
  });

  test("is registered once, after the migration before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate ===
          AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000
        );
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf(
        "AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000",
      ),
    ).toBeGreaterThan(
      names.indexOf(
        "DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000",
      ),
    );
    expect(
      new AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000().name,
    ).toBe("AddIsSnmpReachableToNetworkDeviceStatusIndex1809180100000");
  });
});

describe("the NetworkDevice model declares the same Status index", () => {
  function declared(): Array<Array<string>> {
    return getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs): boolean => {
        return index.target === NetworkDevice && !index.where;
      })
      .map((index: IndexMetadataArgs): Array<string> => {
        if (!Array.isArray(index.columns)) {
          throw new Error(
            "A NetworkDevice index declares its columns as a function; list them.",
          );
        }
        return index.columns as Array<string>;
      });
  }

  test("led by the Status columns, then the walk's verdict, and nothing after it", () => {
    const status: Array<Array<string>> = declared().filter(
      (columns: Array<string>): boolean => {
        return (
          columns.slice(0, 3).join(",") === "projectId,isArchived,isReachable"
        );
      },
    );

    expect(status).toEqual([
      ["projectId", "isArchived", "isReachable", "isSnmpReachable"],
    ]);
  });

  /*
   * lastSnmpSeenAt moves on every successful walk: indexed, every such
   * poll's verdict would be a non-HOT update into every index on the table.
   */
  test("does not index when the walk last succeeded", () => {
    expect(
      declared().filter((columns: Array<string>): boolean => {
        return columns.includes("lastSnmpSeenAt");
      }),
    ).toEqual([]);
  });
});
