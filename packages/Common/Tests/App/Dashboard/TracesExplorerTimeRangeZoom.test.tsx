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
 * Issue #4105 on the traces explorer (Traces > Viewer, every resource's
 * Traces tab, Exception > Occurrences). In Analytics mode the volume
 * histogram is hidden, so the analytics timeseries is the only chart on
 * screen - and it used to have no zoom at all. It now zooms the explorer's
 * one window exactly like the histogram: a drag re-issues the analytics
 * request for the dragged window, the picker reads Custom and offers Reset
 * zoom, and a double-click on either chart puts the window back.
 *
 * The real TracesViewer, TelemetryViewer and TracesAnalyticsView are mounted
 * against a mocked data layer; recharts is stood in for with a chart that
 * lays each bucket out as a div (see LogsHistogramDragTooltip.test.tsx).
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
      getFriendlyMessage: () => {
        return "error";
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

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

  const chart: (
    kind: string,
  ) => (props: StubChartProps) => React.ReactElement = (kind: string) => {
    return (props: StubChartProps): React.ReactElement => {
      return react.createElement(
        "div",
        { "data-testid": `${kind}-chart` },
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
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart("area"),
    BarChart: chart("bar"),
    LineChart: chart("line"),
    Area: nothing,
    Bar: nothing,
    Line: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import {
  TRACES_ANALYTICS_TIMESERIES_TEST_ID,
  TRACES_ANALYTICS_ZOOM_HINT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-17T11:00:00.000Z");

/*
 * Analytics buckets are a minute wide over the past hour; the explorer's
 * histogram asks for about 40 bars, which over an hour is two minutes each.
 */
const ANALYTICS_A: string = "2026-09-17 10:15:00";
const ANALYTICS_B: string = "2026-09-17 10:16:00";
const ANALYTICS_C: string = "2026-09-17 10:17:00";
const HIST_A: string = "2026-09-17 10:40:00";
const HIST_B: string = "2026-09-17 10:42:00";

type PostArgs = { url: { toString: () => string }; data: Record<string, any> };

// The span names a duration measure is split into (one series per name).
let durationSeriesNames: Array<string> = ["GET /"];

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

// Relative windows re-resolve against the (moving) fake clock on each fetch.
function isPastHour(window: string): boolean {
  const [startIso, endIso] = window.split("..") as [string, string];
  const startMs: number = new Date(startIso).getTime();
  const endMs: number = new Date(endIso).getTime();
  return endMs - startMs === 60 * 60 * 1000 && endMs >= NOW.getTime();
}

function pickerLabel(): string {
  return (
    screen.getByTestId("telemetry-time-range-picker-button").textContent || ""
  ).trim();
}

function drag(from: string, to: string): void {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${from}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${to}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${to}`));
}

async function renderExplorer(url: string = "/"): Promise<void> {
  window.history.replaceState({}, "", url);

  await act(async () => {
    render(<TracesViewer />);
  });
}

async function waitForAnalyticsChart(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${ANALYTICS_A}`)).toBeInTheDocument();
  });
}

function selectControl(label: string): HTMLSelectElement {
  // The analytics query builder labels each select with a caption span.
  const caption: HTMLElement = screen.getByText(label, { selector: "span" });
  return caption.parentElement!.querySelector("select") as HTMLSelectElement;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  durationSeriesNames = ["GET /"];
  window.localStorage.clear();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();

    if (url.includes("/telemetry/traces/analytics")) {
      if (args.data["chartType"] === "toplist") {
        return {
          data: { data: [{ value: "GET /", metricValue: 4, count: 4 }] },
        };
      }
      const names: Array<string> =
        args.data["metric"] === "count" ? ["GET /"] : durationSeriesNames;
      const rows: Array<Record<string, unknown>> = [];
      for (const time of [ANALYTICS_A, ANALYTICS_B, ANALYTICS_C]) {
        for (const name of names) {
          rows.push({ time, value: 7, groupValues: { name } });
        }
      }
      return { data: { data: rows } };
    }

    if (url.includes("/telemetry/traces/histogram")) {
      return {
        data: {
          buckets: [HIST_A, HIST_B].map((time: string) => {
            return { time, series: "ok", count: 3 };
          }),
        },
      };
    }

    if (url.includes("/telemetry/traces/facets")) {
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

describe("the traces explorer's Analytics view zooms the explorer", () => {
  test("a drag re-issues the analytics request for the dragged window, and the picker offers Reset zoom", async () => {
    await renderExplorer("/?view=analytics");
    await waitForAnalyticsChart();

    expect(isPastHour(lastWindowPostedTo("/telemetry/traces/analytics"))).toBe(
      true,
    );
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();

    drag(ANALYTICS_A, ANALYTICS_C);

    const zoomed: string = "2026-09-17T10:15:00.000Z..2026-09-17T10:18:00.000Z";
    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/traces/analytics")).toBe(zoomed);
    });
    expect(postsTo("/telemetry/traces/analytics").pop()).toMatchObject({
      chartType: "timeseries",
      bucketSizeInMinutes: 1,
    });
    expect(pickerLabel()).toBe(
      getTimeRangeButtonLabel({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-09-17T10:15:00.000Z"),
          new Date("2026-09-17T10:18:00.000Z"),
        ),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Reset zoom" }),
    ).toBeInTheDocument();
    // The zoom is written to the URL like any other window.
    expect(window.location.search).toContain("range=Custom");
  });

  test("the hint names the gesture, and the way back once zoomed", async () => {
    await renderExplorer("/?view=analytics");
    await waitForAnalyticsChart();

    expect(
      screen.getByTestId(TRACES_ANALYTICS_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent("Click or drag to zoom");

    drag(ANALYTICS_A, ANALYTICS_B);
    await waitForAnalyticsChart();

    expect(
      screen.getByTestId(TRACES_ANALYTICS_ZOOM_HINT_TEST_ID),
    ).toHaveTextContent("double-click to zoom out");
  });

  test("a double-click on the chart puts the window before the zoom back", async () => {
    await renderExplorer("/?view=analytics");
    await waitForAnalyticsChart();

    drag(ANALYTICS_A, ANALYTICS_C);
    await waitForAnalyticsChart();

    fireEvent.doubleClick(
      screen.getByTestId(TRACES_ANALYTICS_TIMESERIES_TEST_ID),
    );

    expect(pickerLabel()).toBe("Past 1 Hour");
    await waitFor(() => {
      expect(
        isPastHour(lastWindowPostedTo("/telemetry/traces/analytics")),
      ).toBe(true);
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("Reset zoom beside the picker does the same", async () => {
    await renderExplorer("/?view=analytics");
    await waitForAnalyticsChart();

    drag(ANALYTICS_A, ANALYTICS_B);
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));

    expect(pickerLabel()).toBe("Past 1 Hour");
    await waitFor(() => {
      expect(
        isPastHour(lastWindowPostedTo("/telemetry/traces/analytics")),
      ).toBe(true);
    });
  });

  test("a click on one bucket zooms into that bucket", async () => {
    await renderExplorer("/?view=analytics");
    await waitForAnalyticsChart();

    fireEvent.mouseDown(screen.getByTestId(`bucket-${ANALYTICS_B}`));
    fireEvent.mouseUp(screen.getByTestId(`bucket-${ANALYTICS_B}`));

    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/traces/analytics")).toBe(
        "2026-09-17T10:16:00.000Z..2026-09-17T10:17:00.000Z",
      );
    });
  });

  test.each([
    ["one span name: an area chart", ["GET /"], "area-chart"],
    ["two span names: a line each", ["GET /", "POST /pay"], "line-chart"],
  ])(
    "a duration measure over %s zooms the same way",
    async (_label: string, names: Array<string>, chartTestId: string) => {
      durationSeriesNames = names;
      await renderExplorer("/?view=analytics");
      await waitForAnalyticsChart();

      fireEvent.change(selectControl("Measure"), {
        target: { value: "p95Duration" },
      });

      await waitFor(() => {
        expect(postsTo("/telemetry/traces/analytics").pop()).toMatchObject({
          metric: "p95Duration",
        });
      });
      await waitFor(() => {
        expect(screen.getByTestId(chartTestId)).toBeInTheDocument();
      });

      drag(ANALYTICS_A, ANALYTICS_B);

      await waitFor(() => {
        expect(lastWindowPostedTo("/telemetry/traces/analytics")).toBe(
          "2026-09-17T10:15:00.000Z..2026-09-17T10:17:00.000Z",
        );
      });
    },
  );

  test("the top list has no time axis and offers no zoom", async () => {
    await renderExplorer("/?view=analytics");
    await waitForAnalyticsChart();

    fireEvent.change(selectControl("Chart"), { target: { value: "toplist" } });

    await waitFor(() => {
      expect(postsTo("/telemetry/traces/analytics").pop()).toMatchObject({
        chartType: "toplist",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("GET /")).toBeInTheDocument();
    });

    expect(screen.queryByTestId(TRACES_ANALYTICS_ZOOM_HINT_TEST_ID)).toBeNull();
    expect(
      screen.queryByTestId(TRACES_ANALYTICS_TIMESERIES_TEST_ID),
    ).toBeNull();
  });
});

describe("the analytics chart and the histogram share one zoom", () => {
  test("a zoom made in Analytics carries over to the Spans view, and a double-click on the histogram undoes it", async () => {
    await renderExplorer("/?view=analytics");
    await waitForAnalyticsChart();

    drag(ANALYTICS_A, ANALYTICS_C);
    const zoomed: string = "2026-09-17T10:15:00.000Z..2026-09-17T10:18:00.000Z";
    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/traces/analytics")).toBe(zoomed);
    });

    fireEvent.click(screen.getByRole("button", { name: "Spans" }));

    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/traces/histogram")).toBe(zoomed);
    });
    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/traces/facets")).toBe(zoomed);
    });
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${HIST_A}`)).toBeInTheDocument();
    });
    expect(screen.getByText("Double-click to zoom out")).toBeInTheDocument();

    fireEvent.doubleClick(
      screen.getByTestId("bar-chart").parentElement!.parentElement!,
    );

    expect(pickerLabel()).toBe("Past 1 Hour");
    await waitFor(() => {
      expect(
        isPastHour(lastWindowPostedTo("/telemetry/traces/histogram")),
      ).toBe(true);
    });
  });

  test("a zoom made on the histogram is undone from the analytics chart", async () => {
    await renderExplorer("/");
    await waitFor(() => {
      expect(screen.getByTestId(`bucket-${HIST_A}`)).toBeInTheDocument();
    });

    drag(HIST_A, HIST_B);
    // Through the end of the last two-minute bar.
    const zoomed: string = "2026-09-17T10:40:00.000Z..2026-09-17T10:44:00.000Z";
    await waitFor(() => {
      expect(lastWindowPostedTo("/telemetry/traces/histogram")).toBe(zoomed);
    });
    expect(postsTo("/telemetry/traces/histogram").pop()).toMatchObject({
      bucketSizeInMinutes: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "Analytics" }));
    await waitForAnalyticsChart();

    expect(lastWindowPostedTo("/telemetry/traces/analytics")).toBe(zoomed);

    fireEvent.doubleClick(
      screen.getByTestId(TRACES_ANALYTICS_TIMESERIES_TEST_ID),
    );

    expect(pickerLabel()).toBe("Past 1 Hour");
    await waitFor(() => {
      expect(
        isPastHour(lastWindowPostedTo("/telemetry/traces/analytics")),
      ).toBe(true);
    });
  });
});
