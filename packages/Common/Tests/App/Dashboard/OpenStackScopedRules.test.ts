import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import OpenStackCloudLabelRule from "../../../Models/DatabaseModels/OpenStackCloudLabelRule";
import OpenStackCloudOwnerRule from "../../../Models/DatabaseModels/OpenStackCloudOwnerRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import { isOpenStackRuleScoped } from "../../../Types/OpenStack/OpenStackScopedRule";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";
import {
  OpenStackRuleScope,
  createOpenStackScopeRules,
  describeOpenStackScopePattern,
  getOpenStackCloudNamePattern,
  getOpenStackScopePattern,
  getOpenStackScopeRuleName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackScopedRulesCard";
import { getOpenStackRuleScopeFields } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackRuleScope";
import { getOpenStackProjectMarker } from "../../../Types/OpenStack/OpenStackBlastRadius";
import type { ModelField } from "../../../UI/Components/Forms/ModelForm";
import {
  MATCH_CRITERIA_STEP_ID,
  getLegacyRuleCriteriaFields,
} from "../../../UI/Components/RuleCriteria/RuleCriteriaModelForm";
import getRuleDetailFields, {
  RuleDetailFields,
} from "../../../UI/Components/RuleRun/RuleDetailFields";

/*
 * What adding owners or labels to a project or a domain writes: one OpenStack Cloud rule
 * with the project's or domain's ID on it. Adding one no longer writes a pair of Alert and
 * Incident rules matching a marker; those rules keep working, and getOpenStackScopePattern
 * is still how the card finds them (OpenStackAlertContext.test.ts runs them).
 */

const mockCreate: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return mockCreate(...args);
      },
    },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const SCOPE: OpenStackRuleScope = {
  kind: "project",
  id: "f3a1c0d2e4b64f7c8a9d0e1f2a3b4c5d",
  name: "ou-payments",
};
const TEAM: string = "70000000-0000-4000-8000-000000000001";
const USER: string = "70000000-0000-4000-8000-000000000002";
const LABEL: string = "70000000-0000-4000-8000-000000000003";

function created(): Array<BaseModel> {
  return mockCreate.mock.calls.map((call: Array<unknown>): BaseModel => {
    return (call[0] as { model: BaseModel }).model;
  });
}

afterEach(() => {
  mockCreate.mockReset();
});

describe("adding owners to a project", () => {
  test("writes one cloud rule, with its ID and nothing about the cloud", async () => {
    await createOpenStackScopeRules({
      projectId: PROJECT_ID,
      scope: SCOPE,
      mode: "owner",
      teamIds: [TEAM],
      userIds: [USER],
    });

    expect(created()).toHaveLength(1);
    const rule: OpenStackCloudOwnerRule =
      created()[0] as OpenStackCloudOwnerRule;

    expect(rule).toBeInstanceOf(OpenStackCloudOwnerRule);
    expect(rule.projectId).toBe(PROJECT_ID);
    expect(rule.isEnabled).toBe(true);
    expect(rule.name).toBe(
      "OpenStack project ou-payments: owners of its alerts and incidents",
    );
    expect(rule.openStackProjectId).toBe(SCOPE.id);
    expect(rule.openStackDomainId).toBeUndefined();
    expect(rule.openStackCloudNamePattern).toBeUndefined();
    expect(isOpenStackRuleScoped(rule)).toBe(true);
    expect(rule.ownerTeams?.[0]?._id).toBe(TEAM);
    expect(rule.ownerUsers?.[0]?._id).toBe(USER);
  });
});

describe("adding labels to a domain", () => {
  test("writes one cloud rule that names the domain and its cloud", async () => {
    await createOpenStackScopeRules({
      projectId: PROJECT_ID,
      scope: { kind: "domain", id: "default", name: "Default" },
      mode: "label",
      labelIds: [LABEL],
      cloudName: "prod (eu).1",
    });

    expect(created()).toHaveLength(1);
    const rule: OpenStackCloudLabelRule =
      created()[0] as OpenStackCloudLabelRule;

    expect(rule).toBeInstanceOf(OpenStackCloudLabelRule);
    expect(rule.openStackDomainId).toBe("default");
    expect(rule.openStackProjectId).toBeUndefined();
    expect(rule.labelsToAdd?.[0]?._id).toBe(LABEL);
    expect(rule.openStackCloudNamePattern).toBe(
      getOpenStackCloudNamePattern("prod (eu).1"),
    );
    expect(
      RulePatternMatchUtil.testRegex(
        rule.openStackCloudNamePattern!,
        "prod (eu).1",
      ),
    ).toBe(true);
    // "default" is in every cloud, so a rule from one cloud's page stays on that cloud.
    expect(
      RulePatternMatchUtil.testRegex(
        rule.openStackCloudNamePattern!,
        "prod (eu).12",
      ),
    ).toBe(false);
  });
});

describe("what a stored pattern says", () => {
  test("reads back as the marker, whatever the ID held", () => {
    expect(
      describeOpenStackScopePattern(
        getOpenStackScopePattern({
          kind: "project",
          id: "a.b+c",
          name: "x",
        }),
      ),
    ).toBe(getOpenStackProjectMarker("a.b+c"));
  });

  test("a tenant's long name is cut to fit the column", () => {
    const name: string = getOpenStackScopeRuleName({
      scope: { kind: "project", id: "p", name: "x".repeat(255) },
      mode: "owner",
    });

    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toContain("…");
  });

  test("a name says what kind of rule it is, for the settings page", () => {
    expect(
      getOpenStackScopeRuleName({
        scope: { kind: "domain", id: "d", name: "Acme" },
        mode: "label",
      }),
    ).toBe("OpenStack domain Acme: labels on its alerts and incidents");
  });
});

describe("the rule forms", () => {
  const fields: Array<ModelField<OpenStackCloudOwnerRule>> =
    getOpenStackRuleScopeFields<OpenStackCloudOwnerRule>("owners");

  test("hold both columns, off the step whose builder takes over what is on it", () => {
    expect(
      fields.map((field: ModelField<OpenStackCloudOwnerRule>): string => {
        return Object.keys(field.field || {})[0]!;
      }),
    ).toEqual(["openStackProjectId", "openStackDomainId"]);

    for (const field of fields) {
      expect(field.stepId).toBe("owners");
      expect(field.stepId).not.toBe(MATCH_CRITERIA_STEP_ID);
      expect(field.required).toBe(false);
    }

    expect(getLegacyRuleCriteriaFields(fields)).toEqual([]);
  });

  test("and a rule's own page reads them from its form", () => {
    const detail: RuleDetailFields<OpenStackCloudOwnerRule> =
      getRuleDetailFields({
        model: new OpenStackCloudOwnerRule(),
        formFields: fields,
      });

    expect(
      detail.fields.map((field: { title?: string | undefined }) => {
        return field.title;
      }),
    ).toEqual(["OpenStack Project ID", "OpenStack Domain ID"]);
    expect(detail.selectMoreFields).toMatchObject({
      openStackProjectId: true,
      openStackDomainId: true,
    });
  });
});
