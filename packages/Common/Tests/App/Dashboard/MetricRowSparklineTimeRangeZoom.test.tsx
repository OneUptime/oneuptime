import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import MetricRow from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow";
import { SparklinePoint } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricSparkline";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import TimeRange from "../../../Types/Time/TimeRange";
import ValueFormatter from "../../../Utils/ValueFormatter";

/*
 * Issue #4105 leaves one kind of time chart out on purpose: the sparkline
 * in each row of a metric list (the Metrics page and every resource's
 * Metrics tab). The row is a button that opens the metric in the metric
 * explorer, where every chart zooms; a drag or a double-click across a
 * 160x40 thumbnail inside that button would fight the row's own click.
 * These pin that the sparkline stays out of the zoom even when a zooming
 * page encloses the list.
 */

const METRIC: MetricType = {
  name: "http.server.request.duration",
  unit: "ms",
} as MetricType;

const POINTS: Array<SparklinePoint> = [
  { time: "2026-09-28T11:00:00.000Z", value: 12 },
  { time: "2026-09-28T11:15:00.000Z", value: 18 },
  { time: "2026-09-28T11:30:00.000Z", value: 9 },
  { time: "2026-09-28T11:45:00.000Z", value: 21 },
];

interface ZoomingPage {
  zoom: TimeRangeZoom;
  zoomToTimeRange: MockFunction;
  resetZoom: MockFunction;
}

function zoomingPage(): ZoomingPage {
  const zoomToTimeRange: MockFunction = getJestMockFunction();
  const resetZoom: MockFunction = getJestMockFunction();
  return {
    zoomToTimeRange: zoomToTimeRange,
    resetZoom: resetZoom,
    // Already zoomed, so a reset would be on offer to anything that took it.
    zoom: {
      isZoomed: true,
      rangeBeforeZoom: { range: TimeRange.PAST_ONE_HOUR },
      zoomToTimeRange: zoomToTimeRange as unknown as (
        startTime: Date,
        endTime: Date,
      ) => void,
      resetZoom: resetZoom as unknown as () => void,
    },
  };
}

// MetricSparkline's own box (w-40 h-10): the only part a reader could drag.
function sparklineBox(row: HTMLElement): HTMLElement {
  const box: HTMLElement | null = row.querySelector(".w-40.h-10");
  if (!box) {
    throw new Error("The row rendered no sparkline");
  }
  return box;
}

function dragAndDoubleClick(target: HTMLElement): void {
  fireEvent.mouseDown(target, { clientX: 10, clientY: 10, button: 0 });
  fireEvent.mouseMove(target, { clientX: 60, clientY: 10, buttons: 1 });
  fireEvent.mouseUp(target, { clientX: 120, clientY: 10, button: 0 });
  fireEvent.doubleClick(target);
}

afterEach(() => {
  cleanup();
});

describe("metric list sparklines stay out of the page's zoom", () => {
  test("a drag or a double-click on a clickable row's sparkline never zooms or resets the page; the row still opens", () => {
    const page: ZoomingPage = zoomingPage();
    const onClick: MockFunction = getJestMockFunction();

    render(
      <TimeRangeZoomProvider zoom={page.zoom}>
        <MetricRow metric={METRIC} sparklinePoints={POINTS} onClick={onClick} />
      </TimeRangeZoomProvider>,
    );

    const row: HTMLElement = screen.getByTestId("metric-row");
    expect(row.tagName).toBe("BUTTON");

    dragAndDoubleClick(sparklineBox(row));

    expect(page.zoomToTimeRange).not.toHaveBeenCalled();
    expect(page.resetZoom).not.toHaveBeenCalled();

    // The row's own click is untouched: it opens the metric, once per click.
    fireEvent.click(sparklineBox(row));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("a plain row (no drill-down) keeps its sparkline out of the zoom as well", () => {
    const page: ZoomingPage = zoomingPage();

    render(
      <TimeRangeZoomProvider zoom={page.zoom}>
        <MetricRow metric={METRIC} sparklinePoints={POINTS} />
      </TimeRangeZoomProvider>,
    );

    const row: HTMLElement = screen.getByTestId("metric-row");
    expect(row.tagName).toBe("DIV");

    dragAndDoubleClick(sparklineBox(row));

    expect(page.zoomToTimeRange).not.toHaveBeenCalled();
    expect(page.resetZoom).not.toHaveBeenCalled();
  });

  test("the row advertises no zoom: no hint, no reset, no drag cursor", () => {
    const page: ZoomingPage = zoomingPage();

    render(
      <TimeRangeZoomProvider zoom={page.zoom}>
        <MetricRow
          metric={METRIC}
          sparklinePoints={POINTS}
          onClick={() => {
            return undefined;
          }}
        />
      </TimeRangeZoomProvider>,
    );

    const row: HTMLElement = screen.getByTestId("metric-row");
    expect(screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toBeNull();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(row).not.toHaveTextContent("Drag to zoom");
    expect(sparklineBox(row)).not.toHaveClass("cursor-crosshair");
    expect(row.querySelector(".cursor-crosshair")).toBeNull();
  });

  test("hovering the sparkline still reads the value under the cursor", () => {
    render(
      <TimeRangeZoomProvider zoom={zoomingPage().zoom}>
        <MetricRow
          metric={METRIC}
          sparklinePoints={POINTS}
          lastValue={21}
          onClick={() => {
            return undefined;
          }}
        />
      </TimeRangeZoomProvider>,
    );

    const box: HTMLElement = sparklineBox(screen.getByTestId("metric-row"));
    /*
     * jsdom lays nothing out, so give the box a width for the hover to map
     * the cursor across.
     */
    box.getBoundingClientRect = (): DOMRect => {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 160,
        bottom: 40,
        width: 160,
        height: 40,
        toJSON: () => {
          return {};
        },
      } as DOMRect;
    };

    const formatted: (value: number) => string = (value: number): string => {
      return ValueFormatter.formatValue(value, "ms", {
        metricName: METRIC.name || "",
      });
    };
    expect(screen.getByText(formatted(21))).toBeInTheDocument();

    fireEvent.mouseMove(box, { clientX: 0, clientY: 10 });

    // The first point replaces the last value while hovered.
    expect(screen.getByText(formatted(12))).toBeInTheDocument();
    expect(screen.queryByText(formatted(21))).toBeNull();
  });
});
