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
 * chart (issue #4105 review, sdn-1) and the Topology service-call drawer
 * (sdn-3) match their server-side buckets to. The widths are measured on
 * the library's own walker, so a change to either side fails here rather
 * than as averaged or dropped points on a chart.
 */

const DAY_SECONDS: number = 24 * 60 * 60;

// A UTC Sunday far from any clock change.
const WALK_FROM: Date = new Date("2026-09-27T00:00:00.000Z");

// How far apart XAxisUtil puts two consecutive slots of a precision.
function walkedStepSeconds(precision: XAxisPrecision): number {
  const intervals: Array<Date> = XAxisUtil.getPrecisionIntervals({
    xAxisMin: WALK_FROM,
    xAxisMax: new Date(WALK_FROM.getTime() + 70 * DAY_SECONDS * 1000),
    precision: precision,
  });
  return (intervals[1]!.getTime() - intervals[0]!.getTime()) / 1000;
}

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
    expect(widths).toEqual(
      [...widths].sort((first: number, second: number): number => {
        return first - second;
      }),
    );
    expect(new Set(widths).size).toBe(widths.length);
  });

  test("every step the chart has that is shorter than a day is listed; the rest follow the calendar", () => {
    const listed: Set<XAxisPrecision> = new Set<XAxisPrecision>(
      FIXED_WIDTH_CHART_GRID_STEPS.map(
        (step: ChartGridStep): XAxisPrecision => {
          return step.precision;
        },
      ),
    );
    for (const precision of Object.values(XAxisPrecision)) {
      if (listed.has(precision)) {
        expect([precision, walkedStepSeconds(precision)]).not.toEqual([
          precision,
          expect.any(Number) as unknown as number,
        ].map((value: unknown, index: number): unknown => {
          return index === 1 && (value as number) >= DAY_SECONDS
            ? value
            : value;
        }));
        expect(walkedStepSeconds(precision)).toBeLessThan(DAY_SECONDS);
      } else {
        expect([precision, walkedStepSeconds(precision) >= DAY_SECONDS]).toEqual(
          [precision, true],
        );
      }
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
  ])(
    "%i seconds: %s",
    (seconds: number, precision: XAxisPrecision) => {
      expect(getCoarsestChartGridStepWithin(seconds)).toBe(precision);
    },
  );

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
      const next: ChartGridStep | undefined =
        FIXED_WIDTH_CHART_GRID_STEPS.find((step: ChartGridStep): boolean => {
          return step.seconds > stepSeconds;
        });
      expect([seconds, stepSeconds <= seconds]).toEqual([seconds, true]);
      if (next) {
        expect([seconds, next.seconds > seconds]).toEqual([seconds, true]);
      }
    }
  });
});
