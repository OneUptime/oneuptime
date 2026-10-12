import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../../../../Server/Utils/Logger";
import OnCallRulePolicyScope, {
  RuleNamingPolicies,
} from "../../../../Server/Utils/Rules/OnCallRulePolicyScope";
import ObjectID from "../../../../Types/ObjectID";
import type { SpyInstance } from "jest-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * OnCallRulePolicyScope keeps, of the on-call policies matched rules would
 * page, only the project's own: it drops the others from the matched map,
 * drops each rule that no longer adds a kept policy (replaying which rule
 * added each policy first), and logs the dropped ids. The project lookup is
 * stubbed - which ids are the project's is the test's to say.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OWN_A: string = "0000000c-0000-4000-8000-000000000001";
const OWN_B: string = "0000000c-0000-4000-8000-000000000002";
const FOREIGN_X: string = "0000000c-0000-4000-8000-0000000000f1";
const FOREIGN_Y: string = "0000000c-0000-4000-8000-0000000000f2";

const LOG_ATTRIBUTES: LogAttributes = {
  projectId: PROJECT_ID.toString(),
  incidentId: "incident-1",
};

interface TestRule extends RuleNamingPolicies {
  name: string;
}

function policy(id: string): OnCallDutyPolicy {
  const item: OnCallDutyPolicy = new OnCallDutyPolicy();
  item._id = id;
  return item;
}

function rule(name: string, policyIds: Array<string>): TestRule {
  return {
    name: name,
    onCallDutyPolicies: policyIds.map((id: string) => {
      return policy(id);
    }),
  };
}

function matched(ids: Array<string>): Map<string, OnCallDutyPolicy> {
  const map: Map<string, OnCallDutyPolicy> = new Map<
    string,
    OnCallDutyPolicy
  >();

  for (const id of ids) {
    map.set(id, policy(id));
  }

  return map;
}

function namesOf(rules: Array<TestRule>): Array<string> {
  return rules.map((item: TestRule) => {
    return item.name;
  });
}

describe("OnCallRulePolicyScope.keepPoliciesInProject", () => {
  let projectPolicies: Set<string>;
  let keepIdsInProject: SpyInstance<
    typeof ProjectScopedReferenceValidator.keepIdsInProject
  >;
  let warn: SpyInstance<typeof logger.warn>;

  beforeEach(() => {
    projectPolicies = new Set<string>([OWN_A, OWN_B]);

    keepIdsInProject = jest
      .spyOn(ProjectScopedReferenceValidator, "keepIdsInProject")
      .mockImplementation(
        async (data: { ids: Array<string> }): Promise<Array<string>> => {
          return data.ids.filter((id: string) => {
            return projectPolicies.has(id);
          });
        },
      );

    warn = jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads nothing and changes nothing when no policy matched", async () => {
    const rules: Array<TestRule> = [rule("Empty", [])];
    const policies: Map<string, OnCallDutyPolicy> = matched([]);

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: policies,
      matchedRules: rules,
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(keepIdsInProject).not.toHaveBeenCalled();
    expect(namesOf(rules)).toEqual(["Empty"]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("asks about every matched policy, pinned to the project", async () => {
    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: matched([OWN_A, FOREIGN_X]),
      matchedRules: [rule("R", [OWN_A, FOREIGN_X])],
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(keepIdsInProject).toHaveBeenCalledTimes(1);
    expect(keepIdsInProject).toHaveBeenCalledWith({
      modelType: OnCallDutyPolicy,
      projectId: PROJECT_ID,
      ids: [OWN_A, FOREIGN_X],
    });
  });

  test("keeps everything, and logs nothing, when every policy is the project's", async () => {
    const rules: Array<TestRule> = [rule("One", [OWN_A]), rule("Two", [OWN_B])];
    const policies: Map<string, OnCallDutyPolicy> = matched([OWN_A, OWN_B]);

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: policies,
      matchedRules: rules,
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(Array.from(policies.keys())).toEqual([OWN_A, OWN_B]);
    expect(namesOf(rules)).toEqual(["One", "Two"]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("drops another project's policies from the matched map", async () => {
    const policies: Map<string, OnCallDutyPolicy> = matched([
      OWN_A,
      FOREIGN_X,
      OWN_B,
    ]);

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: policies,
      matchedRules: [rule("R", [OWN_A, FOREIGN_X, OWN_B])],
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(Array.from(policies.keys())).toEqual([OWN_A, OWN_B]);
  });

  test("changes the map and the rules in place", async () => {
    const policies: Map<string, OnCallDutyPolicy> = matched([FOREIGN_X]);
    const rules: Array<TestRule> = [rule("Foreign", [FOREIGN_X])];

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: policies,
      matchedRules: rules,
      ruleKind: "Alert on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(policies.size).toBe(0);
    expect(rules).toEqual([]);
  });

  test("drops a rule that names only another project's policies", async () => {
    const rules: Array<TestRule> = [
      rule("Own", [OWN_A]),
      rule("Foreign", [FOREIGN_X]),
    ];

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: matched([OWN_A, FOREIGN_X]),
      matchedRules: rules,
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(namesOf(rules)).toEqual(["Own"]);
  });

  test("keeps a rule that names a kept policy beside a dropped one", async () => {
    const rules: Array<TestRule> = [rule("Mixed", [FOREIGN_X, OWN_A])];

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: matched([FOREIGN_X, OWN_A]),
      matchedRules: rules,
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(namesOf(rules)).toEqual(["Mixed"]);
  });

  test("credits a kept policy only to the first rule that added it", async () => {
    /*
     * "Second" names OWN_A too, but "First" added it already, and the only
     * policy "Second" would add first is another project's - so "Second" no
     * longer adds anything.
     */
    const rules: Array<TestRule> = [
      rule("First", [OWN_A]),
      rule("Second", [OWN_A, FOREIGN_X]),
    ];

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: matched([OWN_A, FOREIGN_X]),
      matchedRules: rules,
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(namesOf(rules)).toEqual(["First"]);
  });

  test("a later rule that first adds a kept policy stays", async () => {
    const rules: Array<TestRule> = [
      rule("First", [OWN_A, FOREIGN_X]),
      rule("Second", [OWN_A, OWN_B]),
      rule("Third", [OWN_B, FOREIGN_Y]),
    ];

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: matched([OWN_A, FOREIGN_X, OWN_B, FOREIGN_Y]),
      matchedRules: rules,
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    // Third's OWN_B was added by Second; FOREIGN_Y is dropped.
    expect(namesOf(rules)).toEqual(["First", "Second"]);
  });

  test("a rule with no policies, or none listed, is dropped once something was left out", async () => {
    const rules: Array<TestRule> = [
      { name: "Undefined" },
      rule("Empty", []),
      rule("Own", [OWN_A]),
    ];

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: matched([OWN_A, FOREIGN_X]),
      matchedRules: rules,
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(namesOf(rules)).toEqual(["Own"]);
  });

  test("a policy with no id credits nothing", async () => {
    const noId: OnCallDutyPolicy = new OnCallDutyPolicy();
    const rules: Array<TestRule> = [
      { name: "NoId", onCallDutyPolicies: [noId] },
      rule("Own", [OWN_A]),
    ];

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: matched([OWN_A, FOREIGN_X]),
      matchedRules: rules,
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(namesOf(rules)).toEqual(["Own"]);
  });

  test("logs the dropped ids, with the rule kind and the attributes", async () => {
    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: matched([FOREIGN_X, OWN_A, FOREIGN_Y]),
      matchedRules: [rule("R", [FOREIGN_X, OWN_A, FOREIGN_Y])],
      ruleKind: "Incident on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `Incident on-call rules name on-call policies that are not in this project; they were not paged: "${FOREIGN_X}", "${FOREIGN_Y}"`,
      LOG_ATTRIBUTES,
    );
  });

  test("drops everything when the lookup keeps nothing", async () => {
    projectPolicies = new Set<string>();

    const policies: Map<string, OnCallDutyPolicy> = matched([OWN_A, OWN_B]);
    const rules: Array<TestRule> = [rule("One", [OWN_A]), rule("Two", [OWN_B])];

    await OnCallRulePolicyScope.keepPoliciesInProject({
      projectId: PROJECT_ID,
      matchedPolicies: policies,
      matchedRules: rules,
      ruleKind: "Alert Episode on-call",
      logAttributes: LOG_ATTRIBUTES,
    });

    expect(policies.size).toBe(0);
    expect(rules).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("passes on a failed lookup without changing anything", async () => {
    keepIdsInProject.mockRejectedValueOnce(new Error("database down"));

    const policies: Map<string, OnCallDutyPolicy> = matched([OWN_A]);
    const rules: Array<TestRule> = [rule("Own", [OWN_A])];

    await expect(
      OnCallRulePolicyScope.keepPoliciesInProject({
        projectId: PROJECT_ID,
        matchedPolicies: policies,
        matchedRules: rules,
        ruleKind: "Incident on-call",
        logAttributes: LOG_ATTRIBUTES,
      }),
    ).rejects.toThrow("database down");

    expect(policies.size).toBe(1);
    expect(namesOf(rules)).toEqual(["Own"]);
  });
});
