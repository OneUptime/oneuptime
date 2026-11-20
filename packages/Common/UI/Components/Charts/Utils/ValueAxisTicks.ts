import { getNiceTickValues } from "recharts";
import { ValueAxisFormatter, ValueAxisPrecision } from "../Types/YAxis/YAxis";

/*
 * A VALUE AXIS'S TICKS, AND THE FIGURES THEY ARE WRITTEN WITH (issues
 * #10079, #10117, #10118).
 *
 * Recharts steps a value axis in five ticks over the values drawn against
 * it, and the chart wrote each tick with its host's formatter, which keeps
 * about three figures. Two things read wrong:
 *
 *   - Over a range small beside its values, every tick read the same: a
 *     filesystem holding 17.2 GB, give or take a few megabytes, read "17.2
 *     GB" five times (#10079).
 *   - Recharts' steps are any multiple of 0.05 times a power of ten (85 MB),
 *     so written with three figures they read unevenly: a node's memory read
 *     "7.57 GB", "7.65 GB", "7.74 GB", "7.82 GB" (#10117).
 *
 * So the chart steps every value axis itself, in round steps of the unit it
 * is written in: 1, 2, 2.5 or 5 times a power of ten, which bytes, counts
 * and percents scale by, or, on an axis of spans of time, natural steps of
 * time (15 sec, 5 min, 30 min, 6 h, 2 d: DURATION_STEPS_IN_SECONDS, #10118).
 * It hands its formatter the step, so a formatter that can write more
 * figures writes as many as that step needs and no more ("17.205 GB" beside
 * "17.200 GB", "25%" on an axis stepping a quarter: ValueFormatter's step
 * option), in the reader's language and in the unit scaling it always used.
 *
 * WHICH ROUND STEP. Of the round steps, the axis takes the one that best
 * balances three things, as Talbot, Lin and Hanrahan's extension of
 * Wilkinson's tick labelling scores them (the scoring ggplot2 uses):
 *
 *   - about five ticks (recharts' own count), never fewer than three or
 *     more than six while a round step gives that many (density);
 *   - little blank space past the values, so the line fills the plot
 *     (coverage): an axis over 0 to 55 reads 0, 20, 40, 60, as recharts'
 *     own ended at 60, not 0 to 80 as recharts' round steps pad it;
 *   - the simplest step: 1, then 5, then 2, then 2.5 (simplicity).
 *
 * An axis whose ticks recharts already stepped roundly keeps them: 0% to
 * 100% in quarters, a state chart's 0, 2, 4, 6, 8. An "auto" end steps out
 * to the round tick past the values, as recharts' does; a fixed end stays
 * where its host put it, with the round ticks between.
 *
 * An axis never resolves finer than five figures of its largest value: a
 * series that only moves by a byte's rounding on 17.2 GB is drawn flat
 * across ticks a megabyte apart, not stretched over ticks a byte apart
 * written to ten decimals.
 *
 * A formatter that writes too few figures for the best round step (a
 * page's own rounding) takes the next round step it writes apart; one that
 * writes alike whatever it is handed ("Up" and "Down") keeps recharts' own
 * ticks, as before.
 */

export type ValueAxisDomainEnd = number | "auto";

// The ticks recharts steps a value axis in: its YAxis's default tickCount.
export const VALUE_AXIS_TICK_COUNT: number = 5;

// The fewest and the most ticks an axis is stepped in, while a round step gives that many.
export const FEWEST_VALUE_AXIS_TICKS: number = 3;
export const MOST_VALUE_AXIS_TICKS: number = 6;

// The most figures of its largest value an axis's step resolves.
export const FINEST_TICK_FIGURES: number = 5;

/*
 * The round steps, by their first figures, simplest first: 1, 5, 2 and 2.5
 * times a power of ten (Talbot's Q, less its 3 and 4).
 */
export const ROUND_STEP_MANTISSAS: ReadonlyArray<number> = [1, 5, 2, 2.5];

/*
 * A span of time's natural steps, in seconds (issue #10118): below a
 * second the round decimal steps (250 ms, 0.5 sec), then 1, 2, 5, 10, 15
 * and 30 seconds, the same in minutes, 1, 2, 3, 6 and 12 hours, 1, 2, 5 and
 * 7 days, then 10 and 14 days and round numbers of days. None is a fraction
 * of the unit above it a decimal writes badly: an axis over an hour and a
 * half steps a quarter of an hour, not 0.25 hours or 1/3600 of one.
 */
const SECONDS_IN_A_DAY: number = 86400;

export const DURATION_STEPS_IN_SECONDS: ReadonlyArray<number> = [
  1,
  2,
  5,
  10,
  15,
  30,
  60,
  120,
  300,
  600,
  900,
  1800,
  3600,
  7200,
  10800,
  21600,
  43200,
  SECONDS_IN_A_DAY,
  2 * SECONDS_IN_A_DAY,
  5 * SECONDS_IN_A_DAY,
  7 * SECONDS_IN_A_DAY,
  10 * SECONDS_IN_A_DAY,
  14 * SECONDS_IN_A_DAY,
];

// The weights Talbot, Lin and Hanrahan give simplicity, coverage and density.
const SIMPLICITY_WEIGHT: number = 0.25;
const COVERAGE_WEIGHT: number = 0.2;
const DENSITY_WEIGHT: number = 0.5;

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
  /*
   * For an axis of spans of time, the seconds one value stands for: it then
   * steps in natural units of time (DURATION_STEPS_IN_SECONDS, #10118).
   */
  durationUnitInSeconds?: number | undefined;
}

export interface ValueAxisTicks {
  /*
   * The ticks and the domain to hand recharts, for an axis the chart steps
   * itself; both undefined for one recharts steps as it always has.
   */
  ticks: Array<number> | undefined;
  domain: [number, number] | undefined;
  // What the axis's formatter is handed for its ticks; undefined for nothing.
  precision: ValueAxisPrecision | undefined;
  /*
   * What the tooltip, and a clicked moment's values, write the axis's
   * series with: the ticks' precision where the formatter's own figures
   * cannot tell two of its ticks apart ("17.2 GB" five times), so a value
   * reads to the axis's resolution; undefined otherwise, and a value reads
   * as it always has ("73.40%" on an axis stepping a quarter).
   */
  tooltipPrecision: ValueAxisPrecision | undefined;
  // What each tick reads, bottom to top.
  labels: Array<string>;
}

const AS_RECHARTS_STEPS_IT: ValueAxisTicks = {
  ticks: undefined,
  domain: undefined,
  precision: undefined,
  tooltipPrecision: undefined,
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
function getFixedDomainStep(span: number, allowDecimals: boolean): number {
  const ticks: Array<number> = getNiceTickValues(
    [0, span],
    VALUE_AXIS_TICK_COUNT,
    allowDecimals,
    "adaptive",
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

  const step: number = getFixedDomainStep(upper - lower, allowDecimals);

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

// A round step the axis may take, and how simple it reads (1 the simplest).
interface RoundStep {
  step: number;
  simplicity: number;
}

/*
 * The round decimal steps from a hundredth of `span` to ten times it: 1, 2,
 * 2.5 and 5 times each power of ten, each as simple as its first figures.
 */
function getDecimalRoundSteps(span: number): Array<RoundStep> {
  const steps: Array<RoundStep> = [];
  const topPower: number = Math.floor(Math.log10(span));

  for (let power: number = topPower - 2; power <= topPower + 1; power++) {
    ROUND_STEP_MANTISSAS.forEach((mantissa: number, rank: number): void => {
      steps.push({
        step: toTwelveFigures(mantissa * Math.pow(10, power)),
        simplicity: 1 - rank / (ROUND_STEP_MANTISSAS.length - 1),
      });
    });
  }

  return steps;
}

/*
 * A span of time's natural steps around `span`, in the axis's own unit
 * (`unitInSeconds` seconds a value): the round decimal steps below a
 * second, DURATION_STEPS_IN_SECONDS, and round numbers of days past them.
 * Each is as simple as any other: all are steps a clock or a calendar
 * reads in.
 */
function getDurationRoundSteps(
  span: number,
  unitInSeconds: number,
): Array<RoundStep> {
  const spanInSeconds: number = span * unitInSeconds;
  const stepsInSeconds: Array<number> = [];
  const topPower: number = Math.floor(Math.log10(spanInSeconds));

  // Below a second: 1, 2, 2.5 and 5 times a power of ten, as ms and µs step.
  for (let power: number = Math.min(-1, topPower - 2); power <= -1; power++) {
    for (const mantissa of ROUND_STEP_MANTISSAS) {
      stepsInSeconds.push(toTwelveFigures(mantissa * Math.pow(10, power)));
    }
  }

  stepsInSeconds.push(...DURATION_STEPS_IN_SECONDS);

  // Past two weeks: round numbers of days, 20, 50, 100, 200, 500 and on.
  for (
    let power: number = 1;
    Math.pow(10, power) * SECONDS_IN_A_DAY <= spanInSeconds * 10;
    power++
  ) {
    for (const mantissa of [1, 2, 5]) {
      const days: number = mantissa * Math.pow(10, power);

      if (days > 14) {
        stepsInSeconds.push(days * SECONDS_IN_A_DAY);
      }
    }
  }

  return stepsInSeconds
    .filter((stepInSeconds: number): boolean => {
      return (
        stepInSeconds >= spanInSeconds / 100 &&
        stepInSeconds <= spanInSeconds * 10
      );
    })
    .map((stepInSeconds: number): RoundStep => {
      return {
        step: toTwelveFigures(stepInSeconds / unitInSeconds),
        simplicity: 1,
      };
    });
}

// A round step's ticks over the axis, and how well they label it.
interface RoundTicks {
  ticks: Array<number>;
  step: number;
  score: number;
}

/*
 * How well ticks from `labelLow` to `labelHigh`, `tickCount` of them, label
 * an axis over `low` to `high` (Talbot, Lin and Hanrahan): close to five
 * ticks, little blank space past the values, and a simple step.
 */
function scoreLabelling(input: {
  low: number;
  high: number;
  labelLow: number;
  labelHigh: number;
  tickCount: number;
  simplicity: number;
}): number {
  const span: number = input.high - input.low;
  const coverage: number =
    1 -
    (0.5 *
      (Math.pow(input.high - input.labelHigh, 2) +
        Math.pow(input.low - input.labelLow, 2))) /
      Math.pow(0.1 * span, 2);
  const density: number =
    (input.tickCount - 1) / (input.labelHigh - input.labelLow);
  const targetDensity: number =
    (VALUE_AXIS_TICK_COUNT - 1) /
    (Math.max(input.labelHigh, input.high) -
      Math.min(input.labelLow, input.low));
  const densityScore: number =
    2 - Math.max(density / targetDensity, targetDensity / density);

  return (
    SIMPLICITY_WEIGHT * input.simplicity +
    COVERAGE_WEIGHT * coverage +
    DENSITY_WEIGHT * densityScore
  );
}

/*
 * Every round step's ticks over the axis, best first: from an "auto" end
 * out to the round tick past it, and between fixed ends, never finer than
 * FINEST_TICK_FIGURES of the largest value. An "auto" axis too narrow to
 * step at the finest is widened to that, around its values.
 */
function getRoundTicksBestFirst(input: {
  axisDomain: [number, number];
  hasAutoEnd: boolean;
  allowDecimals: boolean;
  durationUnitInSeconds?: number | undefined;
}): Array<RoundTicks> {
  let [low, high] = input.axisDomain;
  const largest: number = Math.max(Math.abs(low), Math.abs(high));
  const finest: number =
    largest > 0
      ? Math.pow(10, Math.floor(Math.log10(largest)) - FINEST_TICK_FIGURES + 1)
      : 0;

  if (input.hasAutoEnd) {
    const narrowest: number = finest * (VALUE_AXIS_TICK_COUNT - 1);

    if (largest === 0) {
      // Nothing but zero: as recharts steps it, 0 to 4.
      high = VALUE_AXIS_TICK_COUNT - 1;
    } else if (high - low < narrowest) {
      const middle: number = (low + high) / 2;

      low = Math.min(low, middle - narrowest / 2);
      high = Math.max(high, middle + narrowest / 2);
    }
  }

  const span: number = high - low;

  if (!(span > 0) || !Number.isFinite(span)) {
    return [];
  }

  const isDuration: boolean =
    isFiniteNumber(input.durationUnitInSeconds) &&
    input.durationUnitInSeconds > 0;
  const candidates: Array<RoundStep> = isDuration
    ? getDurationRoundSteps(span, input.durationUnitInSeconds as number)
    : getDecimalRoundSteps(span);
  const labellings: Array<RoundTicks> = [];

  for (const candidate of candidates) {
    const step: number = candidate.step;

    if (
      !(step > 0) ||
      step < finest * (1 - 1e-9) ||
      (!input.allowDecimals && !Number.isInteger(step))
    ) {
      continue;
    }

    const first: number = input.hasAutoEnd
      ? Math.floor(low / step + 1e-9)
      : Math.ceil(low / step - 1e-9);
    const last: number = input.hasAutoEnd
      ? Math.ceil(high / step - 1e-9)
      : Math.floor(high / step + 1e-9);
    const tickCount: number = last - first + 1;

    if (tickCount < 2 || tickCount > 1000) {
      continue;
    }

    const ticks: Array<number> = [];

    for (let multiple: number = first; multiple <= last; multiple++) {
      ticks.push(toTwelveFigures(multiple * step));
    }

    labellings.push({
      ticks: ticks,
      step: step,
      score: scoreLabelling({
        low: low,
        high: high,
        labelLow: ticks[0] as number,
        labelHigh: ticks[ticks.length - 1] as number,
        tickCount: tickCount,
        simplicity: candidate.simplicity,
      }),
    });
  }

  const bestFirst: Array<RoundTicks> = labellings.sort(
    (a: RoundTicks, b: RoundTicks): number => {
      return b.score - a.score || a.step - b.step;
    },
  );
  const aboutFive: Array<RoundTicks> = bestFirst.filter(
    (labelling: RoundTicks): boolean => {
      return (
        labelling.ticks.length >= FEWEST_VALUE_AXIS_TICKS &&
        labelling.ticks.length <= MOST_VALUE_AXIS_TICKS
      );
    },
  );

  return aboutFive.length > 0 ? aboutFive : bestFirst;
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

  for (const round of getRoundTicksBestFirst({
    axisDomain: axisDomain,
    hasAutoEnd: hasAutoEnd,
    allowDecimals: input.allowDecimals,
    durationUnitInSeconds: input.durationUnitInSeconds,
  })) {
    const firstTick: number = round.ticks[0] as number;
    const lastTick: number = round.ticks[round.ticks.length - 1] as number;
    const precision: ValueAxisPrecision = {
      step: round.step,
      largestTick: Math.max(Math.abs(firstTick), Math.abs(lastTick)),
    };
    const labels: Array<string> = writeTicks(
      round.ticks,
      input.formatter,
      precision,
    );

    // A formatter that writes too few figures for this step: the next.
    if (!areNeighboursApart(labels)) {
      continue;
    }

    return {
      ticks: round.ticks,
      domain: hasAutoEnd
        ? [
            Math.min(axisDomain[0], firstTick),
            Math.max(axisDomain[1], lastTick),
          ]
        : axisDomain,
      precision: precision,
      tooltipPrecision: areNeighboursApart(
        writeTicks(round.ticks, input.formatter),
      )
        ? undefined
        : precision,
      labels: labels,
    };
  }

  // A formatter that writes alike whatever it is handed: as recharts steps it.
  return {
    ...AS_RECHARTS_STEPS_IT,
    labels: writeTicks(
      getRechartsTicks(axisDomain, hasAutoEnd, input.allowDecimals),
      input.formatter,
    ),
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
