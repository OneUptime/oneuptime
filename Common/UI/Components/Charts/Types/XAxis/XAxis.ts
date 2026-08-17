import XAxisMaxMin from "./XAxisMaxMin";
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
