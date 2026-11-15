import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallHandoffPolicies, {
  ON_CALL_HANDOFF_RULE_WITHOUT_NAME,
  ON_CALL_HANDOFF_RULE_WITHOUT_ORDER,
  OnCallHandoffPolicy,
  OnCallHandoffRule,
} from "../../../../Server/Utils/OnCall/OnCallHandoffPolicies";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import { describe, expect, test } from "@jest/globals";

/*
 * THE POLICIES A SCHEDULE'S HAND-OFF TELLS ITS PEOPLE ABOUT (issue #7969).
 *
 * A hand-off tells whoever is no longer on call, on call now and next
 * once for each policy that pages the schedule - not once for each of its
 * rules - and keeps each rule's on-call time logs. OnCallHandoffPolicies
 * reads the schedule's rows into those policies, each with its rules in
 * their order, and says what the emails say of the rules.
 * OnCallHandoffOncePerPolicy.test.ts drives the hand-off itself.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "79690000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "79690000-0000-4000-8000-000000000002",
);
const PAYMENTS: ObjectID = new ObjectID("79690000-0000-4000-8000-000000000003");
const CHECKOUT: ObjectID = new ObjectID("79690000-0000-4000-8000-000000000004");

function row(data: {
  policyId?: ObjectID | null;
  policyName?: string;
  ruleId?: ObjectID | null;
  ruleName?: string | undefined;
  order?: number | undefined;
  pageNextInRotation?: boolean;
  withSchedule?: boolean;
  projectId?: ObjectID | null;
}): OnCallDutyPolicyEscalationRuleSchedule {
  const attachment: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  attachment.id = ObjectID.generate();

  if (data.projectId !== null) {
    attachment.projectId = data.projectId || PROJECT_ID;
  }

  attachment.pageNextInRotation = Boolean(data.pageNextInRotation);

  if (data.policyId !== null) {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = data.policyId || PAYMENTS;
    policy.name = data.policyName ?? "Payments";
    attachment.onCallDutyPolicy = policy;
  }

  if (data.ruleId !== null) {
    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule.id = data.ruleId || ObjectID.generate();

    if (data.ruleName !== undefined) {
      rule.name = data.ruleName;
    }

    if (data.order !== undefined) {
      rule.order = data.order;
    }

    attachment.onCallDutyPolicyEscalationRule = rule;
  }

  if (data.withSchedule !== false) {
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule.id = SCHEDULE_ID;
    schedule.name = "Primary";
    schedule.timezone = Timezone.EuropeLondon;
    attachment.onCallDutyPolicySchedule = schedule;
  }

  return attachment;
}

function names(policy: OnCallHandoffPolicy): Array<string> {
  return policy.rules.map((rule: OnCallHandoffRule): string => {
    return rule.name;
  });
}

describe("which policies a hand-off tells people about", () => {
  test("one policy for all of its rules that page the schedule, not one for each rule", () => {
    const policies: Array<OnCallHandoffPolicy> = OnCallHandoffPolicies.group([
      row({ ruleName: "First line", order: 1 }),
      row({ ruleName: "Escalate", order: 2 }),
    ]);

    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      projectId: PROJECT_ID,
      policyId: PAYMENTS,
      policyName: "Payments",
      scheduleName: "Primary",
      scheduleTimezone: Timezone.EuropeLondon,
    });
    expect(names(policies[0]!)).toEqual(["First line", "Escalate"]);
  });

  test("each policy that pages the schedule is a policy of its own, in the order the rows name them first", () => {
    const policies: Array<OnCallHandoffPolicy> = OnCallHandoffPolicies.group([
      row({
        policyId: CHECKOUT,
        policyName: "Checkout",
        ruleName: "Only",
        order: 1,
      }),
      row({ ruleName: "First line", order: 1 }),
      row({
        policyId: CHECKOUT,
        policyName: "Checkout",
        ruleName: "Later",
        order: 4,
      }),
      row({ ruleName: "Escalate", order: 2 }),
    ]);

    expect(
      policies.map((policy: OnCallHandoffPolicy): string => {
        return policy.policyName;
      }),
    ).toEqual(["Checkout", "Payments"]);
    expect(names(policies[0]!)).toEqual(["Only", "Later"]);
    expect(names(policies[1]!)).toEqual(["First line", "Escalate"]);
  });

  test("a policy's rules are in its order, whatever order the rows come in", () => {
    const policies: Array<OnCallHandoffPolicy> = OnCallHandoffPolicies.group([
      row({ ruleName: "Level 3", order: 3 }),
      row({ ruleName: "Level 1", order: 1 }),
      row({ ruleName: "Level 2", order: 2 }),
    ]);

    expect(names(policies[0]!)).toEqual(["Level 1", "Level 2", "Level 3"]);
  });

  test("a rule with no order comes after the rest, and rules of one order keep the rows' order", () => {
    const policies: Array<OnCallHandoffPolicy> = OnCallHandoffPolicies.group([
      row({ ruleName: "No order" }),
      row({ ruleName: "Second, first row", order: 2 }),
      row({ ruleName: "First", order: 1 }),
      row({ ruleName: "Second, second row", order: 2 }),
    ]);

    expect(names(policies[0]!)).toEqual([
      "First",
      "Second, first row",
      "Second, second row",
      "No order",
    ]);
    expect(policies[0]!.rules[3]!.order).toBeNull();
  });

  test("the same rule attached twice is one rule", () => {
    const ruleId: ObjectID = ObjectID.generate();

    const policies: Array<OnCallHandoffPolicy> = OnCallHandoffPolicies.group([
      row({ ruleId: ruleId, ruleName: "First line", order: 1 }),
      row({ ruleId: ruleId, ruleName: "First line", order: 1 }),
    ]);

    expect(policies[0]!.rules).toEqual([
      { id: ruleId, name: "First line", order: 1 },
    ]);
  });

  test("a rule that pages the next person in the rotation tells nobody at a hand-off: it is left out", () => {
    const policies: Array<OnCallHandoffPolicy> = OnCallHandoffPolicies.group([
      row({ ruleName: "Warm standby", order: 1, pageNextInRotation: true }),
      row({ ruleName: "First line", order: 2 }),
    ]);

    expect(names(policies[0]!)).toEqual(["First line"]);
  });

  test("a policy whose only rule pages the next person in the rotation is no policy to tell people about", () => {
    expect(
      OnCallHandoffPolicies.group([
        row({ ruleName: "Warm standby", order: 1, pageNextInRotation: true }),
      ]),
    ).toEqual([]);
  });

  test("a row that misses its policy, rule, schedule or project is left out, and fails nothing", () => {
    expect(
      OnCallHandoffPolicies.group([
        row({ policyId: null, ruleName: "No policy", order: 1 }),
        row({ ruleId: null }),
        row({ ruleName: "No schedule", order: 1, withSchedule: false }),
        row({ ruleName: "No project", order: 1, projectId: null }),
      ]),
    ).toEqual([]);

    expect(OnCallHandoffPolicies.group([])).toEqual([]);
  });

  test("the first rule is the one of the lowest order", () => {
    const level1: ObjectID = ObjectID.generate();

    const policies: Array<OnCallHandoffPolicy> = OnCallHandoffPolicies.group([
      row({ ruleName: "Level 3", order: 3 }),
      row({ ruleId: level1, ruleName: "Level 1", order: 1 }),
    ]);

    expect(OnCallHandoffPolicies.getFirstRule(policies[0]!).id.toString()).toBe(
      level1.toString(),
    );
  });
});

describe("what the hand-off emails say of a policy's rules", () => {
  function rule(name: string, order: number | null): OnCallHandoffRule {
    return { id: ObjectID.generate(), name: name, order: order };
  }

  test("one rule: its name and order, as the emails always said", () => {
    expect(OnCallHandoffPolicies.getRuleVars([rule("First line", 1)])).toEqual({
      escalationRuleName: "First line",
      escalationRuleOrder: "1",
    });
  });

  test("two rules: both, joined, and titled as several", () => {
    expect(
      OnCallHandoffPolicies.getRuleVars([
        rule("Level 1", 1),
        rule("Level 3", 3),
      ]),
    ).toEqual({
      escalationRuleName: "Level 1 and Level 3",
      escalationRuleOrder: "1 and 3",
      hasSeveralEscalationRules: "true",
    });
  });

  test("three rules: a list", () => {
    expect(
      OnCallHandoffPolicies.getRuleVars([
        rule("First line", 1),
        rule("Escalate", 2),
        rule("Managers", 4),
      ]),
    ).toEqual({
      escalationRuleName: "First line, Escalate and Managers",
      escalationRuleOrder: "1, 2 and 4",
      hasSeveralEscalationRules: "true",
    });
  });

  test("a rule with no name or no order reads as the emails always read it", () => {
    expect(OnCallHandoffPolicies.getRuleVars([rule("  ", null)])).toEqual({
      escalationRuleName: ON_CALL_HANDOFF_RULE_WITHOUT_NAME,
      escalationRuleOrder: ON_CALL_HANDOFF_RULE_WITHOUT_ORDER,
    });
    expect(ON_CALL_HANDOFF_RULE_WITHOUT_NAME).toBe("No name provided");
    expect(ON_CALL_HANDOFF_RULE_WITHOUT_ORDER).toBe("-");
  });

  test("an order of 0 is an order", () => {
    expect(
      OnCallHandoffPolicies.getRuleVars([rule("Zero", 0)]).escalationRuleOrder,
    ).toBe("0");
  });

  test("the vars of a grouped policy are those of its rules, in order", () => {
    const policies: Array<OnCallHandoffPolicy> = OnCallHandoffPolicies.group([
      row({ ruleName: "Escalate", order: 2 }),
      row({ ruleName: "First line", order: 1 }),
    ]);

    expect(OnCallHandoffPolicies.getRuleVars(policies[0]!.rules)).toEqual({
      escalationRuleName: "First line and Escalate",
      escalationRuleOrder: "1 and 2",
      hasSeveralEscalationRules: "true",
    });
  });
});
