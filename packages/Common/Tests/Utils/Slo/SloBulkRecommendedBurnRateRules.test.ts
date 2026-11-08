import { describe, expect, test } from "@jest/globals";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  SLO_FAST_BURN_RULE_NAME,
  SLO_SLOW_BURN_RULE_NAME,
  SLO_SLOW_LEAK_RULE_NAME,
  SloRecommendedBurnRateRule,
  SloRecommendedBurnRateRuleToAdd,
  getSloRecommendedBurnRateRules,
  sloRecommendedBurnRateRuleToJSON,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";
import {
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
  SloBulkRecommendedRulesResult,
  SloBulkRecommendedRulesStatus,
  SloBulkRecommendedRulesSummary,
  SloRecommendedRuleCount,
  getSloBulkResultKey,
  parseSloBulkRecommendedRulesResults,
  sloBulkRecommendedRulesResultToJSON,
  summarizeSloBulkRecommendedRules,
} from "../../../Utils/Slo/SloBulkRecommendedBurnRateRules";

/*
 * "Add recommended rules" for many SLOs at once, the part both ends share:
 * the most SLOs one request names, what each SLO's result says on the wire
 * (written by the server, read by the Dashboard), and how the SLO list's
 * confirmation counts which rules the selected SLOs get, in which shapes.
 */

const SLO_A: string = "11111111-1111-4111-8111-111111111111";
const SLO_B: string = "22222222-2222-4222-8222-222222222222";
const SLO_C: string = "33333333-3333-4333-8333-333333333333";
const SLO_D: string = "44444444-4444-4444-8444-444444444444";
const SLO_E: string = "55555555-5555-4555-8555-555555555555";

function rulesFor(
  window: { windowType?: SloWindowType; windowDays?: number },
  severities: { most: string | null; least: string | null } = {
    most: "Critical",
    least: "Low",
  },
): Record<string, SloRecommendedBurnRateRuleToAdd> {
  const byName: Record<string, SloRecommendedBurnRateRuleToAdd> = {};

  for (const rule of getSloRecommendedBurnRateRules(window)) {
    byName[rule.name] = {
      ...rule,
      alertSeverityName:
        rule.name === SLO_SLOW_LEAK_RULE_NAME
          ? severities.least
          : severities.most,
    };
  }

  return byName;
}

const THIRTY_DAYS: Record<string, SloRecommendedBurnRateRuleToAdd> = rulesFor({
  windowDays: 30,
});
const SEVEN_DAYS: Record<string, SloRecommendedBurnRateRuleToAdd> = rulesFor({
  windowDays: 7,
});

function result(
  id: string,
  status: SloBulkRecommendedRulesStatus,
  rules: Array<SloRecommendedBurnRateRuleToAdd> = [],
  message: string | null = null,
): SloBulkRecommendedRulesResult {
  return {
    serviceLevelObjectiveId: id,
    status: status,
    rules: rules,
    message: message,
  };
}

function namesOf(summary: SloBulkRecommendedRulesSummary): Array<string> {
  return summary.rules.map((rule: SloRecommendedRuleCount): string => {
    return rule.name;
  });
}

describe("the most SLOs one request names", () => {
  test("is a hundred: a request that adds to them takes seconds, not minutes", () => {
    expect(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS).toBe(100);
    expect(
      Number.isInteger(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS),
    ).toBe(true);
  });
});

describe("the statuses a result can have", () => {
  test("are the five the docs and the API name", () => {
    expect(Object.values(SloBulkRecommendedRulesStatus)).toEqual([
      "Missing",
      "Added",
      "NothingMissing",
      "Refused",
      "Failed",
    ]);
  });
});

describe("a result on the wire", () => {
  test("carries the SLO, its status, its rules as the one-SLO routes write them, and why", () => {
    const leak: SloRecommendedBurnRateRuleToAdd = {
      ...THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
      id: "66666666-6666-4666-8666-666666666666",
    };

    expect(
      sloBulkRecommendedRulesResultToJSON(
        result(SLO_A, SloBulkRecommendedRulesStatus.Added, [leak]),
      ),
    ).toEqual({
      serviceLevelObjectiveId: SLO_A,
      status: "Added",
      rules: [
        {
          name: "Slow leak",
          budgetPercentage: 10,
          burnRateThreshold: 1,
          longWindowInMinutes: 4320,
          shortWindowInMinutes: 360,
          refireSuppressionMinutes: 1440,
          alertSeverity: "LeastSevere",
          alertSeverityName: "Low",
          id: "66666666-6666-4666-8666-666666666666",
        },
      ],
      message: null,
    });

    expect(
      sloBulkRecommendedRulesResultToJSON(
        result(
          SLO_B,
          SloBulkRecommendedRulesStatus.Refused,
          [],
          "Service Level Objective not found.",
        ),
      ),
    ).toEqual({
      serviceLevelObjectiveId: SLO_B,
      status: "Refused",
      rules: [],
      message: "Service Level Objective not found.",
    });
  });

  test("reads back as it was written, for every status", () => {
    const results: Array<SloBulkRecommendedRulesResult> = [
      result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [
        THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
      ]),
      result(SLO_B, SloBulkRecommendedRulesStatus.Added, [
        { ...SEVEN_DAYS[SLO_FAST_BURN_RULE_NAME]!, id: SLO_E },
      ]),
      result(SLO_C, SloBulkRecommendedRulesStatus.NothingMissing),
      result(SLO_D, SloBulkRecommendedRulesStatus.Refused, [], "Not allowed."),
      result(
        SLO_E,
        SloBulkRecommendedRulesStatus.Failed,
        [THIRTY_DAYS[SLO_FAST_BURN_RULE_NAME]!],
        "Database down.",
      ),
    ];

    const wire: JSONValue = JSON.parse(
      JSON.stringify(results.map(sloBulkRecommendedRulesResultToJSON)),
    ) as JSONValue;

    expect(parseSloBulkRecommendedRulesResults(wire)).toEqual(results);
  });

  test("anything that is not a list reads as no results", () => {
    for (const value of [
      undefined,
      null,
      "results",
      7,
      { results: [] },
    ] as Array<JSONValue | undefined>) {
      expect(parseSloBulkRecommendedRulesResults(value)).toEqual([]);
    }
  });

  test("an entry that names no SLO, or a status this Dashboard does not know, is left out rather than guessed at", () => {
    const valid: JSONObject = sloBulkRecommendedRulesResultToJSON(
      result(SLO_A, SloBulkRecommendedRulesStatus.NothingMissing),
    );

    expect(
      parseSloBulkRecommendedRulesResults([
        null,
        "entry",
        [valid],
        { ...valid, serviceLevelObjectiveId: undefined },
        { ...valid, serviceLevelObjectiveId: "   " },
        { ...valid, serviceLevelObjectiveId: 7 },
        { ...valid, status: "Done" },
        { ...valid, status: "added" },
        { ...valid, status: undefined },
        valid,
      ] as JSONValue),
    ).toEqual([result(SLO_A, SloBulkRecommendedRulesStatus.NothingMissing)]);
  });

  test("an id is read trimmed, a blank message as none, and rules defensively", () => {
    expect(
      parseSloBulkRecommendedRulesResults([
        {
          serviceLevelObjectiveId: `  ${SLO_A} `,
          status: "Missing",
          rules: [
            sloRecommendedBurnRateRuleToJSON(
              THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
            ),
            { name: "No numbers" },
            "rule",
          ],
          message: "   ",
        },
        {
          serviceLevelObjectiveId: SLO_B,
          status: "Refused",
          rules: "none",
          message: 12,
        },
      ] as JSONValue),
    ).toEqual([
      result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [
        THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
      ]),
      result(SLO_B, SloBulkRecommendedRulesStatus.Refused),
    ]);
  });
});

describe("an SLO's id as results are matched by", () => {
  test("is the id trimmed and lower-cased, as Postgres compares ids", () => {
    expect(getSloBulkResultKey(` ${SLO_A.toUpperCase()} `)).toBe(SLO_A);
    expect(getSloBulkResultKey(SLO_A)).toBe(SLO_A);
  });
});

describe("what the confirmation counts", () => {
  test("nothing at all counts as nothing", () => {
    expect(summarizeSloBulkRecommendedRules([])).toEqual({
      withRulesSloCount: 0,
      nothingMissingSloCount: 0,
      refusedSloCount: 0,
      failedSloCount: 0,
      rules: [],
    });
  });

  test("an upgrade: every SLO from before Slow leak gets just Slow leak, in the one shape a 30-day window gives it", () => {
    const leak: SloRecommendedBurnRateRuleToAdd =
      THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!;

    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [leak]),
        result(SLO_B, SloBulkRecommendedRulesStatus.Missing, [leak]),
        result(SLO_C, SloBulkRecommendedRulesStatus.Missing, [leak]),
      ]);

    expect(summary.withRulesSloCount).toBe(3);
    expect(summary.rules).toEqual([
      {
        name: SLO_SLOW_LEAK_RULE_NAME,
        sloCount: 3,
        variants: [
          { rule: leak, serviceLevelObjectiveIds: [SLO_A, SLO_B, SLO_C] },
        ],
      },
    ]);
  });

  test("a rule scaled differently for different windows is counted once, in a shape per window, the most common first", () => {
    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [
          SEVEN_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
        result(SLO_B, SloBulkRecommendedRulesStatus.Missing, [
          THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
        result(SLO_C, SloBulkRecommendedRulesStatus.Missing, [
          THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
      ]);

    expect(summary.rules).toHaveLength(1);

    const leak: SloRecommendedRuleCount = summary.rules[0]!;

    expect(leak.sloCount).toBe(3);
    expect(
      leak.variants.map(
        (variant: SloRecommendedRuleCount["variants"][0]): Array<unknown> => {
          return [
            variant.rule.burnRateThreshold,
            variant.rule.longWindowInMinutes,
            variant.rule.shortWindowInMinutes,
            variant.rule.refireSuppressionMinutes,
            variant.serviceLevelObjectiveIds,
          ];
        },
      ),
    ).toEqual([
      // The 30-day shape: two SLOs.
      [1, 4320, 360, 1440, [SLO_B, SLO_C]],
      // A tenth of a 7-day window: 16.8 hours, still at 1x.
      [1, 1008, 84, 1008, [SLO_A]],
    ]);
  });

  test("Fast burn and Slow burn on a 7-day window and a 30-day one are two shapes each: 3.36x and 14.4x, 1.4x and 6x", () => {
    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [
          SEVEN_DAYS[SLO_FAST_BURN_RULE_NAME]!,
          SEVEN_DAYS[SLO_SLOW_BURN_RULE_NAME]!,
        ]),
        result(SLO_B, SloBulkRecommendedRulesStatus.Missing, [
          THIRTY_DAYS[SLO_FAST_BURN_RULE_NAME]!,
          THIRTY_DAYS[SLO_SLOW_BURN_RULE_NAME]!,
        ]),
      ]);

    expect(
      summary.rules.map((rule: SloRecommendedRuleCount): Array<unknown> => {
        return [
          rule.name,
          rule.sloCount,
          rule.variants.map(
            (variant: SloRecommendedRuleCount["variants"][0]): number => {
              return variant.rule.burnRateThreshold;
            },
          ),
        ];
      }),
    ).toEqual([
      [SLO_FAST_BURN_RULE_NAME, 2, [3.36, 14.4]],
      [SLO_SLOW_BURN_RULE_NAME, 2, [1.4, 6]],
    ]);
  });

  test("lists the rules in the order they are recommended, whatever order the results give them in", () => {
    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [
          THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
        result(SLO_B, SloBulkRecommendedRulesStatus.Missing, [
          THIRTY_DAYS[SLO_SLOW_BURN_RULE_NAME]!,
          THIRTY_DAYS[SLO_FAST_BURN_RULE_NAME]!,
        ]),
        result(SLO_C, SloBulkRecommendedRulesStatus.Missing, [
          {
            ...THIRTY_DAYS[SLO_FAST_BURN_RULE_NAME]!,
            name: "A rule of another name",
          },
        ]),
      ]);

    expect(namesOf(summary)).toEqual([
      SLO_FAST_BURN_RULE_NAME,
      SLO_SLOW_BURN_RULE_NAME,
      SLO_SLOW_LEAK_RULE_NAME,
      "A rule of another name",
    ]);
  });

  test("a rule raising at another severity is another shape: the confirmation says the severity of each", () => {
    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [
          THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
        result(SLO_B, SloBulkRecommendedRulesStatus.Missing, [
          { ...THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!, alertSeverityName: null },
        ]),
      ]);

    expect(summary.rules[0]!.variants).toHaveLength(2);
    expect(summary.rules[0]!.sloCount).toBe(2);
  });

  test("counts the SLOs left alone, those it could not read and those that failed, each once", () => {
    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.NothingMissing),
        result(SLO_B, SloBulkRecommendedRulesStatus.NothingMissing),
        result(SLO_C, SloBulkRecommendedRulesStatus.Refused, [], "Not found."),
        result(SLO_D, SloBulkRecommendedRulesStatus.Failed, [], "Down."),
      ]);

    expect(summary).toEqual({
      withRulesSloCount: 0,
      nothingMissingSloCount: 2,
      refusedSloCount: 1,
      failedSloCount: 1,
      rules: [],
    });
  });

  test("what a failed SLO added before it failed is counted as added", () => {
    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.Added, [
          THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
        result(
          SLO_B,
          SloBulkRecommendedRulesStatus.Failed,
          [THIRTY_DAYS[SLO_FAST_BURN_RULE_NAME]!],
          "Down.",
        ),
      ]);

    expect(summary.withRulesSloCount).toBe(2);
    expect(summary.failedSloCount).toBe(1);
    expect(namesOf(summary)).toEqual([
      SLO_FAST_BURN_RULE_NAME,
      SLO_SLOW_LEAK_RULE_NAME,
    ]);
  });

  test("an SLO named twice is counted once, by its first result, whatever the case of its id", () => {
    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [
          THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
        result(SLO_A.toUpperCase(), SloBulkRecommendedRulesStatus.Refused),
        result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [
          THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
      ]);

    expect(summary.withRulesSloCount).toBe(1);
    expect(summary.refusedSloCount).toBe(0);
    expect(summary.rules[0]!.sloCount).toBe(1);
    expect(summary.rules[0]!.variants[0]!.serviceLevelObjectiveIds).toEqual([
      SLO_A,
    ]);
  });

  test("a rule a response repeats for one SLO is counted once for it", () => {
    const leak: SloRecommendedBurnRateRuleToAdd =
      THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!;

    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [leak, leak]),
      ]);

    expect(summary.rules[0]!.sloCount).toBe(1);
    expect(summary.rules[0]!.variants[0]!.serviceLevelObjectiveIds).toEqual([
      SLO_A,
    ]);
  });

  test("shapes as common as each other keep the order they came up in", () => {
    const shapes: Array<SloRecommendedBurnRateRule> = [7, 14, 28, 30, 90].map(
      (windowDays: number): SloRecommendedBurnRateRule => {
        return getSloRecommendedBurnRateRules({ windowDays })[2]!;
      },
    );

    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules(
        shapes.map(
          (
            shape: SloRecommendedBurnRateRule,
            index: number,
          ): SloBulkRecommendedRulesResult => {
            return result(
              [SLO_A, SLO_B, SLO_C, SLO_D, SLO_E][index]!,
              SloBulkRecommendedRulesStatus.Missing,
              [{ ...shape, alertSeverityName: "Low" }],
            );
          },
        ),
      );

    // One SLO each, so in the order they came: 7, 14, 28, 30 and 90 days.
    expect(
      summary.rules[0]!.variants.map(
        (variant: SloRecommendedRuleCount["variants"][0]): Array<number> => {
          return [
            variant.rule.longWindowInMinutes,
            variant.rule.burnRateThreshold,
          ];
        },
      ),
    ).toEqual([
      [1008, 1],
      [2016, 1],
      [4032, 1],
      [4320, 1],
      // 90 days shares the 3-day windows, but not the threshold.
      [4320, 3],
    ]);
  });

  test("a calendar month counts as the 30-day shape", () => {
    const calendar: Record<string, SloRecommendedBurnRateRuleToAdd> = rulesFor({
      windowType: SloWindowType.CalendarMonth,
    });

    const summary: SloBulkRecommendedRulesSummary =
      summarizeSloBulkRecommendedRules([
        result(SLO_A, SloBulkRecommendedRulesStatus.Missing, [
          calendar[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
        result(SLO_B, SloBulkRecommendedRulesStatus.Missing, [
          THIRTY_DAYS[SLO_SLOW_LEAK_RULE_NAME]!,
        ]),
      ]);

    expect(summary.rules[0]!.variants).toHaveLength(1);
    expect(summary.rules[0]!.variants[0]!.serviceLevelObjectiveIds).toEqual([
      SLO_A,
      SLO_B,
    ]);
  });
});
