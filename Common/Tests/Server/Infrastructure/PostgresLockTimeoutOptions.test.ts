import { describe, expect, test } from "@jest/globals";

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
 *  1. The MIGRATION path must be exempt. App/Migrate.ts loads these same
 *     options and connects directly to the backend, where startup parameters
 *     really do apply. A 3s lock_timeout there would abort ACCESS EXCLUSIVE
 *     DDL against any table with live traffic. Only the two migrations that
 *     set their own `SET LOCAL lock_timeout` expect to fail that way.
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

function loadExtra(env: Record<string, string | undefined>): DataSourceExtra {
  let extra: DataSourceExtra = {};

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
      /* eslint-disable @typescript-eslint/no-var-requires */
      const options: {
        default: { extra: DataSourceExtra };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
      } = require("../../../Server/Infrastructure/Postgres/DataSourceOptions");
      /* eslint-enable @typescript-eslint/no-var-requires */

      extra = options.default.extra;
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

  describe("existing deadlines are unchanged", () => {
    test("idle-in-transaction is still bounded", () => {
      const extra: DataSourceExtra = loadExtra({
        RUN_DATABASE_MIGRATIONS_ON_BOOT: "false",
      });

      expect(extra.idle_in_transaction_session_timeout).toBe(60000);
    });
  });
});
