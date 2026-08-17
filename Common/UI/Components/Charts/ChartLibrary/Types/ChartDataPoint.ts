/**
 * Hidden per-row field carrying the raw bucket start as ms since epoch.
 * Underscore-prefixed so it cannot collide with real series names, and it
 * is never rendered as a series (only `categories` keys are drawn).
 */
export const CHART_DATA_POINT_DATE_KEY: string = "__date";

/**
 * Per-row field carrying the FORMATTED x-axis label.
 *
 * This is the recharts `XAxis` dataKey — the Line / Bar / Area wrappers all
 * pass it down as their `index` prop. `DataPointUtil` must therefore write
 * the label under exactly this key: a row keyed anything else leaves every
 * point with an undefined category, and recharts then draws no line, bar or
 * area at all (the axes and grid still render, so the chart looks alive but
 * empty). Keeping the single constant on both sides is what stops that from
 * being an invisible coupling between two distant files.
 */
export const CHART_DATA_POINT_X_AXIS_KEY: string = "Time";

export default interface ChartDataPoint {
  [x: string]: number | string;
}
