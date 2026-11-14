import NetworkEndpoint from "../../../../Models/DatabaseModels/NetworkEndpoint";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddNetworkEndpointCoarseLastSeenAt1809169000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809169000000-AddNetworkEndpointCoarseLastSeenAt";
import { SwapNetworkEndpointLastSeenIndexes1809169100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809169100000-SwapNetworkEndpointLastSeenIndexes";
import { SetNetworkEndpointFillfactor1809169200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809169200000-SetNetworkEndpointFillfactor";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  TableColumnMetadata,
  getTableColumn,
} from "../../../../Types/Database/TableColumn";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A WALK'S REFRESH OF AN ENDPOINT, A HOT UPDATE (#8092).
 *
 * A walk refreshes the lastSeenAt of every endpoint it still sees, and an
 * update that changes a column any index names cannot be HOT: it writes an
 * entry into every index of the table and leaves a dead one in each for
 * vacuum. lastSeenAt was the one indexed column such a refresh moved - in its
 * own index, which no read used, and in the age-out's (projectId, lastSeenAt)
 * of live rows. Three migrations take it out:
 *
 *   - AddNetworkEndpointCoarseLastSeenAt adds coarseLastSeenAt, lastSeenAt a
 *     day at a time;
 *   - SwapNetworkEndpointLastSeenIndexes builds the age-out's index on it,
 *     online, then drops both of lastSeenAt's;
 *   - SetNetworkEndpointFillfactor keeps a fifth of every page free, so the
 *     refresh's new version finds room on its own page.
 *
 * The first two were generated (and the schema drift check finds nothing
 * after them); the third was written by hand, as TypeORM does not model
 * storage parameters. Pure SQL-contract assertions against a fake
 * QueryRunner; OnlineDdl's own steps are recorded as "online: <statement>".
 * NetworkEndpointWritesPostgres runs them, and measures the refresh.
 */

const NEW_INDEX: string = "IDX_77cdf39f743efdfd5bcf4288de";
const OLD_INDEX: string = "IDX_aabb790d91b44c32192ba02414";
const BARE_INDEX: string = "IDX_7c40f683dcf5ec9bb68ffe32e1";
const LIVE: string = `"deletedAt" IS NULL`;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
  isTransactionActive: boolean = true,
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
    isTransactionActive: isTransactionActive,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as Array<unknown>).map((migration: unknown) => {
    return (migration as { name: string }).name;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddNetworkEndpointCoarseLastSeenAt1809169000000", () => {
  test("adds the column as the generator wrote it: a nullable timestamptz, no default, so nothing is rewritten", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddNetworkEndpointCoarseLastSeenAt1809169000000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "NetworkEndpoint" ADD "coarseLastSeenAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("down() drops it", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddNetworkEndpointCoarseLastSeenAt1809169000000().down(
          runner,
        );
      }),
    ).toEqual([`ALTER TABLE "NetworkEndpoint" DROP COLUMN "coarseLastSeenAt"`]);
  });

  test("runs in a transaction: adding a nullable column is instant", () => {
    expect(
      (
        new AddNetworkEndpointCoarseLastSeenAt1809169000000() as {
          transaction?: boolean;
        }
      ).transaction,
    ).not.toBe(false);
  });
});

describe("SwapNetworkEndpointLastSeenIndexes1809169100000", () => {
  test("runs outside a transaction, so every build and drop is online", () => {
    expect(
      new SwapNetworkEndpointLastSeenIndexes1809169100000().transaction,
    ).toBe(false);
  });

  test("builds the coarse index first, then drops both of lastSeenAt's - through OnlineDdl only", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SwapNetworkEndpointLastSeenIndexes1809169100000().up(runner);
      }, false),
    ).toEqual([
      `online: CREATE INDEX "${NEW_INDEX}" ON "NetworkEndpoint" ("projectId", "coarseLastSeenAt") WHERE ${LIVE}`,
      `online: DROP INDEX "public"."${OLD_INDEX}"`,
      `online: DROP INDEX "public"."${BARE_INDEX}"`,
    ]);
  });

  test("OnlineDdl reads the build as one it can run concurrently, its predicate kept", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(
      `CREATE INDEX "${NEW_INDEX}" ON "NetworkEndpoint" ("projectId", "coarseLastSeenAt") WHERE ${LIVE}`,
    );

    expect(parsed.name).toBe(NEW_INDEX);
    expect(parsed.quotedTable).toBe(`"NetworkEndpoint"`);
    expect(parsed.build).toContain("CREATE INDEX CONCURRENTLY");
    expect(parsed.build).toContain(
      `("projectId", "coarseLastSeenAt") WHERE ${LIVE}`,
    );
  });

  test("down() puts lastSeenAt's indexes back, as the generator wrote them, before the coarse one goes", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SwapNetworkEndpointLastSeenIndexes1809169100000().down(
          runner,
        );
      }),
    ).toEqual([
      `CREATE INDEX "${BARE_INDEX}" ON "NetworkEndpoint" ("lastSeenAt") `,
      `CREATE INDEX "${OLD_INDEX}" ON "NetworkEndpoint" ("projectId", "lastSeenAt") WHERE ("deletedAt" IS NULL)`,
      `online: DROP INDEX "public"."${NEW_INDEX}"`,
    ]);
  });

  test("every name is the one TypeORM gives the index, so the drift check generates nothing", () => {
    const naming: DefaultNamingStrategy = new DefaultNamingStrategy();

    expect(
      naming.indexName(
        "NetworkEndpoint",
        ["projectId", "coarseLastSeenAt"],
        LIVE,
      ),
    ).toBe(NEW_INDEX);
    expect(
      naming.indexName("NetworkEndpoint", ["projectId", "lastSeenAt"], LIVE),
    ).toBe(OLD_INDEX);
    expect(naming.indexName("NetworkEndpoint", ["lastSeenAt"])).toBe(
      BARE_INDEX,
    );
  });
});

describe("SetNetworkEndpointFillfactor1809169200000", () => {
  const STORAGE_PARAMETER_ONLY: RegExp =
    /^ALTER TABLE "NetworkEndpoint" (SET \(fillfactor = \d+\)|RESET \(fillfactor\))$/;

  test("keeps a fifth of every page free - and does nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetNetworkEndpointFillfactor1809169200000().up(runner);
      }),
    ).toEqual([`ALTER TABLE "NetworkEndpoint" SET (fillfactor = 80)`]);
  });

  test("down() gives the table the default back", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetNetworkEndpointFillfactor1809169200000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "NetworkEndpoint" RESET (fillfactor)`]);
  });

  test("every statement only sets a storage parameter: SHARE UPDATE EXCLUSIVE, no rewrite", async () => {
    const migration: SetNetworkEndpointFillfactor1809169200000 =
      new SetNetworkEndpointFillfactor1809169200000();
    const statements: Array<string> = [
      ...(await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      })),
      ...(await statementsOf((runner: QueryRunner) => {
        return migration.down(runner);
      })),
    ];

    expect(statements).toHaveLength(2);
    expect(
      statements.filter((statement: string): boolean => {
        return !STORAGE_PARAMETER_ONLY.test(statement);
      }),
    ).toEqual([]);
  });
});

describe("the three, registered", () => {
  test("each once, in order, after the migrations before them, and named for its class", () => {
    const names: Array<string> = registeredNames();
    const order: Array<string> = [
      "AddNetworkEndpointCoarseLastSeenAt1809169000000",
      "SwapNetworkEndpointLastSeenIndexes1809169100000",
      "SetNetworkEndpointFillfactor1809169200000",
    ];

    for (const name of order) {
      expect(
        names.filter((candidate: string): boolean => {
          return candidate === name;
        }),
      ).toHaveLength(1);
    }
    expect(names.indexOf(order[0]!)).toBeLessThan(names.indexOf(order[1]!));
    expect(names.indexOf(order[1]!)).toBeLessThan(names.indexOf(order[2]!));
    expect(names.indexOf(order[0]!)).toBeGreaterThan(
      names.indexOf("AddNetworkEndpointLastSeenIndex1809080463891"),
    );
    expect(names.indexOf(order[0]!)).toBeGreaterThan(
      names.indexOf("SetNetworkInterfaceFillfactor1809164000000"),
    );

    expect(new AddNetworkEndpointCoarseLastSeenAt1809169000000().name).toBe(
      order[0],
    );
    expect(new SwapNetworkEndpointLastSeenIndexes1809169100000().name).toBe(
      order[1],
    );
    expect(new SetNetworkEndpointFillfactor1809169200000().name).toBe(order[2]);
  });
});

describe("the model says the same", () => {
  function declaredIndexes(): Array<IndexMetadataArgs> {
    return getMetadataArgsStorage().indices.filter(
      (index: IndexMetadataArgs): boolean => {
        return index.target === NetworkEndpoint;
      },
    );
  }

  test("the age-out's index is (projectId, coarseLastSeenAt) of live rows", () => {
    const coarse: Array<IndexMetadataArgs> = declaredIndexes().filter(
      (index: IndexMetadataArgs): boolean => {
        return (
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).join(",") ===
            "projectId,coarseLastSeenAt"
        );
      },
    );

    expect(coarse).toHaveLength(1);
    expect(coarse[0]!.where).toBe(LIVE);
    expect(coarse[0]!.unique).toBeFalsy();
  });

  // A column's own @Index() is recorded with that column as its columns.
  test("no index names lastSeenAt, in its columns or its predicate", () => {
    expect(declaredIndexes().length).toBeGreaterThan(0);

    for (const index of declaredIndexes()) {
      const columns: Array<string> = Array.isArray(index.columns)
        ? (index.columns as Array<string>)
        : [];

      expect(columns).not.toContain("lastSeenAt");
      expect(index.where || "").not.toContain("lastSeenAt");
    }
  });

  test("coarseLastSeenAt is a nullable timestamptz the server alone reads and writes", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === NetworkEndpoint &&
            candidate.propertyName === "coarseLastSeenAt"
          );
        },
      );

    expect(column?.options.nullable).toBe(true);
    expect(column?.options.type).toBe("timestamptz");
    expect(column?.options.default).toBeUndefined();

    const metadata: TableColumnMetadata = getTableColumn(
      new NetworkEndpoint(),
      "coarseLastSeenAt",
    );
    expect(metadata.hideColumnInDocumentation).toBe(true);
    expect(metadata.required).toBeFalsy();

    const access: unknown = new NetworkEndpoint().getColumnAccessControlFor(
      "coarseLastSeenAt",
    );
    expect(access).toMatchObject({ create: [], read: [], update: [] });
  });
});
