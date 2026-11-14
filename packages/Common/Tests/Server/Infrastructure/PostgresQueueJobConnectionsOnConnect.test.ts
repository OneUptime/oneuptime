import Database from "../../../Server/Infrastructure/PostgresDatabase";
import QueueJobConnections from "../../../Server/Infrastructure/Postgres/QueueJobConnections";
import SchemaMigrationWait from "../../../Server/Infrastructure/Postgres/SchemaMigrationWait";
import {
  DatabaseConnectionShares,
  DisableQueueWorkers,
  MaxPostgresConnections,
  PostgresConnectionAcquireTimeoutMs,
  ReceivesIngressTraffic,
} from "../../../Server/EnvironmentConfig";
import GracefulShutdown from "../../../Server/Utils/GracefulShutdown";
import logger from "../../../Server/Utils/Logger";
import KeyedConcurrencyLimiter from "../../../Server/Utils/KeyedConcurrencyLimiter";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, DataSourceOptions } from "typeorm";

/*
 * PostgresDatabase.connect() caps the connections queue jobs borrow from
 * the app's pool as soon as it is open (#7920): with the defaults - a
 * process that serves requests and runs the queue workers, a pool of 50 -
 * queue jobs hold at most 30, waiting as long as a checkout from the pool
 * does. The database is stubbed; QueueJobConnections.limitsFor's own suite
 * covers the processes that get no cap.
 */

const OPTIONS: DataSourceOptions = {
  type: "postgres",
  host: "db",
  migrationsRun: false,
} as DataSourceOptions;

describe("PostgresDatabase.connect() and the queue jobs' share of the pool", () => {
  let dataSource: DataSource | null = null;

  beforeEach(() => {
    (Database as unknown as { dataSource: DataSource | null }).dataSource =
      null;
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(Database, "getDatasourceOptions").mockReturnValue(OPTIONS);
    jest
      .spyOn(DataSource.prototype, "initialize")
      .mockImplementation(async function (this: DataSource) {
        Object.assign(this, { isInitialized: true });
        return this;
      });
    jest
      .spyOn(SchemaMigrationWait, "waitForPendingMigrations")
      .mockImplementation(async () => {
        return undefined;
      });
    jest.spyOn(GracefulShutdown, "registerHandler").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    if (dataSource) {
      QueueJobConnections.uninstall(dataSource);
    }
    (Database as unknown as { dataSource: DataSource | null }).dataSource =
      null;
    jest.restoreAllMocks();
  });

  test("the defaults: queue jobs hold at most 30 of the pool's 50, and wait as long as a checkout does", async () => {
    expect(DisableQueueWorkers).toBe(false);
    expect(ReceivesIngressTraffic).toBe(true);
    expect(MaxPostgresConnections).toBe(50);

    dataSource = await Database.connect();

    const limiter: KeyedConcurrencyLimiter | undefined =
      QueueJobConnections.limiterOf(dataSource);
    expect(limiter).toBeDefined();
    expect(limiter!.limits.maxRunning).toBe(30);
    expect(limiter!.limits.maxRunning).toBe(
      DatabaseConnectionShares.maxQueueJobConnections,
    );
    expect(limiter!.limits.maxWaitMs).toBe(PostgresConnectionAcquireTimeoutMs);
    expect(DatabaseConnectionShares.connectionsKeptForRequests).toBe(10);

    // And says so once, at boot, with the settings that change it.
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("DATABASE_MAX_QUEUE_JOB_CONNECTIONS"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("so requests always have 10"),
    );
  });
});
