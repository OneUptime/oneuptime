import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import OnCallHandoffPosts, {
  OnCallHandoff,
} from "../../../Server/Utils/OnCall/OnCallHandoffPosts";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import URL from "../../../Types/API/URL";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { WhatsAppMessagePayload } from "../../../Types/WhatsApp/WhatsAppMessage";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A HANDOFF IS POSTED ONCE FOR EACH POLICY, NOT ONCE FOR EACH ESCALATION
 * RULE (issue #7549) - AND EACH PERSON IS TOLD ONCE FOR EACH POLICY
 * (issue #7969).
 *
 * A schedule paged by two escalation rules of one policy posted every
 * handoff twice over to the policy's feed and channels - each copy naming
 * its rule and its order. Now each policy that pages the schedule posts
 * the handoff once (OnCallHandoffPosts), after every person on call has
 * been told.
 *
 * The people were told twice over too: two emails, two texts, two calls,
 * two pushes - one for each rule. Now each policy tells each of them once
 * (OnCallHandoffPolicies), in one email that names every rule of it that
 * pages the schedule; each policy is still a reason of its own to tell
 * them, and each rule still keeps its on-call time logs. A rule that pages
 * only the next person in the rotation tells nobody and posts nothing, as
 * before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "75490000-0000-4000-8000-000000000101",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "75490000-0000-4000-8000-000000000102",
);
const PAYMENTS: ObjectID = new ObjectID("75490000-0000-4000-8000-000000000103");
const CHECKOUT: ObjectID = new ObjectID("75490000-0000-4000-8000-000000000104");
const NEXT_ONLY: ObjectID = new ObjectID(
  "75490000-0000-4000-8000-000000000105",
);
const ANA: ObjectID = new ObjectID("75490000-0000-4000-8000-0000000001a1");
const BOB: ObjectID = new ObjectID("75490000-0000-4000-8000-0000000001b1");
const CARL: ObjectID = new ObjectID("75490000-0000-4000-8000-0000000001c1");

const NAMES: Record<string, string> = {
  [ANA.toString()]: "Ana",
  [BOB.toString()]: "Bob",
  [CARL.toString()]: "Carl",
};

const YESTERDAY: Date = new Date("2026-11-13T22:50:00.000Z");
const TODAY: Date = new Date("2026-11-14T22:50:00.000Z");
const TOMORROW: Date = new Date("2026-11-15T22:50:00.000Z");
const DAY_AFTER: Date = new Date("2026-11-16T22:50:00.000Z");

interface Roster {
  currentUserIdOnRoster: ObjectID | null;
  rosterHandoffAt: Date | null;
  nextUserIdOnRoster: ObjectID | null;
  nextHandOffTimeAt: Date | null;
  rosterStartAt: Date | null;
  nextRosterStartAt: Date | null;
}

// Carl was on call until today, Ana next.
const BEFORE: Roster = {
  currentUserIdOnRoster: CARL,
  rosterHandoffAt: TODAY,
  nextUserIdOnRoster: ANA,
  nextHandOffTimeAt: TOMORROW,
  rosterStartAt: YESTERDAY,
  nextRosterStartAt: TODAY,
};

// Ana is on call until tomorrow, then Bob.
const AFTER: Roster = {
  currentUserIdOnRoster: ANA,
  rosterHandoffAt: TOMORROW,
  nextUserIdOnRoster: BOB,
  nextHandOffTimeAt: DAY_AFTER,
  rosterStartAt: TODAY,
  nextRosterStartAt: TOMORROW,
};

function attachment(data: {
  policyId: ObjectID;
  policyName: string;
  ruleName: string;
  order: number;
  pageNextInRotation?: boolean;
  // The same rule attached again, or a rule whose id a test reads.
  ruleId?: ObjectID;
}): OnCallDutyPolicyEscalationRuleSchedule {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = data.policyId;
  policy.name = data.policyName;

  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = data.ruleId || ObjectID.generate();
  rule.name = data.ruleName;
  rule.order = data.order;

  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = SCHEDULE_ID;
  schedule.name = "Primary";
  schedule.timezone = Timezone.AmericaNew_York;

  const row: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  row.id = ObjectID.generate();
  row.projectId = PROJECT_ID;
  row.pageNextInRotation = Boolean(data.pageNextInRotation);
  row.onCallDutyPolicy = policy;
  row.onCallDutyPolicyEscalationRule = rule;
  row.onCallDutyPolicySchedule = schedule;
  return row;
}

// Payments pages the schedule from two rules; Checkout from one.
const ATTACHMENTS: Array<OnCallDutyPolicyEscalationRuleSchedule> = [
  attachment({
    policyId: PAYMENTS,
    policyName: "Payments",
    ruleName: "First line",
    order: 1,
  }),
  attachment({
    policyId: PAYMENTS,
    policyName: "Payments",
    ruleName: "Escalate",
    order: 2,
  }),
  attachment({
    policyId: CHECKOUT,
    policyName: "Checkout",
    ruleName: "First line",
    order: 1,
  }),
  // Pages the next person in the rotation, never whoever is on call.
  attachment({
    policyId: NEXT_ONLY,
    policyName: "Warm standby",
    ruleName: "Next in rotation",
    order: 1,
    pageNextInRotation: true,
  }),
];

let told: Array<{ userId: string; eventType: NotificationSettingEventType }>;
let steps: Array<string>;

// Everything a person was sent, as sendUserNotification was handed it.
interface Sent {
  userId: string;
  eventType: NotificationSettingEventType;
  policyId: string;
  ruleId: string;
  scheduleId: string;
  templateType: string;
  subject: string;
  vars: Record<string, string>;
  sms: string;
  call: string;
  pushTitle: string;
  pushBody: string;
  whatsAppVariables: Record<string, string>;
}

let sent: Array<Sent>;

// A time log started or ended: for whom, and for which policy and rule.
interface TimeLogWrite {
  userId: string;
  policyId: string;
  ruleId: string;
  scheduleId: string;
}

let started: Array<TimeLogWrite>;
let ended: Array<TimeLogWrite>;

function timeLogWrite(data: {
  userId: ObjectID;
  onCallDutyPolicyId: ObjectID;
  onCallDutyPolicyEscalationRuleId: ObjectID;
  onCallDutyPolicyScheduleId?: ObjectID;
}): TimeLogWrite {
  return {
    userId: data.userId.toString(),
    policyId: data.onCallDutyPolicyId.toString(),
    ruleId: data.onCallDutyPolicyEscalationRuleId.toString(),
    scheduleId: data.onCallDutyPolicyScheduleId?.toString() || "",
  };
}

async function handoff(data: {
  before: Roster;
  after: Roster;
  attachments?: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}): Promise<void> {
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue(data.attachments || ATTACHMENTS);

  await (
    OnCallDutyPolicyScheduleService as unknown as {
      sendNotificationToUserOnScheduleHandoff: (data: {
        scheduleId: ObjectID;
        previousInformation: Roster;
        newInformation: Roster;
      }) => Promise<void>;
    }
  ).sendNotificationToUserOnScheduleHandoff({
    scheduleId: SCHEDULE_ID,
    previousInformation: data.before,
    newInformation: data.after,
  });
}

beforeEach(() => {
  told = [];
  steps = [];
  sent = [];
  started = [];
  ended = [];

  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockImplementation((async (_projectId: ObjectID, policyId: ObjectID) => {
      return URL.fromString(
        `https://oneuptime.test/dashboard/on-call-duty/policies/${policyId.toString()}`,
      );
    }) as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
      onCallPolicyId: ObjectID;
      onCallPolicyEscalationRuleId: ObjectID;
      onCallScheduleId: ObjectID;
      emailEnvelope: EmailEnvelope;
      smsMessage: SMSMessage;
      callRequestMessage: CallRequestMessage;
      pushNotificationMessage: PushNotificationMessage;
      whatsAppMessage: WhatsAppMessagePayload;
    }) => {
      steps.push("tell " + NAMES[data.userId.toString()]);
      told.push({
        userId: data.userId.toString(),
        eventType: data.eventType,
      });
      sent.push({
        userId: data.userId.toString(),
        eventType: data.eventType,
        policyId: data.onCallPolicyId.toString(),
        ruleId: data.onCallPolicyEscalationRuleId.toString(),
        scheduleId: data.onCallScheduleId.toString(),
        templateType: data.emailEnvelope.templateType as string,
        subject: data.emailEnvelope.subject,
        vars: data.emailEnvelope.vars as Record<string, string>,
        sms: data.smsMessage.message,
        call: (data.callRequestMessage.data[0] as { sayMessage: string })
          .sayMessage,
        pushTitle: data.pushNotificationMessage.title,
        pushBody: data.pushNotificationMessage.body,
        whatsAppVariables: data.whatsAppMessage.templateVariables || {},
      });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
    .mockImplementation((async (data: Parameters<typeof timeLogWrite>[0]) => {
      started.push(timeLogWrite(data));
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
    .mockImplementation((async (data: Parameters<typeof timeLogWrite>[0]) => {
      ended.push(timeLogWrite(data));
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which policies post a handoff, and when", () => {
  let posted: Array<OnCallHandoff>;

  beforeEach(() => {
    posted = [];

    jest.spyOn(OnCallHandoffPosts, "post").mockImplementation((async (
      change: OnCallHandoff,
    ) => {
      steps.push("post " + change.onCallDutyPolicyName);
      posted.push(change);
    }) as never);
  });

  test("REGRESSION: a policy that pages the schedule from two rules posts the handoff once", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    expect(
      posted.map((change: OnCallHandoff): string => {
        return change.onCallDutyPolicyName;
      }),
    ).toEqual(["Payments", "Checkout"]);
  });

  test("the handoff carries who was and is on call, who is next and from when, and the schedule's zone", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    expect(posted[0]).toEqual({
      projectId: PROJECT_ID,
      onCallDutyPolicyId: PAYMENTS,
      onCallDutyPolicyName: "Payments",
      scheduleId: SCHEDULE_ID,
      scheduleName: "Primary",
      scheduleTimezone: Timezone.AmericaNew_York,
      previousUserId: CARL,
      previousNextUserId: ANA,
      currentUserId: ANA,
      handoffAt: TOMORROW,
      nextUserId: BOB,
      nextStartsAt: TOMORROW,
    });
  });

  test("each policy tells its people once, and the posts come after every one of them is told", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    /*
     * Carl, Ana and Bob, once for each of the two policies that page whoever
     * is on call - not once for each of their three rules (issue #7969).
     */
    expect(told).toHaveLength(6);
    expect(
      told.filter((entry: { eventType: NotificationSettingEventType }) => {
        return (
          entry.eventType ===
          NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER
        );
      }),
    ).toHaveLength(2);

    expect(steps.slice(-2)).toEqual(["post Payments", "post Checkout"]);
  });

  test("a rule that pages only the next person in the rotation posts nothing, and tells nobody", async () => {
    await handoff({
      before: BEFORE,
      after: AFTER,
      attachments: [ATTACHMENTS[3]!],
    });

    expect(posted).toEqual([]);
    expect(told).toEqual([]);
  });

  test("the schedule service writes no feed entry of its own any more", async () => {
    const create: SpyInstance<
      typeof OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem
    > = jest.spyOn(
      OnCallDutyPolicyFeedService,
      "createOnCallDutyPolicyFeedItem",
    );

    await handoff({ before: BEFORE, after: AFTER });
    await handoff({
      before: BEFORE,
      after: { ...AFTER, currentUserIdOnRoster: null, rosterHandoffAt: null },
    });

    expect(create).not.toHaveBeenCalled();
  });
});

describe("what a policy's feed and channels get from a handoff", () => {
  let rows: Array<OnCallDutyPolicyFeed>;
  let lines: Array<string>;

  beforeEach(() => {
    rows = [];
    lines = [];

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneBy")
      .mockResolvedValue(null);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        return mdText`[${NAMES[data.userId.toString()] || "?"}](https://oneuptime.test/users/${data.userId.toString()})`;
      }) as never);
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockImplementation((async () => {
        const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
        auth.workspaceType = WorkspaceType.Slack;
        auth.authToken = "token";
        return [auth];
      }) as never);
    jest
      .spyOn(WorkspaceUtil, "getUserStringForWorkspace")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        return `@${(NAMES[data.userId.toString()] || "?").toLowerCase()} `;
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyFeedService, "create")
      .mockImplementation((async (data: { data: OnCallDutyPolicyFeed }) => {
        rows.push(data.data);
        return data.data;
      }) as never);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "sendWorkspaceMarkdownNotification",
      )
      .mockImplementation((async (data: {
        markdownByWorkspaceType?: Partial<Record<WorkspaceType, string>>;
      }) => {
        lines.push(data.markdownByWorkspaceType?.[WorkspaceType.Slack] || "");
      }) as never);
  });

  test("REGRESSION: one feed entry for each policy - never one for each rule, nor one for each of the three people", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.onCallDutyPolicyId?.toString()).toBe(PAYMENTS.toString());
    expect(rows[1]!.onCallDutyPolicyId?.toString()).toBe(CHECKOUT.toString());

    for (const row of rows) {
      expect(row.onCallDutyPolicyFeedEventType).toBe(
        OnCallDutyPolicyFeedEventType.RosterHandoff,
      );
      expect(row.feedInfoInMarkdown).toMatch(/^📞 \*\*\[Ana\]/);
      expect(row.feedInfoInMarkdown).not.toMatch(
        /escalation rule|with order|no longer on call|GMT/i,
      );
    }
  });

  test("each policy's lines name the policy - one for each way its channels can want them", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    expect(lines).toHaveLength(6);
    expect(
      lines.filter((line: string): boolean => {
        return line.includes(PAYMENTS.toString());
      }),
    ).toHaveLength(3);
    expect(lines[0]).toMatch(
      /^📞 @ana is now on call for \[Payments\]\(.+\) until .+, then @bob\.$/,
    );
  });

  test("a gap: one Nobody on call entry for each policy, until the next person's turn", async () => {
    await handoff({
      before: BEFORE,
      after: {
        currentUserIdOnRoster: null,
        rosterHandoffAt: null,
        nextUserIdOnRoster: BOB,
        nextHandOffTimeAt: DAY_AFTER,
        rosterStartAt: null,
        nextRosterStartAt: TOMORROW,
      },
    });

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row.onCallDutyPolicyFeedEventType).toBe(
        OnCallDutyPolicyFeedEventType.CoverageGapStarted,
      );
      expect(row.feedInfoInMarkdown).toMatch(
        /^⚠️ Nobody is on call for \[(Payments|Checkout)\]\(.+\) until Nov 15, 2026, .+ EST, when \*\*\[Bob\]/,
      );
    }

    expect(lines).toHaveLength(2);
  });

  test("a feed entry that cannot be written fails nothing else: everyone is told, every channel hears the handoff", async () => {
    let failed: boolean = false;

    jest
      .spyOn(OnCallDutyPolicyFeedService, "create")
      .mockImplementation((async (data: { data: OnCallDutyPolicyFeed }) => {
        if (!failed) {
          failed = true;
          throw new Error("the database is busy");
        }

        rows.push(data.data);
        return data.data;
      }) as never);

    await expect(
      handoff({ before: BEFORE, after: AFTER }),
    ).resolves.toBeUndefined();

    // Carl, Ana and Bob, once for each policy.
    expect(told).toHaveLength(6);
    // Payments' entry failed; Checkout's was written.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.onCallDutyPolicyId?.toString()).toBe(CHECKOUT.toString());
    // Both policies' channels heard it all the same.
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain("[Payments]");
  });

  test("a rotation of one - the handoff time moves on, the same person stays on call - is not posted", async () => {
    await handoff({
      before: {
        ...BEFORE,
        currentUserIdOnRoster: ANA,
        nextUserIdOnRoster: ANA,
      },
      after: { ...AFTER, nextUserIdOnRoster: ANA },
    });

    expect(rows).toEqual([]);
    expect(lines).toEqual([]);
    expect(told).toEqual([]);
  });
});

/*
 * WHO A HANDOFF TELLS, HOW OFTEN, AND WHAT (issue #7969).
 *
 * Driven through the real sendNotificationToUserOnScheduleHandoff, with
 * what every person is sent read off sendUserNotification - one call is
 * one email, one text, one call, one push and one WhatsApp message - and
 * every on-call time log it starts or ends read off the time log service.
 */
describe("who a handoff tells, how often, and what", () => {
  const NO_LONGER: NotificationSettingEventType =
    NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER;
  const NOW_ON_CALL: NotificationSettingEventType =
    NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER;
  const NEXT: NotificationSettingEventType =
    NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER;

  // Payments' two rules that page whoever is on call, and nothing else.
  const PAYMENTS_ONLY: Array<OnCallDutyPolicyEscalationRuleSchedule> = [
    ATTACHMENTS[0]!,
    ATTACHMENTS[1]!,
  ];

  function ruleIdOf(row: OnCallDutyPolicyEscalationRuleSchedule): string {
    return row.onCallDutyPolicyEscalationRule!.id!.toString();
  }

  function sentTo(person: ObjectID): Array<Sent> {
    return sent.filter((message: Sent): boolean => {
      return message.userId === person.toString();
    });
  }

  // Who was told what, for which policy, in the order they were told.
  function summary(): Array<[string, NotificationSettingEventType, string]> {
    return sent.map(
      (message: Sent): [string, NotificationSettingEventType, string] => {
        return [
          NAMES[message.userId] || "?",
          message.eventType,
          message.policyId === PAYMENTS.toString()
            ? "Payments"
            : message.policyId === CHECKOUT.toString()
              ? "Checkout"
              : message.policyId,
        ];
      },
    );
  }

  beforeEach(() => {
    jest
      .spyOn(OnCallHandoffPosts, "post")
      .mockResolvedValue(undefined as never);
  });

  test("REGRESSION: a policy whose two rules page the schedule tells each person once, for each change", async () => {
    await handoff({ before: BEFORE, after: AFTER, attachments: PAYMENTS_ONLY });

    // It was six: Carl, Ana and Bob, once for First line and again for Escalate.
    expect(summary()).toEqual([
      ["Carl", NO_LONGER, "Payments"],
      ["Ana", NOW_ON_CALL, "Payments"],
      ["Bob", NEXT, "Payments"],
    ]);
  });

  test("each policy that pages the schedule tells each person once: every policy is a reason of its own", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    expect(summary()).toEqual([
      ["Carl", NO_LONGER, "Payments"],
      ["Ana", NOW_ON_CALL, "Payments"],
      ["Bob", NEXT, "Payments"],
      ["Carl", NO_LONGER, "Checkout"],
      ["Ana", NOW_ON_CALL, "Checkout"],
      ["Bob", NEXT, "Checkout"],
    ]);

    for (const person of [CARL, ANA, BOB]) {
      expect(
        sentTo(person).map((message: Sent): string => {
          return message.subject;
        }),
      ).toEqual([
        expect.stringMatching(/ for Payments$/),
        expect.stringMatching(/ for Checkout$/),
      ]);
    }
  });

  test("the email names every rule of its policy that pages the schedule; one rule's reads as it always did", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    for (const message of sent) {
      if (message.policyId === PAYMENTS.toString()) {
        expect(message.vars).toMatchObject({
          onCallPolicyName: "Payments",
          escalationRuleName: "First line and Escalate",
          escalationRuleOrder: "1 and 2",
          hasSeveralEscalationRules: "true",
        });
      } else {
        expect(message.vars).toMatchObject({
          onCallPolicyName: "Checkout",
          escalationRuleName: "First line",
          escalationRuleOrder: "1",
        });
        expect(message.vars["hasSeveralEscalationRules"]).toBeUndefined();
      }
    }
  });

  test("rules are named in their order, whichever order the schedule's rows come in: Level 1 and Level 3", async () => {
    const level3: OnCallDutyPolicyEscalationRuleSchedule = attachment({
      policyId: PAYMENTS,
      policyName: "Payments",
      ruleName: "Level 3",
      order: 3,
    });
    const level1: OnCallDutyPolicyEscalationRuleSchedule = attachment({
      policyId: PAYMENTS,
      policyName: "Payments",
      ruleName: "Level 1",
      order: 1,
    });

    await handoff({
      before: BEFORE,
      after: AFTER,
      attachments: [level3, level1],
    });

    expect(sent).toHaveLength(3);

    for (const message of sent) {
      expect(message.vars["escalationRuleName"]).toBe("Level 1 and Level 3");
      expect(message.vars["escalationRuleOrder"]).toBe("1 and 3");
      // Logged against the policy's first rule: Level 1, not the first row.
      expect(message.ruleId).toBe(ruleIdOf(level1));
    }

    // Each rule's time log, in the rules' order.
    expect(
      started.map((write: TimeLogWrite): string => {
        return write.ruleId;
      }),
    ).toEqual([ruleIdOf(level1), ruleIdOf(level3)]);
  });

  test("each message is logged against its policy's first rule and the schedule", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    for (const message of sent) {
      expect(message.ruleId).toBe(
        message.policyId === PAYMENTS.toString()
          ? ruleIdOf(ATTACHMENTS[0]!)
          : ruleIdOf(ATTACHMENTS[2]!),
      );
      expect(message.scheduleId).toBe(SCHEDULE_ID.toString());
    }
  });

  test("the on-call time logs are still kept for each rule: started for whoever is on call now, ended for whoever was", async () => {
    await handoff({ before: BEFORE, after: AFTER });

    const perRule: Array<Omit<TimeLogWrite, "userId">> = [
      ATTACHMENTS[0]!,
      ATTACHMENTS[1]!,
      ATTACHMENTS[2]!,
    ].map((row: OnCallDutyPolicyEscalationRuleSchedule) => {
      return {
        policyId: row.onCallDutyPolicy!.id!.toString(),
        ruleId: ruleIdOf(row),
        scheduleId: SCHEDULE_ID.toString(),
      };
    });

    expect(started).toEqual(
      perRule.map((write: Omit<TimeLogWrite, "userId">) => {
        return { userId: ANA.toString(), ...write };
      }),
    );
    expect(ended).toEqual(
      perRule.map((write: Omit<TimeLogWrite, "userId">) => {
        return { userId: CARL.toString(), ...write };
      }),
    );
  });

  test("each person's text, call, push and WhatsApp message say what they always did", async () => {
    await handoff({ before: BEFORE, after: AFTER, attachments: PAYMENTS_ONLY });

    const policyLink: string = `https://oneuptime.test/dashboard/on-call-duty/policies/${PAYMENTS.toString()}`;
    const [carl, ana, bob] = sent as [Sent, Sent, Sent];

    expect(carl).toMatchObject({
      templateType: EmailTemplateType.UserNoLongerActiveOnOnCallRoster,
      subject: "You are no longer on-call for Payments",
      sms: expect.stringContaining(
        "You are no longer on-call for Payments because your on-call roster on schedule Primary just ended.",
      ),
      call: "This is a message from OneUptime. You are no longer on-call for Payments because your on-call roster on schedule Primary just ended. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.",
      pushTitle: "On-Call Shift Ended",
      pushBody:
        "You are no longer on-call for Payments as your roster on schedule Primary has ended.",
      whatsAppVariables: {
        on_call_policy_name: "Payments",
        schedule_name: "Primary",
        schedule_link: policyLink,
      },
    });
    expect(carl.vars["reason"]).toBe(
      "Your on-call roster on schedule Primary just ended.",
    );

    expect(ana).toMatchObject({
      templateType: EmailTemplateType.UserCurrentlyOnOnCallRoster,
      subject: "You are now on-call for Payments",
      sms: expect.stringContaining(
        "You are now on-call for Payments because you are now on the roster for schedule Primary.",
      ),
      call: "This is a message from OneUptime. You are now on-call for Payments because you are now on the roster for schedule Primary. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.",
      pushTitle: "On-Call Shift Started",
      pushBody: "You are now on-call for Payments on schedule Primary.",
      whatsAppVariables: {
        on_call_policy_name: "Payments",
        schedule_name: "Primary",
        schedule_link: policyLink,
      },
    });
    expect(ana.vars["reason"]).toBe(
      "You are now on-call for the policy Payments because your on-call roster on schedule Primary",
    );
    expect(ana.vars["onCallPolicyViewLink"]).toBe(policyLink);

    expect(bob).toMatchObject({
      templateType: EmailTemplateType.UserNextOnOnCallRoster,
      subject: "You are next on-call for Payments",
      sms: expect.stringContaining(
        "You are next on-call for Payments because your on-call roster on schedule Primary will start when the next handoff happens.",
      ),
      pushTitle: "Next On-Call Shift",
      pushBody: "You are next on-call for Payments on schedule Primary.",
      whatsAppVariables: {
        on_call_policy_name: "Payments",
        schedule_name: "Primary",
        schedule_link: policyLink,
      },
    });
  });

  test("the same rule attached twice is one rule: each person told once, the rule named once, one time log", async () => {
    const ruleId: ObjectID = ObjectID.generate();
    const rows: Array<OnCallDutyPolicyEscalationRuleSchedule> = [1, 2].map(
      () => {
        return attachment({
          policyId: PAYMENTS,
          policyName: "Payments",
          ruleName: "First line",
          order: 1,
          ruleId: ruleId,
        });
      },
    );

    await handoff({ before: BEFORE, after: AFTER, attachments: rows });

    expect(sent).toHaveLength(3);

    for (const message of sent) {
      expect(message.vars).toMatchObject({
        escalationRuleName: "First line",
        escalationRuleOrder: "1",
      });
      expect(message.vars["hasSeveralEscalationRules"]).toBeUndefined();
    }

    expect(started).toHaveLength(1);
    expect(ended).toHaveLength(1);
  });

  test("a rule of the policy that pages the next person in the rotation is in neither its email nor its time logs", async () => {
    const nextOnly: OnCallDutyPolicyEscalationRuleSchedule = attachment({
      policyId: PAYMENTS,
      policyName: "Payments",
      ruleName: "Warm standby",
      order: 2,
      pageNextInRotation: true,
    });

    await handoff({
      before: BEFORE,
      after: AFTER,
      attachments: [ATTACHMENTS[0]!, nextOnly],
    });

    expect(summary()).toEqual([
      ["Carl", NO_LONGER, "Payments"],
      ["Ana", NOW_ON_CALL, "Payments"],
      ["Bob", NEXT, "Payments"],
    ]);

    for (const message of sent) {
      expect(message.vars).toMatchObject({
        escalationRuleName: "First line",
        escalationRuleOrder: "1",
      });
    }

    expect(
      [...started, ...ended].map((write: TimeLogWrite): string => {
        return write.ruleId;
      }),
    ).toEqual([ruleIdOf(ATTACHMENTS[0]!), ruleIdOf(ATTACHMENTS[0]!)]);
  });

  test("only the next person changing tells only them, once for each policy, and keeps no time log", async () => {
    await handoff({
      before: AFTER,
      after: { ...AFTER, nextUserIdOnRoster: CARL },
    });

    expect(summary()).toEqual([
      ["Carl", NEXT, "Payments"],
      ["Carl", NEXT, "Checkout"],
    ]);
    expect(started).toEqual([]);
    expect(ended).toEqual([]);
  });

  test("a gap: whoever was on call is told once for each policy, and each rule's time log for them ends", async () => {
    await handoff({
      before: BEFORE,
      after: {
        currentUserIdOnRoster: null,
        rosterHandoffAt: null,
        nextUserIdOnRoster: BOB,
        nextHandOffTimeAt: DAY_AFTER,
        rosterStartAt: null,
        nextRosterStartAt: TOMORROW,
      },
    });

    expect(summary()).toEqual([
      ["Carl", NO_LONGER, "Payments"],
      ["Bob", NEXT, "Payments"],
      ["Carl", NO_LONGER, "Checkout"],
      ["Bob", NEXT, "Checkout"],
    ]);
    expect(started).toEqual([]);
    expect(
      ended.map((write: TimeLogWrite): string => {
        return write.ruleId;
      }),
    ).toEqual([
      ruleIdOf(ATTACHMENTS[0]!),
      ruleIdOf(ATTACHMENTS[1]!),
      ruleIdOf(ATTACHMENTS[2]!),
    ]);
  });

  test("a time log that cannot be written tells nobody anything, and fails nothing", async () => {
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
      .mockRejectedValue(new Error("the database is busy") as never);

    await expect(
      handoff({ before: BEFORE, after: AFTER, attachments: PAYMENTS_ONLY }),
    ).resolves.toBeUndefined();

    expect(sent).toHaveLength(3);
    expect(OnCallHandoffPosts.post).toHaveBeenCalledTimes(1);
  });

  test("a message that cannot be sent fails the handoff, so its refresh stores no roster and the next minute tells them again", async () => {
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockRejectedValue(new Error("the notification service is down"));

    await expect(
      handoff({ before: BEFORE, after: AFTER, attachments: PAYMENTS_ONLY }),
    ).rejects.toThrow("the notification service is down");

    // Nothing was posted for a handoff nobody could be told about.
    expect(OnCallHandoffPosts.post).not.toHaveBeenCalled();
  });
});
