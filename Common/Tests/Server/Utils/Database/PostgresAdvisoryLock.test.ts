import PostgresAdvisoryLock from "../../../../Server/Utils/Database/PostgresAdvisoryLock";
import PostgresDatabase from "../../../../Server/Infrastructure/PostgresDatabase";
import logger from "../../../../Server/Utils/Logger";
import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import { getJestSpyOn } from "../../../Spy";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PostgresAdvisoryLock is the mutual-exclusion primitive under the
 * first-Master-Admin election (GHSA-3qqq-hprx-g2jw). Everything it promises is
 * a property of the exact statements it issues and the order it issues them
 * in, so that is what these tests pin:
 *
 *   - the lock is TRANSACTION-scoped (pg_advisory_xact_lock, not
 *     pg_advisory_lock). A session-scoped lock is unsafe behind PgBouncer in
 *     transaction pool mode -- the unlock can be routed to a different pooled
 *     backend and the lock leaks forever. This distinction is invisible at
 *     every call site, so it has to be checked here or nowhere.
 *   - the lock is taken BEFORE the work runs and released AFTER it finishes.
 *     A lock released early is not a lock: the whole point for the caller is
 *     that its read and its write are covered by the same critical section.
 *   - the connection is always returned to the pool. A leaked QueryRunner is a
 *     leaked backend, and a leaked lock-holder transaction blocks every later
 *     caller until idle_in_transaction_session_timeout kills it.
 *   - cleanup never masks the outcome of the work.
 *
 * No Postgres: the DataSource is faked and the emitted SQL is captured.
 */

interface CapturedQuery {
  sql: string;
  params: Array<unknown> | undefined;
}

interface FakeQueryRunner {
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  query: jest.Mock;
  isTransactionActive: boolean;
}

const LOCK_LABEL: string = "oneuptime:test-lock";

describe("PostgresAdvisoryLock.runExclusively", () => {
  let queryRunners: Array<FakeQueryRunner>;
  let queries: Array<CapturedQuery>;
  let events: Array<string>;

  type BuildQueryRunnerFunction = () => FakeQueryRunner;

  const buildQueryRunner: BuildQueryRunnerFunction = (): FakeQueryRunner => {
    const runner: FakeQueryRunner = {
      isTransactionActive: false,
      connect: jest.fn(async (): Promise<void> => {
        events.push("connect");
      }) as unknown as jest.Mock,
      startTransaction: jest.fn(async (): Promise<void> => {
        runner.isTransactionActive = true;
        events.push("begin");
      }) as unknown as jest.Mock,
      commitTransaction: jest.fn(async (): Promise<void> => {
        runner.isTransactionActive = false;
        events.push("commit");
      }) as unknown as jest.Mock,
      rollbackTransaction: jest.fn(async (): Promise<void> => {
        runner.isTransactionActive = false;
        events.push("rollback");
      }) as unknown as jest.Mock,
      release: jest.fn(async (): Promise<void> => {
        events.push("release");
      }) as unknown as jest.Mock,
      query: jest.fn(
        async (
          sql: string,
          params?: Array<unknown>,
        ): Promise<Array<unknown>> => {
          queries.push({ sql: sql, params: params });
          events.push("query");
          return [];
        },
      ) as unknown as jest.Mock,
    };

    queryRunners.push(runner);

    return runner;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    queryRunners = [];
    queries = [];
    events = [];

    getJestSpyOn(PostgresDatabase, "getDataSource").mockReturnValue({
      createQueryRunner: (): FakeQueryRunner => {
        return buildQueryRunner();
      },
    });

    getJestSpyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  test("takes a transaction-scoped advisory lock, not a session-scoped one", async () => {
    await PostgresAdvisoryLock.runExclusively({
      label: LOCK_LABEL,
      work: async (): Promise<void> => {
        return undefined;
      },
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toBe("SELECT pg_advisory_xact_lock(hashtext($1))");

    /*
     * pg_advisory_lock (session-scoped) leaks behind a transaction-mode pooler.
     * Assert the exact absence, not just the presence of the xact variant, so a
     * later "simplification" to the session form fails loudly.
     */
    expect(queries[0]!.sql).not.toContain("pg_advisory_lock(");
  });

  test("binds the label as a parameter instead of interpolating it into SQL", async () => {
    const hostileLabel: string = '\'); DROP TABLE "User"; --';

    await PostgresAdvisoryLock.runExclusively({
      label: hostileLabel,
      work: async (): Promise<void> => {
        return undefined;
      },
    });

    expect(queries[0]!.params).toEqual([hostileLabel]);
    expect(queries[0]!.sql).not.toContain("DROP TABLE");
    expect(queries[0]!.sql).toContain("$1");
  });

  test("holds the lock across the work: connect, begin, lock, work, commit, release", async () => {
    await PostgresAdvisoryLock.runExclusively({
      label: LOCK_LABEL,
      work: async (): Promise<void> => {
        events.push("work");
      },
    });

    expect(events).toEqual([
      "connect",
      "begin",
      "query",
      "work",
      "commit",
      "release",
    ]);
  });

  test("the transaction is still open while the work runs", async () => {
    let openDuringWork: boolean | null = null;

    await PostgresAdvisoryLock.runExclusively({
      label: LOCK_LABEL,
      work: async (): Promise<void> => {
        openDuringWork = queryRunners[0]!.isTransactionActive;
      },
    });

    // Ending the transaction is what drops the lock, so it must outlive the work.
    expect(openDuringWork).toBe(true);
    expect(queryRunners[0]!.isTransactionActive).toBe(false);
  });

  test("returns whatever the work returns", async () => {
    const result: string = await PostgresAdvisoryLock.runExclusively({
      label: LOCK_LABEL,
      work: async (): Promise<string> => {
        return "elected";
      },
    });

    expect(result).toBe("elected");
  });

  test("throws DatabaseNotConnectedException and never runs the work when there is no DataSource", async () => {
    getJestSpyOn(PostgresDatabase, "getDataSource").mockReturnValue(null);

    const work: jest.Mock = jest.fn() as unknown as jest.Mock;

    await expect(
      PostgresAdvisoryLock.runExclusively({
        label: LOCK_LABEL,
        work: work as unknown as () => Promise<void>,
      }),
    ).rejects.toBeInstanceOf(DatabaseNotConnectedException);

    /*
     * Failing closed matters more than failing gracefully here: running the
     * work unserialized is exactly the bug the lock exists to prevent.
     */
    expect(work).not.toHaveBeenCalled();
    expect(queryRunners).toHaveLength(0);
  });

  test("rethrows the work's error, and still ends the transaction and releases the connection", async () => {
    const boom: Error = new Error("work blew up");

    await expect(
      PostgresAdvisoryLock.runExclusively({
        label: LOCK_LABEL,
        work: async (): Promise<void> => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);

    expect(queryRunners[0]!.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunners[0]!.release).toHaveBeenCalledTimes(1);
    expect(queryRunners[0]!.isTransactionActive).toBe(false);
  });

  test("releases the connection even when the lock statement itself fails", async () => {
    /*
     * lock_timeout (3s by default) aborts a contended advisory-lock wait with
     * SQLSTATE 55P03. The caller sees the error; the pool must not lose a
     * connection over it.
     */
    getJestSpyOn(PostgresDatabase, "getDataSource").mockReturnValue({
      createQueryRunner: (): FakeQueryRunner => {
        const runner: FakeQueryRunner = buildQueryRunner();
        runner.query = jest.fn(async (): Promise<void> => {
          throw new Error("canceling statement due to lock timeout");
        }) as unknown as jest.Mock;
        return runner;
      },
    });

    const work: jest.Mock = jest.fn() as unknown as jest.Mock;

    await expect(
      PostgresAdvisoryLock.runExclusively({
        label: LOCK_LABEL,
        work: work as unknown as () => Promise<void>,
      }),
    ).rejects.toThrow("canceling statement due to lock timeout");

    expect(work).not.toHaveBeenCalled();
    expect(queryRunners[0]!.release).toHaveBeenCalledTimes(1);
  });

  test("falls back to a rollback when the commit fails, and still releases", async () => {
    getJestSpyOn(PostgresDatabase, "getDataSource").mockReturnValue({
      createQueryRunner: (): FakeQueryRunner => {
        const runner: FakeQueryRunner = buildQueryRunner();
        runner.commitTransaction = jest.fn(async (): Promise<void> => {
          events.push("commit-failed");
          throw new Error("connection lost");
        }) as unknown as jest.Mock;
        return runner;
      },
    });

    const result: string = await PostgresAdvisoryLock.runExclusively({
      label: LOCK_LABEL,
      work: async (): Promise<string> => {
        return "done";
      },
    });

    // A cleanup failure must not turn a successful election into a failed one.
    expect(result).toBe("done");
    expect(events).toContain("commit-failed");
    expect(queryRunners[0]!.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunners[0]!.release).toHaveBeenCalledTimes(1);
  });

  test("a failing release does not mask the work's result", async () => {
    getJestSpyOn(PostgresDatabase, "getDataSource").mockReturnValue({
      createQueryRunner: (): FakeQueryRunner => {
        const runner: FakeQueryRunner = buildQueryRunner();
        runner.release = jest.fn(async (): Promise<void> => {
          throw new Error("release failed");
        }) as unknown as jest.Mock;
        return runner;
      },
    });

    await expect(
      PostgresAdvisoryLock.runExclusively({
        label: LOCK_LABEL,
        work: async (): Promise<string> => {
          return "done";
        },
      }),
    ).resolves.toBe("done");
  });

  test("a failing release does not mask the work's error either", async () => {
    const boom: Error = new Error("work blew up");

    getJestSpyOn(PostgresDatabase, "getDataSource").mockReturnValue({
      createQueryRunner: (): FakeQueryRunner => {
        const runner: FakeQueryRunner = buildQueryRunner();
        runner.release = jest.fn(async (): Promise<void> => {
          throw new Error("release failed");
        }) as unknown as jest.Mock;
        return runner;
      },
    });

    await expect(
      PostgresAdvisoryLock.runExclusively({
        label: LOCK_LABEL,
        work: async (): Promise<void> => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);
  });

  test("does not try to commit a transaction that is no longer active", async () => {
    /*
     * idle_in_transaction_session_timeout can end the holder's transaction from
     * under us. Committing an inactive transaction throws in TypeORM, so the
     * cleanup checks first.
     */
    await PostgresAdvisoryLock.runExclusively({
      label: LOCK_LABEL,
      work: async (): Promise<void> => {
        queryRunners[0]!.isTransactionActive = false;
      },
    });

    expect(queryRunners[0]!.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunners[0]!.release).toHaveBeenCalledTimes(1);
  });

  test("uses a dedicated connection per call so callers cannot interfere", async () => {
    await Promise.all([
      PostgresAdvisoryLock.runExclusively({
        label: LOCK_LABEL,
        work: async (): Promise<void> => {
          return undefined;
        },
      }),
      PostgresAdvisoryLock.runExclusively({
        label: LOCK_LABEL,
        work: async (): Promise<void> => {
          return undefined;
        },
      }),
    ]);

    expect(queryRunners).toHaveLength(2);
    expect(queryRunners[0]).not.toBe(queryRunners[1]);

    for (const runner of queryRunners) {
      expect(runner.release).toHaveBeenCalledTimes(1);
    }
  });
});
