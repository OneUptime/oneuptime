import { describe, expect, test } from "@jest/globals";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  SLO_CALENDAR_MONTH_WINDOW_HOURS,
  SLO_FAST_BURN_RULE_NAME,
  SLO_LONG_TO_SHORT_WINDOW_RATIO,
  SLO_SLOW_BURN_RULE_NAME,
  SLO_SLOW_LEAK_MAX_LONG_WINDOW_MINUTES,
  SLO_SLOW_LEAK_REFIRE_SUPPRESSION_MINUTES,
  SLO_SLOW_LEAK_RULE_NAME,
  SloExistingBurnRateRule,
  SloRecommendedAlertSeverity,
  SloRecommendedBurnRateRule,
  SloRecommendedBurnRateRuleToAdd,
  getMissingSloRecommendedBurnRateRules,
  getSloComplianceWindowHours,
  getSloRecommendedBurnRateRules,
  getSloSlowLeakLongWindowInMinutes,
  isSloRecommendedBurnRateRulePresent,
  parseSloRecommendedBurnRateRules,
  pickSloRecommendedAlertSeverities,
  sloRecommendedBurnRateRuleToJSON,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";

/*
 * The burn rate rules OneUptime recommends - Fast burn, Slow burn and Slow
 * leak - scaled to an SLO's window; what makes one "missing" from an SLO; and
 * which alert severity each raises at.
 *
 * Every expected number below is the formula worked by hand, written out:
 * re-deriving the formula in the test would not catch a change to it.
 */

type RulesByName = Record<string, SloRecommendedBurnRateRule>;

function rulesFor(windowDays: number | undefined): RulesByName {
  const byName: RulesByName = {};

  for (const rule of getSloRecommendedBurnRateRules({
    windowType: SloWindowType.Rolling,
    windowDays: windowDays,
  })) {
    byName[rule.name] = rule;
  }

  return byName;
}

function rulesOfCalendarMonth(): RulesByName {
  const byName: RulesByName = {};

  for (const rule of getSloRecommendedBurnRateRules({
    windowType: SloWindowType.CalendarMonth,
  })) {
    byName[rule.name] = rule;
  }

  return byName;
}

interface ExpectedRule {
  burnRateThreshold: number;
  longWindowInMinutes: number;
  shortWindowInMinutes: number;
  refireSuppressionMinutes: number | null;
}

function shapeOf(rule: SloRecommendedBurnRateRule | undefined): ExpectedRule {
  expect(rule).toBeDefined();

  return {
    burnRateThreshold: rule!.burnRateThreshold,
    longWindowInMinutes: rule!.longWindowInMinutes,
    shortWindowInMinutes: rule!.shortWindowInMinutes,
    refireSuppressionMinutes: rule!.refireSuppressionMinutes,
  };
}

describe("the compliance window the rules are scaled to", () => {
  test.each([
    [1, 24],
    [7, 168],
    [14, 336],
    [28, 672],
    [30, 720],
    [90, 2160],
    [366, 8784],
  ])("a %d-day rolling window is %d hours", (days: number, hours: number) => {
    expect(
      getSloComplianceWindowHours({
        windowType: SloWindowType.Rolling,
        windowDays: days,
      }),
    ).toBe(hours);
  });

  test("a calendar month is budgeted as 30 days, whatever its windowDays column holds", () => {
    expect(SLO_CALENDAR_MONTH_WINDOW_HOURS).toBe(720);
    expect(
      getSloComplianceWindowHours({ windowType: SloWindowType.CalendarMonth }),
    ).toBe(720);
    expect(
      getSloComplianceWindowHours({
        windowType: SloWindowType.CalendarMonth,
        windowDays: 7,
      }),
    ).toBe(720);
  });

  test("a rolling window with no length, or none that reads as one, is 30 days - as the worker measures it", () => {
    for (const windowDays of [undefined, null, 0, -3, Number.NaN, "", "abc"]) {
      expect(
        getSloComplianceWindowHours({
          windowType: SloWindowType.Rolling,
          windowDays: windowDays as number | string | null | undefined,
        }),
      ).toBe(720);
    }

    expect(getSloComplianceWindowHours({})).toBe(720);
  });

  test("a window length the API sent as text is read as its number", () => {
    expect(
      getSloComplianceWindowHours({
        windowType: SloWindowType.Rolling,
        windowDays: "28",
      }),
    ).toBe(672);
  });
});

describe("the three recommended rules", () => {
  test("are Fast burn, Slow burn and Slow leak, fastest first", () => {
    expect(
      getSloRecommendedBurnRateRules({
        windowType: SloWindowType.Rolling,
        windowDays: 30,
      }).map((rule: SloRecommendedBurnRateRule): string => {
        return rule.name;
      }),
    ).toEqual(["Fast burn", "Slow burn", "Slow leak"]);

    expect(SLO_FAST_BURN_RULE_NAME).toBe("Fast burn");
    expect(SLO_SLOW_BURN_RULE_NAME).toBe("Slow burn");
    expect(SLO_SLOW_LEAK_RULE_NAME).toBe("Slow leak");
  });

  test("stand for 2%, 5% and 10% of the error budget", () => {
    const rules: RulesByName = rulesFor(30);

    expect(rules["Fast burn"]!.budgetPercentage).toBe(2);
    expect(rules["Slow burn"]!.budgetPercentage).toBe(5);
    expect(rules["Slow leak"]!.budgetPercentage).toBe(10);
  });

  test("page at the most severe alert severity, and Slow leak tickets at the least severe", () => {
    const rules: RulesByName = rulesFor(30);

    expect(rules["Fast burn"]!.alertSeverity).toBe(
      SloRecommendedAlertSeverity.MostSevere,
    );
    expect(rules["Slow burn"]!.alertSeverity).toBe(
      SloRecommendedAlertSeverity.MostSevere,
    );
    expect(rules["Slow leak"]!.alertSeverity).toBe(
      SloRecommendedAlertSeverity.LeastSevere,
    );
  });

  test("leave the re-fire suppression of Fast burn and Slow burn empty, as it always was", () => {
    for (const days of [1, 7, 28, 30, 90]) {
      const rules: RulesByName = rulesFor(days);

      expect(rules["Fast burn"]!.refireSuppressionMinutes).toBeNull();
      expect(rules["Slow burn"]!.refireSuppressionMinutes).toBeNull();
    }
  });

  /*
   * The textbook table, which the docs quote: the SLO windows people use.
   */
  test.each([
    [
      "a 7-day window",
      7,
      {
        fast: {
          burnRateThreshold: 3.36,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
          refireSuppressionMinutes: null,
        },
        slow: {
          burnRateThreshold: 1.4,
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
          refireSuppressionMinutes: null,
        },
        // A tenth of 7 days: 16.8 hours over 84 minutes, at 1x.
        leak: {
          burnRateThreshold: 1,
          longWindowInMinutes: 1008,
          shortWindowInMinutes: 84,
          refireSuppressionMinutes: 1008,
        },
      },
    ],
    [
      "a 14-day window",
      14,
      {
        fast: {
          burnRateThreshold: 6.72,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
          refireSuppressionMinutes: null,
        },
        slow: {
          burnRateThreshold: 2.8,
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
          refireSuppressionMinutes: null,
        },
        // 33.6 hours over 2.8 hours: longer than a day, so 24 hours of quiet.
        leak: {
          burnRateThreshold: 1,
          longWindowInMinutes: 2016,
          shortWindowInMinutes: 168,
          refireSuppressionMinutes: 1440,
        },
      },
    ],
    [
      "a 28-day window",
      28,
      {
        fast: {
          burnRateThreshold: 13.44,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
          refireSuppressionMinutes: null,
        },
        slow: {
          burnRateThreshold: 5.6,
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
          refireSuppressionMinutes: null,
        },
        // 2.8 days over 5.6 hours - not 3 days at 0.93x.
        leak: {
          burnRateThreshold: 1,
          longWindowInMinutes: 4032,
          shortWindowInMinutes: 336,
          refireSuppressionMinutes: 1440,
        },
      },
    ],
    [
      "a 30-day window, the Workbook's own 14.4x, 6x and 1x",
      30,
      {
        fast: {
          burnRateThreshold: 14.4,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
          refireSuppressionMinutes: null,
        },
        slow: {
          burnRateThreshold: 6,
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
          refireSuppressionMinutes: null,
        },
        leak: {
          burnRateThreshold: 1,
          longWindowInMinutes: 4320,
          shortWindowInMinutes: 360,
          refireSuppressionMinutes: 1440,
        },
      },
    ],
    [
      "a 90-day window",
      90,
      {
        fast: {
          burnRateThreshold: 43.2,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
          refireSuppressionMinutes: null,
        },
        slow: {
          burnRateThreshold: 18,
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
          refireSuppressionMinutes: null,
        },
        // Still 3 days and 6 hours: 10% of a 90-day budget in 3 days is 3x.
        leak: {
          burnRateThreshold: 3,
          longWindowInMinutes: 4320,
          shortWindowInMinutes: 360,
          refireSuppressionMinutes: 1440,
        },
      },
    ],
  ])(
    "are scaled to %s",
    (
      _label: string,
      days: number,
      expected: {
        fast: ExpectedRule;
        slow: ExpectedRule;
        leak: ExpectedRule;
      },
    ) => {
      const rules: RulesByName = rulesFor(days);

      expect(shapeOf(rules["Fast burn"])).toEqual(expected.fast);
      expect(shapeOf(rules["Slow burn"])).toEqual(expected.slow);
      expect(shapeOf(rules["Slow leak"])).toEqual(expected.leak);
    },
  );

  test("are scaled to a calendar month as to 30 days", () => {
    const rules: RulesByName = rulesOfCalendarMonth();

    expect(shapeOf(rules["Fast burn"])).toEqual(shapeOf(rulesFor(30)["Fast burn"]));
    expect(shapeOf(rules["Slow burn"])).toEqual(shapeOf(rulesFor(30)["Slow burn"]));
    expect(shapeOf(rules["Slow leak"])).toEqual({
      burnRateThreshold: 1,
      longWindowInMinutes: 4320,
      shortWindowInMinutes: 360,
      refireSuppressionMinutes: 1440,
    });
  });

  test("are scaled to 30 days for a rolling window with no length", () => {
    expect(getSloRecommendedBurnRateRules({ windowType: SloWindowType.Rolling })).toEqual(
      getSloRecommendedBurnRateRules({
        windowType: SloWindowType.Rolling,
        windowDays: 30,
      }),
    );
  });

  test("give a 1-day SLO a slow leak over 2.4 hours, quiet for one long window after it resolves", () => {
    expect(shapeOf(rulesFor(1)["Slow leak"])).toEqual({
      burnRateThreshold: 1,
      longWindowInMinutes: 144,
      shortWindowInMinutes: 12,
      refireSuppressionMinutes: 144,
    });
  });

  test("reach 24 hours of quiet exactly where the long window reaches a day: 10 days", () => {
    expect(shapeOf(rulesFor(9)["Slow leak"]).refireSuppressionMinutes).toBe(
      1296,
    );
    expect(shapeOf(rulesFor(10)["Slow leak"])).toEqual({
      burnRateThreshold: 1,
      longWindowInMinutes: 1440,
      shortWindowInMinutes: 120,
      refireSuppressionMinutes: 1440,
    });
  });

  test("let Slow leak's threshold grow above 1x only past 30 days, with its windows held at 3 days and 6 hours", () => {
    expect(shapeOf(rulesFor(29)["Slow leak"])).toEqual({
      burnRateThreshold: 1,
      longWindowInMinutes: 4176,
      shortWindowInMinutes: 348,
      refireSuppressionMinutes: 1440,
    });
    expect(rulesFor(31)["Slow leak"]!.burnRateThreshold).toBe(1.03);
    expect(rulesFor(365)["Slow leak"]!.burnRateThreshold).toBe(12.17);
    expect(rulesFor(366)["Slow leak"]!.burnRateThreshold).toBe(12.2);

    for (const days of [31, 60, 365, 366]) {
      expect(rulesFor(days)["Slow leak"]!.longWindowInMinutes).toBe(4320);
      expect(rulesFor(days)["Slow leak"]!.shortWindowInMinutes).toBe(360);
    }
  });

  test("keep the thresholds Fast burn and Slow burn were always seeded with, for every window", () => {
    for (let days: number = 1; days <= 366; days++) {
      const rules: RulesByName = rulesFor(days);

      expect(rules["Fast burn"]!.burnRateThreshold).toBe(
        Math.round(0.02 * days * 24 * 100) / 100,
      );
      expect(rules["Slow burn"]!.burnRateThreshold).toBe(
        Math.round(((0.05 * days * 24) / 6) * 100) / 100,
      );
    }
  });

  /*
   * Every window an SLO can have (1 to 366 days): what the columns and the
   * worker require of a rule, and what Slow leak promises.
   */
  test("are valid rules for every SLO window, with Slow leak never below 1x", () => {
    for (let days: number = 1; days <= 366; days++) {
      const windowHours: number = days * 24;

      for (const rule of getSloRecommendedBurnRateRules({
        windowType: SloWindowType.Rolling,
        windowDays: days,
      })) {
        // Integer columns, and the service's own window rules.
        expect(Number.isInteger(rule.longWindowInMinutes)).toBe(true);
        expect(Number.isInteger(rule.shortWindowInMinutes)).toBe(true);
        expect(rule.shortWindowInMinutes).toBeGreaterThan(0);
        expect(rule.longWindowInMinutes).toBeGreaterThan(
          rule.shortWindowInMinutes,
        );
        expect(rule.burnRateThreshold).toBeGreaterThan(0);

        // The Workbook's 12:1 between the windows.
        expect(rule.longWindowInMinutes / rule.shortWindowInMinutes).toBe(
          SLO_LONG_TO_SHORT_WINDOW_RATIO,
        );

        // The threshold still spends the rule's share of the budget in its long window.
        expect(
          (rule.burnRateThreshold * (rule.longWindowInMinutes / 60)) /
            windowHours,
        ).toBeCloseTo(rule.budgetPercentage / 100, 2);
      }

      const leak: SloRecommendedBurnRateRule = rulesFor(days)["Slow leak"]!;

      expect(leak.burnRateThreshold).toBeGreaterThanOrEqual(1);
      expect(leak.longWindowInMinutes).toBeLessThanOrEqual(
        SLO_SLOW_LEAK_MAX_LONG_WINDOW_MINUTES,
      );
      expect(leak.longWindowInMinutes).toBe(
        getSloSlowLeakLongWindowInMinutes({
          windowType: SloWindowType.Rolling,
          windowDays: days,
        }),
      );

      if (days <= 30) {
        expect(leak.burnRateThreshold).toBe(1);
        expect(leak.longWindowInMinutes).toBe(days * 144);
      } else {
        expect(leak.longWindowInMinutes).toBe(4320);
      }

      expect(leak.refireSuppressionMinutes).toBe(
        Math.min(SLO_SLOW_LEAK_REFIRE_SUPPRESSION_MINUTES, leak.longWindowInMinutes),
      );
      expect(Number.isInteger(leak.refireSuppressionMinutes)).toBe(true);
    }
  });

  test("order the tiers fastest first wherever the window is long enough for the formula to tell them apart", () => {
    for (let days: number = 7; days <= 366; days++) {
      const rules: RulesByName = rulesFor(days);

      expect(rules["Fast burn"]!.burnRateThreshold).toBeGreaterThan(
        rules["Slow burn"]!.burnRateThreshold,
      );
      expect(rules["Slow burn"]!.burnRateThreshold).toBeGreaterThan(
        rules["Slow leak"]!.burnRateThreshold,
      );
      expect(rules["Slow leak"]!.longWindowInMinutes).toBeGreaterThan(
        rules["Slow burn"]!.longWindowInMinutes,
      );
    }
  });

  test("are new objects on every call, so a caller cannot change the next one's", () => {
    const first: Array<SloRecommendedBurnRateRule> =
      getSloRecommendedBurnRateRules({ windowDays: 30 });

    first[0]!.burnRateThreshold = 999;
    first.pop();

    expect(getSloRecommendedBurnRateRules({ windowDays: 30 })).toHaveLength(3);
    expect(
      getSloRecommendedBurnRateRules({ windowDays: 30 })[0]!.burnRateThreshold,
    ).toBe(14.4);
  });
});

describe("whether an SLO already has a recommended rule", () => {
  const WINDOW: { windowType: SloWindowType; windowDays: number } = {
    windowType: SloWindowType.Rolling,
    windowDays: 30,
  };

  function missingNames(
    existingRules: Array<SloExistingBurnRateRule>,
    window: { windowType?: SloWindowType; windowDays?: number } = WINDOW,
  ): Array<string> {
    return getMissingSloRecommendedBurnRateRules({
      window: window,
      existingRules: existingRules,
    }).map((rule: SloRecommendedBurnRateRule): string => {
      return rule.name;
    });
  }

  test("an SLO with no rules is missing all three", () => {
    expect(missingNames([])).toEqual(["Fast burn", "Slow burn", "Slow leak"]);
  });

  test("an SLO created before Slow leak existed is missing just that one", () => {
    expect(
      missingNames([
        { name: "Fast burn", longWindowInMinutes: 60 },
        { name: "Slow burn", longWindowInMinutes: 360 },
      ]),
    ).toEqual(["Slow leak"]);
  });

  test("an SLO with all three is missing none", () => {
    expect(
      missingNames([
        { name: "Fast burn", longWindowInMinutes: 60 },
        { name: "Slow burn", longWindowInMinutes: 360 },
        { name: "Slow leak", longWindowInMinutes: 4320 },
      ]),
    ).toEqual([]);
  });

  test("a renamed default rule still counts by its window, so it is not added twice", () => {
    expect(
      missingNames([
        { name: "Page: fast burn", longWindowInMinutes: 60 },
        { name: "Slow burn", longWindowInMinutes: 360 },
      ]),
    ).toEqual(["Slow leak"]);
  });

  test("a tuned default rule still counts by its name, whatever windows it now has", () => {
    expect(
      missingNames([
        { name: "Fast burn", longWindowInMinutes: 30 },
        { name: "Slow burn", longWindowInMinutes: 240 },
        { name: "Slow leak", longWindowInMinutes: 2880 },
      ]),
    ).toEqual([]);
  });

  test("names are compared without case or surrounding spaces", () => {
    expect(
      missingNames([
        { name: "  FAST BURN ", longWindowInMinutes: 15 },
        { name: "slow Burn", longWindowInMinutes: 15 },
        { name: "Slow Leak\t", longWindowInMinutes: 15 },
      ]),
    ).toEqual([]);
  });

  test("a rule written by hand over Slow leak's window already covers that tier", () => {
    expect(
      missingNames([
        { name: "Fast burn", longWindowInMinutes: 60 },
        { name: "Slow burn", longWindowInMinutes: 360 },
        { name: "Ticket: budget leaking", longWindowInMinutes: 4320 },
      ]),
    ).toEqual([]);
  });

  test("a long window the database handed back as text is read as its number", () => {
    expect(
      missingNames([
        { name: "One", longWindowInMinutes: "60" },
        { name: "Two", longWindowInMinutes: "360" },
        { name: "Three", longWindowInMinutes: "4320" },
      ]),
    ).toEqual([]);
  });

  test("a rule both renamed and moved to another window reads as missing", () => {
    expect(
      missingNames([
        { name: "Paging", longWindowInMinutes: 30 },
        { name: "Slow burn", longWindowInMinutes: 360 },
        { name: "Slow leak", longWindowInMinutes: 4320 },
      ]),
    ).toEqual(["Fast burn"]);
  });

  test("Slow leak is matched by the window it has for THIS SLO's length", () => {
    // A 7-day SLO's slow leak looks back 16.8 hours, not 3 days.
    expect(
      missingNames(
        [
          { name: "Fast burn", longWindowInMinutes: 60 },
          { name: "Slow burn", longWindowInMinutes: 360 },
          { name: "Ticket", longWindowInMinutes: 1008 },
        ],
        { windowType: SloWindowType.Rolling, windowDays: 7 },
      ),
    ).toEqual([]);

    // A 3-day rule under another name does not cover a 7-day SLO's slow leak.
    expect(
      missingNames(
        [
          { name: "Fast burn", longWindowInMinutes: 60 },
          { name: "Slow burn", longWindowInMinutes: 360 },
          { name: "Ticket", longWindowInMinutes: 4320 },
        ],
        { windowType: SloWindowType.Rolling, windowDays: 7 },
      ),
    ).toEqual(["Slow leak"]);

    // Its own name always does, whichever window it was created with.
    expect(
      missingNames(
        [
          { name: "Fast burn", longWindowInMinutes: 60 },
          { name: "Slow burn", longWindowInMinutes: 360 },
          { name: "Slow leak", longWindowInMinutes: 4320 },
        ],
        { windowType: SloWindowType.Rolling, windowDays: 7 },
      ),
    ).toEqual([]);
  });

  test("the missing rules come scaled to the SLO's window", () => {
    const missing: Array<SloRecommendedBurnRateRule> =
      getMissingSloRecommendedBurnRateRules({
        window: { windowType: SloWindowType.Rolling, windowDays: 28 },
        existingRules: [
          { name: "Fast burn", longWindowInMinutes: 60 },
          { name: "Slow burn", longWindowInMinutes: 360 },
        ],
      });

    expect(missing).toEqual([
      {
        name: "Slow leak",
        budgetPercentage: 10,
        burnRateThreshold: 1,
        longWindowInMinutes: 4032,
        shortWindowInMinutes: 336,
        refireSuppressionMinutes: 1440,
        alertSeverity: SloRecommendedAlertSeverity.LeastSevere,
      },
    ]);
  });

  test("a rule with no name and no window covers nothing", () => {
    expect(
      missingNames([
        {},
        { name: null, longWindowInMinutes: null },
        { name: "", longWindowInMinutes: 0 },
        { name: "   ", longWindowInMinutes: Number.NaN },
      ]),
    ).toEqual(["Fast burn", "Slow burn", "Slow leak"]);
  });

  test("isSloRecommendedBurnRateRulePresent answers for one rule", () => {
    const leak: SloRecommendedBurnRateRule = rulesFor(30)["Slow leak"]!;

    expect(
      isSloRecommendedBurnRateRulePresent({
        recommended: leak,
        existingRules: [{ name: "Fast burn", longWindowInMinutes: 60 }],
      }),
    ).toBe(false);
    expect(
      isSloRecommendedBurnRateRulePresent({
        recommended: leak,
        existingRules: [{ name: "x", longWindowInMinutes: 4320 }],
      }),
    ).toBe(true);
    expect(
      isSloRecommendedBurnRateRulePresent({
        recommended: leak,
        existingRules: [{ name: "slow leak", longWindowInMinutes: 1 }],
      }),
    ).toBe(true);
  });
});

describe("the alert severities the recommended rules raise at", () => {
  interface Severity {
    name: string;
    order?: number | null | undefined;
  }

  function severity(name: string, order?: number | null): Severity {
    return order === undefined ? { name } : { name, order };
  }

  test("a project with no severity has neither", () => {
    expect(pickSloRecommendedAlertSeverities<Severity>([])).toEqual({
      mostSevere: null,
      leastSevere: null,
    });
  });

  test("most severe is the lowest order and least severe the highest, in whatever order they arrive", () => {
    const picked: { mostSevere: Severity | null; leastSevere: Severity | null } =
      pickSloRecommendedAlertSeverities<Severity>([
        severity("Minor", 3),
        severity("Critical", 1),
        severity("Low", 4),
        severity("Major", 2),
      ]);

    expect(picked.mostSevere?.name).toBe("Critical");
    expect(picked.leastSevere?.name).toBe("Low");
  });

  test("a project with one severity raises every rule at it", () => {
    const only: Severity = severity("Critical", 1);

    expect(pickSloRecommendedAlertSeverities<Severity>([only])).toEqual({
      mostSevere: only,
      leastSevere: only,
    });
  });

  test("a severity with no order is never taken for the least severe", () => {
    const picked: { mostSevere: Severity | null; leastSevere: Severity | null } =
      pickSloRecommendedAlertSeverities<Severity>([
        severity("Unordered", null),
        severity("Critical", 1),
        severity("Also unordered"),
        severity("Warning", 2),
      ]);

    expect(picked.mostSevere?.name).toBe("Critical");
    expect(picked.leastSevere?.name).toBe("Warning");
  });

  test("with no ordered severity at all, both are the one the old lookup took", () => {
    const first: Severity = severity("First", null);

    expect(
      pickSloRecommendedAlertSeverities<Severity>([
        first,
        severity("Second", null),
      ]),
    ).toEqual({ mostSevere: first, leastSevere: first });
  });

  test("ties keep the order they arrived in", () => {
    const picked: { mostSevere: Severity | null; leastSevere: Severity | null } =
      pickSloRecommendedAlertSeverities<Severity>([
        severity("Critical A", 1),
        severity("Critical B", 1),
        severity("Low A", 5),
        severity("Low B", 5),
      ]);

    expect(picked.mostSevere?.name).toBe("Critical A");
    expect(picked.leastSevere?.name).toBe("Low B");
  });

  test("the list it is handed is left as it was", () => {
    const severities: Array<Severity> = [
      severity("Low", 4),
      severity("Critical", 1),
    ];

    pickSloRecommendedAlertSeverities<Severity>(severities);

    expect(
      severities.map((item: Severity): string => {
        return item.name;
      }),
    ).toEqual(["Low", "Critical"]);
  });
});

describe("the recommended rules as the API sends them", () => {
  const SLOW_LEAK: SloRecommendedBurnRateRuleToAdd = {
    ...rulesFor(30)["Slow leak"]!,
    alertSeverityName: "Low",
  };

  test("round-trip through JSON", () => {
    const json: JSONObject = sloRecommendedBurnRateRuleToJSON(SLOW_LEAK);

    expect(json).toEqual({
      name: "Slow leak",
      budgetPercentage: 10,
      burnRateThreshold: 1,
      longWindowInMinutes: 4320,
      shortWindowInMinutes: 360,
      refireSuppressionMinutes: 1440,
      alertSeverity: "LeastSevere",
      alertSeverityName: "Low",
    });

    expect(
      parseSloRecommendedBurnRateRules(JSON.parse(JSON.stringify([json]))),
    ).toEqual([SLOW_LEAK]);
  });

  test("carry the id of a rule the request created", () => {
    const json: JSONObject = sloRecommendedBurnRateRuleToJSON({
      ...SLOW_LEAK,
      id: "rule-1",
    });

    expect(json["id"]).toBe("rule-1");
    expect(parseSloRecommendedBurnRateRules([json])[0]!.id).toBe("rule-1");
    expect(sloRecommendedBurnRateRuleToJSON(SLOW_LEAK)["id"]).toBeUndefined();
  });

  test("a rule with an empty suppression or no severity reads back as such", () => {
    const fastBurn: SloRecommendedBurnRateRuleToAdd = {
      ...rulesFor(30)["Fast burn"]!,
      alertSeverityName: null,
    };

    expect(
      parseSloRecommendedBurnRateRules([
        sloRecommendedBurnRateRuleToJSON(fastBurn),
      ]),
    ).toEqual([fastBurn]);
  });

  test("anything that is not a list of rules reads as none", () => {
    for (const value of [
      undefined,
      null,
      "rules",
      7,
      {},
      { rules: [] },
    ] as Array<JSONValue | undefined>) {
      expect(parseSloRecommendedBurnRateRules(value)).toEqual([]);
    }
  });

  test("an entry without a name, a threshold or its windows is left out", () => {
    const good: JSONObject = sloRecommendedBurnRateRuleToJSON(SLOW_LEAK);

    expect(
      parseSloRecommendedBurnRateRules([
        null,
        "Slow leak",
        [good],
        { ...good, name: "" },
        { ...good, name: "  " },
        { ...good, name: 5 },
        { ...good, burnRateThreshold: "1" },
        { ...good, longWindowInMinutes: null },
        { ...good, shortWindowInMinutes: Number.NaN },
        good,
      ] as Array<JSONValue>),
    ).toEqual([SLOW_LEAK]);
  });

  test("a severity it does not know reads as the most severe, and a blank severity name as none", () => {
    const parsed: Array<SloRecommendedBurnRateRuleToAdd> =
      parseSloRecommendedBurnRateRules([
        {
          ...sloRecommendedBurnRateRuleToJSON(SLOW_LEAK),
          alertSeverity: "Whatever",
          alertSeverityName: "   ",
          budgetPercentage: "ten",
          refireSuppressionMinutes: "1440",
        },
      ]);

    expect(parsed[0]!.alertSeverity).toBe(
      SloRecommendedAlertSeverity.MostSevere,
    );
    expect(parsed[0]!.alertSeverityName).toBeNull();
    expect(parsed[0]!.budgetPercentage).toBe(0);
    expect(parsed[0]!.refireSuppressionMinutes).toBeNull();
  });
});
