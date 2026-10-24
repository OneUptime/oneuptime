/*
 * What an AI rule can match on, and why one cannot be saved
 * (AiRuleCriteria). Investigation rules and auto remediation rules were
 * merged into AI rules, so these hold for every incident and alert AI rule:
 * an incident rule's severities are incident severities, an alert rule's
 * alert severities.
 */

import {
  AI_RULE_CRITERIA_FIELDS,
  AI_RULE_CRITERIA_FIELDS_BY_TRIGGER,
  getAiRuleCriteriaProblem,
  isAiRuleTriggerEntity,
} from "../../../Types/AI/AiRuleCriteria";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import { describe, expect, test } from "@jest/globals";

const Incident: AutoRemediationTriggerEntity =
  AutoRemediationTriggerEntity.Incident;
const Alert: AutoRemediationTriggerEntity = AutoRemediationTriggerEntity.Alert;

describe("the criteria fields", () => {
  test("an incident rule matches on incident severities, never alert ones", () => {
    const fields: ReadonlyArray<string> =
      AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Incident];

    expect(fields).toContain("incidentSeverities");
    expect(fields).not.toContain("alertSeverities");
  });

  test("an alert rule matches on alert severities, never incident ones", () => {
    const fields: ReadonlyArray<string> =
      AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Alert];

    expect(fields).toContain("alertSeverities");
    expect(fields).not.toContain("incidentSeverities");
  });

  test("both share monitors, labels, monitor labels and the patterns", () => {
    for (const shared of [
      "monitors",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
    ]) {
      expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Incident]).toContain(shared);
      expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Alert]).toContain(shared);
    }
  });

  test("every field is listed once, in the order first seen", () => {
    expect(AI_RULE_CRITERIA_FIELDS).toEqual([
      "monitors",
      "incidentSeverities",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
      "alertSeverities",
    ]);
    expect(new Set(AI_RULE_CRITERIA_FIELDS).size).toBe(
      AI_RULE_CRITERIA_FIELDS.length,
    );
  });

  test("every trigger entity type has a field list", () => {
    for (const type of Object.values(AutoRemediationTriggerEntity)) {
      expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[type].length).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("isAiRuleTriggerEntity", () => {
  test("accepts the exact enum values", () => {
    expect(isAiRuleTriggerEntity("Incident")).toBe(true);
    expect(isAiRuleTriggerEntity("Alert")).toBe(true);
  });

  test("is case sensitive and does not trim", () => {
    expect(isAiRuleTriggerEntity("alert")).toBe(false);
    expect(isAiRuleTriggerEntity("INCIDENT")).toBe(false);
    expect(isAiRuleTriggerEntity(" Incident")).toBe(false);
  });

  test("refuses anything that is not a string", () => {
    for (const value of [null, undefined, 0, 1, true, {}, [], ["Incident"]]) {
      expect(isAiRuleTriggerEntity(value)).toBe(false);
    }
  });

  test("refuses other strings", () => {
    expect(isAiRuleTriggerEntity("")).toBe(false);
    expect(isAiRuleTriggerEntity("Monitor")).toBe(false);
  });
});

describe("getAiRuleCriteriaProblem", () => {
  test("an unknown trigger entity type is refused, naming the allowed ones", () => {
    const expected: string =
      "Trigger Entity Type must be one of Incident, Alert.";

    expect(getAiRuleCriteriaProblem({ triggerEntityType: "Monitor" })).toBe(
      expected,
    );
    expect(getAiRuleCriteriaProblem({ triggerEntityType: undefined })).toBe(
      expected,
    );
    expect(getAiRuleCriteriaProblem({ triggerEntityType: "incident" })).toBe(
      expected,
    );
  });

  test("a rule with no criteria and no values is fine", () => {
    expect(
      getAiRuleCriteriaProblem({ triggerEntityType: Incident }),
    ).toBeNull();
    expect(getAiRuleCriteriaProblem({ triggerEntityType: Alert })).toBeNull();
  });

  test("conditions on the rule's own fields are fine", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        criteria: {
          filters: [
            { field: "incidentSeverities" },
            { field: "monitors" },
            { field: "titlePattern" },
          ],
        },
      }),
    ).toBeNull();
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Alert,
        criteria: {
          filters: [{ field: "alertSeverities" }, { field: "labels" }],
        },
      }),
    ).toBeNull();
  });

  test("an incident rule may not filter on alert severities", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        criteria: { filters: [{ field: "alertSeverities" }] },
      }),
    ).toBe("Alert Severities can only be used by alert AI rules.");
  });

  test("an alert rule may not filter on incident severities", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Alert,
        criteria: { filters: [{ field: "incidentSeverities" }] },
      }),
    ).toBe("Incident Severities can only be used by incident AI rules.");
  });

  test("the severity column itself is refused for the wrong kind of rule", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        values: { alertSeverities: ["some-severity-id"] },
      }),
    ).toBe("Alert Severities can only be used by alert AI rules.");
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Alert,
        values: { incidentSeverities: [{ _id: "x" }] },
      }),
    ).toBe("Incident Severities can only be used by incident AI rules.");
  });

  test("an empty or non-list column value does not count as used", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        values: { alertSeverities: [] },
      }),
    ).toBeNull();
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        values: { alertSeverities: "id" },
      }),
    ).toBeNull();
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        values: { alertSeverities: null },
      }),
    ).toBeNull();
  });

  test("the rule's own column values are fine", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        values: {
          incidentSeverities: ["a"],
          monitors: ["b"],
          labels: ["c"],
        },
      }),
    ).toBeNull();
  });

  test("values outside the criteria fields are ignored", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        values: { somethingElse: ["x"], name: ["y"] },
      }),
    ).toBeNull();
  });

  test("conditions are checked before columns, in the order written", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        criteria: {
          filters: [{ field: "monitors" }, { field: "alertSeverities" }],
        },
        values: { alertSeverities: ["a"] },
      }),
    ).toBe("Alert Severities can only be used by alert AI rules.");
  });

  test("unknown fields are left to the shared validation", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Alert,
        criteria: { filters: [{ field: "notAField" }] },
      }),
    ).toBeNull();
  });

  test("malformed criteria are left to the shared validation", () => {
    for (const criteria of [
      null,
      undefined,
      "text",
      42,
      [],
      {},
      { filters: null },
      { filters: "alertSeverities" },
      { filters: { field: "alertSeverities" } },
      { filters: [null, 1, "alertSeverities", { field: 7 }, {}] },
    ]) {
      expect(
        getAiRuleCriteriaProblem({
          triggerEntityType: Incident,
          criteria,
        }),
      ).toBeNull();
    }
  });

  test("a bad filter among good ones does not hide a wrong-kind field", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Alert,
        criteria: {
          filters: [null, { field: 3 }, { field: "incidentSeverities" }],
        },
      }),
    ).toBe("Incident Severities can only be used by incident AI rules.");
  });
});
