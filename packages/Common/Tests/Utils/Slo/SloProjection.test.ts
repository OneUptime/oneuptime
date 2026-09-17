import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  getSloBudgetTier,
  isRollingWindowNotYetFull,
  SloBudgetTier,
} from "../../../Utils/Slo/SloHealth";
import {
  getLowestBurnRateThreshold,
  getRollingWindowFill,
  getRollingWindowFillFraction,
  getSliDeltaPercentagePoints,
  getSliDeltaText,
  getSloAllowedDowntime,
  getSloBudgetBarGeometry,
  getSloBudgetRunway,
  getSloChartBucketSeconds,
  getSloComplianceWindowRange,
  getSloIdealBurnPoints,
  isBurnRateAtOrAboveThreshold,
  isSliBelowTarget,
  SloAllowedDowntime,
  SloBudgetBarGeometry,
  SloBudgetRunway,
  SloBudgetRunwayData,
  SloBudgetRunwayKind,
  SloComplianceWindowRange,
  SloIdealBurnPoint,
  SloProjectionTone,
  SloRollingWindowFill,
  SloRollingWindowFillData,
} from "../../../Utils/Slo/SloProjection";
import { describe, expect, test } from "@jest/globals";

/*
 * The SLO overview's forward-looking numbers. Every clock is fixed and every
 * calendar case names its timezone, so nothing here depends on when or where
 * the suite runs.
 */

const DAY_SECONDS: number = 24 * 60 * 60;

// A Tuesday in mid-September: 15.5 days before the UTC month resets.
const NOW: Date = new Date("2026-09-15T12:00:00.000Z");
const SECONDS_UNTIL_UTC_RESET: number = 15.5 * DAY_SECONDS;

type RunwayFunction = (
  overrides: Partial<SloBudgetRunwayData>,
) => SloBudgetRunway;

const runway: RunwayFunction = (
  overrides: Partial<SloBudgetRunwayData>,
): SloBudgetRunway => {
  return getSloBudgetRunway({
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    timezone: "UTC",
    targetPercentage: 99.9,
    multiMonitorMode: SloMultiMonitorMode.AnyDown,
    errorBudgetRemainingSeconds: 1300,
    currentBurnRate: 2,
    now: NOW,
    ...overrides,
  });
};

describe("getRollingWindowFillFraction", () => {
  // 99.9% over 30 days allows 2592 seconds of downtime.
  const base: SloRollingWindowFillData = {
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    errorBudgetTotalSeconds: 648,
    multiMonitorMode: SloMultiMonitorMode.AnyDown,
  };

  test("is the prorated budget over the full-window budget", () => {
    expect(getRollingWindowFillFraction(base)).toBeCloseTo(0.25, 9);
  });

  test("clamps a budget slightly over the full window to 1", () => {
    expect(
      getRollingWindowFillFraction({ ...base, errorBudgetTotalSeconds: 3000 }),
    ).toBe(1);
  });

  test("uses the 30-day default when windowDays is missing", () => {
    expect(
      getRollingWindowFillFraction({ ...base, windowDays: null }),
    ).toBeCloseTo(0.25, 9);
    expect(
      getRollingWindowFillFraction({ ...base, windowDays: undefined }),
    ).toBeCloseTo(0.25, 9);
  });

  test("does not apply to calendar months, whose budget is never prorated", () => {
    expect(
      getRollingWindowFillFraction({
        ...base,
        windowType: SloWindowType.CalendarMonth,
      }),
    ).toBeNull();
  });

  test("does not apply to Monitor Seconds Average, whose budget sums monitors", () => {
    expect(
      getRollingWindowFillFraction({
        ...base,
        multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
      }),
    ).toBeNull();
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["zero", 0],
    ["negative", -10],
    ["NaN", NaN],
  ])(
    "is null when the budget total is %s",
    (_label: string, total: number | null | undefined) => {
      expect(
        getRollingWindowFillFraction({
          ...base,
          errorBudgetTotalSeconds: total,
        }),
      ).toBeNull();
    },
  );

  test.each([
    ["missing", null],
    ["zero", 0],
    ["one hundred", 100],
    ["above one hundred", 120],
  ])(
    "is null when the target is %s",
    (_label: string, target: number | null) => {
      expect(
        getRollingWindowFillFraction({ ...base, targetPercentage: target }),
      ).toBeNull();
    },
  );

  test("is null for a window of zero or negative days", () => {
    expect(getRollingWindowFillFraction({ ...base, windowDays: 0 })).toBeNull();
    expect(
      getRollingWindowFillFraction({ ...base, windowDays: -5 }),
    ).toBeNull();
  });

  /*
   * The chip that replaced the "Window not yet full" banner must appear in
   * exactly the cases the banner did. Fractions are kept clear of the 0.99
   * boundary itself, where the two computations can differ in the last bit.
   */
  describe("agrees with SloHealth.isRollingWindowNotYetFull", () => {
    const cases: Array<[number, number, number]> = [];

    for (const windowDays of [1, 7, 30, 90]) {
      for (const target of [90, 99, 99.5, 99.9, 99.99]) {
        for (const fraction of [
          0.0001, 0.1, 0.5, 0.9, 0.98, 0.9899, 0.9901, 0.995, 1, 1.3,
        ]) {
          cases.push([windowDays, target, fraction]);
        }
      }
    }

    test.each(cases)(
      "%d days at %d%% with %d of the window filled",
      (windowDays: number, target: number, fraction: number) => {
        const data: SloRollingWindowFillData = {
          windowType: SloWindowType.Rolling,
          windowDays: windowDays,
          targetPercentage: target,
          errorBudgetTotalSeconds:
            fraction * (1 - target / 100) * windowDays * DAY_SECONDS,
          multiMonitorMode: SloMultiMonitorMode.AnyDown,
        };

        const computed: number | null = getRollingWindowFillFraction(data);

        expect(computed).not.toBeNull();
        expect(computed! < 0.99).toBe(isRollingWindowNotYetFull(data));
      },
    );
  });
});

describe("getRollingWindowFill", () => {
  const base: SloRollingWindowFillData = {
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    errorBudgetTotalSeconds: 648,
    multiMonitorMode: SloMultiMonitorMode.AnyDown,
  };

  test("labels a young window with a floored percentage", () => {
    const fill: SloRollingWindowFill | null = getRollingWindowFill(base);

    expect(fill).not.toBeNull();
    // Exactly a quarter must not float-floor to 24%.
    expect(fill!.percent).toBe(25);
    expect(fill!.label).toBe("Window 25% full");
    expect(fill!.isNotYetFull).toBe(true);
  });

  test("never rounds a nearly full window up to 100%", () => {
    const fill: SloRollingWindowFill | null = getRollingWindowFill({
      ...base,
      errorBudgetTotalSeconds: 2592 * 0.995,
    });

    expect(fill!.percent).toBe(99);
    // Within the 1% tolerance: mature, so the hint is not shown.
    expect(fill!.isNotYetFull).toBe(false);
  });

  test("says 'under 1%' for a brand-new SLO rather than '0% full'", () => {
    const fill: SloRollingWindowFill | null = getRollingWindowFill({
      ...base,
      errorBudgetTotalSeconds: 10,
    });

    expect(fill!.percent).toBe(0);
    expect(fill!.label).toBe("Window under 1% full");
    expect(fill!.isNotYetFull).toBe(true);
  });

  test("is null whenever the fraction is", () => {
    expect(
      getRollingWindowFill({
        ...base,
        windowType: SloWindowType.CalendarMonth,
      }),
    ).toBeNull();
    expect(
      getRollingWindowFill({ ...base, errorBudgetTotalSeconds: null }),
    ).toBeNull();
  });
});

describe("getSloBudgetRunway", () => {
  describe("placeholders", () => {
    test("says 'not evaluated' until the worker has written the budget", () => {
      expect(runway({ errorBudgetRemainingSeconds: null })).toEqual({
        kind: SloBudgetRunwayKind.NotEvaluated,
        tone: SloProjectionTone.Neutral,
        value: "—",
        description: "Not evaluated yet",
        runwaySeconds: null,
        secondsUntilReset: null,
      });
    });

    test("says 'not evaluated' while the burn rate is missing or not a number", () => {
      expect(runway({ currentBurnRate: undefined }).kind).toBe(
        SloBudgetRunwayKind.NotEvaluated,
      );
      expect(runway({ currentBurnRate: NaN }).kind).toBe(
        SloBudgetRunwayKind.NotEvaluated,
      );
      expect(runway({ errorBudgetRemainingSeconds: Infinity }).kind).toBe(
        SloBudgetRunwayKind.NotEvaluated,
      );
    });

    test("hides the projection for Monitor Seconds Average, whose seconds are monitor-seconds", () => {
      expect(
        runway({ multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage }),
      ).toEqual({
        kind: SloBudgetRunwayKind.NotProjected,
        tone: SloProjectionTone.Neutral,
        value: "—",
        description: "Not projected when downtime is averaged across monitors",
        runwaySeconds: null,
        secondsUntilReset: null,
      });
    });

    test.each([[null], [0], [100], [101]])(
      "does not project with an unusable target (%p)",
      (target: number | null) => {
        const result: SloBudgetRunway = runway({ targetPercentage: target });

        expect(result.kind).toBe(SloBudgetRunwayKind.NotProjected);
        expect(result.description).toBe("Needs a target between 0% and 100%");
      },
    );
  });

  describe("overspent", () => {
    test("says by how much a rolling budget is over", () => {
      expect(runway({ errorBudgetRemainingSeconds: -750 })).toEqual({
        kind: SloBudgetRunwayKind.Overspent,
        tone: SloProjectionTone.Danger,
        value: "Overspent",
        description: "12m 30s over budget",
        runwaySeconds: 0,
        secondsUntilReset: null,
      });
    });

    test("an exactly empty budget is spent, not overspent by 0s", () => {
      const result: SloBudgetRunway = runway({
        errorBudgetRemainingSeconds: 0,
      });

      expect(result.kind).toBe(SloBudgetRunwayKind.Overspent);
      expect(result.description).toBe("Budget fully spent");
    });

    test("a calendar month also says when the budget comes back", () => {
      const result: SloBudgetRunway = runway({
        windowType: SloWindowType.CalendarMonth,
        errorBudgetRemainingSeconds: -750,
      });

      expect(result.description).toBe(
        "12m 30s over budget · resets in 15d 12h",
      );
      expect(result.secondsUntilReset).toBe(SECONDS_UNTIL_UTC_RESET);
    });

    test("overspent wins even when nothing is burning right now", () => {
      expect(
        runway({ errorBudgetRemainingSeconds: -1, currentBurnRate: 0 }).kind,
      ).toBe(SloBudgetRunwayKind.Overspent);
    });
  });

  describe("not burning", () => {
    test("names the lookback the burn rate was measured over", () => {
      expect(runway({ currentBurnRate: 0 })).toEqual({
        kind: SloBudgetRunwayKind.NotBurning,
        tone: SloProjectionTone.Good,
        value: "Not burning",
        description: "No budget spent in the last 1h",
        runwaySeconds: null,
        secondsUntilReset: null,
      });
    });

    test("treats an impossible negative burn as no burn", () => {
      expect(runway({ currentBurnRate: -3 }).kind).toBe(
        SloBudgetRunwayKind.NotBurning,
      );
    });

    test("a calendar month adds the reset", () => {
      expect(
        runway({
          windowType: SloWindowType.CalendarMonth,
          currentBurnRate: 0,
        }).description,
      ).toBe("No budget spent in the last 1h · resets in 15d 12h");
    });
  });

  describe("rolling windows", () => {
    test("projects remaining / (burn x allowed) and flags a multi-day runway as a warning", () => {
      // 1300 / (2 x 0.001) = 650,000s = 7d 12h 33m 20s.
      const result: SloBudgetRunway = runway({
        errorBudgetRemainingSeconds: 1300,
        currentBurnRate: 2,
      });

      expect(result.kind).toBe(SloBudgetRunwayKind.RunsOut);
      expect(result.tone).toBe(SloProjectionTone.Warning);
      expect(result.value).toBe("~7d 12h");
      expect(result.description).toBe(
        "Until exhausted, at the burn rate of the last 1h",
      );
      expect(result.runwaySeconds).toBeCloseTo(650000, 3);
      expect(result.secondsUntilReset).toBeNull();
    });

    test("a runway of a day or less is an emergency", () => {
      // 30 / (14.4 x 0.001) = 2083.3s.
      const result: SloBudgetRunway = runway({
        errorBudgetRemainingSeconds: 30,
        currentBurnRate: 14.4,
      });

      expect(result.tone).toBe(SloProjectionTone.Danger);
      expect(result.value).toBe("~34m 43s");
    });

    test("exactly one day is still danger; just over a day is a warning", () => {
      // Target 75% leaves an exact 0.25, so these runways are exact.
      expect(
        runway({
          targetPercentage: 75,
          errorBudgetRemainingSeconds: 0.25 * DAY_SECONDS,
          currentBurnRate: 1,
        }).tone,
      ).toBe(SloProjectionTone.Danger);

      expect(
        runway({
          targetPercentage: 75,
          errorBudgetRemainingSeconds: 0.25 * DAY_SECONDS + 1,
          currentBurnRate: 1,
        }).tone,
      ).toBe(SloProjectionTone.Warning);
    });

    test("under a minute reads 'Under 1m', not '~0s'", () => {
      const result: SloBudgetRunway = runway({
        targetPercentage: 75,
        errorBudgetRemainingSeconds: 10,
        currentBurnRate: 1,
      });

      expect(result.value).toBe("Under 1m");
      expect(result.tone).toBe(SloProjectionTone.Danger);
      expect(result.runwaySeconds).toBe(40);
    });

    test("sanity: a full budget burning at exactly 1x lasts exactly one window", () => {
      // 0.25 x 30 days of budget at 1x.
      const result: SloBudgetRunway = runway({
        targetPercentage: 75,
        errorBudgetRemainingSeconds: 0.25 * 30 * DAY_SECONDS,
        currentBurnRate: 1,
      });

      expect(result.runwaySeconds).toBe(30 * DAY_SECONDS);
      expect(result.kind).toBe(SloBudgetRunwayKind.Sustainable);
    });

    test("a full 99.9% budget at 1x is sustainable despite float error in the allowed fraction", () => {
      const result: SloBudgetRunway = runway({
        targetPercentage: 99.9,
        errorBudgetRemainingSeconds: 2592,
        currentBurnRate: 1,
      });

      expect(result.runwaySeconds).toBeCloseTo(30 * DAY_SECONDS, 3);
      expect(result.kind).toBe(SloBudgetRunwayKind.Sustainable);
    });

    test("a runway beyond the window is sustainable — the budget regenerates faster than it burns", () => {
      // 2000 / (0.5 x 0.001) = 4,000,000s, well past 30 days.
      expect(
        runway({ errorBudgetRemainingSeconds: 2000, currentBurnRate: 0.5 }),
      ).toEqual({
        kind: SloBudgetRunwayKind.Sustainable,
        tone: SloProjectionTone.Good,
        value: "Sustainable",
        description:
          "Outlasts the 30-day window, at the burn rate of the last 1h",
        runwaySeconds: expect.closeTo(4000000, 3),
        secondsUntilReset: null,
      });
    });

    test("measures sustainability against the SLO's own window, defaulting to 30 days", () => {
      const sevenDayRunway: SloBudgetRunway = runway({
        windowDays: 7,
        targetPercentage: 75,
        errorBudgetRemainingSeconds: 0.25 * 10 * DAY_SECONDS,
        currentBurnRate: 1,
      });

      expect(sevenDayRunway.kind).toBe(SloBudgetRunwayKind.Sustainable);
      expect(sevenDayRunway.description).toBe(
        "Outlasts the 7-day window, at the burn rate of the last 1h",
      );

      // 10 days of runway is short of the 30-day default window.
      expect(
        runway({
          windowDays: null,
          targetPercentage: 75,
          errorBudgetRemainingSeconds: 0.25 * 10 * DAY_SECONDS,
          currentBurnRate: 1,
        }).kind,
      ).toBe(SloBudgetRunwayKind.RunsOut);
    });
  });

  describe("calendar months", () => {
    test("a budget that runs out before the reset says so, with the reset", () => {
      // 1000 / (1 x 0.001) = 1,000,000s = 11d 13h 46m 40s < 15d 12h.
      const result: SloBudgetRunway = runway({
        windowType: SloWindowType.CalendarMonth,
        errorBudgetRemainingSeconds: 1000,
        currentBurnRate: 1,
      });

      expect(result.kind).toBe(SloBudgetRunwayKind.RunsOut);
      expect(result.value).toBe("~11d 13h");
      expect(result.description).toBe(
        "Until exhausted, at the burn rate of the last 1h · resets in 15d 12h",
      );
      expect(result.secondsUntilReset).toBe(SECONDS_UNTIL_UTC_RESET);
    });

    test("a budget that outlasts the month lasts until reset", () => {
      expect(
        runway({
          windowType: SloWindowType.CalendarMonth,
          errorBudgetRemainingSeconds: 2000,
          currentBurnRate: 1,
        }),
      ).toEqual({
        kind: SloBudgetRunwayKind.LastsUntilReset,
        tone: SloProjectionTone.Good,
        value: "Lasts until reset",
        description: "Resets in 15d 12h, at the burn rate of the last 1h",
        runwaySeconds: expect.closeTo(2000000, 3),
        secondsUntilReset: SECONDS_UNTIL_UTC_RESET,
      });
    });

    test("never reports a calendar month as 'sustainable'", () => {
      // A runway longer than 30 days but still... after the reset: lasts until reset.
      expect(
        runway({
          windowType: SloWindowType.CalendarMonth,
          errorBudgetRemainingSeconds: 5000,
          currentBurnRate: 0.01,
        }).kind,
      ).toBe(SloBudgetRunwayKind.LastsUntilReset);
    });

    test("resolves the reset in the SLO's timezone, not UTC", () => {
      // 20:00 UTC on Sep 30 is already 05:00 on Oct 1 in Tokyo.
      const tokyoNow: Date = new Date("2026-09-30T20:00:00.000Z");

      const tokyo: SloBudgetRunway = runway({
        windowType: SloWindowType.CalendarMonth,
        timezone: "Asia/Tokyo",
        currentBurnRate: 0,
        now: tokyoNow,
      });

      // Until 2026-11-01T00:00 JST = 2026-10-31T15:00Z.
      expect(tokyo.secondsUntilReset).toBe(30 * DAY_SECONDS + 19 * 3600);
      expect(tokyo.description).toBe(
        "No budget spent in the last 1h · resets in 30d 19h",
      );

      const utc: SloBudgetRunway = runway({
        windowType: SloWindowType.CalendarMonth,
        timezone: "UTC",
        currentBurnRate: 0,
        now: tokyoNow,
      });

      expect(utc.secondsUntilReset).toBe(4 * 3600);
    });

    test("a missing timezone means UTC, as it does for the worker", () => {
      expect(
        runway({
          windowType: SloWindowType.CalendarMonth,
          timezone: null,
          currentBurnRate: 0,
        }).secondsUntilReset,
      ).toBe(SECONDS_UNTIL_UTC_RESET);
    });

    test("an unknown timezone drops the reset rather than guessing one", () => {
      const result: SloBudgetRunway = runway({
        windowType: SloWindowType.CalendarMonth,
        timezone: "Mars/Olympus_Mons",
        errorBudgetRemainingSeconds: 2000,
        currentBurnRate: 1,
      });

      expect(result.secondsUntilReset).toBeNull();
      expect(result.kind).toBe(SloBudgetRunwayKind.RunsOut);
      expect(result.value).toBe("~23d 3h");
      expect(result.description).toBe(
        "Until exhausted, at the burn rate of the last 1h",
      );
    });
  });
});

describe("getSloBudgetBarGeometry", () => {
  test("draws nothing that reads as a claim before the first evaluation", () => {
    expect(
      getSloBudgetBarGeometry({ errorBudgetRemainingPercentage: null }),
    ).toEqual({
      isEvaluated: false,
      fillPercent: 0,
      markerPercent: 20,
      atRiskThresholdPercentage: 20,
      tier: SloBudgetTier.Unknown,
      isOverspent: false,
    });
  });

  test("fills to the remaining percentage and marks the SLO's own threshold", () => {
    expect(
      getSloBudgetBarGeometry({
        errorBudgetRemainingPercentage: 42.5,
        atRiskThresholdPercentage: 25,
      }),
    ).toEqual({
      isEvaluated: true,
      fillPercent: 42.5,
      markerPercent: 25,
      atRiskThresholdPercentage: 25,
      tier: SloBudgetTier.Healthy,
      isOverspent: false,
    });
  });

  test("clamps an overspent budget to an empty bar but still says it is overspent", () => {
    const geometry: SloBudgetBarGeometry = getSloBudgetBarGeometry({
      errorBudgetRemainingPercentage: -340,
      atRiskThresholdPercentage: 20,
    });

    expect(geometry.fillPercent).toBe(0);
    expect(geometry.isOverspent).toBe(true);
    expect(geometry.tier).toBe(SloBudgetTier.Exhausted);
  });

  test("an exactly empty budget is exhausted but not overspent", () => {
    const geometry: SloBudgetBarGeometry = getSloBudgetBarGeometry({
      errorBudgetRemainingPercentage: 0,
    });

    expect(geometry.isOverspent).toBe(false);
    expect(geometry.tier).toBe(SloBudgetTier.Exhausted);
  });

  test("clamps the fill to 100", () => {
    expect(
      getSloBudgetBarGeometry({ errorBudgetRemainingPercentage: 100.4 })
        .fillPercent,
    ).toBe(100);
  });

  test("clamps the marker onto the track but keeps the real threshold", () => {
    const high: SloBudgetBarGeometry = getSloBudgetBarGeometry({
      errorBudgetRemainingPercentage: 50,
      atRiskThresholdPercentage: 150,
    });

    expect(high.markerPercent).toBe(100);
    expect(high.atRiskThresholdPercentage).toBe(150);

    expect(
      getSloBudgetBarGeometry({
        errorBudgetRemainingPercentage: 50,
        atRiskThresholdPercentage: -5,
      }).markerPercent,
    ).toBe(0);
  });

  test("falls back to the default threshold for a missing or non-finite one", () => {
    expect(
      getSloBudgetBarGeometry({
        errorBudgetRemainingPercentage: 50,
        atRiskThresholdPercentage: NaN,
      }).markerPercent,
    ).toBe(20);
  });

  test.each([
    [-1, 20],
    [0, 20],
    [5, 20],
    [20, 20],
    [20.01, 20],
    [35, 40],
    [40, 40],
    [41, 40],
    [99, undefined],
  ])(
    "uses exactly getSloBudgetTier's tier (%p remaining, threshold %p)",
    (remaining: number, threshold: number | undefined) => {
      expect(
        getSloBudgetBarGeometry({
          errorBudgetRemainingPercentage: remaining,
          atRiskThresholdPercentage: threshold,
        }).tier,
      ).toBe(
        getSloBudgetTier({
          errorBudgetRemainingPercentage: remaining,
          atRiskThresholdPercentage: threshold,
        }),
      );
    },
  );
});

describe("SLI versus target", () => {
  test("says how far above the target the SLI is, in percentage points", () => {
    expect(
      getSliDeltaText({ currentSliPercentage: 99.95, targetPercentage: 99.9 }),
    ).toBe("0.05 pp above the 99.9% target");
  });

  test("says how far below", () => {
    expect(
      getSliDeltaText({ currentSliPercentage: 99.812, targetPercentage: 99.9 }),
    ).toBe("0.088 pp below the 99.9% target");
  });

  test("exactly on target", () => {
    expect(
      getSliDeltaText({ currentSliPercentage: 99.9, targetPercentage: 99.9 }),
    ).toBe("Exactly on the 99.9% target");
  });

  test("a gap that rounds to zero still says which side it is on", () => {
    expect(
      getSliDeltaText({
        currentSliPercentage: 99.9004,
        targetPercentage: 99.9,
      }),
    ).toBe("Just above the 99.9% target");
    expect(
      getSliDeltaText({
        currentSliPercentage: 99.8996,
        targetPercentage: 99.9,
      }),
    ).toBe("Just below the 99.9% target");
  });

  test("is null when either number is unknown", () => {
    expect(
      getSliDeltaText({ currentSliPercentage: null, targetPercentage: 99.9 }),
    ).toBeNull();
    expect(
      getSliDeltaText({
        currentSliPercentage: 99.9,
        targetPercentage: undefined,
      }),
    ).toBeNull();
  });

  test("the rounded delta never prints -0", () => {
    expect(
      Object.is(
        getSliDeltaPercentagePoints({
          currentSliPercentage: 99.8996,
          targetPercentage: 99.9,
        }),
        0,
      ),
    ).toBe(true);
  });

  test("isSliBelowTarget compares unrounded and is false when unknown", () => {
    expect(
      isSliBelowTarget({
        currentSliPercentage: 99.8996,
        targetPercentage: 99.9,
      }),
    ).toBe(true);
    expect(
      isSliBelowTarget({ currentSliPercentage: 99.9, targetPercentage: 99.9 }),
    ).toBe(false);
    expect(
      isSliBelowTarget({ currentSliPercentage: null, targetPercentage: 99.9 }),
    ).toBe(false);
  });
});

describe("burn rate thresholds", () => {
  test("picks the lowest usable threshold, skipping ones the worker skips", () => {
    expect(
      getLowestBurnRateThreshold([14.4, 6, undefined, null, 0, -1, NaN, 2]),
    ).toBe(2);
  });

  test("is null when no threshold is usable", () => {
    expect(getLowestBurnRateThreshold([])).toBeNull();
    expect(getLowestBurnRateThreshold([null, 0, -2])).toBeNull();
  });

  test("compares with >= like the worker, and is false when anything is unknown", () => {
    expect(isBurnRateAtOrAboveThreshold({ burnRate: 2, threshold: 2 })).toBe(
      true,
    );
    expect(isBurnRateAtOrAboveThreshold({ burnRate: 1.99, threshold: 2 })).toBe(
      false,
    );
    expect(isBurnRateAtOrAboveThreshold({ burnRate: null, threshold: 2 })).toBe(
      false,
    );
    expect(isBurnRateAtOrAboveThreshold({ burnRate: 5, threshold: null })).toBe(
      false,
    );
    expect(isBurnRateAtOrAboveThreshold({ burnRate: 5, threshold: 0 })).toBe(
      false,
    );
  });
});

describe("getSloAllowedDowntime", () => {
  test("restates a rolling target as downtime per window", () => {
    const allowed: SloAllowedDowntime | null = getSloAllowedDowntime({
      targetPercentage: 99.9,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      now: NOW,
    });

    expect(allowed!.seconds).toBeCloseTo(2592, 6);
    expect(allowed!.periodText).toBe("per rolling 30 days");
  });

  test("singular day, and the 30-day default", () => {
    expect(
      getSloAllowedDowntime({
        targetPercentage: 75,
        windowDays: 1,
        now: NOW,
      })!.periodText,
    ).toBe("per rolling 1 day");

    expect(
      getSloAllowedDowntime({
        targetPercentage: 75,
        windowDays: null,
        now: NOW,
      })!.seconds,
    ).toBe(0.25 * 30 * DAY_SECONDS);
  });

  test("a calendar month uses this month's real length", () => {
    const february: SloAllowedDowntime | null = getSloAllowedDowntime({
      targetPercentage: 75,
      windowType: SloWindowType.CalendarMonth,
      timezone: "UTC",
      now: new Date("2026-02-10T00:00:00.000Z"),
    });

    expect(february!.seconds).toBe(0.25 * 28 * DAY_SECONDS);
    expect(february!.periodText).toBe("this calendar month");
  });

  test("a DST month in the SLO's timezone is an hour short", () => {
    // US clocks spring forward on 2026-03-08.
    expect(
      getSloAllowedDowntime({
        targetPercentage: 75,
        windowType: SloWindowType.CalendarMonth,
        timezone: "America/New_York",
        now: new Date("2026-03-15T12:00:00.000Z"),
      })!.seconds,
    ).toBe(0.25 * (31 * DAY_SECONDS - 3600));
  });

  test("rounds away the float error that made the card read 43m 11s", () => {
    // 1 - 99.9 / 100 is 0.0010000000000000009, and the formatters floor.
    expect(
      getSloAllowedDowntime({
        targetPercentage: 99.9,
        windowType: SloWindowType.Rolling,
        windowDays: 30,
        now: NOW,
      })!.seconds,
    ).toBe(2592);

    // 1 - 99.95 / 100 lands just BELOW 0.0005, which floored 21m 36s to 21m 35s.
    expect(
      getSloAllowedDowntime({
        targetPercentage: 99.95,
        windowType: SloWindowType.CalendarMonth,
        timezone: "Europe/Berlin",
        now: new Date("2026-09-15T12:00:00.000Z"),
      })!.seconds,
    ).toBe(1296);
  });

  test("keeps a genuinely fractional allowance", () => {
    expect(
      getSloAllowedDowntime({
        targetPercentage: 99.999,
        windowDays: 1,
        now: NOW,
      })!.seconds,
    ).toBe(0.864);
  });

  test("is null for an unusable target or an unknown calendar timezone", () => {
    expect(
      getSloAllowedDowntime({ targetPercentage: 100, now: NOW }),
    ).toBeNull();
    expect(
      getSloAllowedDowntime({
        targetPercentage: 99.9,
        windowType: SloWindowType.CalendarMonth,
        timezone: "Mars/Olympus_Mons",
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("getSloComplianceWindowRange", () => {
  test("a rolling window ends now and starts its own length ago", () => {
    const range: SloComplianceWindowRange = getSloComplianceWindowRange({
      windowType: SloWindowType.Rolling,
      windowDays: 7,
      now: NOW,
    });

    expect(range.startDate.toISOString()).toBe("2026-09-08T12:00:00.000Z");
    expect(range.endDate).toBe(NOW);
    expect(range.axisEndDate).toBe(NOW);
  });

  test("a rolling window without days uses 30", () => {
    expect(
      getSloComplianceWindowRange({
        windowDays: null,
        now: NOW,
      }).startDate.toISOString(),
    ).toBe("2026-08-16T12:00:00.000Z");
  });

  test("a calendar month runs from the start of the month to its reset, in the SLO's timezone", () => {
    const range: SloComplianceWindowRange = getSloComplianceWindowRange({
      windowType: SloWindowType.CalendarMonth,
      timezone: "Asia/Tokyo",
      now: new Date("2026-09-30T20:00:00.000Z"),
    });

    expect(range.startDate.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(range.endDate.toISOString()).toBe("2026-09-30T20:00:00.000Z");
    expect(range.axisEndDate.toISOString()).toBe("2026-10-31T15:00:00.000Z");
  });

  test("an unknown calendar timezone still charts the UTC month", () => {
    const range: SloComplianceWindowRange = getSloComplianceWindowRange({
      windowType: SloWindowType.CalendarMonth,
      timezone: "Mars/Olympus_Mons",
      now: NOW,
    });

    expect(range.startDate.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(range.axisEndDate.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("getSloIdealBurnPoints", () => {
  const start: Date = new Date("2026-09-01T00:00:00.000Z");
  const end: Date = new Date("2026-09-01T04:00:00.000Z");

  test("one point per step from 100% down to 0% at the end", () => {
    const points: Array<SloIdealBurnPoint> = getSloIdealBurnPoints({
      startDate: start,
      endDate: end,
      stepSeconds: 3600,
    });

    expect(
      points.map((point: SloIdealBurnPoint) => {
        return [point.x.toISOString(), point.y];
      }),
    ).toEqual([
      ["2026-09-01T00:00:00.000Z", 100],
      ["2026-09-01T01:00:00.000Z", 75],
      ["2026-09-01T02:00:00.000Z", 50],
      ["2026-09-01T03:00:00.000Z", 25],
      ["2026-09-01T04:00:00.000Z", 0],
    ]);
  });

  test("is empty for an empty or reversed range", () => {
    expect(
      getSloIdealBurnPoints({
        startDate: end,
        endDate: start,
        stepSeconds: 60,
      }),
    ).toEqual([]);
    expect(
      getSloIdealBurnPoints({
        startDate: start,
        endDate: start,
        stepSeconds: 60,
      }),
    ).toEqual([]);
  });

  test("an unusable step still draws the line end to end", () => {
    expect(
      getSloIdealBurnPoints({
        startDate: start,
        endDate: end,
        stepSeconds: 0,
      }).map((point: SloIdealBurnPoint) => {
        return point.y;
      }),
    ).toEqual([100, 0]);
  });

  test("caps the point count for a tiny step over a long range", () => {
    const points: Array<SloIdealBurnPoint> = getSloIdealBurnPoints({
      startDate: start,
      endDate: new Date("2026-10-01T00:00:00.000Z"),
      stepSeconds: 1,
    });

    expect(points.length).toBeLessThanOrEqual(2001);
    expect(points[0]!.y).toBe(100);
    expect(points[points.length - 1]!.y).toBe(0);

    for (let index: number = 1; index < points.length; index++) {
      expect(points[index]!.y).toBeLessThan(points[index - 1]!.y);
    }
  });
});

describe("getSloChartBucketSeconds", () => {
  test.each([
    [AggregationInterval.Minute, 60],
    [AggregationInterval.FiveMinutes, 300],
    [AggregationInterval.FifteenMinutes, 900],
    [AggregationInterval.ThirtyMinutes, 1800],
    [AggregationInterval.Hour, 3600],
    [AggregationInterval.Day, DAY_SECONDS],
    [AggregationInterval.Week, 7 * DAY_SECONDS],
    [AggregationInterval.Month, null],
    [AggregationInterval.Year, null],
    [AggregationInterval.Total, null],
  ])(
    "%s is %p seconds",
    (interval: AggregationInterval, seconds: number | null) => {
      expect(getSloChartBucketSeconds(interval)).toBe(seconds);
    },
  );
});
