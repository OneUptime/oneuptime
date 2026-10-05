import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";
import { QueryRunner } from "typeorm";
import { PostgresQueryTimeoutMs } from "../../../../Server/EnvironmentConfig";
import {
  AddLlmLogProjectCreatedAtIndex1798300000000,
  LLM_LOG_INDEX_BUILD_LIMITS,
  LLM_LOG_PROJECT_CREATED_AT_INDEX,
  LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
  LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1798300000000-AddLlmLogProjectCreatedAtIndex";
import { AddProjectAiDailyLimits1798200000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1798200000000-AddProjectAiDailyLimits";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import logger from "../../../../Server/Utils/Logger";

/*
 * The migration that gives LlmLog ("projectId", "createdAt"), so the daily AI
 * limits sum today's AI Logs instead of a project's whole history.
 *
 * It is an ONLINE build (CREATE INDEX CONCURRENTLY), so it runs outside a
 * transaction, bounds how long it may build and wait, puts the connection's
 * own settings back, and never fails the deploy over an index: a build that
 * stops leaves no INVALID copy behind and logs how to build it by hand.
 *
 * Its statements are EXECUTED here against a fake QueryRunner whose catalog
 * answers what Postgres would (no index, a valid one, an INVALID leftover, a
 * build in progress), so every branch is pinned statement by statement.
 * LlmLogDailyUsageIndexPostgres.test.ts runs the same branches on Postgres,
 * through TypeORM's own migration runner. The CREATE statement is what
 * `npm run generate-postgres-migration` generated for the index, made online.
 */

const MIGRATION_TIMESTAMP: string = "1798300000000";
const MIGRATION_BASE_NAME: string = "AddLlmLogProjectCreatedAtIndex";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);
const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

/* What TypeORM generated for @Index("IDX_LLM_LOG_PROJECT_CREATED_AT", ...). */
const GENERATED_CREATE: string = `CREATE INDEX "IDX_LLM_LOG_PROJECT_CREATED_AT" ON "LlmLog" ("projectId", "createdAt")`;

/* The catalog lookup, as recorded below. */
const LOOKUP: string = "<lookup>";

const LIMITS: typeof LLM_LOG_INDEX_BUILD_LIMITS = LLM_LOG_INDEX_BUILD_LIMITS;

const BUILD_BOUNDS: Array<string> = [
  `SET statement_timeout = ${LIMITS.buildTimeoutInMs}`,
  `SET lock_timeout = ${LIMITS.lockWaitTimeoutInMs}`,
];

const RESTORE: Array<string> = [
  `SET statement_timeout = DEFAULT`,
  `SET lock_timeout = DEFAULT`,
];

const DROP_LEFTOVER: Array<string> = [
  `SET lock_timeout = ${LIMITS.leftoverDropLockWaitTimeoutInMs}`,
  LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP,
  `SET lock_timeout = DEFAULT`,
];

type IndexState = "missing" | "valid" | "invalid" | "building";

interface FakeDatabase {
  // What the catalog shows when up() starts.
  state: IndexState;
  inTransaction?: boolean;
  // Why the build stops, and what it leaves (INVALID unless said otherwise).
  buildError?: Error;
  stateAfterFailedBuild?: IndexState;
  connectError?: Error;
  dropError?: Error;
}

interface FakeRun {
  runner: QueryRunner;
  statements: Array<string>;
  builds: Array<{ text: string; query_timeout: number }>;
}

function fakeDatabase(database: FakeDatabase): FakeRun {
  let state: IndexState = database.state;
  const statements: Array<string> = [];
  const builds: Array<{ text: string; query_timeout: number }> = [];

  const runner: QueryRunner = {
    isTransactionActive: database.inTransaction === true,
    query: async (
      sql: string,
      params?: Array<unknown>,
    ): Promise<Array<{ isValid: boolean; isBuilding: boolean }>> => {
      const statement: string = sql.replace(/\s+/g, " ").trim();

      if (statement.includes("FROM pg_index")) {
        expect(params).toEqual([LLM_LOG_PROJECT_CREATED_AT_INDEX]);
        expect(statement).toContain("pg_stat_progress_create_index");
        // The LlmLog the build names, resolved the way the build resolves it.
        expect(statement).toContain(`x.indrelid = to_regclass('"LlmLog"')`);
        statements.push(LOOKUP);
        return state === "missing"
          ? []
          : [{ isValid: state === "valid", isBuilding: state === "building" }];
      }

      statements.push(statement);

      if (statement === LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP) {
        if (database.dropError) {
          throw database.dropError;
        }
        state = "missing";
      }

      return [];
    },
    connect: async (): Promise<unknown> => {
      if (database.connectError) {
        throw database.connectError;
      }

      return {
        query: async (config: {
          text: string;
          query_timeout: number;
        }): Promise<unknown> => {
          statements.push(config.text);
          builds.push(config);

          if (database.buildError) {
            state = database.stateAfterFailedBuild || "invalid";
            throw database.buildError;
          }

          state = "valid";
          return { rows: [] };
        },
      };
    },
  } as unknown as QueryRunner;

  return { runner, statements, builds };
}

type WarnSpy = SpyInstance<typeof logger.warn>;
type InfoSpy = SpyInstance<typeof logger.info>;

function spyOnLogs(): { warn: WarnSpy; info: InfoSpy } {
  return {
    warn: jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    }),
    info: jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    }),
  };
}

async function up(database: FakeDatabase): Promise<FakeRun> {
  const run: FakeRun = fakeDatabase(database);
  await new AddLlmLogProjectCreatedAtIndex1798300000000().up(run.runner);
  return run;
}

/* The one warning that tells the operator what happened. */
function lastWarning(warn: WarnSpy): string {
  const calls: Array<Array<unknown>> = warn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return String(calls[calls.length - 1]![0]);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the statements", () => {
  test("the build is the generated CREATE INDEX, made online and idempotent", () => {
    expect(LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD).toBe(
      GENERATED_CREATE.replace(
        "CREATE INDEX",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS",
      ),
    );
  });

  test("the leftover drop is online and idempotent, on the same name", () => {
    expect(LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP).toBe(
      `DROP INDEX CONCURRENTLY IF EXISTS "${LLM_LOG_PROJECT_CREATED_AT_INDEX}"`,
    );
    expect(LLM_LOG_PROJECT_CREATED_AT_INDEX).toBe(
      "IDX_LLM_LOG_PROJECT_CREATED_AT",
    );
  });

  test("the build may outlast any app statement, and Postgres ends it before the client stops waiting", () => {
    /*
     * The connection's client-side deadline (DATABASE_QUERY_TIMEOUT_MS) would
     * otherwise cut a large table's build short and leave the server
     * building after the deploy moved on.
     */
    expect(LIMITS.buildTimeoutInMs).toBeGreaterThan(PostgresQueryTimeoutMs);
    expect(LIMITS.clientTimeoutMarginInMs).toBeGreaterThan(0);
    // Waits are bounded well inside the build's own bound.
    expect(LIMITS.lockWaitTimeoutInMs).toBeLessThan(LIMITS.buildTimeoutInMs);
    // Dropping a leftover never parks behind live traffic for long.
    expect(LIMITS.leftoverDropLockWaitTimeoutInMs).toBeLessThanOrEqual(10_000);
  });
});

describe("up()", () => {
  test("TypeORM is told to run it outside a transaction", () => {
    // CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
    expect(new AddLlmLogProjectCreatedAtIndex1798300000000().transaction).toBe(
      false,
    );
  });

  test("refuses to run inside a transaction, before touching anything", async () => {
    const run: FakeRun = fakeDatabase({
      state: "missing",
      inTransaction: true,
    });

    await expect(
      new AddLlmLogProjectCreatedAtIndex1798300000000().up(run.runner),
    ).rejects.toThrow("outside");
    expect(run.statements).toEqual([]);
  });

  test("without the index: builds it online within its bounds, then puts the connection's settings back", async () => {
    const { warn, info } = spyOnLogs();
    const run: FakeRun = await up({ state: "missing" });

    expect(run.statements).toEqual([
      LOOKUP,
      ...BUILD_BOUNDS,
      LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
      ...RESTORE,
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(String(info.mock.calls[0]?.[0])).toContain("online");
  });

  test("the build carries its own client timeout, longer than its server-side bound", async () => {
    spyOnLogs();
    const run: FakeRun = await up({ state: "missing" });

    expect(run.builds).toEqual([
      {
        text: LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
        query_timeout: LIMITS.buildTimeoutInMs + LIMITS.clientTimeoutMarginInMs,
      },
    ]);
    expect(run.builds[0]!.query_timeout).toBeGreaterThan(
      LIMITS.buildTimeoutInMs,
    );
  });

  test("an index already there - built by an operator, or migrated - is left as it is", async () => {
    const { warn, info } = spyOnLogs();
    const run: FakeRun = await up({ state: "valid" });

    expect(run.statements).toEqual([LOOKUP]);
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  test("an online build in progress is left to finish, and the operator told how to redo it if it fails", async () => {
    const { warn } = spyOnLogs();
    const run: FakeRun = await up({ state: "building" });

    expect(run.statements).toEqual([LOOKUP]);
    const message: string = lastWarning(warn);
    expect(message).toContain("in progress");
    expect(message).toContain(
      `${LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP}; ${LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD};`,
    );
  });

  test("an INVALID leftover is dropped online, with a short lock wait, and the index built", async () => {
    const { warn } = spyOnLogs();
    const run: FakeRun = await up({ state: "invalid" });

    expect(run.statements).toEqual([
      LOOKUP,
      ...DROP_LEFTOVER,
      ...BUILD_BOUNDS,
      LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
      ...RESTORE,
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("an INVALID leftover that cannot be dropped: nothing is built, and the runbook drops it first", async () => {
    const { warn } = spyOnLogs();
    const run: FakeRun = await up({
      state: "invalid",
      dropError: new Error("canceling statement due to lock timeout"),
    });

    expect(run.statements).toEqual([LOOKUP, ...DROP_LEFTOVER]);
    expect(run.builds).toEqual([]);
    const message: string = lastWarning(warn);
    expect(message).toContain("was NOT built");
    expect(message).toContain(
      `${LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP}; ${LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD};`,
    );
  });

  test("a build that stops leaves no INVALID copy, puts the settings back, and says how to build it", async () => {
    const { warn } = spyOnLogs();
    const run: FakeRun = await up({
      state: "missing",
      buildError: new Error("canceling statement due to lock timeout"),
    });

    expect(run.statements).toEqual([
      LOOKUP,
      ...BUILD_BOUNDS,
      LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
      ...RESTORE,
      LOOKUP,
      ...DROP_LEFTOVER,
    ]);
    const message: string = lastWarning(warn);
    expect(message).toContain("canceling statement due to lock timeout");
    expect(message).toContain("NOT created");
    expect(message).toContain(`${LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD};`);
    // Dropped already: the runbook is the build alone.
    expect(message).not.toContain(LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP);
  });

  test("a stopped build whose leftover cannot be dropped: the runbook drops it first", async () => {
    const { warn } = spyOnLogs();
    await up({
      state: "missing",
      buildError: new Error("canceling statement due to statement timeout"),
      dropError: new Error("canceling statement due to lock timeout"),
    });

    const message: string = lastWarning(warn);
    expect(message).toContain("canceling statement due to statement timeout");
    expect(message).toContain(
      `${LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP}; ${LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD};`,
    );
  });

  test("the client stopped waiting but the build finished: nothing is dropped or reported", async () => {
    const { warn } = spyOnLogs();
    const run: FakeRun = await up({
      state: "missing",
      buildError: new Error("Query read timeout"),
      stateAfterFailedBuild: "valid",
    });

    expect(run.statements).toEqual([
      LOOKUP,
      ...BUILD_BOUNDS,
      LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
      ...RESTORE,
      LOOKUP,
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("the client stopped waiting while the build still runs: it is never dropped", async () => {
    const { warn } = spyOnLogs();
    const run: FakeRun = await up({
      state: "missing",
      buildError: new Error("Query read timeout"),
      stateAfterFailedBuild: "building",
    });

    expect(run.statements).not.toContain(LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP);
    expect(lastWarning(warn)).toContain(
      `${LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP}; ${LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD};`,
    );
  });

  test("no connection for the build: the settings still go back", async () => {
    const { warn } = spyOnLogs();
    const run: FakeRun = await up({
      state: "missing",
      connectError: new Error("Connection terminated"),
    });

    expect(run.statements).toEqual([
      LOOKUP,
      ...BUILD_BOUNDS,
      ...RESTORE,
      LOOKUP,
    ]);
    expect(lastWarning(warn)).toContain("Connection terminated");
  });

  test("whatever stops the build, the deploy does not fail over the index", async () => {
    spyOnLogs();
    const failures: Array<FakeDatabase> = [
      { state: "missing", buildError: new Error("lock timeout") },
      {
        state: "missing",
        buildError: new Error("statement timeout"),
        dropError: new Error("lock timeout"),
      },
      { state: "invalid", dropError: new Error("lock timeout") },
      { state: "building" },
      { state: "missing", connectError: new Error("gone") },
    ];

    for (const failure of failures) {
      const run: FakeRun = fakeDatabase(failure);
      await expect(
        new AddLlmLogProjectCreatedAtIndex1798300000000().up(run.runner),
      ).resolves.toBeUndefined();
    }
  });
});

describe("down()", () => {
  async function down(inTransaction: boolean): Promise<Array<string>> {
    const run: FakeRun = fakeDatabase({ state: "valid", inTransaction });
    await new AddLlmLogProjectCreatedAtIndex1798300000000().down(run.runner);
    return run.statements;
  }

  test("inside TypeORM's revert transaction: a plain DROP that waits at most five seconds for its lock", async () => {
    expect(await down(true)).toEqual([
      `SET LOCAL lock_timeout = '5s'`,
      `DROP INDEX IF EXISTS "${LLM_LOG_PROJECT_CREATED_AT_INDEX}"`,
    ]);
  });

  test("outside a transaction: dropped online", async () => {
    expect(await down(false)).toEqual([LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP]);
  });
});

describe("the migration runs", () => {
  test("it is imported and listed in Index.ts", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${MIGRATION_CLASS_NAME} } from "./${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}";`,
    );
    expect(index).toContain(`  ${MIGRATION_CLASS_NAME},\n`);
  });

  test("it is in the exported migration list, exactly once", () => {
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddLlmLogProjectCreatedAtIndex1798300000000;
      }),
    ).toHaveLength(1);
  });

  test("it runs after the project daily limits whose sum it serves", () => {
    expect(
      SchemaMigrations.indexOf(AddLlmLogProjectCreatedAtIndex1798300000000),
    ).toBeGreaterThan(
      SchemaMigrations.indexOf(AddProjectAiDailyLimits1798200000000),
    );
  });

  /*
   * TypeORM records applied migrations by `name`; a mismatch would run it
   * again on every boot.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddLlmLogProjectCreatedAtIndex1798300000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddLlmLogProjectCreatedAtIndex1798300000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddLlmLogProjectCreatedAtIndex1798300000000.name.match(
        CLASS_TIMESTAMP,
      )?.[1],
    ).toBe(MIGRATION_TIMESTAMP);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const matching: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      });

    expect(matching).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddLlmLogProjectCreatedAtIndex1798300000000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlierTimestamps: Array<number> = [];

    for (const migrationClass of SchemaMigrations.slice(0, position)) {
      const match: RegExpMatchArray | null = (
        migrationClass as { name: string }
      ).name.match(CLASS_TIMESTAMP);

      if (match) {
        earlierTimestamps.push(Number(match[1]));
      }
    }

    // Math.max() of an empty list is -Infinity; prove the list was read.
    expect(earlierTimestamps.length).toBeGreaterThan(100);

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(...earlierTimestamps),
    );
  });
});
