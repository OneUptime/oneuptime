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
 */

// The second axis's recharts id. The first axis keeps recharts' default, 0.
export const SECOND_Y_AXIS_ID: string = "second";

export interface ChartSecondYAxis {
  // The categories drawn against it; every other one is on the first axis.
  categories: Array<string>;
  // How its ticks write a value, and the tooltip a value of its categories.
  valueFormatter: (value: number) => string;
  // Its width in pixels, as wide as its widest tick (YAxisWidth).
  width: number;
  // "auto" for its lower end, else minValue (0 when that is left out).
  autoMinValue: boolean;
  minValue?: number | undefined;
  maxValue?: number | undefined;
}

/*
 * The props that put a category's line, area or bar on its axis: nothing for
 * the first axis, recharts' default, and the second axis's id for one drawn
 * against it.
 */
export function getCategoryYAxisProps(
  category: string,
  secondYAxis: ChartSecondYAxis | undefined,
): { yAxisId?: string } {
  return secondYAxis && secondYAxis.categories.includes(category)
    ? { yAxisId: SECOND_Y_AXIS_ID }
    : {};
}

/*
 * The props that put a reference line or an exemplar on its axis: the second
 * axis's id only while the chart draws one, so a mark meant for it is never
 * pointed at an axis that is not there.
 */
export function getMarkYAxisProps(
  isOnSecondYAxis: boolean | undefined,
  secondYAxis: ChartSecondYAxis | undefined,
): { yAxisId?: string } {
  return isOnSecondYAxis && secondYAxis ? { yAxisId: SECOND_Y_AXIS_ID } : {};
}

/*
 * How the tooltip writes a category's value: as the series asks
 * (categoryValueFormatters, for a series whose unit is neither axis's), else
 * as the axis it is drawn against writes its ticks.
 */
export function getCategoryValueFormatter(input: {
  category: string;
  valueFormatter: (value: number) => string;
  secondYAxis?: ChartSecondYAxis | undefined;
  categoryValueFormatters?:
    | Record<string, (value: number) => string>
    | undefined;
}): (value: number) => string {
  const own: ((value: number) => string) | undefined =
    input.categoryValueFormatters?.[input.category];

  if (own) {
    return own;
  }

  if (
    input.secondYAxis &&
    input.secondYAxis.categories.includes(input.category)
  ) {
    return input.secondYAxis.valueFormatter;
  }

  return input.valueFormatter;
}
