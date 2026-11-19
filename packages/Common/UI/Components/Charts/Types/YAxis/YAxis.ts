import YAxisMaxMin from "./YAxisMaxMin";
import YAxisType from "./YAxisType";

export enum YAxisPrecision {
  NoDecimals = "NoDecimals",
  OneDecimal = "OneDecimal",
  TwoDecimals = "TwoDecimals",
  ThreeDecimals = "ThreeDecimals",
}

/*
 * THE FIGURES A VALUE AXIS WRITES ITS TICKS WITH (issue #10079).
 *
 * An axis over a range small beside its values wrote the same label on every
 * tick: "17.2 GB" five times for a filesystem holding 17.2 GB give or take a
 * few megabytes. When an axis's ticks would read alike, the chart steps it in
 * round steps (1, 2, 2.5 or 5 times a power of ten) and hands its formatter
 * the step: a formatter that can write more figures writes as many as the
 * step needs, "17.200 GB", "17.205 GB" (ValueFormatter's `step` option). The
 * tooltip writes the values of the axis's series with the same figures.
 * Every other axis is handed nothing, and reads exactly as before.
 */
export interface ValueAxisPrecision {
  // The step between the axis's neighbouring ticks, in the axis's unit.
  step: number;
}

/*
 * How a value axis writes a value: a tick, a tooltip's value. A formatter
 * that takes no precision, or ignores it, keeps writing as it always has.
 */
export type ValueAxisFormatter = (
  value: number,
  precision?: ValueAxisPrecision,
) => string;

export interface YAxisOptions {
  type: YAxisType;
  min: YAxisMaxMin;
  max: YAxisMaxMin;
  formatter: ValueAxisFormatter;
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
