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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 in the Metrics tab of a telemetry snapshot card (the
 * companion metric card of a Logs, Traces or Exceptions snapshot on the
 * incident, alert and episode pages, and in the investigation drawer).
 *
 * The card zooms on its own terms: a drag narrows it, a double-click or
 * "Reset zoom" returns it to the snapshot window. The page around it
 * refreshes in the background after an acknowledge or an edit, and hands
 * the card a new but equal snapshot. That refresh used to reload the card
 * and forget its zoom while the tab kept the zoomed window: the chart stayed
 * on the slice with no Reset zoom and a double-click that did nothing, so
 * there was no way back to the snapshot window.
 *
 * MetricView and EmbeddedMetricCard are real; MetricCharts is stood in for
 * by buttons that call exactly the handlers MetricView hands the charts.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  metricViewData: {
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName?: unknown } };
    }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

const mockChartsByMetric: Record<string, MockChartsProps> = {};

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-14T17:50:00.000Z"),
  end: new Date("2026-09-14T17:55:00.000Z"),
};

// A second drag, inside the first one.
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
        const metricName: string = String(
          props.metricViewData.queryConfigs[0]?.metricQueryData.filterData
            .metricName || "",
        );
        mockChartsByMetric[metricName] = props;

        return (
          <div data-testid={`charts-${metricName}`}>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              {`Drag across ${metricName}`}
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
              {`Drag again across ${metricName}`}
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              {`Double-click ${metricName}`}
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

function mockViewer(name: string): {
  __esModule: boolean;
  default: () => React.ReactElement;
} {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid={`viewer-${name}`} />;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return mockViewer("logs");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return mockViewer("traces");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer",
  () => {
    return mockViewer("exceptions");
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

// The companion metric card's picker: shows the card's range, picks one.
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: {
        range: string;
        startAndEndDate?: { startValue: Date; endValue: Date };
      };
      onChange: (range: { range: string }) => void;
    }) => {
      const window: { startValue: Date; endValue: Date } | undefined =
        props.dashboardStartAndEndDate.startAndEndDate;
      return (
        <>
          <span data-testid="card-picker">
            {window
              ? `${props.dashboardStartAndEndDate.range} ${window.startValue.toISOString()}..${window.endValue.toISOString()}`
              : props.dashboardStartAndEndDate.range}
          </span>
          <button
            type="button"
            onClick={() => {
              props.onChange({ range: "Past 1 Hour" });
            }}
          >
            Pick the past hour
          </button>
        </>
      );
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import TelemetryCompanionSignalTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";

const NOW: Date = new Date("2026-09-14T19:00:00.000Z");
const SNAPSHOT_START: Date = new Date("2026-09-14T17:45:00.000Z");
const SNAPSHOT_END: Date = new Date("2026-09-14T18:00:00.000Z");
const COMPANION_METRIC: string = "checkout.latency";

type Window = [number, number];

function windowOf(start: Date, end: Date): Window {
  return [start.getTime(), end.getTime()];
}

function fetchedWindowsFor(metricName: string): Array<Window> {
  const windows: Array<Window> = [];
  for (const call of fetchResultsMock.mock.calls) {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    const queried: boolean = data.queryConfigs.some(
      (queryConfig: MetricViewData["queryConfigs"][number]): boolean => {
        return (
          String(queryConfig.metricQueryData.filterData.metricName) ===
          metricName
        );
      },
    );
    if (queried && data.startAndEndDate) {
      windows.push([
        data.startAndEndDate.startValue.getTime(),
        data.startAndEndDate.endValue.getTime(),
      ]);
    }
  }
  return windows;
}

function lastFetchedWindow(): Window | undefined {
  const windows: Array<Window> = fetchedWindowsFor(COMPANION_METRIC);
  return windows[windows.length - 1];
}

function charts(): MockChartsProps {
  const props: MockChartsProps | undefined =
    mockChartsByMetric[COMPANION_METRIC];
  if (!props) {
    throw new Error(`No charts rendered for ${COMPANION_METRIC}`);
  }
  return props;
}

function pickerText(): string {
  return screen.getByTestId("card-picker").textContent || "";
}

async function press(label: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: label }));
}

/*
 * MetricView draws its charts once before it loads, then shows a loader
 * until its first fetch lands: wait for that fetch and the charts after.
 */
async function chartsSettled(): Promise<void> {
  await waitFor(() => {
    expect(fetchedWindowsFor(COMPANION_METRIC).length).toBeGreaterThan(0);
    expect(
      screen.getByTestId(`charts-${COMPANION_METRIC}`),
    ).toBeInTheDocument();
  });
}

/*
 * A Logs snapshot as the page holds it. Every call builds NEW objects, the
 * way the incident page's background refresh re-reads the stored query.
 */
function logSnapshotQuery(
  extraScope?: Record<string, unknown>,
): TelemetryQuery {
  return {
    telemetryType: TelemetryType.Log,
    telemetryQuery: {
      time: new InBetween<Date>(
        new Date(SNAPSHOT_START.getTime()),
        new Date(SNAPSHOT_END.getTime()),
      ),
      ...(extraScope || {}),
    } as never,
    metricViewData: null,
  };
}

function snapshotWindow(start: Date, end: Date): InBetween<Date> {
  return new InBetween<Date>(
    new Date(start.getTime()),
    new Date(end.getTime()),
  );
}

interface CardProps {
  telemetryQuery: TelemetryQuery;
  window: InBetween<Date>;
}

function snapshotCard(props: CardProps): React.ReactElement {
  return (
    <TelemetryCompanionSignalTabs
      telemetryQuery={props.telemetryQuery}
      snapshotWindow={props.window}
      eventNoun="incident"
      primarySignalElement={<div data-testid="primary-logs" />}
    />
  );
}

async function openMetricsTab(): Promise<RenderResult> {
  const rendered: RenderResult = render(
    snapshotCard({
      telemetryQuery: logSnapshotQuery(),
      window: snapshotWindow(SNAPSHOT_START, SNAPSHOT_END),
    }),
  );
  fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
  await chartsSettled();
  return rendered;
}

async function zoomTheCard(): Promise<void> {
  await press(`Drag across ${COMPANION_METRIC}`);
  await waitFor(() => {
    expect(lastFetchedWindow()).toEqual(
      windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
    );
  });
  await waitFor(() => {
    expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
  });
  expect(
    screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
  ).toBeVisible();
}

// The page's background refresh: a new but equal snapshot.
async function refreshThePage(rendered: RenderResult): Promise<void> {
  await act(async () => {
    rendered.rerender(
      snapshotCard({
        telemetryQuery: logSnapshotQuery(),
        window: snapshotWindow(SNAPSHOT_START, SNAPSHOT_END),
      }),
    );
  });
}

function expectZoomedWithAWayBack(): void {
  expect(
    screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
  ).toBeVisible();
  expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
  expect(pickerText()).toBe(
    `Custom ${MOCK_DRAG.start.toISOString()}..${MOCK_DRAG.end.toISOString()}`,
  );
  expect(lastFetchedWindow()).toEqual(windowOf(MOCK_DRAG.start, MOCK_DRAG.end));
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  fetchResultsMock.mockReset();
  analyticsGetListMock.mockReset();
  for (const key of Object.keys(mockChartsByMetric)) {
    delete mockChartsByMetric[key];
  }
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  analyticsGetListMock.mockResolvedValue({
    data: [{ name: COMPANION_METRIC }],
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the companion Metrics tab across the page's background refresh", () => {
  test("starts on the snapshot window, with nothing to reset", async () => {
    await openMetricsTab();

    expect(lastFetchedWindow()).toEqual(windowOf(SNAPSHOT_START, SNAPSHOT_END));
    expect(pickerText()).toBe(
      `Custom ${SNAPSHOT_START.toISOString()}..${SNAPSHOT_END.toISOString()}`,
    );
    expect(charts().onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a refresh keeps the zoom AND its way back: Reset zoom and a double-click", async () => {
    const rendered: RenderResult = await openMetricsTab();
    await zoomTheCard();

    await refreshThePage(rendered);

    expectZoomedWithAWayBack();
  });

  test("a refresh does not blank the card or look its metrics up again", async () => {
    const rendered: RenderResult = await openMetricsTab();
    await zoomTheCard();
    const chartsBefore: HTMLElement = screen.getByTestId(
      `charts-${COMPANION_METRIC}`,
    );
    const lookups: number = analyticsGetListMock.mock.calls.length;
    const fetches: number = fetchResultsMock.mock.calls.length;

    await refreshThePage(rendered);

    // The very same chart: never unmounted behind a loader.
    expect(screen.getByTestId(`charts-${COMPANION_METRIC}`)).toBe(chartsBefore);
    expect(analyticsGetListMock.mock.calls.length).toBe(lookups);
    expect(fetchResultsMock.mock.calls.length).toBe(fetches);
  });

  test("a double-click after the refresh returns to the snapshot window", async () => {
    const rendered: RenderResult = await openMetricsTab();
    await zoomTheCard();
    await refreshThePage(rendered);

    await press(`Double-click ${COMPANION_METRIC}`);

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(
        windowOf(SNAPSHOT_START, SNAPSHOT_END),
      );
    });
    expect(pickerText()).toBe(
      `Custom ${SNAPSHOT_START.toISOString()}..${SNAPSHOT_END.toISOString()}`,
    );
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(charts().onTimeRangeReset).toBeUndefined();
  });

  test("Reset zoom after the refresh returns to the snapshot window", async () => {
    const rendered: RenderResult = await openMetricsTab();
    await zoomTheCard();
    await refreshThePage(rendered);

    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(
        windowOf(SNAPSHOT_START, SNAPSHOT_END),
      );
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a second drag after the refresh, then one reset, returns to the snapshot window, not to the first zoom", async () => {
    const rendered: RenderResult = await openMetricsTab();
    await zoomTheCard();
    await refreshThePage(rendered);

    await press(`Drag again across ${COMPANION_METRIC}`);
    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(
        windowOf(MOCK_NESTED_DRAG.start, MOCK_NESTED_DRAG.end),
      );
    });
    await press(`Double-click ${COMPANION_METRIC}`);

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(
        windowOf(SNAPSHOT_START, SNAPSHOT_END),
      );
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a snapshot whose scope changed reloads the card and still keeps its zoom and its way back", async () => {
    const rendered: RenderResult = await openMetricsTab();
    await zoomTheCard();
    const lookups: number = analyticsGetListMock.mock.calls.length;

    // Same window, different scope: the card looks its metrics up again.
    await act(async () => {
      rendered.rerender(
        snapshotCard({
          telemetryQuery: logSnapshotQuery({
            attributes: { "resource.service.name": "checkout" },
          }),
          window: snapshotWindow(SNAPSHOT_START, SNAPSHOT_END),
        }),
      );
    });
    await waitFor(() => {
      expect(analyticsGetListMock.mock.calls.length).toBeGreaterThan(lookups);
    });
    await chartsSettled();

    await waitFor(() => {
      expectZoomedWithAWayBack();
    });

    await press(`Double-click ${COMPANION_METRIC}`);
    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(
        windowOf(SNAPSHOT_START, SNAPSHOT_END),
      );
    });
  });

  test("a snapshot of a new window moves the card there and ends its zoom", async () => {
    const rendered: RenderResult = await openMetricsTab();
    await zoomTheCard();

    const nextStart: Date = new Date("2026-09-14T18:30:00.000Z");
    const nextEnd: Date = new Date("2026-09-14T18:45:00.000Z");
    await act(async () => {
      rendered.rerender(
        snapshotCard({
          telemetryQuery: {
            telemetryType: TelemetryType.Log,
            telemetryQuery: {
              time: new InBetween<Date>(nextStart, nextEnd),
            } as never,
            metricViewData: null,
          },
          window: snapshotWindow(nextStart, nextEnd),
        }),
      );
    });

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(windowOf(nextStart, nextEnd));
    });
    expect(pickerText()).toBe(
      `Custom ${nextStart.toISOString()}..${nextEnd.toISOString()}`,
    );
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(charts().onTimeRangeReset).toBeUndefined();
  });

  test("a range picked on the card is a new starting point: the zoom is over", async () => {
    await openMetricsTab();
    await zoomTheCard();

    await press("Pick the past hour");

    await waitFor(() => {
      expect(pickerText()).toBe("Past 1 Hour");
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(charts().onTimeRangeReset).toBeUndefined();
  });

  test("the page's refresh after a pick keeps the picked range", async () => {
    const rendered: RenderResult = await openMetricsTab();
    await zoomTheCard();
    await press("Pick the past hour");
    await waitFor(() => {
      expect(pickerText()).toBe("Past 1 Hour");
    });

    await refreshThePage(rendered);

    expect(pickerText()).toBe("Past 1 Hour");
  });
});
