import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  ON_CALL_TEST_PAGES_PER_PROJECT_PER_HOUR,
  ON_CALL_TEST_PAGE_ACKNOWLEDGEABLE_CHANNELS,
  ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
  ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
  ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES,
  ON_CALL_TEST_PAGE_PERSON_INTERVAL_IN_SECONDS,
  ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
  ON_CALL_TEST_PAGE_PROJECT_LIMIT_MESSAGE,
  OnCallTestPageDeliveryStatus,
  OnCallTestPageFix,
  OnCallTestPagePreviewMethod,
  OnCallTestPageRecordKind,
  OnCallTestPageStatus,
  canAcknowledgeOnCallTestPageBy,
  describeOnCallTestPageAnswerTime,
  describeOnCallTestPageWait,
  getOnCallTestPageAcknowledgedMessage,
  getOnCallTestPageCost,
  getOnCallTestPageDeliveryStatus,
  getOnCallTestPageEndsAt,
  getOnCallTestPageEscalationWaitInMinutes,
  getOnCallTestPageFix,
  getOnCallTestPagePagingMessage,
  getOnCallTestPagePersonTooSoonMessage,
  getOnCallTestPagePolicyTooSoonMessage,
  getOnCallTestPageRuleType,
  hasOnCallTestPageAnswerWindowPassed,
  isOnCallTestPage,
  isOnCallTestPageRecordKind,
  isOnCallTestPageResultFinal,
  sortRulesAsAPageReachesThem,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  ProjectNotificationChannel,
  getProjectNotificationChannelOffMessage,
} from "../../../Utils/Project/NotificationChannels";
import { describe, expect, test } from "@jest/globals";

/*
 * The rule of a test page (Types/OnCallDutyPolicy/OnCallTestPage): what it
 * is, how long it waits, how often it may be sent, the run's words, and how
 * a message's log becomes a line of its result - the parts every server
 * service and the Dashboard read.
 */

const MINUTE: number = 60 * 1000;

describe("what a test page is", () => {
  test("a run or a log whose event type is Test Page is one; any other is not", () => {
    expect(
      isOnCallTestPage({
        userNotificationEventType: UserNotificationEventType.TestPage,
      }),
    ).toBe(true);

    for (const eventType of Object.values(UserNotificationEventType)) {
      if (eventType === UserNotificationEventType.TestPage) {
        continue;
      }

      expect(isOnCallTestPage({ userNotificationEventType: eventType })).toBe(
        false,
      );
    }

    expect(isOnCallTestPage(null)).toBe(false);
    expect(isOnCallTestPage(undefined)).toBe(false);
    expect(isOnCallTestPage({})).toBe(false);
  });

  test("it stands in for an incident or an alert, and nothing else", () => {
    expect(isOnCallTestPageRecordKind("Incident")).toBe(true);
    expect(isOnCallTestPageRecordKind("Alert")).toBe(true);
    expect(isOnCallTestPageRecordKind("Episode")).toBe(false);
    expect(isOnCallTestPageRecordKind(undefined)).toBe(false);
    expect(isOnCallTestPageRecordKind("incident")).toBe(false);
  });

  test("it runs the On-Call Rules a real page of that kind runs", () => {
    expect(getOnCallTestPageRuleType(OnCallTestPageRecordKind.Incident)).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(getOnCallTestPageRuleType(OnCallTestPageRecordKind.Alert)).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    );
  });
});

describe("how long a test waits", () => {
  const startedAt: Date = new Date("2026-11-11T10:00:00.000Z");

  test("its answer window is fifteen minutes, ending exactly then", () => {
    expect(ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES).toBe(15);

    expect(
      hasOnCallTestPageAnswerWindowPassed({
        startedAt: startedAt,
        at: new Date(startedAt.getTime() + 15 * MINUTE - 1),
      }),
    ).toBe(false);

    expect(
      hasOnCallTestPageAnswerWindowPassed({
        startedAt: startedAt,
        at: new Date(startedAt.getTime() + 15 * MINUTE),
      }),
    ).toBe(true);

    expect(getOnCallTestPageEndsAt(startedAt).toISOString()).toBe(
      "2026-11-11T10:15:00.000Z",
    );
  });

  test("a start read as a string counts the same; one it can't read is over", () => {
    expect(
      hasOnCallTestPageAnswerWindowPassed({
        startedAt: startedAt.toISOString(),
        at: new Date(startedAt.getTime() + MINUTE),
      }),
    ).toBe(false);

    expect(
      hasOnCallTestPageAnswerWindowPassed({
        startedAt: undefined,
        at: startedAt,
      }),
    ).toBe(true);

    expect(
      hasOnCallTestPageAnswerWindowPassed({
        startedAt: "not a date",
        at: startedAt,
      }),
    ).toBe(true);
  });

  test("a level's wait is cut to a test's short wait, and a shorter one is kept", () => {
    expect(ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES).toBe(2);
    expect(getOnCallTestPageEscalationWaitInMinutes(30)).toBe(2);
    expect(getOnCallTestPageEscalationWaitInMinutes(2)).toBe(2);
    expect(getOnCallTestPageEscalationWaitInMinutes(1)).toBe(1);
    expect(getOnCallTestPageEscalationWaitInMinutes(0)).toBe(0);
    expect(getOnCallTestPageEscalationWaitInMinutes(-5)).toBe(0);
    expect(getOnCallTestPageEscalationWaitInMinutes(undefined)).toBe(0);
    expect(getOnCallTestPageEscalationWaitInMinutes(null)).toBe(0);
  });
});

describe("how often a test can be sent", () => {
  test("a person every two minutes, a policy every five, twenty a project an hour", () => {
    expect(ON_CALL_TEST_PAGE_PERSON_INTERVAL_IN_SECONDS).toBe(120);
    expect(ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS).toBe(300);
    expect(ON_CALL_TEST_PAGES_PER_PROJECT_PER_HOUR).toBe(20);
  });

  test("a refusal says how long to wait, in whole minutes or seconds", () => {
    expect(describeOnCallTestPageWait(120)).toBe("2 minutes");
    expect(describeOnCallTestPageWait(61)).toBe("2 minutes");
    expect(describeOnCallTestPageWait(60)).toBe("1 minute");
    expect(describeOnCallTestPageWait(45)).toBe("45 seconds");
    expect(describeOnCallTestPageWait(1)).toBe("1 second");
    expect(describeOnCallTestPageWait(0)).toBe("1 second");

    expect(getOnCallTestPagePersonTooSoonMessage(120)).toBe(
      "A test page was sent to this person a moment ago. Wait 2 minutes, then send another.",
    );
    expect(getOnCallTestPagePolicyTooSoonMessage(300)).toBe(
      "This policy was tested a moment ago. Wait 5 minutes, then test it again.",
    );
    expect(ON_CALL_TEST_PAGE_PROJECT_LIMIT_MESSAGE).toContain("20 test pages");
  });
});

describe("the run's words", () => {
  test("paging one person, or many", () => {
    expect(getOnCallTestPagePagingMessage(1)).toBe(
      "Test page sent to 1 person. Waiting for them to acknowledge it.",
    );
    expect(getOnCallTestPagePagingMessage(3)).toBe(
      "Test page sent to 3 people. Waiting for one of them to acknowledge it.",
    );
  });

  test("an unanswered test says it ended after its window", () => {
    expect(ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE).toBe(
      "Test ended: nobody acknowledged it within 15 minutes.",
    );
  });

  test("who acknowledged it, by what, and how long after their message went out", () => {
    expect(
      getOnCallTestPageAcknowledgedMessage({
        userName: "Ana Lopez",
        userEmail: "ana@example.com",
        channel: OnCallPageChannel.SMS,
        afterSeconds: 14,
      }),
    ).toBe(
      "Test page acknowledged by Ana Lopez (ana@example.com) by SMS after 14 seconds.",
    );

    expect(
      getOnCallTestPageAcknowledgedMessage({
        userName: "Ana Lopez",
        channel: OnCallPageChannel.Call,
        afterSeconds: 1,
      }),
    ).toBe("Test page acknowledged by Ana Lopez by phone call after 1 second.");

    expect(
      getOnCallTestPageAcknowledgedMessage({
        userEmail: "ana@example.com",
        afterSeconds: 300,
      }),
    ).toBe("Test page acknowledged by ana@example.com after 5 minutes.");

    // Nothing known of who or how: still a sentence.
    expect(getOnCallTestPageAcknowledgedMessage({})).toBe(
      "Test page acknowledged by a member.",
    );
  });

  test("an answer time reads in seconds under two minutes, then in minutes", () => {
    expect(describeOnCallTestPageAnswerTime(0)).toBe("0 seconds");
    expect(describeOnCallTestPageAnswerTime(1)).toBe("1 second");
    expect(describeOnCallTestPageAnswerTime(14.4)).toBe("14 seconds");
    expect(describeOnCallTestPageAnswerTime(119)).toBe("119 seconds");
    expect(describeOnCallTestPageAnswerTime(120)).toBe("2 minutes");
    expect(describeOnCallTestPageAnswerTime(-3)).toBe("0 seconds");
  });
});

describe("where a test can be acknowledged from", () => {
  test("a message with a link or a call's 1 can; push, WhatsApp, webhooks and custom channels can't", () => {
    for (const channel of [
      OnCallPageChannel.Call,
      OnCallPageChannel.SMS,
      OnCallPageChannel.Email,
      OnCallPageChannel.Telegram,
      OnCallPageChannel.Slack,
      OnCallPageChannel.MicrosoftTeams,
      OnCallPageChannel.Mattermost,
    ]) {
      expect(canAcknowledgeOnCallTestPageBy(channel)).toBe(true);
    }

    for (const channel of [
      OnCallPageChannel.Push,
      OnCallPageChannel.WhatsApp,
      OnCallPageChannel.Webhook,
      OnCallPageChannel.CustomChannel,
    ]) {
      expect(canAcknowledgeOnCallTestPageBy(channel)).toBe(false);
    }

    expect(ON_CALL_TEST_PAGE_ACKNOWLEDGEABLE_CHANNELS).toHaveLength(7);
  });
});

describe("where a message that did not go out is fixed", () => {
  test.each<[string, OnCallTestPageFix]>([
    [
      "Email notification not sent because email ana@example.com is not verified.",
      OnCallTestPageFix.NotificationMethods,
    ],
    [
      "SMS not sent because phone +15550100 is not verified.",
      OnCallTestPageFix.NotificationMethods,
    ],
    [
      "Push notification not sent: this device no longer receives push notifications. Open the mobile app on it to register it again.",
      OnCallTestPageFix.NotificationMethods,
    ],
    [
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.SMS),
      OnCallTestPageFix.ProjectNotificationSettings,
    ],
    [
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.Call),
      OnCallTestPageFix.ProjectNotificationSettings,
    ],
    [
      "This project's balance is used up. A project owner can recharge it.",
      OnCallTestPageFix.ProjectBalance,
    ],
    [
      "No Twilio account is set up to send SMS for this project.",
      OnCallTestPageFix.ProjectCallAndSms,
    ],
    [
      "This project is not connected to Slack. Connect it in Project Settings.",
      OnCallTestPageFix.ProjectWorkspaceConnections,
    ],
    [
      "Notification not sent because the SMS notification method on this rule belongs to a different user. Please review this notification rule.",
      OnCallTestPageFix.OnCallRules,
    ],
    [
      "No notification rules found for this user. User should add the rules in User Settings > On-Call Rules.",
      OnCallTestPageFix.OnCallRules,
    ],
  ])("%s", (reason: string, fix: OnCallTestPageFix) => {
    expect(getOnCallTestPageFix(reason)).toBe(fix);
  });

  test("a reason that names no fix, or none at all, links nowhere", () => {
    expect(getOnCallTestPageFix("Error sending SMS.")).toBeNull();
    expect(getOnCallTestPageFix("")).toBeNull();
    expect(getOnCallTestPageFix(undefined)).toBeNull();
  });

  test("a channel off for lack of balance is fixed in billing, not the switches", () => {
    // Both words appear; the balance is the more specific fix.
    expect(
      getOnCallTestPageFix(
        "SMS not sent: This project's balance (0.05 USD) is less than this SMS costs (0.10 USD).",
      ),
    ).toBe(OnCallTestPageFix.ProjectBalance);
  });
});

describe("what became of a message", () => {
  test.each<
    [
      UserNotificationStatus | undefined,
      boolean,
      boolean,
      OnCallTestPageDeliveryStatus,
    ]
  >([
    [
      UserNotificationStatus.Sending,
      false,
      false,
      OnCallTestPageDeliveryStatus.Sending,
    ],
    [undefined, false, false, OnCallTestPageDeliveryStatus.Sending],
    [
      UserNotificationStatus.Sent,
      false,
      false,
      OnCallTestPageDeliveryStatus.Sent,
    ],
    [
      UserNotificationStatus.Sent,
      false,
      true,
      OnCallTestPageDeliveryStatus.Delivered,
    ],
    [
      UserNotificationStatus.NotAnswered,
      false,
      false,
      OnCallTestPageDeliveryStatus.NotAnswered,
    ],
    [
      UserNotificationStatus.Error,
      false,
      false,
      OnCallTestPageDeliveryStatus.Failed,
    ],
    [
      UserNotificationStatus.Skipped,
      false,
      false,
      OnCallTestPageDeliveryStatus.Failed,
    ],
    [
      UserNotificationStatus.Acknowledged,
      false,
      false,
      OnCallTestPageDeliveryStatus.Acknowledged,
    ],
    // Acknowledged wins over whatever its status still says.
    [
      UserNotificationStatus.Sent,
      true,
      true,
      OnCallTestPageDeliveryStatus.Acknowledged,
    ],
  ])(
    "status %s, acknowledged %s, delivered %s reads %s",
    (
      status: UserNotificationStatus | undefined,
      isAcknowledged: boolean,
      isDelivered: boolean,
      expected: OnCallTestPageDeliveryStatus,
    ) => {
      expect(
        getOnCallTestPageDeliveryStatus({
          status: status,
          isAcknowledged: isAcknowledged,
          isDelivered: isDelivered,
        }),
      ).toBe(expected);
    },
  );

  test("a result is final once acknowledged, ended or failed", () => {
    expect(
      isOnCallTestPageResultFinal({ status: OnCallTestPageStatus.Paging }),
    ).toBe(false);
    expect(
      isOnCallTestPageResultFinal({
        status: OnCallTestPageStatus.Acknowledged,
      }),
    ).toBe(true);
    expect(
      isOnCallTestPageResultFinal({ status: OnCallTestPageStatus.Ended }),
    ).toBe(true);
    expect(
      isOnCallTestPageResultFinal({ status: OnCallTestPageStatus.Failed }),
    ).toBe(true);
    expect(isOnCallTestPageResultFinal(null)).toBe(false);
  });
});

describe("the order a page reaches a person's rules", () => {
  test("immediate rules first, then each wait in turn; a tie keeps the order read", () => {
    const rules: Array<{ id: string; notifyAfterMinutes?: number | null }> = [
      { id: "call-10", notifyAfterMinutes: 10 },
      { id: "email-0", notifyAfterMinutes: 0 },
      { id: "sms-5", notifyAfterMinutes: 5 },
      { id: "push-0", notifyAfterMinutes: 0 },
      { id: "unset", notifyAfterMinutes: null },
      { id: "sms-5-b", notifyAfterMinutes: 5 },
    ];

    expect(
      sortRulesAsAPageReachesThem(rules).map((rule: { id: string }) => {
        return rule.id;
      }),
    ).toEqual(["email-0", "push-0", "unset", "sms-5", "sms-5-b", "call-10"]);

    // The rules read are left as they were.
    expect(rules[0]!.id).toBe("call-10");
  });
});

describe("what a test costs", () => {
  const method: (
    channel: OnCallPageChannel,
    isVerified?: boolean,
  ) => OnCallTestPagePreviewMethod = (
    channel: OnCallPageChannel,
    isVerified: boolean = true,
  ): OnCallTestPagePreviewMethod => {
    return {
      channel: channel,
      notifyAfterMinutes: 0,
      isVerified: isVerified,
      canAcknowledge: true,
    };
  };

  const prices: {
    smsInCents: number;
    callPerMinuteInCents: number;
    whatsAppInCents: number;
    telegramInCents: number;
  } = {
    smsInCents: 10,
    callPerMinuteInCents: 25,
    whatsAppInCents: 3,
    telegramInCents: 1,
  };

  test("nothing is paid where billing is off: a self-hosted server", () => {
    expect(
      getOnCallTestPageCost({
        people: [
          {
            methods: [
              method(OnCallPageChannel.SMS),
              method(OnCallPageChannel.Call),
            ],
          },
        ],
        isBillingEnabled: false,
        hasOwnTwilioForSms: false,
        hasOwnTwilioForCalls: false,
        prices: prices,
      }),
    ).toEqual({
      isPaid: false,
      smsCount: 1,
      callCount: 1,
      whatsAppCount: 0,
      telegramCount: 0,
    });
  });

  test("on OneUptime Cloud an SMS and a call are paid from the balance, about so much", () => {
    expect(
      getOnCallTestPageCost({
        people: [
          {
            methods: [
              method(OnCallPageChannel.Email),
              method(OnCallPageChannel.SMS),
              method(OnCallPageChannel.Call),
              method(OnCallPageChannel.Push),
            ],
          },
          { methods: [method(OnCallPageChannel.SMS)] },
        ],
        isBillingEnabled: true,
        hasOwnTwilioForSms: false,
        hasOwnTwilioForCalls: false,
        prices: prices,
      }),
    ).toEqual({
      isPaid: true,
      smsCount: 2,
      callCount: 1,
      whatsAppCount: 0,
      telegramCount: 0,
      estimatedCostInUSDCents: 45,
    });
  });

  test("the project's own Twilio pays for its SMS and calls; WhatsApp and Telegram stay paid", () => {
    expect(
      getOnCallTestPageCost({
        people: [
          {
            methods: [
              method(OnCallPageChannel.SMS),
              method(OnCallPageChannel.Call),
            ],
          },
        ],
        isBillingEnabled: true,
        hasOwnTwilioForSms: true,
        hasOwnTwilioForCalls: true,
        prices: prices,
      }).isPaid,
    ).toBe(false);

    expect(
      getOnCallTestPageCost({
        people: [
          {
            methods: [
              method(OnCallPageChannel.WhatsApp),
              method(OnCallPageChannel.Telegram),
            ],
          },
        ],
        isBillingEnabled: true,
        hasOwnTwilioForSms: true,
        hasOwnTwilioForCalls: true,
        prices: prices,
      }),
    ).toEqual({
      isPaid: true,
      smsCount: 0,
      callCount: 0,
      whatsAppCount: 1,
      telegramCount: 1,
      estimatedCostInUSDCents: 4,
    });
  });

  test("a method that is not verified sends nothing, so costs nothing", () => {
    expect(
      getOnCallTestPageCost({
        people: [{ methods: [method(OnCallPageChannel.SMS, false)] }],
        isBillingEnabled: true,
        hasOwnTwilioForSms: false,
        hasOwnTwilioForCalls: false,
        prices: prices,
      }),
    ).toEqual({
      isPaid: false,
      smsCount: 0,
      callCount: 0,
      whatsAppCount: 0,
      telegramCount: 0,
    });
  });

  test("with no prices known it says it is paid, without an amount", () => {
    const cost: ReturnType<typeof getOnCallTestPageCost> =
      getOnCallTestPageCost({
        people: [{ methods: [method(OnCallPageChannel.SMS)] }],
        isBillingEnabled: true,
        hasOwnTwilioForSms: false,
        hasOwnTwilioForCalls: false,
        prices: {
          smsInCents: 0,
          callPerMinuteInCents: 0,
          whatsAppInCents: 0,
          telegramInCents: 0,
        },
      });

    expect(cost.isPaid).toBe(true);
    expect(cost.estimatedCostInUSDCents).toBeUndefined();
  });
});
