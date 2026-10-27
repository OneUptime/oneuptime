import { describe, expect, test } from "@jest/globals";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallPolicyRunMessageView, {
  ON_CALL_RUN_ALARM_OUTCOME,
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunOutcome,
  OnCallPolicyRunPagedPerson,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
} from "../../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationStatus from "../../../../../Types/UserNotification/UserNotificationStatus";

/*
 * A PAGE ESCALATED, IN THE RUN'S SLACK AND MICROSOFT TEAMS MESSAGE.
 *
 * The run is one message, edited as it goes (OnCallPolicyRunMessage). A
 * person who escalated the page is on its list once, saying so - never as
 * "being paged now", and never again as "not paged" for every later rule
 * that passed them over. A rule only such people were on is no rule that
 * "reached nobody": the run moved past it at once, which is no alarm. And a
 * run everybody escalated ends loud: nobody can take the record. Runs from
 * before the action was renamed from "Pass it on" wrote their lines and
 * endings in those words; they read the same.
 */

const RULE_1: ObjectID = ObjectID.generate();
const RULE_2: ObjectID = ObjectID.generate();
const RULE_3: ObjectID = ObjectID.generate();
const ANA: ObjectID = ObjectID.generate();
const BOB: ObjectID = ObjectID.generate();

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
  model.name = `Level ${order}`;
  model.escalateAfterInMinutes = 30;
  return model;
}

const RULES: Array<OnCallDutyPolicyEscalationRule> = [
  rule(RULE_1, 1),
  rule(RULE_2, 2),
  rule(RULE_3, 3),
];

function step(options: {
  status: OnCallDutyExecutionLogTimelineStatus;
  ruleId: ObjectID;
  userId?: ObjectID;
  userName?: string;
  statusMessage?: string;
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

  if (options.statusMessage !== undefined) {
    model.statusMessage = options.statusMessage;
  }

  return model;
}

function emailDelivery(
  userId: ObjectID,
  status: UserNotificationStatus,
): UserOnCallLogTimeline {
  const model: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  model.userId = userId;
  model.status = status;
  model.userEmailId = ObjectID.generate();
  return model;
}

function runOn(
  ruleId: ObjectID,
  order: number,
  extra: { status?: OnCallDutyPolicyStatus } = {},
): OnCallDutyPolicyExecutionLog {
  const model: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();
  model.id = ObjectID.generate();
  model.lastExecutedEscalationRuleId = ruleId;
  model.lastExecutedEscalationRuleOrder = order;
  model.executeNextEscalationRuleInMinutes = 30;
  model.status = extra.status || OnCallDutyPolicyStatus.Executing;
  model.onCallPolicyExecutionRepeatCount = 1;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = "Payments";
  policy.repeatPolicyIfNoOneAcknowledges = false;
  model.onCallDutyPolicy = policy;

  return model;
}

function build(data: {
  log: OnCallDutyPolicyExecutionLog;
  timeline: Array<OnCallDutyPolicyExecutionLogTimeline>;
  deliveries?: Array<UserOnCallLogTimeline>;
}): OnCallPolicyRun {
  return OnCallPolicyRunMessage.buildRun({
    executionLog: data.log,
    rules: RULES,
    timeline: data.timeline,
    deliveries: data.deliveries || [],
    policyUrl: "https://oneuptime.test/policy",
    runUrl: "https://oneuptime.test/run",
    recordLabel: "Incident INC-8",
    recordUrl: "https://oneuptime.test/incident",
  });
}

function personNamed(
  run: OnCallPolicyRun,
  name: string,
): OnCallPolicyRunPagedPerson | undefined {
  return run.paged.find((person: OnCallPolicyRunPagedPerson) => {
    return person.name === name;
  });
}

// Ana, on Level 1, passed the page on; Bob, on Level 2, is paged now.
const ANA_PASSED_BOB_PAGED: Array<OnCallDutyPolicyExecutionLogTimeline> = [
  step({
    status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
    ruleId: RULE_1,
    userId: ANA,
    userName: "Ana Lopez",
    statusMessage: ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  }),
  step({
    status: OnCallDutyExecutionLogTimelineStatus.Executing,
    ruleId: RULE_2,
    userId: BOB,
    userName: "Bob Smith",
  }),
];

describe("a person who escalated the page", () => {
  test("is on the list once, as escalated - paged, and not being paged now", () => {
    const run: OnCallPolicyRun = build({
      log: runOn(RULE_2, 2),
      timeline: ANA_PASSED_BOB_PAGED,
    });

    expect(personNamed(run, "Ana Lopez")).toMatchObject({
      timesPaged: 1,
      isBeingPaged: false,
      acknowledged: false,
      passedOn: true,
    });
    expect(personNamed(run, "Bob Smith")).toMatchObject({
      isBeingPaged: true,
    });
    expect(personNamed(run, "Bob Smith")?.passedOn).toBeUndefined();
  });

  test("reads 'escalated' in the message, before how often and how", () => {
    const run: OnCallPolicyRun = build({
      log: runOn(RULE_2, 2),
      timeline: ANA_PASSED_BOB_PAGED,
      deliveries: [emailDelivery(ANA, UserNotificationStatus.PassedOn)],
    });

    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(run);

    expect(markdown).toContain(
      "**Ana Lopez**: escalated · paged once · by email",
    );
    expect(markdown).toContain("**Bob Smith**: being paged now");
    expect(markdown).not.toContain("Ana Lopez**: being paged now");
  });

  test("a page still going out to them when they escalated it is not 'being paged now'", () => {
    const run: OnCallPolicyRun = build({
      log: runOn(RULE_2, 2),
      timeline: [
        // Their Level 1 page, still sending, then passed on from Level 2.
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Executing,
          ruleId: RULE_1,
          userId: ANA,
          userName: "Ana Lopez",
        }),
        step({
          status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
          ruleId: RULE_2,
          userId: ANA,
          userName: "Ana Lopez",
        }),
      ],
    });

    expect(personNamed(run, "Ana Lopez")).toMatchObject({
      isBeingPaged: false,
      passedOn: true,
    });
  });

  test("who acknowledged after escalating it reads as acknowledged", () => {
    const acknowledged: OnCallDutyPolicyExecutionLogTimeline = step({
      status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      ruleId: RULE_1,
      userId: ANA,
      userName: "Ana Lopez",
    });

    const passedEarlier: OnCallDutyPolicyExecutionLogTimeline = step({
      status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
      ruleId: RULE_2,
      userId: ANA,
      userName: "Ana Lopez",
    });

    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      build({
        log: runOn(RULE_2, 2),
        timeline: [passedEarlier, acknowledged],
      }),
    );

    expect(markdown).toContain("**Ana Lopez**: acknowledged");
    expect(markdown).not.toContain("escalated ·");
    expect(markdown).not.toContain("passed it on");
  });

  test("passed over by a later rule, is not listed again as 'not paged'", () => {
    const run: OnCallPolicyRun = build({
      log: runOn(RULE_2, 2),
      timeline: [
        ...ANA_PASSED_BOB_PAGED,
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          ruleId: RULE_2,
          userId: ANA,
          userName: "Ana Lopez",
          statusMessage: ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(run.notPaged).toEqual([]);
    expect(OnCallPolicyRunMessageView.getMarkdown(run)).not.toContain(
      "not paged",
    );
  });

  test("nor when the later rule wrote its line before the rename, in the old words", () => {
    const run: OnCallPolicyRun = build({
      log: runOn(RULE_2, 2),
      timeline: [
        ...ANA_PASSED_BOB_PAGED,
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          ruleId: RULE_2,
          userId: ANA,
          userName: "Ana Lopez",
          statusMessage: LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
        }),
      ],
    });

    expect(run.notPaged).toEqual([]);
    expect(OnCallPolicyRunMessageView.getMarkdown(run)).not.toContain(
      "not paged",
    );
  });

  test("a rule only people who escalated it were on reached nobody it had to: no alarm", () => {
    // Level 2 named only Ana, who passed it on at Level 1: the run went on to Level 3.
    const run: OnCallPolicyRun = build({
      log: runOn(RULE_3, 3),
      timeline: [
        step({
          status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
          ruleId: RULE_1,
          userId: ANA,
          userName: "Ana Lopez",
        }),
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Skipped,
          ruleId: RULE_2,
          userId: ANA,
          userName: "Ana Lopez",
          statusMessage: ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
        }),
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Executing,
          ruleId: RULE_3,
          userId: BOB,
          userName: "Bob Smith",
        }),
      ],
    });

    expect(run.firstRuleThatReachedNobody).toBeUndefined();
    expect(OnCallPolicyRunMessageView.getAlarms(run)).toEqual([]);
  });

  test("the notification they escalated it from still says how they were reached", () => {
    const run: OnCallPolicyRun = build({
      log: runOn(RULE_2, 2),
      timeline: ANA_PASSED_BOB_PAGED,
      deliveries: [emailDelivery(ANA, UserNotificationStatus.PassedOn)],
    });

    expect(personNamed(run, "Ana Lopez")?.methods).toEqual(["email"]);
  });

  test("the progress line is the rule the run is on now", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      build({ log: runOn(RULE_2, 2), timeline: ANA_PASSED_BOB_PAGED }),
    );

    expect(markdown).toContain("**Level 2 of 3**");
  });
});

describe("a run everybody it paged escalated", () => {
  function endedRun(
    directPage?: OnCallPolicyRun["directPage"],
  ): OnCallPolicyRun {
    const run: OnCallPolicyRun = build({
      log: runOn(RULE_2, 2, { status: OnCallDutyPolicyStatus.Completed }),
      timeline: [
        step({
          status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
          ruleId: RULE_1,
          userId: ANA,
          userName: "Ana Lopez",
        }),
        step({
          status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
          ruleId: RULE_2,
          userId: BOB,
          userName: "Bob Smith",
        }),
      ],
    });

    run.outcome = OnCallPolicyRunOutcome.EverybodyPassedOn;

    if (directPage) {
      run.directPage = directPage;
      run.policyName = "";
    }

    return run;
  }

  test("is told apart from one nobody answered, by the message it ended with", async () => {
    const getOutcome: (data: unknown) => Promise<{
      outcome: OnCallPolicyRunOutcome;
    }> = (
      OnCallPolicyRunMessage as unknown as Record<
        string,
        (data: unknown) => Promise<{ outcome: OnCallPolicyRunOutcome }>
      >
    )["getOutcome"]!.bind(OnCallPolicyRunMessage);

    const ended: (message: string) => Promise<OnCallPolicyRunOutcome> = async (
      message: string,
    ): Promise<OnCallPolicyRunOutcome> => {
      const log: OnCallDutyPolicyExecutionLog = runOn(RULE_2, 2, {
        status: OnCallDutyPolicyStatus.Completed,
      });
      log.statusMessage = message;

      return (
        await getOutcome({
          executionLog: log,
          record: {
            isAcknowledged: async () => {
              return false;
            },
          },
        })
      ).outcome;
    };

    expect(await ended(ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE)).toBe(
      OnCallPolicyRunOutcome.EverybodyPassedOn,
    );
    // A run that ended before the rename, in the old words.
    expect(
      await ended(LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE),
    ).toBe(OnCallPolicyRunOutcome.EverybodyPassedOn);
    expect(
      await ended(ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE),
    ).toBe(OnCallPolicyRunOutcome.NobodyAcknowledged);
  });

  test("says nobody could take the record, at the top of its message", () => {
    expect(OnCallPolicyRunMessageView.getMarkdown(endedRun())).toContain(
      "⚠️ Nobody could take **[Incident INC-8](https://oneuptime.test/incident)**: everybody paged by **[Payments](https://oneuptime.test/policy)** escalated it",
    );
  });

  test("and in the line a notification shows of it", () => {
    expect(OnCallPolicyRunMessageView.getPlainText(endedRun())).toBe(
      "Nobody could take Incident INC-8: everybody paged by Payments escalated it",
    );
  });

  test("is loud: an alarm that somebody needs to take it, naming who escalated it", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(endedRun());

    expect(alarms).toEqual([
      {
        key: ON_CALL_RUN_ALARM_OUTCOME,
        markdown:
          "⚠️ Nobody can take **[Incident INC-8](https://oneuptime.test/incident)**: everybody paged by **[Payments](https://oneuptime.test/policy)** escalated it (Ana Lopez and Bob Smith). Someone needs to take it.",
        text: "Nobody can take Incident INC-8: someone needs to take it",
      },
    ]);
  });

  test("a direct page a person started names them where a policy is named", () => {
    const run: OnCallPolicyRun = endedRun({ startedByPersonName: "Simon Lee" });

    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Nobody could take Incident INC-8: everybody paged by Simon Lee escalated it",
    );
    expect(OnCallPolicyRunMessageView.getAlarms(run)[0]!.markdown).toContain(
      "everybody paged by **Simon Lee** escalated it (Ana Lopez and Bob Smith)",
    );
  });

  test("never says the old words, in the message, its line or its alarm", () => {
    for (const run of [
      endedRun(),
      endedRun({ startedByPersonName: "Simon Lee" }),
      endedRun({ startedByWorkflowName: "Page SRE" }),
    ]) {
      const said: string = [
        OnCallPolicyRunMessageView.getMarkdown(run),
        OnCallPolicyRunMessageView.getPlainText(run),
        ...OnCallPolicyRunMessageView.getAlarms(run).map(
          (alarm: OnCallPolicyRunAlarm): string => {
            return `${alarm.markdown} ${alarm.text}`;
          },
        ),
      ].join(" ");

      expect(said).not.toContain("passed it on");
      expect(said).not.toContain("passed the page on");
    }
  });

  test("a direct page a workflow started names the workflow", () => {
    const run: OnCallPolicyRun = endedRun({
      startedByWorkflowName: "Page SRE",
    });

    expect(OnCallPolicyRunMessageView.getPlainText(run)).toBe(
      "Nobody could take Incident INC-8: everybody paged by workflow Page SRE escalated it",
    );
  });
});
