import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809151100000-DropNetworkDeviceLastSeenAtAndProjectIdIndexes";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A REACHABLE POLL'S VERDICT CAN BE A HOT UPDATE (issue #7921).
 *
 * Every poll that reaches a device moves its "lastSeenAt"
 * (NetworkDeviceService.writePollVerdict). An update that changes a column
 * any index names - in its key or in a partial index's predicate - cannot be
 * HOT: it writes an entry into every index on the table and leaves a dead
 * one in each for vacuum. The Status index carried "lastSeenAt" as a fourth
 * column, so every reachable poll's verdict was such an update, into all
 * fourteen indexes. Now the Status index is ("projectId", "isArchived",
 * "isReachable"), and the bare ("projectId") - the leading column of five
 * composites - is gone too.
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
]);

const STATUS_WITH_LAST_SEEN_INDEX: string = namingStrategy.indexName(
  "NetworkDevice",
  ["projectId", "isArchived", "isReachable", "lastSeenAt"],
);

const PROJECT_ID_INDEX: string = namingStrategy.indexName("NetworkDevice", [
  "projectId",
]);

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

describe("DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000", () => {
  test("the indexes are named as TypeORM names them", () => {
    expect(STATUS_INDEX).toBe("IDX_2eb97a5af768174a679a32b011");
    expect(STATUS_WITH_LAST_SEEN_INDEX).toBe("IDX_87566f1ca6cc63ee3afd3aeaff");
    expect(PROJECT_ID_INDEX).toBe("IDX_013b5e41b9038b20bb5d5eb419");
  });

  test("builds the new Status index before dropping the old one, all online, outside a transaction", async () => {
    const migration: DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000 =
      new DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: false },
      ),
    ).toEqual([
      `online: CREATE INDEX "${STATUS_INDEX}" ON "NetworkDevice" ("projectId", "isArchived", "isReachable") `,
      `online: DROP INDEX "public"."${STATUS_WITH_LAST_SEEN_INDEX}"`,
      `online: DROP INDEX "public"."${PROJECT_ID_INDEX}"`,
    ]);
  });

  test("OnlineDdl reads the build as one it can run concurrently", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(
      `CREATE INDEX "${STATUS_INDEX}" ON "NetworkDevice" ("projectId", "isArchived", "isReachable") `,
    );

    expect(parsed.name).toBe(STATUS_INDEX);
    expect(parsed.quotedTable).toBe(`"NetworkDevice"`);
    expect(parsed.build).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${STATUS_INDEX}" ON "NetworkDevice" ("projectId", "isArchived", "isReachable")`,
    );
  });

  /*
   * The generator wrote the old Status index's columns in the table's
   * order - ("projectId", "lastSeenAt", "isArchived", "isReachable") - under
   * the old index's name: a different index, which the down() of this
   * migration would have built.
   */
  test("down() puts the old indexes back as they were, columns in their order, before the new one goes", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      `CREATE INDEX "${PROJECT_ID_INDEX}" ON "NetworkDevice" ("projectId") `,
      `CREATE INDEX "${STATUS_WITH_LAST_SEEN_INDEX}" ON "NetworkDevice" ("projectId", "isArchived", "isReachable", "lastSeenAt") `,
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
          DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000
        );
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf(
        "DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000",
      ),
    ).toBeGreaterThan(
      names.indexOf("DropRedundantMonitorProbeIndexes1809151000000"),
    );
    expect(
      new DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000().name,
    ).toBe("DropNetworkDeviceLastSeenAtAndProjectIdIndexes1809151100000");
  });
});

describe("the NetworkDevice model says the same", () => {
  function declared(): Array<IndexMetadataArgs> {
    return getMetadataArgsStorage().indices.filter(
      (index: IndexMetadataArgs): boolean => {
        return index.target === NetworkDevice;
      },
    );
  }

  function columnsOf(index: IndexMetadataArgs): Array<string> {
    if (!Array.isArray(index.columns)) {
      throw new Error(
        "A NetworkDevice index declares its columns as a function; list them.",
      );
    }
    return index.columns as Array<string>;
  }

  /*
   * The columns a poll moves on every device it reaches. An index naming
   * any of them - as a column or in a partial index's WHERE - makes every
   * such poll's write a non-HOT update into every index on the table.
   * ("nextPollAt" is indexed on purpose: the claim cannot find the due
   * devices without it, and the claim's own write is the one non-HOT
   * write a poll makes.)
   */
  const MOVED_BY_EVERY_REACHABLE_POLL: ReadonlyArray<string> = [
    "lastSeenAt",
    "lastSnmpSeenAt",
    "lastPolledAt",
    "lastPollReceivedAt",
    "lastWalkLog",
    "updatedAt",
  ];

  test("no index names a column every reachable poll moves", () => {
    const offending: Array<string> = [];

    for (const index of declared()) {
      for (const column of MOVED_BY_EVERY_REACHABLE_POLL) {
        if (
          columnsOf(index).includes(column) ||
          (index.where || "").includes(`"${column}"`)
        ) {
          offending.push(`(${columnsOf(index).join(", ")}) names ${column}`);
        }
      }
    }

    expect(offending).toEqual([]);
  });

  test("the Status facet and the summary strip still have their index", () => {
    expect(
      declared().some((index: IndexMetadataArgs): boolean => {
        return (
          columnsOf(index).join(",") === "projectId,isArchived,isReachable" &&
          !index.where
        );
      }),
    ).toBe(true);
  });

  test("no full index repeats the leading columns of another", () => {
    const full: Array<Array<string>> = declared()
      .filter((index: IndexMetadataArgs): boolean => {
        return !index.where && !index.unique;
      })
      .map(columnsOf);
    const redundant: Array<string> = [];

    for (const index of full) {
      for (const other of full) {
        if (
          index !== other &&
          index.length < other.length &&
          index.every((column: string, position: number): boolean => {
            return other[position] === column;
          })
        ) {
          redundant.push(`(${index.join(", ")}) of (${other.join(", ")})`);
        }
      }
    }

    expect(redundant).toEqual([]);
  });
});
