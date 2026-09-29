/** @timezone UTC */
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Drag-to-zoom and the double-click reset, driven through REAL recharts
 * (issue #4105: a drag across any chart zooms the page to that slice, a
 * double-click on any chart puts it back).
 *
 * The other drag suites stand in for recharts' chart root and hand the
 * chart's handlers a made-up {activeTooltipIndex}. That skips the layer
 * this suite is about: recharts works out the bucket under the pointer in
 * its own store, and hands the chart's mousedown / mousemove / mouseup
 * handlers whatever that store holds at that moment - holding some events
 * back for the next animation frame. A recharts upgrade that renamed that
 * field, or changed when it is filled in, would break the zoom on every
 * chart in the product while every stand-in suite stayed green.
 *
 * So here only ResponsiveContainer is stood in for: it measures its parent,
 * which jsdom always reports as 0x0, and would draw nothing. The pointer
 * goes to the plot at the x recharts drew each bucket's tick label at, and
 * recharts resolves it to a bucket itself (jsdom has no layout, so the
 * chart's box sits at 0,0 and a clientX is an x inside the chart).
 *
 * No test lets an animation frame pass unless it says so. A chart that
 * offers a drag takes mousemove unthrottled, so every move is in recharts'
 * store before the next event arrives; were mousemove held for the next
 * frame again, a press here would find no bucket under the pointer yet and
 * most of this suite would fail. The timing tests let frames pass between
 * some events and not others, the way a real hand does: a slow drag works
 * either way, but a held mousemove ends a quick flick a bucket or more
 * short, and starts a press made in the frame the pointer arrived a bucket
 * early - then drops it, when the move that brought the pointer there (no
 * button held yet) lands after the press.
 */

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts");
  const react: typeof React = jest.requireActual("react") as typeof React;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return react.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

import { AreaChart } from "../../../../UI/Components/Charts/ChartLibrary/AreaChart/AreaChart";
import { BarChart } from "../../../../UI/Components/Charts/ChartLibrary/BarChart/BarChart";
import { LineChart } from "../../../../UI/Components/Charts/ChartLibrary/LineChart/LineChart";
import {
  CHART_DATA_POINT_DATE_KEY,
  CHART_DATA_POINT_X_AXIS_KEY,
} from "../../../../UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import AreaChartElement from "../../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../../UI/Components/Charts/Bar/BarChart";
import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import SeriesPoint from "../../../../UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "../../../../UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "../../../../UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "../../../../UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "../../../../UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "../../../../UI/Components/Charts/Types/YAxis/YAxisType";

const MINUTE_MS: number = 60 * 1000;
// One animation frame, as fake timers run them.
const FRAME_MS: number = 16;
const FIRST_BUCKET_MS: number = Date.parse("2026-09-28T10:00:00.000Z");
// Inside the plot: below its top edge and above the x-axis.
const PLOT_Y: number = 120;
// Somewhere on the page, well away from the chart.
const OFF_CHART: { clientX: number; clientY: number } = {
  clientX: 900,
  clientY: 520,
};

/*
 * Ten one-minute buckets, 10:00 to 10:09, in the shape the time-series
 * wrappers hand the cores: the label recharts draws, the start of the
 * bucket the row draws, and one value per series.
 */
const ROWS: Array<Record<string, number | string>> = Array.from(
  { length: 10 },
  (_: unknown, index: number): Record<string, number | string> => {
    return {
      [CHART_DATA_POINT_X_AXIS_KEY]: `10:0${index}`,
      [CHART_DATA_POINT_DATE_KEY]: FIRST_BUCKET_MS + index * MINUTE_MS,
      CPU: 40 + index,
    };
  },
);

type SelectHandler = (startTime: Date, endTime: Date) => void;

type BucketClickHandler = (
  bucketStart: Date,
  bucketEnd: Date,
  valuesAtBucket: Record<string, number | string>,
) => void;

interface ChartHandlers {
  onTimeRangeSelect?: SelectHandler | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  onBucketClick?: BucketClickHandler | undefined;
}

interface ChartUnderTest {
  name: string;
  /*
   * How recharts places a bucket on the x-axis: at a point (line, area),
   * or across a band holding the bar and the gap around it (bar).
   */
  scale: "point" | "band";
  // Whether a plain click on the plot reports the bucket under it.
  reportsBucketClicks: boolean;
  render: (handlers: ChartHandlers) => React.ReactElement;
}

const CORES: Array<ChartUnderTest> = [
  {
    name: "line",
    scale: "point",
    reportsBucketClicks: true,
    render: (handlers: ChartHandlers): React.ReactElement => {
      return (
        <LineChart
          data={ROWS}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["CPU"]}
          showLegend={false}
          onTimeRangeSelect={handlers.onTimeRangeSelect}
          onTimeRangeReset={handlers.onTimeRangeReset}
          onBucketClick={handlers.onBucketClick}
        />
      );
    },
  },
  {
    name: "area",
    scale: "point",
    reportsBucketClicks: true,
    render: (handlers: ChartHandlers): React.ReactElement => {
      return (
        <AreaChart
          data={ROWS}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["CPU"]}
          showLegend={false}
          onTimeRangeSelect={handlers.onTimeRangeSelect}
          onTimeRangeReset={handlers.onTimeRangeReset}
          onBucketClick={handlers.onBucketClick}
        />
      );
    },
  },
  {
    name: "bar",
    scale: "band",
    reportsBucketClicks: false,
    render: (handlers: ChartHandlers): React.ReactElement => {
      return (
        <BarChart
          data={ROWS}
          index={CHART_DATA_POINT_X_AXIS_KEY}
          categories={["CPU"]}
          showLegend={false}
          onTimeRangeSelect={handlers.onTimeRangeSelect}
          onTimeRangeReset={handlers.onTimeRangeReset}
        />
      );
    },
  },
];

let renderedChart: HTMLElement | null = null;

// Renders a chart the gestures below then act on.
function renderChartElement(chart: React.ReactElement): void {
  renderedChart = render(chart).container;
}

function renderChart(chart: ChartUnderTest, handlers: ChartHandlers): void {
  renderChartElement(chart.render(handlers));
}

function chartContainer(): HTMLElement {
  if (!renderedChart) {
    throw new Error("no chart rendered");
  }
  return renderedChart;
}

// The element recharts listens on; every mouse event below bubbles to it.
function chartWrapper(): Element {
  const wrapper: Element | null =
    chartContainer().querySelector(".recharts-wrapper");
  if (!wrapper) {
    throw new Error("recharts drew no chart");
  }
  return wrapper;
}

/*
 * The plot's own background: where the pointer lands when it is over no
 * line, area or bar. The events fired at it bubble to the wrapper.
 */
function plotSurface(): Element {
  const surface: Element | null = chartContainer().querySelector(
    "svg.recharts-surface",
  );
  if (!surface) {
    throw new Error("recharts drew no plot surface");
  }
  return surface;
}

/*
 * The pointer x that lands on a bucket: where recharts drew its tick
 * label, the centre of the bucket on both kinds of axis.
 */
function tickX(label: string): number {
  const tick: Element | undefined = Array.from(
    chartContainer().querySelectorAll(
      ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value",
    ),
  ).find((element: Element): boolean => {
    return element.textContent === label;
  });
  if (!tick) {
    throw new Error(`recharts drew no tick label "${label}"`);
  }
  return Number(tick.getAttribute("x"));
}

// The pointer arrives over a bucket with no button held.
function hover(label: string): void {
  fireEvent.mouseMove(plotSurface(), {
    clientX: tickX(label),
    clientY: PLOT_Y,
    buttons: 0,
  });
}

// The main button goes down where the pointer already is.
function press(label: string): void {
  fireEvent.mouseDown(plotSurface(), {
    clientX: tickX(label),
    clientY: PLOT_Y,
    button: 0,
    buttons: 1,
  });
}

/*
 * The main button goes down over a bucket in the same frame the pointer
 * arrived there: a browser always moves the pointer to a spot before it
 * reports a press on it.
 */
function pressAt(label: string): void {
  hover(label);
  press(label);
}

// The pointer moves over a bucket with the main button held.
function dragTo(label: string): void {
  fireEvent.mouseMove(plotSurface(), {
    clientX: tickX(label),
    clientY: PLOT_Y,
    buttons: 1,
  });
}

/*
 * The button comes up over a bucket of the chart. The browser follows it
 * with a click on the plot, as it does whenever the press and the release
 * both land inside it.
 */
function releaseAt(label: string): void {
  fireEvent.mouseUp(plotSurface(), {
    clientX: tickX(label),
    clientY: PLOT_Y,
    button: 0,
    buttons: 0,
  });
  fireEvent.click(plotSurface(), {
    clientX: tickX(label),
    clientY: PLOT_Y,
    button: 0,
    detail: 1,
  });
}

/*
 * The pointer leaves the chart with the button held, wanders the page and
 * lets go there: only the page hears that release, never the chart.
 */
function releaseOnThePage(): void {
  fireEvent.mouseLeave(chartWrapper(), {
    relatedTarget: document.body,
    ...OFF_CHART,
    buttons: 1,
  });
  fireEvent.mouseMove(document.body, { ...OFF_CHART, buttons: 1 });
  fireEvent.mouseUp(document.body, { ...OFF_CHART, button: 0, buttons: 0 });
}

// What a browser delivers for a double-click at one spot of the plot.
function doubleClickAt(label: string): void {
  const spot: { clientX: number; clientY: number } = {
    clientX: tickX(label),
    clientY: PLOT_Y,
  };
  hover(label);
  for (const detail of [1, 2]) {
    fireEvent.mouseDown(plotSurface(), {
      ...spot,
      button: 0,
      buttons: 1,
      detail: detail,
    });
    fireEvent.mouseUp(plotSurface(), {
      ...spot,
      button: 0,
      buttons: 0,
      detail: detail,
    });
    fireEvent.click(plotSurface(), { ...spot, button: 0, detail: detail });
  }
  fireEvent.doubleClick(plotSurface(), { ...spot, button: 0, detail: 2 });
}

// Lets one animation frame pass: fake timers run the frame's callbacks.
function nextFrame(): void {
  act(() => {
    jest.advanceTimersByTime(FRAME_MS);
  });
}

function waitOutTheDoubleClickWindow(): void {
  act(() => {
    jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
  });
}

// "10:02" -> the instant that minute starts, as the handlers report it.
function at(label: string): string {
  return `2026-09-28T${label}:00.000Z`;
}

function zoomWindow(from: string, to: string): [string, string] {
  return [at(from), at(to)];
}

// Every window the chart selected, oldest first.
function selections(onTimeRangeSelect: MockFunction): Array<[string, string]> {
  return onTimeRangeSelect.mock.calls.map(
    (call: Array<unknown>): [string, string] => {
      return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
    },
  );
}

interface BandEdges {
  left: number;
  right: number;
}

// The live selection band recharts drew, or null.
function drawnBand(): BandEdges | null {
  const rect: Element | null = chartContainer().querySelector(
    ".recharts-reference-area-rect",
  );
  if (!rect) {
    return null;
  }
  const left: number = Number(rect.getAttribute("x"));
  return { left: left, right: left + Number(rect.getAttribute("width")) };
}

/*
 * Where a band over the buckets lower..upper belongs: from the first
 * bucket's point to the last one's on a line or an area chart, and over
 * the whole of both end bars (with the gaps around them) on a bar chart.
 */
function expectBandOver(
  chart: ChartUnderTest,
  lower: string,
  upper: string,
): void {
  const band: BandEdges | null = drawnBand();
  expect(band).not.toBeNull();

  const halfBucket: number =
    chart.scale === "band" ? (tickX("10:01") - tickX("10:00")) / 2 : 0;
  expect(band!.left).toBeCloseTo(tickX(lower) - halfBucket, 1);
  expect(band!.right).toBeCloseTo(tickX(upper) + halfBucket, 1);
}

beforeEach(() => {
  /*
   * Installed AT the fixed time rather than moved there with setSystemTime:
   * fake timers count animation frames from the moment they are installed,
   * and a clock moved back after that puts the next frame up to 31ms out,
   * so nextFrame() would not always run one.
   */
  jest.useFakeTimers({ now: new Date("2026-09-28T10:30:00.000Z") });
});

afterEach(() => {
  cleanup();
  renderedChart = null;
  jest.useRealTimers();
});

describe("drag-to-zoom through real recharts", () => {
  for (const chart of CORES) {
    describe(`the ${chart.name} chart`, () => {
      test("a left-to-right drag selects from the start of the first bucket to the end of the last", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        pressAt("10:02");
        dragTo("10:03");
        dragTo("10:04");
        dragTo("10:06");
        releaseAt("10:06");

        /*
         * Exactly once: the page-wide listener that catches a release off
         * the chart must not commit the chart's own release a second time.
         */
        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:07"),
        ]);
      });

      test("a right-to-left drag selects the same window", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        pressAt("10:06");
        dragTo("10:05");
        dragTo("10:03");
        dragTo("10:02");
        releaseAt("10:02");

        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:07"),
        ]);
      });

      test("a drag that doubles back selects up to where it was released, not its furthest reach", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        pressAt("10:02");
        dragTo("10:07");
        dragTo("10:04");
        releaseAt("10:04");

        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:05"),
        ]);
      });

      test("a drag to the last bucket takes its width from the bucket before it", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        pressAt("10:07");
        dragTo("10:09");
        releaseAt("10:09");

        expect(selections(onTimeRangeSelect)).toEqual([
          ["2026-09-28T10:07:00.000Z", "2026-09-28T10:10:00.000Z"],
        ]);
      });

      test("the band draws nothing on the press, then covers every bucket crossed and clears on the release", () => {
        renderChart(chart, { onTimeRangeSelect: getJestMockFunction() });

        pressAt("10:03");
        expect(drawnBand()).toBeNull();

        dragTo("10:06");
        expectBandOver(chart, "10:03", "10:06");

        dragTo("10:04");
        expectBandOver(chart, "10:03", "10:04");

        releaseAt("10:04");
        expect(drawnBand()).toBeNull();
      });

      test("a right-to-left drag's band covers both end buckets too", () => {
        renderChart(chart, { onTimeRangeSelect: getJestMockFunction() });

        pressAt("10:06");
        dragTo("10:05");
        expectBandOver(chart, "10:05", "10:06");

        dragTo("10:03");
        expectBandOver(chart, "10:03", "10:06");

        releaseAt("10:03");
        expect(drawnBand()).toBeNull();
      });

      test("a drag released outside the chart, on the page, still selects up to the last bucket it reached", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        pressAt("10:02");
        dragTo("10:04");
        dragTo("10:06");
        releaseOnThePage();

        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:07"),
        ]);
        expect(drawnBand()).toBeNull();

        // That release ended the press: another one on the page selects nothing.
        fireEvent.mouseUp(document.body, { ...OFF_CHART, button: 0 });
        expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
      });

      test("a right-to-left drag released on the page selects the same window", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        pressAt("10:06");
        dragTo("10:04");
        dragTo("10:02");
        releaseOnThePage();

        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:07"),
        ]);
      });

      test("a press and release on one bucket selects nothing and draws no band", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        pressAt("10:04");
        // A hand never holds perfectly still: a nudge inside the bucket.
        fireEvent.mouseMove(plotSurface(), {
          clientX: tickX("10:04") + 3,
          clientY: PLOT_Y + 2,
          buttons: 1,
        });
        expect(drawnBand()).toBeNull();
        releaseAt("10:04");

        expect(onTimeRangeSelect).not.toHaveBeenCalled();
        expect(drawnBand()).toBeNull();
      });

      test("a press on one bucket released on the page selects nothing", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        pressAt("10:04");
        releaseOnThePage();

        expect(onTimeRangeSelect).not.toHaveBeenCalled();
      });

      test("a drag whose button came up where no page could hear it is dropped at its next move", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        pressAt("10:02");
        dragTo("10:05");
        expect(drawnBand()).not.toBeNull();

        // Back over the chart with no button held.
        hover("10:06");
        expect(drawnBand()).toBeNull();

        fireEvent.mouseUp(document.body, { ...OFF_CHART, button: 0 });
        expect(onTimeRangeSelect).not.toHaveBeenCalled();
      });

      test("a right-button drag selects nothing", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        hover("10:02");
        fireEvent.mouseDown(plotSurface(), {
          clientX: tickX("10:02"),
          clientY: PLOT_Y,
          button: 2,
          buttons: 2,
        });
        fireEvent.mouseMove(plotSurface(), {
          clientX: tickX("10:05"),
          clientY: PLOT_Y,
          buttons: 2,
        });
        expect(drawnBand()).toBeNull();
        fireEvent.mouseUp(plotSurface(), {
          clientX: tickX("10:05"),
          clientY: PLOT_Y,
          button: 2,
        });

        expect(onTimeRangeSelect).not.toHaveBeenCalled();
      });

      test("a double-click on an empty spot of the plot resets the zoom, and selects nothing", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        const onTimeRangeReset: MockFunction = getJestMockFunction();
        const onBucketClick: MockFunction = getJestMockFunction();
        renderChart(chart, {
          onTimeRangeSelect: onTimeRangeSelect,
          onTimeRangeReset: onTimeRangeReset,
          onBucketClick: onBucketClick,
        });

        doubleClickAt("10:04");

        expect(onTimeRangeReset).toHaveBeenCalledTimes(1);
        waitOutTheDoubleClickWindow();
        // Neither click of the double-click did anything on its way past.
        expect(onBucketClick).not.toHaveBeenCalled();
        expect(onTimeRangeSelect).not.toHaveBeenCalled();
        expect(drawnBand()).toBeNull();
      });

      test("the reset double-click still works right after a drag", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        const onTimeRangeReset: MockFunction = getJestMockFunction();
        renderChart(chart, {
          onTimeRangeSelect: onTimeRangeSelect,
          onTimeRangeReset: onTimeRangeReset,
        });

        pressAt("10:02");
        dragTo("10:05");
        releaseAt("10:05");
        doubleClickAt("10:05");

        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:06"),
        ]);
        expect(onTimeRangeReset).toHaveBeenCalledTimes(1);
      });

      if (chart.reportsBucketClicks) {
        test("a single click reports the bucket under the pointer once the double-click window has passed", () => {
          const onBucketClick: MockFunction = getJestMockFunction();
          renderChart(chart, {
            onTimeRangeSelect: getJestMockFunction(),
            onTimeRangeReset: getJestMockFunction(),
            onBucketClick: onBucketClick,
          });

          pressAt("10:04");
          releaseAt("10:04");
          expect(onBucketClick).not.toHaveBeenCalled();

          act(() => {
            jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
          });
          expect(onBucketClick).toHaveBeenCalledTimes(1);
          expect((onBucketClick.mock.calls[0]![0] as Date).toISOString()).toBe(
            at("10:04"),
          );
          expect((onBucketClick.mock.calls[0]![1] as Date).toISOString()).toBe(
            at("10:05"),
          );
          expect(onBucketClick.mock.calls[0]![2]).toMatchObject({ CPU: 44 });
        });

        test("the click a browser fires after a drag's release reports no bucket", () => {
          const onTimeRangeSelect: MockFunction = getJestMockFunction();
          const onBucketClick: MockFunction = getJestMockFunction();
          renderChart(chart, {
            onTimeRangeSelect: onTimeRangeSelect,
            onTimeRangeReset: getJestMockFunction(),
            onBucketClick: onBucketClick,
          });

          pressAt("10:02");
          dragTo("10:05");
          releaseAt("10:05");
          waitOutTheDoubleClickWindow();

          expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
          expect(onBucketClick).not.toHaveBeenCalled();
        });
      }
    });
  }
});

describe("drag-to-zoom through real recharts, frame by frame", () => {
  for (const chart of CORES) {
    describe(`the ${chart.name} chart`, () => {
      test("a slow drag, the pointer resting a frame before every press, move and release, selects the buckets it crossed", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        hover("10:02");
        nextFrame();
        press("10:02");
        nextFrame();
        dragTo("10:04");
        nextFrame();
        dragTo("10:06");
        nextFrame();
        releaseAt("10:06");
        nextFrame();

        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:07"),
        ]);
      });

      test("a quick flick released in the frame of its last move still covers the bucket it was released on", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        hover("10:02");
        nextFrame();
        press("10:02");
        nextFrame();
        dragTo("10:03");
        nextFrame();
        // The last move and the release land in the same frame.
        dragTo("10:06");
        releaseAt("10:06");

        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:07"),
        ]);
      });

      test("a press in the frame the pointer arrived starts on the bucket it arrived at, and holds", () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderChart(chart, { onTimeRangeSelect: onTimeRangeSelect });

        // The pointer rests on 10:01 a while, then darts to 10:02 and presses.
        hover("10:01");
        nextFrame();
        pressAt("10:02");
        /*
         * A frame passes with the button held: the move that brought the
         * pointer here (no button held yet) must not land now and read as
         * the button coming up.
         */
        nextFrame();
        dragTo("10:05");
        nextFrame();
        releaseAt("10:05");

        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:06"),
        ]);
      });
    });
  }
});

/*
 * The whole chain a page renders: series points, the rows the chart
 * elements build from them, real recharts, the core's drag. A rolling range
 * is resolved at an instant off the minute (10:23:11 here), so the window
 * starts at 10:08:11 while each row draws a whole minute from 10:08 on.
 * The zoom must be exactly the minutes under the pointer.
 */
describe("drag-to-zoom through the chart elements a page renders", () => {
  const windowEnd: Date = new Date("2026-09-28T10:23:11.000Z");
  const windowStart: Date = new Date(windowEnd.getTime() - 15 * MINUTE_MS);

  const xAxis: ChartXAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: windowStart,
      max: windowEnd,
      aggregateType: XAxisAggregateType.Average,
      precision: XAxisPrecision.EVERY_MINUTE,
    },
  };

  const yAxis: YAxis = {
    legend: "%",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: 200,
      precision: YAxisPrecision.NoDecimals,
      formatter: (value: number): string => {
        return `${value}%`;
      },
    },
  };

  // One point at the start of every minute, as the analytics server returns them.
  const series: Array<SeriesPoint> = [
    {
      seriesName: "CPU",
      data: Array.from({ length: 16 }, (_: unknown, index: number) => {
        return {
          x: new Date(
            Date.parse("2026-09-28T10:08:00.000Z") + index * MINUTE_MS,
          ),
          y: 40 + index,
        };
      }),
    },
  ];

  const elements: Array<{
    name: string;
    render: (onTimeRangeSelect: SelectHandler) => React.ReactElement;
  }> = [
    {
      name: "line",
      render: (onTimeRangeSelect: SelectHandler): React.ReactElement => {
        return (
          <LineChartElement
            data={series}
            xAxis={xAxis}
            yAxis={yAxis}
            curve={ChartCurve.LINEAR}
            heightInPx={300}
            showLegend={false}
            sync={false}
            syncid="real-recharts-drag-line"
            onTimeRangeSelect={onTimeRangeSelect}
          />
        );
      },
    },
    {
      name: "area",
      render: (onTimeRangeSelect: SelectHandler): React.ReactElement => {
        return (
          <AreaChartElement
            data={series}
            xAxis={xAxis}
            yAxis={yAxis}
            curve={ChartCurve.LINEAR}
            heightInPx={300}
            showLegend={false}
            sync={false}
            syncid="real-recharts-drag-area"
            onTimeRangeSelect={onTimeRangeSelect}
          />
        );
      },
    },
    {
      name: "bar",
      render: (onTimeRangeSelect: SelectHandler): React.ReactElement => {
        return (
          <BarChartElement
            data={series}
            xAxis={xAxis}
            yAxis={yAxis}
            heightInPx={300}
            showLegend={false}
            sync={false}
            syncid="real-recharts-drag-bar"
            onTimeRangeSelect={onTimeRangeSelect}
          />
        );
      },
    },
  ];

  for (const element of elements) {
    test(`a drag across the ${element.name} chart zooms exactly the minutes under the pointer`, () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      renderChartElement(element.render(onTimeRangeSelect));

      pressAt("10:12");
      dragTo("10:14");
      dragTo("10:15");
      releaseAt("10:15");

      expect(selections(onTimeRangeSelect)).toEqual([
        zoomWindow("10:12", "10:16"),
      ]);
    });

    test(`a right-to-left drag across the ${element.name} chart from its first minute zooms from the start of that minute`, () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      renderChartElement(element.render(onTimeRangeSelect));

      pressAt("10:10");
      dragTo("10:08");
      releaseOnThePage();

      /*
       * From 10:08:00, the start of the minute the first row draws: not
       * 10:08:11, where the window happened to start.
       */
      expect(selections(onTimeRangeSelect)).toEqual([
        zoomWindow("10:08", "10:11"),
      ]);
    });
  }
});
