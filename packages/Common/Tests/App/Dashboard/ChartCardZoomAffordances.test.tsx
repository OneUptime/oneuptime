import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * What ChartCard (the trend card of the Service, RUM, Cloud, Serverless and
 * Database overviews) promises about the page's zoom (issue #4105):
 *
 * - its header names a gesture only where its body takes one. The chart
 *   takes the drag (and, while the page is zoomed, the double-click); the
 *   "No data in this time range" box takes the double-click while the page
 *   is zoomed. The loading skeleton takes neither, and nor does the empty
 *   box with nothing to reset: a "Drag to zoom" over them promised a drag
 *   that did nothing.
 * - while its empty box takes the double-click, the box's text is not
 *   selectable: a double-click on text also selects a word, and the hosts
 *   keep this very box on screen through the refetch the reset starts (for
 *   good, if the page's own range is quiet too), so the word stayed
 *   highlighted.
 */

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: () => {
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

const WITH_DATA: Array<SeriesPoint> = [
  {
    seriesName: "Requests",
    data: [{ x: new Date("2026-09-28T10:05:00.000Z"), y: 12 }],
  },
];
const QUIET: Array<SeriesPoint> = [{ seriesName: "Requests", data: [] }];

const EMPTY_TEXT: string = "No data in this time range";

interface CardState {
  series: Array<SeriesPoint>;
  loading?: boolean | undefined;
  windowStart?: Date | null | undefined;
}

function card(state: CardState): React.ReactElement {
  return (
    <ChartCard
      title="Requests"
      icon={IconProp.ChartBar}
      iconColor="blue"
      series={state.series}
      windowStart={state.windowStart === undefined ? START : state.windowStart}
      windowEnd={END}
      syncId="service-overview"
      loading={state.loading}
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

function onPage(isZoomed: boolean, state: CardState): React.ReactElement {
  return (
    <TimeRangeZoomProvider zoom={zoom(isZoomed)}>
      {card(state)}
    </TimeRangeZoomProvider>
  );
}

function hint(): HTMLElement | null {
  return screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
}

function emptyBox(): HTMLElement {
  return screen.getByText(EMPTY_TEXT);
}

// The icon box at the end of the header, which sets the header's height.
function headerIcon(container: HTMLElement): HTMLElement {
  const icon: Element | null = container.querySelector(".h-7.w-7");
  if (!icon) {
    throw new Error("The header has no icon box");
  }
  return icon as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe("ChartCard names a gesture only where its body takes one", () => {
  test("over the chart: Drag to zoom", () => {
    render(onPage(false, { series: WITH_DATA }));

    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(hint()).toHaveTextContent("Drag to zoom");
  });

  test("over the chart on a zoomed page: Double-click to reset", () => {
    render(onPage(true, { series: WITH_DATA }));

    expect(hint()).toHaveTextContent("Double-click to reset");
  });

  test("over the loading skeleton: nothing, as it takes no drag", () => {
    render(onPage(false, { series: [], loading: true }));

    expect(screen.queryByTestId("line-chart")).toBeNull();
    expect(hint()).toBeNull();
  });

  test("over the loading skeleton on a zoomed page: nothing, as it takes no double-click either", () => {
    render(onPage(true, { series: [], loading: true }));

    expect(hint()).toBeNull();
  });

  test("with no window yet (the skeleton): nothing", () => {
    render(onPage(false, { series: WITH_DATA, windowStart: null }));

    expect(hint()).toBeNull();
  });

  test("over the empty box with nothing to reset: nothing, as it takes no drag", () => {
    render(onPage(false, { series: QUIET }));

    expect(emptyBox()).toBeInTheDocument();
    expect(hint()).toBeNull();
  });

  test("over the empty box on a zoomed page: Double-click to reset, which it takes", () => {
    render(onPage(true, { series: QUIET }));

    expect(hint()).toHaveTextContent("Double-click to reset");
  });

  test("the hint comes and goes without moving the header: the icon box sets its height in every state", () => {
    const states: Array<[boolean, CardState]> = [
      [false, { series: WITH_DATA }],
      [false, { series: [], loading: true }],
      [false, { series: QUIET }],
      [true, { series: QUIET }],
    ];
    for (const [isZoomed, state] of states) {
      const { container, unmount } = render(onPage(isZoomed, state));
      expect(headerIcon(container)).toBeInTheDocument();
      // The row the hint sits in is the icon's own row.
      expect(headerIcon(container).parentElement).toHaveClass("items-center");
      unmount();
    }
  });

  test("once the first data lands, the chart names its drag", () => {
    const { rerender } = render(onPage(false, { series: [], loading: true }));
    expect(hint()).toBeNull();

    rerender(onPage(false, { series: WITH_DATA }));

    expect(hint()).toHaveTextContent("Drag to zoom");
  });

  test("a reset back to a quiet range takes the hint away from the empty box", () => {
    const { rerender } = render(onPage(true, { series: QUIET }));
    expect(hint()).toHaveTextContent("Double-click to reset");

    rerender(onPage(false, { series: QUIET }));

    expect(hint()).toBeNull();
  });
});

describe("ChartCard's empty box takes the reset double-click without selecting a word", () => {
  test("while the page is zoomed, its text is not selectable", () => {
    render(onPage(true, { series: QUIET }));

    expect(emptyBox()).toHaveClass("select-none");
  });

  test("and the double-click still resets the page", () => {
    const resetZoom: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider
        zoom={zoom(true, resetZoom as unknown as () => void)}
      >
        {card({ series: QUIET })}
      </TimeRangeZoomProvider>,
    );

    fireEvent.doubleClick(emptyBox());

    expect(resetZoom).toHaveBeenCalledTimes(1);
  });

  test("with nothing to reset, its text stays selectable", () => {
    render(onPage(false, { series: QUIET }));

    expect(emptyBox()).not.toHaveClass("select-none");
  });

  test("on a page that does not zoom, its text stays selectable", () => {
    render(card({ series: QUIET }));

    expect(emptyBox()).not.toHaveClass("select-none");
  });

  test("the reset hands the text back: selectable again once the page is back on its range", () => {
    const { rerender } = render(onPage(true, { series: QUIET }));
    const box: HTMLElement = emptyBox();
    expect(box).toHaveClass("select-none");

    rerender(onPage(false, { series: QUIET }));

    // The very same box, kept on screen through the reset.
    expect(emptyBox()).toBe(box);
    expect(box).not.toHaveClass("select-none");
  });

  test("its look is otherwise unchanged", () => {
    render(onPage(true, { series: QUIET }));

    expect(emptyBox()).toHaveClass(
      "flex",
      "h-44",
      "items-center",
      "justify-center",
      "rounded-md",
      "bg-gray-50",
      "text-sm",
      "text-gray-400",
    );
  });
});
