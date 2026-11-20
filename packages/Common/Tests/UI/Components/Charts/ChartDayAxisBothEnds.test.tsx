/** @timezone UTC */
// UX rule: Docs/ux/README.md#numbers-dates-and-plurals

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import AreaChartElement from "../../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../../UI/Components/Charts/Bar/BarChart";
import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";
import {
  getTimeAxisTickInterval,
  isCalendarPrecision,
} from "../../../../UI/Components/Charts/Utils/TimeAxisTicks";
import XAxisUtil from "../../../../UI/Components/Charts/Utils/XAxis";

/*
 * A DAY AXIS LABELS ITS FIRST AND ITS LAST DAY (issue #7126).
 *
 * The time axis drew as many labels as fit, evenly spaced from the first
 * slot, so the last label fell wherever the step landed: 30 days labelled
 * every 4th day ended on day 29, and the chart's right-hand end - today -
 * had no date under it. A Product Analytics chart over Past 1 Month read as
 * if it stopped a few days early. An axis of days, weeks or months now
 * labels both its ends, and the days between at a step that keeps them
 * apart; an axis of clock times keeps the even spacing it had.
 *
 * Drawn by real recharts. jsdom lays nothing out, so two things are stood
 * in for: ResponsiveContainer's size (the chart's width, a wide card's or a
 * phone's), and the width recharts measures a label at, CHARACTER_WIDTH a
 * character of its 10px font, so that it thins the labels as a browser
 * does and two of them can be seen to overlap or not.
 */

let chartWidth: number = 1000;

jest.mock("recharts", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "recharts",
  ) as Record<string, unknown>;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, {
        width: chartWidth,
        height: 240,
      } as Record<string, unknown>);
    },
  };
});

// About what a 10px tick label's character is wide in the app's font.
const CHARACTER_WIDTH: number = 6;

const RECHARTS_MEASUREMENT_SPAN_ID: string = "recharts_measurement_span";

const GET_BOUNDING_CLIENT_RECT: typeof HTMLElement.prototype.getBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  chartWidth = 1000;

  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.id === RECHARTS_MEASUREMENT_SPAN_ID) {
      const width: number = (this.textContent || "").length * CHARACTER_WIDTH;

      return {
        width: width,
        height: 12,
        top: 0,
        left: 0,
        right: width,
        bottom: 12,
        x: 0,
        y: 0,
        toJSON: (): string => {
          return "";
        },
      } as DOMRect;
    }

    return GET_BOUNDING_CLIENT_RECT.call(this);
  };
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = GET_BOUNDING_CLIENT_RECT;
});

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

// A space, a no-break space or a narrow one: the same to a reader.
const ANY_SPACE: RegExp = /\s/g;

function xAxisOf(data: {
  first: Date;
  last: Date;
  precision: XAxisPrecision;
}): XAxis {
  return {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: data.first,
      max: data.last,
      aggregateType: XAxisAggregateType.Average,
      precision: data.precision,
    },
  };
}

const Y_AXIS: YAxis = {
  legend: "",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

// One point a step from `first` to `last`, as the pages chart them.
function series(data: {
  first: Date;
  last: Date;
  stepMs: number;
}): Array<SeriesPoint> {
  const points: Array<{ x: Date; y: number }> = [];

  for (
    let instant: number = data.first.getTime();
    instant <= data.last.getTime();
    instant += data.stepMs
  ) {
    points.push({ x: new Date(instant), y: 10 + (points.length % 7) });
  }

  return [{ seriesName: "Users", data: points }];
}

// The label every slot of the axis is named by, first to last.
function slotLabels(xAxis: XAxis): Array<string> {
  const formatter: (value: Date) => string = XAxisUtil.getFormatter({
    xAxisMin: xAxis.options.min,
    xAxisMax: xAxis.options.max,
    precision: xAxis.options.precision,
  });

  return XAxisUtil.getRenderableIntervals({
    xAxisMin: xAxis.options.min,
    xAxisMax: xAxis.options.max,
    precision: xAxis.options.precision,
  }).map((slot: Date): string => {
    return formatter(slot).replace(ANY_SPACE, " ");
  });
}

interface DrawnTick {
  label: string;
  x: number;
}

// The labels under the time axis, first to last, with where each is centred.
function timeTicks(container: HTMLElement): Array<DrawnTick> {
  return Array.from(
    container.querySelectorAll(
      ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value",
    ),
  ).map((tick: Element): DrawnTick => {
    return {
      label: (tick.textContent || "").replace(ANY_SPACE, " "),
      x: Number(tick.getAttribute("x")),
    };
  });
}

/*
 * No two labels overlap: each one ends before the next begins, measured at
 * the width recharts measured them at (labels are centred on their x).
 */
function expectNoOverlap(ticks: Array<DrawnTick>): void {
  for (let index: number = 1; index < ticks.length; index++) {
    const previous: DrawnTick = ticks[index - 1]!;
    const current: DrawnTick = ticks[index]!;
    const previousEnd: number =
      previous.x + (previous.label.length * CHARACTER_WIDTH) / 2;
    const currentStart: number =
      current.x - (current.label.length * CHARACTER_WIDTH) / 2;

    expect(currentStart).toBeGreaterThanOrEqual(previousEnd);
  }
}

type ChartKind = "line" | "area" | "bar";

// A window of days a chart covers, and a width it is drawn at.
interface DayWindow {
  name: string;
  first: Date;
  last: Date;
}

interface ChartWidth {
  name: string;
  px: number;
}

function drawChart(data: {
  kind?: ChartKind | undefined;
  xAxis: XAxis;
  data: Array<SeriesPoint>;
  isRightToLeft?: boolean | undefined;
}): HTMLElement {
  const common: {
    data: Array<SeriesPoint>;
    xAxis: XAxis;
    yAxis: YAxis;
    sync: boolean;
    syncid: string;
    heightInPx: number;
    showLegend: boolean;
  } = {
    data: data.data,
    xAxis: data.xAxis,
    yAxis: Y_AXIS,
    sync: false,
    syncid: "",
    heightInPx: 240,
    showLegend: false,
  };

  const chart: React.ReactElement =
    data.kind === "bar" ? (
      <BarChartElement {...common} />
    ) : data.kind === "area" ? (
      <AreaChartElement {...common} curve={ChartCurve.MONOTONE} />
    ) : (
      <LineChartElement {...common} curve={ChartCurve.MONOTONE} />
    );

  const { container } = render(
    data.isRightToLeft ? <div dir="rtl">{chart}</div> : chart,
  );

  return container;
}

// Where each drawn label is among the axis's slots.
function slotIndexes(
  ticks: Array<DrawnTick>,
  slots: Array<string>,
): Array<number> {
  return ticks.map((tick: DrawnTick): number => {
    return slots.indexOf(tick.label);
  });
}

describe("an axis of days labels its first and its last day", () => {
  const WINDOWS: Array<DayWindow> = [
    {
      name: "30 days",
      first: new Date("2026-10-22T00:00:00.000Z"),
      last: new Date("2026-11-20T00:00:00.000Z"),
    },
    {
      name: "7 days",
      first: new Date("2026-11-14T00:00:00.000Z"),
      last: new Date("2026-11-20T00:00:00.000Z"),
    },
    {
      name: "90 days",
      first: new Date("2026-08-23T00:00:00.000Z"),
      last: new Date("2026-11-20T00:00:00.000Z"),
    },
  ];

  const WIDTHS: Array<ChartWidth> = [
    { name: "a wide card (1280px page)", px: 1000 },
    { name: "a phone (390px page)", px: 330 },
  ];

  const CASES: Array<[string, DayWindow, ChartWidth]> = WINDOWS.flatMap(
    (window: DayWindow): Array<[string, DayWindow, ChartWidth]> => {
      return WIDTHS.map(
        (width: ChartWidth): [string, DayWindow, ChartWidth] => {
          return [`${window.name} on ${width.name}`, window, width];
        },
      );
    },
  );

  test.each(CASES)(
    "%s: the first and last day are labelled, and no two labels overlap",
    (_name: string, window: DayWindow, width: ChartWidth) => {
      chartWidth = width.px;

      const xAxis: XAxis = xAxisOf({
        first: window.first,
        last: window.last,
        precision: XAxisPrecision.EVERY_DAY,
      });
      const slots: Array<string> = slotLabels(xAxis);
      const ticks: Array<DrawnTick> = timeTicks(
        drawChart({
          xAxis: xAxis,
          data: series({
            first: window.first,
            last: window.last,
            stepMs: DAY_MS,
          }),
        }),
      );

      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks[0]!.label).toBe(slots[0]);
      expect(ticks[ticks.length - 1]!.label).toBe(slots[slots.length - 1]);
      // Today, the window's last day, is under the chart's right-hand end.
      expect(ticks[ticks.length - 1]!.label).toBe("20 Nov");
      expectNoOverlap(ticks);

      // The days between are evenly spaced, the gap before the last aside.
      const indexes: Array<number> = slotIndexes(ticks, slots);

      expect(indexes).not.toContain(-1);

      const steps: Array<number> = [];

      for (let index: number = 1; index < indexes.length - 1; index++) {
        steps.push(indexes[index]! - indexes[index - 1]!);
      }

      expect(new Set(steps).size).toBeLessThanOrEqual(1);
    },
  );

  test("30 days on a phone: fewer labels than days, so the axis is thinned, both ends kept", () => {
    chartWidth = 330;

    const first: Date = new Date("2026-10-22T00:00:00.000Z");
    const last: Date = new Date("2026-11-20T00:00:00.000Z");
    const ticks: Array<DrawnTick> = timeTicks(
      drawChart({
        xAxis: xAxisOf({
          first,
          last,
          precision: XAxisPrecision.EVERY_DAY,
        }),
        data: series({ first, last, stepMs: DAY_MS }),
      }),
    );

    expect(ticks.length).toBeLessThan(30);
    expect(ticks[0]!.label).toBe("22 Oct");
    expect(ticks[ticks.length - 1]!.label).toBe("20 Nov");
  });

  test("a year of days, each label with its year: both ends labelled on a phone", () => {
    chartWidth = 330;

    const first: Date = new Date("2025-11-20T00:00:00.000Z");
    const last: Date = new Date("2026-11-20T00:00:00.000Z");
    const xAxis: XAxis = xAxisOf({
      first,
      last,
      precision: XAxisPrecision.EVERY_DAY,
    });
    const slots: Array<string> = slotLabels(xAxis);
    const ticks: Array<DrawnTick> = timeTicks(
      drawChart({ xAxis, data: series({ first, last, stepMs: DAY_MS }) }),
    );

    expect(ticks[0]!.label).toBe(slots[0]);
    expect(ticks[ticks.length - 1]!.label).toBe(slots[slots.length - 1]);
    expect(ticks[ticks.length - 1]!.label).toMatch(/2026/);
    expectNoOverlap(ticks);
  });

  test.each(["area", "bar"] as Array<ChartKind>)(
    "a %s chart of 30 days on a phone labels its first and last day too",
    (kind: ChartKind) => {
      chartWidth = 330;

      const first: Date = new Date("2026-10-22T00:00:00.000Z");
      const last: Date = new Date("2026-11-20T00:00:00.000Z");
      const ticks: Array<DrawnTick> = timeTicks(
        drawChart({
          kind,
          xAxis: xAxisOf({
            first,
            last,
            precision: XAxisPrecision.EVERY_DAY,
          }),
          data: series({ first, last, stepMs: DAY_MS }),
        }),
      );

      expect(ticks[0]!.label).toBe("22 Oct");
      expect(ticks[ticks.length - 1]!.label).toBe("20 Nov");
      expectNoOverlap(ticks);
    },
  );

  test("on a right-to-left page, both ends are labelled", () => {
    chartWidth = 330;

    const first: Date = new Date("2026-10-22T00:00:00.000Z");
    const last: Date = new Date("2026-11-20T00:00:00.000Z");
    const ticks: Array<DrawnTick> = timeTicks(
      drawChart({
        xAxis: xAxisOf({
          first,
          last,
          precision: XAxisPrecision.EVERY_DAY,
        }),
        data: series({ first, last, stepMs: DAY_MS }),
        isRightToLeft: true,
      }),
    );

    expect(ticks[0]!.label).toBe("22 Oct");
    expect(ticks[ticks.length - 1]!.label).toBe("20 Nov");
    expectNoOverlap(ticks);
  });

  test("an axis of weeks labels its first and last week", () => {
    chartWidth = 330;

    const first: Date = new Date("2026-05-25T00:00:00.000Z");
    const last: Date = new Date("2026-11-16T00:00:00.000Z");
    const xAxis: XAxis = xAxisOf({
      first,
      last,
      precision: XAxisPrecision.EVERY_WEEK,
    });
    const slots: Array<string> = slotLabels(xAxis);
    const ticks: Array<DrawnTick> = timeTicks(
      drawChart({ xAxis, data: series({ first, last, stepMs: 7 * DAY_MS }) }),
    );

    expect(ticks[0]!.label).toBe(slots[0]);
    expect(ticks[ticks.length - 1]!.label).toBe(slots[slots.length - 1]);
    expectNoOverlap(ticks);
  });
});

describe("an axis of clock times keeps its even spacing from the first slot", () => {
  test("a day of hours on a phone: evenly spaced labels from the first hour, none overlapping", () => {
    chartWidth = 330;

    const first: Date = new Date("2026-11-19T00:00:00.000Z");
    const last: Date = new Date("2026-11-19T23:00:00.000Z");
    const xAxis: XAxis = xAxisOf({
      first,
      last,
      precision: XAxisPrecision.EVERY_HOUR,
    });
    const slots: Array<string> = slotLabels(xAxis);
    const ticks: Array<DrawnTick> = timeTicks(
      drawChart({ xAxis, data: series({ first, last, stepMs: HOUR_MS }) }),
    );
    const indexes: Array<number> = slotIndexes(ticks, slots);

    expect(indexes[0]).toBe(0);
    expect(indexes).not.toContain(-1);

    const steps: Set<number> = new Set<number>();

    for (let index: number = 1; index < indexes.length; index++) {
      steps.add(indexes[index]! - indexes[index - 1]!);
    }

    // One step all the way: equidistant from the first slot, as before.
    expect(steps.size).toBe(1);
    expectNoOverlap(ticks);
  });
});

describe("getTimeAxisTickInterval", () => {
  const WINDOW: { min: Date; max: Date } = {
    min: new Date("2026-10-22T00:00:00.000Z"),
    max: new Date("2026-11-20T00:00:00.000Z"),
  };

  test.each(Object.values(XAxisPrecision))(
    "%s",
    (precision: XAxisPrecision) => {
      const interval: string = getTimeAxisTickInterval({
        legend: "Time",
        options: {
          type: XAxisType.Time,
          min: WINDOW.min,
          max: WINDOW.max,
          aggregateType: XAxisAggregateType.Average,
          precision: precision,
        },
      });

      expect(interval).toBe(
        isCalendarPrecision(precision)
          ? "preserveStartEnd"
          : "equidistantPreserveStart",
      );
    },
  );

  test("a day or longer is a calendar step; twelve hours and shorter are clock steps", () => {
    expect(isCalendarPrecision(XAxisPrecision.EVERY_DAY)).toBe(true);
    expect(isCalendarPrecision(XAxisPrecision.EVERY_WEEK)).toBe(true);
    expect(isCalendarPrecision(XAxisPrecision.EVERY_MONTH)).toBe(true);
    expect(isCalendarPrecision(XAxisPrecision.EVERY_YEAR)).toBe(true);
    expect(isCalendarPrecision(XAxisPrecision.EVERY_TWELVE_HOURS)).toBe(false);
    expect(isCalendarPrecision(XAxisPrecision.EVERY_HOUR)).toBe(false);
    expect(isCalendarPrecision(XAxisPrecision.EVERY_MINUTE)).toBe(false);
  });

  test("left to the window, a month reads as days and labels both ends; a day reads as clock times", () => {
    expect(
      getTimeAxisTickInterval({
        legend: "Time",
        options: {
          type: XAxisType.Time,
          min: WINDOW.min,
          max: WINDOW.max,
          aggregateType: XAxisAggregateType.Average,
        },
      }),
    ).toBe("preserveStartEnd");
    expect(
      getTimeAxisTickInterval({
        legend: "Time",
        options: {
          type: XAxisType.Time,
          min: new Date("2026-11-19T00:00:00.000Z"),
          max: new Date("2026-11-20T00:00:00.000Z"),
          aggregateType: XAxisAggregateType.Average,
        },
      }),
    ).toBe("equidistantPreserveStart");
  });

  test("a time axis without dates to step keeps its spacing rather than failing the chart", () => {
    expect(
      getTimeAxisTickInterval({
        legend: "Time",
        options: {
          type: XAxisType.Time,
          min: 0,
          max: 100,
          aggregateType: XAxisAggregateType.Average,
        },
      }),
    ).toBe("equidistantPreserveStart");
  });
});
