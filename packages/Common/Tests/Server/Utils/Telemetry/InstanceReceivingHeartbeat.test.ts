import InstanceReceivingHeartbeat from "../../../../Server/Utils/Telemetry/InstanceReceivingHeartbeat";
import InstanceReceivingPeriodService from "../../../../Server/Services/InstanceReceivingPeriodService";
import ReceivingCoverage from "../../../../Server/Utils/Telemetry/ReceivingCoverage";
import Redis from "../../../../Server/Infrastructure/Redis";
import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import GracefulShutdown, {
  ShutdownPriority,
} from "../../../../Server/Utils/GracefulShutdown";
import logger from "../../../../Server/Utils/Logger";
import { RECEIVING_HEARTBEAT_INTERVAL_MS } from "../../../../Utils/Telemetry/ReceivingGaps";
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
 * Issue #2825: the receiving heartbeat is how OneUptime knows, afterwards,
 * when it was not receiving. A process records it only while it really can
 * take in and store data, never more than one at a time, and never fails the
 * process when it cannot.
 */

let recordReceiving: SpyInstance<
  typeof InstanceReceivingPeriodService.recordReceiving
>;
let pruneOldPeriods: SpyInstance<
  typeof InstanceReceivingPeriodService.pruneOldPeriods
>;
let redisUp: SpyInstance<typeof Redis.checkConnnectionStatus>;
let clickhouseUp: SpyInstance<
  typeof ClickhouseAppInstance.checkConnnectionStatus
>;

type HeartbeatState = {
  lastPruneAtMs: number;
  stopped: boolean;
  beatInFlight: Promise<boolean> | null;
};

function resetHeartbeatState(): void {
  InstanceReceivingHeartbeat.stop();
  const state: HeartbeatState =
    InstanceReceivingHeartbeat as unknown as HeartbeatState;
  state.lastPruneAtMs = 0;
  state.stopped = false;
  state.beatInFlight = null;
}

// Lets every promise that is ready run, without moving any clock.
async function flush(): Promise<void> {
  for (let i: number = 0; i < 25; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  resetHeartbeatState();
  recordReceiving = jest
    .spyOn(InstanceReceivingPeriodService, "recordReceiving")
    .mockResolvedValue(false);
  pruneOldPeriods = jest
    .spyOn(InstanceReceivingPeriodService, "pruneOldPeriods")
    .mockResolvedValue(0);
  redisUp = jest.spyOn(Redis, "checkConnnectionStatus").mockResolvedValue(true);
  clickhouseUp = jest
    .spyOn(ClickhouseAppInstance, "checkConnnectionStatus")
    .mockResolvedValue(true);
  jest.spyOn(logger, "info").mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  resetHeartbeatState();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("InstanceReceivingHeartbeat.beat", () => {
  test("records that OneUptime is receiving while it can take in and store data", async () => {
    expect(await InstanceReceivingHeartbeat.beat()).toBe(true);
    expect(recordReceiving).toHaveBeenCalledTimes(1);
  });

  test("records nothing while the ingest queue (Valkey) is unreachable", async () => {
    redisUp.mockResolvedValue(false);
    expect(await InstanceReceivingHeartbeat.beat()).toBe(false);
    expect(recordReceiving).not.toHaveBeenCalled();
  });

  test("records nothing while the telemetry store (ClickHouse) is unreachable", async () => {
    clickhouseUp.mockResolvedValue(false);
    expect(await InstanceReceivingHeartbeat.beat()).toBe(false);
    expect(recordReceiving).not.toHaveBeenCalled();
  });

  test("a failed write is a missing heartbeat, never a thrown error", async () => {
    recordReceiving.mockRejectedValue(new Error("Postgres down"));
    expect(await InstanceReceivingHeartbeat.beat()).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  test("the first heartbeat after a gap drops the cached open gap and says receiving resumed", async () => {
    const clearCache: SpyInstance<typeof ReceivingCoverage.clearCache> =
      jest.spyOn(ReceivingCoverage, "clearCache");
    recordReceiving.mockResolvedValue(true);

    await InstanceReceivingHeartbeat.beat();

    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "This instance is receiving data again. The time it was not receiving is not held against any resource.",
    );
  });

  test("an ordinary heartbeat leaves the cache alone", async () => {
    const clearCache: SpyInstance<typeof ReceivingCoverage.clearCache> =
      jest.spyOn(ReceivingCoverage, "clearCache");

    await InstanceReceivingHeartbeat.beat();

    expect(clearCache).not.toHaveBeenCalled();
  });

  test("a slow database never stacks heartbeats: one write at a time", async () => {
    let release: (started: boolean) => void = () => {};
    recordReceiving.mockImplementation(() => {
      return new Promise<boolean>((resolve: (started: boolean) => void) => {
        release = resolve;
      });
    });

    const first: Promise<boolean> = InstanceReceivingHeartbeat.beat();
    const second: Promise<boolean> = InstanceReceivingHeartbeat.beat();
    // The write has started and is waiting on the database.
    await flush();
    expect(recordReceiving).toHaveBeenCalledTimes(1);
    release(false);

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(recordReceiving).toHaveBeenCalledTimes(1);
  });

  test("once stopped, a process records nothing more", async () => {
    InstanceReceivingHeartbeat.stop();
    expect(await InstanceReceivingHeartbeat.beat()).toBe(false);
    expect(recordReceiving).not.toHaveBeenCalled();
  });

  test("old periods are pruned on the first heartbeat, then at most every few hours", async () => {
    await InstanceReceivingHeartbeat.beat();
    await InstanceReceivingHeartbeat.beat();
    expect(pruneOldPeriods).toHaveBeenCalledTimes(1);
    expect(InstanceReceivingHeartbeat.PRUNE_INTERVAL_MS).toBeGreaterThanOrEqual(
      60 * 60_000,
    );
  });

  test("a failed prune is logged and the heartbeat still counts", async () => {
    pruneOldPeriods.mockRejectedValue(new Error("lock timeout"));
    expect(await InstanceReceivingHeartbeat.beat()).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("InstanceReceivingHeartbeat.start", () => {
  test("beats at once, then every interval, and stops vouching as the process stops taking requests", async () => {
    jest.useFakeTimers();
    const register: SpyInstance<typeof GracefulShutdown.registerHandler> = jest
      .spyOn(GracefulShutdown, "registerHandler")
      .mockImplementation(() => {});

    InstanceReceivingHeartbeat.start();
    await flush();
    expect(recordReceiving).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(RECEIVING_HEARTBEAT_INTERVAL_MS);
    await flush();
    expect(recordReceiving).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(RECEIVING_HEARTBEAT_INTERVAL_MS);
    await flush();
    jest.advanceTimersByTime(RECEIVING_HEARTBEAT_INTERVAL_MS);
    await flush();
    expect(recordReceiving).toHaveBeenCalledTimes(4);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]![0]).toBe("InstanceReceivingHeartbeat");
    expect(register.mock.calls[0]![1]).toBe(ShutdownPriority.HttpServer);

    // The shutdown handler stops the heartbeat.
    (register.mock.calls[0]![2] as () => void)();
    jest.advanceTimersByTime(5 * RECEIVING_HEARTBEAT_INTERVAL_MS);
    await flush();
    expect(recordReceiving).toHaveBeenCalledTimes(4);
  });

  test("starting twice does not start a second heartbeat", async () => {
    jest.useFakeTimers();
    jest
      .spyOn(GracefulShutdown, "registerHandler")
      .mockImplementation(() => {});

    InstanceReceivingHeartbeat.start();
    InstanceReceivingHeartbeat.start();
    await flush();
    jest.advanceTimersByTime(RECEIVING_HEARTBEAT_INTERVAL_MS);
    await flush();

    expect(recordReceiving).toHaveBeenCalledTimes(2);
  });

  test("a process ingress does not reach never vouches (RECEIVES_INGRESS_TRAFFIC=false)", async () => {
    const started: IsolatedStart = await startInFreshProcess("false");

    expect(started.recordReceiving).not.toHaveBeenCalled();
    expect(started.registerHandler).not.toHaveBeenCalled();
  });

  test("a process that takes ingress (the variable unset) vouches at once, so the check above is not vacuous", async () => {
    const started: IsolatedStart = await startInFreshProcess(undefined);

    expect(started.recordReceiving).toHaveBeenCalledTimes(1);
    expect(started.registerHandler).toHaveBeenCalledTimes(1);
  });
});

interface IsolatedStart {
  recordReceiving: SpyInstance<
    typeof InstanceReceivingPeriodService.recordReceiving
  >;
  registerHandler: SpyInstance<typeof GracefulShutdown.registerHandler>;
}

/*
 * Starts the heartbeat as a freshly booted process with RECEIVES_INGRESS_TRAFFIC
 * set to `value` would: EnvironmentConfig reads the variable once, at import,
 * so every module is loaded anew in an isolated registry, with that copy's
 * datastores up and its writes stood in for.
 */
async function startInFreshProcess(
  value: string | undefined,
): Promise<IsolatedStart> {
  const previous: string | undefined = process.env["RECEIVES_INGRESS_TRAFFIC"];

  if (value === undefined) {
    delete process.env["RECEIVES_INGRESS_TRAFFIC"];
  } else {
    process.env["RECEIVES_INGRESS_TRAFFIC"] = value;
  }

  let started: IsolatedStart | null = null;
  let stop: () => void = (): void => {};

  try {
    jest.isolateModules(() => {
      const heartbeat: typeof InstanceReceivingHeartbeat = (
        jest.requireActual(
          "../../../../Server/Utils/Telemetry/InstanceReceivingHeartbeat",
        ) as { default: typeof InstanceReceivingHeartbeat }
      ).default;
      const service: typeof InstanceReceivingPeriodService = (
        jest.requireActual(
          "../../../../Server/Services/InstanceReceivingPeriodService",
        ) as { default: typeof InstanceReceivingPeriodService }
      ).default;
      const redis: typeof Redis = (
        jest.requireActual("../../../../Server/Infrastructure/Redis") as {
          default: typeof Redis;
        }
      ).default;
      const clickhouse: typeof ClickhouseAppInstance = (
        jest.requireActual(
          "../../../../Server/Infrastructure/ClickhouseDatabase",
        ) as { ClickhouseAppInstance: typeof ClickhouseAppInstance }
      ).ClickhouseAppInstance;
      const shutdown: typeof GracefulShutdown = (
        jest.requireActual("../../../../Server/Utils/GracefulShutdown") as {
          default: typeof GracefulShutdown;
        }
      ).default;

      jest.spyOn(redis, "checkConnnectionStatus").mockResolvedValue(true);
      jest.spyOn(clickhouse, "checkConnnectionStatus").mockResolvedValue(true);
      jest.spyOn(service, "pruneOldPeriods").mockResolvedValue(0);

      started = {
        recordReceiving: jest
          .spyOn(service, "recordReceiving")
          .mockResolvedValue(false),
        registerHandler: jest
          .spyOn(shutdown, "registerHandler")
          .mockImplementation(() => {}),
      };

      heartbeat.start();
      stop = (): void => {
        heartbeat.stop();
      };
    });

    await flush();
  } finally {
    stop();

    if (previous === undefined) {
      delete process.env["RECEIVES_INGRESS_TRAFFIC"];
    } else {
      process.env["RECEIVES_INGRESS_TRAFFIC"] = previous;
    }
  }

  return started!;
}
