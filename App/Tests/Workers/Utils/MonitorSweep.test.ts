import Monitor from "Common/Models/DatabaseModels/Monitor";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "Common/Server/Infrastructure/Semaphore";
import MonitorService from "Common/Server/Services/MonitorService";
import QueryHelper, {
  type FindOperator,
} from "Common/Server/Types/Database/QueryHelper";
import FindBy from "Common/Server/Types/Database/FindBy";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import runMonitorSweep, {
  MONITOR_SWEEP_BATCH_SIZE,
  MONITOR_SWEEP_CONCURRENCY,
} from "../../../FeatureSet/Workers/Utils/MonitorSweep";

jest.mock("Common/Server/Services/MonitorService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    SemaphoreLockTimeoutError: class extends Error {},
    default: { lock: jest.fn(), release: jest.fn() },
  };
});
jest.mock("Common/Server/Utils/Logger", () => {
  return { __esModule: true, default: { debug: jest.fn(), error: jest.fn() } };
});

const findBy: jest.Mock = MonitorService.findBy as jest.Mock;
const lock: jest.Mock = Semaphore.lock as jest.Mock;
const release: jest.Mock = Semaphore.release as jest.Mock;
let mutex: { isAcquired: boolean };

function monitors(count: number, offset: number = 0): Array<Monitor> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return new Monitor(
      new ObjectID(`monitor-${String(index + offset).padStart(6, "0")}`),
    );
  });
}

function tick(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setImmediate(resolve);
  });
}

function run(
  processMonitor: (monitor: Monitor) => Promise<void> = async () => {},
): Promise<void> {
  return runMonitorSweep({
    jobName: "test-sweep",
    queries: [{ disableActiveMonitoring: false }],
    select: { monitorSteps: true },
    processMonitor,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mutex = { isAcquired: true };
  lock.mockResolvedValue(mutex);
  release.mockResolvedValue(undefined);
  findBy.mockResolvedValue([]);
});

describe("bounded monitor sweeps", () => {
  test("acquires one renewing cluster lock without waiting behind another tick", async () => {
    await run();
    expect(lock).toHaveBeenCalledWith({
      namespace: "monitor-heartbeat-sweep",
      key: "test-sweep",
      lockTimeout: 60_000,
      acquireAttemptsLimit: 1,
    });
    expect(release).toHaveBeenCalledWith(mutex);
  });

  test("lock contention skips the tick quietly without querying monitors", async () => {
    lock.mockRejectedValue(new SemaphoreLockTimeoutError("already locked"));
    await run();
    expect(findBy).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("overlapping worker ticks cannot start a second sweep before pending evaluations settle", async () => {
    let held: boolean = false;
    lock.mockImplementation(async () => {
      if (held) {
        throw new SemaphoreLockTimeoutError("already locked");
      }
      held = true;
      return mutex;
    });
    release.mockImplementation(async () => {
      held = false;
    });
    findBy.mockResolvedValue(monitors(1));
    let finish!: () => void;
    const pending: Promise<void> = new Promise((resolve: () => void) => {
      finish = resolve;
    });
    const first: Promise<void> = run(async () => {
      await pending;
    });
    await tick();
    const secondProcess: jest.Mock = jest.fn();
    await run(secondProcess);
    expect(secondProcess).not.toHaveBeenCalled();
    expect(findBy).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    finish();
    await first;
    await run(secondProcess);
    expect(secondProcess).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(2);
  });

  test("Redis acquisition failures skip the tick with a visible error", async () => {
    const failure: Error = new Error("Redis client is not connected");
    lock.mockRejectedValue(failure);
    await run();
    expect(findBy).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(failure);
  });

  test("empty pages require no processing and release the lock", async () => {
    const process: jest.Mock = jest.fn();
    await run(process);
    expect(process).not.toHaveBeenCalled();
    expect(findBy).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test.each([
    1,
    MONITOR_SWEEP_BATCH_SIZE - 1,
    MONITOR_SWEEP_BATCH_SIZE,
    MONITOR_SWEEP_BATCH_SIZE + 1,
    1003,
  ])(
    "processes all %i monitors once using bounded pages and immutable ID cursors",
    async (count: number) => {
      const rows: Array<Monitor> = monitors(count);
      findBy.mockImplementation(async (args: FindBy<Monitor>) => {
        expect(args.skip).toBe(0);
        expect(args.limit).toBe(MONITOR_SWEEP_BATCH_SIZE);
        expect(args.sort).toEqual({ _id: SortOrder.Ascending });
        expect(args.select).toEqual({ _id: true, monitorSteps: true });
        expect(args.props).toEqual({ isRoot: true });
        expect(args.query.disableActiveMonitoring).toBe(false);
        const cursor: FindOperator<ObjectID> | undefined = args.query._id as
          | FindOperator<ObjectID>
          | undefined;
        if (cursor) {
          expect(cursor.getSql!("_id")).toMatch(/_id > :/);
        }
        const after: string = cursor
          ? String(Object.values(cursor.objectLiteralParameters!)[0])
          : "";
        return rows
          .filter((row: Monitor) => {
            return row.id!.toString() > after;
          })
          .slice(0, Number(args.limit));
      });
      const process: jest.Mock = jest.fn().mockResolvedValue(undefined);
      await run(process);
      expect(
        process.mock.calls.map((call: Array<Monitor>) => {
          return call[0]!.id!.toString();
        }),
      ).toEqual(
        rows.map((row: Monitor) => {
          return row.id!.toString();
        }),
      );
      expect(findBy).toHaveBeenCalledTimes(
        Math.floor(count / MONITOR_SWEEP_BATCH_SIZE) + 1,
      );
    },
  );

  test("a malformed page cannot turn into an endless sweep", async () => {
    findBy.mockResolvedValueOnce([new Monitor()]);
    await expect(run()).rejects.toThrow("did not advance its ID cursor");
    expect(findBy).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("a repeated page fails instead of continuously processing the same monitors", async () => {
    findBy.mockResolvedValue(monitors(MONITOR_SWEEP_BATCH_SIZE));
    const process: jest.Mock = jest.fn().mockResolvedValue(undefined);
    await expect(run(process)).rejects.toThrow("did not advance its ID cursor");
    expect(process).toHaveBeenCalledTimes(MONITOR_SWEEP_BATCH_SIZE);
    expect(findBy).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("holds at most ten evaluations and fetches no next page until all active work completes", async () => {
    findBy
      .mockResolvedValueOnce(monitors(MONITOR_SWEEP_BATCH_SIZE))
      .mockResolvedValueOnce(monitors(1, MONITOR_SWEEP_BATCH_SIZE));
    const pending: Array<() => void> = [];
    let active: number = 0;
    let peak: number = 0;
    let completed: boolean = false;
    const work: Promise<void> = run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve: () => void) => {
        pending.push(resolve);
      });
      active--;
    }).then(() => {
      completed = true;
    });
    await tick();
    expect(active).toBe(MONITOR_SWEEP_CONCURRENCY);
    expect(findBy).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    expect(release).not.toHaveBeenCalled();
    for (
      let batch: number = 0;
      batch < MONITOR_SWEEP_BATCH_SIZE / MONITOR_SWEEP_CONCURRENCY;
      batch++
    ) {
      pending.splice(0).forEach((resolve: () => void) => {
        resolve();
      });
      await tick();
      if (batch < MONITOR_SWEEP_BATCH_SIZE / MONITOR_SWEEP_CONCURRENCY - 1) {
        expect(findBy).toHaveBeenCalledTimes(1);
      }
    }
    expect(findBy).toHaveBeenCalledTimes(2);
    expect(active).toBe(1);
    expect(completed).toBe(false);
    pending.splice(0).forEach((resolve: () => void) => {
      resolve();
    });
    await work;
    expect(peak).toBe(MONITOR_SWEEP_CONCURRENCY);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("continues through synchronous and asynchronous per-monitor failures", async () => {
    const rows: Array<Monitor> = monitors(MONITOR_SWEEP_BATCH_SIZE + 1);
    findBy
      .mockResolvedValueOnce(rows.slice(0, MONITOR_SWEEP_BATCH_SIZE))
      .mockResolvedValueOnce(rows.slice(MONITOR_SWEEP_BATCH_SIZE));
    const process: jest.Mock = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("sync failure");
      })
      .mockRejectedValueOnce(new Error("async failure"))
      .mockResolvedValue(undefined);
    await run(process);
    expect(process).toHaveBeenCalledTimes(rows.length);
    expect(logger.error).toHaveBeenCalledTimes(4);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("releases the lock and propagates a page query failure", async () => {
    const failure: Error = new Error("database offline");
    findBy.mockRejectedValue(failure);
    await expect(run()).rejects.toBe(failure);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("release failures do not hide the original query failure", async () => {
    const failure: Error = new Error("database offline");
    findBy.mockRejectedValue(failure);
    release.mockRejectedValue(new Error("redis offline"));
    await expect(run()).rejects.toBe(failure);
    expect(logger.error).toHaveBeenCalled();
  });

  test("stops starting work after losing the renewing lock", async () => {
    findBy.mockResolvedValueOnce(monitors(MONITOR_SWEEP_BATCH_SIZE));
    const process: jest.Mock = jest.fn().mockImplementation(async () => {
      mutex.isAcquired = false;
    });
    await run(process);
    expect(process).toHaveBeenCalledTimes(1);
    expect(findBy).toHaveBeenCalledTimes(1);
  });

  test("changing membership during processing does not skip later rows or revisit newly stamped rows in the second phase", async () => {
    const startedAt: Date = new Date("2026-09-04T12:00:00Z");
    const rows: Array<Monitor> = monitors(253);
    rows.forEach((row: Monitor, index: number) => {
      if (index >= 203) {
        row.incomingRequestMonitorHeartbeatCheckedAt = new Date(
          "2026-09-04T11:00:00Z",
        );
      }
    });
    findBy.mockImplementation(async (args: FindBy<Monitor>) => {
      const stamp: FindOperator<Date> = args.query
        .incomingRequestMonitorHeartbeatCheckedAt as FindOperator<Date>;
      const isNull: boolean = stamp.getSql!("stamp").includes("IS NULL");
      const cursor: FindOperator<ObjectID> | undefined = args.query._id as
        | FindOperator<ObjectID>
        | undefined;
      const after: string = cursor
        ? String(Object.values(cursor.objectLiteralParameters!)[0])
        : "";
      return rows
        .filter((row: Monitor) => {
          return (
            row.id!.toString() > after &&
            (isNull
              ? !row.incomingRequestMonitorHeartbeatCheckedAt
              : Boolean(
                  row.incomingRequestMonitorHeartbeatCheckedAt &&
                    row.incomingRequestMonitorHeartbeatCheckedAt < startedAt,
                ))
          );
        })
        .slice(0, Number(args.limit));
    });
    const processed: Array<string> = [];
    await runMonitorSweep({
      jobName: "heartbeat",
      queries: [
        { incomingRequestMonitorHeartbeatCheckedAt: QueryHelper.isNull() },
        {
          incomingRequestMonitorHeartbeatCheckedAt:
            QueryHelper.lessThan(startedAt),
        },
      ],
      select: { _id: true },
      processMonitor: async (row: Monitor) => {
        processed.push(row.id!.toString());
        row.incomingRequestMonitorHeartbeatCheckedAt = startedAt;
      },
    });
    expect(processed).toHaveLength(rows.length);
    expect(new Set(processed).size).toBe(rows.length);
    expect(findBy).toHaveBeenCalledTimes(4);
  });
});
