/** @timezone UTC */

import { HistogramBucket as LogsHistogramBucket } from "../../../UI/Components/LogsViewer/types";
import {
  HistogramBucket as TelemetryHistogramBucket,
  HistogramSeriesOption,
} from "../../../UI/Components/TelemetryViewer/types";
import LogSeverity from "../../../Types/Log/LogSeverity";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #3914: "Clicking on a single bar in the Log Volume chart is supposed
 * to filter the log list to that time bucket, but this only works
 * intermittently. Most of the time, clicking a single bar shows no logs."
 *
 * Each bar is labelled with the START of its bucket and the chart used to
 * hand the host the two labels a selection ran between. A click on one bar
 * (with the usual jitter of a real click) became a window zero seconds wide,
 * which matches no log, while the chart zoomed into it went on drawing the
 * bar - "no logs" under a chart that plainly had some. Whether a click did
 * that, did nothing, or happened to cross into the next bar depended on
 * whether recharts' frame-late mousemove landed before the release, hence
 * "intermittently".
 *
 * Both volume charts share the selection logic, so every case runs against
 * both. Recharts is stood in for because it resolves the pointer to a bar
 * from real layout that jsdom does not have (see
 * LogsHistogramDragTooltip.test.tsx); the stand-in calls the very same
 * onMouseDown / onMouseMove / onMouseUp props with the chart state recharts
 * would pass, `activeLabel` being the bucket under the pointer.
 */
jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: StubChartProps) => {
      return react.createElement(
        "div",
        { "data-testid": "bar-chart" },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bucket-${row.time}`,
            onMouseDown: () => {
              props.onMouseDown?.({ activeLabel: row.time });
            },
            onMouseMove: () => {
              props.onMouseMove?.({ activeLabel: row.time });
            },
            onMouseUp: () => {
              props.onMouseUp?.({ activeLabel: row.time });
            },
          });
        }),
        props.children,
      );
    },
    Bar: () => {
      return null;
    },
    XAxis: () => {
      return null;
    },
    YAxis: () => {
      return null;
    },
    Tooltip: (props: { active?: boolean }) => {
      return react.createElement("div", {
        "data-testid": "tooltip",
        "data-active": String(props.active),
      });
    },
    ReferenceArea: (props: { x1?: string; x2?: string }) => {
      return react.createElement("div", {
        "data-testid": "selection-band",
        "data-x1": props.x1,
        "data-x2": props.x2,
      });
    },
  };
});

// Imported after the mock so the charts pick the stand-in up.
import LogsHistogram from "../../../UI/Components/LogsViewer/components/LogsHistogram";
import TelemetryHistogram from "../../../UI/Components/TelemetryViewer/components/TelemetryHistogram";

const MINUTE_MS: number = 60 * 1000;

/*
 * The shape the logs and traces histograms really label their buckets with:
 * ClickHouse DateTime, UTC, no zone designator.
 */
const BAR_A: string = "2026-09-17 10:15:00";
const BAR_B: string = "2026-09-17 10:16:00";
const BAR_C: string = "2026-09-17 10:17:00";

const LOG_BUCKETS: Array<LogsHistogramBucket> = [
  { time: BAR_A, severity: LogSeverity.Error, count: 3 },
  { time: BAR_B, severity: LogSeverity.Warning, count: 5 },
  { time: BAR_C, severity: LogSeverity.Error, count: 7 },
];

const SERIES: Array<HistogramSeriesOption> = [
  { key: "ok", label: "OK", color: "#34d399" },
  { key: "error", label: "Error", color: "#f87171" },
];

const TELEMETRY_BUCKETS: Array<TelemetryHistogramBucket> = [
  { time: BAR_A, series: "ok", count: 3 },
  { time: BAR_B, series: "error", count: 5 },
  { time: BAR_C, series: "ok", count: 7 },
];

interface ChartProps {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onZoomOut?: (() => void) | undefined;
  bucketIntervalMs?: number | undefined;
}

interface HistogramUnderTest {
  name: string;
  element: (props: ChartProps) => React.ReactElement;
}

const HISTOGRAMS: Array<HistogramUnderTest> = [
  {
    name: "LogsHistogram",
    element: (props: ChartProps): React.ReactElement => {
      return (
        <LogsHistogram buckets={LOG_BUCKETS} isLoading={false} {...props} />
      );
    },
  },
  {
    name: "TelemetryHistogram",
    element: (props: ChartProps): React.ReactElement => {
      return (
        <TelemetryHistogram
          buckets={TELEMETRY_BUCKETS}
          series={SERIES}
          isLoading={false}
          {...props}
        />
      );
    },
  },
];

function bar(label: string): HTMLElement {
  return screen.getByTestId(`bucket-${label}`);
}

function band(): { x1: string | null; x2: string | null } | null {
  const element: HTMLElement | null = screen.queryByTestId("selection-band");

  if (!element) {
    return null;
  }

  return {
    x1: element.getAttribute("data-x1"),
    x2: element.getAttribute("data-x2"),
  };
}

function click(label: string): void {
  fireEvent.mouseDown(bar(label));
  fireEvent.mouseUp(bar(label));
}

function selectedWindows(
  onTimeRangeSelect: MockFunction,
): Array<[string, string]> {
  return onTimeRangeSelect.mock.calls.map(
    (call: Array<unknown>): [string, string] => {
      return [(call[0] as Date).toISOString(), (call[1] as Date).toISOString()];
    },
  );
}

describe.each(HISTOGRAMS)(
  "$name — click or drag to zoom",
  (histogram: HistogramUnderTest) => {
    interface Rendered {
      onTimeRangeSelect: MockFunction;
      onZoomOut: MockFunction;
      view: RenderResult;
    }

    function renderChart(
      options: {
        bucketIntervalMs?: number | undefined;
        canZoomOut?: boolean;
        canSelect?: boolean;
      } = {},
    ): Rendered {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const onZoomOut: MockFunction = getJestMockFunction();

      const view: RenderResult = render(
        histogram.element({
          ...(options.canSelect === false
            ? {}
            : { onTimeRangeSelect: onTimeRangeSelect }),
          ...(options.canZoomOut ? { onZoomOut: onZoomOut } : {}),
          bucketIntervalMs:
            "bucketIntervalMs" in options
              ? options.bucketIntervalMs
              : MINUTE_MS,
        }),
      );

      return {
        onTimeRangeSelect: onTimeRangeSelect,
        onZoomOut: onZoomOut,
        view: view,
      };
    }

    afterEach(() => {
      cleanup();
      jest.useRealTimers();
    });

    describe("on a chart showing its original window", () => {
      test("a click on a bar opens that bar's whole bucket", () => {
        const { onTimeRangeSelect } = renderChart();

        click(BAR_B);

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:16:00.000Z", "2026-09-17T10:17:00.000Z"],
        ]);
      });

      /*
       * A real click nearly always moves the pointer a pixel or two between
       * press and release. That jitter is what used to turn a click into a
       * window zero seconds wide.
       */
      test("a click that jitters inside the bar opens the same bucket", () => {
        const { onTimeRangeSelect } = renderChart();

        fireEvent.mouseDown(bar(BAR_B));
        fireEvent.mouseMove(bar(BAR_B));
        fireEvent.mouseMove(bar(BAR_B));
        fireEvent.mouseUp(bar(BAR_B));

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:16:00.000Z", "2026-09-17T10:17:00.000Z"],
        ]);
      });

      test("never hands the host a window zero seconds wide", () => {
        const { onTimeRangeSelect } = renderChart();

        click(BAR_A);
        fireEvent.mouseDown(bar(BAR_C));
        fireEvent.mouseMove(bar(BAR_C));
        fireEvent.mouseUp(bar(BAR_C));

        expect(onTimeRangeSelect).toHaveBeenCalledTimes(2);
        for (const [start, end] of selectedWindows(onTimeRangeSelect)) {
          expect(new Date(end).getTime()).toBeGreaterThan(
            new Date(start).getTime(),
          );
        }
      });

      test("a drag across bars keeps the whole of the last bar", () => {
        const { onTimeRangeSelect } = renderChart();

        fireEvent.mouseDown(bar(BAR_A));
        fireEvent.mouseMove(bar(BAR_B));
        fireEvent.mouseMove(bar(BAR_C));
        fireEvent.mouseUp(bar(BAR_C));

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:15:00.000Z", "2026-09-17T10:18:00.000Z"],
        ]);
      });

      test("a right-to-left drag opens the same window", () => {
        const { onTimeRangeSelect } = renderChart();

        fireEvent.mouseDown(bar(BAR_C));
        fireEvent.mouseMove(bar(BAR_A));
        fireEvent.mouseUp(bar(BAR_A));

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:15:00.000Z", "2026-09-17T10:18:00.000Z"],
        ]);
      });

      /*
       * Recharts delivers mousemove a frame late but mouseup at once, so a
       * quick drag is routinely released before its last move lands. The
       * bar under the pointer at release is the one that counts.
       */
      test("a release that beats the last move still ends on the bar it was released over", () => {
        const { onTimeRangeSelect } = renderChart();

        fireEvent.mouseDown(bar(BAR_A));
        fireEvent.mouseMove(bar(BAR_B));
        fireEvent.mouseUp(bar(BAR_C));

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:15:00.000Z", "2026-09-17T10:18:00.000Z"],
        ]);
      });

      test("a drag released before any move arrived is not lost", () => {
        const { onTimeRangeSelect } = renderChart();

        fireEvent.mouseDown(bar(BAR_A));
        fireEvent.mouseUp(bar(BAR_C));

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:15:00.000Z", "2026-09-17T10:18:00.000Z"],
        ]);
      });

      test("a drag released off the chart ends on the last bar it crossed", () => {
        const { onTimeRangeSelect } = renderChart();

        fireEvent.mouseDown(bar(BAR_A));
        fireEvent.mouseMove(bar(BAR_B));
        fireEvent.mouseUp(document.body);

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:15:00.000Z", "2026-09-17T10:17:00.000Z"],
        ]);
      });

      test("a press that leaves the chart without crossing a bar opens the bar it began on", () => {
        const { onTimeRangeSelect } = renderChart();

        fireEvent.mouseDown(bar(BAR_C));
        fireEvent.mouseUp(document.body);

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:17:00.000Z", "2026-09-17T10:18:00.000Z"],
        ]);
      });

      /*
       * The release over a bar reaches the chart's handler and then the
       * page-wide one that catches releases off the chart.
       */
      test("a click is acted on once although its release is seen twice", () => {
        const { onTimeRangeSelect } = renderChart();

        click(BAR_B);
        fireEvent.mouseUp(document.body);

        expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
      });

      test("leaves no selection band behind", () => {
        renderChart();

        click(BAR_B);

        expect(band()).toBeNull();
      });

      test("hands the tooltip back once the click is over", () => {
        renderChart();

        click(BAR_B);

        expect(screen.getByTestId("tooltip").getAttribute("data-active")).toBe(
          "undefined",
        );
      });

      test("says a click works too", () => {
        renderChart();

        expect(screen.queryByText("Click or drag to zoom")).not.toBeNull();
        expect(screen.queryByText("Drag to zoom")).toBeNull();
      });

      /*
       * Nothing to go back to, so there is no double-click gesture to wait
       * for - and waiting would only make every click feel slow.
       */
      test("zooms at once, without waiting for a double-click", () => {
        jest.useFakeTimers();
        const { onTimeRangeSelect } = renderChart();

        click(BAR_B);

        expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the bucket width is not known", () => {
      test("a click selects nothing rather than a zero-width window", () => {
        const { onTimeRangeSelect } = renderChart({
          bucketIntervalMs: undefined,
        });

        fireEvent.mouseDown(bar(BAR_B));
        fireEvent.mouseMove(bar(BAR_B));
        fireEvent.mouseUp(bar(BAR_B));

        expect(onTimeRangeSelect).not.toHaveBeenCalled();
        expect(band()).toBeNull();
      });

      test("a drag still runs from one bar's start to the other's", () => {
        const { onTimeRangeSelect } = renderChart({
          bucketIntervalMs: undefined,
        });

        fireEvent.mouseDown(bar(BAR_A));
        fireEvent.mouseMove(bar(BAR_C));
        fireEvent.mouseUp(bar(BAR_C));

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:15:00.000Z", "2026-09-17T10:17:00.000Z"],
        ]);
      });

      test("offers only the drag", () => {
        renderChart({ bucketIntervalMs: undefined });

        expect(screen.queryByText("Drag to zoom")).not.toBeNull();
        expect(screen.queryByText("Click or drag to zoom")).toBeNull();
      });
    });

    test("a chart the host cannot zoom ignores clicks and offers nothing", () => {
      const { onTimeRangeSelect } = renderChart({ canSelect: false });

      click(BAR_B);

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
      expect(band()).toBeNull();
      expect(screen.queryByText("Click or drag to zoom")).toBeNull();
      expect(screen.queryByText("Drag to zoom")).toBeNull();
    });

    /*
     * A zoomed chart has a double-click gesture ("zoom back out"), and the
     * browser delivers both clicks of a double-click before the dblclick.
     * A click there waits DOUBLE_CLICK_DISAMBIGUATION_MS so the gesture can
     * cancel it, the same bargain the metric charts strike.
     */
    describe("on a zoomed chart", () => {
      test("a click opens its bar once the double-click window has passed", () => {
        jest.useFakeTimers();
        const { onTimeRangeSelect } = renderChart({ canZoomOut: true });

        click(BAR_B);

        act(() => {
          jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS - 1);
        });
        expect(onTimeRangeSelect).not.toHaveBeenCalled();

        act(() => {
          jest.advanceTimersByTime(1);
        });
        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:16:00.000Z", "2026-09-17T10:17:00.000Z"],
        ]);
      });

      test("keeps the clicked bar highlighted while it waits, and clears it after", () => {
        jest.useFakeTimers();
        renderChart({ canZoomOut: true });

        click(BAR_B);

        expect(band()).toEqual({ x1: BAR_B, x2: BAR_B });

        act(() => {
          jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
        });

        expect(band()).toBeNull();
      });

      test("a double-click zooms out and never zooms in", () => {
        jest.useFakeTimers();
        const { onTimeRangeSelect, onZoomOut } = renderChart({
          canZoomOut: true,
        });

        click(BAR_B);
        click(BAR_B);
        fireEvent.doubleClick(bar(BAR_B));

        act(() => {
          jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
        });

        expect(onZoomOut).toHaveBeenCalledTimes(1);
        expect(onTimeRangeSelect).not.toHaveBeenCalled();
        expect(band()).toBeNull();
      });

      test("a drag zooms at once: it cannot be half of a double-click", () => {
        jest.useFakeTimers();
        const { onTimeRangeSelect } = renderChart({ canZoomOut: true });

        fireEvent.mouseDown(bar(BAR_A));
        fireEvent.mouseMove(bar(BAR_C));
        fireEvent.mouseUp(bar(BAR_C));

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:15:00.000Z", "2026-09-17T10:18:00.000Z"],
        ]);
      });

      test("a second click on another bar replaces the first", () => {
        jest.useFakeTimers();
        const { onTimeRangeSelect } = renderChart({ canZoomOut: true });

        click(BAR_A);
        act(() => {
          jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS / 2);
        });
        click(BAR_C);
        act(() => {
          jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
        });

        expect(selectedWindows(onTimeRangeSelect)).toEqual([
          ["2026-09-17T10:17:00.000Z", "2026-09-17T10:18:00.000Z"],
        ]);
      });

      test("a click still waiting when the chart goes away is dropped", () => {
        jest.useFakeTimers();
        const { onTimeRangeSelect, view } = renderChart({ canZoomOut: true });

        click(BAR_B);
        view.unmount();

        act(() => {
          jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
        });

        expect(onTimeRangeSelect).not.toHaveBeenCalled();
      });

      /*
       * The host can re-render while the click waits (a new window, new
       * filters). The zoom must reach the handler it has now.
       */
      test("a waiting click reaches the host's current handler", () => {
        jest.useFakeTimers();
        const { onTimeRangeSelect, onZoomOut, view } = renderChart({
          canZoomOut: true,
        });
        const nextHandler: MockFunction = getJestMockFunction();

        click(BAR_B);
        view.rerender(
          histogram.element({
            onTimeRangeSelect: nextHandler,
            onZoomOut: onZoomOut,
            bucketIntervalMs: MINUTE_MS,
          }),
        );
        act(() => {
          jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
        });

        expect(onTimeRangeSelect).not.toHaveBeenCalled();
        expect(selectedWindows(nextHandler)).toEqual([
          ["2026-09-17T10:16:00.000Z", "2026-09-17T10:17:00.000Z"],
        ]);
      });
    });

    test("a wide bucket opens in full", () => {
      const { onTimeRangeSelect } = renderChart({
        bucketIntervalMs: 15 * MINUTE_MS,
      });

      click(BAR_A);

      expect(selectedWindows(onTimeRangeSelect)).toEqual([
        ["2026-09-17T10:15:00.000Z", "2026-09-17T10:30:00.000Z"],
      ]);
    });
  },
);
