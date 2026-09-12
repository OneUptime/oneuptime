import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorLabelRule from "../../../Models/DatabaseModels/MonitorLabelRule";
import MonitorOwnerRule from "../../../Models/DatabaseModels/MonitorOwnerRule";
import MonitorLabelRuleEngineService from "../../../Server/Services/MonitorLabelRuleEngineService";
import MonitorOwnerRuleEngineService from "../../../Server/Services/MonitorOwnerRuleEngineService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { describe, expect, it } from "@jest/globals";

const PRODUCTION_LABEL_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CUSTOMER_LABEL_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface MonitorRuleMatchFields {
  criteria?: RuleCriteria | null | undefined;
  monitorLabels?: Array<Label> | undefined;
  monitorNamePattern?: string | undefined;
  monitorDescriptionPattern?: string | undefined;
}

interface MonitorRuleMatcher<RuleType extends MonitorRuleMatchFields> {
  doesMonitorMatchRule: (monitor: Monitor, rule: RuleType) => boolean;
}

function fakeLabel(id: ObjectID): Label {
  return { id, _id: id.toString() } as unknown as Label;
}

function fakeMonitor(fields?: {
  name?: string | undefined;
  description?: string | undefined;
  labels?: Array<ObjectID> | undefined;
}): Monitor {
  return {
    name: fields?.name || "API Monitor",
    description: fields?.description || "Production customer API",
    labels: (fields?.labels || [PRODUCTION_LABEL_ID]).map(fakeLabel),
  } as unknown as Monitor;
}

function criteria(
  filterCondition: FilterCondition,
  filters: RuleCriteria["filters"],
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition,
    filters,
  };
}

const matchers: Array<{
  name: string;
  match: (monitor: Monitor, rule: MonitorRuleMatchFields) => boolean;
}> = [
  {
    name: "monitor label rules",
    match: (monitor: Monitor, rule: MonitorRuleMatchFields): boolean => {
      const matcher: MonitorRuleMatcher<MonitorLabelRule> =
        MonitorLabelRuleEngineService as unknown as MonitorRuleMatcher<MonitorLabelRule>;

      return matcher.doesMonitorMatchRule(monitor, rule as MonitorLabelRule);
    },
  },
  {
    name: "monitor owner rules",
    match: (monitor: Monitor, rule: MonitorRuleMatchFields): boolean => {
      const matcher: MonitorRuleMatcher<MonitorOwnerRule> =
        MonitorOwnerRuleEngineService as unknown as MonitorRuleMatcher<MonitorOwnerRule>;

      return matcher.doesMonitorMatchRule(monitor, rule as MonitorOwnerRule);
    },
  },
];

describe.each(matchers)(
  "$name configurable criteria",
  ({
    match,
  }: {
    match: (monitor: Monitor, rule: MonitorRuleMatchFields) => boolean;
  }) => {
    it("matches when any configured condition succeeds and ignores stale legacy fields", () => {
      expect(
        match(fakeMonitor(), {
          monitorDescriptionPattern: "this stale criterion must be ignored",
          criteria: criteria(FilterCondition.Any, [
            {
              field: "monitorNamePattern",
              operator: RuleCriteriaOperator.StartsWith,
              value: "worker",
            },
            {
              field: "monitorLabels",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [PRODUCTION_LABEL_ID.toString()],
            },
          ]),
        }),
      ).toBe(true);
    });

    it("requires every configured condition when matching all", () => {
      const rule: MonitorRuleMatchFields = {
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "api",
          },
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [PRODUCTION_LABEL_ID.toString()],
          },
        ]),
      };

      expect(match(fakeMonitor(), rule)).toBe(true);
      expect(match(fakeMonitor({ name: "Background worker" }), rule)).toBe(
        false,
      );
    });

    it("supports requiring all selected labels", () => {
      const rule: MonitorRuleMatchFields = {
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAllOf,
            value: [
              PRODUCTION_LABEL_ID.toString(),
              CUSTOMER_LABEL_ID.toString(),
            ],
          },
        ]),
      };

      expect(
        match(
          fakeMonitor({ labels: [PRODUCTION_LABEL_ID, CUSTOMER_LABEL_ID] }),
          rule,
        ),
      ).toBe(true);
      expect(match(fakeMonitor({ labels: [PRODUCTION_LABEL_ID] }), rule)).toBe(
        false,
      );
    });

    it("preserves the legacy all-fields matcher when criteria is absent", () => {
      const rule: MonitorRuleMatchFields = {
        monitorLabels: [fakeLabel(PRODUCTION_LABEL_ID)],
        monitorNamePattern: "^api",
        monitorDescriptionPattern: "customer",
      };

      expect(match(fakeMonitor(), rule)).toBe(true);
      expect(match(fakeMonitor({ name: "Worker" }), rule)).toBe(false);
      expect(match(fakeMonitor(), {})).toBe(true);
    });
  },
);
