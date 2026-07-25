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
