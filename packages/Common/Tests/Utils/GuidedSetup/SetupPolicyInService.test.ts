import { describe, expect, test } from "@jest/globals";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallRuleWithPolicies,
  SetupPolicyGone,
  WhoIsToldMode,
  countRulesRunningPolicyInService,
  doesRuleRunPolicyInService,
  getSetupPolicyGone,
  getWhoIsToldMode,
  isSetupPolicyInService,
} from "../../../Utils/GuidedSetup/OnCallPolicyRecords";

/*
 * WHETHER A GUIDED SETUP'S POLICY, AND A PROJECT'S ON-CALL RULES, STILL
 * PAGE ANYONE. An archived on-call policy is still there, but pages no
 * one: incidents and alerts that use it skip it. So the run's policy read
 * back archived no longer serves the run (#8432), and an on-call rule
 * whose only policies are archived does not count as the project paging
 * people already (#8433).
 */

const policy: (isArchived?: boolean | null) => OnCallDutyPolicy = (
  isArchived?: boolean | null,
): OnCallDutyPolicy => {
  const record: OnCallDutyPolicy = new OnCallDutyPolicy();
  record._id = ObjectID.generate().toString();

  if (isArchived !== undefined) {
    (record as unknown as { isArchived: boolean | null }).isArchived =
      isArchived;
  }

  return record;
};

const incidentRule: (
  policies: Array<OnCallDutyPolicy> | undefined,
) => IncidentOnCallRule = (
  policies: Array<OnCallDutyPolicy> | undefined,
): IncidentOnCallRule => {
  const rule: IncidentOnCallRule = new IncidentOnCallRule();
  rule._id = ObjectID.generate().toString();

  if (policies) {
    rule.onCallDutyPolicies = policies;
  }

  return rule;
};

describe("the run's policy, as just read (#8432)", () => {
  test("gone - read as null - is deleted", () => {
    expect(getSetupPolicyGone(null)).toBe(SetupPolicyGone.Deleted);
    expect(getSetupPolicyGone(undefined)).toBe(SetupPolicyGone.Deleted);
    expect(isSetupPolicyInService(null)).toBe(false);
  });

  test("archived since is archived: there, but paging no one", () => {
    expect(getSetupPolicyGone({ isArchived: true })).toBe(
      SetupPolicyGone.Archived,
    );
    expect(isSetupPolicyInService({ isArchived: true })).toBe(false);
  });

  test("in service is no reason at all", () => {
    expect(getSetupPolicyGone({ isArchived: false })).toBeNull();
    expect(isSetupPolicyInService({ isArchived: false })).toBe(true);
  });

  test("a record read without its archived flag is in service, as a record made by hand is", () => {
    expect(getSetupPolicyGone({})).toBeNull();
    expect(getSetupPolicyGone({ isArchived: null })).toBeNull();
    expect(getSetupPolicyGone({ isArchived: undefined })).toBeNull();
    expect(isSetupPolicyInService({ id: "p", name: "Ops" })).toBe(true);
  });

  test("the two reasons are told apart, each its own", () => {
    expect(SetupPolicyGone.Deleted).not.toBe(SetupPolicyGone.Archived);
    expect(Object.values(SetupPolicyGone).sort()).toEqual([
      "archived",
      "deleted",
    ]);
  });

  test("the guard narrows: a policy in service is the record it was handed", () => {
    const read: { id: string; isArchived?: boolean } | null = {
      id: "p",
      isArchived: false,
    };

    if (isSetupPolicyInService(read)) {
      // Typed as the record, not as possibly null.
      expect(read.id).toBe("p");
    } else {
      throw new Error("A policy in service was read as gone.");
    }
  });
});

describe("an on-call rule pages people only through a policy in service (#8433)", () => {
  test("a rule running one policy in service pages people", () => {
    expect(doesRuleRunPolicyInService(incidentRule([policy(false)]))).toBe(
      true,
    );
  });

  test("a rule whose only policy is archived pages no one", () => {
    expect(doesRuleRunPolicyInService(incidentRule([policy(true)]))).toBe(
      false,
    );
  });

  test("a rule whose policies are all archived pages no one", () => {
    expect(
      doesRuleRunPolicyInService(
        incidentRule([policy(true), policy(true), policy(true)]),
      ),
    ).toBe(false);
  });

  test("one policy in service among archived ones is enough", () => {
    expect(
      doesRuleRunPolicyInService(
        incidentRule([policy(true), policy(false), policy(true)]),
      ),
    ).toBe(true);
  });

  test("a rule that runs no policy, or whose policies were not read, pages no one", () => {
    expect(doesRuleRunPolicyInService(incidentRule([]))).toBe(false);
    expect(doesRuleRunPolicyInService(incidentRule(undefined))).toBe(false);
    expect(doesRuleRunPolicyInService({ onCallDutyPolicies: null })).toBe(
      false,
    );
    expect(doesRuleRunPolicyInService(null)).toBe(false);
    expect(doesRuleRunPolicyInService(undefined)).toBe(false);
  });

  test("a policy read with no archived flag counts as in service, as the server reads it", () => {
    expect(doesRuleRunPolicyInService(incidentRule([policy()]))).toBe(true);
    expect(doesRuleRunPolicyInService(incidentRule([policy(null)]))).toBe(true);
  });

  test("an entry with no id is no policy, and an empty entry none either", () => {
    expect(
      doesRuleRunPolicyInService({
        onCallDutyPolicies: [{ isArchived: false }, null, undefined],
      }),
    ).toBe(false);
    // Plain JSON names its id as _id; a model as id.
    expect(
      doesRuleRunPolicyInService({
        onCallDutyPolicies: [{ _id: "p1", isArchived: false }],
      }),
    ).toBe(true);
    expect(
      doesRuleRunPolicyInService({
        onCallDutyPolicies: [{ id: ObjectID.generate(), isArchived: false }],
      }),
    ).toBe(true);
  });

  test("rules are counted only when they page anyone, alert rules as incident rules", () => {
    const alertRule: AlertOnCallRule = new AlertOnCallRule();
    alertRule.onCallDutyPolicies = [policy(false)];

    const rules: Array<OnCallRuleWithPolicies> = [
      incidentRule([policy(false)]),
      incidentRule([policy(true)]),
      incidentRule([]),
      incidentRule([policy(true), policy(false)]),
      alertRule,
    ];

    expect(countRulesRunningPolicyInService(rules)).toBe(3);
    expect(countRulesRunningPolicyInService([])).toBe(0);
    expect(countRulesRunningPolicyInService([null, undefined])).toBe(0);
  });

  /*
   * The issue's project: its only policy archived, and the two rules that
   * run it. Counted as rules, it paged people already and the setup made
   * nothing; counted as rules that page anyone, the setup makes a policy.
   */
  test("counted so, the issue's project gets a policy made", () => {
    const archivedPolicy: OnCallDutyPolicy = policy(true);
    const alertRule: AlertOnCallRule = new AlertOnCallRule();
    alertRule.onCallDutyPolicies = [archivedPolicy];

    const facts: {
      policyCount: number;
      incidentRuleCount: number;
      alertRuleCount: number;
      mayCreatePolicy: boolean;
      mayAddEscalationRules: boolean;
      mayAddRules: boolean;
    } = {
      policyCount: 0,
      incidentRuleCount: countRulesRunningPolicyInService([
        incidentRule([archivedPolicy]),
      ]),
      alertRuleCount: countRulesRunningPolicyInService([alertRule]),
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    };

    expect(getWhoIsToldMode(facts)).toBe(WhoIsToldMode.CreatePolicy);
    // The same rules counted as rows, as before: the setup made nothing.
    expect(
      getWhoIsToldMode({ ...facts, incidentRuleCount: 1, alertRuleCount: 1 }),
    ).toBe(WhoIsToldMode.ExistingPolicy);
  });
});
