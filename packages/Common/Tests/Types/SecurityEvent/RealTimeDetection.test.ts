import {
  DETECTION_REAL_TIME_RULES_MAX,
  REAL_TIME_CORRELATION_PROBLEM,
  REAL_TIME_DISTINCT_COUNT_PROBLEM,
  REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
  REAL_TIME_THRESHOLD_PROBLEM,
  doesSigmaRuleUseRegularExpression,
  getRealTimeDetectionProblem,
} from "../../../Types/SecurityEvent/RealTimeDetection";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { DetectionRuleDefinition } from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { describe, expect, test } from "@jest/globals";

/*
 * Which rules may check each event as it arrives: one that fires on one
 * event - no correlation, a threshold of 1, no distinct count, no regular
 * expression - and why any other may not, in a sentence that says what to
 * change.
 */

const SINGLE: string = `title: Audit log cleared
level: high
detection:
  selection:
    className: Account Change
    activityName|contains: cleared
  condition: selection`;

const WITH_REGEX: string = `title: Encoded PowerShell
detection:
  selection:
    CommandLine|re: '-[Ee]nc(odedCommand)? [A-Za-z0-9+/=]{40,}'
  condition: selection`;

const CORRELATION: string = `title: Many failures
correlation:
  type: event_count
  rules: [failure]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 10
---
title: Failure
name: failure
detection:
  selection:
    statusName: Failure
  condition: selection`;

function parse(yaml: string): DetectionRuleDefinition {
  return SigmaRuleSetParser.parse(yaml);
}

describe("getRealTimeDetectionProblem", () => {
  test("a rule that fires on one event can run in real time", () => {
    expect(
      getRealTimeDetectionProblem({
        definition: parse(SINGLE),
        matchCountThreshold: 1,
        distinctCountField: "",
      }),
    ).toBeNull();
    // Thresholds and fields left out are the defaults: one match, no distinct count.
    expect(getRealTimeDetectionProblem({ definition: parse(SINGLE) })).toBeNull();
    expect(
      getRealTimeDetectionProblem({
        definition: parse(SINGLE),
        matchCountThreshold: null,
        distinctCountField: "   ",
      }),
    ).toBeNull();
  });

  test("says why any other cannot, and what to change", () => {
    expect(
      getRealTimeDetectionProblem({ definition: parse(CORRELATION) }),
    ).toBe(REAL_TIME_CORRELATION_PROBLEM);
    expect(
      getRealTimeDetectionProblem({
        definition: parse(SINGLE),
        matchCountThreshold: 5,
      }),
    ).toBe(REAL_TIME_THRESHOLD_PROBLEM);
    expect(
      getRealTimeDetectionProblem({
        definition: parse(SINGLE),
        distinctCountField: "principalUser",
      }),
    ).toBe(REAL_TIME_DISTINCT_COUNT_PROBLEM);
    expect(
      getRealTimeDetectionProblem({ definition: parse(WITH_REGEX) }),
    ).toBe(REAL_TIME_REGULAR_EXPRESSION_PROBLEM);

    expect(REAL_TIME_THRESHOLD_PROBLEM).toContain(
      "set Match Count Threshold to 1",
    );
    expect(REAL_TIME_DISTINCT_COUNT_PROBLEM).toContain(
      "clear Distinct Count Field",
    );
    expect(REAL_TIME_REGULAR_EXPRESSION_PROBLEM).toContain(
      "use contains, startswith or endswith",
    );
  });

  test("finds a regular expression wherever the detection holds one", () => {
    const nested: DetectionRuleDefinition = parse(`title: Nested
detection:
  selection_a:
    className: Process Activity
  selection_b:
    - CommandLine|contains: whoami
    - CommandLine|re: 'net\\s+user'
  condition: selection_a and 1 of selection_b`);
    const plain: DetectionRuleDefinition = parse(SINGLE);

    expect(nested.kind).toBe("single");
    expect(plain.kind).toBe("single");

    if (nested.kind === "single" && plain.kind === "single") {
      expect(doesSigmaRuleUseRegularExpression(nested.rule)).toBe(true);
      expect(doesSigmaRuleUseRegularExpression(plain.rule)).toBe(false);
    }
  });

  test("most of the rule library fires on one event, and can run in real time", () => {
    const eligible: Array<string> = DETECTION_RULE_LIBRARY.filter(
      (entry: DetectionRuleLibraryEntry): boolean => {
        return (
          getRealTimeDetectionProblem({
            definition: parse(entry.sigmaRuleYaml),
            matchCountThreshold: entry.matchCountThreshold,
            distinctCountField: entry.distinctCountField,
          }) === null
        );
      },
    ).map((entry: DetectionRuleLibraryEntry): string => {
      return entry.title;
    });

    // The library's single-event rules: a real choice, not a corner case.
    expect(eligible.length).toBeGreaterThan(DETECTION_RULE_LIBRARY.length / 2);
  });

  test("a project runs at most 50 rules in real time", () => {
    expect(DETECTION_REAL_TIME_RULES_MAX).toBe(50);
  });
});
