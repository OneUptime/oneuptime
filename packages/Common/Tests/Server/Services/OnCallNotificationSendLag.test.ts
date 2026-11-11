import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * HOW LATE AN ON-CALL NOTIFICATION SENT LATER WENT OUT, END TO END THROUGH
 * ITS NOTIFICATION'S HOOKS (notification.send.lag, issue #6646).
 *
 * The real UserOnCallLogTimelineService hooks, with the database, Redis and
 * the metrics SDK held in memory. A notification a worker writes once a
 * wait of the on-call configuration ran out - inside a scheduled send
 * (OnCallSendLag) - keeps when it was due as it is written, on the
 * worker's server; when another server writes that it was sent, the time
 * from when it was due is recorded, once, by the notification's channel,
 * the wait it was due after and its record's type. A notification written
 * as its page starts is timed from its page's start alone.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const timeToSendCalls: Array<RecordedCall> = [];
const sendLagCalls: Array<RecordedCall> = [];

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  const into: (
    calls: Array<RecordedCall>,
  ) => (value: number, attributes: Record<string, string>) => void = (
    calls: Array<RecordedCall>,
  ) => {
    return (value: number, attributes: Record<string, string>): void => {
      calls.push({ value, attributes });
    };
  };

  return {
    __esModule: true,
    default: {
      getNotificationTimeToSend: () => {
        return { record: into(timeToSendCalls) };
      },
      getNotificationSendLag: () => {
        return { record: into(sendLagCalls) };
      },
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
      getNotificationTriggerCounter: () => {
        return { add: jest.fn() };
      },
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  };
});

import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import OnCallPageTiming from "../../../Server/Utils/OnCall/OnCallPageTiming";
import OnCallSendLag, {
  OnCallRulesTick,
  OnCallScheduledSend,
} from "../../../Server/Utils/OnCall/OnCallSendLag";
import NotificationDeliveryMetrics, {
  NotificationSchedule,
  OnCallPageStart,
} from "../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import Telemetry from "../../../Server/Utils/Telemetry";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OneUptimeDate from "../../../Types/Date";
import { getRepeatClaimKey } from "../../../Types/NotificationRule/NotificationRepeat";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_PAGE_CHANNELS,
  OnCallPageChannel,
  OnCallPageChannelInfo,
  OnCallPageNotificationMethods,
} from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";

type AnyFunction = (...args: Array<unknown>) => Promise<unknown>;

const MINUTE_IN_MS: number = 60 * 1000;

const PROJECT: ObjectID = new ObjectID("6646bbbb-0000-4000-8000-000000000001");
const INCIDENT: ObjectID = new ObjectID("6646bbbb-0000-4000-8000-000000000002");
const CUSTOM_CHANNEL: ObjectID = new ObjectID(
  "6646bbbb-0000-4000-8000-000000000003",
);
const LOG: ObjectID = new ObjectID("6646bbbb-0000-4000-8000-000000000004");
const RULE_ID: string = "6646bbbb-0000-4000-8000-000000000005";

// The person's on-call log started at 09:30; their rule waits 10 minutes.
const LOG_CREATED_AT: Date = new Date("2026-11-10T09:30:00.000Z");
const DUE_AT: Date = new Date(LOG_CREATED_AT.getTime() + 10 * MINUTE_IN_MS);

const RULE_WAIT: OnCallScheduledSend = {
  dueAt: DUE_AT,
  schedule: NotificationSchedule.RuleWait,
};

let cache: Map<string, string>;
let deliveries: Array<UserOnCallLogTimeline>;
let now: Date;
let setString: jest.SpiedFunction<typeof GlobalCache.setString>;
let getAndDeleteString: jest.SpiedFunction<
  typeof GlobalCache.getAndDeleteString
>;
let customChannelRead: jest.SpiedFunction<
  typeof CustomNotificationChannelService.findOneById
>;
let metricsEnabled: jest.SpiedFunction<typeof Telemetry.isMetricsEnabled>;

beforeEach(() => {
  timeToSendCalls.length = 0;
  sendLagCalls.length = 0;
  cache = new Map();
  deliveries = [];
  // The provider accepted it 41 seconds after it was due.
  now = new Date(DUE_AT.getTime() + 41_000);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return now;
  });

  metricsEnabled = jest
    .spyOn(Telemetry, "isMetricsEnabled")
    .mockReturnValue(true);

  setString = jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string): Promise<void> => {
        cache.set(`${namespace}-${key}`, value);
      },
    );

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        return cache.get(`${namespace}-${key}`) || null;
      },
    );

  getAndDeleteString = jest
    .spyOn(GlobalCache, "getAndDeleteString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        const value: string | undefined = cache.get(`${namespace}-${key}`);
        cache.delete(`${namespace}-${key}`);
        return value || null;
      },
    );

  jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
    return undefined;
  });

  // The rows an update wrote, read back by id, as they are now.
  jest
    .spyOn(UserOnCallLogTimelineService, "findBy")
    .mockImplementation((async () => {
      return deliveries;
    }) as never);

  customChannelRead = jest
    .spyOn(CustomNotificationChannelService, "findOneById")
    .mockImplementation((async () => {
      const channel: CustomNotificationChannel =
        new CustomNotificationChannel();
      channel.name = "CorpoApp";
      return channel;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function hook(name: string): AnyFunction {
  return (
    UserOnCallLogTimelineService as unknown as Record<string, AnyFunction>
  )[name]!.bind(UserOnCallLogTimelineService) as AnyFunction;
}

// One notification, by one channel, about the incident.
function notificationBy(
  field: keyof OnCallPageNotificationMethods,
  // Columns written over the row's, an unset one as undefined.
  overrides: Record<string, unknown> = {},
): UserOnCallLogTimeline {
  const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  row.id = ObjectID.generate();
  row.projectId = PROJECT;
  row.status = UserNotificationStatus.Sending;
  row.triggeredByIncidentId = INCIDENT;
  (row as unknown as Record<string, unknown>)[field] =
    field === "customNotificationChannelId"
      ? CUSTOM_CHANNEL
      : ObjectID.generate();
  Object.assign(row, overrides);

  return row;
}

async function written(row: UserOnCallLogTimeline): Promise<void> {
  await hook("onCreateSuccess")(
    { createBy: { data: row, props: { isRoot: true } }, carryForward: null },
    row,
  );
}

// Written by a worker sending what a wait made due: inside its scheduled send.
async function writtenByWorker(
  row: UserOnCallLogTimeline,
  send: OnCallScheduledSend = RULE_WAIT,
): Promise<void> {
  await OnCallSendLag.runAsScheduledSend(send, async (): Promise<void> => {
    await written(row);
  });
}

// Another server writes the notification's status - outside the send.
async function writtenAs(
  row: UserOnCallLogTimeline,
  status: UserNotificationStatus,
): Promise<void> {
  row.status = status;

  if (!deliveries.includes(row)) {
    deliveries.push(row);
  }

  await hook("onUpdateSuccess")(
    {
      updateBy: {
        query: { _id: row.id!.toString() },
        data: { status: status },
        props: { isRoot: true },
      },
      carryForward: null,
    },
    [row.id],
  );
}

describe("a notification a worker sent once a wait ran out", () => {
  test("sent on another server: the time from when it was due is recorded, by its channel, its wait and its record's type", async () => {
    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await writtenByWorker(sms);

    // The due moment is kept before the notification is handed over.
    expect(setString).toHaveBeenCalledTimes(1);

    await writtenAs(sms, UserNotificationStatus.Sent);

    expect(sendLagCalls).toEqual([
      {
        value: 41_000,
        attributes: {
          "notification.channel": "sms",
          "notification.schedule": "rule_wait",
          "notification.trigger.type": "incident",
        },
      },
    ]);

    // Not a page's time to send: it waited because it was told to.
    expect(timeToSendCalls).toEqual([]);
  });

  test.each(Object.values(NotificationSchedule))(
    "due after a wait of the kind %s: says so",
    async (schedule: NotificationSchedule) => {
      const push: UserOnCallLogTimeline = notificationBy("userPushId");

      await writtenByWorker(push, { dueAt: DUE_AT, schedule: schedule });
      await writtenAs(push, UserNotificationStatus.Sent);

      expect(sendLagCalls).toHaveLength(1);
      expect(sendLagCalls[0]!.attributes["notification.schedule"]).toBe(
        schedule,
      );
      expect(sendLagCalls[0]!.value).toBe(41_000);
    },
  );

  test("written as sent twice: recorded once", async () => {
    const call: UserOnCallLogTimeline = notificationBy("userCallId");

    await writtenByWorker(call);
    await writtenAs(call, UserNotificationStatus.Sent);

    now = new Date(DUE_AT.getTime() + 5 * MINUTE_IN_MS);
    await writtenAs(call, UserNotificationStatus.Sent);

    expect(sendLagCalls).toHaveLength(1);
    expect(sendLagCalls[0]!.value).toBe(41_000);
  });

  test("a worker that fell 7 minutes behind shows: the lag runs to the provider accepting it", async () => {
    const email: UserOnCallLogTimeline = notificationBy("userEmailId");

    await writtenByWorker(email);

    now = new Date(DUE_AT.getTime() + 7 * MINUTE_IN_MS + 2_500);
    await writtenAs(email, UserNotificationStatus.Sent);

    expect(sendLagCalls[0]!.value).toBe(7 * MINUTE_IN_MS + 2_500);
  });

  test("accepted before it was due - two servers' clocks apart - is recorded as no lag", async () => {
    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await writtenByWorker(sms);

    now = new Date(DUE_AT.getTime() - 800);
    await writtenAs(sms, UserNotificationStatus.Sent);

    expect(sendLagCalls[0]!.value).toBe(0);
  });

  test("one that could not be sent is not timed", async () => {
    const whatsApp: UserOnCallLogTimeline = notificationBy("userWhatsAppId");

    await writtenByWorker(whatsApp);
    await writtenAs(whatsApp, UserNotificationStatus.Error);

    expect(sendLagCalls).toEqual([]);
  });

  test("one written as not sent - a number that is not verified - keeps nothing", async () => {
    const sms: UserOnCallLogTimeline = notificationBy("userSmsId", {
      status: UserNotificationStatus.Error,
    });

    await writtenByWorker(sms);

    expect(setString).not.toHaveBeenCalled();
  });

  test("a custom channel's is told apart by the channel's id and name, read once", async () => {
    const custom: UserOnCallLogTimeline = notificationBy(
      "customNotificationChannelId",
    );

    await writtenByWorker(custom, {
      dueAt: DUE_AT,
      schedule: NotificationSchedule.Escalation,
    });
    await writtenAs(custom, UserNotificationStatus.Sent);

    expect(customChannelRead).toHaveBeenCalledTimes(1);
    expect(sendLagCalls[0]!.attributes).toEqual({
      "notification.channel": "custom_channel",
      "notification.schedule": "escalation",
      "notification.trigger.type": "incident",
      "notification.custom_channel.id": CUSTOM_CHANNEL.toString(),
      "notification.custom_channel.name": "CorpoApp",
    });
  });

  test("a custom channel whose name cannot be read is timed by its id alone", async () => {
    customChannelRead.mockRejectedValue(new Error("connection reset"));

    const custom: UserOnCallLogTimeline = notificationBy(
      "customNotificationChannelId",
    );

    await writtenByWorker(custom);
    await writtenAs(custom, UserNotificationStatus.Sent);

    expect(sendLagCalls[0]!.attributes).toEqual({
      "notification.channel": "custom_channel",
      "notification.schedule": "rule_wait",
      "notification.trigger.type": "incident",
      "notification.custom_channel.id": CUSTOM_CHANNEL.toString(),
    });
  });

  test("one that names two channels - a rule written through the API - is not timed", async () => {
    const both: UserOnCallLogTimeline = notificationBy("userSmsId");
    both.userCallId = ObjectID.generate();

    await writtenByWorker(both);
    await writtenAs(both, UserNotificationStatus.Sent);

    expect(sendLagCalls).toEqual([]);
  });

  test.each(
    ON_CALL_PAGE_CHANNELS.map((info: OnCallPageChannelInfo) => {
      return [info.channel, info.field];
    }),
  )(
    "one sent by %s is timed under its channel",
    async (channel: unknown, field: unknown) => {
      const row: UserOnCallLogTimeline = notificationBy(
        field as keyof OnCallPageNotificationMethods,
      );

      await writtenByWorker(row);
      await writtenAs(row, UserNotificationStatus.Sent);

      expect(sendLagCalls).toHaveLength(1);
      expect(sendLagCalls[0]!.attributes["notification.channel"]).toBe(
        NotificationDeliveryMetrics.getChannelOfOnCallPage(
          channel as OnCallPageChannel,
        ),
      );
    },
  );

  test.each([
    [
      "alert",
      { triggeredByIncidentId: undefined, triggeredByAlertId: INCIDENT },
    ],
    [
      "incident_episode",
      {
        triggeredByIncidentId: undefined,
        triggeredByIncidentEpisodeId: INCIDENT,
      },
    ],
    [
      "alert_episode",
      { triggeredByIncidentId: undefined, triggeredByAlertEpisodeId: INCIDENT },
    ],
  ])(
    "one about an %s says so",
    async (type: string, overrides: Record<string, unknown>) => {
      const row: UserOnCallLogTimeline = notificationBy("userSmsId", overrides);

      await writtenByWorker(row);
      await writtenAs(row, UserNotificationStatus.Sent);

      expect(sendLagCalls[0]!.attributes["notification.trigger.type"]).toBe(
        type,
      );
    },
  );
});

describe("a page's start and a scheduled send, told apart", () => {
  test("written as its page starts inside a worker's send - a level moved on to at once: its page's start alone times it", async () => {
    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");
    const pageStartedAt: Date = new Date(DUE_AT.getTime() - 30_000);

    await OnCallSendLag.runAsScheduledSend(
      RULE_WAIT,
      async (): Promise<void> => {
        await OnCallPageTiming.runInPageStart(
          { startedAt: pageStartedAt, start: OnCallPageStart.PageStarted },
          async (): Promise<void> => {
            await written(sms);
          },
        );
      },
    );

    // One moment kept: the page's start.
    expect(setString).toHaveBeenCalledTimes(1);
    expect(setString.mock.calls[0]![0]).toBe(OnCallPageTiming.CACHE_NAMESPACE);

    await writtenAs(sms, UserNotificationStatus.Sent);

    expect(timeToSendCalls).toHaveLength(1);
    expect(timeToSendCalls[0]!.value).toBe(71_000);
    expect(sendLagCalls).toEqual([]);
  });

  test("a page's start kept for it is taken first, and no due moment is looked for", async () => {
    const call: UserOnCallLogTimeline = notificationBy("userCallId");

    await OnCallPageTiming.runInPageStart(
      { startedAt: DUE_AT, start: OnCallPageStart.RecordCreated },
      async (): Promise<void> => {
        await written(call);
      },
    );
    await writtenAs(call, UserNotificationStatus.Sent);

    expect(
      getAndDeleteString.mock.calls.map((args: Array<unknown>) => {
        return args[0];
      }),
    ).toEqual([OnCallPageTiming.CACHE_NAMESPACE]);
  });

  test("written by neither - outside any send or page's start - is not timed at all", async () => {
    const call: UserOnCallLogTimeline = notificationBy("userCallId");

    await written(call);

    expect(setString).not.toHaveBeenCalled();

    await writtenAs(call, UserNotificationStatus.Sent);

    expect(timeToSendCalls).toEqual([]);
    expect(sendLagCalls).toEqual([]);
  });
});

describe("from the rules' worker to the metric", () => {
  test("a repeat a worker that fell behind sends in place of those it skipped: late from the first it skipped", async () => {
    // Every 5 minutes after 10; repeats 1 and 2 went out, 3 to 6 were skipped.
    const tick: OnCallRulesTick = new OnCallRulesTick({
      userOnCallLogId: LOG,
      logCreatedAt: LOG_CREATED_AT,
      executedClaimKeys: [
        RULE_ID,
        getRepeatClaimKey(RULE_ID, 1),
        getRepeatClaimKey(RULE_ID, 2),
      ],
      checkedAt: new Date(LOG_CREATED_AT.getTime() + 47 * MINUTE_IN_MS),
    });
    const push: UserOnCallLogTimeline = notificationBy("userPushId");

    await tick.runSend(
      {
        ruleId: RULE_ID,
        notifyAfterMinutes: 10,
        repeatEveryMinutes: 5,
        executionNumber: 7,
      },
      async (): Promise<void> => {
        await written(push);
      },
    );

    now = new Date(LOG_CREATED_AT.getTime() + 47 * MINUTE_IN_MS + 3_000);
    await writtenAs(push, UserNotificationStatus.Sent);

    // Repeat 3 was due at minute 25: 22 minutes and 3 seconds late.
    expect(sendLagCalls).toEqual([
      {
        value: 22 * MINUTE_IN_MS + 3_000,
        attributes: {
          "notification.channel": "push",
          "notification.schedule": "repeat",
          "notification.trigger.type": "incident",
        },
      },
    ]);
  });

  test("a rule's first push the worker sends on time: the tick and the provider, no more", async () => {
    const tick: OnCallRulesTick = new OnCallRulesTick({
      userOnCallLogId: LOG,
      logCreatedAt: LOG_CREATED_AT,
      executedClaimKeys: [],
      checkedAt: new Date(DUE_AT.getTime() + 20_000),
    });
    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await tick.runSend(
      {
        ruleId: RULE_ID,
        notifyAfterMinutes: 10,
        repeatEveryMinutes: 0,
        executionNumber: 0,
      },
      async (): Promise<void> => {
        await written(sms);
      },
    );

    now = new Date(DUE_AT.getTime() + 21_200);
    await writtenAs(sms, UserNotificationStatus.Sent);

    expect(sendLagCalls).toHaveLength(1);
    expect(sendLagCalls[0]!.value).toBe(21_200);
    expect(sendLagCalls[0]!.attributes["notification.schedule"]).toBe(
      "rule_wait",
    );
  });
});

describe("timing costs nothing where nobody reads it, and never fails a notification", () => {
  test("without a metrics exporter, nothing is kept or recorded", async () => {
    metricsEnabled.mockReturnValue(false);

    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await writtenByWorker(sms);
    await writtenAs(sms, UserNotificationStatus.Sent);

    expect(setString).not.toHaveBeenCalled();
    expect(getAndDeleteString).not.toHaveBeenCalled();
    expect(sendLagCalls).toEqual([]);
  });

  test("Redis that cannot be reached loses the time, not the notification", async () => {
    setString.mockRejectedValue(new Error("Cache is not connected"));
    getAndDeleteString.mockRejectedValue(new Error("Cache is not connected"));

    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await expect(writtenByWorker(sms)).resolves.toBeUndefined();
    await expect(
      writtenAs(sms, UserNotificationStatus.Sent),
    ).resolves.toBeUndefined();

    expect(sendLagCalls).toEqual([]);
  });

  test("a kept due moment that is not one records nothing, and the update goes on", async () => {
    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await writtenByWorker(sms);

    cache.set(
      `${OnCallSendLag.CACHE_NAMESPACE}-${sms.id!.toString()}`,
      "{not json",
    );

    await expect(
      writtenAs(sms, UserNotificationStatus.Sent),
    ).resolves.toBeUndefined();

    expect(sendLagCalls).toEqual([]);
  });
});
