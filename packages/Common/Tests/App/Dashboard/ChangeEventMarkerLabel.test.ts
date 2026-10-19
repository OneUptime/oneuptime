import { describe, expect, test } from "@jest/globals";
import { getChangeEventMarkerLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines";

/*
 * A change event's marker on a chart says what kind of change it was, then
 * its title. The changes OneUptime makes itself - a fix OneUptime AI ran,
 * a runbook it ran - say so, rather than reading as a generic change.
 */

describe("getChangeEventMarkerLabel", () => {
  test.each([
    ["deployment", "Deploy 2.3.1", "Deploy: Deploy 2.3.1"],
    ["rollback", "Rolled back", "Rollback: Rolled back"],
    [
      "remediation",
      "OneUptime AI ran kubectl rollout restart deployment/api -n web",
      "AI fix: OneUptime AI ran kubectl rollout restart deployment/api -n web",
    ],
    [
      "runbook",
      'Runbook "Flush cache" ran',
      'Runbook: Runbook "Flush cache" ran',
    ],
  ])(
    "a %s is labelled by its kind",
    (eventType: string, title: string, label: string) => {
      expect(getChangeEventMarkerLabel(eventType, title)).toBe(label);
    },
  );

  test("the kind is read whatever its case", () => {
    expect(getChangeEventMarkerLabel("REMEDIATION", "x")).toBe("AI fix: x");
  });

  test("a kind it does not know is a change", () => {
    expect(getChangeEventMarkerLabel("custom", "x")).toBe("Change: x");
    expect(getChangeEventMarkerLabel(undefined, "x")).toBe("Change: x");
  });
});
