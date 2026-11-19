import YAxisMaxMin from "./YAxisMaxMin";
import YAxisType from "./YAxisType";

export enum YAxisPrecision {
  NoDecimals = "NoDecimals",
  OneDecimal = "OneDecimal",
  TwoDecimals = "TwoDecimals",
  ThreeDecimals = "ThreeDecimals",
}

export interface YAxisOptions {
  type: YAxisType;
  min: YAxisMaxMin;
  max: YAxisMaxMin;
  formatter: (value: number) => string;
  precision: YAxisPrecision;
}

export default interface YAxis {
  legend: string;
  options: YAxisOptions;
}

/*
 * A chart's second value axis, on its right (issue #10042): for series in a
 * unit of another kind than the first axis's, such as bytes overlaid on a
 * chart in percent. It writes its ticks, and the tooltip writes its series'
 * values, with its own formatter, and runs over its own domain.
 */
export interface SecondYAxis extends YAxis {
  // The series drawn against it, by name; every other one is on the first.
  seriesNames: Array<string>;
}
