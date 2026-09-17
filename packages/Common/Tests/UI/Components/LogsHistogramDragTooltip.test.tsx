/** @timezone UTC */

import { HistogramBucket } from "../../../UI/Components/LogsViewer/types";
import LogSeverity from "../../../Types/Log/LogSeverity";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Recharts resolves a pointer to a bucket from real layout — a bounding rect,
 * an animation frame — none of which jsdom provides, so a drag fired at the
 * real chart never reaches the component under test. The chart is replaced by
 * a stand-in that hands each bucket a hit target and calls the very same
 * onMouseDown / onMouseMove / onMouseUp props with the chart state recharts
 * would have passed. What is left under test is exactly what this file is
 * about: how LogsHistogram reacts to a drag.
 *
 * The tooltip stand-in reports the `active` prop it was handed, because that
 * is the switch the fix flips — recharts hides the tooltip outright when
 * `active` is false and picks its own behaviour back up when the prop is not
 * passed at all.
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

// Imported after the mock so the chart picks the stand-in up.
import LogsHistogram from "../../../UI/Components/LogsViewer/components/LogsHistogram";

const FIRST_BUCKET: string = "2026-08-05T11:58:00Z";
const MIDDLE_BUCKET: string = "2026-08-05T11:59:00Z";
const LAST_BUCKET: string = "2026-08-05T12:00:00Z";

const BUCKETS: Array<HistogramBucket> = [
  { time: FIRST_BUCKET, severity: LogSeverity.Error, count: 3 },
  { time: MIDDLE_BUCKET, severity: LogSeverity.Error, count: 5 },
  { time: LAST_BUCKET, severity: LogSeverity.Error, count: 7 },
];

const ZOOM_OUT_HINT: string = "Double-click to zoom out";

function bucketAt(time: string): HTMLElement {
  return screen.getByTestId(`bucket-${time}`);
}

/** What recharts was told to do with the tooltip on the last render. */
function tooltipActiveProp(): string | null {
  return screen.getByTestId("tooltip").getAttribute("data-active");
}

function isTooltipSuppressed(): boolean {
  return tooltipActiveProp() === "false";
}

function selectionBand(): HTMLElement | null {
  return screen.queryByTestId("selection-band");
}

interface RenderedHistogram {
  onTimeRangeSelect: MockFunction;
  onZoomOut: MockFunction;
}

function renderHistogram(
  options: { canSelect?: boolean; canZoomOut?: boolean } = {},
): RenderedHistogram {
  const onTimeRangeSelect: MockFunction = getJestMockFunction();
  const onZoomOut: MockFunction = getJestMockFunction();

  render(
    <LogsHistogram
      buckets={BUCKETS}
      isLoading={false}
      {...(options.canSelect === false
        ? {}
        : { onTimeRangeSelect: onTimeRangeSelect })}
      {...(options.canZoomOut ? { onZoomOut: onZoomOut } : {})}
    />,
  );

  return { onTimeRangeSelect: onTimeRangeSelect, onZoomOut: onZoomOut };
}

describe("LogsHistogram — dragging out a time range", () => {
  afterEach(() => {
    cleanup();
  });

  /*
   * The reported bug: the tooltip parks itself over the bars while the reader
   * is dragging, hiding the very volumes they are dragging across to pick the
   * range with.
   */
  describe("the tooltip while a selection is in progress", () => {
    test("stays under recharts' own control before anything is dragged", () => {
      renderHistogram();

      expect(tooltipActiveProp()).toBe("undefined");
    });

    test("is held shut for the length of the drag", () => {
      renderHistogram();

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      expect(isTooltipSuppressed()).toBe(true);

      fireEvent.mouseMove(bucketAt(MIDDLE_BUCKET));
      expect(isTooltipSuppressed()).toBe(true);

      fireEvent.mouseMove(bucketAt(LAST_BUCKET));
      expect(isTooltipSuppressed()).toBe(true);
    });

    test("comes back the moment the reader lets go", () => {
      renderHistogram();

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      fireEvent.mouseMove(bucketAt(LAST_BUCKET));
      fireEvent.mouseUp(bucketAt(LAST_BUCKET));

      expect(tooltipActiveProp()).toBe("undefined");
    });

    /*
     * The stuck-tooltip case from the report: the pointer leaves a 120px-tall
     * chart mid-drag and is released somewhere else on the page, so the
     * chart's own mouseup never fires.
     */
    test("comes back when the pointer is released outside the chart", () => {
      renderHistogram();

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      fireEvent.mouseMove(bucketAt(LAST_BUCKET));
      expect(isTooltipSuppressed()).toBe(true);

      fireEvent.mouseUp(document.body);

      expect(tooltipActiveProp()).toBe("undefined");
      expect(selectionBand()).toBeNull();
    });

    test("comes back after a click that selected nothing", () => {
      renderHistogram();

      fireEvent.mouseDown(bucketAt(MIDDLE_BUCKET));
      fireEvent.mouseUp(bucketAt(MIDDLE_BUCKET));

      expect(tooltipActiveProp()).toBe("undefined");
    });

    /*
     * A chart the parent cannot zoom never starts a drag, so nothing should
     * ever take the tooltip away from the reader.
     */
    test("is never suppressed on a chart that cannot be zoomed", () => {
      renderHistogram({ canSelect: false });

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      fireEvent.mouseMove(bucketAt(LAST_BUCKET));

      expect(tooltipActiveProp()).toBe("undefined");
      expect(selectionBand()).toBeNull();
    });
  });

  describe("the selection band", () => {
    test("is only painted once the pointer has moved off the first bucket", () => {
      renderHistogram();

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      expect(selectionBand()).toBeNull();

      fireEvent.mouseMove(bucketAt(LAST_BUCKET));

      expect(selectionBand()?.getAttribute("data-x1")).toBe(FIRST_BUCKET);
      expect(selectionBand()?.getAttribute("data-x2")).toBe(LAST_BUCKET);
    });

    test("follows the pointer back and forth across the chart", () => {
      renderHistogram();

      fireEvent.mouseDown(bucketAt(LAST_BUCKET));
      fireEvent.mouseMove(bucketAt(FIRST_BUCKET));
      expect(selectionBand()?.getAttribute("data-x2")).toBe(FIRST_BUCKET);

      fireEvent.mouseMove(bucketAt(MIDDLE_BUCKET));
      expect(selectionBand()?.getAttribute("data-x2")).toBe(MIDDLE_BUCKET);
    });

    test("is cleared once the range has been handed to the parent", () => {
      renderHistogram();

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      fireEvent.mouseMove(bucketAt(LAST_BUCKET));
      fireEvent.mouseUp(bucketAt(LAST_BUCKET));

      expect(selectionBand()).toBeNull();
    });
  });

  describe("handing the range to the parent", () => {
    test("reports the dragged window", () => {
      const { onTimeRangeSelect } = renderHistogram();

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      fireEvent.mouseMove(bucketAt(LAST_BUCKET));
      fireEvent.mouseUp(bucketAt(LAST_BUCKET));

      expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
      const [start, end] = onTimeRangeSelect.mock.calls[0] as [Date, Date];
      expect(start.toISOString()).toBe(new Date(FIRST_BUCKET).toISOString());
      expect(end.toISOString()).toBe(new Date(LAST_BUCKET).toISOString());
    });

    test("orders a right-to-left drag from earlier to later", () => {
      const { onTimeRangeSelect } = renderHistogram();

      fireEvent.mouseDown(bucketAt(LAST_BUCKET));
      fireEvent.mouseMove(bucketAt(FIRST_BUCKET));
      fireEvent.mouseUp(bucketAt(FIRST_BUCKET));

      const [start, end] = onTimeRangeSelect.mock.calls[0] as [Date, Date];
      expect(start.toISOString()).toBe(new Date(FIRST_BUCKET).toISOString());
      expect(end.toISOString()).toBe(new Date(LAST_BUCKET).toISOString());
    });

    /*
     * A mouseup inside the chart is seen twice — once by the chart, then by
     * the page-wide listener that catches releases outside it. Zooming twice
     * off one drag would leave the reader on the wrong window.
     */
    test("zooms once even though the release is seen twice", () => {
      const { onTimeRangeSelect } = renderHistogram();

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      fireEvent.mouseMove(bucketAt(LAST_BUCKET));
      fireEvent.mouseUp(bucketAt(LAST_BUCKET));

      expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
    });

    test("still reports a drag that ended off the chart", () => {
      const { onTimeRangeSelect } = renderHistogram();

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      fireEvent.mouseMove(bucketAt(MIDDLE_BUCKET));
      fireEvent.mouseUp(document.body);

      expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
      const [start, end] = onTimeRangeSelect.mock.calls[0] as [Date, Date];
      expect(start.toISOString()).toBe(new Date(FIRST_BUCKET).toISOString());
      expect(end.toISOString()).toBe(new Date(MIDDLE_BUCKET).toISOString());
    });

    test("treats a click that never moved as no selection at all", () => {
      const { onTimeRangeSelect } = renderHistogram();

      fireEvent.mouseDown(bucketAt(MIDDLE_BUCKET));
      fireEvent.mouseUp(bucketAt(MIDDLE_BUCKET));

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
    });

    /*
     * Releases go on arriving from the page for as long as the listener is
     * attached; only the one that ends a drag may zoom.
     */
    test("ignores releases once the drag is over", () => {
      const { onTimeRangeSelect } = renderHistogram();

      fireEvent.mouseDown(bucketAt(FIRST_BUCKET));
      fireEvent.mouseMove(bucketAt(LAST_BUCKET));
      fireEvent.mouseUp(document.body);
      fireEvent.mouseUp(document.body);
      fireEvent.mouseUp(document.body);

      expect(onTimeRangeSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe("double-click to zoom back out", () => {
    test("puts the reader back on the window they came from", () => {
      const { onZoomOut } = renderHistogram({ canZoomOut: true });

      fireEvent.doubleClick(screen.getByTestId("bar-chart"));

      expect(onZoomOut).toHaveBeenCalledTimes(1);
    });

    test("offers the affordance only once there is something to undo", () => {
      renderHistogram();

      expect(screen.queryByText(ZOOM_OUT_HINT)).toBeNull();

      cleanup();
      renderHistogram({ canZoomOut: true });

      expect(screen.queryByText(ZOOM_OUT_HINT)).not.toBeNull();
    });

    test("is inert on a chart that is already on its original window", () => {
      renderHistogram();

      // The chart is not zoomed, so this must be a no-op rather than a crash.
      fireEvent.doubleClick(screen.getByTestId("bar-chart"));

      expect(screen.queryByText(ZOOM_OUT_HINT)).toBeNull();
    });

    /*
     * A double-click is two mousedown/mouseup pairs on one bucket. Neither
     * pair moves, so neither may be mistaken for a drag.
     */
    test("does not zoom in on its own clicks", () => {
      const { onTimeRangeSelect, onZoomOut } = renderHistogram({
        canZoomOut: true,
      });

      fireEvent.mouseDown(bucketAt(MIDDLE_BUCKET));
      fireEvent.mouseUp(bucketAt(MIDDLE_BUCKET));
      fireEvent.mouseDown(bucketAt(MIDDLE_BUCKET));
      fireEvent.mouseUp(bucketAt(MIDDLE_BUCKET));
      fireEvent.doubleClick(bucketAt(MIDDLE_BUCKET));

      expect(onTimeRangeSelect).not.toHaveBeenCalled();
      expect(onZoomOut).toHaveBeenCalledTimes(1);
    });
  });
});
