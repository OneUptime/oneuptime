import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import {
  AddInventoryItemProjectEntityKeyIndex1795200000000,
  INVENTORY_ITEM_INLINE_INDEX_BUILD_MAX_ROWS,
  INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
  INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX_RUNBOOK,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1795200000000-AddInventoryItemProjectEntityKeyIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import logger from "../../../../Server/Utils/Logger";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The ("projectId", "entityKey") index behind the Topology API's key
 * lookups. What must hold together:
 *
 *   1. The entity declares it BY NAME with synchronize: false, or the next
 *      generated migration drops it (the schema builder drops every index it
 *      cannot match by name) or tries to create a second copy.
 *   2. The migration can never outlive the client's query timeout: it leaves
 *      statement_timeout at the connection's value (a raised one keeps an
 *      abandoned build holding its SHARE lock on the server), bounds its lock
 *      wait, and does not build at all on a table too large to index inside
 *      that window — it logs the CONCURRENTLY runbook instead.
 *   3. It clears an INVALID leftover of a failed CONCURRENTLY pre-build, and
 *      an operator's valid pre-built index makes it a no-op.
 *   4. It is registered in order, so it actually runs.
 *
 * Pure metadata and a scripted query runner — no database. The same
 * branches run against a real Postgres in
 * InventoryItemEntityKeyIndexMigrationPostgres.test.ts.
 */

type Recorded = { sql: string; params: Array<unknown> | undefined };

interface Catalog {
  /* The index as pg_index has it: absent, valid or invalid. */
  index: "absent" | "valid" | "invalid";
  reltuples: number;
  relpages: number;
  pages: number;
  /* What the bounded count answers when the statistics are unknown. */
  counted?: number;
  /* An online (CONCURRENTLY) build of the index is running right now. */
  building?: boolean;
}

const SMALL: Catalog = {
  index: "absent",
  reltuples: 5_000,
  relpages: 100,
  pages: 100,
};

async function record(
  catalog: Catalog,
  run: (queryRunner: QueryRunner) => Promise<void>,
): Promise<Array<Recorded>> {
  const recorded: Array<Recorded> = [];
  const queryRunner: QueryRunner = {
    query: async (sql: string, params?: Array<unknown>): Promise<unknown> => {
      recorded.push({ sql, params });
      if (sql.includes("pg_stat_progress_create_index")) {
        return catalog.building ? [{ "?column?": 1 }] : [];
      }
      if (sql.includes("pg_index")) {
        return catalog.index === "absent"
          ? []
          : [{ isValid: catalog.index === "valid" }];
      }
      if (sql.includes("reltuples")) {
        return [
          {
            reltuples: catalog.reltuples,
            relpages: catalog.relpages,
            pages: catalog.pages,
          },
        ];
      }
      if (sql.includes("COUNT(*)")) {
        return [{ count: catalog.counted ?? 0 }];
      }
      return [];
    },
  } as unknown as QueryRunner;
  await run(queryRunner);
  return recorded;
}

async function up(
  catalog: Catalog,
  maxRows?: number,
): Promise<Array<Recorded>> {
  return await record(
    catalog,
    async (queryRunner: QueryRunner): Promise<void> => {
      await new AddInventoryItemProjectEntityKeyIndex1795200000000(maxRows).up(
        queryRunner,
      );
    },
  );
}

function statementsOf(recorded: Array<Recorded>): Array<string> {
  return recorded.map((entry: Recorded): string => {
    return entry.sql.replace(/\s+/g, " ").trim();
  });
}

/* Structurally typed: @jest/globals and @types/jest disagree on spy types. */
type WarnSpy = { mock: { calls: Array<Array<unknown>> } };

function silenceWarnings(): WarnSpy {
  return jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  }) as unknown as WarnSpy;
}

const CREATE: string = `CREATE INDEX IF NOT EXISTS "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY" ON "InventoryItem" ("projectId", "entityKey")`;
const DROP: string = `DROP INDEX IF EXISTS "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY"`;

describe("InventoryItem (projectId, entityKey) index", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the entity declares it by name, outside schema synchronization", () => {
    const declared: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === InventoryItem &&
            index.name === INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX
          );
        },
      );
    expect(declared).toBeDefined();
    expect(declared?.synchronize).toBe(false);
    expect(declared?.columns).toEqual(["projectId", "entityKey"]);
    expect(declared?.unique).toBeFalsy();
  });

  test("the inline build is bounded at a million rows by default", () => {
    expect(INVENTORY_ITEM_INLINE_INDEX_BUILD_MAX_ROWS).toBe(1_000_000);
    expect(INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX_RUNBOOK).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY" ON "InventoryItem" ("projectId", "entityKey")`,
    );
  });

  test("up() on a small table: the connection's timeouts, then the plain, idempotent, non-unique build", async () => {
    const recorded: Array<Recorded> = await up(SMALL);
    const statements: Array<string> = statementsOf(recorded);
    expect(statements).toHaveLength(5);
    /*
     * Never a raised statement_timeout: the client's query_timeout (35 s)
     * cannot be raised, and a build the client abandons keeps running on
     * the server with its SHARE lock for as long as the server allows.
     */
    expect(statements[0]).toBe(`SET LOCAL statement_timeout = DEFAULT`);
    expect(statements[1]).toBe(`SET LOCAL lock_timeout = '5s'`);
    expect(statements[2]).toContain("x.indisvalid");
    expect(statements[2]).toContain("n.nspname = current_schema()");
    expect(recorded[2]!.params).toEqual([
      INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
    ]);
    expect(statements[3]).toContain("c.reltuples");
    expect(statements[3]).toContain("pg_relation_size(c.oid)");
    expect(statements[4]).toBe(CREATE);
    // Migrations run inside a transaction: CONCURRENTLY would abort the run.
    expect(statements.join(" ")).not.toContain("CONCURRENTLY");
    expect(statements.join(" ")).not.toContain("UNIQUE");
    expect(statements.join(" ")).not.toMatch(/statement_timeout = '\d+/);
  });

  test("up(): a valid index already there (an operator's pre-build) is left alone", async () => {
    const statements: Array<string> = statementsOf(
      await up({ ...SMALL, index: "valid" }),
    );
    expect(statements).toEqual([
      `SET LOCAL statement_timeout = DEFAULT`,
      `SET LOCAL lock_timeout = '5s'`,
      expect.stringContaining("pg_index"),
    ]);
  });

  test("up(): an INVALID leftover of a failed online build is dropped, then rebuilt", async () => {
    const statements: Array<string> = statementsOf(
      await up({ ...SMALL, index: "invalid" }),
    );
    expect(statements).toEqual([
      `SET LOCAL statement_timeout = DEFAULT`,
      `SET LOCAL lock_timeout = '5s'`,
      expect.stringContaining("pg_index"),
      expect.stringContaining("pg_stat_progress_create_index"),
      DROP,
      expect.stringContaining("reltuples"),
      CREATE,
    ]);
  });

  /*
   * A CONCURRENTLY build that is still running is INVALID until it finishes.
   * Dropping it would queue for ACCESS EXCLUSIVE behind the build and stall
   * every reader and writer of InventoryItem, so it is left alone.
   */
  test("up(): an online build still in progress is neither dropped nor raced", async () => {
    const warn: WarnSpy = silenceWarnings();
    const statements: Array<string> = statementsOf(
      await up({ ...SMALL, index: "invalid", building: true }),
    );
    expect(statements).not.toContain(DROP);
    expect(statements.join(" ")).not.toContain("CREATE INDEX");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("in progress");
  });

  test("up() on a table too large to index inline: no build, a warning with the runbook", async () => {
    const warn: WarnSpy = silenceWarnings();
    const statements: Array<string> = statementsOf(
      await up({
        index: "absent",
        reltuples: 2_500_000,
        relpages: 50_000,
        pages: 50_000,
      }),
    );
    expect(statements).not.toContain(CREATE);
    expect(statements.join(" ")).not.toContain("CREATE INDEX");
    expect(statements.join(" ")).not.toContain("COUNT(*)");
    expect(warn).toHaveBeenCalledTimes(1);
    const message: string = String(warn.mock.calls[0]![0]);
    expect(message).toContain(INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX_RUNBOOK);
    expect(message).toContain("2500000");
    expect(message).toContain("NOT created");
  });

  test("up(): an INVALID leftover on a large table is still dropped, so the runbook works as written", async () => {
    silenceWarnings();
    const statements: Array<string> = statementsOf(
      await up({
        index: "invalid",
        reltuples: 3_000_000,
        relpages: 60_000,
        pages: 60_000,
      }),
    );
    expect(statements).toContain(DROP);
    expect(statements).not.toContain(CREATE);
  });

  test("the estimate counts growth since the last ANALYZE (reltuples scaled to the current pages)", async () => {
    silenceWarnings();
    // Analyzed at 600k rows over 10k pages; the table has tripled since.
    const statements: Array<string> = statementsOf(
      await up({
        index: "absent",
        reltuples: 600_000,
        relpages: 10_000,
        pages: 30_000,
      }),
    );
    expect(statements).not.toContain(CREATE);
  });

  test.each([
    ["never analyzed (reltuples -1)", { reltuples: -1, relpages: 0 }],
    [
      "analyzed while empty, has pages now",
      { reltuples: 0, relpages: 0, pages: 20 },
    ],
  ])(
    "unknown statistics (%s): a count bounded just past the threshold decides",
    async (_label: string, statistics: Partial<Catalog>) => {
      silenceWarnings();
      const base: Catalog = {
        index: "absent",
        reltuples: -1,
        relpages: 0,
        pages: 20,
        ...statistics,
      };

      const small: Array<Recorded> = await up({ ...base, counted: 10 }, 10);
      const count: Recorded | undefined = small.find((entry: Recorded) => {
        return entry.sql.includes("COUNT(*)");
      });
      expect(count?.sql.replace(/\s+/g, " ")).toBe(
        `SELECT COUNT(*)::int AS "count" FROM (SELECT 1 FROM "InventoryItem" LIMIT $1) bounded`,
      );
      expect(count?.params).toEqual([11]);
      expect(statementsOf(small)).toContain(CREATE);

      const large: Array<Recorded> = await up({ ...base, counted: 11 }, 10);
      expect(statementsOf(large)).not.toContain(CREATE);
    },
  );

  test("the default bound is used when the migration is constructed as TypeORM does", async () => {
    const recorded: Array<Recorded> = await up({
      index: "absent",
      reltuples: -1,
      relpages: 0,
      pages: 0,
      counted: 7,
    });
    const count: Recorded | undefined = recorded.find((entry: Recorded) => {
      return entry.sql.includes("COUNT(*)");
    });
    expect(count?.params).toEqual([
      INVENTORY_ITEM_INLINE_INDEX_BUILD_MAX_ROWS + 1,
    ]);
    expect(statementsOf(recorded)).toContain(CREATE);
  });

  test("down() drops exactly that index, without waiting long for its lock", async () => {
    const recorded: Array<Recorded> = await record(
      SMALL,
      async (queryRunner: QueryRunner): Promise<void> => {
        await new AddInventoryItemProjectEntityKeyIndex1795200000000().down(
          queryRunner,
        );
      },
    );
    expect(statementsOf(recorded)).toEqual([
      `SET LOCAL statement_timeout = DEFAULT`,
      `SET LOCAL lock_timeout = '5s'`,
      DROP,
    ]);
  });

  describe("registration", () => {
    const MIGRATION_NAME: string =
      "AddInventoryItemProjectEntityKeyIndex1795200000000";
    const MIGRATION_TIMESTAMP: number = 1795200000000;

    function registeredNames(): Array<string> {
      return (SchemaMigrations as unknown as Array<{ name: string }>).map(
        (registered: { name: string }): string => {
          return registered.name;
        },
      );
    }

    function timestampOf(className: string): number | null {
      const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
      return match ? Number(match[1]) : null;
    }

    test("is registered under the name its class carries", () => {
      expect(
        new AddInventoryItemProjectEntityKeyIndex1795200000000().name,
      ).toBe(MIGRATION_NAME);
      expect(SchemaMigrations).toContain(
        AddInventoryItemProjectEntityKeyIndex1795200000000,
      );
    });

    /*
     * Placement relative to its neighbours only, so a later migration
     * registered after this one never breaks this suite.
     */
    test("nothing registered before it is newer than it", () => {
      const names: Array<string> = registeredNames();
      const ownIndex: number = names.indexOf(MIGRATION_NAME);
      expect(ownIndex).toBeGreaterThan(0);
      expect(
        names.slice(0, ownIndex).filter((className: string): boolean => {
          const timestamp: number | null = timestampOf(className);
          return timestamp !== null && timestamp >= MIGRATION_TIMESTAMP;
        }),
      ).toEqual([]);
    });

    test("nothing registered after it is older than it", () => {
      const names: Array<string> = registeredNames();
      const ownIndex: number = names.indexOf(MIGRATION_NAME);
      expect(
        names.slice(ownIndex + 1).filter((className: string): boolean => {
          const timestamp: number | null = timestampOf(className);
          return timestamp === null || timestamp <= MIGRATION_TIMESTAMP;
        }),
      ).toEqual([]);
    });
  });
});
