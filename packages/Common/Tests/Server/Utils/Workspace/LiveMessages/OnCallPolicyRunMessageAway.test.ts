import { describe, expect, test } from "@jest/globals";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../../../../Models/DatabaseModels/User";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallPolicyRunMessageView, {
  ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunOutcome,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import WorkspaceMessageTime from "../../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import ObjectID from "../../../../../Types/ObjectID";
import { getAwayTimelineMessage } from "../../../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import OnCallDutyExecutionLogTimelineStatus from "../../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";

/*
 * SOMEBODY AWAY, IN THE ON-CALL RUN'S ONE SLACK / TEAMS MESSAGE.
 *
 * A rule that names somebody who is away with nobody named to cover (a user
 * override that skips them) does not page them: its timeline says so, and
 * until when (AwayTimelineMessage). The run's message says it in its one
 * list, where everybody else who was not paged is: "Alex Kim: not paged ·
 * away until <day and time>", the moment in each reader's own calendar and
 * clock (WorkspaceMessageTime.dateAndTime) - and, when that leaves a rule
 * with nobody paged, the alarm says why the same way.
 */

const RULE_1: ObjectID = ObjectID.generate();
const RULE_2: ObjectID = ObjectID.generate();
const ALEX: ObjectID = ObjectID.generate();
const SAM: ObjectID = ObjectID.generate();
const KIM: ObjectID = ObjectID.generate();

// Back at 12:00 UTC on Friday 6 March 2026.
const BACK: Date = new Date("2026-03-06T12:00:00.000Z");
const BACK_UNIX: number = BACK.getTime() / 1000;

function user(name: string): User {
  const model: User = new User();
  model.name = name as never;
  return model;
}

function rule(id: ObjectID, order: number): OnCallDutyPolicyEscalationRule {
  const model: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  model.id = id;
  model.order = order;
  model.escalateAfterInMinutes = 10;
  return model;
}

function step(data: {
  status: OnCallDutyExecutionLogTimelineStatus;
  ruleId: ObjectID;
  userId?: ObjectID | undefined;
  userName?: string | undefined;
  statusMessage?: string | undefined;
}): OnCallDutyPolicyExecutionLogTimeline {
  const model: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  model.id = ObjectID.generate();
  model.status = data.status;
  model.onCallDutyPolicyEscalationRuleId = data.ruleId;

  if (data.userId) {
    model.alertSentToUserId = data.userId;
    model.alertSentToUser = user(data.userName || "Someone");
  }

  if (data.statusMessage !== undefined) {
    model.statusMessage = data.statusMessage;
  }

  return model;
}

function awayStep(ruleId: ObjectID): OnCallDutyPolicyExecutionLogTimeline {
  return step({
    status: OnCallDutyExecutionLogTimelineStatus.Skipped,
    ruleId,
    userId: ALEX,
    userName: "Alex Kim",
    statusMessage: getAwayTimelineMessage(BACK),
  });
}

function build(
  timeline: Array<OnCallDutyPolicyExecutionLogTimeline>,
  onRule: ObjectID = RULE_1,
): OnCallPolicyRun {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.lastExecutedEscalationRuleId = onRule;
  log.onCallPolicyExecutionRepeatCount = 1;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = "Payments";
  policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = 0;
  log.onCallDutyPolicy = policy;

  return OnCallPolicyRunMessage.buildRun({
    executionLog: log,
    rules: [rule(RULE_1, 1), rule(RULE_2, 2)],
    timeline,
    deliveries: [],
    policyUrl: "https://oneuptime.test/policy",
    runUrl: "https://oneuptime.test/run",
    recordLabel: "Incident INC-8",
    recordUrl: "https://oneuptime.test/incident",
  });
}

const DATE_AND_TIME: string =
  "{{DATE(2026-03-06T12:00:00Z, SHORT)}} at {{TIME(2026-03-06T12:00:00Z)}}";

describe("buildRun: somebody away", () => {
  test("is not paged, away until when they are back", () => {
    const run: OnCallPolicyRun = build([
      awayStep(RULE_1),
      step({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        ruleId: RULE_1,
        userId: SAM,
        userName: "Sam Lee",
      }),
    ]);

    expect(run.notPaged).toEqual([
      { personName: "Alex Kim", reason: "away", awayUntil: BACK },
    ]);
    expect(
      run.paged.map((person: { name: string }) => {
        return person.name;
      }),
    ).toEqual(["Sam Lee"]);
  });

  test("is one line however many rules and repeats skipped them", () => {
    const run: OnCallPolicyRun = build(
      [awayStep(RULE_1), awayStep(RULE_2), awayStep(RULE_1)],
      RULE_2,
    );

    expect(run.notPaged).toHaveLength(1);
  });

  test("a rule that only named them reached nobody: the alarm says they are away, until when", () => {
    const run: OnCallPolicyRun = build(
      [
        awayStep(RULE_1),
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          ruleId: RULE_1,
          statusMessage: "Skipped because no users in this rule.",
        }),
        // The run has moved on: rule 1 is finished.
        step({
          status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
          ruleId: RULE_2,
          userId: KIM,
          userName: "Kim Ito",
        }),
      ],
      RULE_2,
    );

    expect(run.firstRuleThatReachedNobody?.rule.order).toBe(1);
    expect(
      run.firstRuleThatReachedNobody?.reasons.map(
        (reason: string | { toString: () => string }) => {
          return reason.toString();
        },
      ),
    ).toEqual([`Alex Kim: away until ${DATE_AND_TIME}`]);
  });

  test("other skips still read as they did", () => {
    const run: OnCallPolicyRun = build([
      step({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        ruleId: RULE_1,
        userId: KIM,
        userName: "Kim Ito",
        statusMessage: "Skipped because the user is on vacation.",
      }),
    ]);

    expect(run.notPaged).toEqual([
      { personName: "Kim Ito", reason: "the user is on vacation" },
    ]);
  });
});

describe("the message says it in each reader's own time", () => {
  const run: OnCallPolicyRun = {
    policyName: "Payments",
    policyUrl: "https://oneuptime.test/policy",
    runUrl: "https://oneuptime.test/run",
    recordLabel: "Incident INC-8",
    recordUrl: "https://oneuptime.test/incident",
    outcome: OnCallPolicyRunOutcome.Paging,
    ruleCount: 2,
    currentRule: { order: 1 },
    nextRule: { order: 2 },
    escalateAfterInMinutes: 10,
    repeatNumber: 0,
    repeatsAllowed: 0,
    paged: [
      {
        name: "Sam Lee",
        timesPaged: 1,
        isBeingPaged: false,
        acknowledged: false,
        methods: ["SMS"],
        coveringFor: [],
      },
    ],
    notPaged: [{ personName: "Alex Kim", reason: "away", awayUntil: BACK }],
  };

  test("Teams' Markdown: not paged, away until the day and time", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(run)).toContain(
      `- **Alex Kim**: not paged · away until ${DATE_AND_TIME}`,
    );
  });

  test("Slack's text: the same, as Slack dates", () => {
    expect(
      WorkspaceMessageTime.toSlack(OnCallPolicyRunMessageView.getMarkdown(run)),
    ).toContain(
      `**Alex Kim**: not paged · away until <!date^${BACK_UNIX}^{date_short_pretty}|2026-03-06> at <!date^${BACK_UNIX}^{time}|12:00 UTC>`,
    );
  });

  test("a notification log: the day and time in UTC", () => {
    expect(
      WorkspaceMessageTime.toPlainText(
        OnCallPolicyRunMessageView.getMarkdown(run),
      ),
    ).toContain("**Alex Kim**: not paged · away until 2026-03-06 at 12:00 UTC");
  });

  test("the alarm for a rule that reached nobody because they are away", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms({
        ...run,
        firstRuleThatReachedNobody: {
          rule: { order: 1 },
          reasons: [OnCallPolicyRunMessageView.getAwayReason("Alex Kim", BACK)],
        },
      });

    const alarm: OnCallPolicyRunAlarm | undefined = alarms.find(
      (candidate: OnCallPolicyRunAlarm) => {
        return candidate.key === ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE;
      },
    );

    expect(alarm?.markdown).toContain(
      `paged nobody at Level 1 of 2 for **[Incident INC-8](https://oneuptime.test/incident)** (Alex Kim: away until ${DATE_AND_TIME})`,
    );
    // The notification's one line names no moment it could not show.
    expect(alarm?.text).toBe(
      "Payments paged nobody at Level 1 of 2 for Incident INC-8",
    );
  });

  test("names are text: a name that looks like Markdown stays text next to the time", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown({
      ...run,
      notPaged: [
        { personName: "*Alex* [x](y)", reason: "away", awayUntil: BACK },
      ],
    });

    expect(markdown).not.toContain("[x](y)");
    expect(markdown).toContain(`away until ${DATE_AND_TIME}`);
  });
});
