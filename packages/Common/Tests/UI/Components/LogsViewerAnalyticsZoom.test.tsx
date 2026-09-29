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
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the logs explorer: the volume histogram and the Analytics
 * timeseries are two charts over ONE window, which the explorer's host owns.
 * A drag on either zooms the whole viewer (so the other chart, the list and
 * the analytics request follow), a double-click on either - or "Reset zoom"
 * beside the picker, for keyboard users - puts the window back, and any
 * other change of window ends the zoom.
 *
 * The host below owns the window the way DashboardLogsViewer does. The API
 * is mocked so the analytics request can be read back, and recharts is stood
 * in for (see LogsHistogramDragTooltip.test.tsx for why).
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
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

  const chart: (props: StubChartProps) => React.ReactElement = (
    props: StubChartProps,
  ): React.ReactElement => {
    return react.createElement(
      "div",
      null,
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
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart,
    BarChart: chart,
    Area: nothing,
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

// Imported after the mocks so the viewer picks them up.
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import { LOGS_ANALYTICS_TIMESERIES_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import { HistogramBucket } from "../../../UI/Components/LogsViewer/types";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import LogSeverity from "../../../Types/Log/LogSeverity";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

function custom(startIso: string, endIso: string): RangeStartAndEndDateTime {
  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  };
}

// The window the explorer opens on.
const ORIGINAL: RangeStartAndEndDateTime = custom(
  "2026-09-28T11:00:00.000Z",
  "2026-09-28T12:00:00.000Z",
);

// Volume histogram bars (from the host) and analytics buckets (from the API).
const HIST_A: string = "2026-09-28T11:40:00Z";
const HIST_B: string = "2026-09-28T11:41:00Z";
const HIST_C: string = "2026-09-28T11:42:00Z";

const ANALYTICS_A: string = "2026-09-28 11:10:00";
const ANALYTICS_B: string = "2026-09-28 11:11:00";
const ANALYTICS_C: string = "2026-09-28 11:12:00";

const BUCKETS: Array<HistogramBucket> = [HIST_A, HIST_B, HIST_C].map(
  (time: string): HistogramBucket => {
    return { time, severity: LogSeverity.Error, count: 3 };
  },
);

const ZOOM_OUT_HINT: string = "Double-click to zoom out";

const hostSelectSpy: MockFunction = getJestMockFunction();
const hostChangeSpy: MockFunction = getJestMockFunction();

function describeWindow(range: RangeStartAndEndDateTime): string {
  if (range.range !== TimeRange.CUSTOM) {
    return range.range;
  }
  return `${range.startAndEndDate!.startValue.toISOString()}..${range.startAndEndDate!.endValue.toISOString()}`;
}

/*
 * The host owns the window, applying a drag as a custom window and anything
 * else as it comes - what DashboardLogsViewer's handleHistogramTimeRangeSelect
 * and handleTimeRangeChange do. "Apply saved view" moves the window the way
 * a saved view or a shared time cursor does: without the viewer's picker.
 */
const Host: FunctionComponent = (): ReactElement => {
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(ORIGINAL);

  return (
    <div>
      <span data-testid="host-window">{describeWindow(timeRange)}</span>
      <button
        type="button"
        onClick={() => {
          setTimeRange({ range: TimeRange.PAST_ONE_DAY });
        }}
      >
        Apply saved view
      </button>
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={(): void => {}}
        showFilters={true}
        histogramBuckets={BUCKETS}
        histogramLoading={false}
        histogramBucketIntervalMs={60 * 1000}
        onHistogramTimeRangeSelect={(startTime: Date, endTime: Date): void => {
          hostSelectSpy(startTime, endTime);
          setTimeRange({
            range: TimeRange.CUSTOM,
            startAndEndDate: new InBetween<Date>(startTime, endTime),
          });
        }}
        timeRange={timeRange}
        onTimeRangeChange={(next: RangeStartAndEndDateTime): void => {
          hostChangeSpy(next);
          setTimeRange(next);
        }}
        viewMode="analytics"
        onViewModeChange={(): void => {}}
      />
    </div>
  );
};

type PostArgs = { url: { toString: () => string }; data: Record<string, any> };

function analyticsRequests(): Array<Record<string, any>> {
  return postMock.mock.calls
    .map((call: Array<unknown>): PostArgs => {
      return call[0] as PostArgs;
    })
    .filter((args: PostArgs): boolean => {
      return args.url.toString().includes("/telemetry/logs/analytics");
    })
    .map((args: PostArgs): Record<string, any> => {
      return args.data;
    });
}

function lastAnalyticsWindow(): string {
  const requests: Array<Record<string, any>> = analyticsRequests();
  const last: Record<string, any> = requests[requests.length - 1]!;
  return `${last["startTime"]}..${last["endTime"]}`;
}

async function renderHost(): Promise<void> {
  render(<Host />);

  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${ANALYTICS_A}`)).toBeInTheDocument();
  });
}

function drag(from: string, to: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${from}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${to}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${to}`));
}

function histogramPlot(): HTMLElement {
  // The histogram's plot is the element that takes its double-click.
  return screen.getByTestId(`bucket-${HIST_A}`).parentElement!.parentElement!
    .parentElement!;
}

function pickerLabel(): string {
  return (
    screen.getByTestId("log-time-range-picker-button").textContent || ""
  ).trim();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  hostSelectSpy.mockReset();
  hostChangeSpy.mockReset();
  getListMock.mockReset();
  postMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  postMock.mockImplementation(async (args: PostArgs) => {
    if (args.url.toString().includes("/telemetry/logs/analytics")) {
      return {
        data: {
          data: [ANALYTICS_A, ANALYTICS_B, ANALYTICS_C].map((time: string) => {
            return { time, count: 4, groupValues: {} };
          }),
        },
      };
    }
    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a drag on the Analytics chart zooms the whole logs viewer", () => {
  test("the host gets the dragged window, and the analytics request follows it", async () => {
    await renderHost();

    expect(lastAnalyticsWindow()).toBe(
      "2026-09-28T11:00:00.000Z..2026-09-28T12:00:00.000Z",
    );

    drag(ANALYTICS_A, ANALYTICS_C);

    expect(hostSelectSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("host-window")).toHaveTextContent(
      "2026-09-28T11:10:00.000Z..2026-09-28T11:13:00.000Z",
    );

    await waitFor(() => {
      expect(lastAnalyticsWindow()).toBe(
        "2026-09-28T11:10:00.000Z..2026-09-28T11:13:00.000Z",
      );
    });
    expect(analyticsRequests()[analyticsRequests().length - 1]).toMatchObject({
      bucketSizeInMinutes: 1,
      chartType: "timeseries",
    });
  });

  test("the picker reads Custom (the zoomed window) and offers Reset zoom", async () => {
    await renderHost();

    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();

    drag(ANALYTICS_A, ANALYTICS_C);

    expect(pickerLabel()).toBe(
      getTimeRangeButtonLabel(
        custom("2026-09-28T11:10:00.000Z", "2026-09-28T11:13:00.000Z"),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Reset zoom" }),
    ).toBeInTheDocument();
  });

  test("the histogram shares the zoom: it offers the way back too", async () => {
    await renderHost();

    expect(screen.queryByText(ZOOM_OUT_HINT)).toBeNull();

    drag(ANALYTICS_A, ANALYTICS_C);

    expect(screen.getByText(ZOOM_OUT_HINT)).toBeInTheDocument();
  });

  test("a double-click on the OTHER chart (the histogram) puts the original window back", async () => {
    await renderHost();

    drag(ANALYTICS_A, ANALYTICS_C);
    await waitFor(() => {
      expect(lastAnalyticsWindow()).toBe(
        "2026-09-28T11:10:00.000Z..2026-09-28T11:13:00.000Z",
      );
    });

    fireEvent.doubleClick(histogramPlot());

    expect(hostChangeSpy).toHaveBeenCalledTimes(1);
    expect(hostChangeSpy.mock.calls[0]![0]).toEqual(ORIGINAL);
    expect(screen.getByTestId("host-window")).toHaveTextContent(
      "2026-09-28T11:00:00.000Z..2026-09-28T12:00:00.000Z",
    );
    await waitFor(() => {
      expect(lastAnalyticsWindow()).toBe(
        "2026-09-28T11:00:00.000Z..2026-09-28T12:00:00.000Z",
      );
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("the other way round: a drag on the histogram, a double-click on the analytics chart", async () => {
    await renderHost();

    drag(HIST_A, HIST_B);
    expect(screen.getByTestId("host-window")).toHaveTextContent(
      "2026-09-28T11:40:00.000Z..2026-09-28T11:42:00.000Z",
    );
    await waitFor(() => {
      expect(lastAnalyticsWindow()).toBe(
        "2026-09-28T11:40:00.000Z..2026-09-28T11:42:00.000Z",
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${ANALYTICS_A}`)).toBeInTheDocument();
    });
    fireEvent.doubleClick(
      screen.getByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID),
    );

    expect(hostChangeSpy.mock.calls[0]![0]).toEqual(ORIGINAL);
  });

  test("Reset zoom beside the picker puts the window back, for keyboard users too", async () => {
    await renderHost();

    drag(ANALYTICS_A, ANALYTICS_C);
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));

    expect(hostChangeSpy.mock.calls[0]![0]).toEqual(ORIGINAL);
    expect(pickerLabel()).toBe(getTimeRangeButtonLabel(ORIGINAL));
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("nested zooms climb all the way out in one go", async () => {
    await renderHost();

    drag(ANALYTICS_A, ANALYTICS_C);
    await waitFor(() => {
      expect(lastAnalyticsWindow()).toBe(
        "2026-09-28T11:10:00.000Z..2026-09-28T11:13:00.000Z",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${ANALYTICS_B}`)).toBeInTheDocument();
    });

    // A second drag, inside the zoomed window.
    drag(ANALYTICS_A, ANALYTICS_B);
    expect(hostSelectSpy).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));

    expect(hostChangeSpy).toHaveBeenCalledTimes(1);
    expect(hostChangeSpy.mock.calls[0]![0]).toEqual(ORIGINAL);
  });
});

describe("any other change of window ends the zoom", () => {
  test("a pick from the picker", async () => {
    await renderHost();

    drag(ANALYTICS_A, ANALYTICS_C);
    fireEvent.click(screen.getByTestId("log-time-range-picker-button"));
    fireEvent.click(
      within(screen.getByTestId("log-time-range-picker-dropdown")).getByText(
        "Past 1 Day",
      ),
    );

    expect(hostChangeSpy).toHaveBeenCalledWith({
      range: TimeRange.PAST_ONE_DAY,
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(screen.queryByText(ZOOM_OUT_HINT)).toBeNull();
  });

  test("a saved view moving the window without the picker", async () => {
    await renderHost();

    drag(ANALYTICS_A, ANALYTICS_C);
    expect(screen.getByText(ZOOM_OUT_HINT)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Apply saved view"));

    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(screen.queryByText(ZOOM_OUT_HINT)).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${ANALYTICS_A}`)).toBeInTheDocument();
    });
    // No stale "zoom out" to a window from before the saved view.
    fireEvent.doubleClick(
      screen.getByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID),
    );
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(hostChangeSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("host-window")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
  });
});
