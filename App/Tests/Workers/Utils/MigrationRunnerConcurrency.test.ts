import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The migration runners are DELIBERATELY NOT SERIALIZED.
 *
 * Both used to take a Postgres advisory lock -- the data-migration runner a
 * session-level `pg_advisory_lock` held across the whole loop, the
 * startup-migration runner a `pg_advisory_xact_lock` on a pinned QueryRunner.
 * Both are gone. Under the default Helm deployment a single migrate Job
 * (`migrate.enabled`) owns data migrations, so there is one runner and nothing
 * to exclude.
 *
 * This suite exists because that decision has a cost, and the cost is invisible
 * at the call sites. Two things are pinned here:
 *
 *   1. THE LOCKS ARE ACTUALLY GONE. No advisory-lock SQL, and no dedicated
 *      QueryRunner -- the runners used to pin a connection for the whole run,
 *      which is what made them care about PgBouncer pool modes at all.
 *
 *   2. THE BEHAVIOUR THE LOCK USED TO SIT INSIDE STILL WORKS. Removing a
 *      try/finally that wrapped an entire loop is exactly the kind of edit that
 *      quietly drops a `break` or an error propagation, so the halt-on-first-
 *      failure and re-throw contract is re-asserted here.
 *
 * If you are reintroducing mutual exclusion, delete this file rather than
 * editing it around the edges -- these assertions are the record of a
 * deliberate trade-off, not a description of desirable behaviour in general.
 * The trade-off: docker-compose and `migrate.enabled: false` run several
 * runners at once with nothing serializing them, so DATA MIGRATIONS MUST
 * TOLERATE BEING RUN CONCURRENTLY WITH THEMSELVES.
 * ---------------------------------------------------------------------------
 */

/*
 * `any` rather than jest.Mock: the runner is driven through @jest/globals,
 * whose Mock<> generics do not line up with the ambient @types/jest ones.
 */
interface FakeMigration {
  name: string;
  migrate: any;
  rollback: any;
  runsInClusterMode: any;
}

const dataMigrations: Array<FakeMigration> = [];
const startupMigrations: Array<FakeMigration> = [];

jest.mock("../../../FeatureSet/Workers/DataMigrations/Index", () => {
  return { __esModule: true, default: dataMigrations };
});

jest.mock("../../../FeatureSet/Workers/StartupMigrations/Index", () => {
  return { __esModule: true, default: startupMigrations };
});

const createQueryRunner: any = jest.fn();
let dataSource: unknown = null;

jest.mock("Common/Server/Infrastructure/PostgresDatabase", () => {
  return {
    __esModule: true,
    default: {
      getDataSource: (): unknown => {
        return dataSource;
      },
    },
  };
});

const findOneBy: any = jest.fn();
const create: any = jest.fn();

jest.mock("Common/Server/Services/DataMigrationService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return findOneBy(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return create(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Database/MigrationFailureLog", () => {
  return {
    __esModule: true,
    MigrationFailureType: { DataMigration: "DataMigration" },
    recordMigrationFailure: jest.fn(async (): Promise<void> => {}),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
const RunDatabaseMigrations: () => Promise<void> =
  require("../../../FeatureSet/Workers/Utils/DataMigration").default;
const RunStartupMigrations: () => Promise<void> =
  require("../../../FeatureSet/Workers/Utils/StartupMigration").default;
/* eslint-enable @typescript-eslint/no-require-imports */
/* eslint-enable @typescript-eslint/no-var-requires */

function buildMigration(data: {
  name: string;
  fails?: boolean | undefined;
  runsInClusterMode?: boolean | undefined;
}): FakeMigration {
  return {
    name: data.name,
    migrate: jest.fn(async (): Promise<void> => {
      if (data.fails) {
        throw new Error(`${data.name} exploded`);
      }
    }),
    rollback: jest.fn(async (): Promise<void> => {}),
    runsInClusterMode: jest.fn((): boolean => {
      return data.runsInClusterMode !== false;
    }),
  };
}

describe("migration runners take no lock", () => {
  beforeEach(() => {
    dataMigrations.length = 0;
    startupMigrations.length = 0;
    createQueryRunner.mockReset();
    findOneBy.mockReset();
    create.mockReset();

    findOneBy.mockResolvedValue(null);
    create.mockResolvedValue(undefined);

    /*
     * A DataSource that screams if anyone asks it for a connection. The runners
     * only ever needed one to hold an advisory lock; every other query goes
     * through the services.
     */
    createQueryRunner.mockImplementation((): never => {
      throw new Error("createQueryRunner must not be called any more");
    });

    dataSource = { createQueryRunner };
  });

  describe("data migrations", () => {
    test("never opens a dedicated connection", async () => {
      dataMigrations.push(buildMigration({ name: "one" }));

      await RunDatabaseMigrations();

      /*
       * The session-level pg_advisory_lock had to be taken and released on the
       * SAME pinned connection, which is why this used to be a QueryRunner at
       * all. No lock, no pinned connection.
       */
      expect(createQueryRunner).not.toHaveBeenCalled();
    });

    test("still runs a pending migration and records it", async () => {
      const migration: FakeMigration = buildMigration({ name: "one" });
      dataMigrations.push(migration);

      await RunDatabaseMigrations();

      expect(migration.migrate).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
    });

    test("still skips a migration already recorded as executed", async () => {
      const migration: FakeMigration = buildMigration({ name: "one" });
      dataMigrations.push(migration);
      findOneBy.mockResolvedValue({ name: "one", executed: true });

      await RunDatabaseMigrations();

      expect(migration.migrate).not.toHaveBeenCalled();
    });

    test("still halts the chain at the first failure", async () => {
      const first: FakeMigration = buildMigration({
        name: "one",
        fails: true,
      });
      const second: FakeMigration = buildMigration({ name: "two" });
      dataMigrations.push(first, second);

      await expect(RunDatabaseMigrations()).rejects.toThrow(/one/);

      /*
       * The `break` lived inside the try that the advisory lock opened. If
       * unwrapping the lock had dropped it, every later migration would run
       * against a schema the failed one never produced.
       */
      expect(second.migrate).not.toHaveBeenCalled();
    });

    test("still rolls back the migration that failed", async () => {
      const migration: FakeMigration = buildMigration({
        name: "one",
        fails: true,
      });
      dataMigrations.push(migration);

      await expect(RunDatabaseMigrations()).rejects.toThrow();

      expect(migration.rollback).toHaveBeenCalledTimes(1);
    });

    test("still re-throws so the migrate Job exits non-zero", async () => {
      dataMigrations.push(buildMigration({ name: "one", fails: true }));

      /*
       * App/Migrate.ts turns this rejection into process.exit(1). Swallowing it
       * makes a broken migration look like a successful deploy.
       */
      await expect(RunDatabaseMigrations()).rejects.toThrow(
        /halting the migration chain/,
      );
    });

    test("resolves quietly when every migration succeeds", async () => {
      dataMigrations.push(
        buildMigration({ name: "one" }),
        buildMigration({ name: "two" }),
      );

      await expect(RunDatabaseMigrations()).resolves.toBeUndefined();
    });

    test("skips cleanly when Postgres is not connected", async () => {
      dataSource = null;
      dataMigrations.push(buildMigration({ name: "one" }));

      await expect(RunDatabaseMigrations()).resolves.toBeUndefined();
      expect(dataMigrations[0]!.migrate).not.toHaveBeenCalled();
    });

    test("two concurrent runners both proceed -- nothing excludes them", async () => {
      /*
       * This asserts the ABSENCE of mutual exclusion, on purpose. It is the
       * docker-compose / migrate.enabled=false shape: both containers boot,
       * both find the migration unexecuted, both run it. The migrate Job is
       * what prevents this in the default deployment -- not the runner.
       */
      const migration: FakeMigration = buildMigration({ name: "one" });
      dataMigrations.push(migration);

      await Promise.all([RunDatabaseMigrations(), RunDatabaseMigrations()]);

      expect(migration.migrate).toHaveBeenCalledTimes(2);
    });
  });

  describe("startup migrations", () => {
    test("never opens a dedicated connection", async () => {
      startupMigrations.push(buildMigration({ name: "one" }));

      await RunStartupMigrations();

      expect(createQueryRunner).not.toHaveBeenCalled();
    });

    test("runs every migration in order", async () => {
      const order: Array<string> = [];
      const first: FakeMigration = buildMigration({ name: "one" });
      const second: FakeMigration = buildMigration({ name: "two" });

      first.migrate.mockImplementation(async (): Promise<void> => {
        order.push("one");
      });
      second.migrate.mockImplementation(async (): Promise<void> => {
        order.push("two");
      });

      startupMigrations.push(first, second);

      await RunStartupMigrations();

      expect(order).toEqual(["one", "two"]);
    });

    test("a failing migration never blocks the ones after it", async () => {
      const failing: FakeMigration = buildMigration({
        name: "one",
        fails: true,
      });
      const healthy: FakeMigration = buildMigration({ name: "two" });
      startupMigrations.push(failing, healthy);

      await expect(RunStartupMigrations()).resolves.toBeUndefined();

      /*
       * Unlike data migrations these must never halt the chain or crash the
       * pod: they sync env-driven state on every boot, and a bad one would
       * otherwise wedge the whole worker tier.
       */
      expect(healthy.migrate).toHaveBeenCalledTimes(1);
    });

    test("skips cleanly when Postgres is not connected", async () => {
      dataSource = null;
      startupMigrations.push(buildMigration({ name: "one" }));

      await expect(RunStartupMigrations()).resolves.toBeUndefined();
      expect(startupMigrations[0]!.migrate).not.toHaveBeenCalled();
    });

    test("concurrent replicas both run them -- this one is by design", async () => {
      /*
       * RunStartupMigrations is deliberately NOT gated on
       * RUN_DATABASE_MIGRATIONS_ON_BOOT (see Workers/Index.ts), so the migrate
       * Job does not cover it either: every worker replica runs these on every
       * boot, and a rolling deploy runs them N-at-a-time. That was true with
       * the advisory lock too -- the lock only made them take turns.
       */
      const migration: FakeMigration = buildMigration({ name: "one" });
      startupMigrations.push(migration);

      await Promise.all([RunStartupMigrations(), RunStartupMigrations()]);

      expect(migration.migrate).toHaveBeenCalledTimes(2);
    });
  });
});
