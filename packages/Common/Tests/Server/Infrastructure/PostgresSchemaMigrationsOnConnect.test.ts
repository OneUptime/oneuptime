import Database from "../../../Server/Infrastructure/PostgresDatabase";
import SchemaMigrationRunner, {
  SchemaMigrationLockTimeoutError,
} from "../../../Server/Infrastructure/Postgres/SchemaMigrationRunner";
import SchemaMigrationWait, {
  SchemaMigrationWaitPolicy,
  SchemaMigrationWaitTimeoutError,
} from "../../../Server/Infrastructure/Postgres/SchemaMigrationWait";
import * as MigrationFailureLog from "../../../Server/Utils/Database/MigrationFailureLog";
import GracefulShutdown from "../../../Server/Utils/GracefulShutdown";
import logger from "../../../Server/Utils/Logger";
import Sleep from "../../../Types/Sleep";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import {
  DataSource,
  DataSourceOptions,
  Migration,
  MigrationExecutor,
} from "typeorm";

/*
 * Where PostgresDatabase.connect() applies the schema migrations.
 *
 * It used to leave them to TypeORM: `migrationsRun` on the app's own
 * DataSource ran them inside initialize(), on the app pool, whose sessions in
 * a migrating process have no lock_timeout. A migration that had to wait for
 * a lock then sat at the head of that table's lock queue for as long as the
 * blocking transaction lived, and everything else on the table waited behind
 * it. Now initialize() never runs them; SchemaMigrationRunner does, on a
 * connection of its own with a bounded lock wait, retrying a migration that
 * runs out.
 *
 * What these pin, with the database, the runner and the pause stubbed:
 *
 *  - a process that runs migrations runs them through the runner, after the
 *    pool is up, and never through initialize();
 *  - a runtime pod (a migrate Job owns migrations) does not run them, but
 *    does not start on a schema older than its code either: it waits for
 *    them on its pool, and is not connected until they are applied - in
 *    14.0.13 the new worker pods started on the old schema, and no monitor
 *    was processed until AddArchiveToMoreResources committed;
 *  - a wait that runs out fails the boot at once, like a lock timeout, and
 *    the pod is restarted to wait again rather than started;
 *  - a migration that could not get its locks fails the boot at once - the
 *    runner has already spent its retry window, and three more rounds of it
 *    would only hold the deploy longer - and is recorded for the admin page;
 *  - any other failure keeps the reconnect retries it always had.
 */

const OPTIONS: DataSourceOptions = {
  type: "postgres",
  host: "db",
  extra: { statement_timeout: 30000 },
} as DataSourceOptions;

describe("PostgresDatabase.connect() and the schema migrations", () => {
  let initialized: Array<DataSourceOptions>;
  let events: Array<string>;
  let runner: SpyInstance<
    (options: DataSourceOptions) => Promise<Array<string>>
  >;
  let wait: SpyInstance<
    (
      dataSource: DataSource,
      policy?: SchemaMigrationWaitPolicy,
    ) => Promise<void>
  >;
  let destroy: SpyInstance<() => Promise<void>>;
  let sleep: SpyInstance<(ms: number) => Promise<void>>;
  let record: SpyInstance<
    (options: DataSourceOptions, error: unknown) => Promise<void>
  >;

  function useOptions(migrationsRun: boolean): DataSourceOptions {
    const options: DataSourceOptions = {
      ...OPTIONS,
      migrationsRun: migrationsRun,
    } as DataSourceOptions;
    jest.spyOn(Database, "getDatasourceOptions").mockReturnValue(options);
    return options;
  }

  beforeEach(() => {
    (Database as unknown as { dataSource: DataSource | null }).dataSource =
      null;
    initialized = [];
    events = [];

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest
      .spyOn(DataSource.prototype, "initialize")
      .mockImplementation(async function (this: DataSource) {
        initialized.push(this.options);
        events.push("initialize");
        Object.assign(this, { isInitialized: true });
        return this;
      });
    destroy = jest
      .spyOn(DataSource.prototype, "destroy")
      .mockImplementation(async function (this: DataSource) {
        events.push("destroy");
        Object.assign(this, { isInitialized: false });
      });
    runner = jest
      .spyOn(SchemaMigrationRunner, "runPendingMigrations")
      .mockImplementation(async () => {
        events.push("migrate");
        return [];
      });
    wait = jest
      .spyOn(SchemaMigrationWait, "waitForPendingMigrations")
      .mockImplementation(async () => {
        events.push("wait");
      });
    sleep = jest.spyOn(Sleep, "sleep").mockImplementation(async () => {
      return undefined;
    });
    record = jest
      .spyOn(MigrationFailureLog, "recordSchemaMigrationFailureBestEffort")
      .mockImplementation(async () => {
        return undefined;
      });
    jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    (Database as unknown as { dataSource: DataSource | null }).dataSource =
      null;
    jest.restoreAllMocks();
  });

  test("a process that runs migrations applies them through the runner, after the pool is up", async () => {
    const options: DataSourceOptions = useOptions(true);

    const dataSource: DataSource = await Database.connect();

    expect(events).toEqual(["initialize", "migrate"]);
    expect(runner).toHaveBeenCalledWith(options);
    expect(Database.getDataSource()).toBe(dataSource);
  });

  test("initialize() itself never runs them, on the app pool", async () => {
    useOptions(true);

    await Database.connect();

    expect(initialized).toHaveLength(1);
    expect(initialized[0]!.migrationsRun).toBe(false);
  });

  test("a process that runs them never waits for them", async () => {
    useOptions(true);

    await Database.connect();

    expect(wait).not.toHaveBeenCalled();
  });

  test("a runtime pod does not run them: it waits for them, on its own pool, after the pool is up", async () => {
    useOptions(false);

    const dataSource: DataSource = await Database.connect();

    expect(events).toEqual(["initialize", "wait"]);
    expect(runner).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait.mock.calls[0]![0]).toBe(dataSource);
    expect(Database.getDataSource()).toBe(dataSource);
  });

  test("a runtime pod is not connected while it waits, so it has not started", async () => {
    useOptions(false);
    let applied: () => void = () => {
      return undefined;
    };
    wait.mockImplementation(() => {
      events.push("wait");
      return new Promise<void>((resolve: () => void) => {
        applied = resolve;
      });
    });

    let connected: boolean = false;
    const connecting: Promise<DataSource> = Database.connect().then(
      (dataSource: DataSource) => {
        connected = true;
        return dataSource;
      },
    );

    // Let initialize() and everything up to the wait run.
    for (let tick: number = 0; tick < 10; tick++) {
      await Promise.resolve();
    }

    expect(events).toEqual(["initialize", "wait"]);
    expect(connected).toBe(false);
    expect(Database.isConnected()).toBe(false);
    expect(Database.getDataSource()).toBeNull();

    applied();
    const dataSource: DataSource = await connecting;

    expect(connected).toBe(true);
    expect(Database.getDataSource()).toBe(dataSource);
  });

  test("a wait that runs out fails the boot at once, without the reconnect retries", async () => {
    const options: DataSourceOptions = useOptions(false);
    const failure: SchemaMigrationWaitTimeoutError =
      new SchemaMigrationWaitTimeoutError({
        pendingMigrationNames: ["AddArchiveToMoreResources1797200000000"],
        waitedInMs: 900_000,
        lastError: null,
      });
    wait.mockImplementation(async () => {
      events.push("wait");
      throw failure;
    });

    await expect(Database.connect()).rejects.toBe(failure);

    // Its pool is closed, and it is not retried: that would wait 4 x 15 min.
    expect(events).toEqual(["initialize", "wait", "destroy"]);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(Database.getDataSource()).toBeNull();
    /*
     * Handed to the failure log as any boot failure is; it records nothing
     * for a process that does not run migrations (migrationsRun false).
     */
    expect(record).toHaveBeenCalledWith(options, failure);
  });

  test("with the real wait: a runtime pod connects once the migrate Job has applied what its code needs", async () => {
    useOptions(false);
    wait.mockRestore();
    const archive: Migration = {
      name: "AddArchiveToMoreResources1797200000000",
    } as Migration;
    const pending: SpyInstance<() => Promise<Array<Migration>>> = jest
      .spyOn(MigrationExecutor.prototype, "getPendingMigrations")
      .mockResolvedValueOnce([archive])
      .mockResolvedValueOnce([archive])
      .mockResolvedValue([]);

    const dataSource: DataSource = await Database.connect();

    // Read three times, five seconds apart (the pauses are stubbed).
    expect(pending).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[5000], [5000]]);
    expect(events).toEqual(["initialize"]);
    expect(Database.getDataSource()).toBe(dataSource);
  });

  test("a migration that could not get its locks fails the boot at once, recorded", async () => {
    const options: DataSourceOptions = useOptions(true);
    const failure: SchemaMigrationLockTimeoutError =
      new SchemaMigrationLockTimeoutError({
        migrationName: "AddArchiveToMoreResources1797200000000",
        attempts: 41,
        waitedInMs: 600_000,
        policy: {
          lockTimeoutInMs: 2000,
          retryTimeoutInMs: 600_000,
          firstRetryDelayInMs: 1000,
          maxRetryDelayInMs: 30_000,
        },
        lastError: Object.assign(new Error("lock timeout"), { code: "55P03" }),
      });
    runner.mockImplementation(async () => {
      events.push("migrate");
      throw failure;
    });

    await expect(Database.connect()).rejects.toBe(failure);

    expect(events).toEqual(["initialize", "migrate", "destroy"]);
    expect(sleep).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(options, failure);
    expect(Database.getDataSource()).toBeNull();
  });

  test("any other failure keeps the three reconnect attempts it always had", async () => {
    useOptions(true);
    const failure: Error = new Error("Connection terminated unexpectedly");
    runner.mockRejectedValue(failure);

    await expect(Database.connect()).rejects.toBe(failure);

    expect(runner).toHaveBeenCalledTimes(4);
    expect(destroy).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[5000], [5000], [5000]]);
    expect(record).toHaveBeenCalledTimes(1);
  });

  test("and connects once a later attempt gets through", async () => {
    useOptions(true);
    runner
      .mockRejectedValueOnce(new Error("Connection terminated unexpectedly"))
      .mockResolvedValueOnce([]);

    const dataSource: DataSource = await Database.connect();

    expect(events).toEqual(["initialize", "destroy", "initialize"]);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(Database.getDataSource()).toBe(dataSource);
    expect(record).not.toHaveBeenCalled();
  });

  test("a pool that will not close does not replace the real error", async () => {
    useOptions(true);
    const failure: SchemaMigrationLockTimeoutError =
      new SchemaMigrationLockTimeoutError({
        migrationName: "M1",
        attempts: 1,
        waitedInMs: 0,
        policy: {
          lockTimeoutInMs: 2000,
          retryTimeoutInMs: 0,
          firstRetryDelayInMs: 1000,
          maxRetryDelayInMs: 30_000,
        },
        lastError: new Error("lock timeout"),
      });
    runner.mockRejectedValue(failure);
    destroy.mockRejectedValue(new Error("pool already ended"));

    await expect(Database.connect()).rejects.toBe(failure);
  });
});
