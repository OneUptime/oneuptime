import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * The Postgres connection deadlines.
 *
 * `lock_timeout` was missing entirely, and its absence is what let the row-lock
 * convoy run for hours. It is a distinct thing from `statement_timeout`: the
 * latter caps how long a statement RUNS, the former caps how long it WAITS for
 * a lock. Without it, contention on a hot row degrades into a strictly-ordered
 * queue in which every waiter pins a backend for the sum of everyone ahead of
 * it — 892 connections parked on locks with a 3.7-hour tail, on a database that
 * was never short of capacity.
 *
 * Two subtleties this suite pins, both of which are easy to get wrong and
 * silent when wrong:
 *
 *  1. The app pool of a MIGRATING process is exempt. App/Migrate.ts loads
 *     these same options and connects directly to the backend, where startup
 *     parameters really do apply, and its data migrations run on that pool,
 *     free to wait for row locks. Its SCHEMA migrations do not: they run on a
 *     connection of their own (SchemaMigrationRunner) with a shorter bound,
 *     DATABASE_MIGRATION_LOCK_TIMEOUT_MS, and a migration that runs out is
 *     rolled back and retried. Unbounded, a DDL statement waiting for a lock
 *     queued every query on its table behind itself - 14.0.13's ALTER TABLE
 *     on "Monitor" stopped monitoring that way.
 *
 *  2. The deadlines must be ORDERED so the server wins. The client-side
 *     `query_timeout` does not cancel anything — it abandons the query while
 *     the backend keeps running and keeps its place in the lock queue. That is
 *     how killed and scaled-down workers left orphaned statements holding the
 *     queue through pgbouncer. It used to be set equal to statement_timeout,
 *     and since the client timer starts before the packet reaches the backend,
 *     the client always won by a round trip and the server-side timeout never
 *     fired at all.
 *
 * The module reads env at import time, so each case re-imports it in isolation.
 */

interface DataSourceExtra {
  lock_timeout?: number;
  statement_timeout?: number;
  query_timeout?: number;
  idle_in_transaction_session_timeout?: number;
}

/* Runs `load` on fresh module instances, with `env` set for its duration. */
function withEnv(
  env: Record<string, string | undefined>,
  load: () => void,
): void {
  jest.isolateModules(() => {
    const previous: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(env)) {
      previous[key] = process.env[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    try {
      load();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
}

function loadExtra(env: Record<string, string | undefined>): DataSourceExtra {
  let extra: DataSourceExtra = {};

  withEnv(env, () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const options: {
      default: { extra: DataSourceExtra };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
    } = require("../../../Server/Infrastructure/Postgres/DataSourceOptions");
    /* eslint-enable @typescript-eslint/no-var-requires */

    extra = options.default.extra;
  });

  return extra;
}

describe("Postgres connection deadlines", () => {
  describe("lock_timeout", () => {
    test("is applied on runtime pods", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
        DATABASE_LOCK_TIMEOUT_MS: undefined,
      });

      expect(extra.lock_timeout).toBe(3000);
    });

    test("is configurable", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
        DATABASE_LOCK_TIMEOUT_MS: "1500",
      });

      expect(extra.lock_timeout).toBe(1500);
    });

    /*
     * The exemption is load-bearing, not a nicety. A migration that cannot
     * wait for a lock cannot take one on a busy table at all.
     */
    test("is NOT applied when this process runs migrations", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "true",
        DATABASE_LOCK_TIMEOUT_MS: undefined,
      });

      expect(extra.lock_timeout).toBeUndefined();
    });

    test("can be disabled outright with 0", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
        DATABASE_LOCK_TIMEOUT_MS: "0",
      });

      expect(extra.lock_timeout).toBeUndefined();
    });
  });

  describe("deadline ordering", () => {
    /*
     * lock_timeout < statement_timeout, so a lock wait surfaces as
     * `lock_not_available` rather than a generic statement timeout. The two
     * want very different handling: one is contention worth retrying, the
     * other is a query that needs fixing.
     */
    test("a lock wait gives up well before the statement does", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
      });

      expect(extra.lock_timeout!).toBeLessThan(extra.statement_timeout!);
    });

    /*
     * statement_timeout < query_timeout, so the SERVER cancels first. If the
     * client wins, the statement is only abandoned — the backend keeps
     * running, keeps its lock, and keeps its place in the queue.
     */
    test("the server cancels before the client gives up", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
      });

      expect(extra.statement_timeout!).toBeLessThan(extra.query_timeout!);
    });

    test("an explicitly configured query_timeout is still honoured", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
        DATABASE_QUERY_TIMEOUT_MS: "45000",
      });

      expect(extra.query_timeout).toBe(45000);
    });

    test("the default query_timeout tracks a raised statement_timeout", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
        DATABASE_STATEMENT_TIMEOUT_MS: "60000",
        DATABASE_QUERY_TIMEOUT_MS: undefined,
      });

      expect(extra.statement_timeout).toBe(60000);
      expect(extra.query_timeout!).toBeGreaterThan(60000);
    });
  });

  describe("schema migrations", () => {
    interface MigrationConnection {
      appExtra: DataSourceExtra;
      migrationExtra: DataSourceExtra;
      lockTimeoutInMs: number;
      retryTimeoutInMs: number;
      appLockTimeoutInMs: number;
    }

    function loadMigrationConnection(
      env: Record<string, string | undefined>,
    ): MigrationConnection {
      let loaded: MigrationConnection | null = null;

      withEnv(env, () => {
        /* eslint-disable @typescript-eslint/no-var-requires */
        const options: {
          default: { extra: DataSourceExtra };
          // eslint-disable-next-line @typescript-eslint/no-require-imports
        } = require("../../../Server/Infrastructure/Postgres/DataSourceOptions");
        const runner: {
          default: {
            getDataSourceOptions: (options: unknown) => {
              extra: DataSourceExtra;
            };
          };
          SCHEMA_MIGRATION_LOCK_POLICY: {
            lockTimeoutInMs: number;
            retryTimeoutInMs: number;
          };
          // eslint-disable-next-line @typescript-eslint/no-require-imports
        } = require("../../../Server/Infrastructure/Postgres/SchemaMigrationRunner");
        const config: {
          PostgresLockTimeoutMs: number;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
        } = require("../../../Server/EnvironmentConfig");
        /* eslint-enable @typescript-eslint/no-var-requires */

        loaded = {
          appExtra: options.default.extra,
          migrationExtra: runner.default.getDataSourceOptions(options.default)
            .extra,
          lockTimeoutInMs: runner.SCHEMA_MIGRATION_LOCK_POLICY.lockTimeoutInMs,
          retryTimeoutInMs:
            runner.SCHEMA_MIGRATION_LOCK_POLICY.retryTimeoutInMs,
          appLockTimeoutInMs: config.PostgresLockTimeoutMs,
        };
      });

      return loaded!;
    }

    const MIGRATING: Record<string, string | undefined> = {
      RUN_DATABASE_MIGRATIONS_ON_BOOT: undefined,
      DATABASE_LOCK_TIMEOUT_MS: undefined,
      DATABASE_MIGRATION_LOCK_TIMEOUT_MS: undefined,
      DATABASE_MIGRATION_LOCK_RETRY_TIMEOUT_MS: undefined,
    };

    // Loading the options loads every entity: once for the defaults.
    let defaults: MigrationConnection;

    beforeAll(() => {
      defaults = loadMigrationConnection(MIGRATING);
    });

    test("run with a 2s lock wait, as a startup parameter of their own connection", () => {
      expect(defaults.migrationExtra.lock_timeout).toBe(2000);
      // The app pool of the same process stays exempt: data migrations.
      expect(defaults.appExtra.lock_timeout).toBeUndefined();
    });

    /*
     * An app query that arrives while a migration waits for its lock queues
     * behind that request. The migration giving up first is what lets the
     * query through - delayed, not failed with its own lock_timeout.
     */
    test("wait less than the app's own queries, so those queued behind them are delayed, not failed", () => {
      expect(defaults.lockTimeoutInMs).toBeLessThan(
        defaults.appLockTimeoutInMs,
      );
      expect(defaults.migrationExtra.lock_timeout!).toBeLessThan(
        defaults.appLockTimeoutInMs,
      );
    });

    test("keep every other deadline of the app pool", () => {
      expect(defaults.migrationExtra.statement_timeout).toBe(
        defaults.appExtra.statement_timeout,
      );
      expect(defaults.migrationExtra.query_timeout).toBe(
        defaults.appExtra.query_timeout,
      );
      expect(defaults.migrationExtra.idle_in_transaction_session_timeout).toBe(
        defaults.appExtra.idle_in_transaction_session_timeout,
      );
    });

    test("a migration is retried for 10 minutes by default", () => {
      expect(defaults.retryTimeoutInMs).toBe(600_000);
    });

    test("the lock wait and the retry window are configurable", () => {
      const connection: MigrationConnection = loadMigrationConnection({
        ...MIGRATING,
        DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "750",
        DATABASE_MIGRATION_LOCK_RETRY_TIMEOUT_MS: "120000",
      });

      expect(connection.migrationExtra.lock_timeout).toBe(750);
      expect(connection.retryTimeoutInMs).toBe(120_000);
    });

    test("0 lets them wait as long as it takes, as before", () => {
      const connection: MigrationConnection = loadMigrationConnection({
        ...MIGRATING,
        DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "0",
      });

      expect(connection.migrationExtra.lock_timeout).toBeUndefined();
    });
  });

  describe("existing deadlines are unchanged", () => {
    test("idle-in-transaction is still bounded", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
      });

      expect(extra.idle_in_transaction_session_timeout).toBe(60000);
    });
  });
});
