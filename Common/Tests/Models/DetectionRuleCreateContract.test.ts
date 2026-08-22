import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import { describe, expect, test } from "@jest/globals";

/*
 * The API-compatibility contract for the incident columns added to
 * DetectionRule. DatabaseService.checkRequiredFields throws a 400 for any
 * required column a create payload omits — UNLESS the column is flagged
 * isDefaultValueColumn, in which case the schema's DEFAULT applies.
 *
 * shouldCreateIncident is required-with-default-false. Without the flag,
 * every API client written before the column existed — whose payloads
 * necessarily omit it — starts getting 400s on deploy, and the DB default
 * the model comment promises ("unset must read as off") is unreachable on
 * the create path. The dashboard would mask this via createInitialValues,
 * which is exactly why only a test can keep it honest.
 */
describe("DetectionRule create contract", () => {
  const rule: DetectionRule = new DetectionRule();

  test("shouldCreateIncident may be omitted from create payloads", () => {
    expect(rule.isDefaultValueColumn("shouldCreateIncident")).toBe(true);
  });

  test("the schema default for an omitted flag is OFF", () => {
    expect(
      rule.getTableColumnMetadata("shouldCreateIncident").defaultValue,
    ).toBe(false);
  });

  test("incidentSeverityId is optional — severity falls back to the Sigma level mapping", () => {
    expect(
      rule.getTableColumnMetadata("incidentSeverityId").required,
    ).toBeFalsy();
  });
});
