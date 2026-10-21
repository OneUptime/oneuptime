import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Redis from "../../../Server/Infrastructure/Redis";
import InfrastructureStatus from "../../../Server/Infrastructure/Status";
import logger from "../../../Server/Utils/Logger";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
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

/*
 * InfrastructureStatus.checkStatusWithRetry is the readiness check the App
 * (app, worker and telemetry-writer pods) and the ingress hand to StatusAPI,
 * and the App's per-datastore checks behind /status/database,
 * /status/analytics-database and /status/global-cache. StatusAPI answers
 * non-2xx only when the check throws, so once the retries run out the loop
 * has to give the error back.
 *
 * It used to swallow it: every attempt failed, the loop ended, and the probe
 * answered 200 about three seconds later. Readiness never failed on a
 * datastore outage, and the deep checks reported a dead datastore as up.
 */

type CheckOptions = Parameters<
  typeof InfrastructureStatus.checkStatusWithRetry
>[0];

const POSTGRES_ONLY: CheckOptions = {
  retryCount: 3,
  checkRedisStatus: false,
  checkPostgresStatus: true,
  checkClickhouseStatus: false,
};

describe("InfrastructureStatus.checkStatusWithRetry", () => {
  let postgres: SpyInstance<() => Promise<boolean>>;
  let redis: SpyInstance<() => Promise<boolean>>;
  let clickhouse: SpyInstance<() => Promise<boolean>>;
  let sleep: SpyInstance<(ms: number) => Promise<void>>;

  beforeEach(() => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    postgres = jest
      .spyOn(PostgresAppInstance, "checkConnnectionStatus")
      .mockResolvedValue(true);
    redis = jest.spyOn(Redis, "checkConnnectionStatus").mockResolvedValue(true);
    clickhouse = jest
      .spyOn(ClickhouseAppInstance, "checkConnnectionStatus")
      .mockResolvedValue(true);
    sleep = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("rejects with the datastore's error once every attempt has failed", async () => {
    postgres.mockResolvedValue(false);

    const result: Promise<void> =
      InfrastructureStatus.checkStatusWithRetry(POSTGRES_ONLY);

    await expect(result).rejects.toBeInstanceOf(DatabaseNotConnectedException);
    await expect(result).rejects.toThrow("Postgres is not connected");
    expect(postgres).toHaveBeenCalledTimes(3);
  });

  test("pauses a second between attempts, but not after the last one", async () => {
    postgres.mockResolvedValue(false);

    await expect(
      InfrastructureStatus.checkStatusWithRetry(POSTGRES_ONLY),
    ).rejects.toThrow();

    // Waiting after the final attempt would only delay the failed probe.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
  });

  test("resolves as soon as an attempt succeeds", async () => {
    postgres.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(
      InfrastructureStatus.checkStatusWithRetry(POSTGRES_ONLY),
    ).resolves.toBeUndefined();

    expect(postgres).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test("makes one attempt and no pause when the datastore is up", async () => {
    await expect(
      InfrastructureStatus.checkStatusWithRetry(POSTGRES_ONLY),
    ).resolves.toBeUndefined();

    expect(postgres).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  /*
   * The message is the body of the failed probe, the first thing an operator
   * reads. It should name what is still broken, not what was broken on the
   * first attempt.
   */
  test("rejects with the error from the last attempt", async () => {
    redis.mockResolvedValueOnce(false);
    postgres.mockResolvedValue(false);

    await expect(
      InfrastructureStatus.checkStatusWithRetry({
        ...POSTGRES_ONLY,
        checkRedisStatus: true,
      }),
    ).rejects.toThrow("Postgres is not connected");

    expect(redis).toHaveBeenCalledTimes(3);
  });

  /*
   * A loop that never runs would report healthy without checking anything,
   * which is the bug this suite is about, reached a different way.
   */
  test("still makes one attempt when retryCount is below one", async () => {
    postgres.mockResolvedValue(false);

    await expect(
      InfrastructureStatus.checkStatusWithRetry({
        ...POSTGRES_ONLY,
        retryCount: 0,
      }),
    ).rejects.toThrow("Postgres is not connected");

    expect(postgres).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("checks only the datastores it is asked to", async () => {
    postgres.mockResolvedValue(false);
    redis.mockResolvedValue(false);
    clickhouse.mockResolvedValue(false);

    await expect(
      InfrastructureStatus.checkStatusWithRetry({
        retryCount: 3,
        checkRedisStatus: false,
        checkPostgresStatus: false,
        checkClickhouseStatus: false,
      }),
    ).resolves.toBeUndefined();

    expect(postgres).not.toHaveBeenCalled();
    expect(redis).not.toHaveBeenCalled();
    expect(clickhouse).not.toHaveBeenCalled();
  });
});
