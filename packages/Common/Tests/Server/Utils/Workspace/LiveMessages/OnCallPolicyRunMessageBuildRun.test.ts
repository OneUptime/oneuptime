import { describe, expect, test } from "@jest/globals";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import { NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE } from "../../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import { NOT_A_PROJECT_MEMBER_STATUS_MESSAGE } from "../../../../../Server/Services/UserOnCallLogService";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import {
  OnCallPolicyRun,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import Email from "../../../../../Types/Email";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import UserNotificationStatus from "../../../../../Types/UserNotification/UserNotificationStatus";

/*
 * HOW A RUN'S STEPS BECOME ITS ONE MESSAGE.
 *
 * buildRun reads an on-call policy run - its execution log, its escalation
 * rules, the step-by-step timeline and how each page was delivered - and
 * folds it into what its Slack / Microsoft Teams message says: each person
 * once, however many rules and repeats paged them; each reason somebody or
 * some step was not paged once; and the first rule that reached nobody at
 * all, for the alarm. The fixtures replay the run from the screenshots the
 * maintainer attached: PolicyX, rules "fhirst", "second" and "third",
 * Nitin, NB User 3 and NB User 2.
 */

const RULE_1: ObjectID = ObjectID.generate();
const RULE_2: ObjectID = ObjectID.generate();
const RULE_3: ObjectID = ObjectID.generate();
const NITIN: ObjectID = ObjectID.generate();
const NB_USER_3: ObjectID = ObjectID.generate();
const NB_USER_2: ObjectID = ObjectID.generate();
const PRIMARY_COVER: ObjectID = ObjectID.generate();
const SEC: ObjectID = ObjectID.generate();

function user(name: string | undefined, email?: string): User {
  const model: User = new User();

  if (name !== undefined) {
    model.name = name as never;
  }

  if (email) {
    model.email = new Email(email);
  }

  return model;
}

function rule(
  id: ObjectID,
  order: number,
  name?: string,
  escalateAfterInMinutes?: number,
): OnCallDutyPolicyEscalationRule {
  const model: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  model.id = id;
  model.order = order;

  if (name !== undefined) {
    model.name = name;
  }

  if (escalateAfterInMinutes !== undefined) {
    model.escalateAfterInMinutes = escalateAfterInMinutes;
  }

  return model;
}

const RULES: Array<OnCallDutyPolicyEscalationRule> = [
  rule(RULE_1, 1, "fhirst", 5),
  rule(RULE_2, 2, "second", 7),
  rule(RULE_3, 3, "third", 6),
];

interface StepOptions {
  status: OnCallDutyExecutionLogTimelineStatus;
  ruleId: ObjectID;
  userId?: ObjectID;
  userName?: string;
  scheduleId?: ObjectID;
  scheduleName?: string;
  statusMessage?: string;
  isAcknowledged?: boolean;
  overridedByUserId?: ObjectID;
  overridedByName?: string;
}

function step(options: StepOptions): OnCallDutyPolicyExecutionLogTimeline {
  const model: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  model.id = ObjectID.generate();
  model.status = options.status;
  model.onCallDutyPolicyEscalationRuleId = options.ruleId;

  if (options.userId) {
    model.alertSentToUserId = options.userId;
    model.alertSentToUser = user(options.userName);
  }

  if (options.scheduleId) {
    model.onCallDutyScheduleId = options.scheduleId;
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();

    if (options.scheduleName !== undefined) {
      schedule.name = options.scheduleName;
    }

    model.onCallDutySchedule = schedule;
  }

  if (options.statusMessage !== undefined) {
    model.statusMessage = options.statusMessage;
  }

  if (options.isAcknowledged) {
    model.isAcknowledged = true;
  }

  if (options.overridedByUserId) {
    model.overridedByUserId = options.overridedByUserId;
    model.overridedByUser = user(options.overridedByName);
  }

  return model;
}

function delivery(
  userId: ObjectID,
  status: UserNotificationStatus,
  method: keyof UserOnCallLogTimeline,
): UserOnCallLogTimeline {
  const model: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  model.userId = userId;
  model.status = status;
  (model as unknown as Record<string, unknown>)[method] = ObjectID.generate();
  return model;
}

function executionLog(options: {
  ruleId?: ObjectID | undefined;
  ruleOrder?: number | undefined;
  // When the run started the rule it is on.
  ruleStartedAt?: Date | undefined;
  executeNextInMinutes?: number | undefined;
  repeatCount?: number | undefined;
  repeatsAllowed?: number | undefined;
  acknowledgedBy?: User | undefined;
  policyName?: string | undefined;
}): OnCallDutyPolicyExecutionLog {
  const model: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();
  model.id = ObjectID.generate();

  if (options.ruleId) {
    model.lastExecutedEscalationRuleId = options.ruleId;
  }

  if (options.ruleOrder !== undefined) {
    model.lastExecutedEscalationRuleOrder = options.ruleOrder;
  }

  if (options.executeNextInMinutes !== undefined) {
    model.executeNextEscalationRuleInMinutes = options.executeNextInMinutes;
  }

  if (options.ruleStartedAt) {
    model.lastEscalationRuleExecutedAt = options.ruleStartedAt;
  }

  model.onCallPolicyExecutionRepeatCount = options.repeatCount ?? 1;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = options.policyName ?? "PolicyX";
  policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = options.repeatsAllowed ?? 2;
  model.onCallDutyPolicy = policy;

  if (options.acknowledgedBy) {
    model.acknowledgedByUserId = ObjectID.generate();
    model.acknowledgedByUser = options.acknowledgedBy;
  }

  return model;
}

function build(data: {
  log: OnCallDutyPolicyExecutionLog;
  timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
  deliveries?: Array<UserOnCallLogTimeline>;
  rules?: Array<OnCallDutyPolicyEscalationRule>;
}): OnCallPolicyRun {
  return OnCallPolicyRunMessage.buildRun({
    executionLog: data.log,
    rules: data.rules || RULES,
    timeline: data.timeline,
    deliveries: data.deliveries || [],
    policyUrl: "https://oneuptime.test/policy",
    runUrl: "https://oneuptime.test/run",
    recordLabel: "Incident INC-8",
    recordUrl: "https://oneuptime.test/incident",
  });
}

const SENT: OnCallDutyExecutionLogTimelineStatus =
  OnCallDutyExecutionLogTimelineStatus.NotificationSent;
const SKIPPED: OnCallDutyExecutionLogTimelineStatus =
  OnCallDutyExecutionLogTimelineStatus.Skipped;

// The run in the screenshots: rule 1, rule 2, rule 3, then a repeat of rule 1.
const SCREENSHOT_TIMELINE: Array<OnCallDutyPolicyExecutionLogTimeline> = [
  step({
    status: SENT,
    ruleId: RULE_1,
    userId: NITIN,
    userName: "Nitin",
    scheduleId: PRIMARY_COVER,
    scheduleName: "Primary cover",
    statusMessage: "Alert Sent",
  }),
  step({
    status: SENT,
    ruleId: RULE_2,
    userId: NB_USER_3,
    userName: "NB User 3",
    scheduleId: SEC,
    scheduleName: "sec",
    statusMessage: "Alert Sent",
  }),
  step({
    status: SENT,
    ruleId: RULE_2,
    userId: NITIN,
    userName: "Nitin",
    scheduleId: PRIMARY_COVER,
    scheduleName: "Primary cover",
    statusMessage: "Alert Sent",
  }),
  step({
    status: SKIPPED,
    ruleId: RULE_3,
    userId: NB_USER_2,
    userName: "NB User 2",
    statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
  }),
  step({
    status: SKIPPED,
    ruleId: RULE_3,
    statusMessage: "Skipped because no users in this rule.",
  }),
  step({
    status: SENT,
    ruleId: RULE_1,
    userId: NITIN,
    userName: "Nitin",
    scheduleId: PRIMARY_COVER,
    scheduleName: "Primary cover",
    statusMessage: "Alert Sent",
  }),
];

describe("OnCallPolicyRunMessage.buildRun - the run from the screenshots", () => {
  const built: OnCallPolicyRun = build({
    log: executionLog({
      ruleId: RULE_1,
      ruleOrder: 1,
      executeNextInMinutes: 5,
      repeatCount: 2,
      repeatsAllowed: 2,
    }),
    timeline: SCREENSHOT_TIMELINE,
    deliveries: [
      delivery(NITIN, UserNotificationStatus.Sent, "userEmailId"),
      delivery(NITIN, UserNotificationStatus.Sent, "userCallId"),
      delivery(NITIN, UserNotificationStatus.Sent, "userEmailId"),
      delivery(NB_USER_3, UserNotificationStatus.Sent, "userEmailId"),
    ],
  });

  test("each person once, with how often and how they were paged, in the order first paged", () => {
    expect(built.paged).toEqual([
      {
        name: "Nitin",
        timesPaged: 3,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["call", "email"],
        coveringFor: [],
      },
      {
        name: "NB User 3",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["email"],
        coveringFor: [],
      },
    ]);
  });

  test("who was not paged and why, once each", () => {
    expect(built.notPaged).toEqual([
      { personName: "NB User 2", reason: "not a member of this project" },
    ]);
  });

  test("rule 3 reached nobody: the alarm names it and why", () => {
    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 3, name: "third" },
      reasons: ["NB User 2: not a member of this project"],
    });
  });

  test("where the run is: repeat 1 of 2, on rule 1 of 3, rule 2 next after 5 minutes", () => {
    expect(built.repeatNumber).toBe(1);
    expect(built.repeatsAllowed).toBe(2);
    expect(built.ruleCount).toBe(3);
    expect(built.currentRule).toEqual({ order: 1, name: "fhirst" });
    expect(built.nextRule).toEqual({ order: 2, name: "second" });
    expect(built.escalateAfterInMinutes).toBe(5);
    expect(built.policyName).toBe("PolicyX");
    expect(built.outcome).toBe(OnCallPolicyRunOutcome.Paging);
  });
});

describe("OnCallPolicyRunMessage.buildRun - each kind of step", () => {
  test("a page that is still going out counts as being paged, not as a page", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1 }),
      timeline: [
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Executing,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
        }),
      ],
    });

    expect(built.paged).toEqual([
      expect.objectContaining({
        name: "Nitin",
        timesPaged: 0,
        isBeingPaged: true,
      }),
    ]);
  });

  test("an acknowledged page counts, and marks the person as having acknowledged", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1, acknowledgedBy: user("Nitin") }),
      timeline: [
        step({
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
          isAcknowledged: true,
        }),
      ],
    });

    expect(built.paged[0]).toEqual(
      expect.objectContaining({ timesPaged: 1, acknowledged: true }),
    );
    expect(built.acknowledgedByName).toBe("Nitin");
  });

  test("a page to somebody the run already paged in that rule is not worth a line", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1 }),
      timeline: [
        step({
          status: SENT,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
          statusMessage:
            "Skipped because notification sent to this user already.",
        }),
      ],
    });

    expect(built.notPaged).toEqual([]);
    expect(built.paged[0]!.timesPaged).toBe(1);
  });

  test("a schedule with nobody on call is one line however often it came up, and the rule's reason", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_2 }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_2,
          scheduleId: SEC,
          scheduleName: "sec",
          statusMessage:
            "Skipped because no active users are found in this schedule.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_2,
          statusMessage: "Skipped because no users in this rule.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_2,
          scheduleId: SEC,
          scheduleName: "sec",
          statusMessage:
            "Skipped because no active users are found in this schedule.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_2,
          statusMessage: "Skipped because no users in this rule.",
        }),
      ],
    });

    expect(built.notPaged).toEqual([
      { scheduleName: "sec", reason: "nobody was on call" },
    ]);
    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 2, name: "second" },
      reasons: ["nobody was on call in schedule sec"],
    });
  });

  test("a rule with nobody in it at all says so, once", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_3 }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_3,
          statusMessage: "Skipped because no users in this rule.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_3,
          statusMessage: "Skipped because no users in this rule.",
        }),
      ],
    });

    expect(built.notPaged).toEqual([
      { rule: { order: 3, name: "third" }, reason: "nobody to page" },
    ]);
    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 3, name: "third" },
      reasons: ["the rule has nobody to page"],
    });
  });

  test("the alarm is about the FIRST rule that reached nobody", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_3 }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_2,
          statusMessage: "Skipped because no users in this rule.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_3,
          statusMessage: "Skipped because no users in this rule.",
        }),
      ],
    });

    expect(built.firstRuleThatReachedNobody?.rule).toEqual({
      order: 2,
      name: "second",
    });
  });

  test("a page that failed names the person and why", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1 }),
      timeline: [
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Error,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
          statusMessage: "Nitin has no verified notification method.",
        }),
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Error,
          ruleId: RULE_1,
          userId: NB_USER_3,
          userName: "NB User 3",
        }),
      ],
    });

    expect(built.paged).toEqual([]);
    expect(built.notPaged).toEqual([
      {
        personName: "Nitin",
        reason:
          "could not be paged (Nitin has no verified notification method)",
        failed: true,
      },
      { personName: "NB User 3", reason: "could not be paged", failed: true },
    ]);
  });

  test("a page that found the person gone from the project reads like a rule that found them gone", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1 }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          userId: NB_USER_2,
          userName: "NB User 2",
          statusMessage: NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
        }),
      ],
    });

    expect(built.notPaged).toEqual([
      { personName: "NB User 2", reason: "not a member of this project" },
    ]);
  });

  test("a skip reason reads as a phrase about the person", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1 }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
          statusMessage:
            "You have opted out of notifications for Sev4 incidents.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          userId: NB_USER_3,
          userName: "NB User 3",
          statusMessage: "Skipped because the user is on vacation.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          userId: NB_USER_2,
          userName: "NB User 2",
        }),
      ],
    });

    expect(built.notPaged).toEqual([
      {
        personName: "Nitin",
        reason: "has opted out of notifications for Sev4 incidents",
      },
      { personName: "NB User 3", reason: "the user is on vacation" },
      { personName: "NB User 2", reason: "not paged" },
    ]);
  });

  test("an override: the page is the substitute's, covering for the person it was routed from", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1 }),
      timeline: [
        step({
          status: SENT,
          ruleId: RULE_1,
          userId: NB_USER_3,
          userName: "NB User 3",
          overridedByUserId: NITIN,
          overridedByName: "Nitin",
        }),
        step({
          status: SENT,
          ruleId: RULE_2,
          userId: NB_USER_3,
          userName: "NB User 3",
          overridedByUserId: NITIN,
          overridedByName: "Nitin",
        }),
      ],
    });

    expect(built.paged).toEqual([
      expect.objectContaining({
        name: "NB User 3",
        timesPaged: 2,
        coveringFor: ["Nitin"],
      }),
    ]);
  });

  test("a person with no name is named by their email, else 'Someone'", () => {
    const withEmail: OnCallDutyPolicyExecutionLogTimeline = step({
      status: SENT,
      ruleId: RULE_1,
      userId: NITIN,
    });
    withEmail.alertSentToUser = user(undefined, "nitin@example.com");

    const withNothing: OnCallDutyPolicyExecutionLogTimeline = step({
      status: SENT,
      ruleId: RULE_1,
      userId: NB_USER_3,
    });
    withNothing.alertSentToUser = user(undefined);

    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1 }),
      timeline: [withEmail, withNothing],
    });

    expect(
      built.paged.map((person: { name: string }): string => {
        return person.name;
      }),
    ).toEqual(["nitin@example.com", "Someone"]);
  });
});

describe("OnCallPolicyRunMessage.buildRun - how pages reached people", () => {
  test("only deliveries that went out count, listed loudest first, each method once", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1 }),
      timeline: [
        step({
          status: SENT,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
        }),
      ],
      deliveries: [
        delivery(NITIN, UserNotificationStatus.Sent, "userEmailId"),
        delivery(NITIN, UserNotificationStatus.Sending, "userSmsId"),
        delivery(NITIN, UserNotificationStatus.Error, "userWhatsAppId"),
        delivery(NITIN, UserNotificationStatus.Acknowledged, "userPushId"),
        delivery(NITIN, UserNotificationStatus.Sent, "userCallId"),
        delivery(NITIN, UserNotificationStatus.Sent, "userEmailId"),
        delivery(NITIN, UserNotificationStatus.Sent, "userSlackId"),
        delivery(NITIN, UserNotificationStatus.Sent, "userMicrosoftTeamsId"),
        delivery(NITIN, UserNotificationStatus.Sent, "userTelegramId"),
        delivery(NITIN, UserNotificationStatus.Sent, "userWebhookId"),
      ],
    });

    expect(built.paged[0]!.methods).toEqual([
      "call",
      "Telegram",
      "push",
      "email",
      "Slack",
      "Microsoft Teams",
      "webhook",
    ]);
  });

  test("a delivery to somebody the run did not page is left out", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1 }),
      timeline: [
        step({
          status: SENT,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
        }),
      ],
      deliveries: [
        delivery(NB_USER_3, UserNotificationStatus.Sent, "userSmsId"),
      ],
    });

    expect(built.paged).toHaveLength(1);
    expect(built.paged[0]!.methods).toEqual([]);
  });
});

describe("OnCallPolicyRunMessage.buildRun - where the escalation is", () => {
  test("the current rule is the one the log last ran, found by its id", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_2, ruleOrder: 1 }),
      timeline: [],
    });

    // A schedule-gap retry rewinds the order; the id still names the rule.
    expect(built.currentRule).toEqual({ order: 2, name: "second" });
    expect(built.nextRule).toEqual({ order: 3, name: "third" });
  });

  test("by its order when the log has no rule id", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleOrder: 3 }),
      timeline: [],
    });

    expect(built.currentRule).toEqual({ order: 3, name: "third" });
    expect(built.nextRule).toBeUndefined();
  });

  test("no rule has run yet: no current rule, no next rule", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({}),
      timeline: [],
    });

    expect(built.currentRule).toBeUndefined();
    expect(built.nextRule).toBeUndefined();
  });

  test("the wait comes from the log, else from the current rule, else nothing", () => {
    expect(
      build({
        log: executionLog({ ruleId: RULE_2, executeNextInMinutes: 11 }),
        timeline: [],
      }).escalateAfterInMinutes,
    ).toBe(11);

    expect(
      build({ log: executionLog({ ruleId: RULE_2 }), timeline: [] })
        .escalateAfterInMinutes,
    ).toBe(7);

    expect(
      build({ log: executionLog({}), timeline: [] }).escalateAfterInMinutes,
    ).toBe(0);
  });

  test("the next step's moment: when the current rule started, plus its wait, on the minute the run moves on", () => {
    // Rule 2 started at 17:21:37 and waits 7 minutes: the next tick is 17:29.
    expect(
      build({
        log: executionLog({
          ruleId: RULE_2,
          ruleStartedAt: new Date("2026-10-08T17:21:37.250Z"),
          executeNextInMinutes: 7,
        }),
        timeline: [],
      }).nextStepAt,
    ).toEqual(new Date("2026-10-08T17:29:00.000Z"));

    // On the minute already: that minute.
    expect(
      build({
        log: executionLog({
          ruleId: RULE_2,
          ruleStartedAt: new Date("2026-10-08T17:21:00.000Z"),
        }),
        timeline: [],
      }).nextStepAt,
    ).toEqual(new Date("2026-10-08T17:28:00.000Z"));
  });

  test("no moment when the run does not know when the rule started, or the rule moves on at once", () => {
    expect(
      build({
        log: executionLog({ ruleId: RULE_2, executeNextInMinutes: 7 }),
        timeline: [],
      }).nextStepAt,
    ).toBeUndefined();

    expect(
      build({
        log: executionLog({
          ruleId: RULE_2,
          ruleStartedAt: new Date("2026-10-08T17:21:00.000Z"),
          executeNextInMinutes: 0,
        }),
        timeline: [],
      }).nextStepAt,
    ).toBeUndefined();

    expect(
      build({
        log: executionLog({
          ruleId: RULE_2,
          ruleStartedAt: new Date("not a date"),
          executeNextInMinutes: 7,
        }),
        timeline: [],
      }).nextStepAt,
    ).toBeUndefined();
  });

  test("the first pass is repeat 0; a policy without repeats allows none", () => {
    const first: OnCallPolicyRun = build({
      log: executionLog({ repeatCount: 1, repeatsAllowed: 0 }),
      timeline: [],
    });

    expect(first.repeatNumber).toBe(0);
    expect(first.repeatsAllowed).toBe(0);
  });

  test("a policy without a name still reads", () => {
    expect(
      build({ log: executionLog({ policyName: "  " }), timeline: [] })
        .policyName,
    ).toBe("On-call policy");
  });
});
