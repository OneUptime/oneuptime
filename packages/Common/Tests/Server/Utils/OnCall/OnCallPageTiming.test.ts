import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Telemetry from "../../../../Server/Utils/Telemetry";
import OnCallPageTiming, {
  OnCallPageStartMoment,
} from "../../../../Server/Utils/OnCall/OnCallPageTiming";
import { OnCallPageStart } from "../../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHEN A PAGE STARTED, TOLD TO THE NOTIFICATIONS IT SENDS AT ONCE
 * (OnCallPageTiming, notification.time_to_send).
 *
 * A page's start travels down the call that pages - through every await,
 * timer and promise - to the notifications it writes, and to nothing
 * written outside it; each notification due at the start keeps it in Redis
 * for the server that writes that it was sent, which takes it back once.
 */

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

const RECORD_CREATED_AT: Date = new Date("2026-11-10T09:30:00.000Z");
const NOTIFICATION_ID: ObjectID = new ObjectID(
  "6600aaaa-0000-4000-8000-000000000001",
);

// An in-memory Redis for the two calls OnCallPageTiming makes.
let cache: Map<string, { value: string; expiresInSeconds: number }>;
let setString: jest.SpiedFunction<typeof GlobalCache.setString>;
let getAndDeleteString: jest.SpiedFunction<
  typeof GlobalCache.getAndDeleteString
>;
let metricsEnabled: jest.SpiedFunction<typeof Telemetry.isMetricsEnabled>;

beforeEach(() => {
  cache = new Map();

  setString = jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number },
      ): Promise<void> => {
        cache.set(`${namespace}-${key}`, {
          value: value,
          expiresInSeconds: options?.expiresInSeconds || 0,
        });
      },
    );

  getAndDeleteString = jest
    .spyOn(GlobalCache, "getAndDeleteString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        const entry: { value: string } | undefined = cache.get(
          `${namespace}-${key}`,
        );
        cache.delete(`${namespace}-${key}`);
        return entry ? entry.value : null;
      },
    );

  metricsEnabled = jest
    .spyOn(Telemetry, "isMetricsEnabled")
    .mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A turn of the event loop (Common's jest environment is jsdom: no setImmediate).
function nextTick(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

describe("when a page starts", () => {
  test("a page started on its own starts now", () => {
    const before: number = Date.now();
    const moment: OnCallPageStartMoment = OnCallPageTiming.startPage();
    const after: number = Date.now();

    expect(moment.start).toBe(OnCallPageStart.PageStarted);
    expect(moment.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(moment.startedAt.getTime()).toBeLessThanOrEqual(after);
  });

  test("a page started as its record is created starts at the record's creation - the trigger", async () => {
    const moment: OnCallPageStartMoment =
      await OnCallPageTiming.runAsRecordIsCreated(
        { recordCreatedAt: RECORD_CREATED_AT },
        async (): Promise<OnCallPageStartMoment> => {
          // The fan-out does work of its own before a run starts paging.
          await nextTick();
          return OnCallPageTiming.startPage();
        },
      );

    expect(moment).toEqual({
      startedAt: RECORD_CREATED_AT,
      start: OnCallPageStart.RecordCreated,
    });
  });

  test("a record's creation time read back as a string counts as well", async () => {
    const moment: OnCallPageStartMoment =
      await OnCallPageTiming.runAsRecordIsCreated(
        { recordCreatedAt: RECORD_CREATED_AT.toISOString() },
        async (): Promise<OnCallPageStartMoment> => {
          return OnCallPageTiming.startPage();
        },
      );

    expect(moment.startedAt.getTime()).toBe(RECORD_CREATED_AT.getTime());
    expect(moment.start).toBe(OnCallPageStart.RecordCreated);
  });

  test("a record with no creation time, or one that is not a time, starts its pages now", async () => {
    for (const recordCreatedAt of [undefined, "not a date"]) {
      const before: number = Date.now();

      const moment: OnCallPageStartMoment =
        await OnCallPageTiming.runAsRecordIsCreated(
          { recordCreatedAt: recordCreatedAt },
          async (): Promise<OnCallPageStartMoment> => {
            return OnCallPageTiming.startPage();
          },
        );

      expect(moment.start).toBe(OnCallPageStart.RecordCreated);
      expect(moment.startedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(isNaN(moment.startedAt.getTime())).toBe(false);
    }
  });

  test("the fan-out's value and its error are passed on", async () => {
    await expect(
      OnCallPageTiming.runAsRecordIsCreated(
        { recordCreatedAt: RECORD_CREATED_AT },
        async (): Promise<number> => {
          return 42;
        },
      ),
    ).resolves.toBe(42);

    const error: Error = new Error("The policy is gone.");

    await expect(
      OnCallPageTiming.runAsRecordIsCreated(
        { recordCreatedAt: RECORD_CREATED_AT },
        async (): Promise<void> => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
  });

  test("after the record's fan-out, a page starts now again", async () => {
    await OnCallPageTiming.runAsRecordIsCreated(
      { recordCreatedAt: RECORD_CREATED_AT },
      async (): Promise<void> => {
        await nextTick();
      },
    );

    expect(OnCallPageTiming.startPage().start).toBe(
      OnCallPageStart.PageStarted,
    );
  });
});

describe("a record a monitor's data tripped", () => {
  // The request arrived 40 seconds before its queued job opened the incident.
  const REQUEST_RECEIVED_AT: Date = new Date(
    RECORD_CREATED_AT.getTime() - 40_000,
  );

  async function startOfPageOpenedBy(
    dataReceivedAt: Date | undefined,
    recordCreatedAt: Date = RECORD_CREATED_AT,
  ): Promise<OnCallPageStartMoment> {
    return await OnCallPageTiming.runAsMonitorTriggered(
      { dataReceivedAt: dataReceivedAt },
      async (): Promise<OnCallPageStartMoment> => {
        // The record's create, its hooks, and its on-call fan-out.
        await nextTick();

        return await OnCallPageTiming.runAsRecordIsCreated(
          { recordCreatedAt: recordCreatedAt },
          async (): Promise<OnCallPageStartMoment> => {
            await nextTick();
            return OnCallPageTiming.startPage();
          },
        );
      },
    );
  }

  test("pages from when OneUptime received the data - the incoming request - not from when the queue got to it", async () => {
    expect(await startOfPageOpenedBy(REQUEST_RECEIVED_AT)).toEqual({
      startedAt: REQUEST_RECEIVED_AT,
      start: OnCallPageStart.MonitorDataReceived,
    });
  });

  test("data received after the record was created - two servers' clocks apart - pages from the record's creation", async () => {
    expect(
      await startOfPageOpenedBy(new Date(RECORD_CREATED_AT.getTime() + 500)),
    ).toEqual({
      startedAt: RECORD_CREATED_AT,
      start: OnCallPageStart.RecordCreated,
    });
  });

  test("no moment of receipt - a probe's check, a telemetry monitor - pages from the record's creation", async () => {
    expect(await startOfPageOpenedBy(undefined)).toEqual({
      startedAt: RECORD_CREATED_AT,
      start: OnCallPageStart.RecordCreated,
    });
    expect(await startOfPageOpenedBy(new Date("not a date"))).toEqual({
      startedAt: RECORD_CREATED_AT,
      start: OnCallPageStart.RecordCreated,
    });
  });

  test("the monitor's create runs and answers as it would without the timing", async () => {
    const error: Error = new Error("Incident state not found.");

    await expect(
      OnCallPageTiming.runAsMonitorTriggered(
        { dataReceivedAt: REQUEST_RECEIVED_AT },
        async (): Promise<string> => {
          return "created";
        },
      ),
    ).resolves.toBe("created");

    await expect(
      OnCallPageTiming.runAsMonitorTriggered(
        { dataReceivedAt: undefined },
        async (): Promise<void> => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
  });

  test("a record created outside the monitor's create - by a person, later - is not timed from its data", async () => {
    await OnCallPageTiming.runAsMonitorTriggered(
      { dataReceivedAt: REQUEST_RECEIVED_AT },
      async (): Promise<void> => {
        await nextTick();
      },
    );

    const moment: OnCallPageStartMoment =
      await OnCallPageTiming.runAsRecordIsCreated(
        { recordCreatedAt: RECORD_CREATED_AT },
        async (): Promise<OnCallPageStartMoment> => {
          return OnCallPageTiming.startPage();
        },
      );

    expect(moment.start).toBe(OnCallPageStart.RecordCreated);
  });
});

describe("when OneUptime received a monitor's data", () => {
  const RECEIVED_AT: Date = new Date("2026-11-10T09:29:20.000Z");

  test("an incoming request: when it was received at the edge", () => {
    expect(
      OnCallPageTiming.getMonitorDataReceivedAt({
        incomingRequestReceivedAt: RECEIVED_AT,
        onlyCheckForIncomingRequestReceivedAt: false,
        requestBody: { status: "down" },
      }),
    ).toEqual(RECEIVED_AT);
  });

  test("an incoming request read back from a queue, its time as text: the same", () => {
    expect(
      OnCallPageTiming.getMonitorDataReceivedAt({
        incomingRequestReceivedAt: RECEIVED_AT.toISOString(),
      }),
    ).toEqual(RECEIVED_AT);
  });

  test("the heartbeat's check that no request came: none - its time is the last request's, long before", () => {
    expect(
      OnCallPageTiming.getMonitorDataReceivedAt({
        incomingRequestReceivedAt: RECEIVED_AT,
        onlyCheckForIncomingRequestReceivedAt: true,
      }),
    ).toBeUndefined();
  });

  test.each([
    [
      "a probe's check, timed by the probe's own clock",
      { monitoredAt: RECEIVED_AT, probeId: "p" },
    ],
    [
      "a server agent's report",
      { requestReceivedAt: RECEIVED_AT, hostname: "web-1" },
    ],
    ["an incoming email", { emailReceivedAt: RECEIVED_AT }],
    ["a telemetry monitor's evaluation", { logQuery: {} }],
    [
      "an incoming request whose time is not a time",
      { incomingRequestReceivedAt: "soon" },
    ],
    [
      "an incoming request with no time",
      { incomingRequestReceivedAt: undefined },
    ],
    ["nothing", undefined],
    ["something that is not data", "a string"],
  ])("%s: none", (_what: string, data: unknown) => {
    expect(OnCallPageTiming.getMonitorDataReceivedAt(data)).toBeUndefined();
  });
});

describe("the notifications a page sends as it starts", () => {
  const MOMENT: OnCallPageStartMoment = {
    startedAt: RECORD_CREATED_AT,
    start: OnCallPageStart.RecordCreated,
  };

  test("are told the page's start, through every await, timer and promise", async () => {
    const seen: Array<OnCallPageStartMoment | null> = [];

    await OnCallPageTiming.runInPageStart(MOMENT, async (): Promise<void> => {
      seen.push(OnCallPageTiming.getPageStart());
      await nextTick();
      seen.push(OnCallPageTiming.getPageStart());

      await new Promise<void>((resolve: () => void) => {
        setTimeout(() => {
          seen.push(OnCallPageTiming.getPageStart());
          resolve();
        }, 1);
      });

      await Promise.resolve().then(() => {
        seen.push(OnCallPageTiming.getPageStart());
      });

      // A send handed off without waiting for it, as every page's are.
      const handedOff: Promise<void> = (async (): Promise<void> => {
        await nextTick();
        seen.push(OnCallPageTiming.getPageStart());
      })();

      await handedOff;
    });

    expect(seen).toHaveLength(5);

    for (const moment of seen) {
      expect(moment).toEqual(MOMENT);
    }
  });

  test("nothing written outside a page's start is told one", async () => {
    expect(OnCallPageTiming.getPageStart()).toBeNull();

    await OnCallPageTiming.runInPageStart(MOMENT, async (): Promise<void> => {
      await nextTick();
    });

    // A worker's later rule, a repeat, the next level: none of them.
    expect(OnCallPageTiming.getPageStart()).toBeNull();
  });

  test("two pages starting at once each tell their own notifications their own start", async () => {
    const first: OnCallPageStartMoment = {
      startedAt: new Date("2026-11-10T09:00:00.000Z"),
      start: OnCallPageStart.RecordCreated,
    };
    const second: OnCallPageStartMoment = {
      startedAt: new Date("2026-11-10T09:00:07.000Z"),
      start: OnCallPageStart.PageStarted,
    };

    const seenByFirst: Array<OnCallPageStartMoment | null> = [];
    const seenBySecond: Array<OnCallPageStartMoment | null> = [];

    await Promise.all([
      OnCallPageTiming.runInPageStart(first, async (): Promise<void> => {
        for (let i: number = 0; i < 5; i++) {
          await nextTick();
          seenByFirst.push(OnCallPageTiming.getPageStart());
        }
      }),
      OnCallPageTiming.runInPageStart(second, async (): Promise<void> => {
        for (let i: number = 0; i < 5; i++) {
          await nextTick();
          seenBySecond.push(OnCallPageTiming.getPageStart());
        }
      }),
    ]);

    expect(seenByFirst).toEqual(Array(5).fill(first));
    expect(seenBySecond).toEqual(Array(5).fill(second));
  });

  test("a level the run moves on to at once, started inside the first, is due at the same start", async () => {
    const outer: OnCallPageStartMoment = OnCallPageTiming.startPage();

    const seen: OnCallPageStartMoment | null =
      await OnCallPageTiming.runInPageStart(
        outer,
        async (): Promise<OnCallPageStartMoment | null> => {
          return await OnCallPageTiming.runInPageStart(
            outer,
            async (): Promise<OnCallPageStartMoment | null> => {
              return OnCallPageTiming.getPageStart();
            },
          );
        },
      );

    expect(seen).toBe(outer);
  });

  test("a run started inside a record's fan-out starts at the record, and its notifications are told so", async () => {
    const seen: OnCallPageStartMoment | null =
      await OnCallPageTiming.runAsRecordIsCreated(
        { recordCreatedAt: RECORD_CREATED_AT },
        async (): Promise<OnCallPageStartMoment | null> => {
          // The run's start (OnCallDutyPolicyExecutionLogService).
          const pageStart: OnCallPageStartMoment = OnCallPageTiming.startPage();

          return await OnCallPageTiming.runInPageStart(
            pageStart,
            async (): Promise<OnCallPageStartMoment | null> => {
              await nextTick();
              return OnCallPageTiming.getPageStart();
            },
          );
        },
      );

    expect(seen).toEqual({
      startedAt: RECORD_CREATED_AT,
      start: OnCallPageStart.RecordCreated,
    });
  });

  test("the record's fan-out alone tells no notification a start: only a page that starts does", async () => {
    const seen: OnCallPageStartMoment | null =
      await OnCallPageTiming.runAsRecordIsCreated(
        { recordCreatedAt: RECORD_CREATED_AT },
        async (): Promise<OnCallPageStartMoment | null> => {
          return OnCallPageTiming.getPageStart();
        },
      );

    expect(seen).toBeNull();
  });
});

describe("keeping a notification's page start for the server that sends it", () => {
  const MOMENT: OnCallPageStartMoment = {
    startedAt: RECORD_CREATED_AT,
    start: OnCallPageStart.RecordCreated,
  };

  test("a notification written as its page starts keeps the start, for six hours", async () => {
    await OnCallPageTiming.runInPageStart(MOMENT, async (): Promise<void> => {
      await OnCallPageTiming.rememberPageStartOf(NOTIFICATION_ID);
    });

    expect(setString).toHaveBeenCalledTimes(1);

    const key: string = `${OnCallPageTiming.CACHE_NAMESPACE}-${NOTIFICATION_ID.toString()}`;

    expect(cache.get(key)!.expiresInSeconds).toBe(6 * 60 * 60);
    expect(OnCallPageTiming.fromCacheValue(cache.get(key)!.value)).toEqual(
      MOMENT,
    );
  });

  test("a notification written outside a page's start keeps nothing", async () => {
    await OnCallPageTiming.rememberPageStartOf(NOTIFICATION_ID);

    expect(setString).not.toHaveBeenCalled();
  });

  test("a notification with no id keeps nothing", async () => {
    await OnCallPageTiming.runInPageStart(MOMENT, async (): Promise<void> => {
      await OnCallPageTiming.rememberPageStartOf(undefined);
    });

    expect(setString).not.toHaveBeenCalled();
  });

  test("without a metrics exporter nothing is kept, and nothing is read", async () => {
    metricsEnabled.mockReturnValue(false);

    await OnCallPageTiming.runInPageStart(MOMENT, async (): Promise<void> => {
      await OnCallPageTiming.rememberPageStartOf(NOTIFICATION_ID);
    });

    expect(setString).not.toHaveBeenCalled();
    expect(await OnCallPageTiming.takePageStartOf(NOTIFICATION_ID)).toBeNull();
    expect(getAndDeleteString).not.toHaveBeenCalled();
  });

  test("the server that writes it was sent takes the start back, once", async () => {
    await OnCallPageTiming.runInPageStart(MOMENT, async (): Promise<void> => {
      await OnCallPageTiming.rememberPageStartOf(NOTIFICATION_ID);
    });

    // Outside the page's start: another server, a later call.
    expect(await OnCallPageTiming.takePageStartOf(NOTIFICATION_ID)).toEqual(
      MOMENT,
    );

    // A second "sent" finds nothing to record again.
    expect(await OnCallPageTiming.takePageStartOf(NOTIFICATION_ID)).toBeNull();
  });

  test("a notification nothing was kept for takes back nothing", async () => {
    expect(await OnCallPageTiming.takePageStartOf(NOTIFICATION_ID)).toBeNull();
    expect(await OnCallPageTiming.takePageStartOf(undefined)).toBeNull();
  });

  test("Redis that cannot be reached loses the metric, never the page", async () => {
    setString.mockRejectedValue(new Error("Cache is not connected"));
    getAndDeleteString.mockRejectedValue(new Error("Cache is not connected"));

    await expect(
      OnCallPageTiming.runInPageStart(MOMENT, async (): Promise<void> => {
        await OnCallPageTiming.rememberPageStartOf(NOTIFICATION_ID);
      }),
    ).resolves.toBeUndefined();

    await expect(
      OnCallPageTiming.takePageStartOf(NOTIFICATION_ID),
    ).resolves.toBeNull();
  });
});

describe("a kept page start, written and read back", () => {
  test("reads back as it was written", () => {
    for (const start of Object.values(OnCallPageStart)) {
      const moment: OnCallPageStartMoment = {
        startedAt: new Date("2026-11-10T09:30:12.345Z"),
        start: start,
      };

      expect(
        OnCallPageTiming.fromCacheValue(OnCallPageTiming.toCacheValue(moment)),
      ).toEqual(moment);
    }
  });

  test.each([
    ["nothing", null],
    ["an empty value", ""],
    ["text that is not JSON", "{not json"],
    ["JSON that is not an object", "42"],
    ["JSON null", "null"],
    [
      "a start that is not a number",
      JSON.stringify({ startedAt: "soon", start: "record_created" }),
    ],
    [
      "a start that is not finite",
      '{"startedAt":1e999,"start":"record_created"}',
    ],
    ["no start at all", JSON.stringify({ start: "record_created" })],
    [
      "a kind no page starts with",
      JSON.stringify({ startedAt: 1, start: "yesterday" }),
    ],
    ["no kind at all", JSON.stringify({ startedAt: 1 })],
  ])("%s reads back as nothing", (_what: string, value: string | null) => {
    expect(OnCallPageTiming.fromCacheValue(value)).toBeNull();
  });
});
