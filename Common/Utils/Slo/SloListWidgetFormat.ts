import { Gray500, Green, Red, Yellow } from "../../Types/BrandColors";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Color from "../../Types/Color";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import { getSloStatusColor, getSloStatusText } from "./SloStatusColor";
import { SLO_METRIC_SLO_NAME_ATTRIBUTE } from "./SloMetricType";
import {
  formatErrorBudgetRemainingSeconds,
  formatSloBurnRate,
  formatSloPercent,
  SloWidgetStateData,
} from "./SloWidgetFormat";

/**
 * Pure display rules for the dashboard SLO List widget — every objective in a
 * project with its status, SLI, error budget and burn rate.
 *
 * Kept out of the React renderer so the same ordering, grouping and
 * formatting can be unit-tested without a DOM, and so the public-dashboard
 * policy on the server shares the list's sort and variable mapping with the
 * browser instead of keeping a second copy that could drift.
 */

/*
 * Least error budget first. An SLO review starts with the objectives closest
 * to (or past) breaching, so the list is ordered server-side by the number
 * that says so — which also means a list capped by maxRows drops the
 * HEALTHIEST objectives, never the ones in trouble.
 *
 * Postgres sorts NULLs last on an ascending order, so SLOs the evaluation
 * worker has not reached yet fall to the bottom rather than masquerading as
 * the most urgent. Name breaks ties so equal budgets list stably.
 */
export const SLO_LIST_SORT: { [key: string]: SortOrder } = {
  errorBudgetRemainingPercentage: SortOrder.Ascending,
  name: SortOrder.Ascending,
};

/*
 * The list reads Postgres, not the metric store, so a TelemetryAttribute
 * variable reaches it only through DashboardModelQueryInterpolation — which
 * needs to be told which column an attribute key means. The `sloName`
 * attribute every `oneuptime.slo.*` series carries is the SLO's `name`
 * column, so picking an SLO in the toolbar narrows this list to that
 * objective, exactly as it narrows the SLO metric charts beside it.
 */
export const SLO_LIST_ATTRIBUTE_TO_COLUMN: Record<string, string> = {
  [SLO_METRIC_SLO_NAME_ATTRIBUTE]: "name",
};

export const SLO_LIST_DEFAULT_MAX_ROWS: number = 50;

export const SLO_NOT_EVALUATED_STATUS_LABEL: string = "Not Evaluated";

/*
 * Burn-rate emphasis. 1x spends the budget exactly over the compliance
 * window, so anything above it is spending faster than the objective can
 * sustain. 14.4x is the Google SRE workbook's one-hour paging threshold (2% of
 * a 30-day budget gone in an hour) — the current burn rate is itself measured
 * over the trailing hour, so it is the like-for-like line for "page someone".
 */
export const SLO_SUSTAINABLE_BURN_RATE: number = 1;
export const SLO_CRITICAL_BURN_RATE: number = 14.4;

export enum SloBurnRateTone {
  Unknown = "Unknown",
  Sustainable = "Sustainable",
  Elevated = "Elevated",
  Critical = "Critical",
}

export type GetSloBurnRateToneFunction = (
  burnRate: number | undefined | null,
) => SloBurnRateTone;

export const getSloBurnRateTone: GetSloBurnRateToneFunction = (
  burnRate: number | undefined | null,
): SloBurnRateTone => {
  if (typeof burnRate !== "number" || !isFinite(burnRate)) {
    return SloBurnRateTone.Unknown;
  }

  if (burnRate >= SLO_CRITICAL_BURN_RATE) {
    return SloBurnRateTone.Critical;
  }

  if (burnRate > SLO_SUSTAINABLE_BURN_RATE) {
    return SloBurnRateTone.Elevated;
  }

  return SloBurnRateTone.Sustainable;
};

/*
 * Width of the error-budget bar, as a percentage of its track. The stored
 * percentage is unrounded and goes NEGATIVE once the budget is overspent —
 * which is a real, displayed number — so only the bar is clamped. A bar
 * cannot be drawn at −30% of its track, and a budget cannot be more than
 * whole.
 */
export type GetSloBudgetBarFillPercentFunction = (
  errorBudgetRemainingPercentage: number | undefined | null,
) => number | null;

export const getSloBudgetBarFillPercent: GetSloBudgetBarFillPercentFunction = (
  errorBudgetRemainingPercentage: number | undefined | null,
): number | null => {
  if (
    typeof errorBudgetRemainingPercentage !== "number" ||
    !isFinite(errorBudgetRemainingPercentage)
  ) {
    return null;
  }

  return Math.min(Math.max(errorBudgetRemainingPercentage, 0), 100);
};

export interface SloListRowDisplay {
  // SLI to three decimals, or null before the first evaluation.
  sli: string | null;
  // "target 99.9%", or null when the SLO has no target.
  target: string | null;
  // Error budget remaining to one decimal (may be negative), or null.
  budget: string | null;
  // "42 min remaining" / "−10 min over budget", or null.
  budgetTime: string | null;
  // 0..100 bar width, or null when there is no budget figure to draw.
  budgetFillPercent: number | null;
  // "1.25×", or null.
  burnRate: string | null;
  burnRateTone: SloBurnRateTone;
  statusText: string;
  statusColor: Color;
}

/*
 * Same precision rules as the single-SLO widget (SloWidgetFormat): the SLI
 * keeps three decimals because 99.95 and 99.9 are different objectives, the
 * budget percentage one, and the burn rate is a multiplier.
 */
export type GetSloListRowDisplayFunction = (
  slo: SloWidgetStateData,
) => SloListRowDisplay;

export const getSloListRowDisplay: GetSloListRowDisplayFunction = (
  slo: SloWidgetStateData,
): SloListRowDisplay => {
  const target: string | null = formatSloPercent(slo.targetPercentage, 3);

  return {
    sli: formatSloPercent(slo.currentSliPercentage, 3),
    target: target === null ? null : `target ${target}`,
    budget: formatSloPercent(slo.errorBudgetRemainingPercentage, 1),
    budgetTime: formatErrorBudgetRemainingSeconds(
      slo.errorBudgetRemainingSeconds,
    ),
    budgetFillPercent: getSloBudgetBarFillPercent(
      slo.errorBudgetRemainingPercentage,
    ),
    burnRate: formatSloBurnRate(slo.currentBurnRate),
    burnRateTone: getSloBurnRateTone(slo.currentBurnRate),
    /*
     * A NULL status is an SLO the worker has not reached yet. The single-SLO
     * widget's pill says "Unknown"; in a list of objectives the summary strip
     * counts it as not evaluated, so the row says the same thing.
     */
    statusText: slo.sloStatus
      ? getSloStatusText(slo.sloStatus)
      : SLO_NOT_EVALUATED_STATUS_LABEL,
    statusColor: getSloStatusColor(slo.sloStatus),
  };
};

export interface SloStatusSummaryEntry {
  label: string;
  count: number;
  color: Color;
}

/*
 * Severity order for the summary strip: what needs attention reads first.
 * Paused and Misconfigured are not reliability signals, so they come after
 * Healthy; an SLO the worker has not evaluated yet comes last.
 */
const SUMMARY_ORDER: Array<{ status: SloStatus; color: Color }> = [
  { status: SloStatus.BudgetExhausted, color: Red },
  { status: SloStatus.AtRisk, color: Yellow },
  { status: SloStatus.Healthy, color: Green },
  { status: SloStatus.Misconfigured, color: Gray500 },
  { status: SloStatus.Paused, color: Gray500 },
];

/*
 * Counts per status for the rows the list is showing, worst first, omitting
 * statuses nobody is in. A status string the enum does not know (a row
 * written by a newer server) is counted as not evaluated rather than dropped,
 * so the counts always add up to the number of rows.
 */
export type SummarizeSloStatusesFunction = (
  slos: Array<SloWidgetStateData>,
) => Array<SloStatusSummaryEntry>;

export const summarizeSloStatuses: SummarizeSloStatusesFunction = (
  slos: Array<SloWidgetStateData>,
): Array<SloStatusSummaryEntry> => {
  const counts: Map<string, number> = new Map<string, number>();
  let notEvaluated: number = 0;

  const knownStatuses: Array<string> = SUMMARY_ORDER.map(
    (entry: { status: SloStatus; color: Color }): string => {
      return entry.status;
    },
  );

  for (const slo of slos) {
    const status: string | undefined | null = slo.sloStatus;

    if (!status || !knownStatuses.includes(status)) {
      notEvaluated++;
      continue;
    }

    counts.set(status, (counts.get(status) || 0) + 1);
  }

  const summary: Array<SloStatusSummaryEntry> = [];

  for (const entry of SUMMARY_ORDER) {
    const count: number = counts.get(entry.status) || 0;

    if (count > 0) {
      summary.push({ label: entry.status, count: count, color: entry.color });
    }
  }

  if (notEvaluated > 0) {
    summary.push({
      label: SLO_NOT_EVALUATED_STATUS_LABEL,
      count: notEvaluated,
      color: Gray500,
    });
  }

  return summary;
};

/*
 * The valid values of the widget's status filter, in the order the settings
 * dropdown offers them. The public-dashboard policy validates stored filters
 * against this same list.
 */
export const SLO_LIST_STATUS_FILTER_VALUES: Array<SloStatus> = [
  SloStatus.BudgetExhausted,
  SloStatus.AtRisk,
  SloStatus.Healthy,
  SloStatus.Misconfigured,
  SloStatus.Paused,
];
