import {
  DetectionRulePastRetention,
  SECONDS_IN_A_DAY,
  SecurityEventRetentionStatus,
  doesLookbackReachPastRetention,
  findRulesPastRetention,
  getDetectionRuleLookbackInSeconds,
  getKeptLookbackInSeconds,
  getLongestLookbackInSeconds,
  getRetentionInDaysNeededFor,
  getSecurityEventRetentionInDays,
  getSecurityEventsKeptFrom,
  parseSecurityEventRetentionStatus,
  securityEventRetentionStatusToJSON,
} from "../../../Types/SecurityEvent/SecurityEventRetention";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  DetectionRuleDefinition,
  DetectionRuleType,
  SigmaCorrelationType,
} from "../../../Types/SecurityEvent/SigmaCorrelation";
import { HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS } from "../../../Types/Telemetry/TelemetryRetentionConfig";
import { JSONObject } from "../../../Types/JSON";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW FAR BACK SECURITY EVENTS GO (#10432): how long a project keeps them,
 * where the kept events start, how far back each kind of rule reads, and
 * which rules read past the kept events - the answers the server reads and
 * runs with and the Dashboard says, in one place.
 */

const DAY: number = SECONDS_IN_A_DAY;

const SINGLE: string = `title: Audit log cleared
detection:
  selection:
    className: Account Change
  condition: selection`;

const FIRST_SEEN_30_DAYS: string = `title: AWS activity in a new region
correlation:
  type: new_value
  rules: [call]
  group-by: [targetHost]
  timespan: 30d
  condition:
    field: awsRegion
---
title: Call
name: call
detection:
  selection:
    productName: AWS CloudTrail
  condition: selection`;

const FIRST_SEEN_14_DAYS: string = FIRST_SEEN_30_DAYS.replace(
  "timespan: 30d",
  "timespan: 14d",
);

const EVENT_COUNT: string = `title: Many failures
correlation:
  type: event_count
  rules: [failure]
  group-by: [principalIp]
  timespan: 1d
  condition:
    gte: 10
---
title: Failure
name: failure
detection:
  selection:
    statusName: Failure
  condition: selection`;

const DISTINCT_VALUES: string = `title: Many users from one address
correlation:
  type: value_count
  rules: [failure]
  group-by: [principalIp]
  timespan: 2h
  condition:
    gte: 5
    field: principalUser
---
title: Failure
name: failure
detection:
  selection:
    statusName: Failure
  condition: selection`;

const SEQUENCE_WITH_COUNTING_STEP: string = `title: A burst, then a success
correlation:
  type: temporal_ordered
  rules: [burst, success]
  group-by: [principalIp]
  timespan: 1d
---
title: Burst
name: burst
correlation:
  type: event_count
  rules: [failure]
  group-by: [principalIp]
  timespan: 12h
  condition:
    gte: 5
---
title: Failure
name: failure
detection:
  selection:
    statusName: Failure
  condition: selection
---
title: Success
name: success
detection:
  selection:
    statusName: Success
  condition: selection`;

const TOGETHER: string = `title: Both, in any order
correlation:
  type: temporal
  rules: [failure, success]
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
title: Success
name: success
detection:
  selection:
    statusName: Success
  condition: selection`;

function parse(yaml: string): DetectionRuleDefinition {
  return SigmaRuleSetParser.parse(yaml);
}

describe("getSecurityEventRetentionInDays", () => {
  test("a project left as it is keeps them 15 days", () => {
    expect(getSecurityEventRetentionInDays({})).toBe(15);
    expect(
      getSecurityEventRetentionInDays({ defaultTelemetryRetentionInDays: 15 }),
    ).toBe(15);
    expect(HARDCODED_DEFAULT_TELEMETRY_RETENTION_IN_DAYS).toBe(15);
  });

  test("the project's Default Retention (Days) sets it", () => {
    expect(
      getSecurityEventRetentionInDays({ defaultTelemetryRetentionInDays: 7 }),
    ).toBe(7);
    expect(
      getSecurityEventRetentionInDays({ defaultTelemetryRetentionInDays: 90 }),
    ).toBe(90);
  });

  test("a retention by type for security events comes before the default", () => {
    expect(
      getSecurityEventRetentionInDays({
        defaultTelemetryRetentionInDays: 15,
        telemetryRetentionConfig: { securityEvents: { default: 45 } },
      }),
    ).toBe(45);
  });

  test("another type's retention does not set it", () => {
    expect(
      getSecurityEventRetentionInDays({
        defaultTelemetryRetentionInDays: 15,
        telemetryRetentionConfig: {
          logs: { default: 90 },
          traces: { default: 60 },
          metrics: { default: 30 },
        },
      }),
    ).toBe(15);
  });

  test("a blank or zero retention by type falls back to the default", () => {
    expect(
      getSecurityEventRetentionInDays({
        defaultTelemetryRetentionInDays: 20,
        telemetryRetentionConfig: { securityEvents: { default: null } },
      }),
    ).toBe(20);
    expect(
      getSecurityEventRetentionInDays({
        defaultTelemetryRetentionInDays: 20,
        telemetryRetentionConfig: { securityEvents: { default: 0 } },
      }),
    ).toBe(20);
  });

  test("nothing set at all reads as the 15 days every project starts with", () => {
    expect(
      getSecurityEventRetentionInDays({
        defaultTelemetryRetentionInDays: null,
        telemetryRetentionConfig: null,
      }),
    ).toBe(15);
  });
});

describe("getSecurityEventsKeptFrom", () => {
  test("the retention before now", () => {
    const now: Date = new Date("2026-11-21T12:00:00.000Z");

    expect(
      getSecurityEventsKeptFrom({ retentionInDays: 15, now }).toISOString(),
    ).toBe("2026-11-06T12:00:00.000Z");
    expect(
      getSecurityEventsKeptFrom({ retentionInDays: 1, now }).toISOString(),
    ).toBe("2026-11-20T12:00:00.000Z");
  });
});

describe("getDetectionRuleLookbackInSeconds", () => {
  test("a single rule reads nothing before the events it judges", () => {
    expect(getDetectionRuleLookbackInSeconds(parse(SINGLE))).toBe(0);
  });

  test("a First seen rule reads its timespan of history", () => {
    expect(getDetectionRuleLookbackInSeconds(parse(FIRST_SEEN_30_DAYS))).toBe(
      30 * DAY,
    );
    expect(getDetectionRuleLookbackInSeconds(parse(FIRST_SEEN_14_DAYS))).toBe(
      14 * DAY,
    );
  });

  test("a count reads the window it counts", () => {
    expect(getDetectionRuleLookbackInSeconds(parse(EVENT_COUNT))).toBe(DAY);
    expect(getDetectionRuleLookbackInSeconds(parse(DISTINCT_VALUES))).toBe(
      2 * 60 * 60,
    );
  });

  test("a sequence reads its timespan, and a counting step's own before it", () => {
    expect(
      getDetectionRuleLookbackInSeconds(parse(SEQUENCE_WITH_COUNTING_STEP)),
    ).toBe(DAY + 12 * 60 * 60);
    expect(getDetectionRuleLookbackInSeconds(parse(TOGETHER))).toBe(10 * 60);
  });
});

describe("doesLookbackReachPastRetention and getKeptLookbackInSeconds", () => {
  test("30 days of history against 15 days kept reaches past them, and sees 15", () => {
    expect(
      doesLookbackReachPastRetention({
        lookbackInSeconds: 30 * DAY,
        retentionInDays: 15,
      }),
    ).toBe(true);
    expect(
      getKeptLookbackInSeconds({
        lookbackInSeconds: 30 * DAY,
        retentionInDays: 15,
      }),
    ).toBe(15 * DAY);
  });

  test("a lookback the retention covers, to the day, does not", () => {
    for (const retentionInDays of [30, 31, 90, 365]) {
      expect(
        doesLookbackReachPastRetention({
          lookbackInSeconds: 30 * DAY,
          retentionInDays,
        }),
      ).toBe(false);
      expect(
        getKeptLookbackInSeconds({
          lookbackInSeconds: 30 * DAY,
          retentionInDays,
        }),
      ).toBe(30 * DAY);
    }

    expect(
      doesLookbackReachPastRetention({
        lookbackInSeconds: 14 * DAY,
        retentionInDays: 15,
      }),
    ).toBe(false);
  });

  test("a day's count against a day kept does not; a sequence a day and a half long does", () => {
    expect(
      doesLookbackReachPastRetention({
        lookbackInSeconds: DAY,
        retentionInDays: 1,
      }),
    ).toBe(false);
    expect(
      doesLookbackReachPastRetention({
        lookbackInSeconds: DAY + 12 * 60 * 60,
        retentionInDays: 1,
      }),
    ).toBe(true);
  });

  test("a single rule never reaches past them", () => {
    expect(
      doesLookbackReachPastRetention({
        lookbackInSeconds: 0,
        retentionInDays: 1,
      }),
    ).toBe(false);
  });
});

describe("getRetentionInDaysNeededFor", () => {
  test("the whole days that cover a lookback", () => {
    expect(getRetentionInDaysNeededFor(30 * DAY)).toBe(30);
    expect(getRetentionInDaysNeededFor(DAY + 12 * 60 * 60)).toBe(2);
    expect(getRetentionInDaysNeededFor(10 * 60)).toBe(1);
    expect(getRetentionInDaysNeededFor(0)).toBe(1);
  });
});

describe("findRulesPastRetention", () => {
  const rules: Array<{
    id: string;
    name: string;
    definition: DetectionRuleDefinition;
  }> = [
    { id: "single", name: "Audit log cleared", definition: parse(SINGLE) },
    {
      id: "region",
      name: "AWS activity in a new region",
      definition: parse(FIRST_SEEN_30_DAYS),
    },
    {
      id: "address",
      name: "Sign-in from a new address",
      definition: parse(FIRST_SEEN_14_DAYS),
    },
    { id: "count", name: "Many failures", definition: parse(EVENT_COUNT) },
    {
      id: "sequence",
      name: "A burst, then a success",
      definition: parse(SEQUENCE_WITH_COUNTING_STEP),
    },
  ];

  test("at 15 days, only the 30-day First seen rule reads past them", () => {
    expect(findRulesPastRetention({ rules, retentionInDays: 15 })).toEqual([
      {
        id: "region",
        name: "AWS activity in a new region",
        type: DetectionRuleType.NewValue,
        lookbackInSeconds: 30 * DAY,
      },
    ]);
  });

  test("at 7 days, both First seen rules do, the one reading furthest back first", () => {
    expect(
      findRulesPastRetention({ rules, retentionInDays: 7 }).map(
        (rule: DetectionRulePastRetention): string => {
          return rule.id;
        },
      ),
    ).toEqual(["region", "address"]);
  });

  test("at 1 day, the sequence too; never a single rule or a count a day kept covers", () => {
    expect(
      findRulesPastRetention({ rules, retentionInDays: 1 }).map(
        (rule: DetectionRulePastRetention): string => {
          return rule.id;
        },
      ),
    ).toEqual(["region", "address", "sequence"]);
  });

  test("at 30 days or more, none", () => {
    expect(findRulesPastRetention({ rules, retentionInDays: 30 })).toEqual([]);
    expect(findRulesPastRetention({ rules, retentionInDays: 90 })).toEqual([]);
  });

  test("rules that read as far back are listed by name", () => {
    const sameLookback: Array<DetectionRulePastRetention> =
      findRulesPastRetention({
        rules: [
          {
            id: "b",
            name: "Okta sign-in from a new country",
            definition: parse(FIRST_SEEN_30_DAYS),
          },
          {
            id: "a",
            name: "AWS activity in a new region",
            definition: parse(FIRST_SEEN_30_DAYS),
          },
        ],
        retentionInDays: 15,
      });

    expect(
      sameLookback.map((rule: DetectionRulePastRetention): string => {
        return rule.id;
      }),
    ).toEqual(["a", "b"]);
  });

  test("the longest lookback listed", () => {
    expect(
      getLongestLookbackInSeconds(
        findRulesPastRetention({ rules, retentionInDays: 1 }),
      ),
    ).toBe(30 * DAY);
    expect(getLongestLookbackInSeconds([])).toBe(0);
  });

  /*
   * The Rule Library's First seen rules: at the 15 days every project
   * starts with, the 30-day ones read past the kept events and the 14-day
   * ones do not - what the Library and Settings say of them.
   */
  test("the Rule Library's 30-day First seen rules read past 15 days; its 14-day ones do not", () => {
    const firstSeen: Array<{
      id: string;
      name: string;
      definition: DetectionRuleDefinition;
    }> = DETECTION_RULE_LIBRARY.map(
      (
        entry: DetectionRuleLibraryEntry,
      ): { id: string; name: string; definition: DetectionRuleDefinition } => {
        return {
          id: entry.id,
          name: entry.title,
          definition: parse(entry.sigmaRuleYaml),
        };
      },
    ).filter(
      (rule: {
        id: string;
        name: string;
        definition: DetectionRuleDefinition;
      }): boolean => {
        return (
          rule.definition.kind === "correlation" &&
          rule.definition.correlation.type === SigmaCorrelationType.NewValue
        );
      },
    );

    expect(firstSeen.length).toBeGreaterThan(0);

    const past: Array<string> = findRulesPastRetention({
      rules: firstSeen,
      retentionInDays: 15,
    }).map((rule: DetectionRulePastRetention): string => {
      return rule.name;
    });

    expect(past).toContain("AWS activity in a region the account never used");
    expect(past).toContain("Okta sign-in from a new country");
    expect(past).not.toContain(
      "Sign-in from an address the account never used",
    );

    expect(
      findRulesPastRetention({ rules: firstSeen, retentionInDays: 30 }),
    ).toEqual([]);
  });
});

describe("the answer through JSON", () => {
  const status: SecurityEventRetentionStatus = {
    retentionInDays: 15,
    rulesPastRetention: [
      {
        id: "6a2c1d2e-0000-4000-8000-000000000001",
        name: "AWS activity in a new region",
        type: DetectionRuleType.NewValue,
        lookbackInSeconds: 30 * DAY,
      },
    ],
    hasMoreRulesPastRetention: true,
  };

  test("survives the trip", () => {
    expect(
      parseSecurityEventRetentionStatus(
        JSON.parse(
          JSON.stringify(securityEventRetentionStatusToJSON(status)),
        ) as JSONObject,
      ),
    ).toEqual(status);
  });

  test("a caller who may not read rules is told the retention alone", () => {
    const withoutRules: SecurityEventRetentionStatus = {
      retentionInDays: 30,
      rulesPastRetention: null,
      hasMoreRulesPastRetention: false,
    };

    expect(
      parseSecurityEventRetentionStatus(
        securityEventRetentionStatusToJSON(withoutRules),
      ),
    ).toEqual(withoutRules);
  });

  test("an answer with no retention is none", () => {
    expect(parseSecurityEventRetentionStatus(null)).toBeNull();
    expect(parseSecurityEventRetentionStatus({})).toBeNull();
    expect(
      parseSecurityEventRetentionStatus({ retentionInDays: 0 }),
    ).toBeNull();
    expect(
      parseSecurityEventRetentionStatus({ retentionInDays: "fifteen" }),
    ).toBeNull();
  });

  test("a rule that does not read is left out", () => {
    expect(
      parseSecurityEventRetentionStatus({
        retentionInDays: 15,
        rulesPastRetention: [
          null,
          "rule",
          { id: "", type: DetectionRuleType.NewValue, lookbackInSeconds: 1 },
          { id: "x", type: "not-a-type", lookbackInSeconds: 1 },
          { id: "y", type: DetectionRuleType.NewValue, lookbackInSeconds: 0 },
          {
            id: "z",
            type: DetectionRuleType.NewValue,
            lookbackInSeconds: 30 * DAY,
          },
        ],
      })?.rulesPastRetention,
    ).toEqual([
      {
        id: "z",
        name: "",
        type: DetectionRuleType.NewValue,
        lookbackInSeconds: 30 * DAY,
      },
    ]);
  });
});
