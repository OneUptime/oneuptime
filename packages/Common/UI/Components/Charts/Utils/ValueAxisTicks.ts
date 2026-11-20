import { getNiceTickValues } from "recharts";
import { ValueAxisFormatter, ValueAxisPrecision } from "../Types/YAxis/YAxis";

/*
 * A VALUE AXIS'S TICKS, AND THE FIGURES THEY ARE WRITTEN WITH (issue #10079).
 *
 * Recharts steps a value axis in five ticks over the values drawn against
 * it, and the chart writes each tick with its host's formatter, which keeps
 * about three figures. Over a range small beside its values that wrote the
 * same label on every tick: a filesystem holding 17.2 GB, give or take a few
 * megabytes, read "17.2 GB" five times, and its line, drawn between ticks
 * that all said the same, looked like a big swing.
 *
 * So the chart works out the ticks recharts draws, as recharts does (its own
 * getNiceTickValues, over the same domain), and writes them. When every two
 * neighbouring ticks already read apart, nothing changes: the axis steps and
 * reads exactly as before. Only when two would read alike does the chart
 * step the axis itself, in round steps (1, 2, 2.5 or 5 times a power of ten,
 * recharts' snap125), and hand its formatter the step, so a formatter that
 * can write more figures writes as many as that step needs and no more
 * ("17.200 GB", "17.205 GB": ValueFormatter's step option). A formatter that
 * writes the same either way (a host's own rounding, "Up" and "Down") is
 * left as it was.
 *
 * An axis never resolves finer than five figures of its largest value: a
 * series that only moves by a byte's rounding on 17.2 GB is drawn flat
 * across ticks a megabyte apart, not stretched over ticks a byte apart
 * written to ten decimals.
 */

export type ValueAxisDomainEnd = number | "auto";

// The ticks recharts steps a value axis in: its YAxis's default tickCount.
export const VALUE_AXIS_TICK_COUNT: number = 5;

// The most figures of its largest value an axis's step resolves.
export const FINEST_TICK_FIGURES: number = 5;

export interface ValueAxisTicksInput {
  // Every value drawn against the axis: its series', a stack's sums, its lines'.
  values: ReadonlyArray<number>;
  /*
   * The axis's two ends as recharts is handed them: "auto" to fit the
   * values, or a number, which the values may still push out.
   */
  domain: ReadonlyArray<ValueAxisDomainEnd>;
  allowDecimals: boolean;
  formatter: ValueAxisFormatter;
}

export interface ValueAxisTicks {
  /*
   * The ticks and the domain to hand recharts, for an axis the chart steps
   * itself; both undefined for one recharts steps as it always has.
   */
  ticks: Array<number> | undefined;
  domain: [number, number] | undefined;
  // What the axis's formatter is handed for its ticks and its tooltip; undefined for nothing.
  precision: ValueAxisPrecision | undefined;
  // What each tick reads, bottom to top.
  labels: Array<string>;
}

const AS_RECHARTS_STEPS_IT: ValueAxisTicks = {
  ticks: undefined,
  domain: undefined,
  precision: undefined,
  labels: [],
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// A number to twelve figures: a tick of 0.3, not 0.30000000000000004.
function toTwelveFigures(value: number): number {
  return Number(value.toPrecision(12));
}

/*
 * The step between two ticks, to nine figures: recharts writes its ticks
 * exactly, but two ticks near 70.5 a thousandth apart are a difference of
 * 0.000999999999991 as numbers. A step is a few figures long, and its
 * error is far below the ninth.
 */
function getStepBetween(lower: number, upper: number): number {
  return Number((upper - lower).toPrecision(9));
}

// The lowest and the highest of the values, or undefined for none.
function getDataDomain(
  values: ReadonlyArray<number>,
): [number, number] | undefined {
  let lowest: number = Number.POSITIVE_INFINITY;
  let highest: number = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (isFiniteNumber(value)) {
      lowest = Math.min(lowest, value);
      highest = Math.max(highest, value);
    }
  }

  return Number.isFinite(lowest) && Number.isFinite(highest)
    ? [lowest, highest]
    : undefined;
}

/*
 * The domain recharts steps: a number end as given and an "auto" one at the
 * values, then pushed out to every value, as recharts does when the values
 * may not overflow the axis (parseNumericalUserDomain).
 */
function getAxisDomain(
  domain: ReadonlyArray<ValueAxisDomainEnd>,
  dataDomain: [number, number],
): [number, number] {
  const lower: number = isFiniteNumber(domain[0]) ? domain[0] : dataDomain[0];
  const upper: number = isFiniteNumber(domain[1]) ? domain[1] : dataDomain[1];

  return [Math.min(lower, dataDomain[0]), Math.max(upper, dataDomain[1])];
}

/*
 * The step recharts' ticks over a fixed domain take: its step function over
 * a quarter of the span. Its nice ticks over [0, span] take that same step,
 * as no correction is needed from 0.
 */
function getFixedDomainStep(
  span: number,
  allowDecimals: boolean,
  mode: "adaptive" | "snap125",
): number {
  const ticks: Array<number> = getNiceTickValues(
    [0, span],
    VALUE_AXIS_TICK_COUNT,
    allowDecimals,
    mode,
  );

  return ticks.length > 1
    ? getStepBetween(ticks[0] as number, ticks[1] as number)
    : 0;
}

/*
 * The ticks recharts draws over a fixed domain (getTickValuesFixedDomain):
 * from its lower end a step at a time, and its upper end.
 */
function getFixedDomainTicks(
  domain: [number, number],
  allowDecimals: boolean,
): Array<number> {
  const [lower, upper] = domain;

  if (lower === upper) {
    return [lower];
  }

  const step: number = getFixedDomainStep(
    upper - lower,
    allowDecimals,
    "adaptive",
  );

  if (!(step > 0)) {
    return [lower, upper];
  }

  const ticks: Array<number> = [];

  for (let index: number = 0; index < 1000; index++) {
    const tick: number = toTwelveFigures(lower + index * step);

    if (tick >= upper - step * 1e-9) {
      break;
    }

    ticks.push(allowDecimals ? tick : Math.round(tick));
  }

  ticks.push(allowDecimals ? upper : Math.round(upper));

  return ticks;
}

// The ticks recharts steps an axis in, as its YAxis works them out.
function getRechartsTicks(
  axisDomain: [number, number],
  hasAutoEnd: boolean,
  allowDecimals: boolean,
): Array<number> {
  return hasAutoEnd
    ? getNiceTickValues(
        axisDomain,
        VALUE_AXIS_TICK_COUNT,
        allowDecimals,
        "adaptive",
      )
    : getFixedDomainTicks(axisDomain, allowDecimals);
}

/*
 * Round ticks over the domain, a step of 1, 2, 2.5 or 5 times a power of ten
 * apart, never finer than FINEST_TICK_FIGURES of the largest value: an "auto"
 * domain steps out to its round ends, as recharts' own does, and a fixed one
 * keeps its ends and draws the round ticks between them.
 */
function getRoundTicks(
  axisDomain: [number, number],
  hasAutoEnd: boolean,
  allowDecimals: boolean,
): { ticks: Array<number>; step: number } | undefined {
  const [lower, upper] = axisDomain;

  if (hasAutoEnd) {
    const largest: number = Math.max(Math.abs(lower), Math.abs(upper));
    const finest: number =
      largest > 0
        ? Math.pow(
            10,
            Math.floor(Math.log10(largest)) - FINEST_TICK_FIGURES + 1,
          )
        : 0;
    const narrowest: number = finest * (VALUE_AXIS_TICK_COUNT - 1);
    let domain: [number, number] = [lower, upper];

    // Too narrow to step at the finest: as wide as that, around the values.
    if (upper - lower < narrowest) {
      const middle: number = (lower + upper) / 2;

      domain = [
        Math.min(lower, middle - narrowest / 2),
        Math.max(upper, middle + narrowest / 2),
      ];
    }

    const ticks: Array<number> = getNiceTickValues(
      domain,
      VALUE_AXIS_TICK_COUNT,
      allowDecimals,
      "snap125",
    );

    if (ticks.length < 2) {
      return undefined;
    }

    const step: number = getStepBetween(ticks[0] as number, ticks[1] as number);

    return step > 0 ? { ticks: ticks, step: step } : undefined;
  }

  const step: number = getFixedDomainStep(
    upper - lower,
    allowDecimals,
    "snap125",
  );

  if (!(step > 0)) {
    return undefined;
  }

  const ticks: Array<number> = [];
  const first: number = Math.ceil(lower / step - 1e-9);
  const last: number = Math.floor(upper / step + 1e-9);

  for (
    let multiple: number = first;
    multiple <= last && ticks.length < 1000;
    multiple++
  ) {
    ticks.push(toTwelveFigures(multiple * step));
  }

  return ticks.length >= 2 ? { ticks: ticks, step: step } : undefined;
}

// What each tick reads, as the axis's formatter writes it.
function writeTicks(
  ticks: ReadonlyArray<number>,
  formatter: ValueAxisFormatter,
  precision?: ValueAxisPrecision,
): Array<string> {
  return ticks.map((tick: number): string => {
    try {
      return precision ? formatter(tick, precision) : formatter(tick);
    } catch {
      return String(tick);
    }
  });
}

// Whether every two neighbouring ticks read apart.
export function areNeighboursApart(labels: ReadonlyArray<string>): boolean {
  for (let index: number = 1; index < labels.length; index++) {
    if (labels[index] === labels[index - 1]) {
      return false;
    }
  }

  return true;
}

export function getValueAxisTicks(input: ValueAxisTicksInput): ValueAxisTicks {
  const dataDomain: [number, number] | undefined = getDataDomain(input.values);

  if (!dataDomain) {
    return AS_RECHARTS_STEPS_IT;
  }

  const hasAutoEnd: boolean =
    !isFiniteNumber(input.domain[0]) || !isFiniteNumber(input.domain[1]);
  const axisDomain: [number, number] = getAxisDomain(input.domain, dataDomain);
  const labels: Array<string> = writeTicks(
    getRechartsTicks(axisDomain, hasAutoEnd, input.allowDecimals),
    input.formatter,
  );

  if (areNeighboursApart(labels)) {
    return { ...AS_RECHARTS_STEPS_IT, labels: labels };
  }

  const round: { ticks: Array<number>; step: number } | undefined =
    getRoundTicks(axisDomain, hasAutoEnd, input.allowDecimals);

  if (!round) {
    return { ...AS_RECHARTS_STEPS_IT, labels: labels };
  }

  const precision: ValueAxisPrecision = { step: round.step };
  const roundLabels: Array<string> = writeTicks(
    round.ticks,
    input.formatter,
    precision,
  );

  // A formatter that cannot write more figures: the axis stays as it was.
  if (!areNeighboursApart(roundLabels)) {
    return { ...AS_RECHARTS_STEPS_IT, labels: labels };
  }

  const firstTick: number = round.ticks[0] as number;
  const lastTick: number = round.ticks[round.ticks.length - 1] as number;

  return {
    ticks: round.ticks,
    domain: hasAutoEnd
      ? [Math.min(axisDomain[0], firstTick), Math.max(axisDomain[1], lastTick)]
      : axisDomain,
    precision: precision,
    labels: roundLabels,
  };
}

export interface ChartAxisValuesInput {
  // The chart's rows, a series' value under its category in each.
  rows: ReadonlyArray<Record<string, unknown>>;
  // The categories drawn against the axis.
  categories: ReadonlyArray<string>;
  /*
   * Whether the categories' bars are stacked one on another: the axis then
   * reaches each running sum, from 0, as recharts stacks them.
   */
  isStacked?: boolean | undefined;
  // A band's lower and upper keys, for a band drawn against the axis.
  bandKeys?: [string, string] | undefined;
  // The values of the lines that stretch the axis to take them in.
  lineValues?: ReadonlyArray<number | undefined> | undefined;
}

// Every value drawn against an axis of a chart drawn from rows.
export function getChartAxisValues(input: ChartAxisValuesInput): Array<number> {
  const values: Array<number> = [];

  for (const row of input.rows) {
    let runningSum: number = 0;

    if (input.isStacked) {
      values.push(0);
    }

    for (const category of input.categories) {
      const value: unknown = row[category];

      if (input.isStacked) {
        runningSum += isFiniteNumber(value) ? value : 0;
        values.push(runningSum);
      } else if (isFiniteNumber(value)) {
        values.push(value);
      }
    }

    if (input.bandKeys) {
      const low: number = Number(row[input.bandKeys[0]]);
      const high: number = Number(row[input.bandKeys[1]]);

      if (Number.isFinite(low) && Number.isFinite(high)) {
        values.push(low, high);
      }
    }
  }

  for (const value of input.lineValues || []) {
    if (isFiniteNumber(value)) {
      values.push(value);
    }
  }

  return values;
}

/*
 * The tick formatter recharts is handed: the axis's formatter, with its
 * precision (a ValueAxisTicks' own) when the chart steps the axis itself.
 * Always a function of the value alone: recharts hands a tick formatter the
 * tick's index too.
 */
export function getTickFormatter(
  formatter: ValueAxisFormatter,
  precision: ValueAxisPrecision | undefined,
): (value: number) => string {
  return (value: number): string => {
    return precision ? formatter(value, precision) : formatter(value);
  };
}
