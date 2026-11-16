import { describe, expect, test } from "@jest/globals";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import User from "../../../../../Models/DatabaseModels/User";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallPolicyRunMessageView, {
  OnCallPolicyRun,
  OnCallPolicyRunAlarm,
  OnCallPolicyRunPagedPerson,
} from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import ObjectID from "../../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  getOnCallPageMergeTakenOverMessage,
  getOnCallPageMergedMessage,
} from "../../../../../Types/OnCallDutyPolicy/OnCallPageMerge";

/*
 * A PERSON ANOTHER POLICY IS PAGING ALREADY, IN THE RUN'S SLACK AND
 * MICROSOFT TEAMS MESSAGE (issue #7837, OnCallPageMerge).
 *
 * Billing's level reached Ana while Payments was paging her about the same
 * incident: Billing's page of her was merged into Payments', and sent
 * nothing. Billing's message lists her once, saying who is paging her -
 * never "being paged now", which would read as Billing paging her too, and
 * never nothing. She was reached, so her level raises no alarm that it
 * reached nobody.
 */

const RULE_1: ObjectID = ObjectID.generate();
const RULE_2: ObjectID = ObjectID.generate();
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

function step(options: {
  status: OnCallDutyExecutionLogTimelineStatus;
  userId: ObjectID;
  userName: string;
  statusMessage?: string;
  isAcknowledged?: boolean;
}): OnCallDutyPolicyExecutionLogTimeline {
  const model: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  model.id = ObjectID.generate();
  model.status = options.status;
  model.onCallDutyPolicyEscalationRuleId = RULE_1;
  model.alertSentToUserId = options.userId;
  model.alertSentToUser = user(options.userName);

  if (options.statusMessage !== undefined) {
    model.statusMessage = options.statusMessage;
  }

  if (options.isAcknowledged) {
    model.isAcknowledged = true;
  }

  return model;
}

function billingRun(): OnCallDutyPolicyExecutionLog {
  const model: OnCallDutyPolicyExecutionLog =
    new OnCallDutyPolicyExecutionLog();
  model.id = ObjectID.generate();
  model.lastExecutedEscalationRuleId = RULE_1;
  model.lastExecutedEscalationRuleOrder = 1;
  model.executeNextEscalationRuleInMinutes = 30;
  model.status = OnCallDutyPolicyStatus.Executing;
  model.onCallPolicyExecutionRepeatCount = 1;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = "Billing";
  policy.repeatPolicyIfNoOneAcknowledges = false;
  model.onCallDutyPolicy = policy;

  return model;
}

function build(
  timeline: Array<OnCallDutyPolicyExecutionLogTimeline>,
): OnCallPolicyRun {
  return OnCallPolicyRunMessage.buildRun({
    executionLog: billingRun(),
    rules: [rule(RULE_1, 1), rule(RULE_2, 2)],
    timeline: timeline,
    deliveries: [],
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

const ANA_ALREADY_PAGED: OnCallDutyPolicyExecutionLogTimeline = step({
  status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
  userId: ANA,
  userName: "Ana Lopez",
  statusMessage: getOnCallPageMergedMessage({ policyName: "Payments" }),
});

describe("somebody another policy is paging already", () => {
  test("is on the list once, already paged by that policy: not paged by this run, and not being paged by it", () => {
    const run: OnCallPolicyRun = build([ANA_ALREADY_PAGED]);

    expect(personNamed(run, "Ana Lopez")).toMatchObject({
      timesPaged: 0,
      isBeingPaged: false,
      acknowledged: false,
      alreadyPagedBy: ["Payments"],
    });
    expect(run.notPaged).toEqual([]);
  });

  test("reads 'already paged by Payments' in the message, never 'being paged now'", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      build([ANA_ALREADY_PAGED]),
    );

    expect(markdown).toContain("**Ana Lopez**: already paged by **Payments**");
    expect(markdown).not.toContain("Ana Lopez**: being paged now");
    expect(markdown).not.toContain("not paged");
  });

  test("beside somebody this run is paging itself", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      build([
        ANA_ALREADY_PAGED,
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Executing,
          userId: BOB,
          userName: "Bob Smith",
        }),
      ]),
    );

    expect(markdown).toContain("**Ana Lopez**: already paged by **Payments**");
    expect(markdown).toContain("**Bob Smith**: being paged now");
  });

  test("a level only they were on reached somebody: no alarm that it reached nobody", () => {
    const alarms: Array<OnCallPolicyRunAlarm> =
      OnCallPolicyRunMessageView.getAlarms(build([ANA_ALREADY_PAGED]));

    expect(alarms).toEqual([]);
  });

  test("a line naming no policy says another on-call policy", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      build([
        step({
          status: OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
          userId: ANA,
          userName: "Ana Lopez",
          statusMessage: getOnCallPageMergedMessage({ policyName: null }),
        }),
      ]),
    );

    expect(markdown).toContain(
      "**Ana Lopez**: already paged by **another on-call policy**",
    );
  });

  test("once they answered, they read as acknowledged, not as already paged", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      build([
        step({
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          userId: ANA,
          userName: "Ana Lopez",
          isAcknowledged: true,
        }),
      ]),
    );

    expect(markdown).toContain("**Ana Lopez**: acknowledged");
    expect(markdown).not.toContain("already paged");
  });

  test("once this run took the page over, they are being paged by it", () => {
    const markdown: string = OnCallPolicyRunMessageView.getMarkdown(
      build([
        step({
          status: OnCallDutyExecutionLogTimelineStatus.Executing,
          userId: ANA,
          userName: "Ana Lopez",
          statusMessage: getOnCallPageMergeTakenOverMessage({
            policyName: "Payments",
          }),
        }),
      ]),
    );

    expect(markdown).toContain("**Ana Lopez**: being paged now");
    expect(markdown).not.toContain("already paged");
  });
});
