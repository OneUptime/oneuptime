import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import AlertLabelRule from "../../../Models/DatabaseModels/AlertLabelRule";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import IncidentLabelRule from "../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";
import {
  OpenStackRuleScope,
  createOpenStackScopeRules,
  describeOpenStackScopePattern,
  getOpenStackScopePattern,
  getOpenStackScopeRuleName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackScopedRulesCard";
import {
  getOpenStackDomainMarker,
  getOpenStackProjectMarker,
} from "../../../Types/OpenStack/OpenStackBlastRadius";

/*
 * What adding owners or labels to a project or a domain writes: one Alert rule and one
 * Incident rule, each an ordinary rule of those products, matching the line every alert
 * and incident on its parts carries.
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
  test("writes one Alert rule and one Incident rule, matching its ID", async () => {
    await createOpenStackScopeRules({
      projectId: PROJECT_ID,
      scope: SCOPE,
      mode: "owner",
      teamIds: [TEAM],
      userIds: [USER],
    });

    const [alertRule, incidentRule] = created() as [
      AlertOwnerRule,
      IncidentOwnerRule,
    ];

    expect(alertRule).toBeInstanceOf(AlertOwnerRule);
    expect(incidentRule).toBeInstanceOf(IncidentOwnerRule);
    expect(alertRule.projectId).toBe(PROJECT_ID);
    expect(alertRule.isEnabled).toBe(true);
    expect(alertRule.name).toBe(
      "OpenStack project ou-payments: owners of its alerts",
    );
    expect(incidentRule.name).toBe(
      "OpenStack project ou-payments: owners of its incidents",
    );
    expect(
      RulePatternMatchUtil.testRegex(
        alertRule.alertDescriptionPattern!,
        getOpenStackProjectMarker(SCOPE.id),
      ),
    ).toBe(true);
    expect(incidentRule.incidentDescriptionPattern).toBe(
      alertRule.alertDescriptionPattern,
    );
    expect(alertRule.ownerTeams?.[0]?._id).toBe(TEAM);
    expect(alertRule.ownerUsers?.[0]?._id).toBe(USER);
    expect(incidentRule.ownerTeams?.[0]?._id).toBe(TEAM);
  });
});

describe("adding labels to a domain", () => {
  test("writes the label rules, matching the domain's ID", async () => {
    await createOpenStackScopeRules({
      projectId: PROJECT_ID,
      scope: { kind: "domain", id: "default", name: "Default" },
      mode: "label",
      labelIds: [LABEL],
    });

    const [alertRule, incidentRule] = created() as [
      AlertLabelRule,
      IncidentLabelRule,
    ];

    expect(alertRule).toBeInstanceOf(AlertLabelRule);
    expect(incidentRule).toBeInstanceOf(IncidentLabelRule);
    expect(alertRule.labelsToAdd?.[0]?._id).toBe(LABEL);
    expect(
      RulePatternMatchUtil.testRegex(
        alertRule.alertDescriptionPattern!,
        getOpenStackDomainMarker("default"),
      ),
    ).toBe(true);
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
      subject: "Incidents",
    });

    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toContain("…");
  });

  test("a name says what kind of rule it is, for the Alerts and Incidents pages", () => {
    expect(
      getOpenStackScopeRuleName({
        scope: { kind: "domain", id: "d", name: "Acme" },
        mode: "label",
        subject: "Incidents",
      }),
    ).toBe("OpenStack domain Acme: labels on its incidents");
  });
});
