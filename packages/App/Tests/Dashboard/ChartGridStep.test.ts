import { describe, expect, test } from "@jest/globals";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisUtil from "Common/UI/Components/Charts/Utils/XAxis";
import {
  ChartGridStep,
  FIXED_WIDTH_CHART_GRID_STEPS,
  getChartGridStepSeconds,
  getCoarsestChartGridStepWithin,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/ChartGridStep";

/*
 * The chart library's fixed-width time-axis steps, which the network Traffic
 * chart (issue #4105 review, sdn-1) fits to its server-side buckets and the
 * Topology service-call drawer (sdn-3) asks its server-side buckets to match.
 * The widths are measured on the library's own walker, so a change on either
 * side fails here rather than as averaged or dropped points on a chart.
 */

const MINUTE_MS: number = 60 * 1000;
const DAY_SECONDS: number = 24 * 60 * 60;
const DAY_MS: number = DAY_SECONDS * 1000;

/*
 * Mid-July: weeks from a daylight-saving change in every zone that has one,
 * so the first steps of every walk are their plain width.
 */
const WALK_FROM: Date = new Date("2026-07-15T00:00:00.000Z");

/*
 * How far apart XAxisUtil puts the first two slots of a precision. Walked no
 * further than it takes to reach a second slot: a day of one-second steps is
 * 86,400 slots.
 */
function walkedStepSeconds(precision: XAxisPrecision): number {
  for (const spanMs of [MINUTE_MS, DAY_MS, 800 * DAY_MS]) {
    const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals({
      xAxisMin: WALK_FROM,
      xAxisMax: new Date(WALK_FROM.getTime() + spanMs),
      precision: precision,
    });
    if (intervals.length >= 2) {
      return (intervals[1]!.getTime() - intervals[0]!.getTime()) / 1000;
    }
  }
  throw new Error(`The walker never took a second ${precision} step`);
}

const ALL_PRECISIONS: Array<XAxisPrecision> = Object.values(XAxisPrecision);

describe("FIXED_WIDTH_CHART_GRID_STEPS", () => {
  test("each step is exactly as wide as the chart walks it", () => {
    for (const step of FIXED_WIDTH_CHART_GRID_STEPS) {
      expect([step.precision, walkedStepSeconds(step.precision)]).toEqual([
        step.precision,
        step.seconds,
      ]);
    }
  });

  test("finest first, each step wider than the one before", () => {
    const widths: Array<number> = FIXED_WIDTH_CHART_GRID_STEPS.map(
      (step: ChartGridStep): number => {
        return step.seconds;
      },
    );
    for (let index: number = 1; index < widths.length; index++) {
      expect(widths[index]!).toBeGreaterThan(widths[index - 1]!);
    }
  });

  test("every step the chart walks in less than a day is listed, and no step of a day or more", () => {
    const listed: Set<XAxisPrecision> = new Set<XAxisPrecision>(
      FIXED_WIDTH_CHART_GRID_STEPS.map(
        (step: ChartGridStep): XAxisPrecision => {
          return step.precision;
        },
      ),
    );
    expect(listed.size).toBe(FIXED_WIDTH_CHART_GRID_STEPS.length);
    for (const precision of ALL_PRECISIONS) {
      expect([precision, walkedStepSeconds(precision) < DAY_SECONDS]).toEqual([
        precision,
        listed.has(precision),
      ]);
    }
  });
});

describe("getChartGridStepSeconds", () => {
  test.each([
    [XAxisPrecision.EVERY_SECOND, 1],
    [XAxisPrecision.EVERY_FIVE_SECONDS, 5],
    [XAxisPrecision.EVERY_TEN_SECONDS, 10],
    [XAxisPrecision.EVERY_THIRTY_SECONDS, 30],
    [XAxisPrecision.EVERY_MINUTE, 60],
    [XAxisPrecision.EVERY_FIVE_MINUTES, 300],
    [XAxisPrecision.EVERY_TEN_MINUTES, 600],
    [XAxisPrecision.EVERY_FIFTEEN_MINUTES, 900],
    [XAxisPrecision.EVERY_THIRTY_MINUTES, 1800],
    [XAxisPrecision.EVERY_HOUR, 3600],
    [XAxisPrecision.EVERY_TWO_HOURS, 7200],
    [XAxisPrecision.EVERY_THREE_HOURS, 10800],
    [XAxisPrecision.EVERY_SIX_HOURS, 21600],
    [XAxisPrecision.EVERY_TWELVE_HOURS, 43200],
  ])("%s is %i seconds wide", (precision: XAxisPrecision, seconds: number) => {
    expect(getChartGridStepSeconds(precision)).toBe(seconds);
  });

  test.each([
    XAxisPrecision.EVERY_DAY,
    XAxisPrecision.EVERY_TWO_DAYS,
    XAxisPrecision.EVERY_WEEK,
    XAxisPrecision.EVERY_TWO_WEEKS,
    XAxisPrecision.EVERY_MONTH,
    XAxisPrecision.EVERY_TWO_MONTHS,
    XAxisPrecision.EVERY_THREE_MONTHS,
    XAxisPrecision.EVERY_SIX_MONTHS,
    XAxisPrecision.EVERY_YEAR,
  ])("%s follows the calendar: no fixed width", (precision: XAxisPrecision) => {
    expect(getChartGridStepSeconds(precision)).toBeUndefined();
  });

  test("agrees with the walker on every precision it gives a width for", () => {
    for (const precision of ALL_PRECISIONS) {
      const seconds: number | undefined = getChartGridStepSeconds(precision);
      if (seconds !== undefined) {
        expect([precision, seconds]).toEqual([
          precision,
          walkedStepSeconds(precision),
        ]);
      }
    }
  });
});

describe("getCoarsestChartGridStepWithin", () => {
  test.each([
    [1, XAxisPrecision.EVERY_SECOND],
    [4, XAxisPrecision.EVERY_SECOND],
    [5, XAxisPrecision.EVERY_FIVE_SECONDS],
    [29, XAxisPrecision.EVERY_TEN_SECONDS],
    [59, XAxisPrecision.EVERY_THIRTY_SECONDS],
    [60, XAxisPrecision.EVERY_MINUTE],
    [299, XAxisPrecision.EVERY_MINUTE],
    [300, XAxisPrecision.EVERY_FIVE_MINUTES],
    [599, XAxisPrecision.EVERY_FIVE_MINUTES],
    [600, XAxisPrecision.EVERY_TEN_MINUTES],
    [899, XAxisPrecision.EVERY_TEN_MINUTES],
    [900, XAxisPrecision.EVERY_FIFTEEN_MINUTES],
    [1799, XAxisPrecision.EVERY_FIFTEEN_MINUTES],
    [1800, XAxisPrecision.EVERY_THIRTY_MINUTES],
    [3599, XAxisPrecision.EVERY_THIRTY_MINUTES],
    [3600, XAxisPrecision.EVERY_HOUR],
    [7199, XAxisPrecision.EVERY_HOUR],
    [7200, XAxisPrecision.EVERY_TWO_HOURS],
    [10799, XAxisPrecision.EVERY_TWO_HOURS],
    [10800, XAxisPrecision.EVERY_THREE_HOURS],
    [21599, XAxisPrecision.EVERY_THREE_HOURS],
    [21600, XAxisPrecision.EVERY_SIX_HOURS],
    [43199, XAxisPrecision.EVERY_SIX_HOURS],
    [43200, XAxisPrecision.EVERY_TWELVE_HOURS],
    // Wider than every fixed step: the widest of them.
    [DAY_SECONDS, XAxisPrecision.EVERY_TWELVE_HOURS],
    [31 * DAY_SECONDS, XAxisPrecision.EVERY_TWELVE_HOURS],
  ])("%i seconds: %s", (seconds: number, precision: XAxisPrecision) => {
    expect(getCoarsestChartGridStepWithin(seconds)).toBe(precision);
  });

  test.each([0, 0.5, -60, Number.NaN])(
    "%p seconds fits no step",
    (seconds: number) => {
      expect(getCoarsestChartGridStepWithin(seconds)).toBeUndefined();
    },
  );

  test("the step never outgrows the width asked for, and the next step up always would", () => {
    for (let seconds: number = 1; seconds <= 2 * 43200; seconds += 7) {
      const precision: XAxisPrecision | undefined =
        getCoarsestChartGridStepWithin(seconds);
      const stepSeconds: number = getChartGridStepSeconds(precision!)!;
      const next: ChartGridStep | undefined = FIXED_WIDTH_CHART_GRID_STEPS.find(
        (step: ChartGridStep): boolean => {
          return step.seconds > stepSeconds;
        },
      );
      expect([seconds, stepSeconds <= seconds]).toEqual([seconds, true]);
      if (next) {
        expect([seconds, next.seconds > seconds]).toEqual([seconds, true]);
      }
    }
  });
});
