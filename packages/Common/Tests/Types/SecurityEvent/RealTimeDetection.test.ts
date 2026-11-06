import {
  DETECTION_REAL_TIME_RULES_MAX,
  REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
  RealTimeCountWindow,
  doesRealTimeRuleCountInWindows,
  doesSigmaRuleUseRegularExpression,
  getDetectionDefinitionRules,
  getRealTimeCountWindow,
  getRealTimeDetectionProblem,
} from "../../../Types/SecurityEvent/RealTimeDetection";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { DetectionRuleDefinition } from "../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { describe, expect, test } from "@jest/globals";

/*
 * Which rules may check events as they arrive - every rule but one with a
 * regular expression, a correlation held to every rule it reads - and why
 * one may not, in a sentence that says what to change; which of them count
 * in windows rather than firing on each event; and the windows they count
 * in, cut the same way by every process.
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

const SEQUENCE_WITH_REGEX_STEP: string = `title: Failures, then an admin sign-in
correlation:
  type: temporal_ordered
  rules: [failure, admin_sign_in]
  group-by: [principalIp]
  timespan: 10m
---
title: Failure
name: failure
detection:
  selection:
    statusName: Failure
  condition: selection
---
title: Admin sign-in
name: admin_sign_in
detection:
  selection:
    principalUser|re: '^adm[0-9]+$'
  condition: selection`;

const COUNTING_STEP_WITH_REGEX: string = `title: A burst, then a success
correlation:
  type: temporal_ordered
  rules: [burst, success]
  group-by: [principalIp]
  timespan: 10m
---
title: Burst
name: burst
correlation:
  type: event_count
  rules: [failure]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 5
---
title: Failure
name: failure
detection:
  selection:
    message|re: 'denied|refused'
  condition: selection
---
title: Success
name: success
detection:
  selection:
    statusName: Success
  condition: selection`;

function parse(yaml: string): DetectionRuleDefinition {
  return SigmaRuleSetParser.parse(yaml);
}

function titles(rules: Array<SigmaRule>): Array<string> {
  return rules.map((rule: SigmaRule): string => {
    return rule.title;
  });
}

describe("getRealTimeDetectionProblem", () => {
  test("a rule that fires on one event, one that counts, and a correlation can all run in real time", () => {
    expect(
      getRealTimeDetectionProblem({ definition: parse(SINGLE) }),
    ).toBeNull();
    expect(
      getRealTimeDetectionProblem({ definition: parse(CORRELATION) }),
    ).toBeNull();
  });

  test("a regular expression cannot, and the sentence says what to change", () => {
    expect(getRealTimeDetectionProblem({ definition: parse(WITH_REGEX) })).toBe(
      REAL_TIME_REGULAR_EXPRESSION_PROBLEM,
    );
    expect(REAL_TIME_REGULAR_EXPRESSION_PROBLEM).toContain(
      "use contains, startswith or endswith",
    );
  });

  test("a correlation is held to every rule it reads, a counting step's own included", () => {
    expect(
      getRealTimeDetectionProblem({
        definition: parse(SEQUENCE_WITH_REGEX_STEP),
      }),
    ).toBe(REAL_TIME_REGULAR_EXPRESSION_PROBLEM);
    expect(
      getRealTimeDetectionProblem({
        definition: parse(COUNTING_STEP_WITH_REGEX),
      }),
    ).toBe(REAL_TIME_REGULAR_EXPRESSION_PROBLEM);
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

  test("every rule of the library can run in real time but those with a regular expression", () => {
    const refused: Array<string> = [];
    let withRegularExpression: number = 0;

    for (const entry of DETECTION_RULE_LIBRARY) {
      const definition: DetectionRuleDefinition = parse(entry.sigmaRuleYaml);
      const usesRegularExpression: boolean = getDetectionDefinitionRules(
        definition,
      ).some((rule: SigmaRule): boolean => {
        return doesSigmaRuleUseRegularExpression(rule);
      });

      if (usesRegularExpression) {
        withRegularExpression++;
      }

      if (
        (getRealTimeDetectionProblem({ definition }) !== null) !==
        usesRegularExpression
      ) {
        refused.push(entry.title);
      }
    }

    expect(refused).toEqual([]);
    // A real choice for nearly the whole library, counting rules included.
    expect(
      DETECTION_RULE_LIBRARY.length - withRegularExpression,
    ).toBeGreaterThan((DETECTION_RULE_LIBRARY.length * 3) / 4);
    expect(
      DETECTION_RULE_LIBRARY.filter(
        (entry: DetectionRuleLibraryEntry): boolean => {
          return (
            getRealTimeDetectionProblem({
              definition: parse(entry.sigmaRuleYaml),
            }) === null &&
            doesRealTimeRuleCountInWindows({
              definition: parse(entry.sigmaRuleYaml),
              matchCountThreshold: entry.matchCountThreshold,
              distinctCountField: entry.distinctCountField,
            })
          );
        },
      ).length,
    ).toBeGreaterThan(0);
  });

  test("a project runs at most 50 rules in real time", () => {
    expect(DETECTION_REAL_TIME_RULES_MAX).toBe(50);
  });
});

describe("getDetectionDefinitionRules", () => {
  test("a single rule reads itself; a correlation every rule of its steps, a counting step's rules too", () => {
    expect(titles(getDetectionDefinitionRules(parse(SINGLE)))).toEqual([
      "Audit log cleared",
    ]);
    expect(
      titles(getDetectionDefinitionRules(parse(SEQUENCE_WITH_REGEX_STEP))),
    ).toEqual(["Failure", "Admin sign-in"]);
    expect(
      titles(getDetectionDefinitionRules(parse(COUNTING_STEP_WITH_REGEX))),
    ).toEqual(["Failure", "Success"]);
  });

  test("a step the file names but does not hold reads nothing until it is resolved", () => {
    const definition: DetectionRuleDefinition = parse(`title: Brute force
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 5m
  condition:
    gte: 10`);

    expect(definition.kind).toBe("correlation");
    expect(getDetectionDefinitionRules(definition)).toEqual([]);
  });
});

describe("doesRealTimeRuleCountInWindows", () => {
  test("a rule that fires on one event fires on each event: a threshold of 1, no distinct count", () => {
    for (const settings of [
      {},
      { matchCountThreshold: 1 },
      { matchCountThreshold: null, distinctCountField: null },
      { matchCountThreshold: "1", distinctCountField: "   " },
      { matchCountThreshold: 0 },
    ]) {
      expect(
        doesRealTimeRuleCountInWindows({
          definition: parse(SINGLE),
          ...settings,
        }),
      ).toBe(false);
    }
  });

  test("a threshold above 1, a distinct count, and every correlation count in windows", () => {
    expect(
      doesRealTimeRuleCountInWindows({
        definition: parse(SINGLE),
        matchCountThreshold: 5,
      }),
    ).toBe(true);
    // As a number field may hand it over.
    expect(
      doesRealTimeRuleCountInWindows({
        definition: parse(SINGLE),
        matchCountThreshold: "5",
      }),
    ).toBe(true);
    expect(
      doesRealTimeRuleCountInWindows({
        definition: parse(SINGLE),
        distinctCountField: "principalUser",
      }),
    ).toBe(true);
    expect(
      doesRealTimeRuleCountInWindows({
        definition: parse(CORRELATION),
        matchCountThreshold: 1,
      }),
    ).toBe(true);
  });
});

describe("getRealTimeCountWindow", () => {
  function windowOf(
    time: string,
    evaluationIntervalInMinutes?: number | null,
  ): { startTime: string; endTime: string } {
    const window: RealTimeCountWindow = getRealTimeCountWindow({
      time: new Date(time),
      evaluationIntervalInMinutes,
    });

    return {
      startTime: window.startTime.toISOString(),
      endTime: window.endTime.toISOString(),
    };
  }

  test("windows as long as the interval, back to back on the clock", () => {
    expect(windowOf("2026-11-04T10:03:17.250Z", 5)).toEqual({
      startTime: "2026-11-04T10:00:00.000Z",
      endTime: "2026-11-04T10:05:00.000Z",
    });
    expect(windowOf("2026-11-04T10:07:59.999Z", 5)).toEqual({
      startTime: "2026-11-04T10:05:00.000Z",
      endTime: "2026-11-04T10:10:00.000Z",
    });
    // A day's windows are UTC days.
    expect(windowOf("2026-11-04T23:59:59.000Z", 1440)).toEqual({
      startTime: "2026-11-04T00:00:00.000Z",
      endTime: "2026-11-05T00:00:00.000Z",
    });
  });

  test("a moment on a window's start belongs to it, and its end to the next", () => {
    expect(windowOf("2026-11-04T10:05:00.000Z", 5).startTime).toBe(
      "2026-11-04T10:05:00.000Z",
    );
    expect(windowOf("2026-11-04T10:04:59.999Z", 5).endTime).toBe(
      "2026-11-04T10:05:00.000Z",
    );
  });

  test("an interval that does not divide an hour still tiles time the same way for everyone", () => {
    const first: { startTime: string; endTime: string } = windowOf(
      "2026-11-04T10:03:00.000Z",
      7,
    );
    const again: { startTime: string; endTime: string } = windowOf(
      first.startTime,
      7,
    );

    expect(again).toEqual(first);
    expect(
      (Date.parse(first.endTime) - Date.parse(first.startTime)) / 60000,
    ).toBe(7);
    expect(Date.parse(first.startTime) % (7 * 60000)).toBe(0);
  });

  test("an interval left out, or under a minute, is a minute", () => {
    for (const interval of [undefined, null, 0, -3, 0.5]) {
      expect(windowOf("2026-11-04T10:03:17.000Z", interval)).toEqual({
        startTime: "2026-11-04T10:03:00.000Z",
        endTime: "2026-11-04T10:04:00.000Z",
      });
    }
  });
});
