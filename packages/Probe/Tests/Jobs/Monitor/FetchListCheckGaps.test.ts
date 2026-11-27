// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
// Docker Compose's global probe: 5 workers of 10 monitors each.
process.env["PROBE_MONITORING_WORKERS"] = "5";
process.env["PROBE_MONITOR_FETCH_LIMIT"] = "10";
process.env["PROBE_MONITOR_CHECK_TIMEOUT_IN_MS"] = "30000";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import MonitorUtil from "../../../Utils/Monitors/Monitor";
import ServerBusy from "../../../Utils/ServerBusy";
import InitJob, {
  getWorkersFetching,
  resetProbeWorkerRunState,
  whenMonitorChecksSettle,
} from "../../../Jobs/Monitor/FetchList";

/*
 * A ONE-MINUTE MONITOR IS CHECKED A MINUTE APART (OneUptime issue #11333).
 *
 * The probe's cron fires at every minute, and each of its workers asks the
 * server for the monitors that are due. Each worker used to wait a new
 * random 0 to 45 seconds first, every minute: the server stamps a claimed
 * monitor with its next whole minute, so it was checked at one random second
 * one minute and another the next, 15 to 105 seconds apart. Each worker now
 * asks at its own moment of the minute, the same every minute
 * (ProbeFetchMoments), so the monitors it is handed are checked a minute
 * apart.
 *
 * This runs the probe's own job - the cron's function, its five workers,
 * their check slots and their waits - on a fake clock over ten minutes,
 * against a server that claims as OneUptime's does (oldest due first, up to
 * the limit asked, each claimed monitor stamped with its next whole minute),
 * and measures the time between each monitor's checks. It only uses what
 * the probe exported before #11333, so it runs against the old job too,
 * where the gaps were anything from 15 to 105 seconds.
 */

type CapturedCronJob = {
  jobName: string;
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;
const START: number = Date.UTC(2026, 10, 27, 10, 0, 0);
const MINUTES: number = 10;

// OneUptime's side of /monitor/list, on the fake clock.
class FakeServer {
  public readonly asksAt: Array<number> = [];
  private readonly nextPingAt: Map<string, number> = new Map<string, number>();

  public addMonitors(count: number): void {
    for (let index: number = 0; index < count; index++) {
      this.nextPingAt.set(
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        START,
      );
    }
  }

  public answer(options: { data?: JSONObject }): { data: Array<JSONObject> } {
    const now: number = Date.now();
    const limit: number = Number(options.data?.["limit"]);
    this.asksAt.push(now);

    const due: Array<string> = Array.from(this.nextPingAt.entries())
      .filter(([, dueAt]: [string, number]) => {
        return dueAt <= now;
      })
      .sort((a: [string, number], b: [string, number]) => {
        return a[1] - b[1];
      })
      .slice(0, limit)
      .map(([monitorId]: [string, number]) => {
        return monitorId;
      });

    const nextMinute: number =
      Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS;

    for (const monitorId of due) {
      this.nextPingAt.set(monitorId, nextMinute);
    }

    return {
      data: due.map((monitorId: string) => {
        return {
          _id: monitorId,
          monitorType: MonitorType.Ping,
          projectId: "99999999-0000-4000-8000-000000000000",
        };
      }),
    };
  }
}

let server: FakeServer = new FakeServer();
// When each monitor was checked, in order.
let checkedAt: Map<string, Array<number>> = new Map();
let checkMs: number = 300;

// Moves the fake clock in small steps, letting what each step settled run.
async function advance(milliseconds: number): Promise<void> {
  const stepMs: number = 50;

  for (let moved: number = 0; moved < milliseconds; moved += stepMs) {
    jest.advanceTimersByTime(Math.min(stepMs, milliseconds - moved));

    for (let turn: number = 0; turn < 20; turn++) {
      await Promise.resolve();
    }

    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

// Ten minutes of the probe's own job: its cron's function at every minute.
async function runMinutes(): Promise<void> {
  InitJob();

  const job: CapturedCronJob = mockCapturedCronJobs.find(
    (captured: CapturedCronJob): boolean => {
      return captured.jobName === "Probe:MonitorFetchList";
    },
  )!;

  for (let minute: number = 0; minute < MINUTES; minute++) {
    // The cron fires at the minute, a few milliseconds late.
    await advance(START + minute * MINUTE_MS + 3 - Date.now());
    void job.runFunction();
    await advance(MINUTE_MS - 3);
  }

  // What is still being checked finishes.
  await advance(5 * checkMs);
}

// The time between each monitor's checks, every gap of every monitor.
function gapsBetweenChecks(): Array<number> {
  const gaps: Array<number> = [];

  for (const times of checkedAt.values()) {
    for (let index: number = 1; index < times.length; index++) {
      gaps.push(times[index]! - times[index - 1]!);
    }
  }

  return gaps;
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: ["performance", "setImmediate", "nextTick", "queueMicrotask"],
  });
  jest.setSystemTime(START - 10 * SECOND_MS);

  resetProbeWorkerRunState();
  ServerBusy.reset();
  mockCapturedCronJobs.length = 0;
  server = new FakeServer();
  checkedAt = new Map();
  checkMs = 300;

  jest.spyOn(API, "fetch").mockImplementation((async (options: {
    data?: JSONObject;
  }): Promise<unknown> => {
    return server.answer(options);
  }) as never);

  jest
    .spyOn(MonitorUtil, "probeMonitor")
    .mockImplementation(async (monitor: Monitor): Promise<void> => {
      const id: string = monitor.id!.toString();
      checkedAt.set(id, [...(checkedAt.get(id) || []), Date.now()]);

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, checkMs);
      });
    });

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }
});

afterEach(async () => {
  await advance(MINUTE_MS);
  await whenMonitorChecksSettle();
  resetProbeWorkerRunState();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a probe with Docker Compose's defaults, over ten minutes", () => {
  test("30 one-minute monitors: each checked every minute, a minute apart, to the millisecond", async () => {
    server.addMonitors(30);

    await runMinutes();

    expect(getWorkersFetching()).toBe(0);
    expect(checkedAt.size).toBe(30);

    for (const times of checkedAt.values()) {
      expect(times).toHaveLength(MINUTES);
    }

    const gaps: Array<number> = gapsBetweenChecks();

    expect(gaps).toHaveLength(30 * (MINUTES - 1));

    for (const gap of gaps) {
      expect(gap).toBe(MINUTE_MS);
    }
  });

  test("200 one-minute monitors, three seconds a check, more than its 50 slots at once: still a minute apart, within a second", async () => {
    checkMs = 3 * SECOND_MS;
    server.addMonitors(200);

    await runMinutes();

    expect(checkedAt.size).toBe(200);

    for (const times of checkedAt.values()) {
      expect(times).toHaveLength(MINUTES);
    }

    for (const gap of gapsBetweenChecks()) {
      expect(Math.abs(gap - MINUTE_MS)).toBeLessThanOrEqual(SECOND_MS);
    }
  });

  test("its workers ask at the same moments of every minute, and never all at once", async () => {
    server.addMonitors(30);

    await runMinutes();

    // Each minute's asks, as moments of it.
    const byMinute: Map<number, Set<number>> = new Map();

    for (const at of server.asksAt) {
      const minute: number = Math.floor((at - START) / MINUTE_MS);
      const moments: Set<number> = byMinute.get(minute) || new Set<number>();
      moments.add((at - START) % MINUTE_MS);
      byMinute.set(minute, moments);
    }

    const first: Array<number> = Array.from(byMinute.get(1)!).sort(
      (a: number, b: number) => {
        return a - b;
      },
    );

    // Five workers: five moments, the first worker's asked several times.
    expect(first.length).toBeGreaterThanOrEqual(5);

    for (let minute: number = 2; minute < MINUTES; minute++) {
      expect(
        Array.from(byMinute.get(minute)!).sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual(first);
    }

    // Spread over the first 45 s of the minute, not bunched at its start.
    expect(Math.max(...first) - Math.min(...first)).toBeGreaterThan(
      30 * SECOND_MS,
    );
    expect(Math.max(...first)).toBeLessThan(45 * SECOND_MS + 100);
  });
});
