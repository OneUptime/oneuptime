import { afterEach, describe, expect, test } from "@jest/globals";

// Nothing here runs a sandbox; the native isolated-vm addon need not load.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

// The worker's queue is never used here.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

import logger from "Common/Server/Utils/Logger";
import {
  MONITOR_EVALUATION_LOCK_LOST_MESSAGE,
  MONITOR_EVALUATION_LOCK_TIMEOUT_MS,
} from "Common/Server/Utils/Monitor/MonitorEvaluationLock";
import {
  GroupedMetricFleet,
  buildGroupedMetricFleet,
} from "./GroupedMetricMonitorFleet";
import {
  EvaluationRun,
  FakeValkey,
  runFleetEvaluation,
} from "./GroupedMetricMonitorHarness";

/*
 * THE MONITOR'S LOCK UNDER A SLOW EVALUATION (issue #10108).
 *
 * MonitorResourceUtil.monitorResource holds a per-monitor lock in Valkey
 * for the whole evaluation, kept by redis-semaphore's refresh timer. A
 * grouped monitor that held the event loop for 20 to 30 seconds let the
 * lock run out: the refresh fired late, threw LostLockError where nothing
 * could catch it (an unhandled rejection), and the evaluation carried on,
 * opening and resolving alerts without the lock.
 *
 * Each case runs the real evaluation (GroupedMetricMonitorHarness) under the
 * real redis-semaphore lock, over an in-memory Valkey whose keys expire on
 * the clock:
 *
 *   - an evaluation slower than the lock's timeout that hands the event
 *     loop back keeps its lock: it is refreshed, never lost, and the
 *     evaluation writes what it decided;
 *   - one that holds the loop past the timeout loses its lock, and stops at
 *     its next write instead of writing without it - nothing opened,
 *     resolved or changed, the loss said once, no unhandled rejection;
 *   - one whose lock Valkey loses part way through (a restart) is told by
 *     the refresh and stops the same way.
 */

const WINDOW_END_MS: number = Date.UTC(2026, 10, 17, 10, 5, 0);

function fleet(): GroupedMetricFleet {
  return buildGroupedMetricFleet({
    seriesCount: 300,
    windowEndMs: WINDOW_END_MS,
    specialPerThousand: 20,
    seed: 4242,
  });
}

function errorLines(
  errorLog: jest.SpiedFunction<typeof logger.error>,
): Array<string> {
  return errorLog.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a grouped monitor's evaluation and its lock", () => {
  test("an evaluation slower than the lock's timeout that hands the loop back keeps its lock", async () => {
    const errorLog: jest.SpiedFunction<typeof logger.error> = jest.spyOn(
      logger,
      "error",
    );

    // Its criteria take longer than the lock lasts, in slices.
    const run: EvaluationRun = await runFleetEvaluation({
      fleet: fleet(),
      slowCriteria: {
        ms: MONITOR_EVALUATION_LOCK_TIMEOUT_MS + 1_500,
        inOneBlock: false,
      },
    });

    expect(run.error).toBeNull();
    expect(run.measurement.unhandledRejections).toEqual([]);
    // Refreshed on its timer while the evaluation ran, and never lost.
    expect(run.measurement.lockRefreshes).toBeGreaterThanOrEqual(4);
    expect(run.measurement.lockRefreshFailures).toBe(0);
    expect(run.measurement.lockLost).toBe(false);
    // It wrote what it decided.
    expect(run.outcome.createdAlerts.length).toBeGreaterThan(0);
    expect(run.outcome.resolvedAlerts.length).toBeGreaterThan(0);
    expect(
      errorLines(errorLog).filter((line: string): boolean => {
        return line.includes("lost its lock");
      }),
    ).toEqual([]);
  }, 60_000);

  test("an evaluation that holds the loop past the timeout stops at its next write, and says so", async () => {
    const errorLog: jest.SpiedFunction<typeof logger.error> = jest.spyOn(
      logger,
      "error",
    );

    // One block longer than the lock lasts: it runs out in Valkey meanwhile.
    const run: EvaluationRun = await runFleetEvaluation({
      fleet: fleet(),
      slowCriteria: {
        ms: MONITOR_EVALUATION_LOCK_TIMEOUT_MS + 700,
        inOneBlock: true,
      },
    });

    // Stopped, with the reason, so the queue runs the job again.
    expect(run.error).toContain(MONITOR_EVALUATION_LOCK_LOST_MESSAGE);
    // Nothing written without the lock.
    expect(run.outcome.createdAlerts).toEqual([]);
    expect(run.outcome.resolvedAlerts).toEqual([]);
    expect(run.outcome.statusChanges).toEqual([]);
    // Never an unhandled rejection from the refresh timer.
    expect(run.measurement.unhandledRejections).toEqual([]);
    // Said once, naming the monitor.
    const lost: Array<string> = errorLines(errorLog).filter(
      (line: string): boolean => {
        return line.includes("lost its lock");
      },
    );
    expect(lost).toHaveLength(1);
    expect(lost[0]).toContain("10108000-0000-4000-8000-000000000002");
  }, 60_000);

  test("an evaluation whose lock Valkey loses part way through is told by the refresh and stops", async () => {
    const errorLog: jest.SpiedFunction<typeof logger.error> = jest.spyOn(
      logger,
      "error",
    );

    const run: EvaluationRun = await runFleetEvaluation({
      fleet: fleet(),
      // As a Valkey restart would: the key is gone once the lock is held.
      onLockAcquired: (lockKey: string, store: FakeValkey): void => {
        store.deleteKey(lockKey);
      },
      // Long enough, in slices, for the refresh to run and find it gone.
      slowCriteria: { ms: 2_500, inOneBlock: false },
    });

    expect(run.error).toContain(MONITOR_EVALUATION_LOCK_LOST_MESSAGE);
    expect(run.measurement.lockRefreshFailures).toBeGreaterThanOrEqual(1);
    expect(run.measurement.unhandledRejections).toEqual([]);
    expect(run.outcome.createdAlerts).toEqual([]);
    expect(run.outcome.resolvedAlerts).toEqual([]);
    expect(run.outcome.statusChanges).toEqual([]);
    expect(
      errorLines(errorLog).filter((line: string): boolean => {
        return line.includes("lost its lock");
      }),
    ).toHaveLength(1);
  }, 60_000);
});
