import {
  AddLlmLogProjectCreatedAtIndex1798300000000,
  LLM_LOG_INDEX_BUILD_LIMITS,
  LLM_LOG_PROJECT_CREATED_AT_INDEX,
  LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
  LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP,
} from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1798300000000-AddLlmLogProjectCreatedAtIndex";
import LlmLogService from "../../../Server/Services/LlmLogService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import { jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { DataSource, QueryRunner } from "typeorm";

/*
 * Today's AI usage of a project, read through an index, on a migrated
 * Postgres.
 *
 * With a daily token or spend limit set, every AI call sums the project's AI
 * Logs since midnight UTC (LlmLogService.getProjectUsageSince), and with an
 * incident or alert daily token limit set every autonomous AI call sums its
 * lane (getTotalTokensUsedSince). Before migration 1798300000000 LlmLog had an
 * index on "projectId" alone, so each sum read the project's whole AI Log
 * history - for a project owning most of the table, all of LlmLog.
 *
 * The first half runs the services' own SQL against a clone of the MIGRATED
 * LlmLog (its indexes included) seeded with a long history, and reads the
 * plan Postgres executes: the sum must be bounded by the index on both the
 * project and the time, reading today's rows only. On a schema without the
 * index it reads the whole history, which is what these tests catch.
 *
 * The second half runs the migration itself against a clone stripped of the
 * index: through TypeORM's own migration runner (outside a transaction, as
 * `transaction = false` asks), on an index built ahead of it, on the INVALID
 * copy a stopped online build leaves, beside a build still in progress, and
 * when its build is held up past its bounds.
 *
 * Opt in with RUN_POSTGRES_LLM_LOG_USAGE_INDEX_TESTS=true against a database
 * the registered migrations have been applied to:
 *
 *   RUN_POSTGRES_LLM_LOG_USAGE_INDEX_TESTS=true \
 *   LLM_LOG_USAGE_INDEX_TEST_DATABASE_HOST=127.0.0.1 \
 *   LLM_LOG_USAGE_INDEX_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/LlmLogDailyUsageIndexPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. The tables
 * are structure-only clones (LIKE ... INCLUDING ALL) in a uniquely named
 * schema that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_LLM_LOG_USAGE_INDEX_TESTS"] === "true"
    ? describe
    : describe.skip;

/* The connection's own timeouts, distinct from any server default. */
const CONNECTION_STATEMENT_TIMEOUT_MS: number = 43_210;
const CONNECTION_LOCK_TIMEOUT_MS: number = 12_345;

/* DDL on an index, as the recorded statements spell it. */
const INDEX_DDL: RegExp = /^(CREATE|DROP) INDEX/;

/* Any index on exactly these columns, whatever the clone named it. */
const USAGE_INDEX_DEFINITION: RegExp =
  /USING btree \("projectId", "createdAt"\)$/;

const HISTORY_DAYS: number = 200;
const BUSY_PROJECT_ROWS_PER_DAY: number = 100;
const QUIET_PROJECTS: number = 30;
const QUIET_PROJECT_ROWS: number = 500;

/* Today's calls of the busy project, at least one second after midnight UTC. */
const TODAY_ROWS: number = 12;

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  Plans?: Array<PlanNode>;
}

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

interface IndexState {
  name: string;
  isValid: boolean;
  definition: string;
}

function flatten(node: PlanNode): Array<PlanNode> {
  return [node, ...(node.Plans || []).flatMap(flatten)];
}

/* How many LlmLog rows a scan node visited: returned plus filtered out. */
function rowsVisited(node: PlanNode): number {
  return (
    ((node["Actual Rows"] || 0) +
      (node["Rows Removed by Filter"] || 0) +
      (node["Rows Removed by Index Recheck"] || 0)) *
    (node["Actual Loops"] || 1)
  );
}

function midnightUtc(): Date {
  const now: Date = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

describePostgres("LlmLog daily usage index against Postgres", () => {
  const schema: string = `llm_log_usage_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const busyProjectId: ObjectID = ObjectID.generate();
  const quietProjectId: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-000000000007",
  );
  const incidentId: string = ObjectID.generate().toString();
  const alertId: string = ObjectID.generate().toString();

  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["LLM_LOG_USAGE_INDEX_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["LLM_LOG_USAGE_INDEX_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["LLM_LOG_USAGE_INDEX_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: [],
      schema,
      synchronize: false,
      extra: {
        // The clone first: unqualified "LlmLog" and "AIRun" resolve to it.
        options: `-c search_path=${schema}`,
        statement_timeout: CONNECTION_STATEMENT_TIMEOUT_MS,
        lock_timeout: CONNECTION_LOCK_TIMEOUT_MS,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /* Fresh clones of the migrated tables, indexes included. */
  async function cloneMigratedTables(): Promise<void> {
    await database.query(`DROP TABLE IF EXISTS "${schema}"."LlmLog"`);
    await database.query(`DROP TABLE IF EXISTS "${schema}"."AIRun"`);
    await database.query(
      `CREATE TABLE "${schema}"."LlmLog" (LIKE public."LlmLog" INCLUDING ALL)`,
    );
    await database.query(
      `CREATE TABLE "${schema}"."AIRun" (LIKE public."AIRun" INCLUDING ALL)`,
    );
  }

  /* The indexes on exactly ("projectId", "createdAt") of the clone. */
  async function usageIndexes(): Promise<Array<IndexState>> {
    const rows: Array<IndexState> = await database.query(
      `SELECT c.relname AS "name", x.indisvalid AS "isValid",
              pg_get_indexdef(x.indexrelid) AS "definition"
       FROM pg_index x
       JOIN pg_class c ON c.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND t.relname = 'LlmLog'`,
      [schema],
    );
    return rows.filter((index: IndexState): boolean => {
      return USAGE_INDEX_DEFINITION.test(index.definition);
    });
  }

  async function dropUsageIndexes(): Promise<void> {
    for (const index of await usageIndexes()) {
      await database.query(`DROP INDEX "${schema}"."${index.name}"`);
    }
  }

  /*
   * A long-lived install: one busy project with HISTORY_DAYS days of AI Logs
   * (none today), quiet projects over the same days, then today's calls:
   * TODAY_ROWS for the busy project and a few for a quiet one.
   */
  async function seedHistory(): Promise<void> {
    const dayStart: Date = midnightUtc();

    await database.query(
      `INSERT INTO "LlmLog"
         ("_id", "createdAt", "updatedAt", "version", "projectId", "status",
          "feature", "totalTokens", "costInUSDCents", "wasBilled")
       SELECT gen_random_uuid(),
              $2::timestamptz - make_interval(secs => 60 + (g % ($3::int * 86400 - 120))),
              now(), 1, $1::uuid, 'Success',
              CASE WHEN g % 3 = 0 THEN 'AI Incident Investigation' ELSE 'AI Chat' END,
              1000, 5, true
       FROM generate_series(1, $4::int) AS g`,
      [
        busyProjectId.toString(),
        dayStart,
        HISTORY_DAYS,
        HISTORY_DAYS * BUSY_PROJECT_ROWS_PER_DAY,
      ],
    );

    await database.query(
      `INSERT INTO "LlmLog"
         ("_id", "createdAt", "updatedAt", "version", "projectId", "status",
          "feature", "totalTokens", "costInUSDCents", "wasBilled")
       SELECT gen_random_uuid(),
              $1::timestamptz - make_interval(secs => 60 + ((g::bigint * 6481) % ($2::int * 86400 - 120))),
              now(), 1,
              ('22222222-2222-4222-8222-' || lpad(((g % $3::int) + 1)::text, 12, '0'))::uuid,
              'Success', 'AI Chat', 800, 3, false
       FROM generate_series(1, $4::int) AS g`,
      [
        dayStart,
        HISTORY_DAYS,
        QUIET_PROJECTS,
        QUIET_PROJECTS * QUIET_PROJECT_ROWS,
      ],
    );

    // Today: chat and incident and alert investigation calls of the busy project.
    await database.query(
      `INSERT INTO "LlmLog"
         ("_id", "createdAt", "updatedAt", "version", "projectId", "status",
          "feature", "totalTokens", "costInUSDCents", "wasBilled",
          "incidentId", "alertId")
       SELECT gen_random_uuid(), $2::timestamptz + make_interval(secs => g),
              now(), 1, $1::uuid, 'Success',
              CASE g % 3 WHEN 0 THEN 'AI Incident Investigation'
                         WHEN 1 THEN 'AI Alert Investigation'
                         ELSE 'AI Chat' END,
              100 * g, g, (g % 2 = 0),
              CASE WHEN g % 3 = 0 THEN $4::uuid END,
              CASE WHEN g % 3 = 1 THEN $5::uuid END
       FROM generate_series(1, $3::int) AS g`,
      [busyProjectId.toString(), dayStart, TODAY_ROWS, incidentId, alertId],
    );

    await database.query(
      `INSERT INTO "LlmLog"
         ("_id", "createdAt", "updatedAt", "version", "projectId", "status",
          "feature", "totalTokens", "costInUSDCents", "wasBilled")
       SELECT gen_random_uuid(), $2::timestamptz + make_interval(secs => g),
              now(), 1, $1::uuid, 'Success', 'AI Chat', 50, 1, true
       FROM generate_series(1, 3) AS g`,
      [quietProjectId.toString(), dayStart],
    );

    await database.query(`ANALYZE "LlmLog"`);
    await database.query(`ANALYZE "AIRun"`);
  }

  /*
   * Points LlmLogService at the clone and records each statement it runs,
   * with its parameters, exactly as the service sent them.
   */
  function captureServiceQueries(): Array<CapturedQuery> {
    const captured: Array<CapturedQuery> = [];

    jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<unknown> => {
          captured.push({ sql, params });
          return await database.query(sql, params);
        },
      },
    } as unknown as ReturnType<typeof LlmLogService.getRepository>);

    return captured;
  }

  /* The plan Postgres executes for a captured statement, with its values. */
  async function executedPlan(query: CapturedQuery): Promise<PlanNode> {
    const rows: Array<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }> =
      await database.query(
        `EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`,
        query.params,
      );
    return rows[0]!["QUERY PLAN"][0]!.Plan;
  }

  /* The scan nodes that read LlmLog itself (not AIRun). */
  function llmLogScans(plan: PlanNode): Array<PlanNode> {
    return flatten(plan).filter((node: PlanNode): boolean => {
      return node["Relation Name"] === "LlmLog";
    });
  }

  /*
   * The statement reads LlmLog through an index bounded on the project AND
   * the time, and visits no more rows than today's.
   */
  async function expectReadsTodayThroughTheIndex(
    query: CapturedQuery,
    todayRows: number,
  ): Promise<void> {
    const plan: PlanNode = await executedPlan(query);
    const scans: Array<PlanNode> = llmLogScans(plan);

    expect(scans.length).toBeGreaterThan(0);

    for (const scan of scans) {
      /*
       * An index scan reads the rows its condition bounds, a bitmap heap scan
       * the rows its bitmap index scan child found.
       */
      const boundedBy: Array<PlanNode> =
        scan["Node Type"] === "Bitmap Heap Scan"
          ? flatten(scan).filter((node: PlanNode): boolean => {
              return node["Node Type"] === "Bitmap Index Scan";
            })
          : [scan];

      for (const node of boundedBy) {
        expect(node["Node Type"]).toMatch(/Index/);
        expect(node["Index Cond"]).toContain(`"projectId" = `);
        expect(node["Index Cond"]).toContain(`"createdAt" >= `);
      }

      expect(rowsVisited(scan)).toBeLessThanOrEqual(todayRows);
    }
  }

  describe("the migrated LlmLog", () => {
    beforeAll(async () => {
      await cloneMigratedTables();
      await seedHistory();
    });

    test("has the index on (projectId, createdAt), valid", async () => {
      expect(await usageIndexes()).toEqual([
        expect.objectContaining({ isValid: true }),
      ]);
    });

    test("a project's AI usage today is summed from today's rows only, through it", async () => {
      const captured: Array<CapturedQuery> = captureServiceQueries();

      await LlmLogService.getProjectUsageSince({
        projectId: busyProjectId,
        since: midnightUtc(),
      });

      expect(captured).toHaveLength(1);
      await expectReadsTodayThroughTheIndex(captured[0]!, TODAY_ROWS);
    });

    test("so is a quiet project's, which never reads its own history either", async () => {
      const captured: Array<CapturedQuery> = captureServiceQueries();

      await LlmLogService.getProjectUsageSince({
        projectId: quietProjectId,
        since: midnightUtc(),
      });

      await expectReadsTodayThroughTheIndex(captured[0]!, 3);
    });

    test("every lane of the incident and alert daily token limits reads through it too", async () => {
      const captured: Array<CapturedQuery> = captureServiceQueries();
      const lane: {
        projectId: ObjectID;
        since: Date;
        features: Array<string>;
        legacyIncidentFeatures: Array<string>;
        legacyAlertFeatures: Array<string>;
      } = {
        projectId: busyProjectId,
        since: midnightUtc(),
        features: [
          "AI Incident Investigation",
          "AI Alert Investigation",
          "AI Chat",
        ],
        legacyIncidentFeatures: ["AI Incident Investigation"],
        legacyAlertFeatures: ["AI Alert Investigation"],
      };

      await LlmLogService.getTotalTokensUsedSince({
        ...lane,
        incidentId: new ObjectID(incidentId),
      });
      await LlmLogService.getTotalTokensUsedSince({
        ...lane,
        alertId: new ObjectID(alertId),
      });
      await LlmLogService.getTotalTokensUsedSince(lane);

      expect(captured).toHaveLength(3);

      for (const query of captured) {
        await expectReadsTodayThroughTheIndex(query, TODAY_ROWS);
      }
    });

    test("the sums count today's rows of that project only, and spend only where billed", async () => {
      captureServiceQueries();

      // Today's busy rows: g = 1..12, tokens 100 * g, cost g, billed when g is even.
      expect(
        await LlmLogService.getProjectUsageSince({
          projectId: busyProjectId,
          since: midnightUtc(),
        }),
      ).toEqual({
        totalTokens: 100 * ((TODAY_ROWS * (TODAY_ROWS + 1)) / 2),
        billedCostInUSDCents: 2 + 4 + 6 + 8 + 10 + 12,
      });

      expect(
        await LlmLogService.getProjectUsageSince({
          projectId: quietProjectId,
          since: midnightUtc(),
        }),
      ).toEqual({ totalTokens: 150, billedCostInUSDCents: 3 });

      expect(
        await LlmLogService.getProjectUsageSince({
          projectId: ObjectID.generate(),
          since: midnightUtc(),
        }),
      ).toEqual({ totalTokens: 0, billedCostInUSDCents: 0 });
    });

    test("without the index the same sum reads the project's whole history", async () => {
      /*
       * What every install read before migration 1798300000000. Proves the
       * seed is large enough for the assertions above to mean something:
       * once the index is gone, Postgres reads every row the project ever
       * logged (or the whole table) to sum today's.
       */
      await dropUsageIndexes();
      await database.query(`ANALYZE "LlmLog"`);

      try {
        const captured: Array<CapturedQuery> = captureServiceQueries();

        await LlmLogService.getProjectUsageSince({
          projectId: busyProjectId,
          since: midnightUtc(),
        });

        const scans: Array<PlanNode> = llmLogScans(
          await executedPlan(captured[0]!),
        );
        const visited: number = scans.reduce(
          (total: number, scan: PlanNode): number => {
            return total + rowsVisited(scan);
          },
          0,
        );

        expect(visited).toBeGreaterThanOrEqual(
          HISTORY_DAYS * BUSY_PROJECT_ROWS_PER_DAY,
        );
      } finally {
        await cloneMigratedTables();
        await seedHistory();
      }
    });
  });

  describe("migration 1798300000000", () => {
    beforeEach(async () => {
      await cloneMigratedTables();
      await dropUsageIndexes();
      await database.query(
        `INSERT INTO "LlmLog"
           ("_id", "createdAt", "updatedAt", "version", "projectId", "status",
            "totalTokens", "costInUSDCents", "wasBilled")
         SELECT gen_random_uuid(), now() - make_interval(mins => g), now(), 1,
                $1::uuid, 'Success', 10, 0, false
         FROM generate_series(1, 50) AS g`,
        [busyProjectId.toString()],
      );
    });

    interface Run {
      statements: Array<string>;
      // The connection's settings right after up() returned.
      statementTimeout: string;
      lockTimeout: string;
    }

    /*
     * Runs up() as TypeORM runs a migration whose `transaction` is false: on
     * one connection, outside any transaction. Every statement that reaches
     * the driver is recorded - TypeORM's and the build the migration sends
     * itself.
     */
    async function runUp(
      migration: AddLlmLogProjectCreatedAtIndex1798300000000 = new AddLlmLogProjectCreatedAtIndex1798300000000(),
    ): Promise<Run> {
      const queryRunner: QueryRunner = database.createQueryRunner();
      const client: {
        query: (...args: Array<unknown>) => Promise<unknown>;
      } = await queryRunner.connect();
      const statements: Array<string> = [];
      const query: (...args: Array<unknown>) => Promise<unknown> =
        client.query.bind(client);

      client.query = (...args: Array<unknown>): Promise<unknown> => {
        const statement: unknown = args[0];
        statements.push(
          (typeof statement === "string"
            ? statement
            : String((statement as { text: string }).text)
          )
            .replace(/\s+/g, " ")
            .trim(),
        );
        return query(...args);
      };

      try {
        await migration.up(queryRunner);
        const settings: Array<{ statement: string; lock: string }> =
          await queryRunner.query(
            `SELECT current_setting('statement_timeout') AS "statement",
                    current_setting('lock_timeout') AS "lock"`,
          );
        return {
          statements,
          statementTimeout: settings[0]!.statement,
          lockTimeout: settings[0]!.lock,
        };
      } finally {
        client.query = query;
        await queryRunner.release();
      }
    }

    function indexDdl(run: Run): Array<string> {
      return run.statements.filter((statement: string): boolean => {
        return INDEX_DDL.test(statement);
      });
    }

    function silenceLogs(): {
      warn: SpyInstance<typeof logger.warn>;
      info: SpyInstance<typeof logger.info>;
    } {
      return {
        warn: jest.spyOn(logger, "warn").mockImplementation((): void => {
          return undefined;
        }),
        info: jest.spyOn(logger, "info").mockImplementation((): void => {
          return undefined;
        }),
      };
    }

    test("TypeORM's runner applies it outside a transaction, reverts it, and applies it again", async () => {
      silenceLogs();
      const runner: DataSource = new DataSource({
        type: "postgres",
        host:
          process.env["LLM_LOG_USAGE_INDEX_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["LLM_LOG_USAGE_INDEX_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["LLM_LOG_USAGE_INDEX_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: [],
        schema,
        synchronize: false,
        migrations: [AddLlmLogProjectCreatedAtIndex1798300000000],
        migrationsTableName: "llm_log_usage_index_migrations",
        // The app's own mode (DataSourceOptions): one transaction per migration.
        migrationsTransactionMode: "each",
        extra: { options: `-c search_path=${schema}` },
      });
      await runner.initialize();

      try {
        // CREATE INDEX CONCURRENTLY inside a transaction would throw here.
        const applied: Array<{ name: string }> = await runner.runMigrations();
        expect(
          applied.map((migration: { name: string }): string => {
            return migration.name;
          }),
        ).toEqual(["AddLlmLogProjectCreatedAtIndex1798300000000"]);
        expect(await usageIndexes()).toEqual([
          {
            name: LLM_LOG_PROJECT_CREATED_AT_INDEX,
            isValid: true,
            definition: expect.stringMatching(
              /^CREATE INDEX "IDX_LLM_LOG_PROJECT_CREATED_AT" ON .*"LlmLog" USING btree \("projectId", "createdAt"\)$/,
            ),
          },
        ]);

        // Already applied: nothing runs again.
        expect(await runner.runMigrations()).toEqual([]);

        // TypeORM reverts inside a transaction; down() drops it there.
        await runner.undoLastMigration();
        expect(await usageIndexes()).toEqual([]);

        expect(await runner.runMigrations()).toHaveLength(1);
        expect(await usageIndexes()).toEqual([
          expect.objectContaining({
            name: LLM_LOG_PROJECT_CREATED_AT_INDEX,
            isValid: true,
          }),
        ]);
      } finally {
        await runner.destroy();
      }
    });

    test("it builds the index online and leaves the connection's own timeouts behind", async () => {
      const { info } = silenceLogs();
      const run: Run = await runUp();

      expect(indexDdl(run)).toEqual([LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD]);
      expect(run.statements).toContain(
        `SET statement_timeout = ${LLM_LOG_INDEX_BUILD_LIMITS.buildTimeoutInMs}`,
      );
      expect(run.statements).toContain(
        `SET lock_timeout = ${LLM_LOG_INDEX_BUILD_LIMITS.lockWaitTimeoutInMs}`,
      );
      expect(run.statementTimeout).toBe(`${CONNECTION_STATEMENT_TIMEOUT_MS}ms`);
      expect(run.lockTimeout).toBe(`${CONNECTION_LOCK_TIMEOUT_MS}ms`);
      expect(await usageIndexes()).toEqual([
        expect.objectContaining({
          name: LLM_LOG_PROJECT_CREATED_AT_INDEX,
          isValid: true,
        }),
      ]);
      expect(String(info.mock.calls[0]?.[0])).toContain("online");
    });

    test("an index an operator built ahead of the upgrade is left as it is", async () => {
      const { warn } = silenceLogs();
      await database.query(LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD);

      const run: Run = await runUp();

      expect(indexDdl(run)).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
      expect(await usageIndexes()).toEqual([
        expect.objectContaining({
          name: LLM_LOG_PROJECT_CREATED_AT_INDEX,
          isValid: true,
        }),
      ]);
    });

    test("an INVALID copy a stopped online build left is dropped and rebuilt", async () => {
      silenceLogs();
      // Fifty rows share one project: a UNIQUE online build on it fails.
      await expect(
        database.query(
          `CREATE UNIQUE INDEX CONCURRENTLY "${LLM_LOG_PROJECT_CREATED_AT_INDEX}" ON "LlmLog" ("projectId")`,
        ),
      ).rejects.toThrow();
      const leftover: Array<{ isValid: boolean }> = await database.query(
        `SELECT x.indisvalid AS "isValid" FROM pg_index x
         JOIN pg_class c ON c.oid = x.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = $1 AND n.nspname = $2`,
        [LLM_LOG_PROJECT_CREATED_AT_INDEX, schema],
      );
      expect(leftover).toEqual([{ isValid: false }]);

      const run: Run = await runUp();

      expect(indexDdl(run)).toEqual([
        LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP,
        LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
      ]);
      expect(await usageIndexes()).toEqual([
        expect.objectContaining({
          name: LLM_LOG_PROJECT_CREATED_AT_INDEX,
          isValid: true,
        }),
      ]);
    });

    /*
     * An online build still running is INVALID until it finishes. Dropping
     * it would wait behind it, so the migration leaves it alone and returns
     * at once.
     */
    test("an online build still in progress is left to finish, never dropped", async () => {
      const writer: QueryRunner = database.createQueryRunner();
      const builder: QueryRunner = database.createQueryRunner();
      await writer.connect();
      await builder.connect();

      try {
        // An open writer makes the online build wait with its index INVALID.
        await writer.startTransaction();
        await writer.query(
          `INSERT INTO "LlmLog" ("_id", "createdAt", "updatedAt", "version",
             "projectId", "status") VALUES (gen_random_uuid(), now(), now(), 1, $1::uuid, 'Success')`,
          [busyProjectId.toString()],
        );
        const build: Promise<unknown> = builder.query(
          LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
        );

        let inProgress: boolean = false;
        for (let attempt: number = 0; attempt < 50 && !inProgress; attempt++) {
          const rows: Array<unknown> = await database.query(
            `SELECT 1 FROM pg_stat_progress_create_index p
             JOIN pg_class c ON c.oid = p.index_relid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relname = $1 AND n.nspname = $2`,
            [LLM_LOG_PROJECT_CREATED_AT_INDEX, schema],
          );
          inProgress = rows.length > 0;
          if (!inProgress) {
            await new Promise<void>((resolve: () => void): void => {
              setTimeout(resolve, 100);
            });
          }
        }
        expect(inProgress).toBe(true);

        const { warn } = silenceLogs();
        const startedAt: number = Date.now();
        const run: Run = await runUp();

        expect(Date.now() - startedAt).toBeLessThan(3_000);
        expect(indexDdl(run)).toEqual([]);
        expect(String(warn.mock.calls[0]?.[0])).toContain("in progress");

        await writer.commitTransaction();
        await build;
        expect(await usageIndexes()).toEqual([
          expect.objectContaining({
            name: LLM_LOG_PROJECT_CREATED_AT_INDEX,
            isValid: true,
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

    /*
     * An online build waits out every transaction older than it - a backup
     * holding its snapshot for an hour, say. Past the lock wait bound it
     * stops; the migration drops what it left, says how to build the index
     * by hand, and completes: the deploy never fails over an index.
     */
    test("a build held up past its wait bound leaves no INVALID index, warns with the runbook, and completes", async () => {
      const holder: QueryRunner = database.createQueryRunner();
      await holder.connect();

      try {
        // A snapshot older than the build, on a table the build never locks.
        await holder.query(
          `BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT count(*) FROM "AIRun";`,
        );

        const { warn } = silenceLogs();
        const run: Run = await runUp(
          new AddLlmLogProjectCreatedAtIndex1798300000000({
            ...LLM_LOG_INDEX_BUILD_LIMITS,
            lockWaitTimeoutInMs: 300,
          }),
        );

        expect(indexDdl(run)).toEqual([
          LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
          LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP,
        ]);
        expect(await usageIndexes()).toEqual([]);
        const message: string = String(warn.mock.calls[0]?.[0]);
        expect(message).toContain("lock timeout");
        expect(message).toContain(`${LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD};`);
        expect(message).not.toContain(LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP);
        // Back to the connection's own, even after a failed build.
        expect(run.statementTimeout).toBe(
          `${CONNECTION_STATEMENT_TIMEOUT_MS}ms`,
        );
        expect(run.lockTimeout).toBe(`${CONNECTION_LOCK_TIMEOUT_MS}ms`);
      } finally {
        await holder.query(`ROLLBACK`);
        await holder.release();
      }

      // The runbook then works as written.
      await database.query(LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD);
      expect(await usageIndexes()).toEqual([
        expect.objectContaining({
          name: LLM_LOG_PROJECT_CREATED_AT_INDEX,
          isValid: true,
        }),
      ]);
    });

    test("a build past its time bound is stopped by Postgres, not left running", async () => {
      const holder: QueryRunner = database.createQueryRunner();
      await holder.connect();

      try {
        await holder.query(
          `BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT count(*) FROM "AIRun";`,
        );

        const { warn } = silenceLogs();
        const run: Run = await runUp(
          new AddLlmLogProjectCreatedAtIndex1798300000000({
            ...LLM_LOG_INDEX_BUILD_LIMITS,
            buildTimeoutInMs: 500,
            clientTimeoutMarginInMs: 10_000,
          }),
        );

        expect(String(warn.mock.calls[0]?.[0])).toContain("statement timeout");
        expect(await usageIndexes()).toEqual([]);
        const builds: Array<unknown> = await database.query(
          `SELECT 1 FROM pg_stat_progress_create_index p
           JOIN pg_class c ON c.oid = p.relid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1`,
          [schema],
        );
        expect(builds).toEqual([]);
        expect(run.statementTimeout).toBe(
          `${CONNECTION_STATEMENT_TIMEOUT_MS}ms`,
        );
      } finally {
        await holder.query(`ROLLBACK`);
        await holder.release();
      }
    });

    test("down() outside a transaction drops it online", async () => {
      silenceLogs();
      await runUp();
      expect(await usageIndexes()).toHaveLength(1);

      const queryRunner: QueryRunner = database.createQueryRunner();
      await queryRunner.connect();
      try {
        await new AddLlmLogProjectCreatedAtIndex1798300000000().down(
          queryRunner,
        );
      } finally {
        await queryRunner.release();
      }

      expect(await usageIndexes()).toEqual([]);
    });
  });
});
