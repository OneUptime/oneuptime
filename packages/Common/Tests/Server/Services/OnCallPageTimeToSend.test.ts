import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AN ON-CALL PAGE'S TIME TO SEND, END TO END THROUGH ITS NOTIFICATION'S
 * HOOKS (notification.time_to_send, issue #6600).
 *
 * The real UserOnCallLogTimelineService hooks, with the database, Redis and
 * the metrics SDK held in memory. A notification written as its page starts
 * (OnCallPageTiming) keeps its page's start when it is written - on the
 * server that pages - and when another server writes that it was sent, the
 * time from the page's trigger is recorded, once, by the notification's
 * channel. Nothing is recorded for a notification its page's rules sent
 * later, one that failed, or one that names two channels.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const timeToSendCalls: Array<RecordedCall> = [];

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  const capture: (value: number, attributes: Record<string, string>) => void = (
    value: number,
    attributes: Record<string, string>,
  ): void => {
    timeToSendCalls.push({ value, attributes });
  };

  return {
    __esModule: true,
    default: {
      getNotificationTimeToSend: () => {
        return { record: capture };
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
import OnCallPageTiming, {
  OnCallPageStartMoment,
} from "../../../Server/Utils/OnCall/OnCallPageTiming";
import NotificationDeliveryMetrics, {
  OnCallPageStart,
} from "../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import Telemetry from "../../../Server/Utils/Telemetry";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_PAGE_CHANNELS,
  OnCallPageChannel,
  OnCallPageChannelInfo,
  OnCallPageNotificationMethods,
} from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";

type AnyFunction = (...args: Array<unknown>) => Promise<unknown>;

const PROJECT: ObjectID = new ObjectID("6600bbbb-0000-4000-8000-000000000001");
const INCIDENT: ObjectID = new ObjectID("6600bbbb-0000-4000-8000-000000000002");
const CUSTOM_CHANNEL: ObjectID = new ObjectID(
  "6600bbbb-0000-4000-8000-000000000003",
);

// The incident was created - the monitor fired - at 09:30:00.
const TRIGGERED_AT: Date = new Date("2026-11-10T09:30:00.000Z");

let cache: Map<string, string>;
let deliveries: Array<UserOnCallLogTimeline>;
let now: Date;
let setString: jest.SpiedFunction<typeof GlobalCache.setString>;
let customChannelRead: jest.SpiedFunction<
  typeof CustomNotificationChannelService.findOneById
>;
let metricsEnabled: jest.SpiedFunction<typeof Telemetry.isMetricsEnabled>;

beforeEach(() => {
  timeToSendCalls.length = 0;
  cache = new Map();
  deliveries = [];
  now = new Date(TRIGGERED_AT.getTime() + 12_400);

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

// One notification of a page, by one channel, about the incident.
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

// Written as its page starts: inside the page's start.
async function writtenAsPageStarts(
  row: UserOnCallLogTimeline,
  moment: OnCallPageStartMoment = {
    startedAt: TRIGGERED_AT,
    start: OnCallPageStart.RecordCreated,
  },
): Promise<void> {
  await OnCallPageTiming.runInPageStart(moment, async (): Promise<void> => {
    await written(row);
  });
}

// Another server writes the notification's status - outside the page's start.
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

describe("a notification due as its page starts", () => {
  test("sent on another server: the time from its trigger is recorded, by its channel and its record's type", async () => {
    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await writtenAsPageStarts(sms);

    // The page's start is kept before the notification is handed over.
    expect(setString).toHaveBeenCalledTimes(1);

    await writtenAs(sms, UserNotificationStatus.Sent);

    expect(timeToSendCalls).toEqual([
      {
        value: 12_400,
        attributes: {
          "notification.channel": "sms",
          "notification.page.start": "record_created",
          "notification.trigger.type": "incident",
        },
      },
    ]);
  });

  test("written as sent twice: recorded once", async () => {
    const call: UserOnCallLogTimeline = notificationBy("userCallId");

    await writtenAsPageStarts(call);
    await writtenAs(call, UserNotificationStatus.Sent);

    now = new Date(TRIGGERED_AT.getTime() + 60_000);
    await writtenAs(call, UserNotificationStatus.Sent);

    expect(timeToSendCalls).toHaveLength(1);
    expect(timeToSendCalls[0]!.value).toBe(12_400);
  });

  test("a page started later - by a person, a workflow, after a hold - is measured from when it started, and says so", async () => {
    const push: UserOnCallLogTimeline = notificationBy("userPushId");
    const startedAt: Date = new Date(TRIGGERED_AT.getTime() + 600_000);
    now = new Date(startedAt.getTime() + 1_750);

    await writtenAsPageStarts(push, {
      startedAt: startedAt,
      start: OnCallPageStart.PageStarted,
    });
    await writtenAs(push, UserNotificationStatus.Sent);

    expect(timeToSendCalls).toEqual([
      {
        value: 1_750,
        attributes: {
          "notification.channel": "push",
          "notification.page.start": "page_started",
          "notification.trigger.type": "incident",
        },
      },
    ]);
  });

  test("one that could not be sent is not timed", async () => {
    const whatsApp: UserOnCallLogTimeline = notificationBy("userWhatsAppId");

    await writtenAsPageStarts(whatsApp);
    await writtenAs(whatsApp, UserNotificationStatus.Error);

    expect(timeToSendCalls).toEqual([]);
  });

  test("one read back with another status than sent - written again meanwhile - is not timed", async () => {
    const email: UserOnCallLogTimeline = notificationBy("userEmailId");

    await writtenAsPageStarts(email);

    deliveries.push(email);
    email.status = UserNotificationStatus.Error;

    await hook("onUpdateSuccess")(
      {
        updateBy: {
          query: { _id: email.id!.toString() },
          data: { status: UserNotificationStatus.Sent },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [email.id],
    );

    expect(timeToSendCalls).toEqual([]);
  });

  test("a custom channel's is told apart by the channel's id and name", async () => {
    const custom: UserOnCallLogTimeline = notificationBy(
      "customNotificationChannelId",
    );

    await writtenAsPageStarts(custom);
    await writtenAs(custom, UserNotificationStatus.Sent);

    expect(customChannelRead).toHaveBeenCalledTimes(1);
    expect(timeToSendCalls[0]!.attributes).toEqual({
      "notification.channel": "custom_channel",
      "notification.page.start": "record_created",
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

    await writtenAsPageStarts(custom);
    await writtenAs(custom, UserNotificationStatus.Sent);

    expect(timeToSendCalls[0]!.attributes).toEqual({
      "notification.channel": "custom_channel",
      "notification.page.start": "record_created",
      "notification.trigger.type": "incident",
      "notification.custom_channel.id": CUSTOM_CHANNEL.toString(),
    });
  });

  test("the channel's name is read only for a custom channel", async () => {
    const telegram: UserOnCallLogTimeline = notificationBy("userTelegramId");

    await writtenAsPageStarts(telegram);
    await writtenAs(telegram, UserNotificationStatus.Sent);

    expect(customChannelRead).not.toHaveBeenCalled();
  });

  test("one that names two channels - a rule written through the API - is not timed", async () => {
    const both: UserOnCallLogTimeline = notificationBy("userSmsId");
    both.userCallId = ObjectID.generate();

    await writtenAsPageStarts(both);
    await writtenAs(both, UserNotificationStatus.Sent);

    expect(timeToSendCalls).toEqual([]);
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

      await writtenAsPageStarts(row);
      await writtenAs(row, UserNotificationStatus.Sent);

      expect(timeToSendCalls).toHaveLength(1);
      expect(timeToSendCalls[0]!.attributes["notification.channel"]).toBe(
        NotificationDeliveryMetrics.getChannelOfOnCallPage(
          channel as OnCallPageChannel,
        ),
      );
    },
  );

  // Each kind of record a page can be about, by the column a row names it in.
  const OTHER_RECORDS: Array<[string, Record<string, unknown>]> = [
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
  ];

  test.each(OTHER_RECORDS)(
    "a page about an %s says so",
    async (type: string, overrides: Record<string, unknown>) => {
      const row: UserOnCallLogTimeline = notificationBy("userSmsId", overrides);

      await writtenAsPageStarts(row);
      await writtenAs(row, UserNotificationStatus.Sent);

      expect(timeToSendCalls[0]!.attributes["notification.trigger.type"]).toBe(
        type,
      );
    },
  );
});

describe("a notification not due as its page starts", () => {
  test("one the person's rules send later - written by a worker, outside the page's start - is not timed", async () => {
    const call: UserOnCallLogTimeline = notificationBy("userCallId");

    await written(call);

    expect(setString).not.toHaveBeenCalled();

    await writtenAs(call, UserNotificationStatus.Sent);

    expect(timeToSendCalls).toEqual([]);
  });

  test("one written as not sent - a number that is not verified - keeps nothing", async () => {
    const sms: UserOnCallLogTimeline = notificationBy("userSmsId", {
      status: UserNotificationStatus.Error,
    });

    await writtenAsPageStarts(sms);

    expect(setString).not.toHaveBeenCalled();
  });
});

describe("timing costs nothing where nobody reads it, and never fails a page", () => {
  test("without a metrics exporter, nothing is kept or recorded", async () => {
    metricsEnabled.mockReturnValue(false);

    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await writtenAsPageStarts(sms);
    await writtenAs(sms, UserNotificationStatus.Sent);

    expect(setString).not.toHaveBeenCalled();
    expect(GlobalCache.getAndDeleteString).not.toHaveBeenCalled();
    expect(timeToSendCalls).toEqual([]);
  });

  test("Redis that cannot be reached loses the time, not the notification", async () => {
    setString.mockRejectedValue(new Error("Cache is not connected"));
    (GlobalCache.getAndDeleteString as unknown as jest.Mock).mockRejectedValue(
      new Error("Cache is not connected"),
    );

    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await expect(writtenAsPageStarts(sms)).resolves.toBeUndefined();
    await expect(
      writtenAs(sms, UserNotificationStatus.Sent),
    ).resolves.toBeUndefined();

    expect(timeToSendCalls).toEqual([]);
  });

  test("rows that cannot be read back record nothing, and the update goes on", async () => {
    (
      UserOnCallLogTimelineService.findBy as unknown as jest.Mock
    ).mockRejectedValueOnce(new Error("connection reset"));

    const sms: UserOnCallLogTimeline = notificationBy("userSmsId");

    await writtenAsPageStarts(sms);
    await expect(
      writtenAs(sms, UserNotificationStatus.Sent),
    ).resolves.toBeUndefined();

    expect(timeToSendCalls).toEqual([]);
  });
});
