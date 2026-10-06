import Database from "../../../Server/Infrastructure/PostgresDatabase";
import SchemaMigrationRunner, {
  SchemaMigrationLockTimeoutError,
} from "../../../Server/Infrastructure/Postgres/SchemaMigrationRunner";
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
import { DataSource, DataSourceOptions } from "typeorm";

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
 *  - a runtime pod (a migrate Job owns migrations) does not run them;
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

  test("a runtime pod does not run them at all", async () => {
    useOptions(false);

    await Database.connect();

    expect(events).toEqual(["initialize"]);
    expect(runner).not.toHaveBeenCalled();
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
