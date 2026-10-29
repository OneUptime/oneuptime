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
import OnCallPolicyRunMessageView, {
  OnCallPolicyRun,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import Email from "../../../../../Types/Email";
import {
  LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
} from "../../../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
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
  /*
   * How often a run from before levels with nobody to page were passed at
   * once tried its rule again because nobody was on call yet.
   */
  scheduleGapRetryCount?: number | undefined;
  status?: OnCallDutyPolicyStatus | undefined;
  executeNextInMinutes?: number | undefined;
  repeatCount?: number | undefined;
  repeatsAllowed?: number | undefined;
  // The policy's "Repeat if no one acknowledges": on unless a test says.
  repeatSwitch?: boolean | undefined;
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

  if (options.scheduleGapRetryCount !== undefined) {
    model.scheduleGapRetryCount = options.scheduleGapRetryCount;
  }

  if (options.status !== undefined) {
    model.status = options.status;
  }

  model.onCallPolicyExecutionRepeatCount = options.repeatCount ?? 1;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = options.policyName ?? "PolicyX";
  policy.repeatPolicyIfNoOneAcknowledges = options.repeatSwitch ?? true;
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

/*
 * The first step of the rule the run has moved on to: the engine writes a
 * rule's steps as soon as it starts it.
 */
function movedOnTo(ruleId: ObjectID): OnCallDutyPolicyExecutionLogTimeline {
  return step({
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    ruleId: ruleId,
    userId: NB_USER_3,
    userName: "NB User 3",
  });
}
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
      // The run has moved on to rule 3: rule 2 is finished.
      log: executionLog({ ruleId: RULE_3 }),
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
        movedOnTo(RULE_3),
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

  /*
   * A rule whose people were all skipped or could not be paged - each opted
   * out, left the project, or has no way to be reached - reached nobody, as
   * surely as a rule with nobody in it. The engine wrote no "no users in
   * this rule" step for it, because it did find people to page.
   */
  test("REGRESSION: a rule whose every page was skipped reached nobody: the alarm names it and why", () => {
    const built: OnCallPolicyRun = build({
      // The run has moved on to rule 2: rule 1 is finished.
      log: executionLog({ ruleId: RULE_2 }),
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
          userId: NB_USER_2,
          userName: "NB User 2",
          statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
        }),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: [
        "Nitin: has opted out of notifications for Sev4 incidents",
        "NB User 2: not a member of this project",
      ],
    });
    // The people say why: no "nobody to page" line on top.
    expect(built.notPaged).toHaveLength(2);
  });

  test("a rule whose every page failed reached nobody too; the alarm says why in a word", () => {
    const built: OnCallPolicyRun = build({
      // The run has ended: every rule is finished.
      log: executionLog({
        ruleId: RULE_1,
        status: OnCallDutyPolicyStatus.Completed,
      }),
      timeline: [
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Error,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
          statusMessage:
            "Nitin has no verified notification method, so this page could not be delivered.",
        }),
      ],
    });

    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["Nitin: could not be paged"],
    });
  });

  test("a rule that reached one of its people, or is still paging them, did reach somebody", () => {
    for (const reachedStatus of [
      SENT,
      OnCallDutyExecutionLogTimelineStatus.Executing,
      OnCallDutyExecutionLogTimelineStatus.Started,
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    ]) {
      const built: OnCallPolicyRun = build({
        log: executionLog({ ruleId: RULE_1 }),
        timeline: [
          step({
            status: SKIPPED,
            ruleId: RULE_1,
            userId: NB_USER_2,
            userName: "NB User 2",
            statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
          }),
          step({
            status: reachedStatus,
            ruleId: RULE_1,
            userId: NITIN,
            userName: "Nitin",
          }),
        ],
      });

      expect(built.firstRuleThatReachedNobody).toBeUndefined();
    }
  });

  test("a page to somebody the rule paged already is not a line of its own", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_2 }),
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

    expect(built.firstRuleThatReachedNobody).toBeUndefined();
    expect(built.notPaged).toEqual([]);
  });

  /*
   * Nitin is in the rule's team and on its schedule, and opted out: his
   * page is skipped, and the second target finds him paged already. That
   * second step is the same person, not a page that reached somebody.
   */
  test("REGRESSION: a duplicate of a skipped page adds no reach: the rule reached nobody", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_2 }),
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
          userId: NITIN,
          userName: "Nitin",
          statusMessage:
            "Skipped because notification sent to this user already.",
        }),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["Nitin: has opted out of notifications for Sev4 incidents"],
    });
  });

  /*
   * A rule's pages are written one target at a time, and a page is found
   * to be skipped (an opt-out) a while after it was made: judging the rule
   * the run is on raised "paged nobody" at a rule whose next person was
   * about to be paged - an alarm never taken back.
   */
  test("REGRESSION: the rule the run is on raises no alarm for skipped pages yet: its later people may still be paged", () => {
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
      ],
    });

    expect(built.firstRuleThatReachedNobody).toBeUndefined();
    // The message still says who was not paged, and why.
    expect(built.notPaged).toEqual([
      {
        personName: "Nitin",
        reason: "has opted out of notifications for Sev4 incidents",
      },
    ]);
  });

  test("the rule the run is on, found to have nobody in it with no schedule to try again, is said at once", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_3 }),
      timeline: [
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
      ],
    });

    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 3, name: "third" },
      reasons: ["NB User 2: not a member of this project"],
    });
  });

  test("the rule the run is on, with a schedule that had nobody on call, is said once the run moves on or ends", () => {
    const gapSteps: () => Array<OnCallDutyPolicyExecutionLogTimeline> =
      (): Array<OnCallDutyPolicyExecutionLogTimeline> => {
        return [
          step({
            status: SKIPPED,
            ruleId: RULE_1,
            scheduleId: PRIMARY_COVER,
            scheduleName: "Primary cover",
            statusMessage:
              "Skipped because no active users are found in this schedule.",
          }),
          step({
            status: SKIPPED,
            ruleId: RULE_1,
            statusMessage: "Skipped because no users in this rule.",
          }),
        ];
      };

    // Still on it: the engine may try it again first.
    expect(
      build({ log: executionLog({ ruleId: RULE_1 }), timeline: gapSteps() })
        .firstRuleThatReachedNobody,
    ).toBeUndefined();

    // Moved on to rule 2.
    expect(
      build({
        log: executionLog({ ruleId: RULE_2 }),
        timeline: [...gapSteps(), movedOnTo(RULE_2)],
      }).firstRuleThatReachedNobody,
    ).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["nobody was on call in schedule Primary cover"],
    });

    // Ended.
    expect(
      build({
        log: executionLog({
          ruleId: RULE_1,
          status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
        }),
        timeline: gapSteps(),
      }).firstRuleThatReachedNobody,
    ).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["nobody was on call in schedule Primary cover"],
    });
  });

  test("REGRESSION: the first rule that reached nobody is the first the run came to, however it reached nobody", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_3 }),
      // Rule 1's people were all skipped; rule 3 has nobody in it.
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
          ruleId: RULE_3,
          statusMessage: "Skipped because no users in this rule.",
        }),
      ],
    });

    expect(built.firstRuleThatReachedNobody?.rule).toEqual({
      order: 1,
      name: "fhirst",
    });
  });

  /*
   * Runs from before a level with nobody to page was passed at once: a
   * rule whose schedules had nobody on call was tried again each minute, a
   * few times (the run rewound to the rule before, counting the tries), and
   * its "no users in this rule" line was written on each try. Raising "paged
   * nobody - page someone or fix the policy" at the first try told a
   * channel to act on a gap of a minute. Such a run still on that rule
   * raises no alarm - and its message no longer says it is trying again:
   * the engine does not, and moves on from the rule at its next minute.
   */
  test("REGRESSION: a run from before, on a rule it was trying again because nobody was on call, raises no alarm", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_1,
        ruleOrder: 0,
        scheduleGapRetryCount: 1,
        executeNextInMinutes: 1,
        ruleStartedAt: new Date("2026-10-08T17:15:00.000Z"),
      }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          scheduleId: PRIMARY_COVER,
          scheduleName: "Primary cover",
          statusMessage:
            "Skipped because no active users are found in this schedule.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          statusMessage: LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(built).not.toHaveProperty("retryingCurrentRule");
    expect(built.currentRule).toEqual({ order: 1, name: "fhirst" });
    expect(built.firstRuleThatReachedNobody).toBeUndefined();
    expect(built.nextStepAt).toEqual(new Date("2026-10-08T17:16:00.000Z"));
    // Who was not on call is still said.
    expect(built.notPaged).toEqual([
      { scheduleName: "Primary cover", reason: "nobody was on call" },
    ]);
  });

  test("once such a run moved on, the rule reached nobody: the alarm is raised then - with no word of moving on at once, since it waited", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_2,
        ruleOrder: 2,
        scheduleGapRetryCount: 0,
        executeNextInMinutes: 7,
      }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          scheduleId: PRIMARY_COVER,
          scheduleName: "Primary cover",
          statusMessage:
            "Skipped because no active users are found in this schedule.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          statusMessage: LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE,
        }),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["nobody was on call in schedule Primary cover"],
    });
  });

  /*
   * The run's log is read before its steps. A sync that read the log just
   * before the run moved on to rule 2 sees rule 2's first step - a person
   * skipped - while the log still says rule 1, and took rule 2 for finished:
   * "paged nobody at escalation rule 2" while its next person was about to
   * be paged.
   */
  test("REGRESSION: the rule of the newest step is the rule the run is on, whatever an older read of the log says", () => {
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
          ruleId: RULE_2,
          userId: NB_USER_2,
          userName: "NB User 2",
          statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(built.firstRuleThatReachedNobody).toBeUndefined();
  });

  test("REGRESSION: a rule whose first try found nobody on call, and whose next try paged somebody, did reach somebody", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_2 }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          scheduleId: PRIMARY_COVER,
          scheduleName: "Primary cover",
          statusMessage:
            "Skipped because no active users are found in this schedule.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          statusMessage: "Skipped because no users in this rule.",
        }),
        // A minute later Nitin is on call, and the rule pages him.
        step({
          status: SENT,
          ruleId: RULE_1,
          userId: NITIN,
          userName: "Nitin",
        }),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.firstRuleThatReachedNobody).toBeUndefined();
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

  /*
   * The run counts the repeats the policy's Repeat Policy card shows: none
   * while "Repeat if no one acknowledges" is off, whatever "Number of times
   * to repeat" was left at - so the message never says "repeat 1 of 3" for a
   * run that will not repeat.
   */
  test("a policy whose repeats are switched off allows none, whatever its number", () => {
    const switchedOff: OnCallPolicyRun = build({
      log: executionLog({
        repeatCount: 1,
        repeatsAllowed: 3,
        repeatSwitch: false,
      }),
      timeline: [],
    });

    expect(switchedOff.repeatsAllowed).toBe(0);

    const switchedOn: OnCallPolicyRun = build({
      log: executionLog({
        repeatCount: 1,
        repeatsAllowed: 3,
        repeatSwitch: true,
      }),
      timeline: [],
    });

    expect(switchedOn.repeatsAllowed).toBe(3);
  });

  test("a policy without a name still reads", () => {
    expect(
      build({ log: executionLog({ policyName: "  " }), timeline: [] })
        .policyName,
    ).toBe("On-call policy");
  });
});

/*
 * A LEVEL WITH NOBODY TO PAGE IS PASSED AT ONCE (OnCallEmptyLevel): its own
 * line says so, and the message says where the run went - in its list and
 * in its alarm - as soon as that line is written, whether or not the run's
 * log has caught up with the next level yet.
 */
describe("a level passed at once because it had nobody to page", () => {
  test("a level that names nobody: its line in the list says the next level was paged at once, and so does its alarm", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_2,
        ruleOrder: 2,
        executeNextInMinutes: 7,
      }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
        }),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.notPaged).toEqual([
      {
        rule: { order: 1, name: "fhirst" },
        reason: "nobody to page",
        movedOnTo: { order: 2, name: "second" },
      },
    ]);
    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["the rule has nobody to page"],
      movedOnTo: { order: 2, name: "second" },
    });
  });

  test("its people's own lines say why: the level is not listed again, and its alarm names them", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_2, ruleOrder: 2 }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          userId: NB_USER_2,
          userName: "NB User 2",
          statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          statusMessage: ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
        }),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.notPaged).toEqual([
      { personName: "NB User 2", reason: "not a member of this project" },
    ]);
    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["NB User 2: not a member of this project"],
      movedOnTo: { order: 2, name: "second" },
    });
  });

  test("finished as soon as its line is written: the run's log still on the level, the alarm is raised and says where the run goes", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1, ruleOrder: 1 }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          scheduleId: PRIMARY_COVER,
          scheduleName: "Primary cover",
          statusMessage:
            "Skipped because no active users are found in this schedule.",
        }),
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          statusMessage: ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["nobody was on call in schedule Primary cover"],
      movedOnTo: { order: 2, name: "second" },
    });
  });

  test("the last level has no level after it: nothing is said of moving on, and the run's ending says the rest", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_3,
        ruleOrder: 3,
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_3,
          statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
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

  test("every level empty: each is listed, each but the last saying the next was paged at once, and the alarm is about the first", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_3,
        ruleOrder: 3,
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      }),
      timeline: [RULE_1, RULE_2, RULE_3].map(
        (ruleId: ObjectID): OnCallDutyPolicyExecutionLogTimeline => {
          return step({
            status: SKIPPED,
            ruleId: ruleId,
            statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
          });
        },
      ),
    });

    expect(built.notPaged).toEqual([
      {
        rule: { order: 1, name: "fhirst" },
        reason: "nobody to page",
        movedOnTo: { order: 2, name: "second" },
      },
      {
        rule: { order: 2, name: "second" },
        reason: "nobody to page",
        movedOnTo: { order: 3, name: "third" },
      },
      { rule: { order: 3, name: "third" }, reason: "nobody to page" },
    ]);
    expect(built.firstRuleThatReachedNobody?.rule).toEqual({
      order: 1,
      name: "fhirst",
    });
  });

  test("a team of the level with nobody in it is said, by name, and is why the level reached nobody", () => {
    const team: OnCallDutyPolicyExecutionLogTimeline = step({
      status: SKIPPED,
      ruleId: RULE_1,
      statusMessage: "Skipped because this team has no members.",
    });
    const teamId: ObjectID = ObjectID.generate();
    team.userBelongsToTeamId = teamId;
    team.userBelongsToTeam = { name: "Night Shift" } as never;

    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_2, ruleOrder: 2 }),
      timeline: [
        team,
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          statusMessage: ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
        }),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.notPaged).toEqual([
      { teamName: "Night Shift", reason: "has no members" },
    ]);
    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["team Night Shift has no members"],
      movedOnTo: { order: 2, name: "second" },
    });
  });

  test("a level whose line is from before - the run waited it out - says nothing of moving on at once", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_2, ruleOrder: 2 }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          statusMessage: LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE,
        }),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.notPaged).toEqual([
      { rule: { order: 1, name: "fhirst" }, reason: "nobody to page" },
    ]);
    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["the rule has nobody to page"],
    });
  });

  test("a level whose next is gone from the policy: nothing is said of where the run went", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({ ruleId: RULE_1, ruleOrder: 1 }),
      rules: [rule(RULE_1, 1, "fhirst", 5)],
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(built.firstRuleThatReachedNobody).toEqual({
      rule: { order: 1, name: "fhirst" },
      reasons: ["the rule has nobody to page"],
    });
  });
});

/*
 * REGRESSION (UI review): a run's message read between a level's own line
 * ("..., so the policy moved on at once.") and the run's log naming the
 * next level - which is when the run's first post is often made - said
 * "fhirst (Level 1 of 3): if nobody acknowledges by 5:20 PM, second (Level
 * 2 of 3) is next." over "fhirst (Level 1 of 3): nobody to page, so second
 * (Level 2 of 3) was paged at once". The run is on its way to the next
 * level that moment: the message says that level, with that level's own
 * wait.
 */
describe("a run read while it is moving on from a level with nobody to page", () => {
  const RULE_STARTED_AT: Date = new Date("2026-10-08T17:15:00.000Z");

  function emptyFirstLevel(
    statusMessage: string,
  ): OnCallDutyPolicyExecutionLogTimeline {
    return step({
      status: SKIPPED,
      ruleId: RULE_1,
      statusMessage: statusMessage,
    });
  }

  test("the message is on the next level, waiting that level's own minutes from when it is paged", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_1,
        ruleOrder: 1,
        ruleStartedAt: RULE_STARTED_AT,
        executeNextInMinutes: 5,
        status: OnCallDutyPolicyStatus.Executing,
      }),
      timeline: [
        emptyFirstLevel(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE),
      ],
    });

    expect(built.currentRule).toEqual({ order: 2, name: "second" });
    expect(built.nextRule).toEqual({ order: 3, name: "third" });
    // Level 2's own wait, from when Level 2 is paged: no moment yet.
    expect(built.escalateAfterInMinutes).toBe(7);
    expect(built.nextStepAt).toBeUndefined();
    // The list still says why, and where the run went.
    expect(built.notPaged).toEqual([
      {
        rule: { order: 1, name: "fhirst" },
        reason: "nobody to page",
        movedOnTo: { order: 2, name: "second" },
      },
    ]);

    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(built);

    expect(markdown).toContain(
      "**second (Level 2 of 3)**: if nobody acknowledges within 7 minutes, third (Level 3 of 3) is next.",
    );
    expect(markdown).not.toContain("**fhirst (Level 1 of 3)**: if nobody");
    expect(markdown).toContain(
      "fhirst (Level 1 of 3): nobody to page, so second (Level 2 of 3) was paged at once",
    );
  });

  test("a level whose people could not be paged, with the next level already started under it: the same", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_1,
        ruleOrder: 1,
        ruleStartedAt: RULE_STARTED_AT,
        status: OnCallDutyPolicyStatus.Executing,
      }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_1,
          userId: NB_USER_2,
          userName: "NB User 2",
          statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
        }),
        emptyFirstLevel(ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.currentRule).toEqual({ order: 2, name: "second" });
    expect(built.nextRule).toEqual({ order: 3, name: "third" });
    expect(built.escalateAfterInMinutes).toBe(7);
    expect(built.nextStepAt).toBeUndefined();
  });

  test("once the run's log names the next level, its own moment is back", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_2,
        ruleOrder: 2,
        ruleStartedAt: RULE_STARTED_AT,
        executeNextInMinutes: 7,
        status: OnCallDutyPolicyStatus.Executing,
      }),
      timeline: [
        emptyFirstLevel(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE),
        movedOnTo(RULE_2),
      ],
    });

    expect(built.currentRule).toEqual({ order: 2, name: "second" });
    expect(built.nextStepAt).toEqual(new Date("2026-10-08T17:22:00.000Z"));
  });

  test("a level waited out before levels were passed at once is still the level the run is on", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_1,
        ruleOrder: 1,
        ruleStartedAt: RULE_STARTED_AT,
        executeNextInMinutes: 5,
        status: OnCallDutyPolicyStatus.Executing,
      }),
      timeline: [
        emptyFirstLevel(LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE),
      ],
    });

    expect(built.currentRule).toEqual({ order: 1, name: "fhirst" });
    expect(built.nextRule).toEqual({ order: 2, name: "second" });
    expect(built.nextStepAt).toEqual(new Date("2026-10-08T17:20:00.000Z"));
  });

  test("the last level has nowhere to move on to: the run stays on it until it repeats or ends", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_3,
        ruleOrder: 3,
        ruleStartedAt: RULE_STARTED_AT,
        status: OnCallDutyPolicyStatus.Executing,
      }),
      timeline: [
        step({
          status: SKIPPED,
          ruleId: RULE_3,
          statusMessage: ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(built.currentRule).toEqual({ order: 3, name: "third" });
    expect(built.nextRule).toBeUndefined();
  });

  test("a run that has ended is told as it ended, whatever its last level said", () => {
    const built: OnCallPolicyRun = build({
      log: executionLog({
        ruleId: RULE_1,
        ruleOrder: 1,
        ruleStartedAt: RULE_STARTED_AT,
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
      }),
      timeline: [
        emptyFirstLevel(ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE),
      ],
    });

    expect(built.currentRule).toEqual({ order: 1, name: "fhirst" });
  });
});
