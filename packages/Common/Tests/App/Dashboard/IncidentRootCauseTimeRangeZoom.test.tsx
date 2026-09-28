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
 * Issue #4105 on an incident's Root Cause page: "Metric at Incident Time"
 * charts the metric that opened the incident from 30 minutes before it was
 * declared to 15 minutes after. A drag used to narrow that window with no
 * way back short of a reload. The page is rendered for real (the root
 * cause text card stubbed); MetricCharts is stood in for with buttons that
 * call exactly the handlers MetricView hands the charts.
 */

const getItemMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  timeReferenceLines?: Array<{ date: Date; label?: string }> | undefined;
}

let mockLatestCharts: MockChartsProps | null = null;

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-28T11:20:00.000Z"),
  end: new Date("2026-09-28T11:35:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        mockLatestCharts = props;
        return (
          <div data-testid="metric-charts">
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              Drag across the chart
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              Double-click the chart
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        return new ObjectID("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="root-cause-text" />;
    },
  };
});

import RootCausePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/RootCause";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import Route from "../../../Types/API/Route";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";

const NOW: Date = new Date("2026-09-28T13:00:00.000Z");
const DECLARED_AT: Date = new Date("2026-09-28T11:30:00.000Z");
// 30 minutes before the declaration to 15 minutes after.
const ANCHOR_START: Date = new Date("2026-09-28T11:00:00.000Z");
const ANCHOR_END: Date = new Date("2026-09-28T11:45:00.000Z");

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/incidents/view/root-cause"),
  currentProject: null,
  hasPaymentMethod: true,
};

type Window = [number, number];

function windowOf(start: Date, end: Date): Window {
  return [start.getTime(), end.getTime()];
}

function fetchedWindows(): Array<Window> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): Window => {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return [
      data.startAndEndDate!.startValue.getTime(),
      data.startAndEndDate!.endValue.getTime(),
    ];
  });
}

function lastFetchedWindow(): Window | undefined {
  const windows: Array<Window> = fetchedWindows();
  return windows[windows.length - 1];
}

function charts(): MockChartsProps {
  if (!mockLatestCharts) {
    throw new Error("The chart has not rendered");
  }
  return mockLatestCharts;
}

function buildIncident(): Record<string, unknown> {
  return {
    createdAt: DECLARED_AT,
    seriesLabels: undefined,
    monitors: [
      {
        monitorType: MonitorType.Metrics,
        monitorSteps: {
          data: {
            monitorStepsInstanceArray: [
              {
                data: {
                  metricMonitor: {
                    metricViewConfig: {
                      queryConfigs: [
                        {
                          metricAliasData: {
                            metricVariable: "a",
                            title: "CPU",
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
                  },
                },
              },
            ],
          },
        },
      },
    ],
  };
}

async function renderPage(): Promise<void> {
  render(<RootCausePage {...PAGE_PROPS} />);
  /*
   * MetricView draws its charts once before it loads, then shows a loader
   * until its first fetch lands: wait for that fetch and the charts after.
   */
  await waitFor(() => {
    expect(fetchedWindows().length).toBeGreaterThan(0);
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  getItemMock.mockReset();
  fetchResultsMock.mockReset();
  mockLatestCharts = null;
  getItemMock.mockResolvedValue(buildIncident());
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Root Cause: Metric at Incident Time", () => {
  test("charts the window around the declaration, with the marker, and offers a drag", async () => {
    await renderPage();

    expect(lastFetchedWindow()).toEqual(windowOf(ANCHOR_START, ANCHOR_END));
    expect(
      charts().timeReferenceLines?.map((line: { date: Date }) => {
        return line.date.toISOString();
      }),
    ).toEqual([DECLARED_AT.toISOString()]);
    expect(charts().onTimeRangeSelect).toBeInstanceOf(Function);
    // Nothing to undo yet, so single clicks are not held back.
    expect(charts().onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a drag re-queries the dragged window and offers the way back", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Drag across the chart" }),
    );

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
    });
    expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
    // The declaration marker stays on the zoomed chart.
    expect(charts().timeReferenceLines?.[0]?.date.toISOString()).toBe(
      DECLARED_AT.toISOString(),
    );
  });

  test("a double-click returns to the window around the declaration, not to now", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Drag across the chart" }),
    );
    await waitFor(() => {
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Double-click the chart" }),
    );

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(windowOf(ANCHOR_START, ANCHOR_END));
    });
    expect(charts().onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("Reset zoom does what a double-click does", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Drag across the chart" }),
    );
    fireEvent.click(
      await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(windowOf(ANCHOR_START, ANCHOR_END));
    });
  });

  test("two drags deep, one double-click still returns to the window around the declaration", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Drag across the chart" }),
    );
    await waitFor(() => {
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    });
    const deeperStart: Date = new Date("2026-09-28T11:25:00.000Z");
    const deeperEnd: Date = new Date("2026-09-28T11:28:00.000Z");
    act(() => {
      charts().onTimeRangeSelect?.(deeperStart, deeperEnd);
    });
    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(windowOf(deeperStart, deeperEnd));
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Double-click the chart" }),
    );

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(windowOf(ANCHOR_START, ANCHOR_END));
    });
  });
});
