// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
/*
 * Docker Compose's global probe: 5 workers of 10 monitors each, the
 * defaults that checked at most 50 monitors a minute (OneUptime issue #9488).
 */
process.env["PROBE_MONITORING_WORKERS"] = "5";
process.env["PROBE_MONITOR_FETCH_LIMIT"] = "10";
process.env["PROBE_MONITOR_CHECK_TIMEOUT_IN_MS"] = "2000";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import MonitorUtil from "../../../Utils/Monitors/Monitor";
import ServerBusy from "../../../Utils/ServerBusy";
import InitJob, {
  FetchListAndProbe,
  MONITOR_CHECKS_AT_ONCE,
  MONITOR_FETCH_STAGGER_MAX_MS,
  MONITOR_ROOM_TO_ASK,
  MONITOR_WAIT_WARNING_AFTER_MS,
  MONITOR_WAIT_WARNING_EVERY_MS,
  getMonitorCheckSlots,
  getWorkersFetching,
  resetProbeWorkerRunState,
  whenMonitorChecksSettle,
} from "../../../Jobs/Monitor/FetchList";

/*
 * A PROBE KEEPS UP WITH ITS MONITORS WITHOUT A SETTING (OneUptime issue
 * #9488).
 *
 * Measured on release 15.0.0: one probe with Docker Compose's defaults (5
 * workers of 10) checked 1,490 times in 30 minutes for 100 one-minute
 * Website monitors - each about every 2 minutes - because each worker asked
 * for 10 monitors once a minute and waited for all ten. A worker now asks
 * again while it is handed full batches, as there is room, so the probe
 * checks every monitor that is due, and never more than 50 at once.
 *
 * The server here is a fake that claims as OneUptime's does: oldest due
 * first, up to the limit asked for, each claimed monitor moved to its next
 * minute in the same step, so a monitor is never handed out twice for one
 * interval (the real claim, on Postgres: Common's MonitorProbeClaimPostgres).
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

const MINUTE_IN_MS: number = 60 * 1000;

interface HandOut {
  monitorId: string;
  // The due time it was handed out for: one interval.
  dueAt: number;
}

/*
 * OneUptime's side of /monitor/list, as the claim behaves: the oldest due
 * monitors first, up to the limit asked for, each moved to the next minute
 * after "now" as it is handed out.
 */
type ScriptedAnswer = "busy" | "error" | "throw" | "junk";

class FakeServer {
  public now: number = Date.UTC(2026, 10, 18, 9, 0, 0);
  public readonly asked: Array<number> = [];
  public readonly handedOut: Array<HandOut> = [];
  // In place of a claim, by the request's number (the first is 1).
  public readonly scripted: Map<number, ScriptedAnswer> = new Map<
    number,
    ScriptedAnswer
  >();
  // Once a case is over, nothing more is handed out.
  public isClosed: boolean = false;
  private readonly nextPingAt: Map<string, number> = new Map<string, number>();

  public addMonitors(count: number, dueAt: number = this.now): Array<string> {
    const ids: Array<string> = [];

    for (let index: number = 0; index < count; index++) {
      const id: string = `00000000-0000-4000-8000-${String(this.nextPingAt.size).padStart(12, "0")}`;
      this.nextPingAt.set(id, dueAt);
      ids.push(id);
    }

    return ids;
  }

  public dueCount(): number {
    return Array.from(this.nextPingAt.values()).filter((dueAt: number) => {
      return dueAt <= this.now;
    }).length;
  }

  // The next interval begins: the clock moves on a minute.
  public nextMinute(): void {
    this.now += MINUTE_IN_MS;
  }

  public async answer(options: { data?: JSONObject }): Promise<unknown> {
    const limit: number = Number(options.data?.["limit"]);
    this.asked.push(limit);

    const scripted: ScriptedAnswer | undefined = this.scripted.get(
      this.asked.length,
    );

    // A request takes a moment, so requests made at once interleave.
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });

    if (scripted === "busy") {
      return new HTTPErrorResponse(
        429,
        { message: "This OneUptime server is busy." },
        { "retry-after": "10" },
      );
    }

    if (scripted === "error") {
      return new HTTPErrorResponse(500, { message: "Server error." }, {});
    }

    if (scripted === "throw") {
      throw new Error("Request failed to the server. Connection refused");
    }

    if (scripted === "junk") {
      return { data: { message: "not a list" } };
    }

    if (this.isClosed) {
      return { data: [] };
    }

    // The claim: one step, so two requests at once never share a monitor.
    const due: Array<[string, number]> = Array.from(this.nextPingAt.entries())
      .filter(([, dueAt]: [string, number]) => {
        return dueAt <= this.now;
      })
      .sort((a: [string, number], b: [string, number]) => {
        return a[1] - b[1];
      })
      .slice(0, limit);

    const nextMinute: number =
      Math.floor(this.now / MINUTE_IN_MS) * MINUTE_IN_MS + MINUTE_IN_MS;

    for (const [monitorId, dueAt] of due) {
      this.handedOut.push({ monitorId, dueAt });
      this.nextPingAt.set(monitorId, nextMinute);
    }

    return {
      data: due.map(([monitorId]: [string, number]) => {
        return {
          _id: monitorId,
          monitorType: MonitorType.Website,
          projectId: "99999999-0000-4000-8000-000000000000",
        };
      }),
    };
  }
}

let server: FakeServer = new FakeServer();
// Monitor ids, in the order the probe checked them.
let checked: Array<string> = [];
let checksRunning: number = 0;
let mostChecksAtOnce: number = 0;
// How long a check takes, in ms; a test sets its own.
let checkTakes: (monitorId: string) => Promise<void> = (): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 1);
  });
};

// eslint-disable-next-line @typescript-eslint/typedef
let warnSpy = jest.spyOn(logger, "warn");
// eslint-disable-next-line @typescript-eslint/typedef
let errorSpy = jest.spyOn(logger, "error");
// eslint-disable-next-line @typescript-eslint/typedef
let sleepSpy = jest.spyOn(Sleep, "sleep");

beforeEach(() => {
  resetProbeWorkerRunState();
  ServerBusy.reset();
  mockCapturedCronJobs.length = 0;
  server = new FakeServer();
  checked = [];
  checksRunning = 0;
  mostChecksAtOnce = 0;
  checkTakes = (): Promise<void> => {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 1);
    });
  };

  // Every request the probe makes goes to the fake server.
  jest.spyOn(API, "fetch").mockImplementation(((options: {
    data?: JSONObject;
  }): Promise<unknown> => {
    return server.answer(options);
  }) as never);

  jest
    .spyOn(MonitorUtil, "probeMonitor")
    .mockImplementation(async (monitor: Monitor): Promise<void> => {
      const monitorId: string = monitor.id!.toString();

      checked.push(monitorId);
      checksRunning++;
      mostChecksAtOnce = Math.max(mostChecksAtOnce, checksRunning);

      try {
        await checkTakes(monitorId);
      } finally {
        checksRunning--;
      }
    });

  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });

  // The 0-45 s stagger before a worker's first fetch: asserted, not waited.
  sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
});

afterEach(async () => {
  /*
   * Nothing leaks into the next case: the server hands out nothing more,
   * every check a case held settles, and every worker stops fetching.
   */
  server.isClosed = true;
  for (const check of heldChecks.splice(0)) {
    check.finish();
  }
  await settle(() => {
    return getWorkersFetching() === 0;
  });
  await whenMonitorChecksSettle();
  resetProbeWorkerRunState();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  for (let turn: number = 0; turn < 5; turn++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

// Lets the event loop turn until `isDone`, or a thousand turns have gone.
async function settle(isDone: () => boolean): Promise<void> {
  for (let turn: number = 0; turn < 1000 && !isDone(); turn++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

// The probe's five workers, each fetching until nothing more is due.
async function runWorkers(count: number = 5): Promise<void> {
  const runs: Array<Promise<void>> = [];

  for (let worker: number = 1; worker <= count; worker++) {
    runs.push(new FetchListAndProbe(`Worker ${worker}`).run());
  }

  await Promise.all(runs);
  await whenMonitorChecksSettle();
}

function countsOf(ids: Array<string>): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const id of ids) {
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  return counts;
}

function expectNoMonitorHandedOutTwiceForOneInterval(): void {
  const intervals: Array<string> = server.handedOut.map((handOut: HandOut) => {
    return `${handOut.monitorId}@${handOut.dueAt}`;
  });

  expect(new Set<string>(intervals).size).toBe(intervals.length);
}

// The checks a case holds, finished when it says so, or after it.
const heldChecks: Array<{ finish: () => void }> = [];

// A check that settles when the test says so.
function heldCheck(): { promise: Promise<void>; finish: () => void } {
  let finish: () => void = (): void => {};
  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    finish = resolve;
  });
  heldChecks.push({ finish });
  return { promise, finish };
}

describe("a probe checks every monitor that is due, not 50 a minute", () => {
  test("its limits are Docker Compose's defaults", () => {
    expect(MONITOR_CHECKS_AT_ONCE).toBe(50);
    expect(MONITOR_ROOM_TO_ASK).toBe(5);
    expect(getMonitorCheckSlots().getCapacity()).toBe(50);
  });

  test("100 one-minute monitors are all checked in their minute, once each (#9488's measurement)", async () => {
    const ids: Array<string> = server.addMonitors(100);

    await runWorkers();

    // Before #9488: one fetch of 10 per worker, so 50 of the 100.
    expect(checked).toHaveLength(100);
    expect(new Set<string>(checked)).toEqual(new Set<string>(ids));
    expect(server.dueCount()).toBe(0);

    for (const limit of server.asked) {
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(10);
    }

    expectNoMonitorHandedOutTwiceForOneInterval();
  });

  test("1,000 due are all checked, never more than 50 at once", async () => {
    server.addMonitors(1000);
    checkTakes = (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 2);
      });
    };

    await runWorkers();

    expect(checked).toHaveLength(1000);
    expect(new Set<string>(checked).size).toBe(1000);
    expect(mostChecksAtOnce).toBeLessThanOrEqual(MONITOR_CHECKS_AT_ONCE);
    // ...and it does use what it may.
    expect(mostChecksAtOnce).toBe(MONITOR_CHECKS_AT_ONCE);
    expect(getMonitorCheckSlots().getInUse()).toBe(0);
    expectNoMonitorHandedOutTwiceForOneInterval();
  });

  test("a worker asks again while it is handed a full batch, and stops at the first short one", async () => {
    server.addMonitors(25);

    await runWorkers(1);

    expect(server.asked).toEqual([10, 10, 10]);
    expect(checked).toHaveLength(25);
  });

  test("a last batch that empties the queue exactly is followed by one more question, answered with nothing", async () => {
    server.addMonitors(20);

    await runWorkers(1);

    expect(server.asked).toEqual([10, 10, 10]);
    expect(checked).toHaveLength(20);
  });

  test("with nothing due, each worker asks once a minute, as before", async () => {
    await runWorkers();

    expect(server.asked).toEqual([10, 10, 10, 10, 10]);
    expect(checked).toHaveLength(0);
  });

  test("each worker waits a random moment before its first fetch of the minute, and not between the fetches after it", async () => {
    server.addMonitors(100);

    await runWorkers();

    expect(sleepSpy).toHaveBeenCalledTimes(5);

    for (const call of sleepSpy.mock.calls) {
      expect(call[0]).toBeGreaterThanOrEqual(0);
      expect(call[0]).toBeLessThanOrEqual(MONITOR_FETCH_STAGGER_MAX_MS);
    }

    expect(server.asked.length).toBeGreaterThan(5);
  });
});

describe("one slow check holds its own slot, never its batch", () => {
  test("the rest of its batch, and the batches after it, are checked while it runs", async () => {
    const ids: Array<string> = server.addMonitors(30);
    const slow: { promise: Promise<void>; finish: () => void } = heldCheck();

    checkTakes = (monitorId: string): Promise<void> => {
      return monitorId === ids[0]
        ? slow.promise
        : new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 1);
          });
    };

    // One worker: before #9488 it waited for the slow check to ask again.
    await new FetchListAndProbe("Worker 1").run();
    await flush();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });

    try {
      expect(checked).toHaveLength(30);
      expect(getMonitorCheckSlots().getInUse()).toBe(1);
    } finally {
      slow.finish();
    }

    await whenMonitorChecksSettle();
    expect(getMonitorCheckSlots().getInUse()).toBe(0);
  });

  test("a check that never settles gives its slot back at its deadline", async () => {
    const ids: Array<string> = server.addMonitors(3);

    checkTakes = (monitorId: string): Promise<void> => {
      return monitorId === ids[1]
        ? new Promise<void>(() => {
            // Never settles: a monitor implementation with no timeout.
          })
        : Promise.resolve();
    };

    const startedAt: number = Date.now();

    await new FetchListAndProbe("Worker 1").run();
    await flush();

    expect(getMonitorCheckSlots().getInUse()).toBe(1);

    await whenMonitorChecksSettle();

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1900);
    expect(getMonitorCheckSlots().getInUse()).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("did not finish probing within 2000ms"),
    );
  });
});

describe("it asks only for what it has room for", () => {
  test("with five slots free it asks for five, and keeps asking for what comes free", async () => {
    getMonitorCheckSlots().take(45);
    server.addMonitors(20);

    try {
      await new FetchListAndProbe("Worker 1").run();
    } finally {
      getMonitorCheckSlots().release(45);
    }

    expect(server.asked).toEqual([5, 5, 5, 5, 5]);
    expect(checked).toHaveLength(20);
  });

  test("with less room than half a batch it waits, then asks for what has come free", async () => {
    getMonitorCheckSlots().take(46);
    server.addMonitors(3);

    const run: Promise<void> = new FetchListAndProbe("Worker 1").run();

    await flush();
    expect(server.asked).toEqual([]);

    // Four free is less than half a batch: still waiting.
    expect(getMonitorCheckSlots().getWaiting()).toBe(1);

    getMonitorCheckSlots().release(1);
    await run;

    expect(server.asked).toEqual([5]);
    expect(checked).toHaveLength(3);

    getMonitorCheckSlots().release(45);
  });

  test("never more than 10 at a time, however much room there is", async () => {
    server.addMonitors(300);

    await runWorkers(1);

    expect(Math.max(...server.asked)).toBe(10);
    expect(checked).toHaveLength(300);
  });
});

describe("it backs off, and every slot comes back", () => {
  test("a busy answer while catching up stops the worker; no worker asks again until the wait is over", async () => {
    let now: number = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    server.addMonitors(40);
    // The first batch is handed out; the second question is answered busy.
    server.scripted.set(2, "busy");

    await new FetchListAndProbe("Worker 1").run();
    await whenMonitorChecksSettle();

    expect(server.asked).toEqual([10, 10]);
    expect(checked).toHaveLength(10);
    expect(getMonitorCheckSlots().getInUse()).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      "busy handing out monitors",
    );

    // Another worker, before the ten seconds the server asked for.
    now += 9_999;
    await new FetchListAndProbe("Worker 2").run();
    expect(server.asked).toHaveLength(2);

    now += 1;
    await new FetchListAndProbe("Worker 2").run();
    await whenMonitorChecksSettle();

    expect(checked).toHaveLength(40);
    expect(new Set<string>(checked).size).toBe(40);
  });

  test("a failed answer stops the worker until its next tick, and gives its room back", async () => {
    server.addMonitors(30);
    server.scripted.set(1, "error");

    await new FetchListAndProbe("Worker 1").run();
    await whenMonitorChecksSettle();

    expect(server.asked).toEqual([10]);
    expect(checked).toHaveLength(0);
    expect(getMonitorCheckSlots().getInUse()).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("the server answered 500"),
    );

    // The next tick asks again, and catches up.
    await new FetchListAndProbe("Worker 1").run();
    await whenMonitorChecksSettle();

    expect(checked).toHaveLength(30);
  });

  test("a fetch that never got an answer stops the worker, and gives its room back", async () => {
    server.addMonitors(30);
    server.scripted.set(1, "throw");

    await new FetchListAndProbe("Worker 1").run();

    expect(server.asked).toEqual([10]);
    expect(getMonitorCheckSlots().getInUse()).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith("Error in fetching monitor list");
  });

  test("an answer that is not a list is read as nothing due", async () => {
    server.addMonitors(30);
    server.scripted.set(1, "junk");

    await new FetchListAndProbe("Worker 1").run();

    expect(server.asked).toEqual([10]);
    expect(checked).toHaveLength(0);
    expect(getMonitorCheckSlots().getInUse()).toBe(0);
  });
});

describe("no monitor is checked twice for one interval", () => {
  test("five workers at once share 237 due monitors, each checked once", async () => {
    const ids: Array<string> = server.addMonitors(237);

    await runWorkers();

    const counts: Map<string, number> = countsOf(checked);

    expect(counts.size).toBe(237);
    for (const id of ids) {
      expect({ id, checks: counts.get(id) }).toEqual({ id, checks: 1 });
    }
    expectNoMonitorHandedOutTwiceForOneInterval();
  });

  test("the next minute's interval is checked once more, and only then", async () => {
    const ids: Array<string> = server.addMonitors(120);

    await runWorkers();

    // Still the same minute: nothing more is due, so nothing is checked.
    await runWorkers();
    expect(checked).toHaveLength(120);

    server.nextMinute();
    await runWorkers();

    const counts: Map<string, number> = countsOf(checked);

    for (const id of ids) {
      expect({ id, checks: counts.get(id) }).toEqual({ id, checks: 2 });
    }
    expectNoMonitorHandedOutTwiceForOneInterval();
  });

  test("a probe that restarts mid-batch checks what is still due, and nothing it was handed already", async () => {
    server.addMonitors(80);
    const held: Array<{ promise: Promise<void>; finish: () => void }> = [];

    checkTakes = (): Promise<void> => {
      const check: { promise: Promise<void>; finish: () => void } = heldCheck();
      held.push(check);
      return check.promise;
    };

    // The first process claims as many as it may check at once...
    const firstRun: Promise<void> = new FetchListAndProbe("Worker 1").run();
    await settle(() => {
      return getMonitorCheckSlots().getWaiting() === 1;
    });
    expect(checked).toHaveLength(50);

    // ...and restarts: its checks and its waiting worker are gone.
    resetProbeWorkerRunState();
    await firstRun;
    for (const check of held) {
      check.finish();
    }
    await flush();

    checkTakes = (): Promise<void> => {
      return Promise.resolve();
    };

    await runWorkers();

    // The 30 it had not been handed, and none of the 50 again.
    expect(checked).toHaveLength(80);
    expect(new Set<string>(checked).size).toBe(80);
    expectNoMonitorHandedOutTwiceForOneInterval();
  });
});

describe("workers never stack, and a busy probe says so", () => {
  test("a worker waiting for room skips the next tick", async () => {
    const held: Array<{ promise: Promise<void>; finish: () => void }> = [];

    checkTakes = (): Promise<void> => {
      const check: { promise: Promise<void>; finish: () => void } = heldCheck();
      held.push(check);
      return check.promise;
    };

    server.addMonitors(60);

    InitJob();
    const tick: PromiseVoidFunction =
      mockCapturedCronJobs[mockCapturedCronJobs.length - 1]!.runFunction;

    await tick();
    await settle(() => {
      return getMonitorCheckSlots().getWaiting() === 5;
    });

    // Every slot is busy, and all five workers wait for room.
    expect(checked).toHaveLength(50);
    expect(getWorkersFetching()).toBe(5);
    expect(getMonitorCheckSlots().getFree()).toBe(0);

    const askedBefore: number = server.asked.length;

    await tick();
    await tick();
    await flush();

    // No worker was started beside one still waiting: nothing more asked.
    expect(server.asked.length).toBe(askedBefore);

    // Room again: the waiting workers ask for the last ten.
    for (const check of held.splice(0)) {
      check.finish();
    }

    checkTakes = (): Promise<void> => {
      return Promise.resolve();
    };

    await settle(() => {
      return getWorkersFetching() === 0;
    });
    await whenMonitorChecksSettle();

    expect(checked).toHaveLength(60);
    expect(new Set<string>(checked).size).toBe(60);
    expect(mostChecksAtOnce).toBeLessThanOrEqual(MONITOR_CHECKS_AT_ONCE);
  });

  test("monitors that wait a minute for room are said at warn, at most every ten minutes", async () => {
    let now: number = 5_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    const held: Array<{ promise: Promise<void>; finish: () => void }> = [];

    checkTakes = (): Promise<void> => {
      const check: { promise: Promise<void>; finish: () => void } = heldCheck();
      held.push(check);
      return check.promise;
    };

    server.addMonitors(55);

    const run: Promise<void> = new FetchListAndProbe("Worker 1").run();
    await settle(() => {
      return getMonitorCheckSlots().getWaiting() === 1;
    });
    expect(checked).toHaveLength(50);

    // A minute passes with every slot busy and five more due.
    now += MONITOR_WAIT_WARNING_AFTER_MS;
    checkTakes = (): Promise<void> => {
      return Promise.resolve();
    };
    for (const check of held.splice(0)) {
      check.finish();
    }
    await run;
    await whenMonitorChecksSettle();

    const waits: Array<string> = warnSpy.mock.calls
      .map((call: Array<unknown>) => {
        return String(call[0]);
      })
      .filter((message: string) => {
        return message.includes("monitor checks it may run at once");
      });

    expect(waits).toHaveLength(1);
    expect(waits[0]).toContain("they waited 60 s for room");
    expect(waits[0]).toContain("PROBE_MONITORING_WORKERS (now 5)");
    expect(waits[0]).toContain("PROBE_MONITOR_FETCH_LIMIT (now 10)");

    // The same within ten minutes is not said again.
    server.nextMinute();
    checkTakes = (): Promise<void> => {
      const check: { promise: Promise<void>; finish: () => void } = heldCheck();
      held.push(check);
      return check.promise;
    };
    const again: Promise<void> = new FetchListAndProbe("Worker 1").run();
    await settle(() => {
      return getMonitorCheckSlots().getWaiting() === 1;
    });
    now += MONITOR_WAIT_WARNING_AFTER_MS;
    expect(MONITOR_WAIT_WARNING_AFTER_MS * 2).toBeLessThan(
      MONITOR_WAIT_WARNING_EVERY_MS,
    );
    checkTakes = (): Promise<void> => {
      return Promise.resolve();
    };
    for (const check of held.splice(0)) {
      check.finish();
    }
    await again;

    expect(
      warnSpy.mock.calls.filter((call: Array<unknown>) => {
        return String(call[0]).includes("monitor checks it may run at once");
      }),
    ).toHaveLength(1);
  });

  test("a short wait for room after a full batch is not said", async () => {
    server.addMonitors(120);
    checkTakes = (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 2);
      });
    };

    await runWorkers();

    expect(checked).toHaveLength(120);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
