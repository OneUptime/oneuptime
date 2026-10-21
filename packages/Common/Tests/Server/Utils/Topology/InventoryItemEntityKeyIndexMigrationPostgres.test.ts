import {
  AddInventoryItemProjectEntityKeyIndex1795200000000,
  INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
  INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX_RUNBOOK,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1795200000000-AddInventoryItemProjectEntityKeyIndex";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource, QueryRunner } from "typeorm";

/*
 * Migration 1795200000000 EXECUTED on Postgres, against a clone of the
 * migrated InventoryItem table: the branch that builds the index, the branch
 * that leaves a large table to the operator's CONCURRENTLY runbook (and that
 * runbook then working), the planner-statistics and bounded-count estimates,
 * an INVALID leftover of a failed online build, and the statement_timeout the
 * build runs under — the connection's own, even after something on the
 * session raised it.
 *
 * The inline-build threshold is lowered through the migration's constructor so
 * a few dozen rows stand in for a million.
 *
 * Opt in with RUN_POSTGRES_TOPOLOGY_TESTS=true (the Topology Postgres suites'
 * flag) against a Postgres migrated to the current head. The table's
 * STRUCTURE is cloned into a unique schema that is the connection's whole
 * search_path, and dropped afterwards; no real row is read or written.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * TOPOLOGY_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * TOPOLOGY_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TOPOLOGY_TESTS"] === "true"
    ? describe
    : describe.skip;

/* The connection's statement_timeout, distinct from any server default. */
const CONNECTION_STATEMENT_TIMEOUT_MS: number = 43_210;

/* DDL on an index, as the recorded statements spell it. */
const INDEX_DDL: RegExp = /^(CREATE|DROP) INDEX/;

/* Any index on exactly these columns, whatever the clone named it. */
const ENTITY_KEY_INDEX_DEFINITION: RegExp = /\("projectId", "entityKey"\)$/;

interface IndexState {
  name: string;
  isValid: boolean;
  isUnique: boolean;
  definition: string;
}

describePostgres(
  "AddInventoryItemProjectEntityKeyIndex1795200000000 against Postgres",
  () => {
    const schema: string = `topology_migration_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const projectId: string = ObjectID.generate().toString();
    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["TOPOLOGY_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["TOPOLOGY_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TOPOLOGY_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: [],
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema}`,
          statement_timeout: CONNECTION_STATEMENT_TIMEOUT_MS,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    /*
     * A fresh clone per test: new tables have never been analyzed, so each
     * test starts from the statistics a just-created table has.
     */
    beforeEach(async () => {
      await database.query(`DROP TABLE IF EXISTS "${schema}"."InventoryItem"`);
      await database.query(
        `CREATE TABLE "${schema}"."InventoryItem" (LIKE public."InventoryItem" INCLUDING ALL)`,
      );
      for (const index of await indexes()) {
        await database.query(`DROP INDEX "${schema}"."${index.name}"`);
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /* The indexes on ("projectId", "entityKey") in the test schema. */
    async function indexes(): Promise<Array<IndexState>> {
      const rows: Array<{
        name: string;
        isValid: boolean;
        isUnique: boolean;
        definition: string;
      }> = await database.query(
        `SELECT c.relname AS "name", x.indisvalid AS "isValid",
                x.indisunique AS "isUnique",
                pg_get_indexdef(x.indexrelid) AS "definition"
         FROM pg_index x
         JOIN pg_class c ON c.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = $1 AND t.relname = 'InventoryItem'`,
        [schema],
      );
      return rows.filter((index: IndexState): boolean => {
        return ENTITY_KEY_INDEX_DEFINITION.test(index.definition);
      });
    }

    /* `count` items with distinct keys, or all sharing one key. */
    async function seed(count: number, sharedKey?: string): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."InventoryItem"
          ("_id", "createdAt", "updatedAt", "version", "projectId", "entityType",
           "entityKey", "displayName", "source", "lastSeenAt", "isArchived")
         SELECT gen_random_uuid(), now(), now(), 1, $1, 'type-' || g,
                COALESCE($2, 'key-' || g), 'item ' || g, 'discovered', now(), false
         FROM generate_series(1, $3) AS g`,
        [projectId, sharedKey ?? null, count],
      );
    }

    interface Run {
      statements: Array<string>;
      /* current_setting('statement_timeout') right after up() returned. */
      statementTimeout: string;
    }

    /*
     * Runs up() the way TypeORM runs a migration: inside its own transaction
     * on one connection. `before` runs on that connection first.
     */
    async function runUp(
      maxRows: number,
      before?: (queryRunner: QueryRunner) => Promise<void>,
    ): Promise<Run> {
      const queryRunner: QueryRunner = database.createQueryRunner();
      await queryRunner.connect();
      const statements: Array<string> = [];
      const query: QueryRunner["query"] = queryRunner.query.bind(queryRunner);
      queryRunner.query = (async (
        sql: string,
        params?: Array<unknown>,
      ): Promise<unknown> => {
        statements.push(sql.replace(/\s+/g, " ").trim());
        return await query(sql, params);
      }) as QueryRunner["query"];
      try {
        if (before) {
          await before(queryRunner);
        }
        await queryRunner.startTransaction();
        try {
          await new AddInventoryItemProjectEntityKeyIndex1795200000000(
            maxRows,
          ).up(queryRunner);
          const setting: Array<{ value: string }> = await query(
            `SELECT current_setting('statement_timeout') AS "value"`,
          );
          await queryRunner.commitTransaction();
          return { statements, statementTimeout: setting[0]!.value };
        } catch (error) {
          await queryRunner.rollbackTransaction();
          throw error;
        }
      } finally {
        // Nothing `before` set may follow the connection back into the pool.
        await query(`RESET statement_timeout`);
        await queryRunner.release();
      }
    }

    function silenceWarnings(): { mock: { calls: Array<Array<unknown>> } } {
      return jest.spyOn(logger, "warn").mockImplementation((): void => {
        return undefined;
      }) as unknown as { mock: { calls: Array<Array<unknown>> } };
    }

    function created(run: Run): boolean {
      return run.statements.some((statement: string): boolean => {
        return statement.startsWith("CREATE INDEX");
      });
    }

    function counted(run: Run): boolean {
      return run.statements.some((statement: string): boolean => {
        return statement.includes("COUNT(*)");
      });
    }

    test("a table under the threshold gets the plain, valid, non-unique index", async () => {
      await seed(5);
      const run: Run = await runUp(10);
      expect(created(run)).toBe(true);
      expect(await indexes()).toEqual([
        {
          name: INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
          isValid: true,
          isUnique: false,
          definition: expect.stringMatching(
            /^CREATE INDEX "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY" ON .*"InventoryItem" USING btree \("projectId", "entityKey"\)$/,
          ),
        },
      ]);
    });

    test("the build runs under the connection's statement_timeout, even after the session raised it", async () => {
      await seed(3);
      const run: Run = await runUp(
        10,
        async (queryRunner: QueryRunner): Promise<void> => {
          await queryRunner.query(`SET statement_timeout = '600s'`);
        },
      );
      expect(created(run)).toBe(true);
      expect(run.statementTimeout).toBe(`${CONNECTION_STATEMENT_TIMEOUT_MS}ms`);
    });

    test("a table past the threshold is left to the runbook, which then works, and a rerun is a no-op", async () => {
      const warn: { mock: { calls: Array<Array<unknown>> } } =
        silenceWarnings();
      await seed(50);

      const skipped: Run = await runUp(10);
      expect(created(skipped)).toBe(false);
      expect(await indexes()).toEqual([]);
      expect(warn.mock.calls).toHaveLength(1);
      expect(String(warn.mock.calls[0]![0])).toContain(
        INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX_RUNBOOK,
      );

      // The operator's online build, outside any transaction.
      await database.query(INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX_RUNBOOK);
      expect(await indexes()).toEqual([
        expect.objectContaining({
          name: INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
          isValid: true,
          isUnique: false,
        }),
      ]);

      const rerun: Run = await runUp(10);
      expect(
        rerun.statements.filter((statement: string): boolean => {
          return INDEX_DDL.test(statement);
        }),
      ).toEqual([]);
      expect(counted(rerun)).toBe(false);
      expect(warn.mock.calls).toHaveLength(1);
    });

    test("an analyzed table is judged by the planner's statistics, without a count", async () => {
      silenceWarnings();
      await seed(50);
      await database.query(`ANALYZE "${schema}"."InventoryItem"`);

      const skipped: Run = await runUp(10);
      expect(counted(skipped)).toBe(false);
      expect(created(skipped)).toBe(false);

      const built: Run = await runUp(100);
      expect(counted(built)).toBe(false);
      expect(created(built)).toBe(true);
      expect(await indexes()).toHaveLength(1);
    });

    test("a never-analyzed table is counted, only up to just past the threshold", async () => {
      silenceWarnings();
      await seed(50);
      const run: Run = await runUp(10);
      /*
       * Autovacuum may analyze the fresh table first; either way the table
       * is judged too large.
       */
      expect(created(run)).toBe(false);
      expect(await indexes()).toEqual([]);
    });

    test("an INVALID leftover of a failed online build is dropped and rebuilt", async () => {
      // Two rows sharing (projectId, entityKey) make a UNIQUE online build fail.
      await seed(2, "shared-key");
      await expect(
        database.query(
          `CREATE UNIQUE INDEX CONCURRENTLY "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}" ON "InventoryItem" ("projectId", "entityKey")`,
        ),
      ).rejects.toThrow();
      expect(await indexes()).toEqual([
        expect.objectContaining({
          name: INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
          isValid: false,
          isUnique: true,
        }),
      ]);

      const run: Run = await runUp(10);
      expect(run.statements).toContain(
        `DROP INDEX IF EXISTS "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}"`,
      );
      expect(await indexes()).toEqual([
        expect.objectContaining({
          name: INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
          isValid: true,
          isUnique: false,
        }),
      ]);
    });

    /*
     * An operator's CONCURRENTLY build that is still running is INVALID
     * until it finishes. Dropping it would queue for ACCESS EXCLUSIVE behind
     * the build and stall every reader and writer of the table, so the
     * migration must leave it alone and complete at once.
     */
    test("an online build still in progress is left to finish, never dropped", async () => {
      await seed(3);
      const writer: QueryRunner = database.createQueryRunner();
      const builder: QueryRunner = database.createQueryRunner();
      await writer.connect();
      await builder.connect();
      try {
        // An open writer makes CONCURRENTLY wait with its index INVALID.
        await writer.startTransaction();
        await writer.query(
          `INSERT INTO "InventoryItem"
            ("_id", "createdAt", "updatedAt", "version", "projectId", "entityType",
             "entityKey", "displayName", "source", "lastSeenAt", "isArchived")
           VALUES (gen_random_uuid(), now(), now(), 1, $1, 'type-w', 'key-w',
             'writer', 'discovered', now(), false)`,
          [projectId],
        );
        const build: Promise<unknown> = builder.query(
          `CREATE INDEX CONCURRENTLY "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}" ON "InventoryItem" ("projectId", "entityKey")`,
        );

        let inProgress: boolean = false;
        for (let attempt: number = 0; attempt < 50 && !inProgress; attempt++) {
          const rows: Array<unknown> = await database.query(
            `SELECT 1 FROM pg_stat_progress_create_index p
             JOIN pg_class c ON c.oid = p.index_relid
             WHERE c.relname = $1`,
            [INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX],
          );
          inProgress = rows.length > 0;
          if (!inProgress) {
            await new Promise<void>((resolve: () => void): void => {
              setTimeout(resolve, 100);
            });
          }
        }
        expect(inProgress).toBe(true);
        expect(await indexes()).toEqual([
          expect.objectContaining({ isValid: false }),
        ]);

        const warn: { mock: { calls: Array<Array<unknown>> } } =
          silenceWarnings();
        const startedAt: number = Date.now();
        const run: Run = await runUp(10);
        expect(Date.now() - startedAt).toBeLessThan(3_000);
        expect(run.statements).not.toContain(
          `DROP INDEX IF EXISTS "${INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX}"`,
        );
        expect(created(run)).toBe(false);
        expect(String(warn.mock.calls[0]![0])).toContain("in progress");

        await writer.commitTransaction();
        await build;
        expect(await indexes()).toEqual([
          expect.objectContaining({
            name: INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
            isValid: true,
            isUnique: false,
          }),
        ]);
      } finally {
        if (writer.isTransactionActive) {
          await writer.rollbackTransaction();
        }
        await writer.release();
        await builder.release();
      }
    });

    test("down() drops it, inside its own transaction as TypeORM runs it", async () => {
      await seed(1);
      await runUp(10);
      expect(await indexes()).toHaveLength(1);
      const queryRunner: QueryRunner = database.createQueryRunner();
      await queryRunner.connect();
      try {
        await queryRunner.startTransaction();
        await new AddInventoryItemProjectEntityKeyIndex1795200000000().down(
          queryRunner,
        );
        const lockTimeout: Array<{ value: string }> = await queryRunner.query(
          `SELECT current_setting('lock_timeout') AS "value"`,
        );
        expect(lockTimeout[0]!.value).toBe("5s");
        await queryRunner.commitTransaction();
      } finally {
        await queryRunner.release();
      }
      expect(await indexes()).toEqual([]);
    });
  },
);
