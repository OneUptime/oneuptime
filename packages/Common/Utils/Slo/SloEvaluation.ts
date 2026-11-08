/**
 * Cadence constants shared by the SLO evaluation worker and every UI
 * surface that describes what the worker produced.
 *
 * These numbers were previously duplicated as prose: the worker owned
 * them, and the dashboard said "evaluated every few minutes" and "1×
 * spends the budget exactly over the window" without ever naming the
 * lookback the headline burn rate is actually measured over. A reader who
 * compared the tile against a burn rate rule had no way to know they were
 * measuring different spans. Naming them once here keeps the copy and the
 * computation from drifting.
 */

/** How often a due SLO is re-evaluated, and how far ahead the worker schedules the next run. */
export const SLO_EVALUATION_CADENCE_MINUTES: number = 5;

/**
 * Lookback for the "current burn rate" column shown on the SLO overview
 * and the dashboard SLO widget. Deliberately equal to the default
 * fast-burn rule's long window, so the tile and that rule move together.
 */
export const SLO_CURRENT_BURN_RATE_WINDOW_MINUTES: number = 60;

/**
 * The longest long window of a burn rate rule the current burn rate is
 * compared with: the default slow-burn rule's 6 hours.
 *
 * The current burn rate is a reading of the last hour. It can stand in for a
 * rule that looks back a few hours - an hour at Slow burn's threshold is how
 * a 6-hour burn at it starts - but not for one that looks back days. The
 * default slow-leak rule fires at 1x sustained over 3 days, and an hour
 * compared with that put "Rule threshold reached" on the overview for any
 * hour that burned at all: at 99.9%, 4 seconds of downtime in an hour is 1x.
 * Rules that look back longer are left out of the comparison, and say so.
 */
export const SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES: number = 360;

export type IsComparedWithCurrentBurnRateFunction = (
  longWindowInMinutes: number | undefined | null,
) => boolean;

/**
 * Whether a rule with this long window is compared with the current burn
 * rate. A rule whose long window is unknown is compared, as every rule was
 * before: nothing says the hour cannot speak for it.
 */
export const isComparedWithCurrentBurnRate: IsComparedWithCurrentBurnRateFunction =
  (longWindowInMinutes: number | undefined | null): boolean => {
    if (
      typeof longWindowInMinutes !== "number" ||
      !Number.isFinite(longWindowInMinutes) ||
      longWindowInMinutes <= 0
    ) {
      return true;
    }

    return (
      longWindowInMinutes <=
      SLO_CURRENT_BURN_RATE_COMPARABLE_LONG_WINDOW_MINUTES
    );
  };

/*
 * The status hysteresis: how far the error budget has to come back before an
 * SLO leaves a status it fell into. Without it a rolling window that hovers
 * at a boundary - bad seconds ageing out, a new blip coming in - flips the
 * status, the feed and the owners' notifications every few minutes.
 *
 * Budget Exhausted is left once this much of the budget is back.
 */
export const SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE: number = 2;

/*
 * At Risk is left once the budget is this many points above the At Risk
 * threshold.
 */
export const SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE: number = 5;
