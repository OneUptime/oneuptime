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
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import PingMonitor, {
  DeviceReachabilityCheck,
} from "../../../Utils/Monitors/MonitorTypes/PingMonitor";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import ServerBusy from "../../../Utils/ServerBusy";
import { PROBE_NETWORK_DEVICE_POLL_CONCURRENCY } from "../../../Config";
import InitJob, {
  DEVICE_POLLS_AT_ONCE,
  DEVICE_POLL_DEADLINE_MS,
  DEVICE_ROOM_TO_ASK,
  DEVICE_WAIT_WARNING_AFTER_MS,
  DEVICE_WAIT_WARNING_EVERY_MS,
  DevicePollConfig,
  fetchAndPollWhileDue,
  getDevicePollSlots,
  isFetchingDevices,
  pollDeviceWithDeadline,
  resetDevicePollRunInProgress,
  whenDevicePollsSettle,
} from "../../../Jobs/NetworkDevice/FetchList";

/*
 * A PROBE KEEPS UP WITH ITS NETWORK DEVICES (OneUptime issue #9499).
 *
 * A probe asked for its due devices once a minute and was handed at most
 * NETWORK_DEVICE_POLL_FETCH_LIMIT of them, 250 by default, so it polled at
 * most 250 devices a minute however many were due: the rest waited, polled
 * less often than their interval. It now asks again while the server says
 * the batch was full, as it has room, so it polls every device that is
 * due - and never more than PROBE_NETWORK_DEVICE_POLL_CONCURRENCY at once,
 * as before. The monitors made the same move in #9488 (FetchListKeepsUp in
 * Jobs/Monitor).
 *
 * The server here is a fake that claims as OneUptime's does: the devices
 * longest due first, up to the limit asked for and never more than its own
 * cap, each claimed device moved to its next poll in the same step, so a
 * device is never handed out twice for one interval (the real claim, on
 * Postgres: Common's NetworkDevicePollClaimPostgres). It can also answer as
 * a server from before #9499 does: whole batches of its cap whatever is
 * asked, and nothing said of a full batch.
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

// NETWORK_DEVICE_POLL_FETCH_LIMIT's default: the server's cap per request.
const SERVER_FETCH_LIMIT: number = 250;

interface HandOut {
  networkDeviceId: string;
  // The poll time it was handed out for: one interval.
  dueAt: number;
}

type ScriptedAnswer = "busy" | "error" | "throw" | "junk";

class FakeServer {
  public now: number = Date.UTC(2026, 10, 18, 9, 0, 0);
  // The limit each list request asked for (undefined: none).
  public readonly asked: Array<number | undefined> = [];
  public readonly handedOut: Array<HandOut> = [];
  public readonly scripted: Map<number, ScriptedAnswer> = new Map<
    number,
    ScriptedAnswer
  >();
  // A server from before #9499: ignores the limit, says nothing of a full batch.
  public isOld: boolean = false;
  // Claimed, but kept back from this probe (an older probe's ping devices, say).
  public withholdEvery: number = 0;
  public withheld: number = 0;
  // Whether each answer that claimed said it was full.
  public readonly answeredFull: Array<boolean> = [];
  public isClosed: boolean = false;
  private readonly nextPollAt: Map<string, number> = new Map<string, number>();

  public addDevices(count: number, dueAt: number = this.now): Array<string> {
    const ids: Array<string> = [];

    for (let index: number = 0; index < count; index++) {
      const id: string = `device-${String(this.nextPollAt.size).padStart(5, "0")}`;
      this.nextPollAt.set(id, dueAt);
      ids.push(id);
    }

    return ids;
  }

  public dueCount(): number {
    return Array.from(this.nextPollAt.values()).filter((dueAt: number) => {
      return dueAt <= this.now;
    }).length;
  }

  public nextMinute(): void {
    this.now += MINUTE_IN_MS;
  }

  public async answer(options: { data?: JSONObject }): Promise<unknown> {
    const requested: unknown = options.data?.["limit"];
    this.asked.push(typeof requested === "number" ? requested : undefined);

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
      return { data: { devices: [], isFullBatch: false } };
    }

    const limit: number =
      !this.isOld && typeof requested === "number"
        ? Math.min(requested, SERVER_FETCH_LIMIT)
        : SERVER_FETCH_LIMIT;

    // The claim: one step, so two requests at once never share a device.
    const due: Array<[string, number]> = Array.from(this.nextPollAt.entries())
      .filter(([, dueAt]: [string, number]) => {
        return dueAt <= this.now;
      })
      .sort((a: [string, number], b: [string, number]) => {
        return a[1] - b[1];
      })
      .slice(0, limit);

    const nextMinute: number =
      Math.round(this.now / MINUTE_IN_MS) * MINUTE_IN_MS + MINUTE_IN_MS;

    for (const [networkDeviceId, dueAt] of due) {
      this.handedOut.push({ networkDeviceId, dueAt });
      this.nextPollAt.set(networkDeviceId, nextMinute);
    }

    const devices: Array<JSONObject> = due
      .filter((_entry: [string, number], index: number) => {
        const isWithheld: boolean =
          this.withholdEvery > 0 && index % this.withholdEvery === 0;

        if (isWithheld) {
          this.withheld++;
        }

        return !isWithheld;
      })
      .map(([networkDeviceId]: [string, number]) => {
        return {
          networkDeviceId: networkDeviceId,
          projectId: "project-1",
          hostname: "10.0.0.5",
          pollMode: "ping",
          collectEndpoints: false,
        };
      });

    this.answeredFull.push(due.length >= limit);

    return {
      data: this.isOld
        ? { devices: devices }
        : { devices: devices, isFullBatch: due.length >= limit },
    };
  }
}

let server: FakeServer = new FakeServer();
// Device ids, in the order the probe polled them.
let polled: Array<string> = [];
let reported: Array<string> = [];
let pollsRunning: number = 0;
let mostPollsAtOnce: number = 0;
let pollTakes: (
  networkDeviceId: string,
) => Promise<void> = (): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 1);
  });
};

// eslint-disable-next-line @typescript-eslint/typedef
let warnSpy = jest.spyOn(logger, "warn");
// eslint-disable-next-line @typescript-eslint/typedef
let errorSpy = jest.spyOn(logger, "error");

const heldPolls: Array<{ finish: () => void }> = [];

// A poll that settles when the test says so.
function heldPoll(): { promise: Promise<void>; finish: () => void } {
  let finish: () => void = (): void => {};
  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    finish = resolve;
  });
  heldPolls.push({ finish });
  return { promise, finish };
}

beforeEach(() => {
  resetDevicePollRunInProgress();
  ServerBusy.reset();
  mockCapturedCronJobs.length = 0;
  server = new FakeServer();
  polled = [];
  reported = [];
  pollsRunning = 0;
  mostPollsAtOnce = 0;
  pollTakes = (): Promise<void> => {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 1);
    });
  };

  // The list goes to the fake server; a poll's report is taken as sent.
  jest.spyOn(API, "fetch").mockImplementation(((options: {
    url: unknown;
    data?: JSONObject;
  }): Promise<unknown> => {
    if (String(options.url).endsWith("/probe/network-device/list")) {
      return server.answer(options);
    }

    reported.push(String(options.data?.["networkDeviceId"]));
    return Promise.resolve({ data: { result: "ok" } });
  }) as never);

  // A ping-only poll is the ping (below): no SNMP socket is ever opened.
  jest.spyOn(SnmpMonitor, "query").mockResolvedValue(null as never);

  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
});

/*
 * The ping of a poll knows its device only through its call order, so the
 * device is read from the poll itself: pollDevice pings once per device,
 * in the order the devices were started.
 */
function pingsCountDevices(): void {
  let started: number = 0;

  jest
    .spyOn(PingMonitor, "checkReachability")
    .mockImplementation(async (): Promise<DeviceReachabilityCheck> => {
      const networkDeviceId: string = `ping-${started++}`;

      pollsRunning++;
      mostPollsAtOnce = Math.max(mostPollsAtOnce, pollsRunning);

      try {
        await pollTakes(networkDeviceId);
      } finally {
        pollsRunning--;
      }

      return {
        isOnline: true,
        avgRttMs: 1,
        packetLossPercent: 0,
        failureCause: "",
      };
    });
}

beforeEach(() => {
  pingsCountDevices();
});

afterEach(async () => {
  // Nothing leaks into the next case.
  server.isClosed = true;
  for (const poll of heldPolls.splice(0)) {
    poll.finish();
  }
  await settle(() => {
    return !isFetchingDevices();
  });
  await whenDevicePollsSettle();
  resetDevicePollRunInProgress();
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

// One tick's fetching, and every poll it started.
async function runTick(): Promise<void> {
  await fetchAndPollWhileDue();
  await whenDevicePollsSettle();
  polled = [...reported];
}

function countsOf(ids: Array<string>): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const id of ids) {
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  return counts;
}

function expectNoDeviceHandedOutTwiceForOneInterval(): void {
  const intervals: Array<string> = server.handedOut.map((handOut: HandOut) => {
    return `${handOut.networkDeviceId}@${handOut.dueAt}`;
  });

  expect(new Set<string>(intervals).size).toBe(intervals.length);
}

describe("a probe polls every device that is due, not 250 a minute", () => {
  test("its limits are the probe's defaults", () => {
    expect(PROBE_NETWORK_DEVICE_POLL_CONCURRENCY).toBe(25);
    expect(DEVICE_POLLS_AT_ONCE).toBe(25);
    expect(DEVICE_ROOM_TO_ASK).toBe(13);
    expect(getDevicePollSlots().getCapacity()).toBe(25);
  });

  test("600 devices due are all polled in one tick, once each (#9499's ceiling was 250)", async () => {
    const ids: Array<string> = server.addDevices(600);

    await runTick();

    expect(polled).toHaveLength(600);
    expect(new Set<string>(polled)).toEqual(new Set<string>(ids));
    expect(server.dueCount()).toBe(0);
    expectNoDeviceHandedOutTwiceForOneInterval();
  });

  test("1,000 due are all polled, never more than 25 at once", async () => {
    server.addDevices(1000);
    pollTakes = (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 2);
      });
    };

    await runTick();

    expect(polled).toHaveLength(1000);
    expect(new Set<string>(polled).size).toBe(1000);
    expect(mostPollsAtOnce).toBeLessThanOrEqual(DEVICE_POLLS_AT_ONCE);
    // ...and it does use what it may.
    expect(mostPollsAtOnce).toBe(DEVICE_POLLS_AT_ONCE);
    expect(getDevicePollSlots().getInUse()).toBe(0);
    expectNoDeviceHandedOutTwiceForOneInterval();
  });

  test("it asks again while the batch is full, and stops at the first that is not", async () => {
    server.addDevices(60);

    await runTick();

    // Every answer but the last was full; the last one was not.
    expect(server.answeredFull.length).toBeGreaterThanOrEqual(3);
    expect(server.answeredFull.slice(0, -1)).not.toContain(false);
    expect(server.answeredFull[server.answeredFull.length - 1]).toBe(false);
    expect(server.dueCount()).toBe(0);
    expect(polled).toHaveLength(60);

    // The first question asks for every slot, the others for what is free.
    expect(server.asked[0]).toBe(25);
    for (const limit of server.asked) {
      expect(limit).toBeGreaterThanOrEqual(DEVICE_ROOM_TO_ASK);
      expect(limit).toBeLessThanOrEqual(DEVICE_POLLS_AT_ONCE);
    }
  });

  test("a batch that empties the queue exactly is followed by one more question, answered with nothing", async () => {
    server.addDevices(25);

    await runTick();

    expect(server.asked).toHaveLength(2);
    expect(server.answeredFull).toEqual([true, false]);
    expect(polled).toHaveLength(25);
  });

  test("with nothing due, it asks once a tick, as before", async () => {
    await runTick();
    await runTick();

    expect(server.asked).toEqual([25, 25]);
    expect(polled).toHaveLength(0);
  });

  test("a full claim is asked again even when the server kept some of it back", async () => {
    server.addDevices(60);
    // Every fifth claimed device is not handed to this probe.
    server.withholdEvery = 5;

    await runTick();

    /*
     * The first answer hands out 20 of the 25 it claimed: fewer than asked
     * for, but the server says it was full, and that decides.
     */
    expect(server.asked.length).toBeGreaterThanOrEqual(3);
    expect(server.dueCount()).toBe(0);
    expect(server.withheld).toBeGreaterThan(0);
    expect(polled).toHaveLength(60 - server.withheld);
  });

  test("the next minute's interval is polled once more, and only then", async () => {
    const ids: Array<string> = server.addDevices(300);

    await runTick();

    // Still the same minute: nothing more is due, so nothing is polled.
    reported = [];
    await runTick();
    expect(polled).toHaveLength(0);

    server.nextMinute();
    reported = [];
    await runTick();

    expect(new Set<string>(polled)).toEqual(new Set<string>(ids));
    expectNoDeviceHandedOutTwiceForOneInterval();
  });
});

describe("it asks only for what it has room for", () => {
  test("with ten slots held it asks for fifteen, and keeps asking for what comes free", async () => {
    getDevicePollSlots().take(10);
    server.addDevices(40);

    try {
      await fetchAndPollWhileDue();
      await whenDevicePollsSettle();
    } finally {
      getDevicePollSlots().release(10);
    }

    expect(server.asked[0]).toBe(15);
    for (const limit of server.asked) {
      expect(limit).toBeGreaterThanOrEqual(DEVICE_ROOM_TO_ASK);
      expect(limit).toBeLessThanOrEqual(15);
    }
    expect(reported).toHaveLength(40);
  });

  test("with room for fewer than half the polls it waits, then asks for what has come free", async () => {
    getDevicePollSlots().take(13);
    server.addDevices(3);

    const run: Promise<void> = fetchAndPollWhileDue();

    await flush();
    expect(server.asked).toEqual([]);
    expect(getDevicePollSlots().getWaiting()).toBe(1);

    getDevicePollSlots().release(1);
    await run;
    await whenDevicePollsSettle();

    expect(server.asked).toEqual([13]);
    expect(reported).toHaveLength(3);

    getDevicePollSlots().release(12);
  });

  test("one slow device holds its own slot, never the polls after it", async () => {
    server.addDevices(40);
    const slow: { promise: Promise<void>; finish: () => void } = heldPoll();

    pollTakes = (networkDeviceId: string): Promise<void> => {
      return networkDeviceId === "ping-0"
        ? slow.promise
        : new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 1);
          });
    };

    await fetchAndPollWhileDue();
    await settle(() => {
      return reported.length === 39;
    });

    try {
      // Before #9499 the rest of its batch waited behind it.
      expect(reported).toHaveLength(39);
      expect(getDevicePollSlots().getInUse()).toBe(1);
    } finally {
      slow.finish();
    }

    await whenDevicePollsSettle();
    expect(reported).toHaveLength(40);
    expect(getDevicePollSlots().getInUse()).toBe(0);
  });
});

describe("a server from before #9499", () => {
  test("hands out 250 whatever is asked: every device is polled, never more than 25 at once", async () => {
    server.isOld = true;
    server.addDevices(600);
    pollTakes = (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 1);
      });
    };

    await runTick();

    /*
     * A batch at least as big as was asked for reads as full: 250, 250 and
     * 100 are handed out, and a fourth question is answered with nothing.
     */
    expect(server.asked).toHaveLength(4);
    expect(server.asked[0]).toBe(25);
    expect(polled).toHaveLength(600);
    expect(new Set<string>(polled).size).toBe(600);
    expect(mostPollsAtOnce).toBeLessThanOrEqual(DEVICE_POLLS_AT_ONCE);
    expect(getDevicePollSlots().getInUse()).toBe(0);
    expectNoDeviceHandedOutTwiceForOneInterval();
  });

  test("it asks for the next batch only once the last one has every device in a slot", async () => {
    server.isOld = true;
    server.addDevices(300);
    const held: Array<{ promise: Promise<void>; finish: () => void }> = [];

    pollTakes = (): Promise<void> => {
      const poll: { promise: Promise<void>; finish: () => void } = heldPoll();
      held.push(poll);
      return poll.promise;
    };

    const run: Promise<void> = fetchAndPollWhileDue();
    await settle(() => {
      return held.length === 25;
    });

    // 250 claimed; 25 polling, 225 waiting for a slot, and no question more.
    expect(server.asked).toHaveLength(1);
    expect(getDevicePollSlots().getInUse()).toBe(25);
    expect(getDevicePollSlots().getWaiting()).toBe(226);

    pollTakes = (): Promise<void> => {
      return Promise.resolve();
    };
    for (const poll of held.splice(0)) {
      poll.finish();
    }

    await run;
    await whenDevicePollsSettle();

    // 250, then the last 50, then nothing.
    expect(reported).toHaveLength(300);
    expect(new Set<string>(reported).size).toBe(300);
    expect(server.asked).toHaveLength(3);
  });
});

describe("it backs off, and every slot comes back", () => {
  test("a busy answer while catching up stops the fetching; nothing is asked again until the wait is over", async () => {
    let now: number = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    server.addDevices(60);
    // The first batch is handed out; the second question is answered busy.
    server.scripted.set(2, "busy");

    await fetchAndPollWhileDue();
    await whenDevicePollsSettle();

    expect(server.asked).toHaveLength(2);
    expect(server.asked[0]).toBe(25);
    expect(reported).toHaveLength(25);
    expect(getDevicePollSlots().getInUse()).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      "busy handing out network devices",
    );

    // The next tick, before the ten seconds the server asked for.
    now += 9_999;
    await fetchAndPollWhileDue();
    expect(server.asked).toHaveLength(2);

    now += 1;
    await fetchAndPollWhileDue();
    await whenDevicePollsSettle();

    expect(reported).toHaveLength(60);
    expect(new Set<string>(reported).size).toBe(60);
  });

  test("a failed answer stops the fetching until the next tick, and gives its room back", async () => {
    server.addDevices(30);
    server.scripted.set(1, "error");

    await fetchAndPollWhileDue();
    await whenDevicePollsSettle();

    expect(server.asked).toEqual([25]);
    expect(reported).toHaveLength(0);
    expect(getDevicePollSlots().getInUse()).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("the server answered 500"),
    );

    // The next tick asks again, and catches up.
    await fetchAndPollWhileDue();
    await whenDevicePollsSettle();

    expect(reported).toHaveLength(30);
  });

  test("a fetch that never got an answer stops the fetching, and gives its room back", async () => {
    server.addDevices(30);
    server.scripted.set(1, "throw");

    await expect(fetchAndPollWhileDue()).resolves.toBeUndefined();

    expect(server.asked).toEqual([25]);
    expect(getDevicePollSlots().getInUse()).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "Error in fetching the network device list",
    );
  });

  test("an answer with no list is read as nothing due", async () => {
    server.addDevices(30);
    server.scripted.set(1, "junk");

    await fetchAndPollWhileDue();
    await whenDevicePollsSettle();

    expect(server.asked).toEqual([25]);
    expect(reported).toHaveLength(0);
    expect(getDevicePollSlots().getInUse()).toBe(0);
  });

  test("a poll that never settles gives its slot back at its deadline", async () => {
    expect(DEVICE_POLL_DEADLINE_MS).toBe(10 * 60 * 1000);

    pollTakes = (): Promise<void> => {
      return new Promise<void>(() => {
        // Never settles: a ping with no timeout of its own.
      });
    };

    const device: DevicePollConfig = {
      networkDeviceId: "device-wedged",
      projectId: "project-1",
      hostname: "10.0.0.9",
      pollMode: "ping",
      collectEndpoints: false,
    };

    await expect(pollDeviceWithDeadline(device, 20)).rejects.toThrow(
      "exceeded the 20ms deadline",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Network device device-wedged did not finish its poll within",
      ),
    );
  });

  test("a healthy poll settles before its deadline and leaves no timer behind", async () => {
    const device: DevicePollConfig = {
      networkDeviceId: "device-healthy",
      projectId: "project-1",
      hostname: "10.0.0.9",
      pollMode: "ping",
      collectEndpoints: false,
    };

    await expect(pollDeviceWithDeadline(device, 1000)).resolves.toBe(undefined);
    expect(reported).toEqual(["device-healthy"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("no device is polled twice for one interval", () => {
  test("a probe that restarts mid-batch polls what is still due, and nothing it was handed already", async () => {
    server.addDevices(80);
    const held: Array<{ promise: Promise<void>; finish: () => void }> = [];

    pollTakes = (): Promise<void> => {
      const poll: { promise: Promise<void>; finish: () => void } = heldPoll();
      held.push(poll);
      return poll.promise;
    };

    // The first process claims as many as it may poll at once...
    const firstRun: Promise<void> = fetchAndPollWhileDue();
    await settle(() => {
      return getDevicePollSlots().getWaiting() === 1;
    });
    expect(held).toHaveLength(25);

    // ...and restarts: its polls and its waiting fetch are gone.
    resetDevicePollRunInProgress();
    await firstRun;
    for (const poll of held) {
      poll.finish();
    }
    await flush();

    const handedToTheFirst: Set<string> = new Set<string>(
      server.handedOut.map((handOut: HandOut) => {
        return handOut.networkDeviceId;
      }),
    );
    expect(handedToTheFirst.size).toBe(25);

    reported = [];
    pollTakes = (): Promise<void> => {
      return Promise.resolve();
    };

    await runTick();

    // The 55 it had not been handed, and none of the 25 again.
    expect(polled).toHaveLength(55);
    for (const id of polled) {
      expect(handedToTheFirst.has(id)).toBe(false);
    }
    expect(server.dueCount()).toBe(0);
    expectNoDeviceHandedOutTwiceForOneInterval();
  });

  test("two copies of the probe at once share the due devices, each polled once", async () => {
    server.addDevices(400);

    /*
     * Another copy of this probe: the same server, a process of its own -
     * its own slots, its own guard - stood in for by a second load of the
     * module, its requests and pings pointed where this one's go.
     */
    let otherCopy: typeof import("../../../Jobs/NetworkDevice/FetchList") =
      undefined as never;
    jest.isolateModules(() => {
      const isolatedApi: typeof API = (
        jest.requireActual("Common/Utils/API") as { default: typeof API }
      ).default;
      jest.spyOn(isolatedApi, "fetch").mockImplementation(API.fetch as never);

      const isolatedPing: typeof PingMonitor = (
        jest.requireActual(
          "../../../Utils/Monitors/MonitorTypes/PingMonitor",
        ) as { default: typeof PingMonitor }
      ).default;
      jest
        .spyOn(isolatedPing, "checkReachability")
        .mockImplementation(PingMonitor.checkReachability as never);

      const isolatedLogger: typeof logger = (
        jest.requireActual("Common/Server/Utils/Logger") as {
          default: typeof logger;
        }
      ).default;
      for (const level of ["debug", "warn", "error"] as const) {
        jest.spyOn(isolatedLogger, level).mockImplementation((() => {
          return undefined;
        }) as never);
      }

      otherCopy = jest.requireActual(
        "../../../Jobs/NetworkDevice/FetchList",
      ) as typeof import("../../../Jobs/NetworkDevice/FetchList");
    });

    expect(otherCopy.getDevicePollSlots()).not.toBe(getDevicePollSlots());

    await Promise.all([
      fetchAndPollWhileDue(),
      otherCopy.fetchAndPollWhileDue(),
    ]);
    await whenDevicePollsSettle();
    await otherCopy.whenDevicePollsSettle();

    const counts: Map<string, number> = countsOf(reported);

    expect(counts.size).toBe(400);
    for (const [id, polls] of counts) {
      expect({ id, polls }).toEqual({ id, polls: 1 });
    }
    expectNoDeviceHandedOutTwiceForOneInterval();
  });
});

describe("the fetching never stacks, and a busy probe says so", () => {
  test("a fetch waiting for room skips the next tick", async () => {
    const held: Array<{ promise: Promise<void>; finish: () => void }> = [];

    pollTakes = (): Promise<void> => {
      const poll: { promise: Promise<void>; finish: () => void } = heldPoll();
      held.push(poll);
      return poll.promise;
    };

    server.addDevices(40);

    InitJob();
    const tick: PromiseVoidFunction =
      mockCapturedCronJobs[mockCapturedCronJobs.length - 1]!.runFunction;

    const firstTick: Promise<void> = tick();
    await settle(() => {
      return getDevicePollSlots().getWaiting() === 1;
    });

    // Every slot is busy, and the fetch waits for room.
    expect(held).toHaveLength(25);
    expect(isFetchingDevices()).toBe(true);
    expect(getDevicePollSlots().getFree()).toBe(0);

    const askedBefore: number = server.asked.length;

    await tick();
    await tick();
    await flush();

    // No fetch was started beside the one still waiting.
    expect(server.asked.length).toBe(askedBefore);

    // Room again: the waiting fetch asks for the last fifteen.
    pollTakes = (): Promise<void> => {
      return Promise.resolve();
    };
    for (const poll of held.splice(0)) {
      poll.finish();
    }

    await firstTick;
    await whenDevicePollsSettle();

    expect(isFetchingDevices()).toBe(false);
    expect(reported).toHaveLength(40);
    expect(new Set<string>(reported).size).toBe(40);
    expect(mostPollsAtOnce).toBeLessThanOrEqual(DEVICE_POLLS_AT_ONCE);
  });

  test("devices that wait a minute for room are said at warn, at most every ten minutes", async () => {
    let now: number = 5_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    const held: Array<{ promise: Promise<void>; finish: () => void }> = [];

    pollTakes = (): Promise<void> => {
      const poll: { promise: Promise<void>; finish: () => void } = heldPoll();
      held.push(poll);
      return poll.promise;
    };

    server.addDevices(30);

    const run: Promise<void> = fetchAndPollWhileDue();
    await settle(() => {
      return getDevicePollSlots().getWaiting() === 1;
    });
    expect(held).toHaveLength(25);

    // A minute passes with every slot busy and five more due.
    now += DEVICE_WAIT_WARNING_AFTER_MS;
    pollTakes = (): Promise<void> => {
      return Promise.resolve();
    };
    for (const poll of held.splice(0)) {
      poll.finish();
    }
    await run;
    await whenDevicePollsSettle();

    const waits: Array<string> = warnSpy.mock.calls
      .map((call: Array<unknown>) => {
        return String(call[0]);
      })
      .filter((message: string) => {
        return message.includes("network devices it may poll at once");
      });

    expect(waits).toHaveLength(1);
    expect(waits[0]).toContain("they waited 60 s for room");
    expect(waits[0]).toContain(
      "PROBE_NETWORK_DEVICE_POLL_CONCURRENCY (now 25)",
    );

    // The same within ten minutes is not said again.
    server.nextMinute();
    pollTakes = (): Promise<void> => {
      const poll: { promise: Promise<void>; finish: () => void } = heldPoll();
      held.push(poll);
      return poll.promise;
    };
    const again: Promise<void> = fetchAndPollWhileDue();
    await settle(() => {
      return getDevicePollSlots().getWaiting() === 1;
    });
    now += DEVICE_WAIT_WARNING_AFTER_MS;
    expect(DEVICE_WAIT_WARNING_AFTER_MS * 2).toBeLessThan(
      DEVICE_WAIT_WARNING_EVERY_MS,
    );
    pollTakes = (): Promise<void> => {
      return Promise.resolve();
    };
    for (const poll of held.splice(0)) {
      poll.finish();
    }
    await again;

    expect(
      warnSpy.mock.calls.filter((call: Array<unknown>) => {
        return String(call[0]).includes("network devices it may poll at once");
      }),
    ).toHaveLength(1);
  });

  test("a short wait for room after a full batch is not said", async () => {
    server.addDevices(120);
    pollTakes = (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 2);
      });
    };

    await runTick();

    expect(polled).toHaveLength(120);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
