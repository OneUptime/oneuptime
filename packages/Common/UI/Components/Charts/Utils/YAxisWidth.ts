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

// How many characters a tick's text takes: a letter, a digit or a sign each.
export function getTickTextLength(text: string): number {
  return Array.from(text).length;
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

  if (values.length === 0) {
    return Y_AXIS_WIDTH_IN_PX;
  }

  const lowest: number = Math.min(...values);
  const highest: number = Math.max(...values);
  const candidates: Array<number> = [
    lowest,
    highest,
    ...roundValuesAbove(lowest),
    ...roundValuesAbove(highest),
  ];

  const format: (value: number) => string =
    input.formatter ||
    ((value: number): string => {
      return String(value);
    });

  let longest: number = 0;

  for (const candidate of candidates) {
    let text: string = "";

    try {
      text = format(candidate);
    } catch {
      text = String(candidate);
    }

    longest = Math.max(longest, getTickTextLength(text || ""));
  }

  const needed: number = Math.ceil(
    longest * Y_AXIS_TICK_CHARACTER_WIDTH_IN_PX + Y_AXIS_TICK_PADDING_IN_PX,
  );

  return Math.min(Y_AXIS_MAX_WIDTH_IN_PX, Math.max(Y_AXIS_WIDTH_IN_PX, needed));
}
