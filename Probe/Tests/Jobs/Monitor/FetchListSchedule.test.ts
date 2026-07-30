// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

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
  options: {
    schedule: string;
    runOnStartup: boolean;
  };
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

/*
 * BasicCron would hand the schedule and runFunction to node-cron; capturing
 * them instead lets these tests assert the registered cadence and drive the
 * exact closure production runs.
 */
jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

import API from "Common/Utils/API";
import Sleep from "Common/Types/Sleep";
import logger from "Common/Server/Utils/Logger";
import CronTab from "Common/Utils/CronTab";
import {
  PROBE_MONITORING_WORKERS,
  PROBE_MONITOR_FETCH_CRON,
  PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS,
  PROBE_MONITOR_FETCH_JITTER_IN_MS,
} from "../../../Config";
import InitJob, {
  getInFlightMonitorWorkers,
  resetInFlightMonitorWorkers,
} from "../../../Jobs/Monitor/FetchList";

/*
 * The reason a 20-second monitoring interval used to produce one check a
 * minute: this job ran EVERY_MINUTE and then slept a random 0-45 seconds
 * before asking the server for work. No matter what interval a monitor was
 * set to, it could only ever be claimed once per tick.
 *
 * Three things had to change together, and all three are pinned here:
 *  1. the tick is now sub-minute,
 *  2. the jitter is a fraction of one tick rather than 45 seconds,
 *  3. workers, which are spawned detached, are capped - six times the tick
 *     rate with no cap is a pile-up.
 */

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let sleepSpy = jest.spyOn(Sleep, "sleep");

beforeEach(() => {
  mockCapturedCronJobs.length = 0;
  resetInFlightMonitorWorkers();
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
  sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

function capturedJob(): CapturedCronJob {
  InitJob();
  const captured: CapturedCronJob | undefined =
    mockCapturedCronJobs[mockCapturedCronJobs.length - 1];
  if (!captured) {
    throw new Error("InitJob did not register a cron job");
  }
  return captured;
}

describe("monitor fetch-list job schedule", () => {
  test("registers under the expected job name", () => {
    expect(capturedJob().jobName).toBe("Probe:MonitorFetchList");
  });

  test("ticks every ten seconds by default, not every minute", () => {
    expect(PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS).toBe(10);
    expect(capturedJob().options.schedule).toBe("*/10 * * * * *");
  });

  /*
   * A direct regression guard: a five-field expression cannot fire more than
   * once a minute, so reverting to EVERY_MINUTE here silently takes
   * sub-minute intervals away again.
   */
  test("the schedule is a six-field expression with a seconds field", () => {
    const fields: Array<string> = capturedJob()
      .options.schedule.trim()
      .split(/\s+/);

    expect(fields).toHaveLength(6);
    expect(fields[0]).toBe("*/10");
  });

  test("the schedule is a parseable cron that really fires every ten seconds", () => {
    const schedule: string = capturedJob().options.schedule;

    expect(CronTab.isValid(schedule)).toBe(true);

    const fireTimes: Array<Date> = CronTab.getNextExecutionTimes(
      schedule,
      4,
      new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
    );

    for (let i: number = 1; i < fireTimes.length; i++) {
      expect(fireTimes[i]!.getTime() - fireTimes[i - 1]!.getTime()).toBe(
        PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS * 1000,
      );
    }
  });

  test("the configured cron matches the configured interval", () => {
    expect(capturedJob().options.schedule).toBe(PROBE_MONITOR_FETCH_CRON);
  });

  test("still runs on startup", () => {
    expect(capturedJob().options.runOnStartup).toBe(true);
  });
});

describe("monitor fetch-list job jitter", () => {
  test("sleeps at most a tenth of one tick, never the old 45 seconds", async () => {
    const runFunction: PromiseVoidFunction = capturedJob().runFunction;

    // Enough runs that a random value outside the range would show up.
    for (let i: number = 0; i < 25; i++) {
      resetInFlightMonitorWorkers();
      await runFunction();
      await flushMicrotasks();
    }

    expect(sleepSpy).toHaveBeenCalled();

    for (const call of sleepSpy.mock.calls) {
      const sleepTime: number = call[0] as number;

      expect(sleepTime).toBeGreaterThanOrEqual(0);
      expect(sleepTime).toBeLessThanOrEqual(PROBE_MONITOR_FETCH_JITTER_IN_MS);

      /*
       * The old behaviour. 45 seconds of jitter on a 20-second interval put
       * consecutive checks anywhere from 15 to 105 seconds apart.
       */
      expect(sleepTime).toBeLessThan(45000);
    }
  });

  test("the jitter budget stays well inside a single tick", () => {
    expect(PROBE_MONITOR_FETCH_JITTER_IN_MS).toBe(1000);
    expect(PROBE_MONITOR_FETCH_JITTER_IN_MS).toBeLessThan(
      PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS * 1000,
    );
  });
});

describe("monitor fetch-list worker cap", () => {
  test("does not grow without bound when every fetch hangs", async () => {
    const runFunction: PromiseVoidFunction = capturedJob().runFunction;

    fetchSpy.mockReturnValue(
      new Promise<never>(() => {
        // Never settles - a list fetch stuck on an unresponsive server.
      }) as never,
    );

    const inFlightTicks: Array<Promise<void>> = [];

    // Ten ticks is a hundred seconds of wall clock at the default cadence.
    for (let i: number = 0; i < 10; i++) {
      inFlightTicks.push(runFunction());
      await flushMicrotasks();
    }

    expect(getInFlightMonitorWorkers()).toBeLessThanOrEqual(
      PROBE_MONITORING_WORKERS * 3,
    );

    // Never settle by design; module state dies with this test file.
    void inFlightTicks;
  });

  test("warns rather than silently dropping work when the pool is saturated", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
      // Keep test output clean.
    });

    const runFunction: PromiseVoidFunction = capturedJob().runFunction;

    fetchSpy.mockReturnValue(
      new Promise<never>(() => {
        // Never settles.
      }) as never,
    );

    const inFlightTicks: Array<Promise<void>> = [];

    for (let i: number = 0; i < 6; i++) {
      inFlightTicks.push(runFunction());
      await flushMicrotasks();
    }

    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]![0])).toContain(
      "Probe:MonitorFetchList",
    );

    void inFlightTicks;
  });

  test("the cap is a ceiling, not a latch - workers resume once one finishes", async () => {
    const runFunction: PromiseVoidFunction = capturedJob().runFunction;

    let releaseHeldFetch: (() => void) | null = null;

    fetchSpy.mockReturnValue(
      new Promise<never>((resolve: (value: never) => void) => {
        releaseHeldFetch = (): void => {
          resolve({ data: [] } as never);
        };
      }) as never,
    );

    const inFlightTicks: Array<Promise<void>> = [];

    for (let i: number = 0; i < 5; i++) {
      inFlightTicks.push(runFunction());
      await flushMicrotasks();
    }

    expect(getInFlightMonitorWorkers()).toBe(PROBE_MONITORING_WORKERS * 3);

    (releaseHeldFetch as unknown as () => void)();
    await Promise.all(inFlightTicks);
    await flushMicrotasks();
    await flushMicrotasks();

    expect(getInFlightMonitorWorkers()).toBe(0);

    // A fresh tick can spawn again.
    fetchSpy.mockResolvedValue({ data: [] } as never);
    await runFunction();
    await flushMicrotasks();

    expect(getInFlightMonitorWorkers()).toBe(0);
  });

  test("a normal tick releases its workers once the batch completes", async () => {
    const runFunction: PromiseVoidFunction = capturedJob().runFunction;

    await runFunction();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(getInFlightMonitorWorkers()).toBe(0);
    expect(fetchSpy).toHaveBeenCalled();
  });

  test("asks the server for work at the configured batch size", async () => {
    const runFunction: PromiseVoidFunction = capturedJob().runFunction;

    await runFunction();
    await flushMicrotasks();

    const firstCall: Record<string, unknown> = fetchSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;

    expect(String(firstCall["url"])).toBe(
      "https://oneuptime.example.com/probe-ingest/monitor/list",
    );

    const body: Record<string, unknown> = firstCall["data"] as Record<
      string,
      unknown
    >;

    expect(body["probeKey"]).toBe("test-probe-key");
    expect(typeof body["limit"]).toBe("number");
  });
});
