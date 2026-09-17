import AlertReminderRule from "../../../Models/DatabaseModels/AlertReminderRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import AlertReminderRuleService from "../../../Server/Services/AlertReminderRuleService";
import IncidentReminderRuleService from "../../../Server/Services/IncidentReminderRuleService";
import ScheduledMaintenanceReminderRuleService from "../../../Server/Services/ScheduledMaintenanceReminderRuleService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { describe, expect, it } from "@jest/globals";

const SEVERITY_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LABEL_A_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const LABEL_B_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function label(id: ObjectID): Label {
  const item: Label = new Label();
  item.id = id;
  return item;
}

describe("reminder rule configurable criteria", () => {
  it("matches an alert when any one of severity or labels matches", () => {
    const rule: AlertReminderRule = new AlertReminderRule();
    rule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.Any,
      filters: [
        {
          field: "alertSeverities",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ["44444444-4444-4444-8444-444444444444"],
        },
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [LABEL_A_ID.toString()],
        },
      ],
    };

    expect(
      AlertReminderRuleService.doesAlertMatchRule({
        rule: rule,
        alertSeverityId: SEVERITY_ID,
        labelIds: [LABEL_A_ID],
      }),
    ).toBe(true);
  });

  it("requires every incident condition in Match all mode", () => {
    const rule: IncidentReminderRule = new IncidentReminderRule();
    rule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "incidentSeverities",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [SEVERITY_ID.toString()],
        },
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasAllOf,
          value: [LABEL_A_ID.toString(), LABEL_B_ID.toString()],
        },
      ],
    };

    expect(
      IncidentReminderRuleService.doesIncidentMatchRule({
        rule: rule,
        incidentSeverityId: SEVERITY_ID,
        labelIds: [LABEL_A_ID, LABEL_B_ID],
      }),
    ).toBe(true);
    expect(
      IncidentReminderRuleService.doesIncidentMatchRule({
        rule: rule,
        incidentSeverityId: SEVERITY_ID,
        labelIds: [LABEL_A_ID],
      }),
    ).toBe(false);
  });

  it("supports excluding labels from scheduled maintenance reminders", () => {
    const rule: ScheduledMaintenanceReminderRule =
      new ScheduledMaintenanceReminderRule();
    rule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasNoneOf,
          value: [LABEL_B_ID.toString()],
        },
      ],
    };

    expect(
      ScheduledMaintenanceReminderRuleService.doesScheduledMaintenanceMatchRule(
        { rule: rule, labelIds: [LABEL_A_ID] },
      ),
    ).toBe(true);
    expect(
      ScheduledMaintenanceReminderRuleService.doesScheduledMaintenanceMatchRule(
        { rule: rule, labelIds: [LABEL_A_ID, LABEL_B_ID] },
      ),
    ).toBe(false);
  });

  it("ignores stale legacy fields after configurable criteria is saved", () => {
    const rule: AlertReminderRule = new AlertReminderRule();
    const staleSeverity: AlertSeverity = new AlertSeverity();
    staleSeverity.id = new ObjectID("55555555-5555-4555-8555-555555555555");
    rule.alertSeverities = [staleSeverity];
    rule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [LABEL_A_ID.toString()],
        },
      ],
    };

    expect(
      AlertReminderRuleService.doesAlertMatchRule({
        rule: rule,
        alertSeverityId: SEVERITY_ID,
        labelIds: [LABEL_A_ID],
      }),
    ).toBe(true);
  });

  it("preserves legacy matching when criteria has not been configured", () => {
    const rule: IncidentReminderRule = new IncidentReminderRule();
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.id = SEVERITY_ID;
    rule.incidentSeverities = [severity];
    rule.labels = [label(LABEL_A_ID)];

    expect(
      IncidentReminderRuleService.doesIncidentMatchRule({
        rule: rule,
        incidentSeverityId: SEVERITY_ID,
        labelIds: [LABEL_A_ID],
      }),
    ).toBe(true);
    expect(
      IncidentReminderRuleService.doesIncidentMatchRule({
        rule: rule,
        incidentSeverityId: SEVERITY_ID,
        labelIds: [LABEL_B_ID],
      }),
    ).toBe(false);
  });
});
