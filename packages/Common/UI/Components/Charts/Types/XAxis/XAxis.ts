import XAxisMaxMin from "./XAxisMaxMin";
import XAxisPrecision from "./XAxisPrecision";
import XAxisType from "./XAxisType";

export enum XAxisAggregateType {
  Average = "Average",
  Sum = "Sum",
  Max = "Max",
  Min = "Min",
}

export interface XAxisOptions {
  type: XAxisType;
  min: XAxisMaxMin;
  max: XAxisMaxMin;
  aggregateType: XAxisAggregateType;
  /*
   * Pin the grid step instead of letting XAxisUtil derive one from the
   * window's duration.
   *
   * The derived ladder is a SECOND ladder: it guesses the bucket size the
   * data was aggregated at from how long the window is. A caller that
   * already knows the real bucket size does not have to guess, and must
   * not — the two ladders disagree in both directions:
   *
   *  - Finer. The derived ladder has four sub-minute tiers (<=15s / 75s /
   *    150s / 450s) while the analytics backend's finest bucket is one
   *    minute, so every window under 7.5 minutes got a grid the data could
   *    never fill. A 5-minute metric window drew an 11-slot 30-second grid
   *    over 5 one-minute rows: every other slot empty, and the axis running
   *    a full minute past the last real point.
   *  - Coarser. Aligning a window to the bucket grid widens it slightly
   *    (the start is floored), which can tip a window sitting exactly on a
   *    tier threshold — a 3h preset, say — into the next tier. The query is
   *    still pinned to the interval derived from the RAW window, so the
   *    chart then re-averages five one-minute rows into each five-minute
   *    slot: an unweighted average of averages.
   *
   * Set this to the interval the DATA was actually bucketed at and each
   * slot maps to exactly one backend bucket. Left undefined, the duration
   * ladder applies, which is right for callers whose points are raw
   * samples rather than server-side buckets.
   */
  precision?: XAxisPrecision | undefined;
}

export interface XAxis {
  /*
   * Human-readable name for the axis. Purely descriptive: the per-row key
   * the charts read is CHART_DATA_POINT_X_AXIS_KEY, never this string. It
   * used to double as that key, which meant a caller passing anything but
   * "Time" got a chart with axes and no series drawn on them.
   */
  legend: string;
  options: XAxisOptions;
}
