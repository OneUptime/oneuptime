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
 * Double-click to undo a zoom on the raw recharts histograms - the
 * telemetry histogram of the traces, exceptions and security explorers,
 * and the logs histogram - when the chart's new bars land in the middle of
 * the double-click (issue #4116). Driven through REAL recharts and the real
 * useHistogramRangeSelection, as HistogramRangeSelectionRealRecharts.test.tsx
 * does: only ResponsiveContainer is stood in for.
 *
 * Right after a drag zooms an explorer, the explorer refetches, and that is
 * exactly when a reader double-clicks to undo the zoom. New bars landing
 * during the double-click's second press take the node that press went
 * down on off the page: recharts re-keys every bar, and drops the band the
 * first click painted. Chrome sends no click and no dblclick for such a
 * press, so the chart never heard the double-click and stayed zoomed.
 * Worse, the hook read the release - whose bar recharts now takes from the
 * NEW bars, at the same place - as a drag from an old bar to a new one, and
 * zoomed into a window spanning both. New bars landing during the FIRST
 * press zoomed the same bogus way.
 *
 * Each case fires what Chrome delivers, and reads the page to show why:
 * after the release of a press whose node the new bars took away, nothing;
 * after one whose node stayed, the click and the dblclick, to that node.
 * (One case has a browser send the lost pair anyway.) The second press of
 * a double-click (MouseEvent.detail 2, the browser's own count) is now the
 * zoom-out whatever becomes of its node, so the chart zooms out exactly
 * once either way - by the next task at the latest - and neither press
 * zooms in.
 *
 * On an unzoomed chart, the clamp case of commit b6ec899df4: a still press
 * on a bar right of where a shorter refetch ends. recharts keeps the index
 * the pointer last hovered and clamps it onto the new last bar, so the
 * release reports another index as well as another bar - what a hand's
 * drift across a bar's edge reports - and the chart zoomed into the bar it
 * pressed, which the refetch had left out. It must zoom nowhere, while a
 * real drift of a few pixels is still a click on the bar pressed. The
 * tests listen in on what recharts hands the hook (listenInOnTheHook), so
 * the clamp is shown at work rather than assumed.
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

import LogsHistogram from "../../../../UI/Components/LogsViewer/components/LogsHistogram";
import { HistogramBucket as LogsHistogramBucket } from "../../../../UI/Components/LogsViewer/types";
import TelemetryHistogram from "../../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";
import { HistogramBucket as TelemetryHistogramBucket } from "../../../../UI/Components/TelemetryViewer/types";
import {
  ChartPointerEvent,
  DOUBLE_CLICK_DISAMBIGUATION_MS,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import * as HistogramRangeSelection from "../../../../UI/Components/Charts/Utils/useHistogramRangeSelection";

const MINUTE_MS: number = 60 * 1000;
// One animation frame, as fake timers run them.
const FRAME_MS: number = 16;
/*
 * Low in the plot, inside every bar pressed below, so a press there goes
 * down on a bar (recharts paints the bars over the selection band).
 */
const POINTER_Y: number = 250;

interface Bar {
  time: string;
  count: number;
}

// `count` one-minute bars from `from`, each as tall as `height` says.
function minuteBars(
  from: string,
  count: number,
  height: (index: number) => number,
): Array<Bar> {
  const fromMs: number = Date.parse(from);
  return Array.from({ length: count }, (_: unknown, index: number): Bar => {
    return {
      time: new Date(fromMs + index * MINUTE_MS).toISOString(),
      count: height(index),
    };
  });
}

// What the zoomed chart shows as the reader double-clicks: 10:00 to 10:09.
const SHOWN_BARS: Array<Bar> = minuteBars(
  "2026-09-28T10:00:00.000Z",
  10,
  (index: number): number => {
    return 5 + index;
  },
);

/*
 * The explorer's refetch, landing in the middle of the double-click: a
 * later hour's bars, 11:00 to 11:09, of other heights.
 */
const REFETCHED_BARS: Array<Bar> = minuteBars(
  "2026-09-28T11:00:00.000Z",
  10,
  (index: number): number => {
    return 40 + 3 * index;
  },
);

/*
 * The hour the reader zoomed in from, 09:30 to 10:29, which the zoom-out
 * goes back to: it has the clicked bar, 10:04, in it again.
 */
const ZOOMED_FROM_BARS: Array<Bar> = minuteBars(
  "2026-09-28T09:30:00.000Z",
  60,
  (index: number): number => {
    return 3 + (index % 7);
  },
);

type SelectHandler = (startTime: Date, endTime: Date) => void;

interface HistogramProps {
  bars: Array<Bar>;
  onTimeRangeSelect: SelectHandler;
  // Set only while the chart shows a window dragged out of it.
  onZoomOut?: (() => void) | undefined;
}

// What a host may hand the chart anew along with its next bars.
type HostHandlers = Partial<Pick<HistogramProps, "onZoomOut">>;

interface HistogramUnderTest {
  name: string;
  render: (props: HistogramProps) => React.ReactElement;
}

const HISTOGRAMS: Array<HistogramUnderTest> = [
  {
    name: "telemetry",
    render: (props: HistogramProps): React.ReactElement => {
      return (
        <TelemetryHistogram
          buckets={props.bars.map((bar: Bar): TelemetryHistogramBucket => {
            return { time: bar.time, series: "error", count: bar.count };
          })}
          isLoading={false}
          series={[{ key: "error", label: "Error", color: "#dc2626" }]}
          onTimeRangeSelect={props.onTimeRangeSelect}
          onZoomOut={props.onZoomOut}
          bucketIntervalMs={MINUTE_MS}
        />
      );
    },
  },
  {
    name: "logs",
    render: (props: HistogramProps): React.ReactElement => {
      return (
        <LogsHistogram
          buckets={props.bars.map((bar: Bar): LogsHistogramBucket => {
            return { time: bar.time, severity: "Error", count: bar.count };
          })}
          isLoading={false}
          onTimeRangeSelect={props.onTimeRangeSelect}
          onZoomOut={props.onZoomOut}
          bucketIntervalMs={MINUTE_MS}
        />
      );
    },
  },
];

interface ChartOnScreen {
  histogram: HistogramUnderTest;
  props: HistogramProps;
  rendered: RenderResult;
}

let onScreen: ChartOnScreen | null = null;

function showChart(histogram: HistogramUnderTest, props: HistogramProps): void {
  onScreen = {
    histogram: histogram,
    props: props,
    rendered: render(histogram.render(props)),
  };
}

function chartOnScreen(): ChartOnScreen {
  if (!onScreen) {
    throw new Error("no histogram rendered");
  }
  return onScreen;
}

/*
 * New bars land: the host re-renders the same chart with them, and with
 * whatever handlers it holds by then.
 */
function landBars(bars: Array<Bar>, handlers: HostHandlers = {}): void {
  const chart: ChartOnScreen = chartOnScreen();
  chart.props = { ...chart.props, ...handlers, bars: bars };
  chart.rendered.rerender(chart.histogram.render(chart.props));
}

function chartContainer(): HTMLElement {
  return chartOnScreen().rendered.container;
}

// The chart root, where recharts listens for the pointer.
function chartWrapper(): Element {
  const wrapper: Element | null =
    chartContainer().querySelector(".recharts-wrapper");
  if (!wrapper) {
    throw new Error("recharts drew no chart");
  }
  return wrapper;
}

// The box around the plot, which holds the chart's dblclick handler.
function chartBox(): Element {
  const box: Element | null = chartWrapper().parentElement;
  if (!box) {
    throw new Error("the chart has no box around it");
  }
  return box;
}

/*
 * The x of a bar: the centre of its tick label. The labels are local times
 * ("10:04 AM", or "10:04" on a 24-hour clock).
 */
function tickX(label: string): number {
  const tick: Element | undefined = Array.from(
    chartContainer().querySelectorAll(
      ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value",
    ),
  ).find((element: Element): boolean => {
    return (element.textContent || "").startsWith(label);
  });
  if (!tick) {
    throw new Error(`recharts drew no tick label "${label}"`);
  }
  return Number(tick.getAttribute("x"));
}

interface PointerSpot {
  clientX: number;
  clientY: number;
}

// Where the pointer stays for a whole double-click: on the bar `label`.
function spotOnBar(label: string): PointerSpot {
  return { clientX: tickX(label), clientY: POINTER_Y };
}

// Every bar recharts drew, as nodes on the page.
function drawnBars(): Array<Element> {
  return Array.from(
    chartContainer().querySelectorAll(
      ".recharts-bar-rectangle path.recharts-rectangle",
    ),
  );
}

// The selection band, as a node on the page, while one is drawn.
function drawnBand(): Element | null {
  return chartContainer().querySelector(".recharts-reference-area-rect");
}

function covers(node: Element, spot: PointerSpot): boolean {
  const left: number = Number(node.getAttribute("x"));
  const top: number = Number(node.getAttribute("y"));
  const width: number = Number(node.getAttribute("width"));
  const height: number = Number(node.getAttribute("height"));
  return (
    spot.clientX >= left &&
    spot.clientX <= left + width &&
    spot.clientY >= top &&
    spot.clientY <= top + height
  );
}

// The bar at `spot`: the node a press there goes down on.
function barAt(spot: PointerSpot): Element {
  const bar: Element | undefined = drawnBars().find(
    (node: Element): boolean => {
      return covers(node, spot);
    },
  );
  if (!bar) {
    throw new Error(
      `recharts drew no bar at (${spot.clientX}, ${spot.clientY})`,
    );
  }
  return bar;
}

// Everything drawn at `spot`: its bar, and the band behind it, if any.
function nodesAt(spot: PointerSpot): Array<Element> {
  const band: Element | null = drawnBand();
  if (band && covers(band, spot)) {
    return [barAt(spot), band];
  }
  return [barAt(spot)];
}

function stillOnThePage(nodes: Array<Element>): Array<Element> {
  return nodes.filter((node: Element): boolean => {
    return node.isConnected;
  });
}

/*
 * The explorer's refetch lands while a press is held at `spot`, and takes
 * what the press went down on off the page - recharts re-keys every bar
 * for the new ones, and a band whose bar is gone is not drawn - while the
 * chart root the release reaches stays. That is what makes Chrome send the
 * press no click and no dblclick.
 */
function landBarsUnderThePress(
  spot: PointerSpot,
  bars: Array<Bar>,
  handlers: HostHandlers = {},
): void {
  const pressedNodes: Array<Element> = nodesAt(spot);
  const barsBefore: Array<Element> = drawnBars();
  const wrapperBefore: Element = chartWrapper();

  landBars(bars, handlers);

  expect(stillOnThePage(pressedNodes)).toEqual([]);
  expect(stillOnThePage(barsBefore)).toEqual([]);
  expect(chartWrapper()).toBe(wrapperBefore);
  // A new bar is under the pointer now.
  expect(pressedNodes).not.toContain(barAt(spot));
}

// The pointer comes to rest at `spot`.
function restAt(spot: PointerSpot): void {
  fireEvent.mouseMove(chartWrapper(), { ...spot, buttons: 0 });
  nextFrame();
}

/*
 * The main button goes down at `spot`. `clickCount` is the browser's own
 * count (MouseEvent.detail): 2 for the second press of a double-click.
 */
function press(spot: PointerSpot, clickCount: number): void {
  fireEvent.mouseDown(chartWrapper(), {
    ...spot,
    button: 0,
    buttons: 1,
    detail: clickCount,
  });
}

function release(spot: PointerSpot, clickCount: number): void {
  fireEvent.mouseUp(chartWrapper(), {
    ...spot,
    button: 0,
    buttons: 0,
    detail: clickCount,
  });
}

// The click the browser sends after a release, to `target`.
function browserClick(
  target: Element,
  spot: PointerSpot,
  clickCount: number,
): void {
  fireEvent.click(target, { ...spot, button: 0, detail: clickCount });
}

// The dblclick the browser sends straight after a second click.
function browserDoubleClick(target: Element, spot: PointerSpot): void {
  fireEvent.doubleClick(target, { ...spot, button: 0, detail: 2 });
}

/*
 * The first click of a double-click, with nothing landing under it: its
 * bar stays on the page, so the browser sends that bar the click.
 */
function firstClick(spot: PointerSpot): void {
  const pressedBar: Element = barAt(spot);
  press(spot, 1);
  release(spot, 1);
  expect(pressedBar.isConnected).toBe(true);
  browserClick(pressedBar, spot, 1);
}

/*
 * The second click of a double-click, with nothing landing under it: its
 * bar stays on the page, so the browser sends that bar the click and the
 * dblclick.
 */
function quietSecondClick(spot: PointerSpot): void {
  const pressedBar: Element = barAt(spot);
  press(spot, 2);
  release(spot, 2);
  expect(pressedBar.isConnected).toBe(true);
  browserClick(pressedBar, spot, 2);
  browserDoubleClick(pressedBar, spot);
}

// One animation frame passes: fake timers run the frame's callbacks.
function nextFrame(): void {
  act(() => {
    jest.advanceTimersByTime(FRAME_MS);
  });
}

// The browser moves on to the next task: a timeout set for 0ms runs.
function nextTask(): void {
  act(() => {
    jest.advanceTimersByTime(0);
  });
}

// Long past the double-click window: a click still waiting to zoom in has.
function waitOutTheDoubleClickWindow(): void {
  act(() => {
    jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
  });
}

// Every zoom-in asked for, as [start, end] instants.
function selections(onTimeRangeSelect: MockFunction): Array<[string, string]> {
  return onTimeRangeSelect.mock.calls.map(
    (call: Array<unknown>): [string, string] => {
      return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
    },
  );
}

type ChartRootHandlerName = "onMouseDown" | "onMouseMove" | "onMouseUp";

// What recharts handed one of the histogram's chart-root handlers.
interface HandedToTheHook {
  handler: ChartRootHandlerName;
  activeTooltipIndex: string | number | null | undefined;
  activeLabel: string | number | undefined;
  clientX: number | undefined;
  detail: number | undefined;
}

/*
 * Listens in on what recharts hands the histogram: the host still renders
 * the real useHistogramRangeSelection, whose chart-root handlers are
 * wrapped to note the chart state and the event before passing both on
 * untouched. Installed before the chart renders; afterEach restores it.
 */
function listenInOnTheHook(): Array<HandedToTheHook> {
  const handed: Array<HandedToTheHook> = [];
  const realHook: HistogramRangeSelection.UseHistogramRangeSelectionFunction =
    HistogramRangeSelection.default;

  type ChartRootHandler =
    HistogramRangeSelection.HistogramRangeSelectionState[ChartRootHandlerName];

  const noting: (
    name: ChartRootHandlerName,
    handler: ChartRootHandler,
  ) => ChartRootHandler = (
    name: ChartRootHandlerName,
    handler: ChartRootHandler,
  ): ChartRootHandler => {
    return (
      state?: HistogramRangeSelection.HistogramPointerState | null,
      event?: ChartPointerEvent | null,
    ): void => {
      handed.push({
        handler: name,
        activeTooltipIndex: state?.activeTooltipIndex,
        activeLabel: state?.activeLabel,
        clientX: event?.clientX,
        detail: event?.detail,
      });
      handler(state, event);
    };
  };

  jest
    .spyOn(HistogramRangeSelection, "default")
    .mockImplementation(
      (
        options: HistogramRangeSelection.HistogramRangeSelectionOptions,
      ): HistogramRangeSelection.HistogramRangeSelectionState => {
        const selection: HistogramRangeSelection.HistogramRangeSelectionState =
          realHook(options);
        return {
          ...selection,
          onMouseDown: noting("onMouseDown", selection.onMouseDown),
          onMouseMove: noting("onMouseMove", selection.onMouseMove),
          onMouseUp: noting("onMouseUp", selection.onMouseUp),
        };
      },
    );

  return handed;
}

// What the named handler was handed last.
function lastHanded(
  handed: Array<HandedToTheHook>,
  handler: ChartRootHandlerName,
): HandedToTheHook {
  const last: HandedToTheHook | undefined = handed
    .filter((entry: HandedToTheHook): boolean => {
      return entry.handler === handler;
    })
    .pop();
  if (!last) {
    throw new Error(`recharts handed ${handler} nothing`);
  }
  return last;
}

// The index of the drawn bar whose width spans `clientX`, or -1.
function barIndexAtX(clientX: number): number {
  return drawnBars().findIndex((node: Element): boolean => {
    const left: number = Number(node.getAttribute("x"));
    const width: number = Number(node.getAttribute("width"));
    return clientX >= left && clientX <= left + width;
  });
}

/*
 * Where the pointer lands on the drawn bar at `index`, left to right: the
 * middle of its width, in the whole pixels a mouse event reports.
 */
function spotOnBarAt(index: number): PointerSpot {
  const bar: Element | undefined = drawnBars()[index];
  if (!bar) {
    throw new Error(`recharts drew no bar at index ${index}`);
  }
  const left: number = Number(bar.getAttribute("x"));
  const width: number = Number(bar.getAttribute("width"));
  return { clientX: Math.round(left + width / 2), clientY: POINTER_Y };
}

beforeEach(() => {
  /*
   * Installed AT the fixed time, not moved there with setSystemTime: fake
   * timers count animation frames from the moment they are installed.
   */
  jest.useFakeTimers({ now: new Date("2026-09-28T11:30:00.000Z") });
});

afterEach(() => {
  cleanup();
  onScreen = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

for (const histogram of HISTOGRAMS) {
  describe(`the ${histogram.name} histogram, zoomed, through real recharts`, () => {
    test("new bars landing during the second press: the double-click zooms out by the next task, though the browser sends it no click and no dblclick", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onZoomOut: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: SHOWN_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: onZoomOut,
      });
      const spot: PointerSpot = spotOnBar("10:04");

      restAt(spot);
      firstClick(spot);
      // Its band waits out the double-click window behind the bar.
      const band: Element | null = drawnBand();
      expect(band).not.toBeNull();

      press(spot, 2);
      landBarsUnderThePress(spot, REFETCHED_BARS);
      expect(band?.isConnected).toBe(false);
      // The still pointer is on a bar of the new window.
      expect(tickX("11:04")).toBeCloseTo(spot.clientX, 5);
      release(spot, 2);
      // And nothing more: Chrome sends this press no click and no dblclick.

      nextTask();
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(selections(onTimeRangeSelect)).toEqual([]);

      waitOutTheDoubleClickWindow();
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(selections(onTimeRangeSelect)).toEqual([]);
    });

    test("new bars landing during the second press, and the browser sends the click and dblclick after all: it zooms out exactly once", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onZoomOut: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: SHOWN_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: onZoomOut,
      });
      const spot: PointerSpot = spotOnBar("10:04");

      restAt(spot);
      firstClick(spot);
      press(spot, 2);
      landBarsUnderThePress(spot, REFETCHED_BARS);
      release(spot, 2);
      /*
       * A browser that sends them anyway sends them to a node still on the
       * page, such as the box around the plot.
       */
      browserClick(chartBox(), spot, 2);
      browserDoubleClick(chartBox(), spot);

      nextTask();
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(selections(onTimeRangeSelect)).toEqual([]);

      waitOutTheDoubleClickWindow();
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(selections(onTimeRangeSelect)).toEqual([]);
    });

    test("new bars landing during the first press: neither press zooms in, and the second still zooms out once", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onZoomOut: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: SHOWN_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: onZoomOut,
      });
      const spot: PointerSpot = spotOnBar("10:04");

      restAt(spot);
      press(spot, 1);
      landBarsUnderThePress(spot, REFETCHED_BARS);
      release(spot, 1);
      // No click follows: the bar the press went down on is gone.
      expect(selections(onTimeRangeSelect)).toEqual([]);
      // Nor is a bar the reader never pressed marked as about to open.
      expect(drawnBand()).toBeNull();

      // The second press goes down on a bar of the new window, which stays.
      quietSecondClick(spot);

      nextTask();
      expect(onZoomOut).toHaveBeenCalledTimes(1);

      waitOutTheDoubleClickWindow();
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(selections(onTimeRangeSelect)).toEqual([]);
    });

    test("a quiet double-click on a bar zooms out once and zooms into nothing", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onZoomOut: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: SHOWN_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: onZoomOut,
      });
      const spot: PointerSpot = spotOnBar("10:04");

      restAt(spot);
      firstClick(spot);
      expect(drawnBand()).not.toBeNull();
      quietSecondClick(spot);

      nextTask();
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      // The zoom-out took the first click's band with it.
      expect(drawnBand()).toBeNull();

      waitOutTheDoubleClickWindow();
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(selections(onTimeRangeSelect)).toEqual([]);
    });

    test("new bars landing between the two clicks: it zooms out once, and the first click's zoom into a bar that is gone never happens", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onZoomOut: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: SHOWN_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: onZoomOut,
      });
      const spot: PointerSpot = spotOnBar("10:04");

      restAt(spot);
      firstClick(spot);
      landBars(REFETCHED_BARS);
      // The band went with its bar; the first click still waits to zoom in.
      expect(drawnBand()).toBeNull();
      quietSecondClick(spot);

      nextTask();
      expect(onZoomOut).toHaveBeenCalledTimes(1);

      waitOutTheDoubleClickWindow();
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(selections(onTimeRangeSelect)).toEqual([]);
    });

    /*
     * A host hands the chart a new zoom-out handler with every render, and
     * the one it hands over with the new bars is the one that knows them.
     */
    test("the zoom-out goes to the handler the host passed with the new bars, not the one it held at the press", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onZoomOutAtThePress: MockFunction = getJestMockFunction();
      const onZoomOutWithTheNewBars: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: SHOWN_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: onZoomOutAtThePress,
      });
      const spot: PointerSpot = spotOnBar("10:04");

      restAt(spot);
      firstClick(spot);
      press(spot, 2);
      landBarsUnderThePress(spot, REFETCHED_BARS, {
        onZoomOut: onZoomOutWithTheNewBars,
      });
      release(spot, 2);

      nextTask();
      expect(onZoomOutWithTheNewBars).toHaveBeenCalledTimes(1);
      expect(onZoomOutAtThePress).not.toHaveBeenCalled();

      waitOutTheDoubleClickWindow();
      expect(onZoomOutWithTheNewBars).toHaveBeenCalledTimes(1);
      expect(selections(onTimeRangeSelect)).toEqual([]);
    });

    test("the zoom-out takes the first click's band with it: the clicked bar comes back unshaded", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onZoomOut: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: SHOWN_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: onZoomOut,
      });
      const spot: PointerSpot = spotOnBar("10:04");

      restAt(spot);
      firstClick(spot);
      expect(drawnBand()).not.toBeNull();
      press(spot, 2);
      landBarsUnderThePress(spot, REFETCHED_BARS);
      release(spot, 2);
      nextTask();
      expect(onZoomOut).toHaveBeenCalledTimes(1);

      // Back on the hour it zoomed in from, and no longer zoomed.
      landBars(ZOOMED_FROM_BARS, { onZoomOut: undefined });
      expect(drawnBars()).toHaveLength(ZOOMED_FROM_BARS.length);
      expect(drawnBand()).toBeNull();
    });
  });
}

/*
 * An unzoomed chart of thirty one-minute bars, 10:00 to 10:29, and a
 * refetch of only ten, 11:00 to 11:09, landing while a press is held on
 * 10:25 - the 26th bar, right of where the ten new ones end.
 */
const HALF_HOUR_BARS: Array<Bar> = minuteBars(
  "2026-09-28T10:00:00.000Z",
  30,
  (index: number): number => {
    return 5 + (index % 4);
  },
);

const SHORTER_REFETCH_BARS: Array<Bar> = minuteBars(
  "2026-09-28T11:00:00.000Z",
  10,
  (index: number): number => {
    return 20 + index;
  },
);

const PRESSED_BAR_INDEX: number = 25;
const PRESSED_BAR: Bar = HALF_HOUR_BARS[PRESSED_BAR_INDEX]!;
const REFETCH_LAST_BAR_INDEX: number = SHORTER_REFETCH_BARS.length - 1;

/*
 * The clamp case (commit b6ec899df4), through real recharts. recharts
 * works out the bar under the pointer only when the pointer moves, and
 * keeps its index otherwise; past the end of shorter data it clamps that
 * index onto the LAST bar. So the release of a still press on 10:25 reports
 * index 9, 11:09 - another index as well as another bar, exactly what a
 * hand's drift across an edge reports - and the hook took it for one: a
 * click on the bar it pressed, which zoomed an unzoomed explorer into
 * 10:25, a minute the chart no longer shows. The pointer never moved, not
 * by a pixel, and that is what now says the data changed.
 */
for (const histogram of HISTOGRAMS) {
  describe(`the ${histogram.name} histogram, not zoomed, through real recharts: a still press on a bar right of where a shorter refetch ends`, () => {
    test("recharts hands the release the refetch's last bar at a clamped index, and the press zooms nowhere", () => {
      const handed: Array<HandedToTheHook> = listenInOnTheHook();
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: HALF_HOUR_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
      });
      expect(drawnBars()).toHaveLength(HALF_HOUR_BARS.length);
      const spot: PointerSpot = spotOnBarAt(PRESSED_BAR_INDEX);

      restAt(spot);
      press(spot, 1);

      expect(lastHanded(handed, "onMouseDown")).toEqual({
        handler: "onMouseDown",
        activeTooltipIndex: String(PRESSED_BAR_INDEX),
        activeLabel: PRESSED_BAR.time,
        clientX: spot.clientX,
        detail: 1,
      });
      const handedUpToThePress: number = handed.length;

      landBars(SHORTER_REFETCH_BARS);
      expect(drawnBars()).toHaveLength(SHORTER_REFETCH_BARS.length);
      release(spot, 1);

      /*
       * Nothing came between the press and its release - no move at all -
       * and the release, at the very spot of the press, got the refetch's
       * LAST bar at index 9: the stale 25, clamped. Not a bar recharts
       * hit-tested: the one under the pointer now is 11:08.
       */
      expect(handed.slice(handedUpToThePress)).toEqual([
        {
          handler: "onMouseUp",
          activeTooltipIndex: String(REFETCH_LAST_BAR_INDEX),
          activeLabel: SHORTER_REFETCH_BARS[REFETCH_LAST_BAR_INDEX]!.time,
          clientX: spot.clientX,
          detail: 1,
        },
      ]);
      expect(barIndexAtX(spot.clientX)).toBe(REFETCH_LAST_BAR_INDEX - 1);

      // The bar it pressed is gone: nothing to zoom into, nothing lit.
      expect(selections(onTimeRangeSelect)).toEqual([]);
      expect(drawnBand()).toBeNull();

      waitOutTheDoubleClickWindow();
      expect(selections(onTimeRangeSelect)).toEqual([]);
      expect(drawnBand()).toBeNull();

      // And the chart is none the worse: a click on a new bar zooms into it.
      const newBarSpot: PointerSpot = spotOnBarAt(4);
      restAt(newBarSpot);
      press(newBarSpot, 1);
      release(newBarSpot, 1);
      expect(selections(onTimeRangeSelect)).toEqual([
        [SHORTER_REFETCH_BARS[4]!.time, SHORTER_REFETCH_BARS[5]!.time],
      ]);
    });

    /*
     * Chrome makes up a mousemove at the pointer's own spot when the page
     * under a still pointer changes. recharts then hit-tests the new bars
     * and reports the one under the pointer - still another index than the
     * press's, and still no movement of the pointer.
     */
    test("with the move Chrome makes up at the same spot once the new bars are drawn, recharts hit-tests them, and the press still zooms nowhere", () => {
      const handed: Array<HandedToTheHook> = listenInOnTheHook();
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: HALF_HOUR_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
      });
      const spot: PointerSpot = spotOnBarAt(PRESSED_BAR_INDEX);

      restAt(spot);
      press(spot, 1);
      landBars(SHORTER_REFETCH_BARS);
      fireEvent.mouseMove(chartWrapper(), { ...spot, buttons: 1 });

      const underThePointer: number = barIndexAtX(spot.clientX);
      expect(underThePointer).toBe(REFETCH_LAST_BAR_INDEX - 1);
      expect(lastHanded(handed, "onMouseMove")).toEqual({
        handler: "onMouseMove",
        activeTooltipIndex: String(underThePointer),
        activeLabel: SHORTER_REFETCH_BARS[underThePointer]!.time,
        clientX: spot.clientX,
        detail: 0,
      });
      // Not a drag: nothing painted.
      expect(drawnBand()).toBeNull();

      release(spot, 1);

      expect(lastHanded(handed, "onMouseUp")).toMatchObject({
        activeTooltipIndex: String(underThePointer),
        activeLabel: SHORTER_REFETCH_BARS[underThePointer]!.time,
        clientX: spot.clientX,
      });
      expect(selections(onTimeRangeSelect)).toEqual([]);
      expect(drawnBand()).toBeNull();

      waitOutTheDoubleClickWindow();
      expect(selections(onTimeRangeSelect)).toEqual([]);
    });

    /*
     * The rule the clamp case must not break: the pointer really moving
     * two pixels, across the edge between 10:25 and 10:26, changes the
     * index just as the clamp does - and is a hand's drift, still a click
     * on the bar it pressed.
     */
    test("a press on 10:25 that drifts 2px onto 10:26, with no refetch, is still a click on 10:25", () => {
      const handed: Array<HandedToTheHook> = listenInOnTheHook();
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      showChart(histogram, {
        bars: HALF_HOUR_BARS,
        onTimeRangeSelect: onTimeRangeSelect,
      });
      // Midway between the two bars' middles: where recharts' 10:25 ends.
      const edgeX: number = Math.floor(
        (spotOnBarAt(PRESSED_BAR_INDEX).clientX +
          spotOnBarAt(PRESSED_BAR_INDEX + 1).clientX) /
          2,
      );
      const pressSpot: PointerSpot = { clientX: edgeX - 1, clientY: POINTER_Y };
      const driftSpot: PointerSpot = { clientX: edgeX + 1, clientY: POINTER_Y };

      restAt(pressSpot);
      press(pressSpot, 1);
      fireEvent.mouseMove(chartWrapper(), { ...driftSpot, buttons: 1 });
      release(driftSpot, 1);

      expect(lastHanded(handed, "onMouseDown")).toMatchObject({
        activeTooltipIndex: String(PRESSED_BAR_INDEX),
        activeLabel: PRESSED_BAR.time,
      });
      expect(lastHanded(handed, "onMouseUp")).toMatchObject({
        activeTooltipIndex: String(PRESSED_BAR_INDEX + 1),
        activeLabel: HALF_HOUR_BARS[PRESSED_BAR_INDEX + 1]!.time,
        clientX: driftSpot.clientX,
      });
      expect(selections(onTimeRangeSelect)).toEqual([
        [PRESSED_BAR.time, HALF_HOUR_BARS[PRESSED_BAR_INDEX + 1]!.time],
      ]);
    });
  });
}
