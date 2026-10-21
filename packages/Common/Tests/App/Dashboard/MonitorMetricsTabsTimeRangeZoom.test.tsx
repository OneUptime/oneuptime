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
 * Issue #4105 on a monitor's Metrics page, rendered for real: the page, its
 * tabs, every EmbeddedMetricCard and every MetricView. Only the chart
 * renderer (MetricCharts) is stood in for: its stand-in exposes the drag and
 * the double-click as buttons that call exactly the handlers MetricView
 * hands the real charts, and records the zoom the page offers them.
 *
 * - "Monitor Metrics" shows one card per metric category, all on ONE range
 *   the tab owns. A drag on any card zooms every card; a double-click on
 *   any OTHER card (or Reset zoom beside any card's picker) takes every
 *   card back to the range it had before the zoom.
 * - "Incident Metrics", "Alert Metrics" and "Custom Metrics" are one card
 *   each, on a range of their own: the card zooms and resets itself.
 *
 * Fetches are asserted on the metric API, so "every card follows" means
 * every card's data is re-queried over the dragged window.
 */

const getItemMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();
const eventLinesMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  metricViewData: {
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName?: unknown } };
    }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

// Latest props (and the zoom the page offers) per card, keyed by first metric.
const mockChartsByMetric: Record<string, MockChartsProps> = {};
const mockPageZoomByMetric: Record<string, unknown> = {};

// The window a drag in these tests selects.
const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-28T11:20:00.000Z"),
  end: new Date("2026-09-28T11:30:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const zoomContext: { useChartTimeRangeZoom: () => unknown } =
      jest.requireActual(
        "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
      ) as { useChartTimeRangeZoom: () => unknown };

    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        const metricName: string = String(
          props.metricViewData.queryConfigs[0]?.metricQueryData.filterData
            .metricName || "",
        );
        mockChartsByMetric[metricName] = props;
        mockPageZoomByMetric[metricName] = zoomContext.useChartTimeRangeZoom();

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        eventLinesMock(props);
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

// Each card's picker: shows the card's range and can pick "Past 1 Day".
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (value: { range: string }) => void;
    }) => {
      return (
        <button
          type="button"
          data-testid="card-picker"
          onClick={() => {
            props.onChange({ range: "Past 1 Day" });
          }}
        >
          {props.dashboardStartAndEndDate.range}
        </button>
      );
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        return new ObjectID("0193c0de-5555-4aaa-8bbb-000000000005");
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

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/DisabledWarning",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import MonitorMetricsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Metrics";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import MonitorMetricTypeUtil, {
  MonitorMetricCategory,
} from "../../../Utils/Monitor/MonitorMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HOUR_AGO: Date = new Date("2026-09-28T11:00:00.000Z");
const DAY_AGO: Date = new Date("2026-09-27T12:00:00.000Z");

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/monitors/view/metrics"),
  currentProject: null,
  hasPaymentMethod: true,
};

const CUSTOM_METRIC: string = "custom.monitor.checkout_latency";

// The first metric of each category card a server monitor shows.
const SERVER_CATEGORIES: Array<MonitorMetricCategory> =
  MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
    MonitorType.Server,
  );
const CARD_METRICS: Array<string> = SERVER_CATEGORIES.map(
  (category: MonitorMetricCategory): string => {
    return String(category.metrics[0]);
  },
);

type Window = [number, number];

function windowOf(start: Date, end: Date): Window {
  return [start.getTime(), end.getTime()];
}

// Every window the metric API was asked for, per queried metric.
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

function lastFetchedWindowFor(metricName: string): Window | undefined {
  const windows: Array<Window> = fetchedWindowsFor(metricName);
  return windows[windows.length - 1];
}

function chartsOf(metricName: string): MockChartsProps {
  const charts: MockChartsProps | undefined = mockChartsByMetric[metricName];
  if (!charts) {
    throw new Error(`No charts rendered for ${metricName}`);
  }
  return charts;
}

function pickerLabels(): Array<string> {
  return screen.getAllByTestId("card-picker").map((picker: HTMLElement) => {
    return picker.textContent || "";
  });
}

async function renderPage(): Promise<void> {
  render(<MonitorMetricsPage {...PAGE_PROPS} />);
  /*
   * MetricView draws its charts once before it loads, then shows a loader
   * until its first fetch lands: wait for every card's fetch and charts.
   */
  await waitFor(() => {
    for (const metricName of CARD_METRICS) {
      expect(fetchedWindowsFor(metricName).length).toBeGreaterThan(0);
      expect(screen.getByTestId(`charts-${metricName}`)).toBeInTheDocument();
    }
  });
  // waitFor ticks the fake clock; "now" is where the assertions read it.
  jest.setSystemTime(NOW);
}

async function openTab(name: string, metricName: string): Promise<void> {
  fireEvent.click(screen.getByRole("tab", { name: name }));
  await waitFor(() => {
    expect(fetchedWindowsFor(metricName).length).toBeGreaterThan(0);
    expect(screen.getByTestId(`charts-${metricName}`)).toBeInTheDocument();
  });
  jest.setSystemTime(NOW);
}

/*
 * Waits for the control to be on screen first: a chart sits behind
 * MetricView's loader until its latest fetch lands.
 */
async function click(label: string): Promise<void> {
  const control: HTMLElement = await screen.findByRole("button", {
    name: label,
  });
  // findByRole ticks the fake clock; a relative range resolves from NOW.
  jest.setSystemTime(NOW);
  fireEvent.click(control);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  getItemMock.mockReset();
  analyticsGetListMock.mockReset();
  fetchResultsMock.mockReset();
  eventLinesMock.mockReset();
  for (const key of Object.keys(mockChartsByMetric)) {
    delete mockChartsByMetric[key];
    delete mockPageZoomByMetric[key];
  }
  getItemMock.mockResolvedValue({ monitorType: MonitorType.Server });
  analyticsGetListMock.mockResolvedValue({ data: [{ name: CUSTOM_METRIC }] });
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Monitor Metrics tab: every category card on one range", () => {
  test("the tab shows several cards, all on the tab's past hour", async () => {
    await renderPage();

    expect(CARD_METRICS.length).toBeGreaterThan(2);
    expect(pickerLabels()).toEqual(
      CARD_METRICS.map(() => {
        return TimeRange.PAST_ONE_HOUR;
      }),
    );
    for (const metricName of CARD_METRICS) {
      /*
       * Resolved when the cards mounted, which the page's loading ticks
       * put a moment after NOW: an hour (its start floored onto the
       * minute grid), ending about now.
       */
      const [start, end] = lastFetchedWindowFor(metricName)!;
      expect(end - start).toBeGreaterThanOrEqual(60 * 60 * 1000);
      expect(end - start).toBeLessThan(61 * 60 * 1000);
      expect(Math.abs(end - NOW.getTime())).toBeLessThan(5000);
    }
  });

  test("every card's charts are handed the same page zoom, and no reset before a zoom", async () => {
    await renderPage();

    const first: MockChartsProps = chartsOf(CARD_METRICS[0]!);
    expect(first.onTimeRangeSelect).toBeInstanceOf(Function);

    for (const metricName of CARD_METRICS) {
      // One zoom for the whole tab, not one per card.
      expect(chartsOf(metricName).onTimeRangeSelect).toBe(
        first.onTimeRangeSelect,
      );
      expect(mockPageZoomByMetric[metricName]).toBe(
        mockPageZoomByMetric[CARD_METRICS[0]!],
      );
      /*
       * Charts hold every single click back while a reset is on offer, so
       * none is offered before there is a zoom to undo.
       */
      expect(chartsOf(metricName).onTimeRangeReset).toBeUndefined();
    }
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a drag on one card re-queries EVERY card over the dragged window", async () => {
    await renderPage();

    await click(`Drag across ${CARD_METRICS[1]}`);

    await waitFor(() => {
      for (const metricName of CARD_METRICS) {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      }
    });
    expect(pickerLabels()).toEqual(
      CARD_METRICS.map(() => {
        return TimeRange.CUSTOM;
      }),
    );
    // Every card offers the way back, beside its picker and on its charts.
    expect(
      screen.getAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toHaveLength(CARD_METRICS.length);
    for (const metricName of CARD_METRICS) {
      expect(chartsOf(metricName).onTimeRangeReset).toBeInstanceOf(Function);
    }
  });

  test("every card's incident and alert markers follow the zoom", async () => {
    await renderPage();

    await click(`Drag across ${CARD_METRICS[0]}`);

    await waitFor(() => {
      const latestWindows: Array<string> = eventLinesMock.mock.calls
        .slice(-CARD_METRICS.length)
        .map((call: Array<unknown>): string => {
          const window: InBetween<Date> = (
            call[0] as { window: InBetween<Date> }
          ).window;
          return `${window.startValue.toISOString()}/${window.endValue.toISOString()}`;
        });
      expect(latestWindows).toEqual(
        CARD_METRICS.map((): string => {
          return `${MOCK_DRAG.start.toISOString()}/${MOCK_DRAG.end.toISOString()}`;
        }),
      );
    });
  });

  test("a double-click on a DIFFERENT card takes every card back to the past hour", async () => {
    await renderPage();

    await click(`Drag across ${CARD_METRICS[0]}`);
    await waitFor(() => {
      expect(chartsOf(CARD_METRICS[2]!).onTimeRangeReset).toBeInstanceOf(
        Function,
      );
    });

    await click(`Double-click ${CARD_METRICS[2]}`);

    await waitFor(() => {
      for (const metricName of CARD_METRICS) {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(HOUR_AGO, NOW),
        );
      }
    });
    expect(pickerLabels()).toEqual(
      CARD_METRICS.map(() => {
        return TimeRange.PAST_ONE_HOUR;
      }),
    );
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    for (const metricName of CARD_METRICS) {
      expect(chartsOf(metricName).onTimeRangeReset).toBeUndefined();
    }
  });

  test("Reset zoom beside any card's picker does what a double-click does", async () => {
    await renderPage();

    await click(`Drag across ${CARD_METRICS[0]}`);
    const resetButtons: Array<HTMLElement> = await screen.findAllByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );

    jest.setSystemTime(NOW);
    fireEvent.click(resetButtons[resetButtons.length - 1]!);

    await waitFor(() => {
      expect(pickerLabels()).toEqual(
        CARD_METRICS.map(() => {
          return TimeRange.PAST_ONE_HOUR;
        }),
      );
    });
    for (const metricName of CARD_METRICS) {
      expect(lastFetchedWindowFor(metricName)).toEqual(windowOf(HOUR_AGO, NOW));
    }
  });

  test("zooming in twice, from two cards, needs ONE double-click to get back", async () => {
    await renderPage();

    await click(`Drag across ${CARD_METRICS[0]}`);
    await waitFor(() => {
      expect(pickerLabels()[0]).toBe(TimeRange.CUSTOM);
    });

    // A second, narrower drag from another card.
    const narrowerStart: Date = new Date("2026-09-28T11:22:00.000Z");
    const narrowerEnd: Date = new Date("2026-09-28T11:25:00.000Z");
    act(() => {
      chartsOf(CARD_METRICS[1]!).onTimeRangeSelect?.(
        narrowerStart,
        narrowerEnd,
      );
    });
    await waitFor(() => {
      expect(lastFetchedWindowFor(CARD_METRICS[0]!)).toEqual(
        windowOf(narrowerStart, narrowerEnd),
      );
    });

    await click(`Double-click ${CARD_METRICS[CARD_METRICS.length - 1]}`);

    await waitFor(() => {
      for (const metricName of CARD_METRICS) {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(HOUR_AGO, NOW),
        );
      }
    });
    expect(pickerLabels()[0]).toBe(TimeRange.PAST_ONE_HOUR);
  });

  test("picking a range in any card's picker ends the zoom for every card", async () => {
    await renderPage();

    await click(`Drag across ${CARD_METRICS[0]}`);
    await waitFor(() => {
      expect(
        screen.getAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toHaveLength(CARD_METRICS.length);
    });

    jest.setSystemTime(NOW);
    fireEvent.click(screen.getAllByTestId("card-picker")[1]!);

    await waitFor(() => {
      expect(pickerLabels()).toEqual(
        CARD_METRICS.map(() => {
          return TimeRange.PAST_ONE_DAY;
        }),
      );
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    for (const metricName of CARD_METRICS) {
      expect(chartsOf(metricName).onTimeRangeReset).toBeUndefined();
      expect(lastFetchedWindowFor(metricName)).toEqual(windowOf(DAY_AGO, NOW));
    }
  });

  test("a stray double-click with nothing zoomed leaves every card alone", async () => {
    await renderPage();
    const fetchesBefore: number = fetchResultsMock.mock.calls.length;

    // No handler is on offer; even calling what is there must not retime.
    await click(`Double-click ${CARD_METRICS[0]}`);

    expect(pickerLabels()).toEqual(
      CARD_METRICS.map(() => {
        return TimeRange.PAST_ONE_HOUR;
      }),
    );
    expect(fetchResultsMock.mock.calls.length).toBe(fetchesBefore);
  });
});

describe("the one-card tabs zoom their own card", () => {
  test.each<[string, string, TimeRange, Date]>([
    [
      "Incident Metrics",
      IncidentMetricType.IncidentCount,
      TimeRange.PAST_ONE_DAY,
      DAY_AGO,
    ],
    [
      "Alert Metrics",
      AlertMetricType.AlertCount,
      TimeRange.PAST_ONE_DAY,
      DAY_AGO,
    ],
  ])(
    "%s: a drag zooms the card, a double-click brings its range back",
    async (
      tabName: string,
      metricName: string,
      defaultRange: TimeRange,
      defaultStart: Date,
    ) => {
      await renderPage();
      await openTab(tabName, metricName);

      expect(pickerLabels()).toEqual([defaultRange]);
      expect(chartsOf(metricName).onTimeRangeSelect).toBeInstanceOf(Function);
      expect(chartsOf(metricName).onTimeRangeReset).toBeUndefined();

      await click(`Drag across ${metricName}`);

      await waitFor(() => {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      });
      expect(pickerLabels()).toEqual([TimeRange.CUSTOM]);
      expect(
        screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeVisible();

      await click(`Double-click ${metricName}`);

      await waitFor(() => {
        expect(pickerLabels()).toEqual([defaultRange]);
      });
      expect(lastFetchedWindowFor(metricName)).toEqual(
        windowOf(defaultStart, NOW),
      );
      expect(
        screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
    },
  );

  test("Incident Metrics: every bar panel in the card follows one zoom", async () => {
    await renderPage();
    await openTab("Incident Metrics", IncidentMetricType.IncidentCount);

    await click(`Drag across ${IncidentMetricType.IncidentCount}`);

    /*
     * The four panels (count, time to acknowledge, time to resolve,
     * duration) are one MetricView query set, so one refetch carries all
     * of them over the dragged window.
     */
    await waitFor(() => {
      for (const metricType of [
        IncidentMetricType.IncidentCount,
        IncidentMetricType.TimeToAcknowledge,
        IncidentMetricType.TimeToResolve,
        IncidentMetricType.IncidentDuration,
      ]) {
        expect(lastFetchedWindowFor(metricType)).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      }
    });
  });

  test("Custom Metrics: a drag zooms the card, Reset zoom brings the past hour back", async () => {
    getItemMock.mockResolvedValue({
      monitorType: MonitorType.SyntheticMonitor,
    });
    render(<MonitorMetricsPage {...PAGE_PROPS} />);
    await screen.findByRole("tab", { name: "Custom Metrics" });
    await openTab("Custom Metrics", CUSTOM_METRIC);

    expect(pickerLabels()).toEqual([TimeRange.PAST_ONE_HOUR]);

    await click(`Drag across ${CUSTOM_METRIC}`);
    await waitFor(() => {
      expect(lastFetchedWindowFor(CUSTOM_METRIC)).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
    });

    jest.setSystemTime(NOW);
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    await waitFor(() => {
      expect(lastFetchedWindowFor(CUSTOM_METRIC)).toEqual(
        windowOf(HOUR_AGO, NOW),
      );
    });
    expect(pickerLabels()).toEqual([TimeRange.PAST_ONE_HOUR]);
  });

  test("a zoom on a one-card tab is its own: the Monitor Metrics range is untouched", async () => {
    await renderPage();
    await openTab("Alert Metrics", AlertMetricType.AlertCount);

    await click(`Drag across ${AlertMetricType.AlertCount}`);
    await waitFor(() => {
      expect(pickerLabels()).toEqual([TimeRange.CUSTOM]);
    });

    await openTab("Monitor Metrics", CARD_METRICS[0]!);

    expect(pickerLabels()).toEqual(
      CARD_METRICS.map(() => {
        return TimeRange.PAST_ONE_HOUR;
      }),
    );
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });
});
