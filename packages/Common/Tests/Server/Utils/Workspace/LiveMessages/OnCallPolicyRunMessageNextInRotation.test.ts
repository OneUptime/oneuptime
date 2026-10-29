import { describe, expect, test } from "@jest/globals";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallPolicyRunMessageView, {
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import ObjectID from "../../../../../Types/ObjectID";
import { NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE } from "../../../../../Types/OnCallDutyPolicy/NextInRotation";
import { ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE } from "../../../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import OnCallDutyExecutionLogTimelineStatus from "../../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import UserNotificationStatus from "../../../../../Types/UserNotification/UserNotificationStatus";

/*
 * THE RUN'S SLACK / MICROSOFT TEAMS MESSAGE SAYS WHO THE BACKUP WAS, AND WHY.
 *
 * The recommended ladder pages an on-call schedule at Level 1 and the next
 * person in its rotation at Level 2 (the backup from the same rotation),
 * then a team. The run's one message names everybody it paged; the backup's
 * line says why they were paged - "(next in the Payments primary
 * rotation)" - as a person covering for somebody says whom. A Level 2 that
 * found nobody next says so in its own words, and raises the run's alarm
 * about a rule that reached nobody, with that reason.
 */

const LEVEL_1: ObjectID = ObjectID.generate();
const LEVEL_2: ObjectID = ObjectID.generate();
const LEVEL_3: ObjectID = ObjectID.generate();
const ALEX: ObjectID = ObjectID.generate();
const SAM: ObjectID = ObjectID.generate();
const PAYMENTS_PRIMARY: ObjectID = ObjectID.generate();
const DATABASE: ObjectID = ObjectID.generate();

const SENT: OnCallDutyExecutionLogTimelineStatus =
  OnCallDutyExecutionLogTimelineStatus.NotificationSent;
const SKIPPED: OnCallDutyExecutionLogTimelineStatus =
  OnCallDutyExecutionLogTimelineStatus.Skipped;

function rule(
  id: ObjectID,
  order: number,
  name: string,
): OnCallDutyPolicyEscalationRule {
  const model: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  model.id = id;
  model.order = order;
  model.name = name;
  model.escalateAfterInMinutes = 30;
  return model;
}

const RULES: Array<OnCallDutyPolicyEscalationRule> = [
  rule(LEVEL_1, 1, "Level 1"),
  rule(LEVEL_2, 2, "Level 2"),
  rule(LEVEL_3, 3, "Platform"),
];

function user(name: string): User {
  const model: User = new User();
  model.name = name as never;
  return model;
}

function step(options: {
  status: OnCallDutyExecutionLogTimelineStatus;
  ruleId: ObjectID;
  userId?: ObjectID | undefined;
  userName?: string | undefined;
  scheduleId?: ObjectID | undefined;
  scheduleName?: string | undefined;
  isNextInRotation?: boolean | undefined;
  statusMessage?: string | undefined;
}): OnCallDutyPolicyExecutionLogTimeline {
  const model: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  model.id = ObjectID.generate();
  model.status = options.status;
  model.onCallDutyPolicyEscalationRuleId = options.ruleId;

  if (options.userId) {
    model.alertSentToUserId = options.userId;
    model.alertSentToUser = user(options.userName || "");
  }

  if (options.scheduleId) {
    model.onCallDutyScheduleId = options.scheduleId;
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule.name = options.scheduleName || "";
    model.onCallDutySchedule = schedule;
  }

  if (options.isNextInRotation) {
    model.isNextInRotation = true;
  }

  if (options.statusMessage !== undefined) {
    model.statusMessage = options.statusMessage;
  }

  return model;
}

function delivery(
  userId: ObjectID,
  method: keyof UserOnCallLogTimeline,
): UserOnCallLogTimeline {
  const model: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  model.userId = userId;
  model.status = UserNotificationStatus.Sent;
  (model as unknown as Record<string, unknown>)[method] = ObjectID.generate();
  return model;
}

// A run on the given rule, its steps so far.
function build(data: {
  onRule: ObjectID;
  order: number;
  timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
  deliveries?: Array<UserOnCallLogTimeline> | undefined;
}): OnCallPolicyRun {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.lastExecutedEscalationRuleId = data.onRule;
  log.lastExecutedEscalationRuleOrder = data.order;
  log.executeNextEscalationRuleInMinutes = 30;
  log.onCallPolicyExecutionRepeatCount = 1;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = "Payments";
  policy.repeatPolicyIfNoOneAcknowledges = false;
  policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = 0;
  log.onCallDutyPolicy = policy;

  return OnCallPolicyRunMessage.buildRun({
    executionLog: log,
    rules: RULES,
    timeline: data.timeline,
    deliveries: data.deliveries || [],
    policyUrl: "https://oneuptime.test/policy",
    runUrl: "https://oneuptime.test/run",
    recordLabel: "Incident INC-8",
    recordUrl: "https://oneuptime.test/incident",
  });
}

const ALEX_ON_CALL: OnCallDutyPolicyExecutionLogTimeline = step({
  status: SENT,
  ruleId: LEVEL_1,
  userId: ALEX,
  userName: "Alex Kim",
  scheduleId: PAYMENTS_PRIMARY,
  scheduleName: "Payments primary",
  statusMessage: "Alert Sent",
});

const SAM_NEXT: OnCallDutyPolicyExecutionLogTimeline = step({
  status: SENT,
  ruleId: LEVEL_2,
  userId: SAM,
  userName: "Sam Lee",
  scheduleId: PAYMENTS_PRIMARY,
  scheduleName: "Payments primary",
  isNextInRotation: true,
  statusMessage: "Alert Sent",
});

const NOBODY_NEXT: OnCallDutyPolicyExecutionLogTimeline = step({
  status: SKIPPED,
  ruleId: LEVEL_2,
  scheduleId: PAYMENTS_PRIMARY,
  scheduleName: "Payments primary",
  isNextInRotation: true,
  statusMessage: NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE,
});

/*
 * A level's own line: it paged nobody, and the run moved on from it at
 * once (OnCallEmptyLevel).
 */
const PAGED_NOBODY_AT: (
  ruleId: ObjectID,
) => OnCallDutyPolicyExecutionLogTimeline = (
  ruleId: ObjectID,
): OnCallDutyPolicyExecutionLogTimeline => {
  return step({
    status: SKIPPED,
    ruleId: ruleId,
    statusMessage: ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
  });
};

describe("the backup paged at Level 2", () => {
  const run: OnCallPolicyRun = build({
    onRule: LEVEL_2,
    order: 2,
    timeline: [ALEX_ON_CALL, SAM_NEXT],
    deliveries: [
      delivery(ALEX, "userSmsId"),
      delivery(SAM, "userSmsId"),
      delivery(SAM, "userEmailId"),
    ],
  });

  test("each person once, the backup with the rotation they were paged from", () => {
    expect(run.paged).toEqual([
      {
        name: "Alex Kim",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["SMS"],
        coveringFor: [],
      },
      {
        name: "Sam Lee",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["SMS", "email"],
        coveringFor: [],
        nextInRotationOf: ["Payments primary"],
      },
    ]);
    expect(run.notPaged).toEqual([]);
    expect(run.firstRuleThatReachedNobody).toBeUndefined();
  });

  test("the message says why Sam was paged: next in the Payments primary rotation", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run);

    expect(markdown).toContain("**Alex Kim**: paged once · by SMS");
    expect(markdown).toContain(
      "**Sam Lee** (next in the Payments primary rotation): paged once · by SMS and email",
    );
    // Where the run is, and what comes next.
    expect(markdown).toContain("**Level 2 of 3**: if nobody acknowledges");
    expect(markdown).toContain("Platform (Level 3 of 3) is next.");
  });

  test("its one-line notification is unchanged", () => {
    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Payments is paging for Incident INC-8",
    );
  });

  test("no alarm: somebody was paged at every rule so far", () => {
    expect(OnCallPolicyRunMessageView.getAlarms(run)).toEqual([]);
  });

  test("paged as the backup in two rotations: both are named, each once", () => {
    const twice: OnCallPolicyRun = build({
      onRule: LEVEL_2,
      order: 2,
      timeline: [
        SAM_NEXT,
        step({
          status: SENT,
          ruleId: LEVEL_2,
          userId: SAM,
          userName: "Sam Lee",
          scheduleId: DATABASE,
          scheduleName: "Database",
          isNextInRotation: true,
        }),
        SAM_NEXT,
      ],
    });

    expect(twice.paged[0]!.nextInRotationOf).toEqual([
      "Payments primary",
      "Database",
    ]);
    expect(OnCallPolicyRunMessageView.getMarkdown(twice)).toContain(
      "**Sam Lee** (next in the Payments primary rotation; next in the Database rotation): paged 3 times",
    );
  });

  test("a schedule's name is text in the message: Markdown in it formats nothing", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      build({
        onRule: LEVEL_2,
        order: 2,
        timeline: [
          step({
            status: SENT,
            ruleId: LEVEL_2,
            userId: SAM,
            userName: "Sam Lee",
            scheduleId: PAYMENTS_PRIMARY,
            scheduleName: "*Primary* <!channel>",
            isNextInRotation: true,
          }),
        ],
      }),
    );

    // The emphasis is escaped, and the mention cannot reach anybody.
    expect(markdown).toContain("**Sam Lee** (next in the \\*Primary\\* ");
    expect(markdown).toContain(" rotation): paged once");
    expect(markdown).not.toContain("<!channel>");
  });
});

describe("Level 2 found nobody next in the rotation", () => {
  const run: OnCallPolicyRun = build({
    onRule: LEVEL_2,
    order: 2,
    timeline: [ALEX_ON_CALL, NOBODY_NEXT, PAGED_NOBODY_AT(LEVEL_2)],
    deliveries: [delivery(ALEX, "userSmsId")],
  });

  test("the message says nobody was next - not that nobody was on call", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run);

    expect(markdown).toContain(
      "Nobody was next in the **Payments primary** rotation",
    );
    expect(markdown).not.toContain("Nobody was on call");
    expect(run.notPaged).toEqual([
      {
        scheduleName: "Payments primary",
        nobodyNextInRotation: true,
        reason: "nobody was next in the rotation",
      },
    ]);
  });

  test("the rule is not tried again: the run moves on from it at once", () => {
    expect(run).not.toHaveProperty("retryingCurrentRule");
    expect(OnCallPolicyRunMessageView.getMarkdown(run)).not.toContain(
      "trying again",
    );
  });

  test("the alarm about a rule that reached nobody says why, and that the next level was paged at once", () => {
    expect(run.firstRuleThatReachedNobody?.rule).toEqual({
      order: 2,
      name: "Level 2",
    });

    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(run);

    expect(alarms).toHaveLength(1);
    expect(alarms[0]!.markdown).toBe(
      "⚠️ **[Payments](https://oneuptime.test/policy)** paged nobody at Level 2 of 3 for **[Incident INC-8](https://oneuptime.test/incident)** (nobody was next in the Payments primary rotation), so Platform (Level 3 of 3) was paged at once. Fix the policy so this level pages someone.",
    );
    expect(alarms[0]!.text).toBe(
      "Payments paged nobody at Level 2 of 3 for Incident INC-8, so Platform (Level 3 of 3) was paged at once",
    );
  });

  test("once somebody acknowledged, the alarm is not raised", () => {
    const handled: OnCallPolicyRun = {
      ...run,
      outcome: OnCallPolicyRunOutcome.Acknowledged,
      acknowledgedByName: "Alex Kim",
    };

    expect(
      OnCallPolicyRunMessageView.getAlarms(handled).map(
        (alarm: OnCallPolicyRunAlarm): string => {
          return alarm.key;
        },
      ),
    ).toEqual([]);
  });

  test("a schedule with nobody on call at all, at another level, is its own line", () => {
    const both: OnCallPolicyRun = build({
      onRule: LEVEL_2,
      order: 2,
      timeline: [
        step({
          status: SKIPPED,
          ruleId: LEVEL_1,
          scheduleId: DATABASE,
          scheduleName: "Database",
          statusMessage:
            "Skipped because no active users are found in this schedule.",
        }),
        PAGED_NOBODY_AT(LEVEL_1),
        NOBODY_NEXT,
        PAGED_NOBODY_AT(LEVEL_2),
      ],
    });

    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(both);

    expect(markdown).toContain("Nobody was on call in schedule **Database**");
    expect(markdown).toContain(
      "Nobody was next in the **Payments primary** rotation",
    );
  });
});

describe("the reasons, as the view words them", () => {
  test("next in the rotation, and nobody next", () => {
    expect(
      OnCallPolicyRunMessageView.getNextInRotationReason(
        "Payments primary",
      ).toString(),
    ).toBe("next in the Payments primary rotation");
    expect(
      OnCallPolicyRunMessageView.getNobodyNextInRotationReason(
        "Payments primary",
      ).toString(),
    ).toBe("nobody was next in the Payments primary rotation");
  });

  test("a person covering for somebody and paged as next says both", () => {
    const run: OnCallPolicyRun = build({
      onRule: LEVEL_2,
      order: 2,
      timeline: [SAM_NEXT],
    });

    run.paged[0]!.coveringFor = ["Alex Kim"];

    expect(OnCallPolicyRunMessageView.getMarkdown(run)).toContain(
      "**Sam Lee** (covering for Alex Kim; next in the Payments primary rotation): paged once",
    );
  });
});
