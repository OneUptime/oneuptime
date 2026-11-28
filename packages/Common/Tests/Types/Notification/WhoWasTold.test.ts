import CallStatus from "../../../Types/Call/CallStatus";
import { getSentToCallAndSmsGatewayMessage } from "../../../Types/CallAndSMS/CallAndSmsGatewayLine";
import MailStatus from "../../../Types/Mail/MailStatus";
import {
  NotificationLogStatusLine,
  NotificationLogStatusMeaning,
  NotificationLogStatusWords,
  getNotificationLogStatusWords,
} from "../../../Types/Notification/NotificationLogStatus";
import {
  WHO_WAS_TOLD_LOG_KINDS,
  WhoWasToldChannelGroup,
  WhoWasToldLogKind,
  WhoWasToldLogRow,
  WhoWasToldNotification,
  WhoWasToldPerson,
  WhoWasToldResult,
  WhoWasToldRun,
  WhoWasToldStatus,
  WhoWasToldStepRow,
  buildWhoWasTold,
  getWhoWasToldChannel,
  getWhoWasToldCounts,
  getWhoWasToldDeliveryStatus,
  getWhoWasToldPersonStatus,
  getWhoWasToldRunsThatPagedNobody,
  getWhoWasToldStepStatus,
  getWhoWasToldWebhookHost,
  isWhoWasToldDeliveryOut,
} from "../../../Types/Notification/WhoWasTold";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  getCallAnsweredAndLastedMessage,
  getCallIdStatusMessage,
  getCallOutcomeMessage,
  getProviderDeliveryStatusMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallSentLine";
import {
  OnCallTestPageDeliveryStatus,
  OnCallTestPageRecordKind,
  OnCallTestPageStepStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import PushStatus from "../../../Types/PushNotification/PushStatus";
import SmsStatus from "../../../Types/SmsStatus";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import TelegramStatus from "../../../Types/TelegramStatus";
import WebhookStatus from "../../../Types/WebhookStatus";
import WhatsAppStatus from "../../../Types/WhatsAppStatus";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHO WAS TOLD, AS IT HAPPENED (#7075): the pure rules - what became of each
 * notification by its log's own status, where a person and a channel stand,
 * how a record's runs, steps and logs group by person and channel in order
 * of time, and what the answer's first words count.
 */

const AT: (minute: number, second?: number) => string = (
  minute: number,
  second: number = 0,
): string => {
  return new Date(Date.UTC(2026, 10, 17, 10, minute, second)).toISOString();
};

const RUN: WhoWasToldRun = {
  id: "run-1",
  policyId: "policy-1",
  policyName: "Default",
  isDirectPage: false,
  status: OnCallDutyPolicyStatus.Executing,
  statusMessage: "",
  startedAt: AT(0),
};

function step(data: Partial<WhoWasToldStepRow>): WhoWasToldStepRow {
  return {
    id: data.id || "step",
    runId: "run-1",
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    statusMessage: "",
    createdAt: AT(1),
    channels: [],
    ...data,
  };
}

function log(data: Partial<WhoWasToldLogRow>): WhoWasToldLogRow {
  return {
    id: data.id || "log",
    kind: WhoWasToldLogKind.Email,
    status: MailStatus.Success,
    createdAt: AT(1),
    isOnCallPage: false,
    ...data,
  };
}

function build(data: {
  runs?: Array<WhoWasToldRun>;
  steps?: Array<WhoWasToldStepRow>;
  logs?: Array<WhoWasToldLogRow>;
}): WhoWasToldResult {
  return buildWhoWasTold({
    recordKind: OnCallTestPageRecordKind.Incident,
    recordId: "incident-1",
    checkedAt: AT(30),
    runs: data.runs || [RUN],
    steps: data.steps || [],
    logs: data.logs || [],
    hiddenNotificationCount: 0,
    hiddenRunCount: 0,
    isTruncated: false,
  });
}

describe("what became of one notification, by its log's own status", () => {
  test.each([
    [WhoWasToldLogKind.Email, MailStatus.Success, "Sent"],
    [WhoWasToldLogKind.Email, MailStatus.Error, "Failed"],
    [WhoWasToldLogKind.SMS, SmsStatus.Success, "Sent"],
    [WhoWasToldLogKind.SMS, SmsStatus.Sent, "Sent"],
    [WhoWasToldLogKind.SMS, SmsStatus.Delivered, "Delivered"],
    [WhoWasToldLogKind.SMS, SmsStatus.Sending, "Sending"],
    [WhoWasToldLogKind.SMS, SmsStatus.Undelivered, "Failed"],
    [WhoWasToldLogKind.SMS, SmsStatus.Failed, "Failed"],
    [WhoWasToldLogKind.SMS, SmsStatus.LowBalance, "Failed"],
    [WhoWasToldLogKind.SMS, SmsStatus.Error, "Failed"],
    [WhoWasToldLogKind.Call, CallStatus.Success, "Sent"],
    // Placed and still ringing (#11138): it went out, as a placed call always did.
    [WhoWasToldLogKind.Call, CallStatus.Calling, "Sent"],
    [WhoWasToldLogKind.Call, CallStatus.MissedCall, "Not Answered"],
    [WhoWasToldLogKind.Call, CallStatus.Busy, "Not Answered"],
    // Voicemail answered it (#6594): it reached the phone, nobody picked up.
    [WhoWasToldLogKind.Call, CallStatus.Voicemail, "Not Answered"],
    [WhoWasToldLogKind.Call, CallStatus.LowBalance, "Failed"],
    [WhoWasToldLogKind.Call, CallStatus.Error, "Failed"],
    [WhoWasToldLogKind.Push, PushStatus.Success, "Sent"],
    [WhoWasToldLogKind.Push, PushStatus.Error, "Failed"],
    [WhoWasToldLogKind.WhatsApp, WhatsAppStatus.Success, "Sent"],
    [WhoWasToldLogKind.WhatsApp, WhatsAppStatus.Delivered, "Delivered"],
    [WhoWasToldLogKind.WhatsApp, WhatsAppStatus.Read, "Delivered"],
    [WhoWasToldLogKind.WhatsApp, WhatsAppStatus.Queued, "Sending"],
    [WhoWasToldLogKind.WhatsApp, WhatsAppStatus.NotVerified, "Failed"],
    [WhoWasToldLogKind.Telegram, TelegramStatus.Sent, "Sent"],
    [WhoWasToldLogKind.Telegram, TelegramStatus.Read, "Delivered"],
    [WhoWasToldLogKind.Telegram, TelegramStatus.LowBalance, "Failed"],
    [WhoWasToldLogKind.Webhook, WebhookStatus.Success, "Sent"],
    [WhoWasToldLogKind.Webhook, WebhookStatus.Error, "Failed"],
    [WhoWasToldLogKind.Workspace, WorkspaceNotificationStatus.Success, "Sent"],
    [WhoWasToldLogKind.Workspace, WorkspaceNotificationStatus.Error, "Failed"],
  ])(
    "%s %s is %s",
    (kind: WhoWasToldLogKind, status: string, expected: string) => {
      expect(getWhoWasToldDeliveryStatus({ kind: kind, status: status })).toBe(
        expected,
      );
    },
  );

  test("a status no kind knows is failed, never said to have gone out", () => {
    for (const kind of WHO_WAS_TOLD_LOG_KINDS) {
      expect(getWhoWasToldDeliveryStatus({ kind: kind, status: "Odd" })).toBe(
        OnCallTestPageDeliveryStatus.Failed,
      );
      expect(getWhoWasToldDeliveryStatus({ kind: kind, status: "" })).toBe(
        OnCallTestPageDeliveryStatus.Failed,
      );
    }
  });

  test("a call that rang out reached the phone: out, never a failure", () => {
    expect(
      isWhoWasToldDeliveryOut(OnCallTestPageDeliveryStatus.NotAnswered),
    ).toBe(true);
    expect(isWhoWasToldDeliveryOut(OnCallTestPageDeliveryStatus.Sending)).toBe(
      false,
    );
    expect(isWhoWasToldDeliveryOut(OnCallTestPageDeliveryStatus.Failed)).toBe(
      false,
    );
  });

  test("each kind goes out by its channel; a workspace message by its workspace", () => {
    expect(getWhoWasToldChannel({ kind: WhoWasToldLogKind.Call })).toBe(
      OnCallPageChannel.Call,
    );
    expect(getWhoWasToldChannel({ kind: WhoWasToldLogKind.Push })).toBe(
      OnCallPageChannel.Push,
    );
    expect(
      getWhoWasToldChannel({
        kind: WhoWasToldLogKind.Workspace,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe(OnCallPageChannel.MicrosoftTeams);
    expect(
      getWhoWasToldChannel({
        kind: WhoWasToldLogKind.Workspace,
        workspaceType: WorkspaceType.Mattermost,
      }),
    ).toBe(OnCallPageChannel.Mattermost);
    expect(
      getWhoWasToldChannel({
        kind: WhoWasToldLogKind.Workspace,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe(OnCallPageChannel.Slack);
  });
});

describe("a step's status", () => {
  test.each([
    [
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      OnCallTestPageStepStatus.Acknowledged,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Skipped,
      OnCallTestPageStepStatus.Skipped,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Error,
      OnCallTestPageStepStatus.Failed,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
      OnCallTestPageStepStatus.Paged,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.PassedOn,
      OnCallTestPageStepStatus.Paged,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
      OnCallTestPageStepStatus.Paged,
    ],
    [
      OnCallDutyExecutionLogTimelineStatus.Started,
      OnCallTestPageStepStatus.Paged,
    ],
  ])("%s is %s", (status: string, expected: OnCallTestPageStepStatus) => {
    expect(getWhoWasToldStepStatus(status)).toBe(expected);
  });
});

describe("where a person stands", () => {
  const out: { status: OnCallTestPageDeliveryStatus } = {
    status: OnCallTestPageDeliveryStatus.Delivered,
  };
  const failed: { status: OnCallTestPageDeliveryStatus } = {
    status: OnCallTestPageDeliveryStatus.Failed,
  };
  const sending: { status: OnCallTestPageDeliveryStatus } = {
    status: OnCallTestPageDeliveryStatus.Sending,
  };

  test("acknowledged once a page of theirs is, whatever else failed", () => {
    expect(
      getWhoWasToldPersonStatus({
        pages: [
          { status: OnCallTestPageStepStatus.Acknowledged, channels: [] },
        ],
        notifications: [failed],
      }),
    ).toBe(WhoWasToldStatus.Acknowledged);
  });

  test("told once one notification went out, though another failed", () => {
    expect(
      getWhoWasToldPersonStatus({ pages: [], notifications: [failed, out] }),
    ).toBe(WhoWasToldStatus.Told);
  });

  test("told by a page whose step kept the channels it went out by, with no log they may read", () => {
    expect(
      getWhoWasToldPersonStatus({
        pages: [
          {
            status: OnCallTestPageStepStatus.Paged,
            channels: [OnCallPageChannel.SMS],
          },
        ],
        notifications: [],
      }),
    ).toBe(WhoWasToldStatus.Told);
  });

  test("sending while nothing went out and something is on its way", () => {
    expect(
      getWhoWasToldPersonStatus({
        pages: [],
        notifications: [sending, failed],
      }),
    ).toBe(WhoWasToldStatus.Sending);
    expect(
      getWhoWasToldPersonStatus({
        pages: [{ status: OnCallTestPageStepStatus.Paged, channels: [] }],
        notifications: [],
        pagesUnderWay: 1,
      }),
    ).toBe(WhoWasToldStatus.Sending);
  });

  test("failed when nothing went out and something failed", () => {
    expect(
      getWhoWasToldPersonStatus({ pages: [], notifications: [failed, failed] }),
    ).toBe(WhoWasToldStatus.Failed);
    expect(
      getWhoWasToldPersonStatus({
        pages: [{ status: OnCallTestPageStepStatus.Failed, channels: [] }],
        notifications: [],
      }),
    ).toBe(WhoWasToldStatus.Failed);
  });

  test("skipped when every page of theirs was skipped on purpose", () => {
    expect(
      getWhoWasToldPersonStatus({
        pages: [
          { status: OnCallTestPageStepStatus.Skipped, channels: [] },
          { status: OnCallTestPageStepStatus.Skipped, channels: [] },
        ],
        notifications: [],
      }),
    ).toBe(WhoWasToldStatus.Skipped);
  });
});

describe("buildWhoWasTold: by person, then by channel, in order of time", () => {
  test("a person a page and an email both reached is one person, with both, in order of time", () => {
    const result: WhoWasToldResult = build({
      steps: [
        step({
          id: "s1",
          userId: "ana",
          userName: "Ana Lopez",
          createdAt: AT(1),
          channels: [OnCallPageChannel.SMS],
          levelOrder: 1,
          teamName: "Platform",
        }),
      ],
      logs: [
        log({
          id: "l2",
          kind: WhoWasToldLogKind.Email,
          userId: "ANA",
          userName: "Ana Lopez",
          createdAt: AT(5),
        }),
        log({
          id: "l1",
          kind: WhoWasToldLogKind.SMS,
          status: SmsStatus.Delivered,
          userId: "ana",
          createdAt: AT(1, 5),
          isOnCallPage: true,
        }),
      ],
    });

    expect(result.people).toHaveLength(1);
    const ana: WhoWasToldResult["people"][number] = result.people[0]!;
    expect(ana.name).toBe("Ana Lopez");
    expect(ana.status).toBe(WhoWasToldStatus.Told);
    expect(ana.pages[0]).toMatchObject({
      policyName: "Default",
      levelOrder: 1,
      teamName: "Platform",
      status: OnCallTestPageStepStatus.Paged,
    });
    expect(
      ana.notifications.map((notification: { id: string }) => {
        return notification.id;
      }),
    ).toEqual(["l1", "l2"]);
    expect(ana.firstAt).toBe(AT(1));
    expect(ana.lastAt).toBe(AT(5));
  });

  test("people are listed in the order they were first told", () => {
    const result: WhoWasToldResult = build({
      logs: [
        log({ id: "l1", userId: "late", userName: "Late", createdAt: AT(9) }),
        log({ id: "l2", userId: "early", userName: "Early", createdAt: AT(2) }),
        log({ id: "l3", userId: "middle", userName: "Mid", createdAt: AT(4) }),
      ],
    });

    expect(
      result.people.map((person: { name: string }) => {
        return person.name;
      }),
    ).toEqual(["Early", "Mid", "Late"]);
  });

  test("an acknowledged page says when, and the person stands acknowledged", () => {
    const result: WhoWasToldResult = build({
      steps: [
        step({
          userId: "ana",
          userName: "Ana Lopez",
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          isAcknowledged: true,
          acknowledgedAt: AT(3),
        }),
      ],
    });

    expect(result.people[0]!.status).toBe(WhoWasToldStatus.Acknowledged);
    expect(result.people[0]!.acknowledgedAt).toBe(AT(3));
  });

  test("a skipped person keeps the step's line, for the Dashboard to say why", () => {
    const result: WhoWasToldResult = build({
      steps: [
        step({
          userId: "dan",
          userName: "Dan Wu",
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage:
            "Skipped: Dan Wu opted out of on-call notifications for this severity.",
        }),
      ],
    });

    expect(result.people[0]!.status).toBe(WhoWasToldStatus.Skipped);
    expect(result.people[0]!.pages[0]!.statusMessage).toContain("opted out");
  });

  test("a failed notification keeps its reason; a sent one never its provider's id", () => {
    const result: WhoWasToldResult = build({
      logs: [
        log({
          id: "failed",
          kind: WhoWasToldLogKind.SMS,
          status: SmsStatus.Failed,
          statusMessage: "The number is unreachable.",
          userId: "cara",
        }),
        log({
          id: "sent",
          kind: WhoWasToldLogKind.SMS,
          status: SmsStatus.Delivered,
          statusMessage: "Message ID: SM123",
          userId: "cara",
          createdAt: AT(2),
        }),
      ],
    });

    const [failed, sent] = result.people[0]!.notifications;
    expect(failed!.statusMessage).toBe("The number is unreachable.");
    expect(sent!.statusMessage).toBeUndefined();
    expect(result.people[0]!.failedCount).toBe(1);
  });

  test("a step that names nobody is a target that reached nobody, never a person", () => {
    const result: WhoWasToldResult = build({
      steps: [
        step({
          id: "gap",
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          statusMessage: "No one was on call in this schedule.",
          scheduleName: "Night shift",
          levelOrder: 2,
        }),
      ],
    });

    expect(result.people).toEqual([]);
    expect(result.notPaged).toEqual([
      expect.objectContaining({
        id: "gap",
        policyName: "Default",
        scheduleName: "Night shift",
        levelOrder: 2,
        statusMessage: "No one was on call in this schedule.",
      }),
    ]);
  });

  test("messages to no person are grouped by channel: a workspace channel, a webhook's host", () => {
    const result: WhoWasToldResult = build({
      logs: [
        log({
          id: "w1",
          kind: WhoWasToldLogKind.Workspace,
          status: WorkspaceNotificationStatus.Success,
          workspaceType: WorkspaceType.Slack,
          channelId: "C1",
          channelName: "#incidents",
          createdAt: AT(1),
        }),
        log({
          id: "w2",
          kind: WhoWasToldLogKind.Workspace,
          status: WorkspaceNotificationStatus.Error,
          statusMessage: "Error from Slack is_archived",
          workspaceType: WorkspaceType.Slack,
          channelId: "C1",
          channelName: "#incidents",
          createdAt: AT(4),
        }),
        log({
          id: "h1",
          kind: WhoWasToldLogKind.Webhook,
          status: WebhookStatus.Error,
          address: "hooks.example.com",
          createdAt: AT(2),
        }),
      ],
    });

    expect(
      result.channels.map((group: { name: string; channel: string }) => {
        return [group.channel, group.name];
      }),
    ).toEqual([
      [OnCallPageChannel.Slack, "#incidents"],
      [OnCallPageChannel.Webhook, "hooks.example.com"],
    ]);
    expect(result.channels[0]!.status).toBe(WhoWasToldStatus.Told);
    expect(result.channels[0]!.failedCount).toBe(1);
    expect(result.channels[0]!.notifications[1]!.workspaceType).toBe(
      WorkspaceType.Slack,
    );
    expect(result.channels[1]!.status).toBe(WhoWasToldStatus.Failed);
  });

  test("a direct page's people say so, with no policy", () => {
    const result: WhoWasToldResult = build({
      runs: [
        {
          ...RUN,
          policyId: undefined,
          policyName: "",
          isDirectPage: true,
        },
      ],
      steps: [step({ userId: "ana", userName: "Ana Lopez" })],
    });

    expect(result.people[0]!.pages[0]).toMatchObject({
      policyName: "",
      isDirectPage: true,
    });
  });

  test("hidden counts are never negative, and truncation is said", () => {
    const result: WhoWasToldResult = buildWhoWasTold({
      recordKind: OnCallTestPageRecordKind.Alert,
      recordId: "alert-1",
      checkedAt: AT(0),
      runs: [],
      steps: [],
      logs: [],
      hiddenNotificationCount: -3,
      hiddenRunCount: 2,
      isTruncated: true,
    });

    expect(result.hiddenNotificationCount).toBe(0);
    expect(result.hiddenRunCount).toBe(2);
    expect(result.isTruncated).toBe(true);
    expect(result.subscribers).toBeUndefined();
  });

  test("an incident's subscribers are handed on as counted", () => {
    const result: WhoWasToldResult = buildWhoWasTold({
      recordKind: OnCallTestPageRecordKind.Incident,
      recordId: "incident-1",
      checkedAt: AT(0),
      runs: [],
      steps: [],
      logs: [],
      subscribers: {
        status: StatusPageSubscriberNotificationStatus.Success,
        sentCount: 1204,
        failedCount: 3,
        areCountsReadable: true,
      },
      hiddenNotificationCount: 0,
      hiddenRunCount: 0,
      isTruncated: false,
    });

    expect(result.subscribers).toEqual({
      status: StatusPageSubscriberNotificationStatus.Success,
      sentCount: 1204,
      failedCount: 3,
      areCountsReadable: true,
    });
  });
});

describe("what the answer's first words count", () => {
  test("the people and channels told, the failures, and who acknowledged first and how soon after the first page", () => {
    const result: WhoWasToldResult = build({
      runs: [
        { ...RUN, acknowledgedAt: AT(4), acknowledgedByName: "Ana Lopez" },
        {
          ...RUN,
          id: "run-2",
          policyName: "Backup",
          acknowledgedAt: AT(9),
          acknowledgedByName: "Ben Ito",
        },
      ],
      steps: [
        step({
          userId: "ana",
          userName: "Ana Lopez",
          createdAt: AT(1),
          channels: [OnCallPageChannel.SMS],
        }),
      ],
      logs: [
        log({
          id: "f",
          userId: "cara",
          status: MailStatus.Error,
          createdAt: AT(2),
        }),
        log({
          id: "c",
          kind: WhoWasToldLogKind.Workspace,
          status: WorkspaceNotificationStatus.Success,
          channelName: "#ops",
          workspaceType: WorkspaceType.Slack,
        }),
      ],
    });

    expect(getWhoWasToldCounts(result)).toEqual({
      toldPeopleCount: 1,
      toldChannelCount: 1,
      failedCount: 1,
      firstAcknowledgement: { name: "Ana Lopez", afterSeconds: 180 },
    });
  });

  test("nobody acknowledged: no acknowledgement is said", () => {
    expect(getWhoWasToldCounts(build({})).firstAcknowledgement).toBeUndefined();
  });

  test("a run that paged nobody is found, to say why", () => {
    const result: WhoWasToldResult = build({
      runs: [
        RUN,
        {
          ...RUN,
          id: "run-2",
          status: OnCallDutyPolicyStatus.Waiting,
          statusMessage: "Waiting for working hours.",
        },
      ],
      steps: [step({ userId: "ana", userName: "Ana Lopez" })],
    });

    expect(
      getWhoWasToldRunsThatPagedNobody(result).map((run: WhoWasToldRun) => {
        return run.id;
      }),
    ).toEqual(["run-2"]);
  });
});

describe("a webhook's host", () => {
  test("is its address's host, never its path or query, which can hold its key", () => {
    expect(
      getWhoWasToldWebhookHost(
        "https://hooks.example.com/services/T0/B0/SECRET",
      ),
    ).toBe("hooks.example.com");
    expect(
      getWhoWasToldWebhookHost("https://example.com:8443/hook?key=1"),
    ).toBe("example.com:8443");
    expect(getWhoWasToldWebhookHost("example.com/hook/SECRET")).toBe(
      "example.com",
    );
    expect(getWhoWasToldWebhookHost("")).toBe("");
    expect(getWhoWasToldWebhookHost(undefined)).toBe("");
  });
});

/*
 * Two told in the same millisecond keep one order, whichever order their
 * logs arrive in. A rule that posts to Slack and calls a webhook in one
 * request tells both within a millisecond; the database keeps microseconds,
 * a Date does not, and the logs arrive latest first - so the two swapped
 * places from one read to the next (WhoWasToldReadPostgres saw it on the
 * 16.0.0 release pull request).
 */
describe("those told in the same millisecond", () => {
  const SAME: string = AT(5);
  const slack: WhoWasToldLogRow = log({
    id: "slack",
    kind: WhoWasToldLogKind.Workspace,
    workspaceType: WorkspaceType.Slack,
    channelId: "C123",
    channelName: "#incidents",
    status: WorkspaceNotificationStatus.Success,
    createdAt: SAME,
  });
  const webhook: WhoWasToldLogRow = log({
    id: "webhook",
    kind: WhoWasToldLogKind.Webhook,
    address: "hooks.example.com",
    status: WebhookStatus.Success,
    createdAt: SAME,
  });

  const channelNames: (logs: Array<WhoWasToldLogRow>) => Array<string> = (
    logs: Array<WhoWasToldLogRow>,
  ): Array<string> => {
    return build({ logs: logs }).channels.map(
      (group: WhoWasToldChannelGroup): string => {
        return group.name;
      },
    );
  };

  test("channels come by name, read in either order", () => {
    expect(channelNames([slack, webhook])).toEqual([
      "#incidents",
      "hooks.example.com",
    ]);
    expect(channelNames([webhook, slack])).toEqual([
      "#incidents",
      "hooks.example.com",
    ]);
  });

  test("people come by name, read in either order", () => {
    const ann: WhoWasToldLogRow = log({
      id: "ann",
      userId: "user-a",
      userName: "Ann",
      createdAt: SAME,
    });
    const bob: WhoWasToldLogRow = log({
      id: "bob",
      userId: "user-b",
      userName: "Bob",
      createdAt: SAME,
    });

    for (const logs of [
      [ann, bob],
      [bob, ann],
    ]) {
      expect(
        build({ logs: logs }).people.map((person: WhoWasToldPerson): string => {
          return person.name;
        }),
      ).toEqual(["Ann", "Bob"]);
    }
  });

  test("one told earlier still comes first, whatever its name", () => {
    const earlier: WhoWasToldLogRow = { ...webhook, createdAt: AT(4) };

    expect(channelNames([slack, earlier])).toEqual([
      "hooks.example.com",
      "#incidents",
    ]);
  });
});

/*
 * #11416: WHO WAS TOLD SAYS WHAT BECAME OF A MESSAGE AS ITS LOG DOES.
 *
 * Who Was Told said "Sent" alike of a call still ringing and one that was
 * answered, of an SMS waiting for its carrier's receipt and of one the
 * server's own gateway took for good, and of a Telegram message whose Sent
 * is its last status - where the notification logs, since #11138, tell
 * every one of them apart. During an incident people read "Sent" as "they
 * got it". Each notification now carries its log's own status and what its
 * message says that changes the status's meaning, and its status is read
 * from the meanings the logs draw (NotificationLogStatus) - not a second
 * table of its own.
 */
describe("#11416: what the notification logs tell apart, Who Was Told tells apart", () => {
  const SMS_SID: string = "SM1342fe1b2c904d1ab04f0fc7a58abca9";
  const CALL_SID: string = "CA1342fe1b2c904d1ab04f0fc7a58abca9";
  const TWILIO_SENT: string = getProviderDeliveryStatusMessage({
    status: SmsStatus.Sent,
    messageId: SMS_SID,
  });
  const ANSWERED: string = getCallOutcomeMessage({
    callId: CALL_SID,
    sentence: getCallAnsweredAndLastedMessage(42),
  });

  // The ones that all read "Sent", each to its own person.
  function allThatReadSent(): WhoWasToldResult {
    return build({
      logs: [
        log({
          id: "ringing",
          kind: WhoWasToldLogKind.Call,
          status: CallStatus.Calling,
          statusMessage: getCallIdStatusMessage(CALL_SID),
          userId: "ana",
        }),
        log({
          id: "answered",
          kind: WhoWasToldLogKind.Call,
          status: CallStatus.Success,
          statusMessage: ANSWERED,
          userId: "bob",
        }),
        log({
          id: "waiting",
          kind: WhoWasToldLogKind.SMS,
          status: SmsStatus.Sent,
          statusMessage: TWILIO_SENT,
          userId: "cara",
        }),
        log({
          id: "gateway",
          kind: WhoWasToldLogKind.SMS,
          status: SmsStatus.Sent,
          statusMessage: getSentToCallAndSmsGatewayMessage(200),
          userId: "dan",
        }),
        log({
          id: "telegram",
          kind: WhoWasToldLogKind.Telegram,
          status: TelegramStatus.Sent,
          userId: "eve",
        }),
      ],
    });
  }

  function notificationOf(
    result: WhoWasToldResult,
    id: string,
  ): WhoWasToldNotification {
    const notification: WhoWasToldNotification | undefined = result.people
      .flatMap((person: WhoWasToldPerson): Array<WhoWasToldNotification> => {
        return person.notifications;
      })
      .find((candidate: WhoWasToldNotification): boolean => {
        return candidate.id === id;
      });

    expect(notification).toBeDefined();

    return notification!;
  }

  // What the card draws: the log's own word, and where it stands.
  function drawnAs(notification: WhoWasToldNotification): [string, string] {
    expect(notification.logStatus).toBeDefined();

    const words: NotificationLogStatusWords | null =
      getNotificationLogStatusWords(notification.logStatus!);

    expect(words).not.toBeNull();

    return [words!.text, words!.meaning];
  }

  test("a call still ringing, an answered one, an SMS waiting for its receipt, one the gateway took and a Telegram message read five ways", () => {
    const result: WhoWasToldResult = allThatReadSent();

    expect(
      ["ringing", "answered", "waiting", "gateway", "telegram"].map(
        (id: string): [string, string] => {
          return drawnAs(notificationOf(result, id));
        },
      ),
    ).toEqual([
      ["Calling", NotificationLogStatusMeaning.OnItsWay],
      ["Success", NotificationLogStatusMeaning.Reached],
      ["Sent", NotificationLogStatusMeaning.OnItsWay],
      ["Sent", NotificationLogStatusMeaning.Done],
      ["Sent", NotificationLogStatusMeaning.Done],
    ]);
  });

  test("each carries its log's status, and what its message says that changes it - never the message", () => {
    const result: WhoWasToldResult = allThatReadSent();

    expect(notificationOf(result, "ringing").logStatus).toEqual({
      kind: WhoWasToldLogKind.Call,
      status: CallStatus.Calling,
    });
    expect(notificationOf(result, "answered").logStatus).toEqual({
      kind: WhoWasToldLogKind.Call,
      status: CallStatus.Success,
      line: NotificationLogStatusLine.Answered,
    });
    expect(notificationOf(result, "waiting").logStatus).toEqual({
      kind: WhoWasToldLogKind.SMS,
      status: SmsStatus.Sent,
    });
    expect(notificationOf(result, "gateway").logStatus).toEqual({
      kind: WhoWasToldLogKind.SMS,
      status: SmsStatus.Sent,
      line: NotificationLogStatusLine.SentToGateway,
    });
    expect(notificationOf(result, "telegram").logStatus).toEqual({
      kind: WhoWasToldLogKind.Telegram,
      status: TelegramStatus.Sent,
    });

    // A sent message's line names its provider's id: it is never handed on.
    for (const id of [
      "ringing",
      "answered",
      "waiting",
      "gateway",
      "telegram",
    ]) {
      const notification: WhoWasToldNotification = notificationOf(result, id);

      expect({ id, statusMessage: notification.statusMessage }).toEqual({
        id,
        statusMessage: undefined,
      });
      expect(JSON.stringify(notification)).not.toContain(CALL_SID);
      expect(JSON.stringify(notification)).not.toContain(SMS_SID);
    }
  });

  test("an answered call reached them: delivered, as a delivered SMS is; a ringing call went out", () => {
    const result: WhoWasToldResult = allThatReadSent();

    expect(notificationOf(result, "answered").status).toBe(
      OnCallTestPageDeliveryStatus.Delivered,
    );
    expect(notificationOf(result, "ringing").status).toBe(
      OnCallTestPageDeliveryStatus.Sent,
    );
    expect(notificationOf(result, "waiting").status).toBe(
      OnCallTestPageDeliveryStatus.Sent,
    );
    expect(notificationOf(result, "gateway").status).toBe(
      OnCallTestPageDeliveryStatus.Sent,
    );

    // Everyone was told; nothing failed.
    for (const person of result.people) {
      expect({ person: person.userId, status: person.status }).toEqual({
        person: person.userId,
        status: WhoWasToldStatus.Told,
      });
      expect(person.failedCount).toBe(0);
    }
  });

  test("the delivery status reads a call's message, or what it says, alike", () => {
    expect(
      getWhoWasToldDeliveryStatus({
        kind: WhoWasToldLogKind.Call,
        status: CallStatus.Success,
        statusMessage: ANSWERED,
      }),
    ).toBe(OnCallTestPageDeliveryStatus.Delivered);
    expect(
      getWhoWasToldDeliveryStatus({
        kind: WhoWasToldLogKind.Call,
        status: CallStatus.Success,
        line: NotificationLogStatusLine.Answered,
      }),
    ).toBe(OnCallTestPageDeliveryStatus.Delivered);
    // The gateway's, or placed and never told: sent, its last word.
    expect(
      getWhoWasToldDeliveryStatus({
        kind: WhoWasToldLogKind.Call,
        status: CallStatus.Success,
        statusMessage: getSentToCallAndSmsGatewayMessage(200),
      }),
    ).toBe(OnCallTestPageDeliveryStatus.Sent);
  });

  test("a WhatsApp message sent with a warning went out: the person was told, nothing failed", () => {
    expect(
      getWhoWasToldDeliveryStatus({
        kind: WhoWasToldLogKind.WhatsApp,
        status: WhatsAppStatus.Warning,
      }),
    ).toBe(OnCallTestPageDeliveryStatus.Sent);

    const result: WhoWasToldResult = build({
      logs: [
        log({
          id: "warned",
          kind: WhoWasToldLogKind.WhatsApp,
          status: WhatsAppStatus.Warning,
          userId: "fay",
        }),
      ],
    });

    expect(result.people[0]!.status).toBe(WhoWasToldStatus.Told);
    expect(result.people[0]!.failedCount).toBe(0);
  });

  test("a failed notification still says why, and draws its log's own word", () => {
    const result: WhoWasToldResult = build({
      logs: [
        log({
          id: "undelivered",
          kind: WhoWasToldLogKind.SMS,
          status: SmsStatus.Undelivered,
          statusMessage: getProviderDeliveryStatusMessage({
            status: SmsStatus.Undelivered,
            messageId: SMS_SID,
            errorCode: "30003",
          }),
          userId: "gus",
        }),
      ],
    });
    const notification: WhoWasToldNotification =
      result.people[0]!.notifications[0]!;

    expect(notification.status).toBe(OnCallTestPageDeliveryStatus.Failed);
    expect(notification.statusMessage).toContain("30003");
    expect(drawnAs(notification)).toEqual([
      "Undelivered",
      NotificationLogStatusMeaning.NotSent,
    ]);
  });

  test("every status of every log reads its delivery status from the same meanings the logs draw", () => {
    const ofMeaning: Readonly<
      Record<NotificationLogStatusMeaning, OnCallTestPageDeliveryStatus>
    > = {
      [NotificationLogStatusMeaning.HandedOver]:
        OnCallTestPageDeliveryStatus.Sending,
      [NotificationLogStatusMeaning.OnItsWay]:
        OnCallTestPageDeliveryStatus.Sent,
      [NotificationLogStatusMeaning.Reached]:
        OnCallTestPageDeliveryStatus.Delivered,
      [NotificationLogStatusMeaning.Done]: OnCallTestPageDeliveryStatus.Sent,
      [NotificationLogStatusMeaning.NeedsALook]:
        OnCallTestPageDeliveryStatus.NotAnswered,
      [NotificationLogStatusMeaning.NotSent]:
        OnCallTestPageDeliveryStatus.Failed,
      [NotificationLogStatusMeaning.Unknown]:
        OnCallTestPageDeliveryStatus.Failed,
    };
    const statusesOf: Readonly<Record<WhoWasToldLogKind, Array<string>>> = {
      [WhoWasToldLogKind.Email]: Object.values(MailStatus),
      [WhoWasToldLogKind.SMS]: Object.values(SmsStatus),
      [WhoWasToldLogKind.Call]: Object.values(CallStatus),
      [WhoWasToldLogKind.Push]: Object.values(PushStatus),
      [WhoWasToldLogKind.WhatsApp]: Object.values(WhatsAppStatus),
      [WhoWasToldLogKind.Telegram]: Object.values(TelegramStatus),
      [WhoWasToldLogKind.Webhook]: Object.values(WebhookStatus),
      [WhoWasToldLogKind.Workspace]: Object.values(WorkspaceNotificationStatus),
    };

    for (const kind of WHO_WAS_TOLD_LOG_KINDS) {
      for (const status of statusesOf[kind]) {
        const meaning: NotificationLogStatusMeaning =
          getNotificationLogStatusWords({
            kind: kind,
            status: status,
          })!.meaning;
        // A warning sent the message: it went out.
        const expected: OnCallTestPageDeliveryStatus =
          meaning === NotificationLogStatusMeaning.NeedsALook &&
          kind !== WhoWasToldLogKind.Call
            ? OnCallTestPageDeliveryStatus.Sent
            : ofMeaning[meaning];

        expect({
          kind,
          status,
          delivery: getWhoWasToldDeliveryStatus({ kind: kind, status: status }),
        }).toEqual({ kind, status, delivery: expected });
      }
    }
  });

  test("Who Was Told keeps no table of statuses of its own: it reads the logs' meanings", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Types/Notification/WhoWasTold.ts"),
      "utf8",
    );

    expect(source).toContain('from "./NotificationLogStatus"');

    // No log's status enum is read there: the meanings are read for it.
    for (const status of [
      "SmsStatus",
      "CallStatus",
      "MailStatus",
      "PushStatus",
      "TelegramStatus",
      "WhatsAppStatus",
      "WebhookStatus",
      "WorkspaceNotificationStatus",
    ]) {
      expect({
        status,
        imported: source.includes(`import ${status} `),
      }).toEqual({
        status,
        imported: false,
      });
    }

    expect(source).not.toContain("OUT_STATUSES");
    expect(source).not.toContain("DELIVERED_STATUSES");
    expect(source).not.toContain("SENDING_STATUSES");
  });
});
