import SchemaMigrationRunner, {
  LOCK_CONTENTION_ERROR_CODES,
  SchemaMigrationLockPolicy,
  SchemaMigrationLockTimeoutError,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrationRunner";
import logger from "../../../../Server/Utils/Logger";
import Sleep from "../../../../Types/Sleep";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { DataSource, DataSourceOptions, Migration } from "typeorm";

/*
 * The schema-migration runner, without a database: TypeORM's runner, the
 * pending-migration list, the clock and the sleeps are all stand-ins, so each
 * case says exactly when a migration is retried, how long the runner waits in
 * between, and when it gives up.
 *
 * What it pins, because the migrate Job used to get each of these wrong in
 * production terms:
 *
 *  - a migration that runs out of lock wait (55P03) or loses a deadlock
 *    (40P01) is retried, after a growing pause in which the app has the table
 *    to itself, instead of failing the deploy - or, before it, queueing ahead
 *    of every query on the table for as long as the blocking transaction
 *    lived;
 *  - anything else fails at once: a broken migration does not get better by
 *    waiting;
 *  - the retries are bounded, per migration, and the failure that ends them
 *    says which migration, how many attempts, and which settings to change;
 *  - the connection the migrations run on carries the lock bound as a
 *    startup parameter, and nothing else of the app's options changes.
 *
 * The real thing, against Postgres, is SchemaMigrationLockRetryPostgres.test.ts.
 */

const POLICY: SchemaMigrationLockPolicy = {
  lockTimeoutInMs: 2000,
  retryTimeoutInMs: 60_000,
  firstRetryDelayInMs: 1000,
  maxRetryDelayInMs: 8000,
};

function lockTimeout(): Error {
  return Object.assign(new Error("canceling statement due to lock timeout"), {
    code: "55P03",
    query:
      'ALTER TABLE "Monitor" ADD "isArchived" boolean NOT NULL DEFAULT false',
  });
}

function migration(name: string): Migration {
  return { name: name } as Migration;
}

interface Harness {
  dataSource: DataSource;
  runMigrations: Mock<() => Promise<Array<Migration>>>;
  query: Mock<(sql: string, parameters?: Array<unknown>) => Promise<unknown>>;
  sleeps: Array<number>;
  warnings: Array<string>;
  infos: Array<string>;
  /* What getPendingMigrationNames answers, call by call (last one repeats). */
  pending: Array<Array<string> | null>;
  now: { value: number };
}

function harness(): Harness {
  const runMigrations: Mock<() => Promise<Array<Migration>>> =
    jest.fn<() => Promise<Array<Migration>>>();
  const query: Mock<
    (sql: string, parameters?: Array<unknown>) => Promise<unknown>
  > = jest.fn<(sql: string, parameters?: Array<unknown>) => Promise<unknown>>(
    async () => {
      return [];
    },
  );
  const sleeps: Array<number> = [];
  const warnings: Array<string> = [];
  const infos: Array<string> = [];
  const now: { value: number } = { value: 1_000_000 };
  const pending: Array<Array<string> | null> = [];

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now.value;
  });
  jest.spyOn(Sleep, "sleep").mockImplementation(async (ms: number) => {
    sleeps.push(ms);
    now.value += ms;
  });
  // No jitter: each pause is exactly the policy's.
  jest.spyOn(Math, "random").mockReturnValue(0.5);
  jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });
  jest.spyOn(logger, "info").mockImplementation((message: unknown) => {
    infos.push(String(message));
  });
  jest
    .spyOn(SchemaMigrationRunner, "getPendingMigrationNames")
    .mockImplementation(async () => {
      if (pending.length > 1) {
        return pending.shift()!;
      }
      // The last answer repeats; null (could not be read) included.
      return pending.length === 1 ? pending[0]! : [];
    });

  return {
    dataSource: {
      runMigrations: runMigrations,
      query: query,
    } as unknown as DataSource,
    runMigrations,
    query,
    sleeps,
    warnings,
    infos,
    pending,
    now,
  };
}

describe("SchemaMigrationRunner", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the connection migrations run on", () => {
    const appOptions: DataSourceOptions = {
      type: "postgres",
      host: "db",
      migrationsRun: true,
      synchronize: false,
      extra: {
        statement_timeout: 30000,
        query_timeout: 35000,
        options: "-c idle_session_timeout=600000",
      },
    } as DataSourceOptions;

    test("carries the lock bound as a startup parameter", () => {
      const options: DataSourceOptions =
        SchemaMigrationRunner.getDataSourceOptions(appOptions, POLICY);

      expect(
        (options as { extra: Record<string, unknown> }).extra["lock_timeout"],
      ).toBe(2000);
    });

    /*
     * A startup parameter is the session's DEFAULT, so `SET lock_timeout =
     * DEFAULT` in a migration (1798300000000 does it after its index build)
     * comes back to the bound instead of switching it off for every
     * migration after.
     */
    test("keeps every other connection setting of the app", () => {
      const options: DataSourceOptions =
        SchemaMigrationRunner.getDataSourceOptions(appOptions, POLICY);

      expect((options as { extra: Record<string, unknown> }).extra).toEqual({
        statement_timeout: 30000,
        query_timeout: 35000,
        options: "-c idle_session_timeout=600000",
        lock_timeout: 2000,
      });
      expect(options.type).toBe("postgres");
      expect((options as { host: string }).host).toBe("db");
    });

    test("never runs anything from initialize() itself", () => {
      const options: DataSourceOptions =
        SchemaMigrationRunner.getDataSourceOptions(appOptions, POLICY);

      expect(options.migrationsRun).toBe(false);
      expect(options.synchronize).toBe(false);
    });

    test("0 lets statements wait as long as it takes, even over an inherited bound", () => {
      const options: DataSourceOptions =
        SchemaMigrationRunner.getDataSourceOptions(
          {
            ...appOptions,
            extra: { lock_timeout: 3000, statement_timeout: 30000 },
          } as DataSourceOptions,
          { ...POLICY, lockTimeoutInMs: 0 },
        );

      expect((options as { extra: Record<string, unknown> }).extra).toEqual({
        statement_timeout: 30000,
      });
    });

    test("leaves the app's own options alone", () => {
      SchemaMigrationRunner.getDataSourceOptions(appOptions, POLICY);

      expect(appOptions.migrationsRun).toBe(true);
      expect(
        (appOptions as { extra: Record<string, unknown> }).extra[
          "lock_timeout"
        ],
      ).toBeUndefined();
    });
  });

  describe("which failures are worth another attempt", () => {
    test.each(
      LOCK_CONTENTION_ERROR_CODES.map((code: string) => {
        return [code];
      }),
    )(
      "%s, on the error or on the driver error TypeORM wraps",
      (code: string) => {
        expect(SchemaMigrationRunner.isLockContentionError({ code })).toBe(
          true,
        );
        expect(
          SchemaMigrationRunner.isLockContentionError({
            driverError: { code },
          }),
        ).toBe(true);
      },
    );

    test.each([
      ["a statement timeout", "57014"],
      ["a duplicate table", "42P07"],
      ["an undefined column", "42703"],
    ])("not %s (%s)", (_label: string, code: string) => {
      expect(SchemaMigrationRunner.isLockContentionError({ code })).toBe(false);
    });

    test.each([[null], [undefined], ["55P03"], [new Error("55P03")]])(
      "not %p",
      (error: unknown) => {
        expect(SchemaMigrationRunner.isLockContentionError(error)).toBe(false);
      },
    );
  });

  describe("the pause between attempts", () => {
    test("doubles from the first, up to the cap", () => {
      jest.spyOn(Math, "random").mockReturnValue(0.5);

      expect(
        [1, 2, 3, 4, 5, 6].map((attempt: number) => {
          return SchemaMigrationRunner.getRetryDelayInMs(attempt, POLICY);
        }),
      ).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
    });

    test("is spread 25% either way, so two runners do not retry in step", () => {
      jest.spyOn(Math, "random").mockReturnValue(0);
      expect(SchemaMigrationRunner.getRetryDelayInMs(3, POLICY)).toBe(3000);

      jest.spyOn(Math, "random").mockReturnValue(0.999999);
      expect(SchemaMigrationRunner.getRetryDelayInMs(3, POLICY)).toBe(5000);
    });
  });

  describe("applying the pending migrations", () => {
    let h: Harness;

    beforeEach(() => {
      h = harness();
    });

    test("does nothing when nothing is pending", async () => {
      h.pending.push([]);

      await expect(
        SchemaMigrationRunner.applyPendingMigrations(h.dataSource, POLICY),
      ).resolves.toEqual([]);
      expect(h.runMigrations).not.toHaveBeenCalled();
    });

    test("runs TypeORM's runner once, one transaction per migration", async () => {
      h.pending.push(["A1", "B2"], []);
      h.runMigrations.mockResolvedValue([migration("A1"), migration("B2")]);

      await expect(
        SchemaMigrationRunner.applyPendingMigrations(h.dataSource, POLICY),
      ).resolves.toEqual(["A1", "B2"]);
      expect(h.runMigrations).toHaveBeenCalledTimes(1);
      expect(h.runMigrations).toHaveBeenCalledWith({ transaction: "each" });
      expect(h.sleeps).toEqual([]);
    });

    /*
     * The incident, replayed: the ALTER on "Monitor" cannot get its lock
     * while a long transaction holds the table. Each attempt now gives up
     * after the lock bound, rolls back - releasing everything - and the
     * runner steps back for longer each time, until the transaction is gone.
     */
    test("retries a migration that ran out of lock wait, backing off, until it gets through", async () => {
      h.pending.push(
        ["AddArchiveToMoreResources1797200000000"],
        ["AddArchiveToMoreResources1797200000000"],
        ["AddArchiveToMoreResources1797200000000"],
        ["AddArchiveToMoreResources1797200000000"],
        [],
      );
      h.runMigrations
        .mockRejectedValueOnce(lockTimeout())
        .mockRejectedValueOnce(lockTimeout())
        .mockRejectedValueOnce(lockTimeout())
        .mockResolvedValueOnce([
          migration("AddArchiveToMoreResources1797200000000"),
        ]);

      await expect(
        SchemaMigrationRunner.applyPendingMigrations(h.dataSource, POLICY),
      ).resolves.toEqual(["AddArchiveToMoreResources1797200000000"]);

      expect(h.runMigrations).toHaveBeenCalledTimes(4);
      expect(h.sleeps).toEqual([1000, 2000, 4000]);
      expect(h.warnings[0]).toContain(
        "Schema migration AddArchiveToMoreResources1797200000000 rolled back: canceling statement due to lock timeout",
      );
      // The statement it gave up on, so the table is in the log.
      expect(h.warnings[0]).toContain('ALTER TABLE "Monitor" ADD "isArchived"');
      expect(h.warnings[0]).toContain("retrying in 1000 ms (attempt 2)");
    });

    test("names the transactions open longest the first time a migration is held up", async () => {
      h.pending.push(["M1"], ["M1"], ["M1"], []);
      h.runMigrations
        .mockRejectedValueOnce(lockTimeout())
        .mockRejectedValueOnce(lockTimeout())
        .mockResolvedValueOnce([migration("M1")]);
      h.query.mockResolvedValue([
        {
          pid: 4242,
          applicationName: "oneuptime",
          backendType: "client backend",
          state: "idle in transaction",
          transactionAgeInSeconds: 671,
          waitEventType: "Client",
          tables: ["Monitor", "Project"],
          query: 'SELECT "_id" FROM "Monitor" WHERE "projectId" = $1',
        },
      ]);

      await SchemaMigrationRunner.applyPendingMigrations(h.dataSource, POLICY);

      expect(h.query).toHaveBeenCalledTimes(1);
      expect(h.query.mock.calls[0]![0]).toContain("FROM pg_stat_activity");
      expect(h.query.mock.calls[0]![1]).toEqual([2]);
      expect(
        h.warnings.find((warning: string) => {
          return warning.startsWith("Open transaction: pid 4242");
        }),
      ).toBe(
        'Open transaction: pid 4242, client backend "oneuptime", idle in transaction (waiting on Client), open for 671 s, holding locks on Monitor, Project; last statement: SELECT "_id" FROM "Monitor" WHERE "projectId" = $1',
      );
    });

    test("a deadlock it lost is retried like a lock wait", async () => {
      h.pending.push(["M1"], ["M1"], []);
      h.runMigrations
        .mockRejectedValueOnce(
          Object.assign(new Error("deadlock detected"), { code: "40P01" }),
        )
        .mockResolvedValueOnce([migration("M1")]);

      await expect(
        SchemaMigrationRunner.applyPendingMigrations(h.dataSource, POLICY),
      ).resolves.toEqual(["M1"]);
      expect(h.sleeps).toEqual([1000]);
    });

    test("any other failure fails at once, unchanged", async () => {
      h.pending.push(["M1"]);
      const broken: Error = Object.assign(
        new Error('column "isArchived" of relation "Monitor" already exists'),
        { code: "42701" },
      );
      h.runMigrations.mockRejectedValueOnce(broken);

      await expect(
        SchemaMigrationRunner.applyPendingMigrations(h.dataSource, POLICY),
      ).rejects.toBe(broken);
      expect(h.runMigrations).toHaveBeenCalledTimes(1);
      expect(h.sleeps).toEqual([]);
    });

    test("gives up once the next pause would run past the window, and says why", async () => {
      h.pending.push(["AddArchiveToMoreResources1797200000000"]);
      h.runMigrations.mockRejectedValue(lockTimeout());

      const failure: unknown =
        await SchemaMigrationRunner.applyPendingMigrations(h.dataSource, {
          ...POLICY,
          retryTimeoutInMs: 20_000,
        }).catch((error: unknown) => {
          return error;
        });

      // 1 + 2 + 4 + 8 = 15 s waited; the next 8 s pause would pass 20 s.
      expect(h.sleeps).toEqual([1000, 2000, 4000, 8000]);
      expect(h.runMigrations).toHaveBeenCalledTimes(5);
      expect(failure).toBeInstanceOf(SchemaMigrationLockTimeoutError);

      const error: SchemaMigrationLockTimeoutError =
        failure as SchemaMigrationLockTimeoutError;

      expect(error.migrationName).toBe(
        "AddArchiveToMoreResources1797200000000",
      );
      expect(error.attempts).toBe(5);
      expect(SchemaMigrationRunner.isLockContentionError(error.lastError)).toBe(
        true,
      );
      expect(error.message).toContain(
        "Schema migration AddArchiveToMoreResources1797200000000 could not get its locks: 5 attempt(s) over 15 s, each waiting at most 2000 ms",
      );
      expect(error.message).toContain("DATABASE_MIGRATION_LOCK_TIMEOUT_MS");
      expect(error.message).toContain(
        "DATABASE_MIGRATION_LOCK_RETRY_TIMEOUT_MS",
      );
      expect(error.message).toContain(
        "Last error: canceling statement due to lock timeout",
      );
      // The open transactions, again, for the run that failed.
      expect(h.query).toHaveBeenCalledTimes(2);
    });

    test("a window of 0 never retries", async () => {
      h.pending.push(["M1"]);
      h.runMigrations.mockRejectedValue(lockTimeout());

      await expect(
        SchemaMigrationRunner.applyPendingMigrations(h.dataSource, {
          ...POLICY,
          retryTimeoutInMs: 0,
        }),
      ).rejects.toBeInstanceOf(SchemaMigrationLockTimeoutError);
      expect(h.runMigrations).toHaveBeenCalledTimes(1);
      expect(h.sleeps).toEqual([]);
    });

    /*
     * Fourteen migrations shipped in 14.0.13; one that waited long for
     * "Monitor" must not use up the window of the next one, which may need
     * "Project".
     */
    test("each migration gets a window of its own", async () => {
      h.pending.push(
        ["M1", "M2"],
        ["M1", "M2"],
        ["M1", "M2"],
        ["M2"],
        ["M2"],
        [],
      );
      h.runMigrations
        .mockRejectedValueOnce(lockTimeout())
        .mockRejectedValueOnce(lockTimeout())
        // M1 commits, then M2 is held up.
        .mockRejectedValueOnce(lockTimeout())
        .mockRejectedValueOnce(lockTimeout())
        .mockResolvedValueOnce([migration("M2")]);

      await expect(
        SchemaMigrationRunner.applyPendingMigrations(h.dataSource, {
          ...POLICY,
          retryTimeoutInMs: 5000,
        }),
      ).resolves.toEqual(["M1", "M2"]);

      // M1: 1 s, 2 s. M2 starts over: 1 s, 2 s - not 4 s, and not out of window.
      expect(h.sleeps).toEqual([1000, 2000, 1000, 2000]);
    });

    test("the pending list failing to load never skips the run", async () => {
      h.pending.push(null);
      h.runMigrations.mockResolvedValueOnce([migration("M1")]);

      await expect(
        SchemaMigrationRunner.applyPendingMigrations(h.dataSource, POLICY),
      ).resolves.toEqual(["M1"]);
      expect(h.runMigrations).toHaveBeenCalledTimes(1);
      expect(h.infos[0]).toContain("Applying the pending schema migrations");
    });

    test("listing the open transactions failing never hides the retry", async () => {
      h.pending.push(["M1"], ["M1"], []);
      h.runMigrations
        .mockRejectedValueOnce(lockTimeout())
        .mockResolvedValueOnce([migration("M1")]);
      h.query.mockRejectedValue(new Error("permission denied"));

      await expect(
        SchemaMigrationRunner.applyPendingMigrations(h.dataSource, POLICY),
      ).resolves.toEqual(["M1"]);
      expect(h.warnings).toContain(
        "Could not list the open transactions: permission denied",
      );
    });

    test("logs when it starts, how long a lock wait may last, and how long the run took", async () => {
      h.pending.push(["M1", "M2"], ["M1", "M2"], []);
      h.runMigrations
        .mockRejectedValueOnce(lockTimeout())
        .mockResolvedValueOnce([migration("M1"), migration("M2")]);

      await SchemaMigrationRunner.applyPendingMigrations(h.dataSource, POLICY);

      expect(h.infos).toEqual([
        "Applying 2 pending schema migration(s), M1 first. A statement waits at most 2000 ms for a lock; a migration that runs out is rolled back and retried.",
        "Applied 2 schema migration(s) in 1 s.",
      ]);
    });
  });

  describe("running them on a connection of their own", () => {
    test("opens it with the bound, applies, and closes it - also when applying fails", async () => {
      const opened: Array<DataSourceOptions> = [];
      const destroy: Mock<() => Promise<void>> = jest.fn<() => Promise<void>>(
        async () => {
          return undefined;
        },
      );

      jest
        .spyOn(DataSource.prototype, "initialize")
        .mockImplementation(async function (this: DataSource) {
          opened.push(this.options);
          return this;
        });
      jest.spyOn(DataSource.prototype, "destroy").mockImplementation(destroy);
      const failure: Error = new Error("broken migration");
      jest
        .spyOn(SchemaMigrationRunner, "applyPendingMigrations")
        .mockResolvedValueOnce(["M1"])
        .mockRejectedValueOnce(failure);

      const appOptions: DataSourceOptions = {
        type: "postgres",
        migrationsRun: true,
        extra: { statement_timeout: 30000 },
      } as DataSourceOptions;

      await expect(
        SchemaMigrationRunner.runPendingMigrations(appOptions, POLICY),
      ).resolves.toEqual(["M1"]);
      await expect(
        SchemaMigrationRunner.runPendingMigrations(appOptions, POLICY),
      ).rejects.toBe(failure);

      expect(opened).toHaveLength(2);
      expect(opened[0]!.migrationsRun).toBe(false);
      expect(
        (opened[0] as { extra: Record<string, unknown> }).extra["lock_timeout"],
      ).toBe(2000);
      expect(destroy).toHaveBeenCalledTimes(2);
    });
  });
});
