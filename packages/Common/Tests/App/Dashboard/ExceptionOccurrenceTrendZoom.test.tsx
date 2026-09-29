/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on an exception's Overview: the Occurrence Trend is a time
 * chart, so a drag across it zooms into that stretch and a double-click (or
 * "Reset zoom" beside the window control) goes back to the preset. Nothing
 * else on the Overview is windowed, so the zoom is the card's own - and the
 * chart must ask the histogram again for exactly the zoomed window, in finer
 * buckets, still scoped to this one exception.
 *
 * Recharts is stood in for with a chart that lays each bar out as a div and
 * forwards the mouse events recharts does.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error?.message || "Failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

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

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: StubChartProps) => {
      return react.createElement(
        "div",
        { "data-testid": "trend-bars" },
        props.data.map((row: StubRow) => {
          return react.createElement("div", {
            key: row.time,
            "data-testid": `bar-${row.time}`,
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
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: (props: { x1: string; x2: string }) => {
      return react.createElement("div", {
        "data-testid": "selection-band",
        "data-x1": props.x1,
        "data-x2": props.x2,
      });
    },
  };
});

import ExceptionOccurrenceTrend from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionOccurrenceTrend";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const FINGERPRINT: string = "9f86d081884c7d659a2feaa0c55ad015";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";
const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

type PostArgs = { url: { toString: () => string }; data: Record<string, any> };

// When set, the histogram answers with no occurrences at all.
let answerEmpty: boolean = false;

/*
 * Occurrences in every bucket the request asks for, so a zoomed window
 * always has bars to draw (and so a request is the only thing a test needs
 * to read back).
 */
function bucketsFor(body: Record<string, any>): Array<Record<string, any>> {
  const startMs: number = new Date(body["startTime"]).getTime();
  const endMs: number = new Date(body["endTime"]).getTime();
  const bucketMs: number = Number(body["bucketSizeInMinutes"]) * 60 * 1000;
  const buckets: Array<Record<string, any>> = [];

  for (
    let timeMs: number = Math.floor(startMs / bucketMs) * bucketMs;
    timeMs < endMs;
    timeMs += bucketMs
  ) {
    buckets.push({
      time: new Date(timeMs).toISOString(),
      series: "unhandled",
      count: 2,
    });
  }

  return buckets;
}

function requests(): Array<Record<string, any>> {
  return postMock.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as PostArgs).data;
  });
}

function lastRequest(): Record<string, any> {
  const all: Array<Record<string, any>> = requests();
  expect(all.length).toBeGreaterThan(0);
  return all[all.length - 1]!;
}

function spanOf(body: Record<string, any>): number {
  return (
    new Date(body["endTime"]).getTime() - new Date(body["startTime"]).getTime()
  );
}

async function renderTrend(): Promise<void> {
  render(
    <ExceptionOccurrenceTrend
      fingerprint={FINGERPRINT}
      primaryEntityId={new ObjectID(SERVICE_ID)}
    />,
  );

  await waitFor(() => {
    expect(screen.getByTestId("exception-trend-chart")).toBeInTheDocument();
  });
}

function bar(iso: string): HTMLElement {
  return screen.getByTestId(`bar-${iso}`);
}

function drag(fromIso: string, toIso: string): void {
  fireEvent.mouseDown(bar(fromIso));
  fireEvent.mouseMove(bar(toIso));
  fireEvent.mouseUp(bar(toIso));
}

function click(iso: string): void {
  fireEvent.mouseDown(bar(iso));
  fireEvent.mouseUp(bar(iso));
}

async function waitForRequestCount(count: number): Promise<void> {
  await waitFor(() => {
    expect(postMock).toHaveBeenCalledTimes(count);
  });
  await waitFor(() => {
    expect(screen.queryByTestId("exception-trend-chart")).not.toBeNull();
  });
}

function resetButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  answerEmpty = false;
  postMock.mockReset();
  postMock.mockImplementation(async (args: PostArgs) => {
    return {
      data: { buckets: answerEmpty ? [] : bucketsFor(args.data) },
    };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a drag zooms the trend into that stretch", () => {
  test("the histogram is asked again for exactly the dragged window, in finer bars, scoped the same", async () => {
    await renderTrend();

    expect(lastRequest()).toMatchObject({
      bucketSizeInMinutes: 30,
      fingerprints: [FINGERPRINT],
      serviceIds: [SERVICE_ID],
    });
    expect(spanOf(lastRequest())).toBe(DAY_MS);

    // Two half-hour bars: 10:00 and 10:30.
    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");

    await waitForRequestCount(2);
    expect(lastRequest()).toEqual({
      startTime: "2026-09-28T10:00:00.000Z",
      endTime: "2026-09-28T11:00:00.000Z",
      // An hour in at most 48 bars: two-minute bars.
      bucketSizeInMinutes: 2,
      fingerprints: [FINGERPRINT],
      serviceIds: [SERVICE_ID],
    });
  });

  test("the zoomed chart draws the zoomed window's bars", async () => {
    await renderTrend();

    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");
    await waitForRequestCount(2);

    expect(bar("2026-09-28T10:00:00.000Z")).toBeInTheDocument();
    expect(bar("2026-09-28T10:58:00.000Z")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-2026-09-28T09:30:00.000Z")).toBeNull();
  });

  test("the description names the zoomed window", async () => {
    await renderTrend();

    expect(
      screen.getByText("96 occurrences in the last 24 hours"),
    ).toBeInTheDocument();

    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");
    await waitForRequestCount(2);

    expect(
      screen.getByText(/^60 occurrences between .+ and .+$/),
    ).toBeInTheDocument();
  });

  test("a click on one bar zooms into that bar's half hour", async () => {
    await renderTrend();

    click("2026-09-28T10:00:00.000Z");

    await waitForRequestCount(2);
    expect(lastRequest()).toMatchObject({
      startTime: "2026-09-28T10:00:00.000Z",
      endTime: "2026-09-28T10:30:00.000Z",
      bucketSizeInMinutes: 1,
    });
  });

  test("the band shows what is being picked while the drag lasts", async () => {
    await renderTrend();

    fireEvent.mouseDown(bar("2026-09-28T08:00:00.000Z"));
    fireEvent.mouseMove(bar("2026-09-28T09:00:00.000Z"));

    expect(screen.getByTestId("selection-band")).toHaveAttribute(
      "data-x1",
      "2026-09-28T08:00:00.000Z",
    );
    expect(screen.getByTestId("selection-band")).toHaveAttribute(
      "data-x2",
      "2026-09-28T09:00:00.000Z",
    );

    fireEvent.mouseUp(bar("2026-09-28T09:00:00.000Z"));
    expect(screen.queryByTestId("selection-band")).toBeNull();
  });

  test("a drag into the week preset uses bars sized for the dragged span", async () => {
    await renderTrend();

    fireEvent.click(screen.getByTestId("exception-trend-window-7d"));
    await waitForRequestCount(2);
    expect(lastRequest()).toMatchObject({ bucketSizeInMinutes: 240 });

    // Two four-hour bars: eight hours in ten-minute bars.
    drag("2026-09-27T08:00:00.000Z", "2026-09-27T12:00:00.000Z");

    await waitForRequestCount(3);
    expect(lastRequest()).toMatchObject({
      startTime: "2026-09-27T08:00:00.000Z",
      endTime: "2026-09-27T16:00:00.000Z",
      bucketSizeInMinutes: 10,
    });
  });
});

describe("the way back to the preset", () => {
  test("Reset zoom appears beside the window control once zoomed, and asks for the whole preset again", async () => {
    await renderTrend();

    expect(resetButton()).toBeNull();

    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");
    await waitForRequestCount(2);

    expect(resetButton()).toBeInTheDocument();
    expect(resetButton()).toHaveAttribute(
      "title",
      `Go back to ${TimeRange.PAST_ONE_DAY}, the time range before the zoom`,
    );

    fireEvent.click(resetButton()!);

    await waitForRequestCount(3);
    expect(lastRequest()).toMatchObject({ bucketSizeInMinutes: 30 });
    expect(spanOf(lastRequest())).toBe(DAY_MS);
    // The preset still ends now, not when the zoom was made.
    expect(new Date(lastRequest()["endTime"]).getTime()).toBeGreaterThanOrEqual(
      NOW.getTime(),
    );
    expect(resetButton()).toBeNull();
    expect(
      screen.getByText(/occurrences in the last 24 hours$/),
    ).toBeInTheDocument();
  });

  test("a double-click on the chart does the same", async () => {
    await renderTrend();

    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");
    await waitForRequestCount(2);

    fireEvent.doubleClick(screen.getByTestId("exception-trend-plot"));

    await waitForRequestCount(3);
    expect(spanOf(lastRequest())).toBe(DAY_MS);
    expect(resetButton()).toBeNull();
  });

  test("the clicks a double-click is made of do not zoom in again", async () => {
    await renderTrend();

    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");
    await waitForRequestCount(2);

    click("2026-09-28T10:20:00.000Z");
    click("2026-09-28T10:20:00.000Z");
    fireEvent.doubleClick(screen.getByTestId("exception-trend-plot"));
    act(() => {
      jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
    });

    await waitForRequestCount(3);
    expect(spanOf(lastRequest())).toBe(DAY_MS);
  });

  test("nested zooms go back to the preset in one step", async () => {
    await renderTrend();

    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");
    await waitForRequestCount(2);
    drag("2026-09-28T10:10:00.000Z", "2026-09-28T10:20:00.000Z");
    await waitForRequestCount(3);
    expect(lastRequest()).toMatchObject({
      startTime: "2026-09-28T10:10:00.000Z",
      endTime: "2026-09-28T10:22:00.000Z",
    });

    fireEvent.click(resetButton()!);

    await waitForRequestCount(4);
    expect(spanOf(lastRequest())).toBe(DAY_MS);
  });

  test("a double-click with nothing zoomed asks for nothing", async () => {
    await renderTrend();

    fireEvent.doubleClick(screen.getByTestId("exception-trend-plot"));
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("picking another preset ends the zoom", async () => {
    await renderTrend();

    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");
    await waitForRequestCount(2);

    fireEvent.click(screen.getByTestId("exception-trend-window-30d"));

    await waitForRequestCount(3);
    expect(lastRequest()).toMatchObject({ bucketSizeInMinutes: 1440 });
    expect(spanOf(lastRequest())).toBe(30 * DAY_MS);
    expect(resetButton()).toBeNull();
    expect(screen.getByTestId("exception-trend-window-30d")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("the hint names the gesture", () => {
  test("drag before a zoom, drag or double-click after", async () => {
    await renderTrend();

    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Drag to zoom",
    );
    expect(
      screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID),
    ).not.toHaveTextContent("double-click");

    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");
    await waitForRequestCount(2);

    expect(screen.getByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toHaveTextContent(
      "Double-click to reset",
    );
  });
});

describe("a zoom into a stretch with no occurrences", () => {
  test("says so, and the empty state takes the double-click back", async () => {
    await renderTrend();

    answerEmpty = true;
    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");

    const empty: HTMLElement = await screen.findByTestId(
      "exception-trend-empty",
    );
    expect(empty).toHaveTextContent("No occurrences in the selected window");
    expect(empty).toHaveTextContent("reset the zoom to see the last 24 hours");

    answerEmpty = false;
    fireEvent.doubleClick(empty);

    await waitForRequestCount(3);
    expect(spanOf(lastRequest())).toBe(DAY_MS);
  });

  test("an empty preset still suggests a longer window, and ignores a double-click", async () => {
    answerEmpty = true;
    render(<ExceptionOccurrenceTrend fingerprint={FINGERPRINT} />);

    const empty: HTMLElement = await screen.findByTestId(
      "exception-trend-empty",
    );
    expect(empty).toHaveTextContent("No occurrences in the last 24 hours");
    expect(empty).toHaveTextContent("Try a longer window");

    fireEvent.doubleClick(empty);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});

describe("the card's zoom is its own", () => {
  test("a page zoom around the card is never touched by it", async () => {
    const pageSelect: MockFunction = getJestMockFunction();
    const pageReset: MockFunction = getJestMockFunction();
    const pageZoom: TimeRangeZoom = {
      isZoomed: true,
      rangeBeforeZoom: { range: TimeRange.PAST_ONE_WEEK },
      zoomToTimeRange: (startTime: Date, endTime: Date): void => {
        pageSelect(startTime, endTime);
      },
      resetZoom: (): void => {
        pageReset();
      },
    };

    render(
      <TimeRangeZoomProvider zoom={pageZoom}>
        <ExceptionOccurrenceTrend fingerprint={FINGERPRINT} />
      </TimeRangeZoomProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("exception-trend-chart")).toBeInTheDocument();
    });

    // The page is zoomed; the card is not, so it offers no reset of its own.
    expect(resetButton()).toBeNull();

    drag("2026-09-28T10:00:00.000Z", "2026-09-28T10:30:00.000Z");
    await waitForRequestCount(2);

    // Only the card's own zoom shows a reset here, and it undoes the card's.
    expect(
      screen.getAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toHaveLength(1);
    fireEvent.click(resetButton()!);
    await waitForRequestCount(3);
    expect(spanOf(lastRequest())).toBe(DAY_MS);

    expect(pageSelect).not.toHaveBeenCalled();
    expect(pageReset).not.toHaveBeenCalled();
  });

  test("without a fingerprint there is no chart, no control and no zoom", async () => {
    render(<ExceptionOccurrenceTrend fingerprint={undefined} />);

    expect(screen.queryByTestId("exception-trend-plot")).toBeNull();
    expect(resetButton()).toBeNull();
    expect(screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID)).toBeNull();
    await waitFor(() => {
      expect(postMock).not.toHaveBeenCalled();
    });
  });
});
