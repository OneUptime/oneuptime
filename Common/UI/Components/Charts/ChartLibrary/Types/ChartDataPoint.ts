/**
 * Hidden per-row field carrying the raw bucket start as ms since epoch.
 * Underscore-prefixed so it cannot collide with real series names, and it
 * is never rendered as a series (only `categories` keys are drawn).
 */
export const CHART_DATA_POINT_DATE_KEY: string = "__date";

export default interface ChartDataPoint {
  [x: string]: number | string;
}
