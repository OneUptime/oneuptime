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
 * Issue #4105 on the logs explorer (Logs > Viewer, and every resource's
 * Logs tab, which mount the same viewer). Everything on it - the log list,
 * the volume histogram, the facet counts and the Analytics timeseries - is
 * fetched for ONE window. A drag across either chart must re-issue every
 * one of those requests for the dragged window; a double-click on either
 * chart, or "Reset zoom" beside the picker, must re-issue them for the
 * window the reader started on.
 *
 * The real DashboardLogsViewer and Common LogsViewer are mounted against a
 * mocked data layer, so the requests can be read back. Recharts is stood in
 * for with a chart that lays each bucket out as a div and forwards the mouse
 * events recharts does (see LogsHistogramDragTooltip.test.tsx).
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
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

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
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
      getFriendlyMessage: (error: Error) => {
        return error?.message || "error";
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error?.message || "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
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

import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import { LOGS_ANALYTICS_TIMESERIES_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsAnalyticsView";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");

// Histogram bars (ClickHouse labels) and analytics buckets, one minute each.
const HIST_A: string = "2026-09-28 11:20:00";
const HIST_B: string = "2026-09-28 11:21:00";
const HIST_C: string = "2026-09-28 11:22:00";
const ANALYTICS_A: string = "2026-09-28 11:40:00";
const ANALYTICS_B: string = "2026-09-28 11:41:00";

type PostArgs = { url: { toString: () => string }; data: Record<string, any> };

function postsTo(path: string): Array<Record<string, any>> {
  return postMock.mock.calls
    .map((call: Array<unknown>): PostArgs => {
      return call[0] as PostArgs;
    })
    .filter((args: PostArgs): boolean => {
      return args.url.toString().includes(path);
    })
    .map((args: PostArgs): Record<string, any> => {
      return args.data;
    });
}

function lastWindowPostedTo(path: string): string {
  const requests: Array<Record<string, any>> = postsTo(path);
  expect(requests.length).toBeGreaterThan(0);
  const last: Record<string, any> = requests[requests.length - 1]!;
  return `${last["startTime"]}..${last["endTime"]}`;
}

function lastListWindow(): string {
  const calls: Array<Array<unknown>> = analyticsGetListMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const query: Record<string, unknown> = (
    calls[calls.length - 1]![0] as { query: Record<string, unknown> }
  ).query;
  const time: InBetween<Date> = query["time"] as InBetween<Date>;
  return `${time.startValue.toISOString()}..${time.endValue.toISOString()}`;
}

const PAST_HOUR_WINDOW: string =
  "2026-09-28T11:00:00.000Z..2026-09-28T12:00:00.000Z";

/*
 * A relative window resolves against the clock every time it is fetched,
 * and waitFor moves the fake clock on, so "the past hour" after a reset is
 * checked by its shape: an hour long, ending no earlier than the test's NOW.
 */
function isPastHour(window: string): boolean {
  const [startIso, endIso] = window.split("..") as [string, string];
  const startMs: number = new Date(startIso).getTime();
  const endMs: number = new Date(endIso).getTime();
  return endMs - startMs === 60 * 60 * 1000 && endMs >= NOW.getTime();
}

function pickerLabel(): string {
  return (
    screen.getByTestId("log-time-range-picker-button").textContent || ""
  ).trim();
}

function drag(from: string, to: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${from}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${to}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${to}`));
}

// The element the volume histogram listens for its double-click on.
function histogramPlot(): HTMLElement {
  return screen.getByTestId(`bucket-${HIST_A}`).parentElement!.parentElement!
    .parentElement!;
}

async function renderExplorer(): Promise<void> {
  await act(async () => {
    render(<DashboardLogsViewer id="logs-explorer" showFilters={true} />);
  });

  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${HIST_A}`)).toBeInTheDocument();
  });
}

async function openAnalytics(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /Analytics/ }));

  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${ANALYTICS_A}`)).toBeInTheDocument();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();

    if (url.includes("/telemetry/logs/histogram")) {
      return {
        data: {
          bucketSizeInMinutes: 1,
          buckets: [HIST_A, HIST_B, HIST_C].map((time: string) => {
            return { time, severity: "Error", count: 2 };
          }),
        },
      };
    }

    if (url.includes("/telemetry/logs/analytics")) {
      return {
        data: {
          data: [ANALYTICS_A, ANALYTICS_B].map((time: string) => {
            return { time, count: 3, groupValues: {} };
          }),
        },
      };
    }

    if (url.includes("/telemetry/logs/facets")) {
      return { data: { facets: {} } };
    }

    return { data: {} };
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("the logs explorer zooms as one", () => {
  test("everything starts on the same window", async () => {
    await renderExplorer();

    expect(pickerLabel()).toBe("Past 1 Hour");
    expect(lastListWindow()).toBe(PAST_HOUR_WINDOW);
    expect(lastWindowPostedTo("/telemetry/logs/histogram")).toBe(
      PAST_HOUR_WINDOW,
    );
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a drag on the histogram re-fetches the list, the chart and the facets for the dragged window", async () => {
    await renderExplorer();

    drag(HIST_A, HIST_B);

    const zoomed: string = "2026-09-28T11:20:00.000Z..2026-09-28T11:22:00.000Z";

    await waitFor(() => {
      expect(lastListWindow()).toBe(zoomed);
    });
    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/logs/histogram")).toBe(zoomed);
    });
    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/logs/facets")).toBe(zoomed);
    });

    expect(pickerLabel()).toBe(
      getTimeRangeButtonLabel({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-09-28T11:20:00.000Z"),
          new Date("2026-09-28T11:22:00.000Z"),
        ),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Reset zoom" }),
    ).toBeInTheDocument();
  });

  test("Reset zoom beside the picker re-fetches everything for the window before the zoom", async () => {
    await renderExplorer();

    drag(HIST_A, HIST_B);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Reset zoom" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));

    expect(pickerLabel()).toBe("Past 1 Hour");
    await waitFor(() => {
      expect(isPastHour(lastListWindow())).toBe(true);
    });
    await waitFor(() => {
      expect(isPastHour(lastWindowPostedTo("/telemetry/logs/histogram"))).toBe(
        true,
      );
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("the Analytics chart asks for the zoomed window, and a double-click on it zooms the whole explorer back out", async () => {
    await renderExplorer();

    drag(HIST_A, HIST_C);
    const zoomed: string = "2026-09-28T11:20:00.000Z..2026-09-28T11:23:00.000Z";
    await waitFor(() => {
      expect(lastListWindow()).toBe(zoomed);
    });

    await openAnalytics();

    expect(lastWindowPostedTo("/telemetry/logs/analytics")).toBe(zoomed);

    // A double-click on a DIFFERENT chart from the one the zoom was made on.
    fireEvent.doubleClick(
      screen.getByTestId(LOGS_ANALYTICS_TIMESERIES_TEST_ID),
    );

    expect(pickerLabel()).toBe("Past 1 Hour");
    await waitFor(() => {
      expect(isPastHour(lastWindowPostedTo("/telemetry/logs/analytics"))).toBe(
        true,
      );
    });
    await waitFor(() => {
      expect(isPastHour(lastWindowPostedTo("/telemetry/logs/histogram"))).toBe(
        true,
      );
    });
  });

  test("a drag on the Analytics chart zooms the histogram's window too; a double-click on the histogram undoes it", async () => {
    await renderExplorer();
    await openAnalytics();

    drag(ANALYTICS_A, ANALYTICS_B);
    const zoomed: string = "2026-09-28T11:40:00.000Z..2026-09-28T11:42:00.000Z";

    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/logs/histogram")).toBe(zoomed);
    });
    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/logs/analytics")).toBe(zoomed);
    });
    expect(screen.getByText("Double-click to reset")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${HIST_A}`)).toBeInTheDocument();
    });
    fireEvent.doubleClick(histogramPlot());

    await waitFor(() => {
      expect(isPastHour(lastWindowPostedTo("/telemetry/logs/analytics"))).toBe(
        true,
      );
    });
    expect(pickerLabel()).toBe("Past 1 Hour");
  });

  test("a range picked from the picker ends the zoom", async () => {
    await renderExplorer();

    drag(HIST_A, HIST_B);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Reset zoom" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("log-time-range-picker-button"));
    fireEvent.click(screen.getByText("Past 1 Day"));

    expect(pickerLabel()).toBe("Past 1 Day");
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    await waitFor(() => {
      expect(lastListWindow()).toBe(
        "2026-09-27T12:00:00.000Z..2026-09-28T12:00:00.000Z",
      );
    });
  });
});
