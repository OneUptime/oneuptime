import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Telemetry from "../../../../Server/Utils/Telemetry";
import OnCallPageTiming from "../../../../Server/Utils/OnCall/OnCallPageTiming";
import OnCallSendLag, {
  OnCallRuleDelivery,
  OnCallRulesTick,
  OnCallScheduledSend,
} from "../../../../Server/Utils/OnCall/OnCallSendLag";
import {
  NotificationSchedule,
  OnCallPageStart,
} from "../../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import { getRepeatClaimKey } from "../../../../Types/NotificationRule/NotificationRepeat";
import ObjectID from "../../../../Types/ObjectID";

/*
 * HOW LATE AN ON-CALL NOTIFICATION SENT LATER WENT OUT (OnCallSendLag,
 * notification.send.lag, issue #6646).
 *
 * A worker that sends what a wait made due runs the send inside a
 * scheduled send: its due moment travels down the call - through every
 * await, timer and promise - to the notifications it writes, and to
 * nothing outside it. Each such notification keeps it in Redis for the
 * server that writes that it was sent, which takes it back once. Inside a
 * page's start nothing is kept: that start times it.
 *
 * The rules' worker tells each delivery of a person's rule when it was due
 * (OnCallRulesTick): its rule's schedule from the log's start, for a repeat
 * a backed-up worker sends from the first repeat it skipped, and never
 * before the worker last went through the log's rules.
 */

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

const MINUTE_IN_MS: number = 60 * 1000;

const NOTIFICATION_ID: ObjectID = new ObjectID(
  "6646aaaa-0000-4000-8000-000000000001",
);
const LOG_ID: ObjectID = new ObjectID("6646aaaa-0000-4000-8000-000000000002");
const RULE_ID: string = "6646aaaa-0000-4000-8000-000000000003";

const LOG_CREATED_AT: Date = new Date("2026-11-10T09:00:00.000Z");
const DUE_AT: Date = new Date("2026-11-10T09:10:00.000Z");

const SEND: OnCallScheduledSend = {
  dueAt: DUE_AT,
  schedule: NotificationSchedule.RuleWait,
};

// An in-memory Redis for the calls OnCallSendLag makes.
let cache: Map<string, { value: string; expiresInSeconds: number }>;
let setString: jest.SpiedFunction<typeof GlobalCache.setString>;
let getString: jest.SpiedFunction<typeof GlobalCache.getString>;
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

  getString = jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        return cache.get(`${namespace}-${key}`)?.value || null;
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

function minutesAfter(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * MINUTE_IN_MS);
}

describe("a scheduled send, told to what it writes", () => {
  test("is told through every await, timer and promise of the send", async () => {
    const seen: Array<OnCallScheduledSend | null> = [];

    await OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
      seen.push(OnCallSendLag.getScheduledSend());
      await nextTick();
      seen.push(OnCallSendLag.getScheduledSend());
      await Promise.all([
        (async (): Promise<void> => {
          await nextTick();
          seen.push(OnCallSendLag.getScheduledSend());
        })(),
      ]);
    });

    expect(seen).toEqual([SEND, SEND, SEND]);
  });

  test("nothing outside a send is told one", async () => {
    expect(OnCallSendLag.getScheduledSend()).toBeNull();

    await OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
      await nextTick();
    });

    expect(OnCallSendLag.getScheduledSend()).toBeNull();
  });

  test("two sends at once each tell their own notifications their own moment", async () => {
    const other: OnCallScheduledSend = {
      dueAt: minutesAfter(DUE_AT, 5),
      schedule: NotificationSchedule.Escalation,
    };
    const seen: Array<OnCallScheduledSend | null> = [];

    await Promise.all([
      OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
        await nextTick();
        await nextTick();
        seen[0] = OnCallSendLag.getScheduledSend();
      }),
      OnCallSendLag.runAsScheduledSend(other, async (): Promise<void> => {
        await nextTick();
        seen[1] = OnCallSendLag.getScheduledSend();
      }),
    ]);

    expect(seen).toEqual([SEND, other]);
  });

  test("a send inside another tells its own moment, and the outer one's after it", async () => {
    const inner: OnCallScheduledSend = {
      dueAt: minutesAfter(DUE_AT, 1),
      schedule: NotificationSchedule.PolicyRepeat,
    };
    const seen: Array<OnCallScheduledSend | null> = [];

    await OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
      await OnCallSendLag.runAsScheduledSend(inner, async (): Promise<void> => {
        await nextTick();
        seen.push(OnCallSendLag.getScheduledSend());
      });
      seen.push(OnCallSendLag.getScheduledSend());
    });

    expect(seen).toEqual([inner, SEND]);
  });

  test("a moment read as text counts, as a Date of its own", async () => {
    let seen: OnCallScheduledSend | null = null;
    const dueAt: Date = new Date(DUE_AT.getTime());

    await OnCallSendLag.runAsScheduledSend(
      {
        dueAt: "2026-11-10T09:10:00.000Z" as unknown as Date,
        schedule: NotificationSchedule.Repeat,
      },
      async (): Promise<void> => {
        seen = OnCallSendLag.getScheduledSend();
      },
    );

    expect(seen).toEqual({
      dueAt: dueAt,
      schedule: NotificationSchedule.Repeat,
    });

    // A Date handed in is copied: changing it later changes nothing told.
    await OnCallSendLag.runAsScheduledSend(
      { dueAt: dueAt, schedule: NotificationSchedule.Repeat },
      async (): Promise<void> => {
        dueAt.setTime(0);
        seen = OnCallSendLag.getScheduledSend();
      },
    );

    expect(seen!.dueAt).toEqual(DUE_AT);
  });

  test.each([
    ["no moment", undefined],
    ["a null moment", null],
    ["a Date that is not a moment", new Date(NaN)],
    ["text that is not a moment", "soon"],
    ["empty text", ""],
  ])(
    "%s: the send runs as it is, telling nothing",
    async (_what: string, dueAt: unknown) => {
      let seen: OnCallScheduledSend | null | undefined = undefined;

      const value: string = await OnCallSendLag.runAsScheduledSend(
        {
          dueAt: dueAt as Date | undefined,
          schedule: NotificationSchedule.RuleWait,
        },
        async (): Promise<string> => {
          seen = OnCallSendLag.getScheduledSend();
          return "sent";
        },
      );

      expect(value).toBe("sent");
      expect(seen).toBeNull();
    },
  );

  test("the send's value and its error are passed on", async () => {
    const error: Error = new Error("Twilio is down");

    await expect(
      OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<number> => {
        return 42;
      }),
    ).resolves.toBe(42);

    await expect(
      OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});

describe("keeping a notification's due moment for the server that sends it", () => {
  const KEY: string = `${OnCallSendLag.CACHE_NAMESPACE}-${NOTIFICATION_ID.toString()}`;

  test("a notification written by a scheduled send keeps its moment, for six hours", async () => {
    await OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
      await OnCallSendLag.rememberDueTimeOf(NOTIFICATION_ID);
    });

    expect(setString).toHaveBeenCalledTimes(1);
    expect(cache.get(KEY)!.expiresInSeconds).toBe(6 * 60 * 60);
    expect(OnCallSendLag.fromCacheValue(cache.get(KEY)!.value)).toEqual(SEND);
  });

  test("the server that writes it was sent takes it back, once", async () => {
    await OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
      await OnCallSendLag.rememberDueTimeOf(NOTIFICATION_ID);
    });

    // Outside the send: another server, a later call.
    expect(await OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID)).toEqual(SEND);

    // A second "sent" finds nothing to record again.
    expect(await OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID)).toBeNull();
    expect(getAndDeleteString).toHaveBeenCalledTimes(2);
  });

  test("each schedule keeps and reads back as itself", async () => {
    for (const schedule of Object.values(NotificationSchedule)) {
      const send: OnCallScheduledSend = { dueAt: DUE_AT, schedule: schedule };

      await OnCallSendLag.runAsScheduledSend(send, async (): Promise<void> => {
        await OnCallSendLag.rememberDueTimeOf(NOTIFICATION_ID);
      });

      expect(await OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID)).toEqual(send);
    }
  });

  test("a notification written outside a scheduled send keeps nothing", async () => {
    await OnCallSendLag.rememberDueTimeOf(NOTIFICATION_ID);

    expect(setString).not.toHaveBeenCalled();
  });

  test("a notification written as its page starts keeps nothing here: its page's start times it", async () => {
    await OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
      await OnCallPageTiming.runInPageStart(
        {
          startedAt: LOG_CREATED_AT,
          start: OnCallPageStart.PageStarted,
        },
        async (): Promise<void> => {
          await OnCallSendLag.rememberDueTimeOf(NOTIFICATION_ID);
        },
      );
    });

    expect(setString).not.toHaveBeenCalled();
  });

  test("a notification with no id keeps nothing", async () => {
    await OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
      await OnCallSendLag.rememberDueTimeOf(undefined);
      await OnCallSendLag.rememberDueTimeOf(null);
    });

    expect(setString).not.toHaveBeenCalled();
    expect(await OnCallSendLag.takeDueTimeOf(undefined)).toBeNull();
    expect(getAndDeleteString).not.toHaveBeenCalled();
  });

  test("without a metrics exporter nothing is kept, and nothing is read", async () => {
    metricsEnabled.mockReturnValue(false);

    await OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
      await OnCallSendLag.rememberDueTimeOf(NOTIFICATION_ID);
    });

    expect(setString).not.toHaveBeenCalled();
    expect(await OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID)).toBeNull();
    expect(getAndDeleteString).not.toHaveBeenCalled();
  });

  test("a notification nothing was kept for takes back nothing", async () => {
    expect(await OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID)).toBeNull();
  });

  test("a kept value that is not a due moment reads back as nothing", async () => {
    cache.set(KEY, { value: "{not json", expiresInSeconds: 1 });

    expect(await OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID)).toBeNull();
  });

  test("Redis that cannot be reached loses the metric, never the notification", async () => {
    setString.mockRejectedValue(new Error("Cache is not connected"));
    getAndDeleteString.mockRejectedValue(new Error("Cache is not connected"));

    await expect(
      OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
        await OnCallSendLag.rememberDueTimeOf(NOTIFICATION_ID);
      }),
    ).resolves.toBeUndefined();

    await expect(
      OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID),
    ).resolves.toBeNull();
  });

  test("a metrics switch that throws loses the metric, never the notification", async () => {
    metricsEnabled.mockImplementation(() => {
      throw new Error("Telemetry is not set up");
    });

    await expect(
      OnCallSendLag.runAsScheduledSend(SEND, async (): Promise<void> => {
        await OnCallSendLag.rememberDueTimeOf(NOTIFICATION_ID);
      }),
    ).resolves.toBeUndefined();
    await expect(
      OnCallSendLag.takeDueTimeOf(NOTIFICATION_ID),
    ).resolves.toBeNull();
  });

  test("isOn is whether a metrics exporter is configured", () => {
    metricsEnabled.mockReturnValue(true);
    expect(OnCallSendLag.isOn()).toBe(true);

    metricsEnabled.mockReturnValue(false);
    expect(OnCallSendLag.isOn()).toBe(false);
  });
});

describe("a kept due moment, written and read back", () => {
  test("reads back as it was written, to the millisecond", () => {
    for (const schedule of Object.values(NotificationSchedule)) {
      const send: OnCallScheduledSend = {
        dueAt: new Date("2026-11-10T09:30:12.345Z"),
        schedule: schedule,
      };

      expect(
        OnCallSendLag.fromCacheValue(OnCallSendLag.toCacheValue(send)),
      ).toEqual(send);
    }
  });

  test.each([
    ["nothing", null],
    ["undefined", undefined],
    ["an empty value", ""],
    ["text that is not JSON", "{not json"],
    ["JSON that is not an object", "42"],
    ["JSON text", '"rule_wait"'],
    ["JSON null", "null"],
    ["a list", "[1, 2]"],
    [
      "a moment that is not a number",
      JSON.stringify({ dueAt: "2026-11-10T09:10:00.000Z", schedule: "repeat" }),
    ],
    ["a moment that is not finite", '{"dueAt":1e999,"schedule":"repeat"}'],
    ["no moment at all", JSON.stringify({ schedule: "repeat" })],
    [
      "a schedule nothing is sent after",
      JSON.stringify({ dueAt: 1, schedule: "tomorrow" }),
    ],
    [
      "a page's start kept in its place",
      JSON.stringify({ startedAt: 1, start: "record_created" }),
    ],
    ["no schedule at all", JSON.stringify({ dueAt: 1 })],
  ])("%s reads back as nothing", (_what: string, value: unknown) => {
    expect(
      OnCallSendLag.fromCacheValue(value as string | null | undefined),
    ).toBeNull();
  });
});

describe("a moment as a Date of its own (toValidDate)", () => {
  test("a Date: a copy of it", () => {
    const date: Date = new Date(DUE_AT.getTime());
    const copy: Date | null = OnCallSendLag.toValidDate(date);

    expect(copy).toEqual(DUE_AT);
    expect(copy).not.toBe(date);
  });

  test("text that is a moment: that moment", () => {
    expect(OnCallSendLag.toValidDate("2026-11-10T09:10:00.000Z")).toEqual(
      DUE_AT,
    );
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["empty text", ""],
    ["text that is no moment", "soon"],
    ["a Date that is no moment", new Date(NaN)],
    ["a number", DUE_AT.getTime()],
    ["an object", { dueAt: DUE_AT }],
    ["true", true],
  ])("%s: none", (_what: string, value: unknown) => {
    expect(OnCallSendLag.toValidDate(value)).toBeNull();
  });
});

describe("when a delivery of a person's rule was due (getRuleDeliveryDueAt)", () => {
  const NOW: Date = minutesAfter(LOG_CREATED_AT, 30);
  const SCHEDULED_AT: Date = minutesAfter(LOG_CREATED_AT, 10);

  test("when its schedule says, with no tick of the worker known", () => {
    expect(
      OnCallSendLag.getRuleDeliveryDueAt({
        scheduledAt: SCHEDULED_AT,
        now: NOW,
      }),
    ).toEqual(SCHEDULED_AT);
    expect(
      OnCallSendLag.getRuleDeliveryDueAt({
        scheduledAt: SCHEDULED_AT,
        rulesCheckedAt: null,
        now: NOW,
      }),
    ).toEqual(SCHEDULED_AT);
  });

  test("a tick of the worker before it was scheduled changes nothing", () => {
    expect(
      OnCallSendLag.getRuleDeliveryDueAt({
        scheduledAt: SCHEDULED_AT,
        rulesCheckedAt: minutesAfter(LOG_CREATED_AT, 9),
        now: NOW,
      }),
    ).toEqual(SCHEDULED_AT);
  });

  test("a tick after it was scheduled that did not send it - a rule added, a severity changed since - is when it came due", () => {
    const checkedAt: Date = minutesAfter(LOG_CREATED_AT, 29);

    expect(
      OnCallSendLag.getRuleDeliveryDueAt({
        scheduledAt: SCHEDULED_AT,
        rulesCheckedAt: checkedAt,
        now: NOW,
      }),
    ).toEqual(checkedAt);
  });

  test("a tick at this very moment: due now, no lag", () => {
    expect(
      OnCallSendLag.getRuleDeliveryDueAt({
        scheduledAt: SCHEDULED_AT,
        rulesCheckedAt: NOW,
        now: NOW,
      }),
    ).toEqual(NOW);
  });

  test("a tick after now - two servers' clocks apart - is not believed", () => {
    expect(
      OnCallSendLag.getRuleDeliveryDueAt({
        scheduledAt: SCHEDULED_AT,
        rulesCheckedAt: minutesAfter(NOW, 1),
        now: NOW,
      }),
    ).toEqual(SCHEDULED_AT);
  });

  test("never later than now", () => {
    expect(
      OnCallSendLag.getRuleDeliveryDueAt({
        scheduledAt: minutesAfter(NOW, 5),
        now: NOW,
      }),
    ).toEqual(NOW);
  });

  test("a schedule that is no moment: due now", () => {
    expect(
      OnCallSendLag.getRuleDeliveryDueAt({
        scheduledAt: new Date(NaN),
        rulesCheckedAt: minutesAfter(LOG_CREATED_AT, 20),
        now: NOW,
      }),
    ).toEqual(NOW);
  });

  test("a tick that is no moment is no tick", () => {
    expect(
      OnCallSendLag.getRuleDeliveryDueAt({
        scheduledAt: SCHEDULED_AT,
        rulesCheckedAt: new Date(NaN),
        now: NOW,
      }),
    ).toEqual(SCHEDULED_AT);
  });

  test("a Date of its own: changing it changes nothing it was made from", () => {
    const scheduledAt: Date = new Date(SCHEDULED_AT.getTime());
    const dueAt: Date = OnCallSendLag.getRuleDeliveryDueAt({
      scheduledAt: scheduledAt,
      now: NOW,
    });

    dueAt.setTime(0);

    expect(scheduledAt).toEqual(SCHEDULED_AT);
  });
});

describe("when the rules' worker last went through a log's rules", () => {
  const CHECKED_AT: Date = new Date("2026-11-10T09:21:00.250Z");
  const KEY: string = `${OnCallSendLag.RULES_CHECKED_CACHE_NAMESPACE}-${LOG_ID.toString()}`;

  test("is kept for an hour, and read back to the millisecond", async () => {
    await OnCallSendLag.rememberRulesCheckedAt({
      userOnCallLogId: LOG_ID,
      checkedAt: CHECKED_AT,
    });

    expect(cache.get(KEY)).toEqual({
      value: String(CHECKED_AT.getTime()),
      expiresInSeconds: 60 * 60,
    });
    expect(await OnCallSendLag.readRulesCheckedAt(LOG_ID)).toEqual(CHECKED_AT);

    // Read, not taken: every tick reads it.
    expect(await OnCallSendLag.readRulesCheckedAt(LOG_ID)).toEqual(CHECKED_AT);
  });

  test("a later tick replaces it", async () => {
    await OnCallSendLag.rememberRulesCheckedAt({
      userOnCallLogId: LOG_ID,
      checkedAt: CHECKED_AT,
    });
    await OnCallSendLag.rememberRulesCheckedAt({
      userOnCallLogId: LOG_ID,
      checkedAt: minutesAfter(CHECKED_AT, 1),
    });

    expect(await OnCallSendLag.readRulesCheckedAt(LOG_ID)).toEqual(
      minutesAfter(CHECKED_AT, 1),
    );
  });

  test("never kept: none", async () => {
    expect(await OnCallSendLag.readRulesCheckedAt(LOG_ID)).toBeNull();
  });

  test("no log, or a tick that is no moment: nothing kept, nothing read", async () => {
    await OnCallSendLag.rememberRulesCheckedAt({
      userOnCallLogId: undefined,
      checkedAt: CHECKED_AT,
    });
    await OnCallSendLag.rememberRulesCheckedAt({
      userOnCallLogId: LOG_ID,
      checkedAt: new Date(NaN),
    });

    expect(setString).not.toHaveBeenCalled();
    expect(await OnCallSendLag.readRulesCheckedAt(null)).toBeNull();
    expect(getString).not.toHaveBeenCalled();
  });

  test("without a metrics exporter nothing is kept, and nothing is read", async () => {
    metricsEnabled.mockReturnValue(false);

    await OnCallSendLag.rememberRulesCheckedAt({
      userOnCallLogId: LOG_ID,
      checkedAt: CHECKED_AT,
    });

    expect(setString).not.toHaveBeenCalled();
    expect(await OnCallSendLag.readRulesCheckedAt(LOG_ID)).toBeNull();
    expect(getString).not.toHaveBeenCalled();
  });

  test.each([
    ["text", "soon"],
    ["a negative number", "-5"],
    ["a part number", "1.5"],
    ["JSON", '{"checkedAt":1}'],
    ["a number past any moment", "9".repeat(30)],
  ])(
    "a kept value that is %s reads back as none",
    async (_what: string, value: string) => {
      cache.set(KEY, { value: value, expiresInSeconds: 1 });

      expect(await OnCallSendLag.readRulesCheckedAt(LOG_ID)).toBeNull();
    },
  );

  test("Redis that cannot be reached: nothing kept, none read, nothing thrown", async () => {
    setString.mockRejectedValue(new Error("Cache is not connected"));
    getString.mockRejectedValue(new Error("Cache is not connected"));

    await expect(
      OnCallSendLag.rememberRulesCheckedAt({
        userOnCallLogId: LOG_ID,
        checkedAt: CHECKED_AT,
      }),
    ).resolves.toBeUndefined();
    await expect(OnCallSendLag.readRulesCheckedAt(LOG_ID)).resolves.toBeNull();
  });
});

describe("one tick of the rules' worker through a log (OnCallRulesTick)", () => {
  // The tick runs 47 minutes into the log.
  const NOW: Date = minutesAfter(LOG_CREATED_AT, 47);

  function tickOf(
    executedClaimKeys: Array<string> = [],
    settings: { logCreatedAt?: Date | string | null } = {},
  ): OnCallRulesTick {
    return new OnCallRulesTick({
      userOnCallLogId: LOG_ID,
      logCreatedAt:
        settings.logCreatedAt === undefined
          ? LOG_CREATED_AT
          : settings.logCreatedAt,
      executedClaimKeys: executedClaimKeys,
      checkedAt: NOW,
    });
  }

  function delivery(
    executionNumber: number,
    settings: {
      notifyAfterMinutes?: number;
      repeatEveryMinutes?: unknown;
    } = {},
  ): OnCallRuleDelivery {
    return {
      ruleId: RULE_ID,
      notifyAfterMinutes:
        settings.notifyAfterMinutes === undefined
          ? 10
          : settings.notifyAfterMinutes,
      repeatEveryMinutes:
        settings.repeatEveryMinutes === undefined
          ? 5
          : settings.repeatEveryMinutes,
      executionNumber: executionNumber,
    };
  }

  test("a rule's first push: due its delay after the log started, after the rule's wait", async () => {
    expect(await tickOf().getScheduledSend(delivery(0))).toEqual({
      dueAt: minutesAfter(LOG_CREATED_AT, 10),
      schedule: NotificationSchedule.RuleWait,
    });
  });

  test("a rule that waits for nothing: due as the log started", async () => {
    expect(
      await tickOf().getScheduledSend(delivery(0, { notifyAfterMinutes: 0 })),
    ).toEqual({
      dueAt: LOG_CREATED_AT,
      schedule: NotificationSchedule.RuleWait,
    });
  });

  test("a repeat right after the last one sent: due its own interval later, after a repeat", async () => {
    expect(
      await tickOf([
        RULE_ID,
        getRepeatClaimKey(RULE_ID, 1),
        getRepeatClaimKey(RULE_ID, 2),
      ]).getScheduledSend(delivery(3)),
    ).toEqual({
      dueAt: minutesAfter(LOG_CREATED_AT, 10 + 3 * 5),
      schedule: NotificationSchedule.Repeat,
    });
  });

  test("a repeat a worker that fell behind sends in place of those it skipped: due when the first it skipped was", async () => {
    // Repeats 1 and 2 went out; 3 to 6 came due while it was down; 7 is sent.
    expect(
      await tickOf([
        RULE_ID,
        getRepeatClaimKey(RULE_ID, 1),
        getRepeatClaimKey(RULE_ID, 2),
      ]).getScheduledSend(delivery(7)),
    ).toEqual({
      dueAt: minutesAfter(LOG_CREATED_AT, 10 + 3 * 5),
      schedule: NotificationSchedule.Repeat,
    });
  });

  test("a delivery the worker found not due at its last tick, and due now, came due in between: due at that tick", async () => {
    const checkedAt: Date = minutesAfter(LOG_CREATED_AT, 46);

    await OnCallSendLag.rememberRulesCheckedAt({
      userOnCallLogId: LOG_ID,
      checkedAt: checkedAt,
    });

    // A rule added since: by its schedule due long ago, sent now.
    expect(await tickOf().getScheduledSend(delivery(0))).toEqual({
      dueAt: checkedAt,
      schedule: NotificationSchedule.RuleWait,
    });
  });

  test("never due later than the tick's now", async () => {
    expect(
      await tickOf().getScheduledSend(delivery(0, { notifyAfterMinutes: 90 })),
    ).toEqual({
      dueAt: NOW,
      schedule: NotificationSchedule.RuleWait,
    });
  });

  test("a log started at a moment read as text counts", async () => {
    expect(
      await tickOf([], {
        logCreatedAt: "2026-11-10T09:00:00.000Z",
      }).getScheduledSend(delivery(0)),
    ).toEqual({
      dueAt: minutesAfter(LOG_CREATED_AT, 10),
      schedule: NotificationSchedule.RuleWait,
    });
  });

  test.each([
    ["no start", null],
    ["a start that is no moment", "soon"],
  ])(
    "a log with %s: nothing to time from",
    async (_what: string, logCreatedAt: string | null) => {
      expect(
        await tickOf([], { logCreatedAt: logCreatedAt }).getScheduledSend(
          delivery(0),
        ),
      ).toBeNull();
    },
  );

  test("the worker's last tick is read once for the whole tick, and only once a delivery is sent", async () => {
    const tick: OnCallRulesTick = tickOf([RULE_ID]);

    expect(getString).not.toHaveBeenCalled();

    await tick.getScheduledSend(delivery(1));
    await tick.getScheduledSend(delivery(2));
    await tick.getScheduledSend({ ...delivery(0), ruleId: "another-rule" });

    expect(getString).toHaveBeenCalledTimes(1);
  });

  test("without a metrics exporter: nothing told, nothing read, nothing kept", async () => {
    metricsEnabled.mockReturnValue(false);

    const tick: OnCallRulesTick = tickOf();
    let seen: OnCallScheduledSend | null | undefined = undefined;

    expect(await tick.getScheduledSend(delivery(0))).toBeNull();

    await tick.runSend(delivery(0), async (): Promise<void> => {
      seen = OnCallSendLag.getScheduledSend();
    });
    await tick.finish();

    expect(seen).toBeNull();
    expect(getString).not.toHaveBeenCalled();
    expect(setString).not.toHaveBeenCalled();
  });

  test("runSend sends inside the scheduled send the delivery is, and answers as the send does", async () => {
    const error: Error = new Error("Twilio is down");
    let seen: OnCallScheduledSend | null = null;

    const value: string = await tickOf([
      RULE_ID,
      getRepeatClaimKey(RULE_ID, 1),
    ]).runSend(delivery(2), async (): Promise<string> => {
      await nextTick();
      seen = OnCallSendLag.getScheduledSend();
      return "sent";
    });

    expect(value).toBe("sent");
    expect(seen).toEqual({
      dueAt: minutesAfter(LOG_CREATED_AT, 10 + 2 * 5),
      schedule: NotificationSchedule.Repeat,
    });
    expect(OnCallSendLag.getScheduledSend()).toBeNull();

    await expect(
      tickOf().runSend(delivery(0), async (): Promise<void> => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  test("runSend sends even when nothing can say when the delivery was due", async () => {
    let sent: boolean = false;

    await tickOf([], { logCreatedAt: null }).runSend(
      delivery(0),
      async (): Promise<void> => {
        sent = true;
      },
    );

    expect(sent).toBe(true);
  });

  test("a delivery whose due moment cannot be worked out is sent untimed, never lost", async () => {
    const tick: OnCallRulesTick = new OnCallRulesTick({
      userOnCallLogId: LOG_ID,
      logCreatedAt: LOG_CREATED_AT,
      executedClaimKeys: {
        includes: (): boolean => {
          throw new Error("not a list");
        },
      } as unknown as Array<string>,
      checkedAt: NOW,
    });
    let sent: boolean = false;

    expect(await tick.getScheduledSend(delivery(3))).toBeNull();

    await tick.runSend(delivery(3), async (): Promise<void> => {
      sent = true;
    });

    expect(sent).toBe(true);
  });

  test("finish keeps the tick's moment for the next tick", async () => {
    await tickOf().finish();

    expect(await OnCallSendLag.readRulesCheckedAt(LOG_ID)).toEqual(NOW);
  });

  test("the next tick reads what this one kept: a rule added between them is timed from this tick", async () => {
    // Tick at minute 47 goes through the rules and finds nothing due.
    await tickOf().finish();

    // A rule that waits 5 minutes is added; the tick at minute 48 sends it.
    const next: OnCallRulesTick = new OnCallRulesTick({
      userOnCallLogId: LOG_ID,
      logCreatedAt: LOG_CREATED_AT,
      executedClaimKeys: [],
      checkedAt: minutesAfter(NOW, 1),
    });

    expect(
      await next.getScheduledSend(delivery(0, { notifyAfterMinutes: 5 })),
    ).toEqual({
      dueAt: NOW,
      schedule: NotificationSchedule.RuleWait,
    });
  });
});
