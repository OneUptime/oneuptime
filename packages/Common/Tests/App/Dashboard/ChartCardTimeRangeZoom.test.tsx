import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on ChartCard, the trend card of the Service, RUM, Cloud,
 * Serverless and Database overviews. Its line chart takes the page's zoom
 * on its own (the chart library resolves it); the card adds:
 *
 *   - the "Drag to zoom" hint in its header, revealed while the pointer is
 *     over the card, so the gesture is discoverable;
 *   - a double-click on its "No data in this time range" box resets the
 *     zoom, since a zoom into a quiet stretch leaves no chart to
 *     double-click.
 */

const lineChartMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      lineChartMock(props);
      return <div data-testid="line-chart" />;
    },
  };
});

import ChartCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import IconProp from "../../../Types/Icon/IconProp";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import TimeRange from "../../../Types/Time/TimeRange";

const START: Date = new Date("2026-09-28T10:00:00.000Z");
const END: Date = new Date("2026-09-28T11:00:00.000Z");

const SERIES: Array<SeriesPoint> = [
  {
    seriesName: "Requests",
    data: [{ x: new Date("2026-09-28T10:05:00.000Z"), y: 12 }],
  },
];

function card(series: Array<SeriesPoint> = SERIES): React.ReactElement {
  return (
    <ChartCard
      title="Requests"
      icon={IconProp.ChartBar}
      iconColor="blue"
      series={series}
      windowStart={START}
      windowEnd={END}
      syncId="service-overview"
    />
  );
}

function zoom(
  isZoomed: boolean,
  resetZoom: () => void = () => {},
): TimeRangeZoom {
  return {
    isZoomed: isZoomed,
    rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_HOUR } : null,
    zoomToTimeRange: () => {},
    resetZoom: resetZoom,
  };
}

afterEach(() => {
  cleanup();
  lineChartMock.mockReset();
});

describe("ChartCard on a page that zooms", () => {
  test("names the drag gesture in its header, revealed on hover", () => {
    render(
      <TimeRangeZoomProvider zoom={zoom(false)}>
        {card()}
      </TimeRangeZoomProvider>,
    );

    const hint: HTMLElement = screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
    expect(hint).toHaveTextContent("Drag to zoom");
    expect(hint).toHaveClass("group-hover/zoomhint:opacity-100");
    expect(hint.closest('[class~="group/zoomhint"]')).not.toBeNull();
  });

  test("names the reset too while the page is zoomed", () => {
    render(
      <TimeRangeZoomProvider zoom={zoom(true)}>{card()}</TimeRangeZoomProvider>,
    );

    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Double-click to reset",
    );
  });

  test("shows no hint on a page that does not zoom", () => {
    render(card());

    expect(screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toBeNull();
  });

  test("hands the chart no handlers of its own, so the chart takes the page's", () => {
    render(
      <TimeRangeZoomProvider zoom={zoom(true)}>{card()}</TimeRangeZoomProvider>,
    );

    const props: Record<string, unknown> = lineChartMock.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(props["onTimeRangeSelect"]).toBeUndefined();
    expect(props["onTimeRangeReset"]).toBeUndefined();
    expect(props["disableTimeRangeZoom"]).toBeUndefined();
  });

  test("a double-click on the empty state resets a zoom that found no data", () => {
    const resetZoom: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider
        zoom={zoom(true, resetZoom as unknown as () => void)}
      >
        {card([{ seriesName: "Requests", data: [] }])}
      </TimeRangeZoomProvider>,
    );

    fireEvent.doubleClick(screen.getByText("No data in this time range"));

    expect(resetZoom).toHaveBeenCalledTimes(1);
  });

  test("a double-click on the empty state does nothing when the page is not zoomed", () => {
    const resetZoom: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider
        zoom={zoom(false, resetZoom as unknown as () => void)}
      >
        {card([{ seriesName: "Requests", data: [] }])}
      </TimeRangeZoomProvider>,
    );

    fireEvent.doubleClick(screen.getByText("No data in this time range"));

    expect(resetZoom).not.toHaveBeenCalled();
  });
});
