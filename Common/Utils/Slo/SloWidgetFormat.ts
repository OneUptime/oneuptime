import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import { SloWidgetMetric } from "../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";

/**
 * Pure value/label derivation for the dashboard SLO widget.
 *
 * Everything the widget needs to turn a ServiceLevelObjective row into
 * display strings lives here rather than in the React renderer, so the
 * formatting rules (and every null / negative / rounding edge) are
 * unit-testable without a DOM.
 *
 * The worker-maintained state columns on ServiceLevelObjective are NULL
 * until the SLO is first evaluated, so every entry point must be able to
 * answer "not evaluated yet" instead of rendering "null%" or "NaN%".
 */

/** Shown in place of a number whenever the SLO has no evaluated state. */
export const SLO_NOT_EVALUATED_TEXT: string = "Not evaluated yet";

/** U+2212 MINUS SIGN — reads as a minus rather than a hyphen at tile sizes. */
const MINUS_SIGN: string = "−";

/** U+00D7 MULTIPLICATION SIGN — burn rate is a multiplier ("3.2×"). */
const MULTIPLICATION_SIGN: string = "×";

/**
 * The subset of ServiceLevelObjective the widget reads. Declared
 * structurally (rather than importing the database model) so this helper
 * stays dependency-free and tests can pass plain objects. Every state
 * field is nullable because the evaluation worker has not necessarily
 * run yet.
 */
export interface SloWidgetStateData {
  name?: string | undefined | null;
  targetPercentage?: number | undefined | null;
  currentSliPercentage?: number | undefined | null;
  errorBudgetRemainingPercentage?: number | undefined | null;
  errorBudgetRemainingSeconds?: number | undefined | null;
  currentBurnRate?: number | undefined | null;
  sloStatus?: SloStatus | undefined | null;
}

export interface SloWidgetTileDisplay {
  /** False when the metric's state column is null/undefined/non-finite. */
  isEvaluated: boolean;
  /** The big number, or SLO_NOT_EVALUATED_TEXT when isEvaluated is false. */
  value: string;
  /** Secondary line under the number, or null when there is nothing to add. */
  subline: string | null;
}

/**
 * `null` for anything that is not a real, finite number — which includes
 * the un-evaluated NULL columns, and NaN/Infinity should a bad row ever
 * reach the client. Booleans and strings are rejected too so a JSON
 * round-trip cannot smuggle `"99.9"` past the finite check.
 */
type ToFiniteNumberFunction = (
  value: number | undefined | null,
) => number | null;

const toFiniteNumber: ToFiniteNumberFunction = (
  value: number | undefined | null,
): number | null => {
  if (typeof value !== "number" || !isFinite(value)) {
    return null;
  }

  return value;
};

/**
 * Round to at most `maxDecimals` places. Number -> string conversion drops
 * trailing zeros for free, so 99.90 renders "99.9" and 100 renders "100"
 * instead of "99.90" / "100.00".
 */
type RoundToDecimalsFunction = (value: number, maxDecimals: number) => number;

const roundToDecimals: RoundToDecimalsFunction = (
  value: number,
  maxDecimals: number,
): number => {
  const factor: number = Math.pow(10, maxDecimals);

  /*
   * `+ 0` normalises -0 (which Math.round can produce from a tiny
   * negative) so it never renders as "-0".
   */
  return Math.round(value * factor) / factor + 0;
};

/**
 * SLI is quoted to three decimals to match the SLO pages — the digits
 * past the second matter at 99.99x targets. Error budget remaining is a
 * coarse gauge, so one decimal is enough; the precise number lives in the
 * seconds subline.
 */
const SLI_DECIMALS: number = 3;
const BUDGET_PERCENT_DECIMALS: number = 1;
const BURN_RATE_DECIMALS: number = 2;

export type FormatSloPercentFunction = (
  value: number | undefined | null,
  maxDecimals?: number | undefined,
) => string | null;

export const formatSloPercent: FormatSloPercentFunction = (
  value: number | undefined | null,
  maxDecimals?: number | undefined,
): string | null => {
  const numericValue: number | null = toFiniteNumber(value);

  if (numericValue === null) {
    return null;
  }

  return `${roundToDecimals(numericValue, maxDecimals ?? SLI_DECIMALS)}%`;
};

export type FormatSloBurnRateFunction = (
  value: number | undefined | null,
) => string | null;

export const formatSloBurnRate: FormatSloBurnRateFunction = (
  value: number | undefined | null,
): string | null => {
  const numericValue: number | null = toFiniteNumber(value);

  if (numericValue === null) {
    return null;
  }

  return `${roundToDecimals(numericValue, BURN_RATE_DECIMALS)}${MULTIPLICATION_SIGN}`;
};

/**
 * `errorBudgetRemainingSeconds` is SIGNED: negative means the budget is
 * overspent. Render the overage plainly ("−42 min over budget") rather
 * than clamping it to zero, which would hide a breach.
 */
export type FormatErrorBudgetRemainingSecondsFunction = (
  seconds: number | undefined | null,
) => string | null;

export const formatErrorBudgetRemainingSeconds: FormatErrorBudgetRemainingSecondsFunction =
  (seconds: number | undefined | null): string | null => {
    const numericSeconds: number | null = toFiniteNumber(seconds);

    if (numericSeconds === null) {
      return null;
    }

    const isOverBudget: boolean = numericSeconds < 0;
    const suffix: string = isOverBudget ? "over budget" : "remaining";
    const minutes: number = Math.round(Math.abs(numericSeconds) / 60);

    if (minutes === 0) {
      /*
       * Exactly zero is a real state worth stating; a sub-30-second
       * remainder would otherwise round to a misleading "0 min".
       */
      if (numericSeconds === 0) {
        return `0 min ${suffix}`;
      }

      return `under 1 min ${suffix}`;
    }

    return `${isOverBudget ? MINUS_SIGN : ""}${minutes} min ${suffix}`;
  };

export type GetSloMetricLabelFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
) => string;

export const getSloMetricLabel: GetSloMetricLabelFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
): string => {
  if (sloMetric === SloWidgetMetric.ErrorBudgetRemaining) {
    return "Error Budget Remaining";
  }

  if (sloMetric === SloWidgetMetric.BurnRate) {
    return "Burn Rate";
  }

  // Sli is the default metric, so it is also the fallback label.
  return "SLI";
};

/**
 * ClickHouse `SloHistory.metricName` value for each widget metric — the
 * strings the evaluation worker writes.
 */
export type GetSloHistoryMetricNameFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
) => string;

export const getSloHistoryMetricName: GetSloHistoryMetricNameFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
): string => {
  if (sloMetric === SloWidgetMetric.ErrorBudgetRemaining) {
    return "error.budget.remaining.percent";
  }

  if (sloMetric === SloWidgetMetric.BurnRate) {
    return "burn.rate";
  }

  return "sli.percent";
};

/**
 * Widget header: the author's title wins; otherwise fall back to the SLO
 * name plus the metric label so an unnamed widget still says what it is.
 * A whitespace-only title counts as empty.
 */
export type GetSloWidgetTitleFunction = (data: {
  widgetTitle?: string | undefined | null;
  sloName?: string | undefined | null;
  sloMetric?: SloWidgetMetric | undefined | null;
}) => string;

export const getSloWidgetTitle: GetSloWidgetTitleFunction = (data: {
  widgetTitle?: string | undefined | null;
  sloName?: string | undefined | null;
  sloMetric?: SloWidgetMetric | undefined | null;
}): string => {
  const trimmedTitle: string = (data.widgetTitle || "").trim();

  if (trimmedTitle) {
    return trimmedTitle;
  }

  const metricLabel: string = getSloMetricLabel(data.sloMetric);
  const trimmedName: string = (data.sloName || "").trim();

  if (!trimmedName) {
    return metricLabel;
  }

  return `${trimmedName} · ${metricLabel}`;
};

/**
 * Everything the tile renders for one metric. Returns the explicit
 * not-evaluated state whenever the metric's own state column is missing,
 * so the caller never has to guard against "null%" itself.
 */
export type GetSloWidgetTileDisplayFunction = (data: {
  sloMetric?: SloWidgetMetric | undefined | null;
  slo?: SloWidgetStateData | undefined | null;
}) => SloWidgetTileDisplay;

export const getSloWidgetTileDisplay: GetSloWidgetTileDisplayFunction = (data: {
  sloMetric?: SloWidgetMetric | undefined | null;
  slo?: SloWidgetStateData | undefined | null;
}): SloWidgetTileDisplay => {
  const notEvaluated: SloWidgetTileDisplay = {
    isEvaluated: false,
    value: SLO_NOT_EVALUATED_TEXT,
    subline: null,
  };

  const slo: SloWidgetStateData | undefined | null = data.slo;

  if (!slo) {
    return notEvaluated;
  }

  if (data.sloMetric === SloWidgetMetric.ErrorBudgetRemaining) {
    const value: string | null = formatSloPercent(
      slo.errorBudgetRemainingPercentage,
      BUDGET_PERCENT_DECIMALS,
    );

    if (value === null) {
      return notEvaluated;
    }

    return {
      isEvaluated: true,
      value: value,
      subline: formatErrorBudgetRemainingSeconds(
        slo.errorBudgetRemainingSeconds,
      ),
    };
  }

  if (data.sloMetric === SloWidgetMetric.BurnRate) {
    const value: string | null = formatSloBurnRate(slo.currentBurnRate);

    if (value === null) {
      return notEvaluated;
    }

    return {
      isEvaluated: true,
      value: value,
      subline: null,
    };
  }

  // Sli (also the default when the argument was never set).
  const value: string | null = formatSloPercent(
    slo.currentSliPercentage,
    SLI_DECIMALS,
  );

  if (value === null) {
    return notEvaluated;
  }

  const target: string | null = formatSloPercent(
    slo.targetPercentage,
    SLI_DECIMALS,
  );

  return {
    isEvaluated: true,
    value: value,
    subline: target === null ? null : `target ${target}`,
  };
};

/**
 * Bucket size for the Chart display, picked from the dashboard's selected
 * window so the point count stays bounded no matter how often the worker
 * writes (it writes every ~5 minutes today). Same reasoning as the SLO
 * detail page's charts: aggregate server-side rather than pulling raw
 * rows under a row-count cap, which silently truncates long windows.
 *
 *   <= 12h  -> 5-minute buckets  (<= 144 points, the native write cadence)
 *   <= 3d   -> 30-minute buckets (<= 144 points)
 *   <= 45d  -> hourly buckets    (<= 1,080 points)
 *   >  45d  -> daily buckets     (<= ~365 points for a year)
 */
export type GetSloChartAggregationIntervalFunction = (
  rangeInMinutes: number,
) => AggregationInterval;

export const getSloChartAggregationInterval: GetSloChartAggregationIntervalFunction =
  (rangeInMinutes: number): AggregationInterval => {
    if (!isFinite(rangeInMinutes) || rangeInMinutes <= 12 * 60) {
      return AggregationInterval.FiveMinutes;
    }

    if (rangeInMinutes <= 3 * 24 * 60) {
      return AggregationInterval.ThirtyMinutes;
    }

    if (rangeInMinutes <= 45 * 24 * 60) {
      return AggregationInterval.Hour;
    }

    return AggregationInterval.Day;
  };

/**
 * Y-axis / tooltip formatter for the Chart display. Bare numbers are
 * ambiguous across the three metrics (a "3" could be 3% or 3× budget
 * burn), so each metric carries its own unit.
 */
export type FormatSloChartValueFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
  value: number,
) => string;

export const formatSloChartValue: FormatSloChartValueFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
  value: number,
): string => {
  if (sloMetric === SloWidgetMetric.BurnRate) {
    return formatSloBurnRate(value) || "";
  }

  if (sloMetric === SloWidgetMetric.ErrorBudgetRemaining) {
    return formatSloPercent(value, BUDGET_PERCENT_DECIMALS) || "";
  }

  return formatSloPercent(value, SLI_DECIMALS) || "";
};
