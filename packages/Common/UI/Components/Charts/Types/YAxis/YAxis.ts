import YAxisMaxMin from "./YAxisMaxMin";
import YAxisType from "./YAxisType";

export enum YAxisPrecision {
  NoDecimals = "NoDecimals",
  OneDecimal = "OneDecimal",
  TwoDecimals = "TwoDecimals",
  ThreeDecimals = "ThreeDecimals",
}

/*
 * THE FIGURES A VALUE AXIS WRITES ITS TICKS WITH (issues #10079, #10117).
 *
 * The chart steps every value axis itself, in round steps of the unit it is
 * written in (1, 2, 2.5 or 5 times a power of ten; natural steps of time on
 * a duration axis, issue #10118), and hands its formatter the step: a
 * formatter that can write more figures writes as many as the step needs
 * and no more, "17.200 GB", "17.205 GB" beside each other, "25%" on an axis
 * stepping a quarter (ValueFormatter's `step` option). Before, an axis whose
 * ticks already read apart kept recharts' own steps, which are not round in
 * the unit drawn: "7.57 GB", "7.65 GB", "7.74 GB". The tooltip writes the
 * values of the axis's series with the step's figures only where its own
 * figures cannot tell two ticks apart ("17.2 GB" five times).
 */
export interface ValueAxisPrecision {
  // The step between the axis's neighbouring ticks, in the axis's unit.
  step: number;
  /*
   * The size of the axis's largest tick, either side of zero, in the axis's
   * unit: a duration axis writes every tick in the units its largest one
   * needs, so its ticks read alike ("1:29:59" beside "1:30:00", never "59
   * min 59 sec" beside "1:00:00", issue #10118). Undefined: each value is
   * written in the units it needs itself.
   */
  largestTick?: number | undefined;
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
  /*
   * For an axis whose values are spans of time: the seconds one value
   * stands for (1 for seconds, 0.001 for milliseconds, 60 for minutes;
   * ValueFormatter.getDurationUnitInSeconds). The axis then steps in
   * natural units of time - 15 sec, 5 min, 30 min, 6 h, 2 d - not in
   * decimal fractions of an hour (issue #10118). Left out, the axis steps
   * in round decimal steps.
   */
  durationUnitInSeconds?: number | undefined;
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

/*
 * A SCALE OF ITS OWN, WITH NO AXIS (issue #10080).
 *
 * For series in a unit neither of the chart's axes can say: a metric chart's
 * overlaid query in a third kind of unit, milliseconds on a chart in percent
 * and bytes. Drawn against either axis, such a line stretched it (70
 * processes pulled a 0-1 fraction's axis up to 7,000%). Drawn to a scale of
 * its own, its line keeps its shape over the plot's height, as an axis would
 * draw it over its own domain, and the axes keep theirs. No axis is drawn
 * for it: the tooltip writes its series' values with its formatter, and the
 * host's legend says which series are drawn so. A reference line or an
 * exemplar of such a series names the scale (ownScaleId) and is drawn to it.
 */
export interface OwnScaleYAxis extends SecondYAxis {
  // The scale's name, unique on its chart, that its lines and exemplars give.
  id: string;
}
