import SchemaMigrationWait, {
  SchemaMigrationWaitPolicy,
  SchemaMigrationWaitTimeoutError,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrationWait";
import logger from "../../../../Server/Utils/Logger";
import Sleep from "../../../../Types/Sleep";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import { DataSource } from "typeorm";

/*
 * How a process that does not apply the schema migrations (a runtime pod,
 * when the migrate Job owns them) waits for them before it starts, without a
 * database: the pending list, the clock and the pauses are stand-ins, so each
 * case says exactly when the list is read, how long the wait lasts, and what
 * it logs.
 *
 * What it pins, because 14.0.13's worker pods started on the 14.0.11 schema
 * and no monitor was processed until AddArchiveToMoreResources committed:
 *
 *  - a process starts at once on an up-to-date schema, and otherwise only
 *    once every migration its code knows is applied;
 *  - the wait is bounded, its last read is at the deadline, and running out
 *    is an error that names the migrations - never a start on the older
 *    schema;
 *  - a read that fails is tried again, not taken for "nothing pending";
 *  - DATABASE_MIGRATION_WAIT_TIMEOUT_MS=0 does not wait at all;
 *  - the pending list only reads: on a new database it creates nothing.
 *
 * The real thing, against Postgres, is SchemaMigrationWaitPostgres.test.ts.
 */

const POLICY: SchemaMigrationWaitPolicy = {
  timeoutInMs: 60_000,
  pollIntervalInMs: 5_000,
  logIntervalInMs: 20_000,
};

const ARCHIVE: string = "AddArchiveToMoreResources1797200000000";
const ONLINE_INDEX: string = "AddLlmLogProjectCreatedAtIndex1798300000000";

/* What this code knows, as connect() hands it over. */
const KNOWN: Array<string> = [
  "InitialMigration1717678334852",
  ARCHIVE,
  ONLINE_INDEX,
];

interface Harness {
  dataSource: DataSource;
  /*
   * What each read of the pending list answers, in order; the last one
   * repeats. An Error is thrown instead.
   */
  reads: Array<Array<string> | Error>;
  /* When each read happened, in ms after the wait began. */
  readAt: Array<number>;
  sleeps: Array<number>;
  infos: Array<string>;
  warnings: Array<string>;
}

function harness(known: Array<string> = KNOWN): Harness {
  const start: number = 1_000_000;
  const now: { value: number } = { value: start };
  const reads: Array<Array<string> | Error> = [];
  const readAt: Array<number> = [];
  const sleeps: Array<number> = [];
  const infos: Array<string> = [];
  const warnings: Array<string> = [];

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now.value;
  });
  jest.spyOn(Sleep, "sleep").mockImplementation(async (ms: number) => {
    sleeps.push(ms);
    now.value += ms;
  });
  jest.spyOn(logger, "info").mockImplementation((message: unknown) => {
    infos.push(String(message));
  });
  jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });
  jest
    .spyOn(SchemaMigrationWait, "getPendingMigrationNames")
    .mockImplementation(async () => {
      readAt.push(now.value - start);
      const answer: Array<string> | Error =
        reads.length > 1 ? reads.shift()! : reads[0]!;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    });

  return {
    dataSource: {
      migrations: known.map((name: string) => {
        return { name: name };
      }),
    } as unknown as DataSource,
    reads,
    readAt,
    sleeps,
    infos,
    warnings,
  };
}

function repeat<T>(value: T, times: number): Array<T> {
  return Array.from({ length: times }, () => {
    return value;
  });
}

function sum(values: Array<number>): number {
  return values.reduce((total: number, value: number) => {
    return total + value;
  }, 0);
}

async function timeoutOf(
  wait: Promise<void>,
): Promise<SchemaMigrationWaitTimeoutError> {
  const error: unknown = await wait.then(
    () => {
      throw new Error("The wait did not time out");
    },
    (caught: unknown) => {
      return caught;
    },
  );
  expect(error).toBeInstanceOf(SchemaMigrationWaitTimeoutError);
  return error as SchemaMigrationWaitTimeoutError;
}

describe("SchemaMigrationWait", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("waiting for the migrations its code needs", () => {
    test("a schema that is up to date starts at once: one read, no pause, nothing logged", async () => {
      const h: Harness = harness();
      h.reads.push([]);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY);

      expect(h.readAt).toEqual([0]);
      expect(h.sleeps).toEqual([]);
      expect(h.infos).toEqual([]);
      expect(h.warnings).toEqual([]);
    });

    test("waits while migrations are pending, and starts as soon as they are applied", async () => {
      const h: Harness = harness();
      h.reads.push([ARCHIVE, ONLINE_INDEX], [ARCHIVE, ONLINE_INDEX], [], []);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY);

      expect(h.readAt).toEqual([0, 5_000, 10_000]);
      expect(h.sleeps).toEqual([5_000, 5_000]);
    });

    test("one migration applied out of two is not enough", async () => {
      const h: Harness = harness();
      h.reads.push([ARCHIVE, ONLINE_INDEX], [ONLINE_INDEX], [ONLINE_INDEX], []);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY);

      expect(h.readAt).toEqual([0, 5_000, 10_000, 15_000]);
    });

    test("says what it waits for, why, and for how long, then that it is done", async () => {
      const h: Harness = harness();
      h.reads.push([ARCHIVE], []);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY);

      expect(h.infos).toHaveLength(2);
      expect(h.infos[0]).toContain(
        `Waiting for 1 schema migration(s) to be applied before starting: ${ARCHIVE}.`,
      );
      expect(h.infos[0]).toContain("RUN_DATABASE_MIGRATIONS_ON_BOOT=false");
      expect(h.infos[0]).toContain("the migrate Job");
      expect(h.infos[0]).toContain(
        "Waiting up to 60 s (DATABASE_MIGRATION_WAIT_TIMEOUT_MS)",
      );
      expect(h.infos[1]).toContain("applied, after 5 s of waiting");
      expect(h.warnings).toEqual([]);
    });

    test("on a new database it says the schema is being created", async () => {
      const h: Harness = harness();
      h.reads.push([...KNOWN], []);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY);

      expect(h.infos[0]).toContain(
        "Waiting for the database schema to be created before starting: none of this code's 3 schema migrations is applied yet.",
      );
    });

    test("names five migrations and counts the rest", async () => {
      const h: Harness = harness();
      const pending: Array<string> = Array.from(
        { length: 12 },
        (_value: unknown, index: number) => {
          return `Migration${index + 1}${1790000000000 + index}`;
        },
      );
      h.reads.push(pending, []);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY);

      expect(h.infos[0]).toContain(
        `${pending.slice(0, 5).join(", ")} and 7 more`,
      );
      expect(h.infos[0]).not.toContain(pending[5]!);
    });

    test("logs a long wait once per log interval, not on every read", async () => {
      const h: Harness = harness();
      h.reads.push(...repeat([ARCHIVE], 9), []);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY);

      // Read every 5 s from 0 to 45 s; logged at 0, 20 and 40 s, and when done.
      expect(h.readAt).toHaveLength(10);
      expect(h.infos).toHaveLength(4);
      expect(h.infos[1]).toBe(
        `Still waiting, after 20 s, for 1 schema migration(s): ${ARCHIVE}.`,
      );
      expect(h.infos[2]).toBe(
        `Still waiting, after 40 s, for 1 schema migration(s): ${ARCHIVE}.`,
      );
      expect(h.infos[3]).toContain("after 45 s of waiting");
    });

    test("a migration applied at the last moment still counts: the last read is at the deadline", async () => {
      const h: Harness = harness();
      // Reads at 0, 7, ... 56 s, then one more at 60 s, not at 63 s.
      h.reads.push(...repeat([ARCHIVE], 9), []);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, {
        ...POLICY,
        pollIntervalInMs: 7_000,
      });

      expect(h.readAt[h.readAt.length - 1]).toBe(60_000);
      expect(h.sleeps[h.sleeps.length - 1]).toBe(4_000);
    });
  });

  describe("running out of time", () => {
    test("gives up when they are not applied in time, and never waits longer", async () => {
      const h: Harness = harness();
      h.reads.push([ARCHIVE]);

      const error: SchemaMigrationWaitTimeoutError = await timeoutOf(
        SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY),
      );

      expect(sum(h.sleeps)).toBe(60_000);
      expect(h.readAt[h.readAt.length - 1]).toBe(60_000);
      expect(error.pendingMigrationNames).toEqual([ARCHIVE]);
      expect(error.waitedInMs).toBe(60_000);
      expect(error.lastError).toBeNull();
    });

    test("the error says which migrations, why the process will not start, and what to change", async () => {
      const h: Harness = harness();
      h.reads.push([ARCHIVE, ONLINE_INDEX]);

      const error: SchemaMigrationWaitTimeoutError = await timeoutOf(
        SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY),
      );

      expect(error.name).toBe("SchemaMigrationWaitTimeoutError");
      expect(error.message).toContain(
        `Gave up after 60 s waiting for 2 schema migration(s) to be applied: ${ARCHIVE}, ${ONLINE_INDEX}.`,
      );
      expect(error.message).toContain("RUN_DATABASE_MIGRATIONS_ON_BOOT=false");
      expect(error.message).toContain(
        "does not start on a schema older than its code",
      );
      expect(error.message).toContain("the migrate Job");
      expect(error.message).toContain("DATABASE_MIGRATION_WAIT_TIMEOUT_MS");
    });

    test("a migration applied after a timed-out read does not matter: the wait is over", async () => {
      const h: Harness = harness();
      h.reads.push(...repeat([ARCHIVE], 13), []);

      await timeoutOf(
        SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY),
      );

      // 13 reads, 0 to 60 s; the 14th, which would have found nothing, never ran.
      expect(h.readAt).toHaveLength(13);
    });
  });

  describe("when the pending migrations cannot be read", () => {
    test("a failed read is tried again, not taken for nothing pending", async () => {
      const h: Harness = harness();
      h.reads.push(
        new Error("Connection terminated unexpectedly"),
        [ARCHIVE],
        [],
      );

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY);

      expect(h.readAt).toEqual([0, 5_000, 10_000]);
      expect(h.warnings).toEqual([
        "Could not read which schema migrations are applied: Connection terminated unexpectedly. Trying again in 5 s.",
      ]);
      // The list it could read is still explained in full.
      expect(h.infos[0]).toContain(
        `Waiting for 1 schema migration(s) to be applied before starting: ${ARCHIVE}.`,
      );
    });

    test("reads that keep failing end in the timeout, which says why", async () => {
      const h: Harness = harness();
      const failure: Error = new Error(
        "permission denied for table migrations",
      );
      h.reads.push(failure);

      const error: SchemaMigrationWaitTimeoutError = await timeoutOf(
        SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY),
      );

      expect(error.pendingMigrationNames).toBeNull();
      expect(error.lastError).toBe(failure);
      expect(error.message).toContain(
        "Gave up after 60 s waiting for the schema migrations to be applied: could not read which ones are. The last read failed: permission denied for table migrations.",
      );
    });

    test("a list read before the reads started failing is kept in the error", async () => {
      const h: Harness = harness();
      h.reads.push([ARCHIVE], new Error("Connection terminated unexpectedly"));

      const error: SchemaMigrationWaitTimeoutError = await timeoutOf(
        SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY),
      );

      expect(error.pendingMigrationNames).toEqual([ARCHIVE]);
      expect(error.message).toContain(
        `waiting for 1 schema migration(s) to be applied: ${ARCHIVE}. The last read failed: Connection terminated unexpectedly.`,
      );
    });

    test("failing reads are logged once per log interval too", async () => {
      const h: Harness = harness();
      h.reads.push(new Error("Connection terminated unexpectedly"));

      await timeoutOf(
        SchemaMigrationWait.waitForPendingMigrations(h.dataSource, POLICY),
      );

      // 13 failed reads, warned about at 0, 20 and 40 s.
      expect(h.readAt).toHaveLength(13);
      expect(h.warnings).toHaveLength(3);
    });
  });

  describe("DATABASE_MIGRATION_WAIT_TIMEOUT_MS=0", () => {
    const NO_WAIT: SchemaMigrationWaitPolicy = { ...POLICY, timeoutInMs: 0 };

    test("does not wait: it names what is missing, and starts", async () => {
      const h: Harness = harness();
      h.reads.push([ARCHIVE, ONLINE_INDEX]);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, NO_WAIT);

      expect(h.readAt).toEqual([0]);
      expect(h.sleeps).toEqual([]);
      expect(h.warnings).toHaveLength(1);
      expect(h.warnings[0]).toContain(
        `2 schema migration(s) this code needs are not applied: ${ARCHIVE}, ${ONLINE_INDEX}.`,
      );
      expect(h.warnings[0]).toContain(
        "DATABASE_MIGRATION_WAIT_TIMEOUT_MS is 0, so this process starts anyway",
      );
    });

    test("does not wait on a failed read either", async () => {
      const h: Harness = harness();
      h.reads.push(new Error("Connection terminated unexpectedly"));

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, NO_WAIT);

      expect(h.sleeps).toEqual([]);
      expect(h.warnings[0]).toContain(
        "Could not read which schema migrations are applied: Connection terminated unexpectedly.",
      );
    });

    test("and says nothing when nothing is pending", async () => {
      const h: Harness = harness();
      h.reads.push([]);

      await SchemaMigrationWait.waitForPendingMigrations(h.dataSource, NO_WAIT);

      expect(h.warnings).toEqual([]);
      expect(h.infos).toEqual([]);
    });
  });

  /*
   * The real list, through TypeORM's MigrationExecutor, on a DataSource whose
   * query runner records what it is asked to do. DataSource.showMigrations()
   * would create the migrations table on a new database; this must not.
   */
  describe("reading the pending migrations", () => {
    interface FakeDatabase {
      dataSource: DataSource;
      createTable: Mock<() => Promise<void>>;
      release: Mock<() => Promise<void>>;
      tablesLookedUp: Array<string>;
    }

    function database(data: {
      hasMigrationsTable: boolean;
      recorded: Array<string>;
    }): FakeDatabase {
      const createTable: Mock<() => Promise<void>> = jest.fn<
        () => Promise<void>
      >(async () => {
        return undefined;
      });
      const release: Mock<() => Promise<void>> = jest.fn<() => Promise<void>>(
        async () => {
          return undefined;
        },
      );
      const tablesLookedUp: Array<string> = [];

      const queryBuilder: Record<string, unknown> = {};
      Object.assign(queryBuilder, {
        select: () => {
          return queryBuilder;
        },
        orderBy: () => {
          return queryBuilder;
        },
        from: () => {
          return queryBuilder;
        },
        getRawMany: async () => {
          return data.recorded.map((name: string, index: number) => {
            return {
              id: index + 1,
              timestamp: name.substring(name.length - 13),
              name: name,
            };
          });
        },
      });

      const queryRunner: Record<string, unknown> = {
        hasTable: async (table: string): Promise<boolean> => {
          tablesLookedUp.push(table);
          return data.hasMigrationsTable;
        },
        createTable: createTable,
        release: release,
      };

      const dataSource: DataSource = {
        options: { migrationsTableName: "migrations" },
        driver: {
          options: { type: "postgres" },
          database: "oneuptimedb",
          buildTableName: (table: string, schema?: string): string => {
            return schema ? `${schema}.${table}` : table;
          },
          escape: (name: string): string => {
            return `"${name}"`;
          },
        },
        // Out of order on purpose: they run by timestamp.
        migrations: [ONLINE_INDEX, KNOWN[0]!, ARCHIVE].map((name: string) => {
          return { name: name };
        }),
        createQueryRunner: () => {
          return queryRunner;
        },
        manager: {
          createQueryBuilder: () => {
            return queryBuilder;
          },
        },
      } as unknown as DataSource;

      return { dataSource, createTable, release, tablesLookedUp };
    }

    test("on a new database: every migration, in the order they run, and nothing created", async () => {
      const db: FakeDatabase = database({
        hasMigrationsTable: false,
        recorded: [],
      });

      await expect(
        SchemaMigrationWait.getPendingMigrationNames(db.dataSource),
      ).resolves.toEqual(KNOWN);
      expect(db.tablesLookedUp).toEqual(["migrations"]);
      expect(db.createTable).not.toHaveBeenCalled();
      expect(db.release).toHaveBeenCalledTimes(1);
    });

    test("on a migrated database: only what it has not recorded", async () => {
      const db: FakeDatabase = database({
        hasMigrationsTable: true,
        recorded: [KNOWN[0]!],
      });

      await expect(
        SchemaMigrationWait.getPendingMigrationNames(db.dataSource),
      ).resolves.toEqual([ARCHIVE, ONLINE_INDEX]);
      expect(db.createTable).not.toHaveBeenCalled();
    });

    test("a migration the database has and the code does not know (a rollback) is no reason to wait", async () => {
      const db: FakeDatabase = database({
        hasMigrationsTable: true,
        recorded: [...KNOWN, "AddSomethingNewer1899999999999"],
      });

      await expect(
        SchemaMigrationWait.getPendingMigrationNames(db.dataSource),
      ).resolves.toEqual([]);
    });
  });

  describe("DATABASE_MIGRATION_WAIT_TIMEOUT_MS", () => {
    /* The setting as a fresh import of EnvironmentConfig reads `value`. */
    function timeoutFor(value: string | undefined): number {
      let timeout: number = -1;
      const previous: string | undefined =
        process.env["DATABASE_MIGRATION_WAIT_TIMEOUT_MS"];

      jest.isolateModules(() => {
        if (value === undefined) {
          delete process.env["DATABASE_MIGRATION_WAIT_TIMEOUT_MS"];
        } else {
          process.env["DATABASE_MIGRATION_WAIT_TIMEOUT_MS"] = value;
        }

        try {
          /* eslint-disable @typescript-eslint/no-var-requires */
          const config: {
            PostgresMigrationWaitTimeoutMs: number;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
          } = require("../../../../Server/EnvironmentConfig");
          const wait: {
            SCHEMA_MIGRATION_WAIT_POLICY: SchemaMigrationWaitPolicy;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
          } = require("../../../../Server/Infrastructure/Postgres/SchemaMigrationWait");
          /* eslint-enable @typescript-eslint/no-var-requires */

          // The wait connect() runs uses exactly this.
          expect(wait.SCHEMA_MIGRATION_WAIT_POLICY.timeoutInMs).toBe(
            config.PostgresMigrationWaitTimeoutMs,
          );
          timeout = config.PostgresMigrationWaitTimeoutMs;
        } finally {
          if (previous === undefined) {
            delete process.env["DATABASE_MIGRATION_WAIT_TIMEOUT_MS"];
          } else {
            process.env["DATABASE_MIGRATION_WAIT_TIMEOUT_MS"] = previous;
          }
        }
      });

      return timeout;
    }

    test("is 15 minutes when unset: inside the chart's 17-minute startup probe window", () => {
      expect(timeoutFor(undefined)).toBe(15 * 60 * 1000);
      expect(timeoutFor("")).toBe(15 * 60 * 1000);
    });

    test("takes a whole number of milliseconds", () => {
      expect(timeoutFor("120000")).toBe(120_000);
      expect(timeoutFor(" 300000 ")).toBe(300_000);
    });

    test("0 switches the wait off", () => {
      expect(timeoutFor("0")).toBe(0);
    });

    test("anything else is the default, never a wait that cannot run out or a 15 ms one", () => {
      for (const value of ["abc", "-1", "1.5", "15m", "Infinity"]) {
        expect(timeoutFor(value)).toBe(15 * 60 * 1000);
      }
    });
  });
});
