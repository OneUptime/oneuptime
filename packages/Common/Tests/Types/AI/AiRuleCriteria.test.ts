/*
 * What an AI rule can match on, and why one cannot be saved
 * (AiRuleCriteria). Investigation rules and auto remediation rules were
 * merged into AI rules, so these hold for every incident and alert AI rule:
 * an incident rule's severities are incident severities, an alert rule's
 * alert severities. A profile AI rule (slow code a service's profiles show,
 * Types/AI/TelemetryAi) matches on the service alone.
 */

import {
  AI_RULE_CRITERIA_FIELDS,
  AI_RULE_CRITERIA_FIELDS_BY_TRIGGER,
  TELEMETRY_AI_RULE_CRITERIA_FIELDS,
  getAiRuleCriteriaProblem,
  hasAiRuleCriterionValue,
  isAiRuleTriggerEntity,
} from "../../../Types/AI/AiRuleCriteria";
import { RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN } from "../../../Types/Rules/RuleCriteria";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import { describe, expect, test } from "@jest/globals";

const Incident: AutoRemediationTriggerEntity =
  AutoRemediationTriggerEntity.Incident;
const Alert: AutoRemediationTriggerEntity = AutoRemediationTriggerEntity.Alert;
const Profile: AutoRemediationTriggerEntity =
  AutoRemediationTriggerEntity.Profile;
const Trace: AutoRemediationTriggerEntity = AutoRemediationTriggerEntity.Trace;
const Log: AutoRemediationTriggerEntity = AutoRemediationTriggerEntity.Log;

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

  test("a profile rule matches on the service alone: picked, by its labels or by its name", () => {
    expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Profile]).toEqual([
      "services",
      "serviceLabels",
      "serviceNamePattern",
    ]);
    expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Profile]).toBe(
      TELEMETRY_AI_RULE_CRITERIA_FIELDS,
    );

    for (const incidentOnly of [
      "monitors",
      "incidentSeverities",
      "alertSeverities",
      "labels",
      "monitorLabels",
      "titlePattern",
      "descriptionPattern",
    ]) {
      expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Profile]).not.toContain(
        incidentOnly,
      );
    }

    for (const serviceField of TELEMETRY_AI_RULE_CRITERIA_FIELDS) {
      expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Incident]).not.toContain(
        serviceField,
      );
      expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Alert]).not.toContain(
        serviceField,
      );
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
      "services",
      "serviceLabels",
      "serviceNamePattern",
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
    expect(isAiRuleTriggerEntity("Profile")).toBe(true);
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
      "Trigger Entity Type must be one of Incident, Alert, Profile, Trace, Exception, Log.";

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

  test("a pattern counts once it holds text; a list once it holds a record", () => {
    expect(hasAiRuleCriterionValue("titlePattern", "db")).toBe(true);
    expect(hasAiRuleCriterionValue("serviceNamePattern", "^api")).toBe(true);
    expect(hasAiRuleCriterionValue("descriptionPattern", "")).toBe(false);
    expect(hasAiRuleCriterionValue("titlePattern", ["db"])).toBe(false);
    expect(
      hasAiRuleCriterionValue(
        "titlePattern",
        ` ${RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN} `,
      ),
    ).toBe(false);
    expect(hasAiRuleCriterionValue("services", ["a"])).toBe(true);
    expect(hasAiRuleCriterionValue("services", [])).toBe(false);
    expect(hasAiRuleCriterionValue("services", "a")).toBe(false);
    expect(hasAiRuleCriterionValue("monitors", null)).toBe(false);
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

  test("a profile rule's own conditions and columns are fine", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Profile,
        criteria: {
          filters: [
            { field: "services" },
            { field: "serviceLabels" },
            { field: "serviceNamePattern" },
          ],
        },
        values: {
          services: ["a"],
          serviceLabels: ["b"],
          serviceNamePattern: "^checkout",
        },
      }),
    ).toBeNull();
  });

  test("a profile rule may not match on an incident's or an alert's criteria", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Profile,
        criteria: { filters: [{ field: "monitors" }] },
      }),
    ).toBe("Monitors can only be used by incident AI rules or alert AI rules.");
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Profile,
        values: { incidentSeverities: ["x"] },
      }),
    ).toBe("Incident Severities can only be used by incident AI rules.");
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Profile,
        values: { titlePattern: "database" },
      }),
    ).toBe(
      "Title Pattern can only be used by incident AI rules or alert AI rules.",
    );
  });

  test("an incident or alert rule may not match on a service", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        criteria: { filters: [{ field: "services" }] },
      }),
    ).toBe(
      "Services can only be used by profile AI rules, trace AI rules, exception AI rules or log AI rules.",
    );
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Alert,
        values: { serviceLabels: [{ _id: "x" }] },
      }),
    ).toBe(
      "Service Labels can only be used by profile AI rules, trace AI rules, exception AI rules or log AI rules.",
    );
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        values: { serviceNamePattern: "checkout" },
      }),
    ).toBe(
      "Service Name Pattern can only be used by profile AI rules, trace AI rules, exception AI rules or log AI rules.",
    );
  });

  test("a log rule matches on the service, as a profile or a trace rule does", () => {
    expect(isAiRuleTriggerEntity("Log")).toBe(true);
    expect(isAiRuleTriggerEntity("log")).toBe(false);
    expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Log]).toEqual(
      AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Profile],
    );
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Log,
        criteria: {
          filters: [
            { field: "services" },
            { field: "serviceLabels" },
            { field: "serviceNamePattern" },
          ],
        },
        values: {
          services: ["a"],
          serviceLabels: ["b"],
          serviceNamePattern: "^checkout",
        },
      }),
    ).toBeNull();
  });

  test("a log rule may not match on an incident's or an alert's criteria", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Log,
        criteria: { filters: [{ field: "incidentSeverities" }] },
      }),
    ).toBe("Incident Severities can only be used by incident AI rules.");
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Log,
        values: { titlePattern: "payment" },
      }),
    ).toBe(
      "Title Pattern can only be used by incident AI rules or alert AI rules.",
    );
  });

  test("a trace rule matches on the service, as a profile rule does", () => {
    expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Trace]).toEqual(
      AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Profile],
    );
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Trace,
        criteria: {
          filters: [
            { field: "services" },
            { field: "serviceLabels" },
            { field: "serviceNamePattern" },
          ],
        },
        values: {
          services: ["a"],
          serviceLabels: ["b"],
          serviceNamePattern: "^checkout",
        },
      }),
    ).toBeNull();
  });

  test("a trace rule may not match on an incident's or an alert's criteria", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Trace,
        criteria: { filters: [{ field: "monitors" }] },
      }),
    ).toBe("Monitors can only be used by incident AI rules or alert AI rules.");
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Trace,
        values: { alertSeverities: ["x"] },
      }),
    ).toBe("Alert Severities can only be used by alert AI rules.");
  });

  test("the never-match pattern the dashboard writes beside conditions is no criterion", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Incident,
        values: {
          serviceNamePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
        },
      }),
    ).toBeNull();
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Profile,
        values: { titlePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN },
      }),
    ).toBeNull();
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Profile,
        values: { titlePattern: "   " },
      }),
    ).toBeNull();
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

/*
 * An exception AI rule (Exceptions' AI section) matches on the service the
 * exception was raised in, as a profile or trace rule does - and on nothing
 * of an incident's or an alert's.
 */
describe("exception AI rules", () => {
  const Exception: AutoRemediationTriggerEntity =
    AutoRemediationTriggerEntity.Exception;

  test("match on the service, as a profile rule does", () => {
    expect(AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Exception]).toEqual(
      AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[Profile],
    );
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Exception,
        criteria: {
          filters: [
            { field: "services" },
            { field: "serviceLabels" },
            { field: "serviceNamePattern" },
          ],
        },
        values: {
          services: ["a"],
          serviceLabels: ["b"],
          serviceNamePattern: "^checkout",
        },
      }),
    ).toBeNull();
  });

  test("may not match on an incident's or an alert's criteria", () => {
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Exception,
        criteria: { filters: [{ field: "monitors" }] },
      }),
    ).toBe("Monitors can only be used by incident AI rules or alert AI rules.");
    expect(
      getAiRuleCriteriaProblem({
        triggerEntityType: Exception,
        values: { incidentSeverities: ["x"] },
      }),
    ).toBe("Incident Severities can only be used by incident AI rules.");
  });
});
