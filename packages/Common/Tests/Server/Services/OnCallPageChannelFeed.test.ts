import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import URL from "../../../Types/API/URL";
import { Green500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  ON_CALL_PAGE_SENT_STATUS_MESSAGE,
  OnCallPageNotificationEvent,
} from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * HOW EACH PAGE REACHED ITS PERSON, IN THE RECORD'S FEED, FROM THE PAGE'S
 * NOTIFICATIONS (#6568).
 *
 * The run's line for a person (OnCallDutyPolicyExecutionLogTimeline) is an
 * entry in the feed of the incident or alert the run pages about; the
 * person's notifications of it - one row of their on-call timeline each
 * (UserOnCallLogTimeline) - say how it reached them. These run the real
 * services against reads and feeds held in memory: the line's entry names
 * the channels its notifications went out by, or the one its person
 * answered from; a notification that goes out after that entry, or could
 * not be sent, is an entry of its own (addNotificationToFeed), asked for
 * by the notification's own hooks.
 */

const PROJECT: ObjectID = new ObjectID("0f800000-0000-4000-8000-0000000000c1");
const POLICY: ObjectID = new ObjectID("0f800000-0000-4000-8000-0000000000c2");
const INCIDENT: ObjectID = new ObjectID("0f800000-0000-4000-8000-0000000000c3");
const ALERT: ObjectID = new ObjectID("0f800000-0000-4000-8000-0000000000c4");
const LINE: ObjectID = new ObjectID("0f800000-0000-4000-8000-0000000000c5");
const RUN: ObjectID = new ObjectID("0f800000-0000-4000-8000-0000000000c6");
const EPISODE: ObjectID = new ObjectID("0f800000-0000-4000-8000-0000000000c7");
const ANA: ObjectID = new ObjectID("0f800000-0000-4000-8000-0000000000a1");

const START: number = Date.parse("2026-11-10T09:00:00.000Z");

const POLICY_MD: string =
  "On-call policy **[Payments](https://oneuptime.test/dashboard/policies/payments)**";
const POLICY_IN_SENTENCE_MD: string =
  "on-call policy **[Payments](https://oneuptime.test/dashboard/policies/payments)**";
const RULE_MD: string = "**First line** (Level 1 of 3)";

type AnyFunction = (...args: Array<unknown>) => Promise<unknown>;

interface Entry {
  record: "incident" | "alert" | "alertEpisode" | "incidentEpisode";
  markdown: string;
  color: Color;
  eventType: string;
}

let entries: Array<Entry>;
let deliveries: Array<UserOnCallLogTimeline>;
let line: OnCallDutyPolicyExecutionLogTimeline;
let deliveryReads: Array<Record<string, unknown>>;

// Ana's line on the run: Level 1 of 3 of policy Payments, for an incident.
function lineOf(
  data: Partial<OnCallDutyPolicyExecutionLogTimeline> & {
    isDirectPage?: boolean;
  },
): OnCallDutyPolicyExecutionLogTimeline {
  const row: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  row.id = LINE;
  row.projectId = PROJECT;
  row.onCallDutyPolicyExecutionLogId = RUN;
  row.alertSentToUserId = ANA;
  row.triggeredByIncidentId = INCIDENT;

  if (!data.isDirectPage) {
    row.onCallDutyPolicyId = POLICY;
    row.onCallDutyPolicy = { id: POLICY, name: "Payments" } as never;
    row.onCallDutyPolicyEscalationRule = {
      name: "First line",
      order: 1,
    } as never;
  } else {
    row.onCallDutyPolicyExecutionLog = {
      triggeredByWorkflowName: "Page SRE",
    } as never;
  }

  const rest: Record<string, unknown> = { ...data };
  delete rest["isDirectPage"];
  Object.assign(row, rest);

  return row;
}

// One notification of Ana's page, written `minutes` after it started.
function notificationOf(data: {
  minutes: number;
  status: UserNotificationStatus;
  method: keyof UserOnCallLogTimeline;
  isAcknowledged?: boolean;
  statusMessage?: string;
}): UserOnCallLogTimeline {
  const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  row.id = ObjectID.generate();
  row.projectId = PROJECT;
  row.userId = ANA;
  row.onCallDutyPolicyExecutionLogId = RUN;
  row.onCallDutyPolicyExecutionLogTimelineId = LINE;
  row.createdAt = new Date(START + data.minutes * 60_000);
  row.status = data.status;
  (row as unknown as Record<string, unknown>)[data.method] =
    ObjectID.generate();

  if (data.isAcknowledged) {
    row.isAcknowledged = true;
    row.acknowledgedAt = new Date(START + (data.minutes + 1) * 60_000);
  }

  if (data.statusMessage) {
    row.statusMessage = data.statusMessage;
  }

  deliveries.push(row);

  return row;
}

function record(
  kind: Entry["record"],
): (data: {
  feedInfoInMarkdown: string;
  displayColor: Color;
  incidentFeedEventType?: string;
  alertFeedEventType?: string;
  alertEpisodeFeedEventType?: string;
  incidentEpisodeFeedEventType?: string;
}) => Promise<void> {
  return async (data: {
    feedInfoInMarkdown: string;
    displayColor: Color;
    incidentFeedEventType?: string;
    alertFeedEventType?: string;
    alertEpisodeFeedEventType?: string;
    incidentEpisodeFeedEventType?: string;
  }): Promise<void> => {
    entries.push({
      record: kind,
      markdown: data.feedInfoInMarkdown,
      color: data.displayColor,
      eventType: String(
        data.incidentFeedEventType ||
          data.alertFeedEventType ||
          data.alertEpisodeFeedEventType ||
          data.incidentEpisodeFeedEventType,
      ),
    });
  };
}

beforeEach(() => {
  entries = [];
  deliveries = [];
  deliveryReads = [];
  line = lineOf({});

  jest.spyOn(logger, "debug").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findOneById")
    .mockImplementation((async () => {
      return line;
    }) as never);

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.test/dashboard/policies/payments"),
    );

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleService, "countBy")
    .mockResolvedValue(new PositiveNumber(3));

  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(mdText`Ana Lopez`);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogService, "getDirectPagePager")
    .mockResolvedValue({ workflowName: "Page SRE" });

  // The page's notifications, as the database answers the step's read.
  jest.spyOn(UserOnCallLogTimelineService, "findBy").mockImplementation((async (
    data: { query: Record<string, unknown> } & Record<string, unknown>,
  ) => {
    deliveryReads.push(data);

    return deliveries.filter((row: UserOnCallLogTimeline) => {
      return (
        row.onCallDutyPolicyExecutionLogTimelineId?.toString() ===
        String(data.query["onCallDutyPolicyExecutionLogTimelineId"])
      );
    });
  }) as never);

  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(record("incident") as never);
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockImplementation(record("alert") as never);
  jest
    .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
    .mockImplementation(record("alertEpisode") as never);
  jest
    .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
    .mockImplementation(record("incidentEpisode") as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function lineEntry(): Promise<void> {
  await OnCallDutyPolicyExecutionLogTimelineService.addToIncidentOrAlertFeed({
    onCallDutyPolicyExecutionLogTimelineId: LINE,
  });
}

async function notificationEntry(
  notification: UserOnCallLogTimeline,
  event: OnCallPageNotificationEvent,
): Promise<void> {
  await OnCallDutyPolicyExecutionLogTimelineService.addNotificationToFeed({
    onCallDutyPolicyExecutionLogTimelineId: LINE,
    userOnCallLogTimelineId: notification.id!,
    event: event,
  });
}

function markdowns(): Array<string> {
  return entries.map((entry: Entry) => {
    return entry.markdown;
  });
}

describe("a page sent names the channels its notifications went out by", () => {
  beforeEach(() => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      statusMessage: ON_CALL_PAGE_SENT_STATUS_MESSAGE,
    });
  });

  test("each one that went out - sending or sent - and not the one that could not be sent", async () => {
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sent,
      method: "userSmsId",
    });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sending,
      method: "userEmailId",
    });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Error,
      method: "userTelegramId",
      statusMessage: "Telegram is not verified for +15551234567.",
    });

    await lineEntry();

    expect(markdowns()).toEqual([
      `${POLICY_MD} paged **Ana Lopez** via SMS and email at ${RULE_MD}.`,
    ]);
    expect(entries[0]!.color).toEqual(Green500);
    expect(markdowns()[0]).not.toContain("+1555");
  });

  test("reads only this page's notifications, by the run's index, as OneUptime", async () => {
    await lineEntry();

    expect(deliveryReads).toHaveLength(1);
    expect(deliveryReads[0]!["query"]).toEqual({
      projectId: PROJECT,
      onCallDutyPolicyExecutionLogId: RUN,
      onCallDutyPolicyExecutionLogTimelineId: LINE,
    });
    expect(deliveryReads[0]!["props"]).toEqual({ isRoot: true });
  });

  test("a read of the notifications that fails costs the entry its channels, never the entry", async () => {
    jest
      .spyOn(UserOnCallLogTimelineService, "findBy")
      .mockRejectedValue(new Error("connection reset"));

    await lineEntry();

    expect(markdowns()).toEqual([
      `${POLICY_MD} paged **Ana Lopez** at ${RULE_MD}.`,
    ]);
  });

  test("goes to an alert's feed for an alert's run, and to an episode's", async () => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      triggeredByIncidentId: undefined as never,
      triggeredByAlertId: ALERT,
      triggeredByAlertEpisodeId: EPISODE,
    });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sent,
      method: "userPushId",
    });

    await lineEntry();

    expect(
      entries.map((entry: Entry) => {
        return [entry.record, entry.eventType, entry.markdown];
      }),
    ).toEqual([
      [
        "alert",
        "OnCallPolicy",
        `${POLICY_MD} paged **Ana Lopez** via push notification at ${RULE_MD}.`,
      ],
      [
        "alertEpisode",
        "OnCallNotification",
        `${POLICY_MD} paged **Ana Lopez** via push notification at ${RULE_MD}.`,
      ],
    ]);
  });

  test("a direct page names them too", async () => {
    line = lineOf({
      isDirectPage: true,
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sent,
      method: "userPushId",
    });

    await lineEntry();

    expect(markdowns()).toEqual([
      "Workflow **Page SRE** paged **Ana Lopez** via push notification.",
    ]);
  });
});

describe("an answer names the notification it came from", () => {
  test("acknowledged from a phone call - and not with the person's email address", async () => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      statusMessage: "Incident acknowledged by Ana Lopez (ana@example.com)",
    });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sent,
      method: "userEmailId",
    });
    notificationOf({
      minutes: 10,
      status: UserNotificationStatus.Acknowledged,
      method: "userCallId",
      isAcknowledged: true,
    });

    await lineEntry();

    expect(markdowns()).toEqual([
      `**Ana Lopez** acknowledged the page from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD} via phone call.`,
    ]);
    expect(markdowns()[0]).not.toContain("ana@example.com");
  });

  test("acknowledged in the Dashboard or the app: no notification says so, and none is named", async () => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sent,
      method: "userSmsId",
    });

    await lineEntry();

    expect(markdowns()).toEqual([
      `**Ana Lopez** acknowledged the page from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD}.`,
    ]);
  });

  test("escalated from an SMS", async () => {
    line = lineOf({ status: OnCallDutyExecutionLogTimelineStatus.PassedOn });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.PassedOn,
      method: "userSmsId",
    });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sent,
      method: "userEmailId",
    });

    await lineEntry();

    expect(markdowns()).toEqual([
      `**Ana Lopez** escalated the page from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD} via SMS.`,
    ]);
  });
});

describe("a line that reached nobody does not read notifications", () => {
  test.each([
    OnCallDutyExecutionLogTimelineStatus.Skipped,
    OnCallDutyExecutionLogTimelineStatus.Error,
  ])("%s", async (status: OnCallDutyExecutionLogTimelineStatus) => {
    line = lineOf({ status: status });

    await lineEntry();

    expect(entries).toHaveLength(1);
    expect(deliveryReads).toHaveLength(0);
  });

  test("nor does a page sent to nobody", async () => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      alertSentToUserId: undefined as never,
    });

    await lineEntry();

    expect(deliveryReads).toHaveLength(0);
  });
});

describe("a notification after the page's own entry", () => {
  beforeEach(() => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      statusMessage: ON_CALL_PAGE_SENT_STATUS_MESSAGE,
    });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sent,
      method: "userSmsId",
    });
    notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sent,
      method: "userEmailId",
    });
  });

  test("a call ten minutes on pages them again, in green", async () => {
    const call: UserOnCallLogTimeline = notificationOf({
      minutes: 10,
      status: UserNotificationStatus.Sending,
      method: "userCallId",
    });

    await notificationEntry(call, OnCallPageNotificationEvent.SentLater);

    expect(markdowns()).toEqual([
      `${POLICY_MD} paged **Ana Lopez** again via phone call at ${RULE_MD}.`,
    ]);
    expect(entries[0]!.color).toEqual(Green500);
    expect(entries[0]!.eventType).toBe("OnCallPolicy");
  });

  test("a push repeated by a channel the feed named already is no news", async () => {
    const sms: UserOnCallLogTimeline = notificationOf({
      minutes: 5,
      status: UserNotificationStatus.Sending,
      method: "userSmsId",
    });

    await notificationEntry(sms, OnCallPageNotificationEvent.SentLater);

    expect(entries).toEqual([]);
  });

  test("one sent before the page's own entry is among that entry's channels: no entry of its own", async () => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.Executing,
    });
    const call: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sending,
      method: "userCallId",
    });

    await notificationEntry(call, OnCallPageNotificationEvent.SentLater);

    expect(entries).toEqual([]);
  });

  test("one that could not be sent is told of, in red, without its reason", async () => {
    const sms: UserOnCallLogTimeline = deliveries[0]!;
    sms.status = UserNotificationStatus.Error;
    sms.statusMessage = "Could not send SMS to +15551234567: carrier refused.";

    await notificationEntry(sms, OnCallPageNotificationEvent.Failed);

    expect(markdowns()).toEqual([
      `${POLICY_MD} could not page **Ana Lopez** via SMS at ${RULE_MD}.`,
    ]);
    expect(entries[0]!.color).toEqual(Red500);
    expect(markdowns()[0]).not.toContain("+1555");
    expect(markdowns()[0]).not.toContain("carrier");
  });

  test("one that could not be sent before the page's own entry is told of then", async () => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.Executing,
    });
    const telegram: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Error,
      method: "userTelegramId",
    });

    await notificationEntry(telegram, OnCallPageNotificationEvent.Failed);

    expect(markdowns()).toEqual([
      `${POLICY_MD} could not page **Ana Lopez** via Telegram at ${RULE_MD}.`,
    ]);
  });

  test("a channel that fails a second time is told of once", async () => {
    deliveries[0]!.status = UserNotificationStatus.Error;
    const again: UserOnCallLogTimeline = notificationOf({
      minutes: 5,
      status: UserNotificationStatus.Error,
      method: "userSmsId",
    });

    await notificationEntry(again, OnCallPageNotificationEvent.Failed);

    expect(entries).toEqual([]);
  });

  test.each([
    OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    OnCallDutyExecutionLogTimelineStatus.PassedOn,
  ])(
    "a failure that comes back once the page is answered (%s) no longer tells how the page went",
    async (status: OnCallDutyExecutionLogTimelineStatus) => {
      line = lineOf({ status: status });
      const push: UserOnCallLogTimeline = notificationOf({
        minutes: 0,
        status: UserNotificationStatus.Error,
        method: "userPushId",
      });

      await notificationEntry(push, OnCallPageNotificationEvent.Failed);

      expect(entries).toEqual([]);
    },
  );

  test("a notification that is not one of this page's is no news of it", async () => {
    const elsewhere: UserOnCallLogTimeline = notificationOf({
      minutes: 10,
      status: UserNotificationStatus.Sending,
      method: "userCallId",
    });
    elsewhere.onCallDutyPolicyExecutionLogTimelineId = ObjectID.generate();

    await notificationEntry(elsewhere, OnCallPageNotificationEvent.SentLater);

    expect(entries).toEqual([]);
  });

  test("a page of no record has no feed to tell", async () => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      triggeredByIncidentId: undefined as never,
    });
    const call: UserOnCallLogTimeline = notificationOf({
      minutes: 10,
      status: UserNotificationStatus.Sending,
      method: "userCallId",
    });

    await notificationEntry(call, OnCallPageNotificationEvent.SentLater);

    expect(entries).toEqual([]);
  });

  test("a direct page's notification reads as its other entries do", async () => {
    line = lineOf({
      isDirectPage: true,
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    });
    const call: UserOnCallLogTimeline = notificationOf({
      minutes: 10,
      status: UserNotificationStatus.Sending,
      method: "userCallId",
    });

    await notificationEntry(call, OnCallPageNotificationEvent.SentLater);

    expect(markdowns()).toEqual([
      "Workflow **Page SRE** paged **Ana Lopez** again via phone call.",
    ]);
  });

  test("an incident episode's run tells the episode's feed", async () => {
    line = lineOf({
      status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      triggeredByIncidentId: undefined as never,
      triggeredByIncidentEpisodeId: EPISODE,
    });
    const call: UserOnCallLogTimeline = notificationOf({
      minutes: 10,
      status: UserNotificationStatus.Sending,
      method: "userCallId",
    });

    await notificationEntry(call, OnCallPageNotificationEvent.SentLater);

    expect(
      entries.map((entry: Entry) => {
        return [entry.record, entry.eventType];
      }),
    ).toEqual([["incidentEpisode", "OnCallNotification"]]);
  });

  test("never throws: a feed entry is no reason for a notification not to go out", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "findOneById")
      .mockRejectedValue(new Error("connection reset"));

    const call: UserOnCallLogTimeline = notificationOf({
      minutes: 10,
      status: UserNotificationStatus.Sending,
      method: "userCallId",
    });

    await expect(
      notificationEntry(call, OnCallPageNotificationEvent.SentLater),
    ).resolves.toBeUndefined();
    expect(entries).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("the notification's own hooks ask for its entry", () => {
  let asked: Array<{
    onCallDutyPolicyExecutionLogTimelineId: ObjectID;
    userOnCallLogTimelineId: ObjectID;
    event: OnCallPageNotificationEvent;
  }>;

  beforeEach(() => {
    asked = [];

    jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
      return undefined;
    });

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "addNotificationToFeed",
      )
      .mockImplementation((async (data: {
        onCallDutyPolicyExecutionLogTimelineId: ObjectID;
        userOnCallLogTimelineId: ObjectID;
        event: OnCallPageNotificationEvent;
      }) => {
        asked.push(data);
      }) as never);

    // The rows an update wrote, read back by id.
    jest
      .spyOn(UserOnCallLogTimelineService, "findBy")
      .mockImplementation((async () => {
        return deliveries;
      }) as never);
  });

  function hook(name: string): AnyFunction {
    return (
      UserOnCallLogTimelineService as unknown as Record<string, AnyFunction>
    )[name]!.bind(UserOnCallLogTimelineService) as AnyFunction;
  }

  async function created(row: UserOnCallLogTimeline): Promise<void> {
    await hook("onCreateSuccess")(
      { createBy: { data: row, props: { isRoot: true } }, carryForward: null },
      row,
    );
  }

  async function updated(
    row: UserOnCallLogTimeline,
    status: UserNotificationStatus,
    carryForward: unknown,
  ): Promise<void> {
    await hook("onUpdateSuccess")(
      {
        updateBy: {
          query: { _id: row.id!.toString() },
          data: { status: status },
          props: { isRoot: true },
        },
        carryForward: carryForward,
      },
      [row.id],
    );
  }

  test("written as it goes out: a notification that may be later than its page's entry", async () => {
    const call: UserOnCallLogTimeline = notificationOf({
      minutes: 10,
      status: UserNotificationStatus.Sending,
      method: "userCallId",
    });

    await created(call);

    expect(asked).toEqual([
      {
        onCallDutyPolicyExecutionLogTimelineId: LINE,
        userOnCallLogTimelineId: call.id!,
        event: OnCallPageNotificationEvent.SentLater,
      },
    ]);
  });

  test("written as not sent - a channel that is not verified: one that could not be sent", async () => {
    const telegram: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Error,
      method: "userTelegramId",
    });

    await created(telegram);

    expect(asked[0]!.event).toBe(OnCallPageNotificationEvent.Failed);
  });

  test("a notification of no page, or by no channel, asks for nothing", async () => {
    const noPage: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sending,
      method: "userSmsId",
    });
    noPage.onCallDutyPolicyExecutionLogTimelineId = undefined as never;

    const noChannel: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    noChannel.id = ObjectID.generate();
    noChannel.onCallDutyPolicyExecutionLogTimelineId = LINE;
    noChannel.status = UserNotificationStatus.Error;

    const skipped: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Skipped,
      method: "userSmsId",
    });

    await created(noPage);
    await created(noChannel);
    await created(skipped);

    expect(asked).toEqual([]);
  });

  test("marked not sent after all: one that could not be sent", async () => {
    const sms: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Error,
      method: "userSmsId",
    });

    await updated(sms, UserNotificationStatus.Error, {
      statusBeforeUpdate: {
        [sms.id!.toString()]: UserNotificationStatus.Sending,
      },
    });

    expect(asked).toEqual([
      {
        onCallDutyPolicyExecutionLogTimelineId: LINE,
        userOnCallLogTimelineId: sms.id!,
        event: OnCallPageNotificationEvent.Failed,
      },
    ]);
  });

  test("marked not sent a second time - a skip, then the error it threw - is told of once", async () => {
    const sms: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Error,
      method: "userSmsId",
    });

    await updated(sms, UserNotificationStatus.Error, {
      statusBeforeUpdate: {
        [sms.id!.toString()]: UserNotificationStatus.Error,
      },
    });

    expect(asked).toEqual([]);
  });

  test("a status not read before the update counts as a change", async () => {
    const sms: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Error,
      method: "userSmsId",
    });

    await updated(sms, UserNotificationStatus.Error, null);

    expect(asked).toHaveLength(1);
  });

  test("marked sent, or acknowledged, asks for nothing: the page's own entries say so", async () => {
    const sms: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sent,
      method: "userSmsId",
    });

    await updated(sms, UserNotificationStatus.Sent, null);
    await updated(sms, UserNotificationStatus.Acknowledged, null);

    expect(asked).toEqual([]);
  });

  test("the status before an update that marks one not sent is read with the update held to those rows", async () => {
    const sms: UserOnCallLogTimeline = notificationOf({
      minutes: 0,
      status: UserNotificationStatus.Sending,
      method: "userSmsId",
    });

    const held: jest.Mock = jest
      .spyOn(UserOnCallLogTimelineService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([sms] as never) as unknown as jest.Mock;

    const onUpdate: { carryForward: unknown } = (await hook("onBeforeUpdate")({
      query: { _id: sms.id!.toString() },
      data: { status: UserNotificationStatus.Error },
      props: { isRoot: true },
    })) as { carryForward: unknown };

    expect(held).toHaveBeenCalledTimes(1);
    expect(onUpdate.carryForward).toEqual({
      statusBeforeUpdate: {
        [sms.id!.toString()]: UserNotificationStatus.Sending,
      },
    });

    // Any other update reads nothing first.
    held.mockClear();

    await hook("onBeforeUpdate")({
      query: { _id: sms.id!.toString() },
      data: { status: UserNotificationStatus.Sent },
      props: { isRoot: true },
    });

    expect(held).not.toHaveBeenCalled();
  });
});
