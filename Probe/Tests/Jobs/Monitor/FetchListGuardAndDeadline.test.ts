// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
/*
 * Two worker slots, so the per-slot granularity of the guard is testable:
 * a wedged slot 1 must not stop slot 2 from being spawned.
 */
process.env["PROBE_MONITORING_WORKERS"] = "2";
// The production default is 15 minutes; these tests must not wait that long.
process.env["PROBE_MONITOR_CHECK_TIMEOUT_IN_MS"] = "1000";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

type CapturedCronJob = {
  jobName: string;
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

/*
 * BasicCron would hand the runFunction to node-cron; capturing it instead
 * lets these tests drive the exact closure production runs — the per-slot
 * overlap guard included — without a real scheduler.
 */
jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import { PROBE_MONITOR_CHECK_TIMEOUT_IN_MS } from "../../../Config";
import MonitorUtil from "../../../Utils/Monitors/Monitor";
import InitJob, {
  FetchListAndProbe,
  probeMonitorWithDeadline,
  resetProbeWorkerRunState,
} from "../../../Jobs/Monitor/FetchList";

/*
 * Defence in depth for the probing loop, following OneUptime issue #3225
 * (an SSL monitor with no timeout of any kind, whose promise therefore
 * never settled).
 *
 * Two independent failures made that one bug unbounded:
 *
 *   - probeMonitor() was awaited inside a Promise.allSettled with no
 *     deadline, so a check that never settles pends its worker forever —
 *     no ingest POST, no monitor log, and nothing to grep for, while the
 *     server has already advanced nextPingAt and the row keeps looking
 *     correctly scheduled; and
 *   - the minutely cron spawned PROBE_MONITORING_WORKERS fresh un-awaited
 *     workers on every tick with no in-flight guard, so wedged workers
 *     accumulated without bound.
 *
 * These tests pin both layers, so the same class of bug in any other
 * monitor implementation costs one cycle rather than the probe.
 */

const monitorIdOne: ObjectID = ObjectID.generate();
const monitorIdTwo: ObjectID = ObjectID.generate();

function makeMonitor(id: ObjectID): Monitor {
  return {
    id: id,
    _id: id.toString(),
    projectId: ObjectID.generate(),
    monitorType: MonitorType.SSLCertificate,
  } as unknown as Monitor;
}

function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Never settles — a monitor implementation with no timeout of its own.
  });
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

function capturedRunFunction(): PromiseVoidFunction {
  InitJob();
  const captured: CapturedCronJob | undefined =
    mockCapturedCronJobs[mockCapturedCronJobs.length - 1];
  if (!captured) {
    throw new Error("InitJob did not register a cron job");
  }
  return captured.runFunction;
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let probeSpy = jest.spyOn(MonitorUtil, "probeMonitor");
// eslint-disable-next-line @typescript-eslint/typedef
let errorSpy = jest.spyOn(logger, "error");

beforeEach(() => {
  // A wedged worker slot from a previous test must never leak in.
  resetProbeWorkerRunState();
  mockCapturedCronJobs.length = 0;

  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
  probeSpy = jest
    .spyOn(MonitorUtil, "probeMonitor")
    .mockResolvedValue(undefined as never);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    // Keep test output clean; asserted on where it matters.
  });

  /*
   * The worker's 0–45s random stagger is load balancing, not behaviour
   * under test — skipping it keeps these tests to their own deadlines.
   */
  jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("monitor probing — per-check deadline", () => {
  test("the configured deadline is read from the environment", () => {
    expect(PROBE_MONITOR_CHECK_TIMEOUT_IN_MS).toBe(1000);
  });

  test("a check that never settles is abandoned at the deadline instead of pending forever", async () => {
    probeSpy.mockReturnValue(neverSettles<void>());

    const startedAt: number = Date.now();

    await expect(
      probeMonitorWithDeadline(makeMonitor(monitorIdOne), 150),
    ).rejects.toThrow(/exceeded the 150ms deadline/);

    /*
     * The point of the deadline: bounded, not merely eventual. Without it
     * this assertion never runs at all — the await above never returns.
     */
    expect(Date.now() - startedAt).toBeLessThan(2000);

    // The one line an operator can grep for when a cycle goes missing.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Monitor ${monitorIdOne.toString()} (SSL Certificate) did not finish probing within 150ms`,
      ),
    );
  });

  test("a check that finishes in time returns no payload and clears its deadline timer", async () => {
    probeSpy.mockResolvedValue(undefined as never);

    // eslint-disable-next-line @typescript-eslint/typedef
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

    await expect(
      probeMonitorWithDeadline(makeMonitor(monitorIdOne), 150),
    ).resolves.toBeUndefined();

    /*
     * The deadline timer must be cleared on the success path too: one
     * un-cleared timer per check holds the event loop open (and surfaces
     * under jest --detectOpenHandles, which this project runs).
     */
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  test("a rejected check propagates its own error rather than the deadline's", async () => {
    probeSpy.mockRejectedValue(new Error("ssl handshake failed") as never);

    await expect(
      probeMonitorWithDeadline(makeMonitor(monitorIdOne), 150),
    ).rejects.toThrow("ssl handshake failed");
  });

  test("a monitor that never settles does not block the rest of the batch", async () => {
    fetchSpy.mockResolvedValue({
      data: [
        {
          _id: monitorIdOne.toString(),
          monitorType: MonitorType.SSLCertificate,
        },
        { _id: monitorIdTwo.toString(), monitorType: MonitorType.Ping },
      ],
    } as never);

    probeSpy.mockImplementation((monitor: Monitor): Promise<never> => {
      if (monitor.id?.toString() === monitorIdOne.toString()) {
        // The wedged implementation — no timeout of its own, ever.
        return neverSettles<never>();
      }
      return Promise.resolve() as unknown as Promise<never>;
    });

    const startedAt: number = Date.now();

    /*
     * The whole cycle must complete. Before the deadline this await never
     * returned, and the worker running it was leaked for the lifetime of
     * the process.
     */
    await new FetchListAndProbe("Worker 1").run();

    const elapsed: number = Date.now() - startedAt;

    // Bounded by the 1000ms deadline from the environment, not unbounded.
    expect(elapsed).toBeLessThan(5000);

    /*
     * ...and it did wait for the wedged monitor's deadline rather than
     * abandoning the batch the moment the healthy check came back.
     */
    expect(elapsed).toBeGreaterThanOrEqual(900);

    expect(probeSpy).toHaveBeenCalledTimes(2);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Monitor ${monitorIdOne.toString()} (SSL Certificate) did not finish probing within 1000ms`,
      ),
    );
  });
});

describe("monitor fetch-list cron — per-slot in-flight guard", () => {
  test("each configured worker slot is spawned once per tick", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    await runFunction();
    await flushMicrotasks();

    // Two slots configured, one list fetch each.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("a tick does not stack a second worker onto a slot whose run is still in flight", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockReturnValue(neverSettles<never>());

    await runFunction();
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Both slots are still wedged, so the next four ticks must spawn nothing.
    await runFunction();
    await runFunction();
    await runFunction();
    await runFunction();
    await flushMicrotasks();

    /*
     * Still two. Before the guard this was two more workers per minute,
     * forever — the accumulation that took the probe down.
     */
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("a slot is released when its run completes, so the next tick uses it again", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    await runFunction();
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await runFunction();
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  test("a slot is released when its run fails, so a failing fetch does not wedge it", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockRejectedValue(new Error("ingest unreachable") as never);

    await runFunction();
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await runFunction();
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    expect(errorSpy).toHaveBeenCalled();
  });

  /*
   * The guard is per slot, not per job: one wedged slot must not stop the
   * probe from using the capacity the operator configured.
   */
  test("a wedged slot does not stop a free slot from being spawned", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    let call: number = 0;
    fetchSpy.mockImplementation((): Promise<never> => {
      call++;
      // Only the first slot's fetch wedges; every later one resolves.
      if (call === 1) {
        return neverSettles<never>();
      }
      return Promise.resolve({ data: [] }) as unknown as Promise<never>;
    });

    await runFunction();
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    /*
     * Slot 1 is still wedged; slot 2 finished and must be reused — three
     * fetches total, not two (whole job blocked) and not four (no guard).
     */
    await runFunction();
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    await runFunction();
    await flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  test("the tick itself resolves even when a worker never does", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockReturnValue(neverSettles<never>());

    /*
     * Workers are intentionally un-awaited: the cron tick hands off and
     * returns, so node-cron is never held by a probing cycle.
     */
    await expect(runFunction()).resolves.toBeUndefined();
  });
});

describe("monitor batch completion logging", () => {
  beforeEach(() => {
    fetchSpy.mockResolvedValue({
      data: [
        { _id: monitorIdOne.toString(), monitorType: MonitorType.Website },
        { _id: monitorIdTwo.toString(), monitorType: MonitorType.Website },
      ],
    } as never);
  });

  test("logs a completed monitor while another check is still pending", async () => {
    let finishSlowCheck: () => void = (): void => {};
    const slowCheck: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        finishSlowCheck = resolve;
      },
    );
    probeSpy.mockReturnValueOnce(slowCheck);
    // eslint-disable-next-line @typescript-eslint/typedef
    const debugSpy = jest.spyOn(logger, "debug").mockImplementation(() => {});
    let completed: boolean = false;
    const run: Promise<void> = new FetchListAndProbe("Worker 1")
      .run()
      .then(() => {
        completed = true;
      });

    try {
      await flushMicrotasks();
      expect(probeSpy).toHaveBeenCalledTimes(2);
      expect(completed).toBe(false);
      expect(debugSpy).toHaveBeenCalledWith(
        `Probed monitor ${monitorIdTwo.toString()}`,
      );
      expect(debugSpy).not.toHaveBeenCalledWith(
        `Probed monitor ${monitorIdOne.toString()}`,
      );
    } finally {
      finishSlowCheck();
      await run;
    }
    expect(debugSpy).toHaveBeenCalledWith(
      `Probed monitor ${monitorIdOne.toString()}`,
    );
  });

  test("reports a failed monitor immediately and still waits for another check", async () => {
    let finishSlowCheck: () => void = (): void => {};
    const slowCheck: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        finishSlowCheck = resolve;
      },
    );
    const failure: Error = new Error("failed check with response context");
    probeSpy.mockRejectedValueOnce(failure);
    probeSpy.mockReturnValueOnce(slowCheck);
    let completed: boolean = false;
    const run: Promise<void> = new FetchListAndProbe("Worker 1")
      .run()
      .then(() => {
        completed = true;
      });

    try {
      await flushMicrotasks();
      expect(completed).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(failure);
      expect(errorSpy).toHaveBeenCalledWith("Error in probing monitor:");
    } finally {
      finishSlowCheck();
      await run;
    }
    expect(completed).toBe(true);
  });

  test("starts every check in a large batch without serializing monitoring", async () => {
    const monitorCount: number = 200;
    fetchSpy.mockResolvedValue({
      data: Array.from({ length: monitorCount }, () => {
        return {
          _id: ObjectID.generate().toString(),
          monitorType: MonitorType.Website,
        };
      }),
    } as never);
    const finishChecks: Array<() => void> = [];
    probeSpy.mockImplementation(() => {
      return new Promise<void>((resolve: () => void) => {
        finishChecks.push(resolve);
      });
    });
    // eslint-disable-next-line @typescript-eslint/typedef
    const debugSpy = jest.spyOn(logger, "debug").mockImplementation(() => {});
    const run: Promise<void> = new FetchListAndProbe("Worker 1").run();

    try {
      await flushMicrotasks();
      expect(probeSpy).toHaveBeenCalledTimes(monitorCount);
      expect(finishChecks).toHaveLength(monitorCount);
    } finally {
      for (const finish of finishChecks.reverse()) {
        finish();
      }
      await run;
    }

    expect(
      debugSpy.mock.calls.filter(
        ([message]: Parameters<typeof logger.debug>) => {
          return (
            typeof message === "string" && message.startsWith("Probed monitor ")
          );
        },
      ),
    ).toHaveLength(monitorCount);
  });

  test("a rejection after the deadline remains observed", async () => {
    let rejectCheck: (error: Error) => void = (): void => {};
    probeSpy.mockImplementationOnce(() => {
      return new Promise<void>(
        (_resolve: () => void, reject: (reason?: unknown) => void) => {
          rejectCheck = reject;
        },
      );
    });

    await expect(
      probeMonitorWithDeadline(makeMonitor(monitorIdOne), 10),
    ).rejects.toThrow("exceeded the 10ms deadline");
    rejectCheck(new Error("late failure"));
    await flushMicrotasks();
    /*
     * Jest treats an unobserved rejection as a test failure. The deadline
     * must continue observing the underlying check after releasing its slot.
     */
  });
});
