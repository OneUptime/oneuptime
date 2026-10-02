import RunbookRule from "../../../Models/DatabaseModels/RunbookRule";
import TableColumnType from "../../../Types/Database/TableColumnType";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER, {
  RUNBOOK_RULE_CRITERIA_FIELDS,
  getRunbookRuleCriteriaFields,
  getRunbookRuleCriteriaProblem,
  isRunbookRuleCriteriaFieldForTrigger,
  isRunbookRuleTriggerEntity,
} from "../../../Types/Runbook/RunbookRuleCriteria";
import RunbookRuleTriggerEntity from "../../../Types/Runbook/RunbookRuleTriggerEntity";
import { describe, expect, test } from "@jest/globals";

/*
 * "The incident runbook rules don't have things like incident labels,
 * monitor labels, and all of that stuff. Can you please add those things as
 * well, just like we have on the incident privacy rules?" - the maintainer.
 *
 * One table holds incident, alert and scheduled maintenance runbook rules.
 * This is the contract of what each of them may match on.
 */

const SEVERITY_ID: string = "11111111-1111-4111-8111-111111111111";

const TRIGGERS: Array<RunbookRuleTriggerEntity> = [
  RunbookRuleTriggerEntity.Incident,
  RunbookRuleTriggerEntity.Alert,
  RunbookRuleTriggerEntity.ScheduledMaintenance,
];

function criteriaOn(...fields: Array<string>): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.Any,
    filters: fields.map((field: string): RuleCriteriaFilter => {
      return {
        field: field,
        operator: RuleCriteriaOperator.HasAnyOf,
        value: [SEVERITY_ID],
      };
    }),
  };
}

describe("what each runbook rule matches on", () => {
  test("incident runbook rules offer what incident privacy rules offer, with the shared column names", () => {
    expect(
      RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER[
        RunbookRuleTriggerEntity.Incident
      ],
    ).toEqual([
      "monitors",
      "incidentSeverities",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
      "monitorNamePattern",
      "monitorDescriptionPattern",
    ]);
  });

  test("alert runbook rules swap incident severities for alert severities", () => {
    expect(
      RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER[RunbookRuleTriggerEntity.Alert],
    ).toEqual([
      "monitors",
      "alertSeverities",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
      "monitorNamePattern",
      "monitorDescriptionPattern",
    ]);
  });

  test("scheduled maintenance runbook rules have no severity to match", () => {
    expect(
      RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER[
        RunbookRuleTriggerEntity.ScheduledMaintenance
      ],
    ).toEqual([
      "monitors",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
      "monitorNamePattern",
      "monitorDescriptionPattern",
    ]);
  });

  test("every trigger has its list, and getRunbookRuleCriteriaFields answers with it", () => {
    expect(Object.keys(RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER).sort()).toEqual(
      [...TRIGGERS].sort(),
    );

    for (const trigger of TRIGGERS) {
      expect(getRunbookRuleCriteriaFields(trigger)).toBe(
        RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER[trigger],
      );
    }
  });

  test("together they are exactly what the API allowlists for RunbookRule", () => {
    expect([...RUNBOOK_RULE_CRITERIA_FIELDS].sort()).toEqual(
      [...RULE_CRITERIA_FIELDS_BY_MODEL["RunbookRule"]!].sort(),
    );
    expect(new Set(RUNBOOK_RULE_CRITERIA_FIELDS).size).toBe(
      RUNBOOK_RULE_CRITERIA_FIELDS.length,
    );
  });

  test.each(TRIGGERS)(
    "%s criteria are columns on RunbookRule, relations or patterns",
    (trigger: RunbookRuleTriggerEntity) => {
      const model: RunbookRule = new RunbookRule();

      for (const field of getRunbookRuleCriteriaFields(trigger)) {
        const type: TableColumnType | undefined =
          model.getTableColumnMetadata(field)?.type;

        expect({ field, type }).toEqual({
          field,
          type: field.endsWith("Pattern")
            ? TableColumnType.LongText
            : TableColumnType.EntityArray,
        });
      }
    },
  );

  test("only the severities belong to one trigger; everything else to all three", () => {
    for (const field of RUNBOOK_RULE_CRITERIA_FIELDS) {
      const triggers: Array<RunbookRuleTriggerEntity> = TRIGGERS.filter(
        (trigger: RunbookRuleTriggerEntity): boolean => {
          return isRunbookRuleCriteriaFieldForTrigger({
            field,
            triggerEntityType: trigger,
          });
        },
      );

      if (field === "incidentSeverities") {
        expect(triggers).toEqual([RunbookRuleTriggerEntity.Incident]);
      } else if (field === "alertSeverities") {
        expect(triggers).toEqual([RunbookRuleTriggerEntity.Alert]);
      } else {
        expect({ field, triggers }).toEqual({ field, triggers: TRIGGERS });
      }
    }
  });

  test("a field no runbook rule knows belongs to no trigger", () => {
    for (const trigger of TRIGGERS) {
      expect(
        isRunbookRuleCriteriaFieldForTrigger({
          field: "runbooks",
          triggerEntityType: trigger,
        }),
      ).toBe(false);
      expect(
        isRunbookRuleCriteriaFieldForTrigger({
          field: "incidentLabels",
          triggerEntityType: trigger,
        }),
      ).toBe(false);
    }
  });
});

describe("isRunbookRuleTriggerEntity", () => {
  test.each(TRIGGERS)("accepts %s", (trigger: RunbookRuleTriggerEntity) => {
    expect(isRunbookRuleTriggerEntity(trigger)).toBe(true);
  });

  test.each([
    "incident",
    "INCIDENT",
    "Scheduled Maintenance",
    "",
    undefined,
    null,
    1,
    {},
  ])("refuses %p", (value: unknown) => {
    expect(isRunbookRuleTriggerEntity(value)).toBe(false);
  });
});

describe("getRunbookRuleCriteriaProblem", () => {
  test.each(TRIGGERS)(
    "%s rules may use every criterion of their own",
    (trigger: RunbookRuleTriggerEntity) => {
      expect(
        getRunbookRuleCriteriaProblem({
          triggerEntityType: trigger,
          criteria: criteriaOn(...getRunbookRuleCriteriaFields(trigger)),
        }),
      ).toBeNull();
    },
  );

  test.each(TRIGGERS)(
    "%s rules with no criteria at all are fine",
    (trigger: RunbookRuleTriggerEntity) => {
      expect(
        getRunbookRuleCriteriaProblem({ triggerEntityType: trigger }),
      ).toBe(null);
      expect(
        getRunbookRuleCriteriaProblem({
          triggerEntityType: trigger,
          criteria: null,
          values: {},
        }),
      ).toBeNull();
      expect(
        getRunbookRuleCriteriaProblem({
          triggerEntityType: trigger,
          criteria: criteriaOn(),
        }),
      ).toBeNull();
    },
  );

  test("an incident rule cannot ask for alert severities", () => {
    expect(
      getRunbookRuleCriteriaProblem({
        triggerEntityType: RunbookRuleTriggerEntity.Incident,
        criteria: criteriaOn("monitors", "alertSeverities"),
      }),
    ).toBe("Alert Severities can only be used by alert runbook rules.");
  });

  test("an alert rule cannot ask for incident severities", () => {
    expect(
      getRunbookRuleCriteriaProblem({
        triggerEntityType: RunbookRuleTriggerEntity.Alert,
        criteria: criteriaOn("incidentSeverities"),
      }),
    ).toBe("Incident Severities can only be used by incident runbook rules.");
  });

  test.each([
    [
      "incidentSeverities",
      "Incident Severities can only be used by incident runbook rules.",
    ],
    [
      "alertSeverities",
      "Alert Severities can only be used by alert runbook rules.",
    ],
  ])(
    "a scheduled maintenance rule cannot ask for %s",
    (field: string, refusal: string) => {
      expect(
        getRunbookRuleCriteriaProblem({
          triggerEntityType: RunbookRuleTriggerEntity.ScheduledMaintenance,
          criteria: criteriaOn(field),
        }),
      ).toBe(refusal);
    },
  );

  test("Match any does not make another trigger's severity acceptable", () => {
    const criteria: RuleCriteria = {
      ...criteriaOn("labels", "alertSeverities"),
      filterCondition: FilterCondition.Any,
    };

    expect(
      getRunbookRuleCriteriaProblem({
        triggerEntityType: RunbookRuleTriggerEntity.Incident,
        criteria,
      }),
    ).toBe("Alert Severities can only be used by alert runbook rules.");
  });

  test("another trigger's severity column is refused too, not only a condition", () => {
    expect(
      getRunbookRuleCriteriaProblem({
        triggerEntityType: RunbookRuleTriggerEntity.Incident,
        values: { alertSeverities: [SEVERITY_ID] },
      }),
    ).toBe("Alert Severities can only be used by alert runbook rules.");
    expect(
      getRunbookRuleCriteriaProblem({
        triggerEntityType: RunbookRuleTriggerEntity.ScheduledMaintenance,
        values: { incidentSeverities: [{ _id: SEVERITY_ID }] },
      }),
    ).toBe("Incident Severities can only be used by incident runbook rules.");
  });

  test("an empty column of another trigger is what the dashboard sends, and is fine", () => {
    expect(
      getRunbookRuleCriteriaProblem({
        triggerEntityType: RunbookRuleTriggerEntity.Alert,
        values: { incidentSeverities: [], monitors: [], labels: [] },
      }),
    ).toBeNull();
  });

  test("its own severity column is fine", () => {
    expect(
      getRunbookRuleCriteriaProblem({
        triggerEntityType: RunbookRuleTriggerEntity.Alert,
        values: { alertSeverities: [SEVERITY_ID] },
      }),
    ).toBeNull();
  });

  test("an unknown trigger is refused, naming the ones there are", () => {
    for (const triggerEntityType of [undefined, "", "Monitor", "incident"]) {
      expect(getRunbookRuleCriteriaProblem({ triggerEntityType })).toBe(
        "Trigger Entity Type must be one of Incident, Alert, ScheduledMaintenance.",
      );
    }
  });

  test("malformed criteria and unknown fields are left to the shared validation", () => {
    for (const criteria of [
      "not criteria",
      42,
      { filters: "nope" },
      { filters: [null, 7, { operator: "HasAnyOf" }, { field: 3 }] },
      criteriaOn("notAField", "runbooks"),
    ]) {
      expect(
        getRunbookRuleCriteriaProblem({
          triggerEntityType: RunbookRuleTriggerEntity.Incident,
          criteria,
        }),
      ).toBeNull();
    }
  });
});
