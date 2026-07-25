import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import { SloWidgetMetric } from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import {
  formatErrorBudgetRemainingSeconds,
  formatSloBurnRate,
  formatSloChartValue,
  formatSloPercent,
  getSloChartAggregationInterval,
  getSloHistoryMetricName,
  getSloMetricLabel,
  getSloWidgetTileDisplay,
  getSloWidgetTitle,
  SLO_NOT_EVALUATED_TEXT,
  SloWidgetStateData,
  SloWidgetTileDisplay,
} from "../../../Utils/Slo/SloWidgetFormat";

/** A fully evaluated SLO — the happy path every test narrows from. */
function makeSlo(
  overrides: Partial<SloWidgetStateData> = {},
): SloWidgetStateData {
  return {
    name: "API Availability",
    targetPercentage: 99.9,
    currentSliPercentage: 99.92,
    errorBudgetRemainingPercentage: 68,
    errorBudgetRemainingSeconds: 1764,
    currentBurnRate: 3.2,
    sloStatus: SloStatus.Healthy,
    ...overrides,
  };
}

const MINUS_SIGN: string = "−";
const MULTIPLICATION_SIGN: string = "×";

describe("SloWidgetFormat", () => {
  describe("formatSloPercent", () => {
    it("appends a percent sign to a plain value", () => {
      expect(formatSloPercent(99.92)).toBe("99.92%");
    });

    it("renders an exact 100 without decimal padding", () => {
      expect(formatSloPercent(100)).toBe("100%");
    });

    it("renders zero as 0%", () => {
      expect(formatSloPercent(0)).toBe("0%");
    });

    it("rounds to three decimals by default", () => {
      expect(formatSloPercent(99.99949)).toBe("99.999%");
    });

    it("drops trailing zeros left by rounding", () => {
      expect(formatSloPercent(99.9)).toBe("99.9%");
      expect(formatSloPercent(99.9000001)).toBe("99.9%");
    });

    it("honours an explicit decimal budget", () => {
      expect(formatSloPercent(68.34, 1)).toBe("68.3%");
      expect(formatSloPercent(68.35, 0)).toBe("68%");
    });

    it("renders a negative percentage with its sign intact", () => {
      expect(formatSloPercent(-12.5, 1)).toBe("-12.5%");
    });

    it("never renders a negative zero", () => {
      expect(formatSloPercent(-0.0001, 1)).toBe("0%");
    });

    it("returns null for null, undefined, NaN and Infinity", () => {
      expect(formatSloPercent(null)).toBeNull();
      expect(formatSloPercent(undefined)).toBeNull();
      expect(formatSloPercent(NaN)).toBeNull();
      expect(formatSloPercent(Infinity)).toBeNull();
      expect(formatSloPercent(-Infinity)).toBeNull();
    });

    it("returns null for a numeric string so a JSON round-trip cannot fake a value", () => {
      expect(
        formatSloPercent("99.9" as unknown as number | undefined | null),
      ).toBeNull();
    });
  });

  describe("formatSloBurnRate", () => {
    it("suffixes the multiplication sign", () => {
      expect(formatSloBurnRate(3.2)).toBe(`3.2${MULTIPLICATION_SIGN}`);
    });

    it("renders a burn rate of exactly 1 without decimals", () => {
      expect(formatSloBurnRate(1)).toBe(`1${MULTIPLICATION_SIGN}`);
    });

    it("renders a zero burn rate rather than treating it as missing", () => {
      expect(formatSloBurnRate(0)).toBe(`0${MULTIPLICATION_SIGN}`);
    });

    it("rounds to two decimals", () => {
      expect(formatSloBurnRate(14.2857)).toBe(`14.29${MULTIPLICATION_SIGN}`);
    });

    it("returns null for null, undefined and NaN", () => {
      expect(formatSloBurnRate(null)).toBeNull();
      expect(formatSloBurnRate(undefined)).toBeNull();
      expect(formatSloBurnRate(NaN)).toBeNull();
    });
  });

  describe("formatErrorBudgetRemainingSeconds", () => {
    it("converts remaining seconds to whole minutes", () => {
      expect(formatErrorBudgetRemainingSeconds(2580)).toBe("43 min remaining");
    });

    it("rounds to the nearest minute", () => {
      expect(formatErrorBudgetRemainingSeconds(2609)).toBe("43 min remaining");
      expect(formatErrorBudgetRemainingSeconds(2611)).toBe("44 min remaining");
    });

    it("states an exactly exhausted budget as 0 min remaining", () => {
      expect(formatErrorBudgetRemainingSeconds(0)).toBe("0 min remaining");
    });

    it("does not round a sub-minute remainder down to a misleading 0 min", () => {
      expect(formatErrorBudgetRemainingSeconds(20)).toBe(
        "under 1 min remaining",
      );
    });

    it("renders an overspent budget plainly with a minus sign", () => {
      expect(formatErrorBudgetRemainingSeconds(-2520)).toBe(
        `${MINUS_SIGN}42 min over budget`,
      );
    });

    it("says over budget rather than remaining once the budget is negative", () => {
      expect(formatErrorBudgetRemainingSeconds(-60)).toContain("over budget");
      expect(formatErrorBudgetRemainingSeconds(-60)).not.toContain("remaining");
    });

    it("handles a sub-minute overage without a bare 0", () => {
      expect(formatErrorBudgetRemainingSeconds(-20)).toBe(
        "under 1 min over budget",
      );
    });

    it("returns null for null, undefined and NaN", () => {
      expect(formatErrorBudgetRemainingSeconds(null)).toBeNull();
      expect(formatErrorBudgetRemainingSeconds(undefined)).toBeNull();
      expect(formatErrorBudgetRemainingSeconds(NaN)).toBeNull();
    });
  });

  describe("getSloMetricLabel", () => {
    it("labels the SLI metric", () => {
      expect(getSloMetricLabel(SloWidgetMetric.Sli)).toBe("SLI");
    });

    it("labels the error budget metric", () => {
      expect(getSloMetricLabel(SloWidgetMetric.ErrorBudgetRemaining)).toBe(
        "Error Budget Remaining",
      );
    });

    it("labels the burn rate metric", () => {
      expect(getSloMetricLabel(SloWidgetMetric.BurnRate)).toBe("Burn Rate");
    });

    it("falls back to the SLI label when the metric is unset", () => {
      expect(getSloMetricLabel(undefined)).toBe("SLI");
      expect(getSloMetricLabel(null)).toBe("SLI");
    });

    it("falls back to the SLI label for an unrecognised persisted value", () => {
      expect(getSloMetricLabel("Nonsense" as SloWidgetMetric)).toBe("SLI");
    });
  });

  describe("getSloHistoryMetricName", () => {
    it("maps SLI to the sli.percent series the worker writes", () => {
      expect(getSloHistoryMetricName(SloWidgetMetric.Sli)).toBe("sli.percent");
    });

    it("maps error budget remaining to its percent series", () => {
      expect(
        getSloHistoryMetricName(SloWidgetMetric.ErrorBudgetRemaining),
      ).toBe("error.budget.remaining.percent");
    });

    it("maps burn rate to the burn.rate series", () => {
      expect(getSloHistoryMetricName(SloWidgetMetric.BurnRate)).toBe(
        "burn.rate",
      );
    });

    it("defaults to the sli.percent series when the metric is unset", () => {
      expect(getSloHistoryMetricName(undefined)).toBe("sli.percent");
    });
  });

  describe("getSloWidgetTitle", () => {
    it("uses the author's title when one is set", () => {
      expect(
        getSloWidgetTitle({
          widgetTitle: "Checkout reliability",
          sloName: "API Availability",
          sloMetric: SloWidgetMetric.Sli,
        }),
      ).toBe("Checkout reliability");
    });

    it("trims surrounding whitespace off the author's title", () => {
      expect(
        getSloWidgetTitle({
          widgetTitle: "  Checkout reliability  ",
          sloName: "API Availability",
        }),
      ).toBe("Checkout reliability");
    });

    it("falls back to the SLO name plus metric label when the title is empty", () => {
      expect(
        getSloWidgetTitle({
          widgetTitle: "",
          sloName: "API Availability",
          sloMetric: SloWidgetMetric.Sli,
        }),
      ).toBe("API Availability · SLI");
    });

    it("treats a whitespace-only title as empty", () => {
      expect(
        getSloWidgetTitle({
          widgetTitle: "   ",
          sloName: "API Availability",
          sloMetric: SloWidgetMetric.BurnRate,
        }),
      ).toBe("API Availability · Burn Rate");
    });

    it("falls back for an undefined title", () => {
      expect(
        getSloWidgetTitle({
          sloName: "API Availability",
          sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        }),
      ).toBe("API Availability · Error Budget Remaining");
    });

    it("falls back to just the metric label when the SLO name is unknown", () => {
      expect(
        getSloWidgetTitle({
          sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        }),
      ).toBe("Error Budget Remaining");
    });

    it("falls back to the SLI label when neither title, name, nor metric are set", () => {
      expect(getSloWidgetTitle({})).toBe("SLI");
    });
  });

  describe("getSloWidgetTileDisplay for the SLI metric", () => {
    it("renders the current SLI as a percentage", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.Sli,
        slo: makeSlo(),
      });

      expect(display.isEvaluated).toBe(true);
      expect(display.value).toBe("99.92%");
    });

    it("adds the target as a subline", () => {
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.Sli,
          slo: makeSlo(),
        }).subline,
      ).toBe("target 99.9%");
    });

    it("omits the target subline when the SLO has no target", () => {
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.Sli,
          slo: makeSlo({ targetPercentage: null }),
        }).subline,
      ).toBeNull();
    });

    it("renders a perfect 100% SLI", () => {
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.Sli,
          slo: makeSlo({ currentSliPercentage: 100 }),
        }).value,
      ).toBe("100%");
    });

    it("renders a total outage as 0%", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.Sli,
        slo: makeSlo({ currentSliPercentage: 0 }),
      });

      expect(display.isEvaluated).toBe(true);
      expect(display.value).toBe("0%");
    });

    it("is the metric used when no metric is configured", () => {
      expect(getSloWidgetTileDisplay({ slo: makeSlo() }).value).toBe("99.92%");
    });

    it("reports not evaluated when the SLI column is still null", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.Sli,
        slo: makeSlo({ currentSliPercentage: null }),
      });

      expect(display.isEvaluated).toBe(false);
      expect(display.value).toBe(SLO_NOT_EVALUATED_TEXT);
      expect(display.subline).toBeNull();
    });
  });

  describe("getSloWidgetTileDisplay for the error budget metric", () => {
    it("renders the remaining budget as a percentage", () => {
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
          slo: makeSlo(),
        }).value,
      ).toBe("68%");
    });

    it("rounds a fractional remaining budget to one decimal", () => {
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
          slo: makeSlo({ errorBudgetRemainingPercentage: 68.349 }),
        }).value,
      ).toBe("68.3%");
    });

    it("adds the remaining minutes as a subline", () => {
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
          slo: makeSlo({ errorBudgetRemainingSeconds: 2580 }),
        }).subline,
      ).toBe("43 min remaining");
    });

    it("states an overspent budget as an over-budget subline", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        slo: makeSlo({
          errorBudgetRemainingPercentage: -12.5,
          errorBudgetRemainingSeconds: -2520,
        }),
      });

      expect(display.value).toBe("-12.5%");
      expect(display.subline).toBe(`${MINUS_SIGN}42 min over budget`);
    });

    it("renders a fully exhausted budget as 0% rather than not evaluated", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        slo: makeSlo({
          errorBudgetRemainingPercentage: 0,
          errorBudgetRemainingSeconds: 0,
        }),
      });

      expect(display.isEvaluated).toBe(true);
      expect(display.value).toBe("0%");
      expect(display.subline).toBe("0 min remaining");
    });

    it("keeps the percentage when only the seconds column is missing", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        slo: makeSlo({ errorBudgetRemainingSeconds: null }),
      });

      expect(display.isEvaluated).toBe(true);
      expect(display.value).toBe("68%");
      expect(display.subline).toBeNull();
    });

    it("reports not evaluated when the remaining percentage is null", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
        slo: makeSlo({ errorBudgetRemainingPercentage: null }),
      });

      expect(display.isEvaluated).toBe(false);
      expect(display.value).toBe(SLO_NOT_EVALUATED_TEXT);
    });
  });

  describe("getSloWidgetTileDisplay for the burn rate metric", () => {
    it("renders the burn rate as a multiplier", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.BurnRate,
        slo: makeSlo(),
      });

      expect(display.isEvaluated).toBe(true);
      expect(display.value).toBe(`3.2${MULTIPLICATION_SIGN}`);
    });

    it("carries no subline", () => {
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.BurnRate,
          slo: makeSlo(),
        }).subline,
      ).toBeNull();
    });

    it("renders a zero burn rate as a real value", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.BurnRate,
        slo: makeSlo({ currentBurnRate: 0 }),
      });

      expect(display.isEvaluated).toBe(true);
      expect(display.value).toBe(`0${MULTIPLICATION_SIGN}`);
    });

    it("reports not evaluated when the burn rate is null", () => {
      const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
        sloMetric: SloWidgetMetric.BurnRate,
        slo: makeSlo({ currentBurnRate: null }),
      });

      expect(display.isEvaluated).toBe(false);
      expect(display.value).toBe(SLO_NOT_EVALUATED_TEXT);
    });
  });

  describe("getSloWidgetTileDisplay when the SLO has never been evaluated", () => {
    const neverEvaluated: SloWidgetStateData = {
      name: "Brand new SLO",
      targetPercentage: 99.9,
      currentSliPercentage: null,
      errorBudgetRemainingPercentage: null,
      errorBudgetRemainingSeconds: null,
      currentBurnRate: null,
      sloStatus: null,
    };

    it.each([
      ["SLI", SloWidgetMetric.Sli],
      ["error budget remaining", SloWidgetMetric.ErrorBudgetRemaining],
      ["burn rate", SloWidgetMetric.BurnRate],
    ])(
      "renders the not-evaluated placeholder for %s instead of a null value",
      (_label: string, metric: SloWidgetMetric) => {
        const display: SloWidgetTileDisplay = getSloWidgetTileDisplay({
          sloMetric: metric,
          slo: neverEvaluated,
        });

        expect(display.isEvaluated).toBe(false);
        expect(display.value).toBe(SLO_NOT_EVALUATED_TEXT);
        expect(display.value).not.toContain("null");
        expect(display.value).not.toContain("NaN");
        expect(display.value).not.toContain("undefined");
        expect(display.subline).toBeNull();
      },
    );

    it("renders the not-evaluated placeholder when the SLO itself is missing", () => {
      expect(
        getSloWidgetTileDisplay({
          sloMetric: SloWidgetMetric.Sli,
          slo: null,
        }),
      ).toEqual({
        isEvaluated: false,
        value: SLO_NOT_EVALUATED_TEXT,
        subline: null,
      });
    });

    it("renders the not-evaluated placeholder for an entirely empty state object", () => {
      expect(
        getSloWidgetTileDisplay({ sloMetric: SloWidgetMetric.Sli, slo: {} })
          .isEvaluated,
      ).toBe(false);
    });
  });

  describe("getSloChartAggregationInterval", () => {
    it("uses the worker's 5-minute write cadence for short windows", () => {
      expect(getSloChartAggregationInterval(60)).toBe(
        AggregationInterval.FiveMinutes,
      );
      expect(getSloChartAggregationInterval(12 * 60)).toBe(
        AggregationInterval.FiveMinutes,
      );
    });

    it("steps up to 30-minute buckets past 12 hours", () => {
      expect(getSloChartAggregationInterval(12 * 60 + 1)).toBe(
        AggregationInterval.ThirtyMinutes,
      );
      expect(getSloChartAggregationInterval(3 * 24 * 60)).toBe(
        AggregationInterval.ThirtyMinutes,
      );
    });

    it("steps up to hourly buckets past three days", () => {
      expect(getSloChartAggregationInterval(3 * 24 * 60 + 1)).toBe(
        AggregationInterval.Hour,
      );
      expect(getSloChartAggregationInterval(45 * 24 * 60)).toBe(
        AggregationInterval.Hour,
      );
    });

    it("steps up to daily buckets past 45 days so a year stays bounded", () => {
      expect(getSloChartAggregationInterval(45 * 24 * 60 + 1)).toBe(
        AggregationInterval.Day,
      );
      expect(getSloChartAggregationInterval(365 * 24 * 60)).toBe(
        AggregationInterval.Day,
      );
    });

    it("keeps every bucket choice under a few thousand points", () => {
      const bucketMinutes: Record<string, number> = {
        [AggregationInterval.FiveMinutes]: 5,
        [AggregationInterval.ThirtyMinutes]: 30,
        [AggregationInterval.Hour]: 60,
        [AggregationInterval.Day]: 24 * 60,
      };

      for (const rangeInMinutes of [
        5,
        60,
        12 * 60,
        24 * 60,
        3 * 24 * 60,
        30 * 24 * 60,
        45 * 24 * 60,
        90 * 24 * 60,
        365 * 24 * 60,
      ]) {
        const interval: AggregationInterval =
          getSloChartAggregationInterval(rangeInMinutes);

        expect(
          rangeInMinutes / (bucketMinutes[interval] as number),
        ).toBeLessThanOrEqual(2200);
      }
    });

    it("falls back to the finest bucket for a degenerate zero or negative range", () => {
      expect(getSloChartAggregationInterval(0)).toBe(
        AggregationInterval.FiveMinutes,
      );
      expect(getSloChartAggregationInterval(-10)).toBe(
        AggregationInterval.FiveMinutes,
      );
      expect(getSloChartAggregationInterval(NaN)).toBe(
        AggregationInterval.FiveMinutes,
      );
    });
  });

  describe("formatSloChartValue", () => {
    it("formats the SLI axis in percent", () => {
      expect(formatSloChartValue(SloWidgetMetric.Sli, 99.9235)).toBe("99.924%");
    });

    it("formats the error budget axis in coarse percent", () => {
      expect(
        formatSloChartValue(SloWidgetMetric.ErrorBudgetRemaining, 68.349),
      ).toBe("68.3%");
    });

    it("formats the burn rate axis as a multiplier", () => {
      expect(formatSloChartValue(SloWidgetMetric.BurnRate, 3.2)).toBe(
        `3.2${MULTIPLICATION_SIGN}`,
      );
    });

    it("defaults to the percent axis when the metric is unset", () => {
      expect(formatSloChartValue(undefined, 50)).toBe("50%");
    });

    it("returns an empty string rather than NaN for a non-finite tick", () => {
      expect(formatSloChartValue(SloWidgetMetric.Sli, NaN)).toBe("");
      expect(formatSloChartValue(SloWidgetMetric.BurnRate, Infinity)).toBe("");
    });
  });
});
