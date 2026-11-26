import { describe, expect, test } from "@jest/globals";
import {
  DETECTION_RULE_UNCOUNTED_PATH,
  DETECTION_RULE_UNCOUNTED_PERIOD_IN_HOURS,
  DetectionRuleUncounted,
  DetectionRulesUncounted,
  MAX_DETECTION_RULES_UNCOUNTED_PER_ASK,
  detectionRulesUncountedToJSON,
  didRuleCountNothing,
  getUncountedHiddenCount,
  readDetectionRulesUncounted,
} from "../../../Types/SecurityEvent/DetectionRuleUncounted";

/*
 * #10547: WHAT A RULE COULD NOT COUNT, AS ITS ROW ON DETECTION RULES READS
 * IT. The server writes it and the page reads it through these, so the two
 * never disagree - and the page never says more than the server counted.
 */

const BRUTE_FORCE: DetectionRuleUncounted = {
  detectionRuleId: "10547000-0000-4000-8000-000000000001",
  field: "principalIp",
  matchedCount: 1210,
  uncountedCount: 1204,
  hiddenInLogsCount: 1180,
  hiddenInTracesCount: 4,
};

describe("the answer", () => {
  test("is asked at its path, about a page of rules, for the last day", () => {
    expect(DETECTION_RULE_UNCOUNTED_PATH).toBe("/detection-rule/uncounted");
    expect(MAX_DETECTION_RULES_UNCOUNTED_PER_ASK).toBe(50);
    expect(DETECTION_RULE_UNCOUNTED_PERIOD_IN_HOURS).toBe(24);
  });

  test("reads back as it was written", () => {
    const answer: DetectionRulesUncounted = {
      periodInHours: 24,
      rules: [BRUTE_FORCE],
    };

    expect(
      readDetectionRulesUncounted(detectionRulesUncountedToJSON(answer)),
    ).toEqual(answer);
  });

  test("a rule it cannot read, or that left nothing out, is left out", () => {
    expect(
      readDetectionRulesUncounted({
        periodInHours: 24,
        rules: [
          { ...BRUTE_FORCE, detectionRuleId: "" },
          { ...BRUTE_FORCE, field: "" },
          { ...BRUTE_FORCE, uncountedCount: 0 },
          { ...BRUTE_FORCE, uncountedCount: "many" },
          "a rule",
          null,
        ] as never,
      }).rules,
    ).toEqual([]);
  });

  test("never says a scrub rule hid more than it could not count, nor that it left out more than it matched", () => {
    expect(
      readDetectionRulesUncounted({
        rules: [
          {
            detectionRuleId: BRUTE_FORCE.detectionRuleId,
            field: "principalIp",
            matchedCount: 3,
            uncountedCount: 10,
            hiddenInLogsCount: 8,
            hiddenInTracesCount: 9,
          },
        ],
      }).rules,
    ).toEqual([
      {
        detectionRuleId: BRUTE_FORCE.detectionRuleId,
        field: "principalIp",
        matchedCount: 10,
        uncountedCount: 10,
        hiddenInLogsCount: 8,
        hiddenInTracesCount: 2,
      },
    ]);
  });

  test("counts are whole and never below none", () => {
    expect(
      readDetectionRulesUncounted({
        rules: [
          {
            ...BRUTE_FORCE,
            matchedCount: 12.7,
            uncountedCount: 4.2,
            hiddenInLogsCount: -3,
            hiddenInTracesCount: "x",
          },
        ],
      }).rules[0],
    ).toEqual({
      ...BRUTE_FORCE,
      matchedCount: 12,
      uncountedCount: 4,
      hiddenInLogsCount: 0,
      hiddenInTracesCount: 0,
    });
  });

  test("an answer that names no period speaks of the last day", () => {
    expect(readDetectionRulesUncounted(undefined)).toEqual({
      periodInHours: 24,
      rules: [],
    });
  });
});

describe("whether a rule could count anything", () => {
  test("one that matched events with a value counted some", () => {
    expect(didRuleCountNothing(BRUTE_FORCE)).toBe(false);
  });

  test("one whose every match had no value counted nothing, and cannot fire", () => {
    expect(
      didRuleCountNothing({
        ...BRUTE_FORCE,
        matchedCount: 1204,
        uncountedCount: 1204,
      }),
    ).toBe(true);
  });

  test("one that left nothing out is no rule that counted nothing", () => {
    expect(
      didRuleCountNothing({
        ...BRUTE_FORCE,
        matchedCount: 0,
        uncountedCount: 0,
      }),
    ).toBe(false);
  });

  test("what a scrub rule hid is what it hid in logs and in traces", () => {
    expect(getUncountedHiddenCount(BRUTE_FORCE)).toBe(1184);
  });
});
