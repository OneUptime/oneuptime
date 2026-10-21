/** @timezone UTC */
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Issue #4116: a double-click resets a zoomed chart even when the browser
 * never sends the chart its dblclick.
 *
 * Right after a drag zooms a page, its charts refetch, and the reader
 * double-clicks to undo the zoom at exactly that moment. When the new rows
 * land during the double-click's second press, recharts can draw the node
 * that press landed on afresh (it re-keys a line's path), and Chrome then
 * sends the press no click and no dblclick. The line, area and bar charts
 * used to reset on the dblclick alone, so the page stayed zoomed - and a
 * moment later the first click, held back to tell it apart from a
 * double-click, acted on top.
 *
 * The chart now takes the second press itself as the reset: its
 * MouseEvent.detail is 2 whatever becomes of the node it landed on, and its
 * release arms the reset for the next task. A dblclick that does arrive
 * comes before that task, resets, and stands the fallback down.
 *
 * Driven here through the line, area and bar charts a page renders, on REAL
 * recharts: only ResponsiveContainer is stood in for (it measures a parent
 * jsdom reports as 0x0), as in ChartRangeSelectionRealRecharts.test.tsx,
 * and the pointer goes to the x recharts drew each bucket's tick label at.
 * jsdom drops no event, so each test fires exactly what Chrome delivers;
 * for a double-click that lost its dblclick that is mousedown, mouseup and
 * click with detail 1, then mousedown and mouseup with detail 2, and
 * nothing more. Pinned, for each chart:
 *
 *   - such a double-click resets once, on the next task (not during the
 *     release), and the first click's held-back action never runs - also
 *     when the second click arrives without its dblclick, and when the
 *     second release lands off the chart;
 *   - one that keeps its dblclick resets exactly once, from the dblclick;
 *   - a single click still acts, once the double-click window has passed;
 *   - with nothing to reset, the second press is an ordinary press and the
 *     clicks act at once, as they always have;
 *   - a chart handed only a reset (it offers no drag) resets the same way -
 *     the bar chart from a bar or from its bare plot;
 *   - new rows landing between the second press and its release neither
 *     stop the reset nor turn the press into a drag across old and new
 *     buckets - including on a page zoomed a moment before.
 *
 * A plain click on a line or area chart's plot reports the bucket under it
 * (onBucketClick). The bar chart's wrapper takes no bucket-click handler,
 * so its gestures land on a bar, whose click highlights it: that is the
 * plot click there is to hold back.
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

import AreaChartElement from "../../../../UI/Components/Charts/Area/AreaChart";
import BarChartElement from "../../../../UI/Components/Charts/Bar/BarChart";
import LineChartElement from "../../../../UI/Components/Charts/Line/LineChart";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import { TimeRangeZoomScope } from "../../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ChartCurve from "../../../../UI/Components/Charts/Types/ChartCurve";
import DataPoint from "../../../../UI/Components/Charts/Types/DataPoint";
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
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../../Types/Time/TimeRange";

const MINUTE_MS: number = 60 * 1000;
// One animation frame, as fake timers run them.
const FRAME_MS: number = 16;
// Every chart here draws one-minute buckets from 10:00 on.
const FIRST_BUCKET_MS: number = Date.parse("2026-09-28T10:00:00.000Z");
// Inside the plot: below its top edge and above the x-axis.
const PLOT_Y: number = 120;
// Somewhere on the page, well away from the chart.
const OFF_CHART: { clientX: number; clientY: number } = {
  clientX: 900,
  clientY: 520,
};

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

// The rows a chart draws: one-minute buckets from 10:00 on.
interface ChartRows {
  buckets: number;
  series: Array<SeriesPoint>;
  xAxis: ChartXAxis;
}

function rowsOf(buckets: number): ChartRows {
  const data: Array<DataPoint> = [];
  for (let index: number = 0; index < buckets; index++) {
    data.push({
      x: new Date(FIRST_BUCKET_MS + index * MINUTE_MS),
      y: 40 + index,
    });
  }

  return {
    buckets: buckets,
    series: [{ seriesName: "CPU", data: data }],
    xAxis: {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        min: new Date(FIRST_BUCKET_MS),
        max: new Date(FIRST_BUCKET_MS + buckets * MINUTE_MS),
        aggregateType: XAxisAggregateType.Average,
        precision: XAxisPrecision.EVERY_MINUTE,
      },
    },
  };
}

/*
 * Built once, so a page that re-renders hands its chart the same rows and
 * the chart redraws only when a test lands new ones.
 */
// A zoomed chart: 10:00 to 10:09.
const TEN_BUCKETS: ChartRows = rowsOf(10);
// The page before that zoom: 10:00 to 10:29.
const THIRTY_BUCKETS: ChartRows = rowsOf(30);

// The page range the rows cover.
function rangeOf(rows: ChartRows): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(
      new Date(FIRST_BUCKET_MS),
      new Date(FIRST_BUCKET_MS + rows.buckets * MINUTE_MS),
    ),
  };
}

const Y_AXIS: YAxis = {
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

let rendered: RenderResult | null = null;

function show(chart: React.ReactElement): void {
  rendered = render(chart);
}

function renderResult(): RenderResult {
  if (!rendered) {
    throw new Error("no chart rendered");
  }
  return rendered;
}

function chartContainer(): HTMLElement {
  return renderResult().container;
}

// The element recharts listens on: every event on the chart bubbles to it.
function chartWrapper(): Element {
  const wrapper: Element | null =
    chartContainer().querySelector(".recharts-wrapper");
  if (!wrapper) {
    throw new Error("recharts drew no chart");
  }
  return wrapper;
}

/*
 * The pointer x that lands on a bucket: where recharts drew its tick label,
 * the centre of the bucket on both kinds of axis. jsdom has no layout, so
 * the chart's box sits at 0,0 and a clientX is an x inside the chart.
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

function spotOf(label: string): { clientX: number; clientY: number } {
  return { clientX: tickX(label), clientY: PLOT_Y };
}

// "10:06" -> the instant that minute starts, as the handlers report it.
function at(label: string): string {
  return `2026-09-28T${label}:00.000Z`;
}

// "10:06" -> 6: the row, and the bar, that draws that minute.
function rowIndexOf(label: string): number {
  return (Date.parse(at(label)) - FIRST_BUCKET_MS) / MINUTE_MS;
}

function bars(): Array<Element> {
  return Array.from(
    chartContainer().querySelectorAll(".recharts-bar-rectangle path"),
  );
}

function isDimmed(bar: Element): boolean {
  return (
    bar.getAttribute("opacity") === "0.3" ||
    bar.getAttribute("fill-opacity") === "0.3"
  );
}

// Where the pointer is over a bucket: the element a press there lands on.
type PointerTarget = (label: string) => Element;

// The plot itself, off every line, area and bar.
const THE_PLOT: PointerTarget = (): Element => {
  return chartWrapper();
};

// The bar drawn for the bucket; bars are drawn in row order.
const THE_BAR: PointerTarget = (label: string): Element => {
  const bar: Element | undefined = bars()[rowIndexOf(label)];
  if (!bar) {
    throw new Error(`recharts drew no bar for "${label}"`);
  }
  return bar;
};

interface ChartUnderTest {
  name: string;
  kind: "line" | "area" | "bar";
  // Where its gestures land: see the note at the top of the file.
  target: PointerTarget;
  render: (rows: ChartRows, handlers: ChartHandlers) => React.ReactElement;
}

const LINE_CHART: ChartUnderTest = {
  name: "line",
  kind: "line",
  target: THE_PLOT,
  render: (rows: ChartRows, handlers: ChartHandlers): React.ReactElement => {
    return (
      <LineChartElement
        data={rows.series}
        xAxis={rows.xAxis}
        yAxis={Y_AXIS}
        curve={ChartCurve.LINEAR}
        heightInPx={300}
        showLegend={false}
        sync={false}
        syncid="reset-without-dblclick-line"
        onTimeRangeSelect={handlers.onTimeRangeSelect}
        onTimeRangeReset={handlers.onTimeRangeReset}
        onBucketClick={handlers.onBucketClick}
      />
    );
  },
};

const AREA_CHART: ChartUnderTest = {
  name: "area",
  kind: "area",
  target: THE_PLOT,
  render: (rows: ChartRows, handlers: ChartHandlers): React.ReactElement => {
    return (
      <AreaChartElement
        data={rows.series}
        xAxis={rows.xAxis}
        yAxis={Y_AXIS}
        curve={ChartCurve.LINEAR}
        heightInPx={300}
        showLegend={false}
        sync={false}
        syncid="reset-without-dblclick-area"
        onTimeRangeSelect={handlers.onTimeRangeSelect}
        onTimeRangeReset={handlers.onTimeRangeReset}
        onBucketClick={handlers.onBucketClick}
      />
    );
  },
};

const BAR_CHART: ChartUnderTest = {
  name: "bar",
  kind: "bar",
  target: THE_BAR,
  render: (rows: ChartRows, handlers: ChartHandlers): React.ReactElement => {
    return (
      <BarChartElement
        data={rows.series}
        xAxis={rows.xAxis}
        yAxis={Y_AXIS}
        heightInPx={300}
        showLegend={false}
        sync={false}
        syncid="reset-without-dblclick-bar"
        onTimeRangeSelect={handlers.onTimeRangeSelect}
        onTimeRangeReset={handlers.onTimeRangeReset}
      />
    );
  },
};

const CHARTS: Array<ChartUnderTest> = [LINE_CHART, AREA_CHART, BAR_CHART];

// Lets one animation frame pass: fake timers run the frame's callbacks.
function nextFrame(): void {
  act(() => {
    jest.advanceTimersByTime(FRAME_MS);
  });
}

/*
 * Lets the task the events arrived in end: whatever was set for 0ms runs,
 * nothing set for later does. In Chrome the dblclick, when it comes at all,
 * comes before this.
 */
function nextTask(): void {
  act(() => {
    jest.advanceTimersByTime(0);
  });
}

function waitOutTheDoubleClickWindow(): void {
  act(() => {
    jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
  });
}

// Well past every timer a gesture here sets.
function waitWellPastTheDoubleClickWindow(): void {
  act(() => {
    jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
  });
}

/*
 * The pointer comes to rest over a bucket. A chart that offers no drag
 * works out the bucket under the pointer a frame after it moves, so let
 * that frame pass, as a hand arriving there does.
 */
function restOn(label: string): void {
  fireEvent.mouseMove(chartWrapper(), { ...spotOf(label), buttons: 0 });
  nextFrame();
}

// The pointer moves over a bucket with the main button held.
function dragTo(label: string): void {
  fireEvent.mouseMove(chartWrapper(), { ...spotOf(label), buttons: 1 });
}

// clickCount is MouseEvent.detail: 2 on both halves of the second click.
function press(target: PointerTarget, label: string, clickCount: number): void {
  fireEvent.mouseDown(target(label), {
    ...spotOf(label),
    button: 0,
    buttons: 1,
    detail: clickCount,
  });
}

function release(
  target: PointerTarget,
  label: string,
  clickCount: number,
): void {
  fireEvent.mouseUp(target(label), {
    ...spotOf(label),
    button: 0,
    buttons: 0,
    detail: clickCount,
  });
}

function click(target: PointerTarget, label: string, clickCount: number): void {
  fireEvent.click(target(label), {
    ...spotOf(label),
    button: 0,
    detail: clickCount,
  });
}

function doubleClick(target: PointerTarget, label: string): void {
  fireEvent.doubleClick(target(label), {
    ...spotOf(label),
    button: 0,
    detail: 2,
  });
}

// All Chrome delivers for the first click of a double-click.
function firstClickOf(target: PointerTarget, label: string): void {
  press(target, label, 1);
  release(target, label, 1);
  click(target, label, 1);
}

/*
 * The second click of a double-click whose node left the page during its
 * press: Chrome delivers the press and the release, counted (detail 2), and
 * neither its click nor the dblclick.
 */
function secondPressAndReleaseOf(target: PointerTarget, label: string): void {
  press(target, label, 2);
  release(target, label, 2);
}

/*
 * The pointer leaves the chart with the button held and lets go on the
 * page: only the page hears that release, and the click and the dblclick
 * that follow it go to the page too.
 */
function releaseOnThePage(clickCount: number): void {
  fireEvent.mouseLeave(chartWrapper(), {
    relatedTarget: document.body,
    ...OFF_CHART,
    buttons: 1,
  });
  fireEvent.mouseMove(document.body, { ...OFF_CHART, buttons: 1 });
  fireEvent.mouseUp(document.body, {
    ...OFF_CHART,
    button: 0,
    buttons: 0,
    detail: clickCount,
  });
}

// The live drag-selection band recharts drew, if any.
function drawnBand(): Element | null {
  return chartContainer().querySelector(".recharts-reference-area-rect");
}

// Every bucket a chart reported a click on, oldest first.
function bucketClicks(onBucketClick: MockFunction): Array<[string, string]> {
  return onBucketClick.mock.calls.map(
    (call: Array<unknown>): [string, string] => {
      return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
    },
  );
}

// The one-minute bucket that starts at the label.
function bucketAt(label: string): [string, string] {
  const start: number = Date.parse(at(label));
  return [
    new Date(start).toISOString(),
    new Date(start + MINUTE_MS).toISOString(),
  ];
}

/*
 * How many plot clicks on the bucket at `label` have acted. A line or an
 * area chart reports each one as a bucket click. On the bar chart a click
 * on a bar highlights it (dimming every other bar) and a second one clears
 * that again, so there only an odd or an even count shows.
 */
function expectClicksActed(
  chart: ChartUnderTest,
  onBucketClick: MockFunction,
  label: string,
  count: number,
): void {
  if (chart.kind !== "bar") {
    const expected: Array<[string, string]> = [];
    for (let index: number = 0; index < count; index++) {
      expected.push(bucketAt(label));
    }
    expect(bucketClicks(onBucketClick)).toEqual(expected);
    return;
  }

  const dimmed: number = bars().filter(isDimmed).length;
  if (count % 2 === 0) {
    expect(dimmed).toBe(0);
    return;
  }
  expect(bars().length).toBeGreaterThan(5);
  expect(dimmed).toBe(bars().length - 1);
  expect(isDimmed(THE_BAR(label))).toBe(false);
}

// Every range a page was set to, oldest first.
function pageRanges(onTimeRangeChange: MockFunction): Array<[string, string]> {
  return onTimeRangeChange.mock.calls.map(
    (call: Array<unknown>): [string, string] => {
      const range: RangeStartAndEndDateTime =
        call[0] as RangeStartAndEndDateTime;
      return [
        range.startAndEndDate!.startValue.toISOString(),
        range.startAndEndDate!.endValue.toISOString(),
      ];
    },
  );
}

// "10:02", "10:06" -> the page range [10:02, 10:06).
function pageRange(from: string, to: string): [string, string] {
  return [at(from), at(to)];
}

interface ZoomablePageProps {
  chart: ChartUnderTest;
  // The page's range before any zoom.
  range: RangeStartAndEndDateTime;
  /*
   * The rows the page's latest fetch returned. A page refetches when its
   * range changes, so these lag its range until the test lands them.
   */
  rows: ChartRows;
  onBucketClick?: BucketClickHandler | undefined;
  // Called with every range the page is set to.
  onTimeRangeChange: (timeRange: RangeStartAndEndDateTime) => void;
}

/*
 * A page shaped like the explorers and the overviews: it owns its range,
 * offers every chart below a zoom over it (TimeRangeZoomScope), and hands
 * its chart no zoom handler of its own.
 */
const ZoomablePage: React.FunctionComponent<ZoomablePageProps> = (
  props: ZoomablePageProps,
): React.ReactElement => {
  const [timeRange, setTimeRange] = React.useState<RangeStartAndEndDateTime>(
    props.range,
  );

  return (
    <TimeRangeZoomScope
      timeRange={timeRange}
      onTimeRangeChange={(next: RangeStartAndEndDateTime): void => {
        props.onTimeRangeChange(next);
        setTimeRange(next);
      }}
    >
      {props.chart.render(props.rows, { onBucketClick: props.onBucketClick })}
    </TimeRangeZoomScope>
  );
};

interface Spies {
  onTimeRangeSelect: MockFunction;
  onTimeRangeReset: MockFunction;
  onBucketClick: MockFunction;
}

function newSpies(): Spies {
  return {
    onTimeRangeSelect: getJestMockFunction(),
    onTimeRangeReset: getJestMockFunction(),
    onBucketClick: getJestMockFunction(),
  };
}

// What a zoomed chart is offered: always the reset.
interface ResetOffer {
  name: string;
  // Whether a drag can zoom it further too.
  canDrag: boolean;
}

const ZOOMED_WITH_DRAG: ResetOffer = {
  name: "zoomed, where a drag can zoom it further",
  canDrag: true,
};

/*
 * A host that resets but does not zoom: a chart that cannot start a zoom
 * must still end one, such as the zoom another chart on the page made.
 */
const ZOOMED_RESET_ONLY: ResetOffer = {
  name: "with only a reset on offer",
  canDrag: false,
};

const RESET_OFFERS: Array<ResetOffer> = [ZOOMED_WITH_DRAG, ZOOMED_RESET_ONLY];

function handlersFor(offer: ResetOffer, spies: Spies): ChartHandlers {
  return {
    onTimeRangeSelect: offer.canDrag ? spies.onTimeRangeSelect : undefined,
    onTimeRangeReset: spies.onTimeRangeReset,
    onBucketClick: spies.onBucketClick,
  };
}

beforeEach(() => {
  /*
   * Installed AT the fixed time rather than moved there with setSystemTime:
   * fake timers count animation frames from the moment they are installed.
   */
  jest.useFakeTimers({ now: new Date("2026-09-28T10:45:00.000Z") });
});

afterEach(() => {
  cleanup();
  rendered = null;
  jest.useRealTimers();
});

for (const chart of CHARTS) {
  describe(`the ${chart.name} chart, through real recharts`, () => {
    for (const offer of RESET_OFFERS) {
      describe(offer.name, () => {
        test("a double-click whose dblclick never arrives resets once, on the next task, and its first click never acts", () => {
          const spies: Spies = newSpies();
          show(chart.render(TEN_BUCKETS, handlersFor(offer, spies)));

          restOn("10:04");
          firstClickOf(chart.target, "10:04");
          secondPressAndReleaseOf(chart.target, "10:04");

          // Not during the release: a dblclick may still be on its way.
          expect(spies.onTimeRangeReset).not.toHaveBeenCalled();
          nextTask();
          expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);

          waitWellPastTheDoubleClickWindow();
          expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);
          // The click it held back for the double-click window is dropped.
          expectClicksActed(chart, spies.onBucketClick, "10:04", 0);
          expect(spies.onTimeRangeSelect).not.toHaveBeenCalled();
          expect(drawnBand()).toBeNull();
        });

        test("a double-click whose second click arrives but its dblclick does not resets once, and neither click acts", () => {
          const spies: Spies = newSpies();
          show(chart.render(TEN_BUCKETS, handlersFor(offer, spies)));

          restOn("10:04");
          firstClickOf(chart.target, "10:04");
          secondPressAndReleaseOf(chart.target, "10:04");
          click(chart.target, "10:04", 2);
          expect(spies.onTimeRangeReset).not.toHaveBeenCalled();

          nextTask();
          expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);

          waitWellPastTheDoubleClickWindow();
          expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);
          expectClicksActed(chart, spies.onBucketClick, "10:04", 0);
          expect(spies.onTimeRangeSelect).not.toHaveBeenCalled();
        });

        test("a double-click that keeps its dblclick resets exactly once, from the dblclick, and neither click acts", () => {
          const spies: Spies = newSpies();
          show(chart.render(TEN_BUCKETS, handlersFor(offer, spies)));

          restOn("10:04");
          firstClickOf(chart.target, "10:04");
          secondPressAndReleaseOf(chart.target, "10:04");
          click(chart.target, "10:04", 2);
          expect(spies.onTimeRangeReset).not.toHaveBeenCalled();

          doubleClick(chart.target, "10:04");
          expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);

          // The reset the release armed was stood down: no second one.
          nextTask();
          waitWellPastTheDoubleClickWindow();
          expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);
          expectClicksActed(chart, spies.onBucketClick, "10:04", 0);
          expect(spies.onTimeRangeSelect).not.toHaveBeenCalled();
          expect(drawnBand()).toBeNull();
        });

        test("a double-click whose second release lands off the chart resets once, on the next task", () => {
          const spies: Spies = newSpies();
          show(chart.render(TEN_BUCKETS, handlersFor(offer, spies)));

          restOn("10:04");
          firstClickOf(chart.target, "10:04");
          press(chart.target, "10:04", 2);
          // The chart hears no release, no click and no dblclick.
          releaseOnThePage(2);
          expect(spies.onTimeRangeReset).not.toHaveBeenCalled();

          nextTask();
          expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);

          waitWellPastTheDoubleClickWindow();
          expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);
          expectClicksActed(chart, spies.onBucketClick, "10:04", 0);
          expect(spies.onTimeRangeSelect).not.toHaveBeenCalled();
          expect(drawnBand()).toBeNull();
        });

        test("a single click still acts, once the double-click window has passed, and resets nothing", () => {
          const spies: Spies = newSpies();
          show(chart.render(TEN_BUCKETS, handlersFor(offer, spies)));

          restOn("10:04");
          firstClickOf(chart.target, "10:04");
          nextTask();
          // Held open: a second click may be coming.
          expectClicksActed(chart, spies.onBucketClick, "10:04", 0);

          waitOutTheDoubleClickWindow();
          expectClicksActed(chart, spies.onBucketClick, "10:04", 1);
          if (chart.kind !== "bar") {
            expect(spies.onBucketClick.mock.calls[0]![2]).toMatchObject({
              CPU: 44,
            });
          }

          waitWellPastTheDoubleClickWindow();
          expectClicksActed(chart, spies.onBucketClick, "10:04", 1);
          expect(spies.onTimeRangeReset).not.toHaveBeenCalled();
          expect(spies.onTimeRangeSelect).not.toHaveBeenCalled();
        });

        if (!offer.canDrag) {
          test("it offers no drag: the plot keeps recharts' own cursor, not the crosshair", () => {
            show(chart.render(TEN_BUCKETS, handlersFor(offer, newSpies())));

            expect(chartWrapper()).toHaveStyle({ cursor: "default" });
          });
        }
      });
    }

    describe("with nothing to reset: on a page that offers a zoom, before any zoom", () => {
      function showPage(
        onTimeRangeChange: MockFunction,
        onBucketClick: MockFunction,
      ): void {
        show(
          <ZoomablePage
            chart={chart}
            range={rangeOf(TEN_BUCKETS)}
            rows={TEN_BUCKETS}
            onBucketClick={onBucketClick}
            onTimeRangeChange={onTimeRangeChange}
          />,
        );
      }

      test("a double-click is two clicks that each act at once, and the page's range stays put", () => {
        const onTimeRangeChange: MockFunction = getJestMockFunction();
        const onBucketClick: MockFunction = getJestMockFunction();
        showPage(onTimeRangeChange, onBucketClick);

        restOn("10:04");
        firstClickOf(chart.target, "10:04");
        expectClicksActed(chart, onBucketClick, "10:04", 1);

        secondPressAndReleaseOf(chart.target, "10:04");
        click(chart.target, "10:04", 2);
        expectClicksActed(chart, onBucketClick, "10:04", 2);

        doubleClick(chart.target, "10:04");
        nextTask();
        waitWellPastTheDoubleClickWindow();

        expectClicksActed(chart, onBucketClick, "10:04", 2);
        expect(onTimeRangeChange).not.toHaveBeenCalled();
        expect(drawnBand()).toBeNull();
      });

      test("a double-click whose dblclick never arrives: its first click acted at once, and its second press does nothing", () => {
        const onTimeRangeChange: MockFunction = getJestMockFunction();
        const onBucketClick: MockFunction = getJestMockFunction();
        showPage(onTimeRangeChange, onBucketClick);

        restOn("10:04");
        firstClickOf(chart.target, "10:04");
        expectClicksActed(chart, onBucketClick, "10:04", 1);

        secondPressAndReleaseOf(chart.target, "10:04");
        nextTask();
        waitWellPastTheDoubleClickWindow();

        expectClicksActed(chart, onBucketClick, "10:04", 1);
        expect(onTimeRangeChange).not.toHaveBeenCalled();
        expect(drawnBand()).toBeNull();
      });

      test("the second press of a double-click is an ordinary press: dragged across the plot, it zooms the page", () => {
        const onTimeRangeChange: MockFunction = getJestMockFunction();
        showPage(onTimeRangeChange, getJestMockFunction());

        restOn("10:02");
        firstClickOf(chart.target, "10:02");
        press(chart.target, "10:02", 2);
        dragTo("10:05");
        release(chart.target, "10:05", 2);

        expect(pageRanges(onTimeRangeChange)).toEqual([
          pageRange("10:02", "10:06"),
        ]);
      });
    });

    describe("when new rows land during the double-click's second press", () => {
      test("the double-click still resets, once, on the next task: nothing is selected and neither click acts", () => {
        const spies: Spies = newSpies();
        const handlers: ChartHandlers = handlersFor(ZOOMED_WITH_DRAG, spies);
        show(chart.render(THIRTY_BUCKETS, handlers));

        restOn("10:06");
        firstClickOf(chart.target, "10:06");
        const pressedAt: { clientX: number; clientY: number } = spotOf("10:06");
        press(chart.target, "10:06", 2);
        // The refetch lands: ten buckets now, drawn across the same pixels.
        renderResult().rerender(chart.render(TEN_BUCKETS, handlers));
        /*
         * The button comes up where it went down, over whatever the new
         * rows drew there. The node the press landed on is gone, so Chrome
         * sends no click and no dblclick.
         */
        fireEvent.mouseUp(chartWrapper(), {
          ...pressedAt,
          button: 0,
          buttons: 0,
          detail: 2,
        });

        expect(spies.onTimeRangeReset).not.toHaveBeenCalled();
        nextTask();
        expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);

        waitWellPastTheDoubleClickWindow();
        expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);
        expect(spies.onTimeRangeSelect).not.toHaveBeenCalled();
        expect(drawnBand()).toBeNull();
        expectClicksActed(chart, spies.onBucketClick, "10:06", 0);
      });

      /*
       * A hand is never perfectly still. Once the new rows are in, a
       * one-pixel twitch has recharts work out the bucket under the pointer
       * from them: 10:02, not the 10:06 pressed. Read as a drag, the press
       * would zoom to a window running from a bucket of the old rows to one
       * of the new - the bogus zoom of #4116.
       */
      test("a twitch of the pointer after they land makes no drag from an old bucket to a new one, and the double-click still resets once", () => {
        const spies: Spies = newSpies();
        const handlers: ChartHandlers = handlersFor(ZOOMED_WITH_DRAG, spies);
        show(chart.render(THIRTY_BUCKETS, handlers));

        restOn("10:06");
        firstClickOf(chart.target, "10:06");
        const twitchedTo: { clientX: number; clientY: number } = {
          clientX: tickX("10:06") + 1,
          clientY: PLOT_Y,
        };
        press(chart.target, "10:06", 2);
        renderResult().rerender(chart.render(TEN_BUCKETS, handlers));
        fireEvent.mouseMove(chartWrapper(), { ...twitchedTo, buttons: 1 });
        expect(drawnBand()).toBeNull();
        fireEvent.mouseUp(chartWrapper(), {
          ...twitchedTo,
          button: 0,
          buttons: 0,
          detail: 2,
        });

        nextTask();
        expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);

        waitWellPastTheDoubleClickWindow();
        expect(spies.onTimeRangeReset).toHaveBeenCalledTimes(1);
        expect(spies.onTimeRangeSelect).not.toHaveBeenCalled();
        expect(drawnBand()).toBeNull();
        expectClicksActed(chart, spies.onBucketClick, "10:06", 0);
      });

      /*
       * The report itself: a drag zooms the page, and the reader
       * double-clicks straight away to undo it, while the page is still
       * fetching the zoomed window. Its rows land during the second press.
       */
      test("on a page zoomed a moment before, a double-click whose second press sees the zoomed rows land puts the page back where it was", () => {
        const onTimeRangeChange: MockFunction = getJestMockFunction();
        // What the page fetches for the zoom: 10:00 to 10:08.
        const zoomedRows: ChartRows = rowsOf(9);
        const page: (rows: ChartRows) => React.ReactElement = (
          rows: ChartRows,
        ): React.ReactElement => {
          return (
            <ZoomablePage
              chart={chart}
              range={rangeOf(THIRTY_BUCKETS)}
              rows={rows}
              onTimeRangeChange={onTimeRangeChange}
            />
          );
        };
        show(page(THIRTY_BUCKETS));

        /*
         * A drag across 10:00 to 10:08 zooms the page to those nine
         * minutes. (Thirty buckets leave room to label every other one.)
         */
        restOn("10:00");
        press(chart.target, "10:00", 1);
        dragTo("10:04");
        dragTo("10:08");
        release(chart.target, "10:08", 1);
        // The browser's click after a drag goes to what both ends share.
        fireEvent.click(chartWrapper(), {
          ...spotOf("10:08"),
          button: 0,
          detail: 1,
        });
        expect(pageRanges(onTimeRangeChange)).toEqual([
          pageRange("10:00", "10:09"),
        ]);

        // The zoomed rows are still on their way when the reader double-clicks.
        act(() => {
          jest.advanceTimersByTime(400);
        });
        restOn("10:06");
        firstClickOf(chart.target, "10:06");
        const pressedAt: { clientX: number; clientY: number } = spotOf("10:06");
        press(chart.target, "10:06", 2);
        renderResult().rerender(page(zoomedRows));
        fireEvent.mouseUp(chartWrapper(), {
          ...pressedAt,
          button: 0,
          buttons: 0,
          detail: 2,
        });
        nextTask();

        // Back on 10:00 to 10:30, and zoomed nowhere else on the way.
        expect(pageRanges(onTimeRangeChange)).toEqual([
          pageRange("10:00", "10:09"),
          pageRange("10:00", "10:30"),
        ]);
        waitWellPastTheDoubleClickWindow();
        expect(onTimeRangeChange).toHaveBeenCalledTimes(2);
        expect(drawnBand()).toBeNull();
      });
    });
  });
}

/*
 * A bar chart handed only a reset cannot drag, and before this fix nothing
 * on it saw a press at all: only the dblclick reset it. A double-click on
 * its bare plot - between or above the bars - must end the zoom as surely
 * as one on a bar.
 */
describe("the bar chart with only a reset on offer, double-clicked on its bare plot", () => {
  test("a double-click whose dblclick never arrives still resets it, once, on the next task", () => {
    const onTimeRangeReset: MockFunction = getJestMockFunction();
    show(BAR_CHART.render(TEN_BUCKETS, { onTimeRangeReset: onTimeRangeReset }));
    expect(chartWrapper()).toHaveStyle({ cursor: "default" });

    restOn("10:04");
    firstClickOf(THE_PLOT, "10:04");
    secondPressAndReleaseOf(THE_PLOT, "10:04");
    expect(onTimeRangeReset).not.toHaveBeenCalled();

    nextTask();
    expect(onTimeRangeReset).toHaveBeenCalledTimes(1);

    waitWellPastTheDoubleClickWindow();
    expect(onTimeRangeReset).toHaveBeenCalledTimes(1);
    expect(bars().filter(isDimmed)).toHaveLength(0);
  });

  test("a double-click that keeps its dblclick resets it exactly once", () => {
    const onTimeRangeReset: MockFunction = getJestMockFunction();
    show(BAR_CHART.render(TEN_BUCKETS, { onTimeRangeReset: onTimeRangeReset }));

    restOn("10:04");
    firstClickOf(THE_PLOT, "10:04");
    secondPressAndReleaseOf(THE_PLOT, "10:04");
    click(THE_PLOT, "10:04", 2);
    doubleClick(THE_PLOT, "10:04");
    expect(onTimeRangeReset).toHaveBeenCalledTimes(1);

    nextTask();
    waitWellPastTheDoubleClickWindow();
    expect(onTimeRangeReset).toHaveBeenCalledTimes(1);
  });
});
