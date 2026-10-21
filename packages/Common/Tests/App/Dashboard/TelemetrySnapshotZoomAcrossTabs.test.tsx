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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the telemetry snapshot card, end to end: a drag on the
 * snapshot's metric chart zooms the WHOLE snapshot. The slice becomes the
 * window of every tab of the card, the Logs, Traces and Exceptions tabs
 * opened afterwards included; it survives a switch to another tab and
 * back and the page's background refresh; a double-click on the chart, or
 * "Reset zoom" beside the snapshot badge on any tab, returns every tab to
 * the snapshot window. It used to zoom the chart alone: the other tabs
 * kept showing the whole snapshot, and the zoom was gone as soon as the
 * reader came back to the chart.
 *
 * TelemetrySnapshotPanel (the incident and alert EPISODE pages' snapshot)
 * is rendered with the real companion tabs, the real MetricView (its
 * MetricCharts stood in for by buttons that call exactly the handlers
 * MetricView hands the charts) and the real logs, traces and exceptions
 * explorers. The explorers' shells (the shared LogsViewer and the
 * TelemetryViewer) are probes that record what they are handed, and the
 * APIs are mocked, so every request each tab sends can be read back.
 */

type ShellProps = {
  timeRange: {
    range: string;
    startAndEndDate?: { startValue: Date; endValue: Date };
  };
  onHistogramTimeRangeSelect?: (startTime: Date, endTime: Date) => void;
};

const shellProbe: MockFunction = getJestMockFunction();
const logsShellProbe: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  metricViewData: {
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName?: unknown } };
    }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

let mockLatestCharts: MockChartsProps | null = null;

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-14T17:50:00.000Z"),
  end: new Date("2026-09-14T17:55:00.000Z"),
};

// A second drag, inside the first.
const MOCK_NESTED_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-14T17:51:00.000Z"),
  end: new Date("2026-09-14T17:53:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        mockLatestCharts = props;
        return (
          <div data-testid="snapshot-charts">
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              Drag across the snapshot chart
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(
                  MOCK_NESTED_DRAG.start,
                  MOCK_NESTED_DRAG.end,
                );
              }}
            >
              Drag again across the snapshot chart
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              Double-click the snapshot chart
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/useServiceNames",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {};
      },
    };
  },
);

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

// The traces and exceptions explorers' shell.
jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: ShellProps) => {
      shellProbe(props);
      return <div data-testid="explorer-shell" />;
    },
  };
});

// The logs explorer's shell.
jest.mock("../../../UI/Components/LogsViewer/LogsViewer", () => {
  return {
    __esModule: true,
    default: (props: ShellProps) => {
      logsShellProbe(props);
      return <div data-testid="logs-shell" />;
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      count: () => {
        return Promise.resolve(0);
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
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
      getFriendlyErrorMessage: () => {
        return "error";
      },
    },
  };
});

import TelemetrySnapshotPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotPanel";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import Log from "../../../Models/AnalyticsModels/Log";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";

const NOW: Date = new Date("2026-09-14T19:00:00.000Z");
const SNAPSHOT_START: Date = new Date("2026-09-14T17:45:00.000Z");
const SNAPSHOT_END: Date = new Date("2026-09-14T18:00:00.000Z");

const SNAPSHOT_TEXT: string = `${SNAPSHOT_START.toISOString()}..${SNAPSHOT_END.toISOString()}`;
const SLICE_TEXT: string = `${MOCK_DRAG.start.toISOString()}..${MOCK_DRAG.end.toISOString()}`;
const NESTED_TEXT: string = `${MOCK_NESTED_DRAG.start.toISOString()}..${MOCK_NESTED_DRAG.end.toISOString()}`;

// A zoom made inside the Logs tab, within the slice.
const LOGS_ZOOM_START: Date = new Date("2026-09-14T17:52:00.000Z");
const LOGS_ZOOM_END: Date = new Date("2026-09-14T17:54:00.000Z");

function textOf(window: { startValue: Date; endValue: Date }): string {
  return `${OneUptimeDate.fromString(window.startValue).toISOString()}..${OneUptimeDate.fromString(window.endValue).toISOString()}`;
}

// A new snapshot every call, the way the page re-reads the stored one.
function snapshotWindow(
  start: Date = SNAPSHOT_START,
  end: Date = SNAPSHOT_END,
): InBetween<Date> {
  return new InBetween<Date>(
    new Date(start.getTime()),
    new Date(end.getTime()),
  );
}

function metricSnapshotQuery(window: InBetween<Date>): TelemetryQuery {
  return {
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: window,
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "a",
            title: "",
            description: "",
            legend: "",
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: "system.cpu.utilization",
              aggegationType: MetricsAggregationType.Avg,
            },
          },
        },
      ],
      formulaConfigs: [],
    },
  };
}

function panel(
  start: Date = SNAPSHOT_START,
  end: Date = SNAPSHOT_END,
): React.ReactElement {
  return (
    <TelemetrySnapshotPanel
      telemetryQuery={metricSnapshotQuery(snapshotWindow(start, end))}
      snapshotWindow={snapshotWindow(start, end)}
      seriesSummary=""
      eventNoun="incident"
    />
  );
}

function fetchedChartWindows(): Array<string> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): string => {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return textOf(data.startAndEndDate!);
  });
}

// The window the snapshot chart was last fetched for.
function chartWindow(): string | undefined {
  const windows: Array<string> = fetchedChartWindows();
  return windows[windows.length - 1];
}

function charts(): MockChartsProps {
  if (!mockLatestCharts) {
    throw new Error("The snapshot chart has not rendered");
  }
  return mockLatestCharts;
}

function lastProps(probe: MockFunction): ShellProps {
  const calls: Array<Array<unknown>> = probe.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as ShellProps;
}

// The window an explorer's picker, histogram and facets are on.
function shellWindowOf(probe: MockFunction): string {
  const props: ShellProps = lastProps(probe);
  expect(props.timeRange.range).toBe(TimeRange.CUSTOM);
  return textOf(props.timeRange.startAndEndDate!);
}

function logListQueries(): Array<Record<string, unknown>> {
  return analyticsGetListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { modelType: unknown; query: Record<string, unknown> };
    })
    .filter((request: { modelType: unknown }): boolean => {
      return request.modelType === Log;
    })
    .map((request: { query: Record<string, unknown> }) => {
      return request.query;
    });
}

// The window the log list was last fetched for.
function logListWindow(): string {
  const queries: Array<Record<string, unknown>> = logListQueries();
  expect(queries.length).toBeGreaterThan(0);
  return textOf(queries[queries.length - 1]!["time"] as InBetween<Date>);
}

// The window a volume chart was last requested for.
function histogramWindow(path: string): string {
  const requests: Array<Record<string, unknown>> = postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        url: { toString: () => string };
        data: Record<string, unknown>;
      };
    })
    .filter((args: { url: { toString: () => string } }): boolean => {
      return args.url.toString().includes(path);
    })
    .map((args: { data: Record<string, unknown> }) => {
      return args.data;
    });
  expect(requests.length).toBeGreaterThan(0);
  const last: Record<string, unknown> = requests[requests.length - 1]!;
  return `${last["startTime"]}..${last["endTime"]}`;
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function badgeTitle(): string {
  return OneUptimeDate.getInBetweenDatesAsFormattedString(
    new InBetween<Date>(SNAPSHOT_START, SNAPSHOT_END),
  );
}

async function renderPanel(): Promise<RenderResult> {
  let rendered: RenderResult | null = null;
  await act(async () => {
    rendered = render(panel());
  });
  await chartSettled();
  return rendered!;
}

/*
 * MetricView draws its charts once before it loads, then shows a loader
 * until its first fetch lands: wait for that fetch and the charts after.
 */
async function chartSettled(): Promise<void> {
  await waitFor(() => {
    expect(fetchedChartWindows().length).toBeGreaterThan(0);
    expect(screen.getByTestId("snapshot-charts")).toBeInTheDocument();
  });
}

async function press(label: string): Promise<void> {
  const button: HTMLElement = await screen.findByRole("button", {
    name: label,
  });
  await act(async () => {
    fireEvent.click(button);
  });
}

async function openTab(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: name }));
  });
}

// Drags across the snapshot chart and waits for it to chart the slice.
async function zoomTheSnapshot(): Promise<void> {
  await press("Drag across the snapshot chart");
  await waitFor(() => {
    expect(chartWindow()).toBe(SLICE_TEXT);
  });
}

async function backOnMetrics(): Promise<void> {
  await openTab("Metrics");
  await chartSettled();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockLatestCharts = null;
  shellProbe.mockReset();
  logsShellProbe.mockReset();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();
  fetchResultsMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  postMock.mockImplementation(async () => {
    return { data: {} };
  });
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("a drag on the snapshot's metric chart zooms every tab of the snapshot", () => {
  test("before any drag, every tab is on the snapshot window", async () => {
    await renderPanel();

    expect(chartWindow()).toBe(SNAPSHOT_TEXT);
    expect(charts().onTimeRangeSelect).toBeInstanceOf(Function);
    expect(charts().onTimeRangeReset).toBeUndefined();
    expect(resetButtons()).toHaveLength(0);

    await openTab("Logs");
    expect(shellWindowOf(logsShellProbe)).toBe(SNAPSHOT_TEXT);
    await waitFor(() => {
      expect(logListWindow()).toBe(SNAPSHOT_TEXT);
    });
  });

  test("the Logs tab opened after the drag lists, charts and picks the slice", async () => {
    await renderPanel();
    await zoomTheSnapshot();

    await openTab("Logs");

    expect(shellWindowOf(logsShellProbe)).toBe(SLICE_TEXT);
    await waitFor(() => {
      expect(logListWindow()).toBe(SLICE_TEXT);
    });
    await waitFor(() => {
      expect(histogramWindow("/telemetry/logs/histogram")).toBe(SLICE_TEXT);
    });
    // The whole snapshot window was never requested by the tab.
    for (const query of logListQueries()) {
      expect(textOf(query["time"] as InBetween<Date>)).toBe(SLICE_TEXT);
    }
  });

  test.each([
    ["Traces", "/telemetry/traces/histogram"],
    ["Exceptions", "/telemetry/exceptions/histogram"],
  ])(
    "the %s tab opened after the drag is on the slice, chart request included",
    async (tabName: string, histogramPath: string) => {
      await renderPanel();
      await zoomTheSnapshot();

      await openTab(tabName);

      expect(shellWindowOf(shellProbe)).toBe(SLICE_TEXT);
      await waitFor(() => {
        expect(histogramWindow(histogramPath)).toBe(SLICE_TEXT);
      });
    },
  );

  test("back on the Metrics tab the chart is still on the slice, with its way back", async () => {
    await renderPanel();
    await zoomTheSnapshot();
    await openTab("Logs");
    const fetchesBefore: number = fetchedChartWindows().length;

    await backOnMetrics();

    expect(chartWindow()).toBe(SLICE_TEXT);
    // It remounted on the slice: the whole snapshot was not fetched again.
    const fetchesSince: Array<string> =
      fetchedChartWindows().slice(fetchesBefore);
    expect(fetchesSince.length).toBeGreaterThan(0);
    for (const fetched of fetchesSince) {
      expect(fetched).toBe(SLICE_TEXT);
    }
    expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    expect(resetButtons()).toHaveLength(1);
  });

  test("a double-click after coming back returns every tab to the snapshot window", async () => {
    await renderPanel();
    await zoomTheSnapshot();
    await openTab("Traces");
    await backOnMetrics();
    // Still zoomed after the round trip, so the double-click has work to do.
    expect(chartWindow()).toBe(SLICE_TEXT);
    expect(charts().onTimeRangeReset).toBeInstanceOf(Function);

    await press("Double-click the snapshot chart");

    await waitFor(() => {
      expect(chartWindow()).toBe(SNAPSHOT_TEXT);
    });
    expect(charts().onTimeRangeReset).toBeUndefined();
    expect(resetButtons()).toHaveLength(0);

    await openTab("Logs");
    expect(shellWindowOf(logsShellProbe)).toBe(SNAPSHOT_TEXT);
    await waitFor(() => {
      expect(logListWindow()).toBe(SNAPSHOT_TEXT);
    });
  });

  test("Reset zoom beside the badge on the Logs tab returns the whole snapshot", async () => {
    await renderPanel();
    await zoomTheSnapshot();
    await openTab("Logs");
    await waitFor(() => {
      expect(logListWindow()).toBe(SLICE_TEXT);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    });

    // The open tab follows at once, list and chart requests included.
    expect(shellWindowOf(logsShellProbe)).toBe(SNAPSHOT_TEXT);
    await waitFor(() => {
      expect(logListWindow()).toBe(SNAPSHOT_TEXT);
    });
    await waitFor(() => {
      expect(histogramWindow("/telemetry/logs/histogram")).toBe(SNAPSHOT_TEXT);
    });
    expect(resetButtons()).toHaveLength(0);

    await backOnMetrics();
    expect(chartWindow()).toBe(SNAPSHOT_TEXT);
    expect(charts().onTimeRangeReset).toBeUndefined();
  });

  test.each([["Logs"], ["Traces"], ["Exceptions"]])(
    "the %s tab's card names the snapshot window and offers Reset zoom while zoomed",
    async (tabName: string) => {
      await renderPanel();
      await zoomTheSnapshot();

      await openTab(tabName);

      const tabPanel: HTMLElement = screen.getByRole("tabpanel");
      expect(within(tabPanel).getByText(badgeTitle())).toBeInTheDocument();
      expect(
        within(tabPanel).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeVisible();
    },
  );

  test.each([
    ["Logs", "Logs"],
    ["Traces", "Spans"],
    ["Exceptions", "Exceptions"],
  ])(
    "the %s tab's card says it shows the zoomed part of the snapshot window, until a reset",
    async (tabName: string, noun: string) => {
      await renderPanel();
      await zoomTheSnapshot();

      await openTab(tabName);

      expect(
        screen.getByText(
          `${noun} in this incident's telemetry scope during the zoomed part of the snapshot window.`,
        ),
      ).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(
          screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
        );
      });

      expect(
        screen.getByText(
          `${noun} in this incident's telemetry scope during the snapshot window.`,
        ),
      ).toBeInTheDocument();
    },
  );

  test("the Metrics tab's badge keeps naming the snapshot window while the chart shows the slice", async () => {
    await renderPanel();
    await zoomTheSnapshot();

    expect(screen.getByText(badgeTitle())).toBeInTheDocument();
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });

  test("two drags, then the Logs tab: the second slice; one reset: the snapshot window", async () => {
    await renderPanel();
    await zoomTheSnapshot();
    await press("Drag again across the snapshot chart");
    await waitFor(() => {
      expect(chartWindow()).toBe(NESTED_TEXT);
    });

    await openTab("Logs");
    expect(shellWindowOf(logsShellProbe)).toBe(NESTED_TEXT);

    await act(async () => {
      fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    });
    expect(shellWindowOf(logsShellProbe)).toBe(SNAPSHOT_TEXT);
  });

  test("a zoom made inside a companion stays its own: the snapshot keeps its slice", async () => {
    await renderPanel();
    await zoomTheSnapshot();
    await openTab("Logs");

    await act(async () => {
      lastProps(logsShellProbe).onHistogramTimeRangeSelect!(
        LOGS_ZOOM_START,
        LOGS_ZOOM_END,
      );
    });
    expect(shellWindowOf(logsShellProbe)).toBe(
      `${LOGS_ZOOM_START.toISOString()}..${LOGS_ZOOM_END.toISOString()}`,
    );

    await backOnMetrics();
    expect(chartWindow()).toBe(SLICE_TEXT);
  });
});

describe("the snapshot's zoom across the page's background refresh", () => {
  // The page re-reads the stored snapshot: new objects, the same values.
  async function refresh(rendered: RenderResult): Promise<void> {
    await act(async () => {
      rendered.rerender(panel());
    });
  }

  test("keeps the chart on the slice, with its way back", async () => {
    const rendered: RenderResult = await renderPanel();
    await zoomTheSnapshot();

    await refresh(rendered);

    expect(chartWindow()).toBe(SLICE_TEXT);
    expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    expect(resetButtons()).toHaveLength(1);
  });

  test("the tabs opened after it are still on the slice", async () => {
    const rendered: RenderResult = await renderPanel();
    await zoomTheSnapshot();
    await refresh(rendered);

    await openTab("Logs");

    expect(shellWindowOf(logsShellProbe)).toBe(SLICE_TEXT);
    await waitFor(() => {
      expect(logListWindow()).toBe(SLICE_TEXT);
    });
  });

  test("an open tab neither refetches nor moves", async () => {
    const rendered: RenderResult = await renderPanel();
    await zoomTheSnapshot();
    await openTab("Logs");
    await waitFor(() => {
      expect(logListWindow()).toBe(SLICE_TEXT);
    });
    const listFetches: number = logListQueries().length;

    await refresh(rendered);
    await refresh(rendered);

    expect(shellWindowOf(logsShellProbe)).toBe(SLICE_TEXT);
    expect(logListQueries().length).toBe(listFetches);
  });

  test("a reset after it still returns to the snapshot window", async () => {
    const rendered: RenderResult = await renderPanel();
    await zoomTheSnapshot();
    await refresh(rendered);

    await press("Double-click the snapshot chart");

    await waitFor(() => {
      expect(chartWindow()).toBe(SNAPSHOT_TEXT);
    });
    expect(resetButtons()).toHaveLength(0);
  });
});

describe("a snapshot of a new window ends the zoom", () => {
  const NEXT_START: Date = new Date("2026-09-14T18:30:00.000Z");
  const NEXT_END: Date = new Date("2026-09-14T18:45:00.000Z");
  const NEXT_TEXT: string = `${NEXT_START.toISOString()}..${NEXT_END.toISOString()}`;

  test("the chart and every tab move to the new window, with nothing to reset", async () => {
    const rendered: RenderResult = await renderPanel();
    await zoomTheSnapshot();

    await act(async () => {
      rendered.rerender(panel(NEXT_START, NEXT_END));
    });

    await waitFor(() => {
      expect(chartWindow()).toBe(NEXT_TEXT);
    });
    expect(charts().onTimeRangeReset).toBeUndefined();
    expect(resetButtons()).toHaveLength(0);

    await openTab("Traces");
    expect(shellWindowOf(shellProbe)).toBe(NEXT_TEXT);
  });

  test("an open companion tab follows the new window too", async () => {
    const rendered: RenderResult = await renderPanel();
    await zoomTheSnapshot();
    await openTab("Logs");

    await act(async () => {
      rendered.rerender(panel(NEXT_START, NEXT_END));
    });

    expect(shellWindowOf(logsShellProbe)).toBe(NEXT_TEXT);
    await waitFor(() => {
      expect(logListWindow()).toBe(NEXT_TEXT);
    });
    expect(resetButtons()).toHaveLength(0);
  });
});
