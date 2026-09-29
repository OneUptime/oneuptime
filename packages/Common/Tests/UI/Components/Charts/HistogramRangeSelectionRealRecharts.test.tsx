/** @timezone UTC */
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Drag-to-zoom on the raw recharts histograms (the log and telemetry
 * volume charts, issue #4105), driven through REAL recharts and the real
 * useHistogramRangeSelection, as ChartRangeSelectionRealRecharts.test.tsx
 * does for the line, area and bar charts. Only ResponsiveContainer is stood
 * in for, and the pointer goes to the plot at the x recharts drew each
 * bar's tick label at.
 *
 * The histogram hosts hand recharts none of the settings the chart cores
 * do, so recharts still holds every mousemove for the next animation frame
 * while it hands mousedown and mouseup over at once, with the bar its store
 * last worked out. A drag whose moves each get a frame works; the cases
 * marked "known bug" do not, and are kept as `test.failing` until the
 * source is fixed - when one starts passing, drop its `.failing`:
 *
 * - a quick flick released in the frame of its last move ends where the
 *   previous move landed;
 * - a press in the frame the pointer arrived starts on the bar before;
 * - the live band runs in drag order, so a right-to-left drag shades
 *   neither end bar (and nothing at all across two bars).
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
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";

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

// Ten one-minute bars, 10:00 to 10:09, keyed by the instant each starts.
const BUCKET_TIMES: Array<string> = Array.from(
  { length: 10 },
  (_: unknown, index: number): string => {
    return new Date(FIRST_BUCKET_MS + index * MINUTE_MS).toISOString();
  },
);

type SelectHandler = (startTime: Date, endTime: Date) => void;

interface HistogramHandlers {
  onTimeRangeSelect: SelectHandler;
  // Set only while the chart shows a window dragged out of it.
  onZoomOut?: (() => void) | undefined;
  // How much time one bar covers; without it a click is not a zoom.
  bucketIntervalMs?: number | undefined;
}

interface HistogramUnderTest {
  name: string;
  render: (handlers: HistogramHandlers) => React.ReactElement;
}

const HISTOGRAMS: Array<HistogramUnderTest> = [
  {
    name: "telemetry",
    render: (handlers: HistogramHandlers): React.ReactElement => {
      return (
        <TelemetryHistogram
          buckets={BUCKET_TIMES.map(
            (time: string, index: number): TelemetryHistogramBucket => {
              return { time: time, series: "error", count: 5 + index };
            },
          )}
          isLoading={false}
          series={[{ key: "error", label: "Error", color: "#dc2626" }]}
          onTimeRangeSelect={handlers.onTimeRangeSelect}
          onZoomOut={handlers.onZoomOut}
          bucketIntervalMs={handlers.bucketIntervalMs}
        />
      );
    },
  },
  {
    name: "logs",
    render: (handlers: HistogramHandlers): React.ReactElement => {
      return (
        <LogsHistogram
          buckets={BUCKET_TIMES.map(
            (time: string, index: number): LogsHistogramBucket => {
              return { time: time, severity: "Error", count: 5 + index };
            },
          )}
          isLoading={false}
          onTimeRangeSelect={handlers.onTimeRangeSelect}
          onZoomOut={handlers.onZoomOut}
          bucketIntervalMs={handlers.bucketIntervalMs}
        />
      );
    },
  },
];

let renderedChart: HTMLElement | null = null;

function renderHistogram(
  histogram: HistogramUnderTest,
  handlers: HistogramHandlers,
): void {
  renderedChart = render(histogram.render(handlers)).container;
}

function chartContainer(): HTMLElement {
  if (!renderedChart) {
    throw new Error("no histogram rendered");
  }
  return renderedChart;
}

function chartWrapper(): Element {
  const wrapper: Element | null =
    chartContainer().querySelector(".recharts-wrapper");
  if (!wrapper) {
    throw new Error("recharts drew no chart");
  }
  return wrapper;
}

// The plot's own background; events fired at it bubble to the wrapper.
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
 * The pointer x that lands on a bar: the centre of its tick label. The
 * labels are local times ("10:02 AM", or "10:02" on a 24-hour clock).
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

function hover(label: string): void {
  fireEvent.mouseMove(plotSurface(), {
    clientX: tickX(label),
    clientY: PLOT_Y,
    buttons: 0,
  });
}

function press(label: string): void {
  fireEvent.mouseDown(plotSurface(), {
    clientX: tickX(label),
    clientY: PLOT_Y,
    button: 0,
    buttons: 1,
  });
}

function dragTo(label: string): void {
  fireEvent.mouseMove(plotSurface(), {
    clientX: tickX(label),
    clientY: PLOT_Y,
    buttons: 1,
  });
}

// The button comes up over a bar, and the browser follows with a click.
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

// The pointer leaves the chart with the button held and lets go elsewhere.
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

// The pointer comes to rest over a bar: its move lands in the next frame.
function restOn(label: string): void {
  hover(label);
  nextFrame();
}

// "10:02" -> the instant that minute starts, as the handlers report it.
function at(label: string): string {
  return `2026-09-28T${label}:00.000Z`;
}

function zoomWindow(from: string, to: string): [string, string] {
  return [at(from), at(to)];
}

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

beforeEach(() => {
  /*
   * Installed AT the fixed time, not moved there with setSystemTime: fake
   * timers count animation frames from the moment they are installed.
   */
  jest.useFakeTimers({ now: new Date("2026-09-28T10:30:00.000Z") });
});

afterEach(() => {
  cleanup();
  renderedChart = null;
  jest.useRealTimers();
});

for (const histogram of HISTOGRAMS) {
  describe(`the ${histogram.name} histogram, through real recharts`, () => {
    test("a drag whose moves each get a frame selects from the start of the first bar to the end of the last", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      renderHistogram(histogram, {
        onTimeRangeSelect: onTimeRangeSelect,
        bucketIntervalMs: MINUTE_MS,
      });

      restOn("10:02");
      press("10:02");
      nextFrame();
      dragTo("10:04");
      nextFrame();
      dragTo("10:06");
      nextFrame();
      releaseAt("10:06");

      expect(selections(onTimeRangeSelect)).toEqual([
        zoomWindow("10:02", "10:07"),
      ]);
    });

    test("the same drag right to left selects the same window", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      renderHistogram(histogram, {
        onTimeRangeSelect: onTimeRangeSelect,
        bucketIntervalMs: MINUTE_MS,
      });

      restOn("10:06");
      press("10:06");
      nextFrame();
      dragTo("10:04");
      nextFrame();
      dragTo("10:02");
      nextFrame();
      releaseAt("10:02");

      expect(selections(onTimeRangeSelect)).toEqual([
        zoomWindow("10:02", "10:07"),
      ]);
    });

    test("a drag released outside the chart, on the page, still selects up to the last bar it reached", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      renderHistogram(histogram, {
        onTimeRangeSelect: onTimeRangeSelect,
        bucketIntervalMs: MINUTE_MS,
      });

      restOn("10:02");
      press("10:02");
      nextFrame();
      dragTo("10:05");
      nextFrame();
      releaseOnThePage();

      expect(selections(onTimeRangeSelect)).toEqual([
        zoomWindow("10:02", "10:06"),
      ]);
      expect(drawnBand()).toBeNull();
    });

    test("a click on one bar zooms into exactly that bar", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      renderHistogram(histogram, {
        onTimeRangeSelect: onTimeRangeSelect,
        bucketIntervalMs: MINUTE_MS,
      });

      restOn("10:04");
      press("10:04");
      releaseAt("10:04");

      expect(selections(onTimeRangeSelect)).toEqual([
        zoomWindow("10:04", "10:05"),
      ]);
    });

    test("without the bar width a click is not a zoom", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      renderHistogram(histogram, { onTimeRangeSelect: onTimeRangeSelect });

      restOn("10:04");
      press("10:04");
      releaseAt("10:04");
      nextFrame();

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
      expect(drawnBand()).toBeNull();
    });

    test("while zoomed, a double-click zooms out and neither of its clicks zooms in", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onZoomOut: MockFunction = getJestMockFunction();
      renderHistogram(histogram, {
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: onZoomOut,
        bucketIntervalMs: MINUTE_MS,
      });

      restOn("10:04");
      doubleClickAt("10:04");
      act(() => {
        jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 2);
      });

      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(onTimeRangeSelect).not.toHaveBeenCalled();
    });

    test("while zoomed, a single click on a bar zooms into it once the double-click window has passed", () => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      renderHistogram(histogram, {
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: getJestMockFunction(),
        bucketIntervalMs: MINUTE_MS,
      });

      restOn("10:04");
      press("10:04");
      releaseAt("10:04");
      expect(onTimeRangeSelect).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
      });
      expect(selections(onTimeRangeSelect)).toEqual([
        zoomWindow("10:04", "10:05"),
      ]);
    });

    test.failing(
      "a quick flick released in the frame of its last move covers the bar it was released on [known bug: mousemove held a frame; selects 10:02-10:04]",
      () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderHistogram(histogram, {
          onTimeRangeSelect: onTimeRangeSelect,
          bucketIntervalMs: MINUTE_MS,
        });

        restOn("10:02");
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
      },
    );

    test.failing(
      "a press in the frame the pointer arrived starts on the bar it arrived at [known bug: mousemove held a frame; starts on 10:01]",
      () => {
        const onTimeRangeSelect: MockFunction = getJestMockFunction();
        renderHistogram(histogram, {
          onTimeRangeSelect: onTimeRangeSelect,
          bucketIntervalMs: MINUTE_MS,
        });

        restOn("10:01");
        // The pointer darts to 10:02 and presses in the same frame.
        hover("10:02");
        press("10:02");
        nextFrame();
        dragTo("10:05");
        nextFrame();
        releaseAt("10:05");

        expect(selections(onTimeRangeSelect)).toEqual([
          zoomWindow("10:02", "10:06"),
        ]);
      },
    );

    test.failing(
      "a right-to-left drag's band covers both end bars [known bug: band drawn in drag order]",
      () => {
        renderHistogram(histogram, {
          onTimeRangeSelect: getJestMockFunction(),
          bucketIntervalMs: MINUTE_MS,
        });

        restOn("10:06");
        press("10:06");
        nextFrame();
        dragTo("10:03");
        nextFrame();

        const halfBar: number = (tickX("10:01") - tickX("10:00")) / 2;
        const band: BandEdges | null = drawnBand();
        expect(band).not.toBeNull();
        expect(band!.left).toBeCloseTo(tickX("10:03") - halfBar, 1);
        expect(band!.right).toBeCloseTo(tickX("10:06") + halfBar, 1);
      },
    );
  });
}
