import { Gray500, Green, Red, Yellow } from "../../../Types/BrandColors";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import {
  getSloBudgetBarFillPercent,
  getSloBurnRateTone,
  getSloListRowDisplay,
  SLO_CRITICAL_BURN_RATE,
  SLO_LIST_ATTRIBUTE_TO_COLUMN,
  SLO_LIST_DEFAULT_MAX_ROWS,
  SLO_LIST_SORT,
  SLO_LIST_STATUS_FILTER_VALUES,
  SLO_NOT_EVALUATED_STATUS_LABEL,
  SLO_SUSTAINABLE_BURN_RATE,
  SloBurnRateTone,
  SloListRowDisplay,
  SloStatusSummaryEntry,
  summarizeSloStatuses,
} from "../../../Utils/Slo/SloListWidgetFormat";
import { SLO_METRIC_SLO_NAME_ATTRIBUTE } from "../../../Utils/Slo/SloMetricType";
import { SloWidgetStateData } from "../../../Utils/Slo/SloWidgetFormat";
import { describe, expect, test } from "@jest/globals";

/*
 * The SLO List widget's pure rules. Two of them are shared with the public
 * dashboard policy on the server (the sort and the variable column map), so
 * they are pinned here as the contract both sides read.
 */

type BuildRowFunction = (
  overrides?: Partial<SloWidgetStateData>,
) => SloWidgetStateData;

const buildRow: BuildRowFunction = (
  overrides: Partial<SloWidgetStateData> = {},
): SloWidgetStateData => {
  return {
    name: "Checkout availability",
    targetPercentage: 99.9,
    currentSliPercentage: 99.95,
    errorBudgetRemainingPercentage: 42.5,
    errorBudgetRemainingSeconds: 3600,
    currentBurnRate: 1.25,
    sloStatus: SloStatus.Healthy,
    ...overrides,
  };
};

describe("SloListWidgetFormat", () => {
  describe("the order the list is read in", () => {
    /*
     * Least budget first, then by name. Object key order IS the ORDER BY
     * order, so the keys are asserted as a sequence rather than as a set.
     */
    test("sorts by error budget remaining, then name, both ascending", () => {
      expect(Object.keys(SLO_LIST_SORT)).toEqual([
        "errorBudgetRemainingPercentage",
        "name",
      ]);
      expect(Object.values(SLO_LIST_SORT)).toEqual([
        SortOrder.Ascending,
        SortOrder.Ascending,
      ]);
    });

    test("caps the list at a positive whole number by default", () => {
      expect(Number.isInteger(SLO_LIST_DEFAULT_MAX_ROWS)).toBe(true);
      expect(SLO_LIST_DEFAULT_MAX_ROWS).toBeGreaterThan(0);
    });
  });

  describe("the variable column map", () => {
    /*
     * The key has to be the exact attribute key the `oneuptime.slo.*` series
     * carry — the SLO template's toolbar variable binds to it — or picking an
     * SLO narrows the charts and leaves the list unfiltered.
     */
    test("maps the metric series' bare sloName attribute to the name column", () => {
      expect(SLO_LIST_ATTRIBUTE_TO_COLUMN).toEqual({ sloName: "name" });
      expect(Object.keys(SLO_LIST_ATTRIBUTE_TO_COLUMN)).toEqual([
        SLO_METRIC_SLO_NAME_ATTRIBUTE,
      ]);
    });
  });

  describe("getSloBurnRateTone", () => {
    test("has no tone for a missing or non-finite burn rate", () => {
      for (const value of [null, undefined, NaN, Infinity, -Infinity] as Array<
        number | null | undefined
      >) {
        expect(getSloBurnRateTone(value)).toBe(SloBurnRateTone.Unknown);
      }
    });

    test("calls 1x and below sustainable", () => {
      for (const value of [0, 0.5, SLO_SUSTAINABLE_BURN_RATE]) {
        expect(getSloBurnRateTone(value)).toBe(SloBurnRateTone.Sustainable);
      }
    });

    test("elevates anything spending faster than the window allows", () => {
      for (const value of [1.01, 6, SLO_CRITICAL_BURN_RATE - 0.01]) {
        expect(getSloBurnRateTone(value)).toBe(SloBurnRateTone.Elevated);
      }
    });

    test("is critical from the one-hour paging threshold up", () => {
      expect(SLO_CRITICAL_BURN_RATE).toBe(14.4);

      for (const value of [SLO_CRITICAL_BURN_RATE, 20, 1000]) {
        expect(getSloBurnRateTone(value)).toBe(SloBurnRateTone.Critical);
      }
    });
  });

  describe("getSloBudgetBarFillPercent", () => {
    test("draws no bar without a budget figure", () => {
      for (const value of [null, undefined, NaN, Infinity] as Array<
        number | null | undefined
      >) {
        expect(getSloBudgetBarFillPercent(value)).toBeNull();
      }
    });

    test("clamps the BAR only — an overspent budget draws empty, a whole one full", () => {
      expect(getSloBudgetBarFillPercent(-37.5)).toBe(0);
      expect(getSloBudgetBarFillPercent(0)).toBe(0);
      expect(getSloBudgetBarFillPercent(42.5)).toBe(42.5);
      expect(getSloBudgetBarFillPercent(100)).toBe(100);
      expect(getSloBudgetBarFillPercent(150)).toBe(100);
    });
  });

  describe("getSloListRowDisplay", () => {
    test("formats an evaluated row with the single-SLO widget's precision", () => {
      const display: SloListRowDisplay = getSloListRowDisplay(buildRow());

      expect(display).toEqual({
        sli: "99.95%",
        target: "target 99.9%",
        budget: "42.5%",
        budgetTime: "60 min remaining",
        budgetFillPercent: 42.5,
        burnRate: "1.25×",
        burnRateTone: SloBurnRateTone.Elevated,
        statusText: SloStatus.Healthy,
        statusColor: Green,
      });
    });

    test("keeps the SLI's third decimal, which separates objectives", () => {
      expect(
        getSloListRowDisplay(buildRow({ currentSliPercentage: 99.9876 })).sli,
      ).toBe("99.988%");
    });

    /*
     * An overspent budget is shown as the negative number it is, with the
     * overage in time — never clamped to 0%, which would hide a breach.
     */
    test("shows an overspent budget as negative while the bar sits empty", () => {
      const display: SloListRowDisplay = getSloListRowDisplay(
        buildRow({
          errorBudgetRemainingPercentage: -12.46,
          errorBudgetRemainingSeconds: -600,
          sloStatus: SloStatus.BudgetExhausted,
        }),
      );

      expect(display.budget).toBe("-12.5%");
      expect(display.budgetTime).toBe("−10 min over budget");
      expect(display.budgetFillPercent).toBe(0);
      expect(display.statusColor).toBe(Red);
    });

    test("never renders null, NaN or a fake status for an SLO not evaluated yet", () => {
      const display: SloListRowDisplay = getSloListRowDisplay(
        buildRow({
          currentSliPercentage: null,
          errorBudgetRemainingPercentage: null,
          errorBudgetRemainingSeconds: null,
          currentBurnRate: null,
          sloStatus: null,
        }),
      );

      expect(display.sli).toBeNull();
      expect(display.budget).toBeNull();
      expect(display.budgetTime).toBeNull();
      expect(display.budgetFillPercent).toBeNull();
      expect(display.burnRate).toBeNull();
      expect(display.burnRateTone).toBe(SloBurnRateTone.Unknown);
      // The target is configuration, so it is known before any evaluation.
      expect(display.target).toBe("target 99.9%");
      // Not "Healthy", and not "Unknown": the same words as the summary strip.
      expect(display.statusText).toBe(SLO_NOT_EVALUATED_STATUS_LABEL);
      expect(display.statusColor).toBe(Gray500);
    });

    test("omits the target line for an SLO without one", () => {
      expect(
        getSloListRowDisplay(buildRow({ targetPercentage: null })).target,
      ).toBeNull();
    });

    test("names every status in the words the SLO pages use", () => {
      for (const status of Object.values(SloStatus)) {
        expect(
          getSloListRowDisplay(buildRow({ sloStatus: status })).statusText,
        ).toBe(status);
      }
    });

    test("colours the three reliability states and greys the rest", () => {
      const colours: Array<[SloStatus, string]> = [
        [SloStatus.Healthy, Green.toString()],
        [SloStatus.AtRisk, Yellow.toString()],
        [SloStatus.BudgetExhausted, Red.toString()],
        [SloStatus.Misconfigured, Gray500.toString()],
        [SloStatus.Paused, Gray500.toString()],
      ];

      for (const [status, colour] of colours) {
        expect(
          `${status}: ${getSloListRowDisplay(
            buildRow({ sloStatus: status }),
          ).statusColor.toString()}`,
        ).toBe(`${status}: ${colour}`);
      }
    });
  });

  describe("summarizeSloStatuses", () => {
    test("summarises nothing for an empty list", () => {
      expect(summarizeSloStatuses([])).toEqual([]);
    });

    test("counts worst first and leaves out statuses nobody is in", () => {
      const summary: Array<SloStatusSummaryEntry> = summarizeSloStatuses([
        buildRow({ sloStatus: SloStatus.Healthy }),
        buildRow({ sloStatus: SloStatus.Healthy }),
        buildRow({ sloStatus: SloStatus.Paused }),
        buildRow({ sloStatus: SloStatus.BudgetExhausted }),
        buildRow({ sloStatus: null }),
      ]);

      expect(
        summary.map((entry: SloStatusSummaryEntry): string => {
          return `${entry.count} ${entry.label}`;
        }),
      ).toEqual([
        `1 ${SloStatus.BudgetExhausted}`,
        `2 ${SloStatus.Healthy}`,
        `1 ${SloStatus.Paused}`,
        `1 ${SLO_NOT_EVALUATED_STATUS_LABEL}`,
      ]);
    });

    test("orders every status by severity, with not-evaluated last", () => {
      const rows: Array<SloWidgetStateData> = [
        buildRow({ sloStatus: null }),
        ...Object.values(SloStatus).map(
          (status: SloStatus): SloWidgetStateData => {
            return buildRow({ sloStatus: status });
          },
        ),
      ];

      expect(
        summarizeSloStatuses(rows).map(
          (entry: SloStatusSummaryEntry): string => {
            return entry.label;
          },
        ),
      ).toEqual([
        SloStatus.BudgetExhausted,
        SloStatus.AtRisk,
        SloStatus.Healthy,
        SloStatus.Misconfigured,
        SloStatus.Paused,
        SLO_NOT_EVALUATED_STATUS_LABEL,
      ]);
    });

    /*
     * A status string from a newer server is not dropped: the counts must
     * always add up to the rows the list shows.
     */
    test("counts an unrecognised status as not evaluated, so the counts add up", () => {
      const rows: Array<SloWidgetStateData> = [
        buildRow({ sloStatus: "Degraded" as SloStatus }),
        buildRow({ sloStatus: undefined }),
        buildRow({ sloStatus: SloStatus.AtRisk }),
      ];

      const summary: Array<SloStatusSummaryEntry> = summarizeSloStatuses(rows);
      const total: number = summary.reduce(
        (sum: number, entry: SloStatusSummaryEntry): number => {
          return sum + entry.count;
        },
        0,
      );

      expect(total).toBe(rows.length);
      expect(summary).toEqual([
        { label: SloStatus.AtRisk, count: 1, color: Yellow },
        { label: SLO_NOT_EVALUATED_STATUS_LABEL, count: 2, color: Gray500 },
      ]);
    });
  });

  describe("the status filter's values", () => {
    test("offers every SloStatus exactly once, worst first", () => {
      expect([...SLO_LIST_STATUS_FILTER_VALUES].sort()).toEqual(
        [...Object.values(SloStatus)].sort(),
      );
      expect(new Set(SLO_LIST_STATUS_FILTER_VALUES).size).toBe(
        SLO_LIST_STATUS_FILTER_VALUES.length,
      );
      expect(SLO_LIST_STATUS_FILTER_VALUES[0]).toBe(SloStatus.BudgetExhausted);
    });
  });
});
