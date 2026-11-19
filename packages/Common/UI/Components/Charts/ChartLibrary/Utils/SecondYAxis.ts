/*
 * A CHART'S SECOND VALUE AXIS, ON ITS RIGHT (issue #10042).
 *
 * A metric chart overlays queries that are not all in one kind of unit: bytes
 * on a chart in percent. Such a series is drawn against a second value axis,
 * on the chart's right, written in its own unit, so its line, its values and
 * its lines read right. Every other series is drawn against the first axis,
 * on the left, as before.
 *
 * The line, area and bar charts read these to draw that axis: which of their
 * categories are drawn against it, how it writes its ticks, how wide it is
 * and where its domain runs. A reference line or an exemplar drawn for a
 * series on the second axis says so (isOnSecondYAxis) and is drawn against
 * it too. A chart with no second axis draws exactly as it always has.
 *
 * A series in a unit neither axis can say is drawn to a scale of its own,
 * with no axis (ChartOwnScale, issue #10080), and so are its lines and
 * exemplars (ownScaleId).
 */

import {
  ValueAxisFormatter,
  ValueAxisPrecision,
} from "../../Types/YAxis/YAxis";

// The second axis's recharts id. The first axis keeps recharts' default, 0.
export const SECOND_Y_AXIS_ID: string = "second";

export interface ChartSecondYAxis {
  // The categories drawn against it; every other one is on the first axis.
  categories: Array<string>;
  // How its ticks write a value, and the tooltip a value of its categories.
  valueFormatter: ValueAxisFormatter;
  // Its width in pixels, as wide as its widest tick (YAxisWidth).
  width: number;
  // "auto" for its lower end, else minValue (0 when that is left out).
  autoMinValue: boolean;
  minValue?: number | undefined;
  maxValue?: number | undefined;
}

/*
 * A SCALE OF ITS OWN, WITH NO AXIS (issue #10080): for categories in a unit
 * neither axis can say. Recharts draws it as a hidden value axis of its own,
 * so its lines keep their shape over the plot's height and the axes keep
 * theirs; it writes no tick, and takes no room.
 */
export interface ChartOwnScale {
  // Its name, as its host gives it and its lines and exemplars name it.
  id: string;
  // The categories drawn to it.
  categories: Array<string>;
  // How the tooltip writes a value of its categories.
  valueFormatter: ValueAxisFormatter;
  // "auto" for its lower end, else minValue (0 when that is left out).
  autoMinValue: boolean;
  minValue?: number | undefined;
  maxValue?: number | undefined;
}

// An own scale's recharts id: apart from the first axis's 0 and the second's.
export function getOwnScaleYAxisId(id: string): string {
  return `own-scale-${id}`;
}

// The own scale a category is drawn to, if any.
export function getCategoryOwnScale(
  category: string,
  ownScales: ReadonlyArray<ChartOwnScale> | undefined,
): ChartOwnScale | undefined {
  return (ownScales || []).find((scale: ChartOwnScale): boolean => {
    return scale.categories.includes(category);
  });
}

/*
 * The props that put a category's line, area or bar on its axis: nothing for
 * the first axis, recharts' default, the second axis's id for one drawn
 * against it, and its own scale's for one drawn to a scale of its own.
 */
export function getCategoryYAxisProps(
  category: string,
  secondYAxis: ChartSecondYAxis | undefined,
  ownScales?: ReadonlyArray<ChartOwnScale> | undefined,
): { yAxisId?: string } {
  const ownScale: ChartOwnScale | undefined = getCategoryOwnScale(
    category,
    ownScales,
  );

  if (ownScale) {
    return { yAxisId: getOwnScaleYAxisId(ownScale.id) };
  }

  return secondYAxis && secondYAxis.categories.includes(category)
    ? { yAxisId: SECOND_Y_AXIS_ID }
    : {};
}

/*
 * The props that put a reference line or an exemplar on its axis: the second
 * axis's id, or an own scale's, only while the chart draws it, so a mark
 * meant for it is never pointed at an axis that is not there.
 */
export function getMarkYAxisProps(
  isOnSecondYAxis: boolean | undefined,
  secondYAxis: ChartSecondYAxis | undefined,
  ownScaleId?: string | undefined,
  ownScales?: ReadonlyArray<ChartOwnScale> | undefined,
): { yAxisId?: string } {
  if (
    ownScaleId !== undefined &&
    (ownScales || []).some((scale: ChartOwnScale): boolean => {
      return scale.id === ownScaleId;
    })
  ) {
    return { yAxisId: getOwnScaleYAxisId(ownScaleId) };
  }

  return isOnSecondYAxis && secondYAxis ? { yAxisId: SECOND_Y_AXIS_ID } : {};
}

/*
 * A value as an axis's formatter writes it: with the precision the chart
 * writes that axis's ticks with, when it steps the axis itself (issue
 * #10079), and as the formatter always has otherwise.
 */
function writeWithPrecision(
  formatter: ValueAxisFormatter,
  precision: ValueAxisPrecision | undefined,
): (value: number) => string {
  return (value: number): string => {
    return precision ? formatter(value, precision) : formatter(value);
  };
}

/*
 * How the tooltip writes a category's value: as the series asks
 * (categoryValueFormatters), else as its own scale writes one, for a series
 * drawn to a scale of its own, else as the axis it is drawn against writes
 * its ticks, to the same figures.
 */
export function getCategoryValueFormatter(input: {
  category: string;
  valueFormatter: ValueAxisFormatter;
  secondYAxis?: ChartSecondYAxis | undefined;
  ownScales?: ReadonlyArray<ChartOwnScale> | undefined;
  categoryValueFormatters?:
    | Record<string, (value: number) => string>
    | undefined;
  // The figures each axis's ticks are written with (ValueAxisTicks).
  firstAxisPrecision?: ValueAxisPrecision | undefined;
  secondAxisPrecision?: ValueAxisPrecision | undefined;
}): (value: number) => string {
  const own: ((value: number) => string) | undefined =
    input.categoryValueFormatters?.[input.category];

  if (own) {
    return own;
  }

  const ownScale: ChartOwnScale | undefined = getCategoryOwnScale(
    input.category,
    input.ownScales,
  );

  if (ownScale) {
    return writeWithPrecision(ownScale.valueFormatter, undefined);
  }

  if (
    input.secondYAxis &&
    input.secondYAxis.categories.includes(input.category)
  ) {
    return writeWithPrecision(
      input.secondYAxis.valueFormatter,
      input.secondAxisPrecision,
    );
  }

  return writeWithPrecision(input.valueFormatter, input.firstAxisPrecision);
}
