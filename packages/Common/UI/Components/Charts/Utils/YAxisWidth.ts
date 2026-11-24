import SeriesPoint from "../Types/SeriesPoints";
import DataPoint from "../Types/DataPoint";
import YAxisMaxMin from "../Types/YAxis/YAxisMaxMin";

/*
 * THE VALUE AXIS, AS WIDE AS ITS WIDEST TICK.
 *
 * A chart's value axis was 64 pixels wide whatever its ticks said, and the
 * chart library breaks a tick wider than its axis at its spaces: a
 * Kubernetes API server's "1.85K req/s" drew as "1.85K" over "req/s", and
 * "100 req per Second" over three lines with the top one cut at the card's
 * edge (#8049). The axis keeps its 64 pixels, so every chart that fitted
 * looks as it did and charts stacked one above the other keep their plots
 * lined up, and grows to the widest tick it can draw: the formatted
 * extremes of the data and of the axis' own bounds, and the round values
 * the axis may step to above them (85.7 can be drawn as a "100" tick).
 *
 * Measured, not rendered: a tick is 10 pixels of Inter at weight 500 with
 * tabular digits, about 6 pixels a character, and the tick sits 4 pixels
 * off the plot with the library's own margin beside it. Capped, so a
 * runaway label never takes the plot's room: past the cap the tick is cut,
 * as any text too long for its box is.
 */
export const Y_AXIS_WIDTH_IN_PX: number = 64;
export const Y_AXIS_MAX_WIDTH_IN_PX: number = 136;
export const Y_AXIS_TICK_CHARACTER_WIDTH_IN_PX: number = 6.2;
export const Y_AXIS_TICK_PADDING_IN_PX: number = 12;

export interface YAxisWidthInput {
  data: Array<SeriesPoint> | undefined;
  formatter?: ((value: number) => string) | undefined;
  min?: YAxisMaxMin | undefined;
  max?: YAxisMaxMin | undefined;
}

// The round values above a figure an axis may step to: 85.7 -> 90, 100.
function roundValuesAbove(value: number): Array<number> {
  const magnitude: number = Math.abs(value);

  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return [];
  }

  const power: number = Math.pow(10, Math.floor(Math.log10(magnitude)));
  const sign: number = value < 0 ? -1 : 1;

  return [sign * Math.ceil(magnitude / power) * power, sign * power * 10];
}

/*
 * The marks a tick's text carries that take no room: the left-to-right and
 * right-to-left marks Intl sets around a figure in Arabic and Persian
 * ("23.5‎%‎"), the joiners Persian writes inside a word ("میلی‌ثانیه"), and
 * every other format character (Unicode's Cf).
 */
const INVISIBLE_MARKS: RegExp = /\p{Cf}/gu;

/*
 * How many characters a tick's text takes: a letter, a digit or a sign
 * each, and nothing for a mark that is never drawn - an Arabic or Persian
 * tick is not wider than it reads (#8349).
 */
export function getTickTextLength(text: string): number {
  return Array.from(text.replace(INVISIBLE_MARKS, "")).length;
}

/*
 * The ticks an axis over `highest` may draw: recharts steps a rounded top
 * in four or five, so a duration axis up to 1.5 s also draws 500 ms and
 * 750 ms - in Persian a longer tick than "۱٫۵۰ ثانیه" at its top.
 */
function stepsUpTo(top: number): Array<number> {
  if (!Number.isFinite(top) || top === 0) {
    return [];
  }

  return [
    top / 5,
    top / 4,
    (top * 2) / 5,
    top / 2,
    (top * 3) / 5,
    (top * 3) / 4,
    (top * 4) / 5,
  ];
}

export interface YAxisWidthForValuesInput {
  // Every value the axis is drawn over, a stacked bar's total among them.
  values: Array<number>;
  formatter?: ((value: number) => string) | undefined;
  // The width the axis keeps when its ticks are short: 64 px, as before.
  minWidthInPx?: number | undefined;
  // The tick's font size, when it is not the 10 px the shared charts draw.
  tickFontSizeInPx?: number | undefined;
}

/*
 * The value axis' width for a chart drawn straight with recharts (a trace
 * chart, the logs and traces histogram), measured as the shared charts
 * measure theirs: as wide as the widest tick the values can draw, in the
 * reader's language - "۴۲ میلی‌ثانیه" is wider than "42 ms" - never
 * narrower than the chart's own width, and capped.
 */
export function getYAxisWidthForValuesInPx(
  input: YAxisWidthForValuesInput,
): number {
  const minimum: number = input.minWidthInPx ?? Y_AXIS_WIDTH_IN_PX;
  let lowest: number = Number.POSITIVE_INFINITY;
  let highest: number = Number.NEGATIVE_INFINITY;

  for (const value of input.values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      lowest = Math.min(lowest, value);
      highest = Math.max(highest, value);
    }
  }

  if (!Number.isFinite(lowest) || !Number.isFinite(highest)) {
    return minimum;
  }

  const roundedTops: Array<number> = roundValuesAbove(highest);
  const candidates: Array<number> = [
    lowest,
    highest,
    ...roundValuesAbove(lowest),
    ...roundedTops,
    ...stepsUpTo(highest),
    ...stepsUpTo(roundedTops[0] ?? highest),
  ];

  const format: (value: number) => string =
    input.formatter ||
    ((value: number): string => {
      return String(value);
    });

  const labels: Array<string> = [];

  for (const candidate of candidates) {
    let text: string = "";

    try {
      text = format(candidate);
    } catch {
      text = String(candidate);
    }

    labels.push(text || "");
  }

  return getYAxisWidthForLabelsInPx({
    labels: labels,
    minWidthInPx: minimum,
    tickFontSizeInPx: input.tickFontSizeInPx,
  });
}

/*
 * The value axis' width for ticks already written: as wide as the widest,
 * never narrower than the chart's own width, and capped. A chart that steps
 * an axis itself (ValueAxisTicks, issue #10079) knows exactly what each of
 * its ticks reads, "17.205 GB" where the measure above guessed "17.2 GB".
 */
export function getYAxisWidthForLabelsInPx(input: {
  labels: ReadonlyArray<string>;
  minWidthInPx?: number | undefined;
  tickFontSizeInPx?: number | undefined;
}): number {
  const minimum: number = input.minWidthInPx ?? Y_AXIS_WIDTH_IN_PX;
  let longest: number = 0;

  for (const label of input.labels) {
    longest = Math.max(longest, getTickTextLength(label || ""));
  }

  if (longest === 0) {
    return minimum;
  }

  const characterWidth: number =
    (Y_AXIS_TICK_CHARACTER_WIDTH_IN_PX * (input.tickFontSizeInPx ?? 10)) / 10;
  const needed: number = Math.ceil(
    longest * characterWidth + Y_AXIS_TICK_PADDING_IN_PX,
  );

  return Math.min(
    Math.max(Y_AXIS_MAX_WIDTH_IN_PX, minimum),
    Math.max(minimum, needed),
  );
}

/*
 * Every value a chart drawn from rows draws over: each series' value, and
 * for bars stacked one on another each row's total, which the stack reaches.
 */
export function getChartRowValues<Row>(
  rows: ReadonlyArray<Row>,
  keys: ReadonlyArray<string>,
  options?: { isStacked?: boolean | undefined },
): Array<number> {
  const values: Array<number> = [];

  for (const row of rows) {
    let total: number = 0;

    for (const key of keys) {
      const value: unknown = (row as unknown as Record<string, unknown>)[key];

      if (typeof value === "number" && Number.isFinite(value)) {
        values.push(value);
        total += value;
      }
    }

    if (options?.isStacked) {
      values.push(total);
    }
  }

  return values;
}

export function getYAxisWidthInPx(input: YAxisWidthInput): number {
  const values: Array<number> = [];

  for (const series of input.data || []) {
    for (const point of series.data || ([] as Array<DataPoint>)) {
      if (typeof point.y === "number" && Number.isFinite(point.y)) {
        values.push(point.y);
      }
    }
  }

  for (const bound of [input.min, input.max]) {
    if (typeof bound === "number" && Number.isFinite(bound)) {
      values.push(bound);
    }
  }

  return getYAxisWidthForValuesInPx({
    values: values,
    formatter: input.formatter,
  });
}
