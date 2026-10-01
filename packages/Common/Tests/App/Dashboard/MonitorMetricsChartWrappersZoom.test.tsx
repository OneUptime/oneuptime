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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105, end to end down to the chart components, on a monitor's
 * Metrics page: the real page, tabs, EmbeddedMetricCards, MetricViews,
 * MetricCharts and ChartGroups. Only the leaf chart wrappers (Line, Area,
 * Bar) are stood in for, by components that resolve their zoom exactly
 * the way the real wrappers do (resolveChartTimeRangeZoom over their own
 * props and the page's zoom) and expose the drag and the double-click as
 * buttons. So what is proven here is what a reader's gesture on any
 * rendered chart panel does:
 *
 * - on "Monitor Metrics", a drag on a panel in the FIRST category card
 *   re-queries every card, and a double-click on a panel in the LAST card
 *   takes every card back;
 * - on "Incident Metrics", the bar panels (count, time to acknowledge,
 *   time to resolve, duration) zoom and reset their card.
 */

const getItemMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();

// What a rendered chart panel resolved on its latest render.
interface MockWrapperRecord {
  kind: string;
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset: (() => void) | undefined;
}

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-28T11:20:00.000Z"),
  end: new Date("2026-09-28T11:30:00.000Z"),
};

function mockChartWrapper(kind: string, modulePath: string): unknown {
  const actual: Record<string, unknown> = jest.requireActual(
    modulePath,
  ) as Record<string, unknown>;
  const zoomContext: {
    useChartTimeRangeZoom: () => unknown;
    resolveChartTimeRangeZoom: (input: unknown) => {
      onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
      onTimeRangeReset: (() => void) | undefined;
    };
  } = jest.requireActual(
    "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
  ) as {
    useChartTimeRangeZoom: () => unknown;
    resolveChartTimeRangeZoom: (input: unknown) => {
      onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
      onTimeRangeReset: (() => void) | undefined;
    };
  };

  return {
    ...actual,
    __esModule: true,
    default: (props: {
      xAxis?: { options?: { type?: string } };
      onTimeRangeSelect?: (startTime: Date, endTime: Date) => void;
      onTimeRangeReset?: () => void;
      disableTimeRangeZoom?: boolean;
    }): React.ReactElement => {
      // Resolved the way LineChart / AreaChart / BarChart resolve it.
      const zoom: {
        onTimeRangeSelect:
          | ((startTime: Date, endTime: Date) => void)
          | undefined;
        onTimeRangeReset: (() => void) | undefined;
      } = zoomContext.resolveChartTimeRangeZoom({
        onTimeRangeSelect: props.onTimeRangeSelect,
        onTimeRangeReset: props.onTimeRangeReset,
        isTimeAxis:
          props.xAxis?.options?.type === "time" ||
          props.xAxis?.options?.type === "date",
        disableTimeRangeZoom: props.disableTimeRangeZoom,
        pageZoom: zoomContext.useChartTimeRangeZoom(),
      });

      const record: MockWrapperRecord = {
        kind: kind,
        onTimeRangeSelect: zoom.onTimeRangeSelect,
        onTimeRangeReset: zoom.onTimeRangeReset,
      };

      return (
        <div
          data-testid="chart-panel"
          data-kind={kind}
          ref={(element: HTMLDivElement | null) => {
            if (element) {
              (element as unknown as { mockRecord: MockWrapperRecord })[
                "mockRecord"
              ] = record;
            }
          }}
        >
          <button
            type="button"
            data-testid="panel-drag"
            onClick={() => {
              zoom.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
            }}
          >
            drag
          </button>
          <button
            type="button"
            data-testid="panel-double-click"
            onClick={() => {
              zoom.onTimeRangeReset?.();
            }}
          >
            double-click
          </button>
        </div>
      );
    },
  };
}

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return mockChartWrapper(
    "line",
    "../../../UI/Components/Charts/Line/LineChart",
  );
});
jest.mock("../../../UI/Components/Charts/Area/AreaChart", () => {
  return mockChartWrapper(
    "area",
    "../../../UI/Components/Charts/Area/AreaChart",
  );
});
jest.mock("../../../UI/Components/Charts/Bar/BarChart", () => {
  return mockChartWrapper("bar", "../../../UI/Components/Charts/Bar/BarChart");
});

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
        fetchExemplars: () => {
          return Promise.resolve([]);
        },
        setQueryTopNOverride: () => {
          return undefined;
        },
        getQueryConfigTopNKey: (
          _queryConfig: unknown,
          index: number,
          scope?: string,
        ) => {
          return `${scope || ""}:${index}`;
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
        serializeAttributeFiltersForKey: (attributes: unknown) => {
          return JSON.stringify(attributes || {});
        },
      },
      DEFAULT_TOP_N_SERIES: 10,
      SHOW_ALL_SERIES_TOP_N: 10_000,
      sanitizeAttributeFilters: (attributes: unknown) => {
        return attributes;
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

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: { dashboardStartAndEndDate: { range: string } }) => {
      return (
        <span data-testid="card-picker">
          {props.dashboardStartAndEndDate.range}
        </span>
      );
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/Navigation",
  ) as Record<string, unknown>;
  return {
    __esModule: true,
    default: {
      ...(actual["default"] as Record<string, unknown>),
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
import MonitorMetricTypeUtil, {
  MonitorMetricCategory,
} from "../../../Utils/Monitor/MonitorMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HOUR_AGO: Date = new Date("2026-09-28T11:00:00.000Z");
const DAY_AGO: Date = new Date("2026-09-27T12:00:00.000Z");

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/monitors/view/metrics"),
  currentProject: null,
  hasPaymentMethod: true,
};

const SERVER_CATEGORIES: Array<MonitorMetricCategory> =
  MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
    MonitorType.Server,
  );
const ALL_SERVER_METRICS: Array<string> = SERVER_CATEGORIES.flatMap(
  (category: MonitorMetricCategory): Array<string> => {
    return category.metrics.map((metric: unknown): string => {
      return String(metric);
    });
  },
);
const FIRST_CARD_METRICS: Array<string> = SERVER_CATEGORIES[0]!.metrics.map(
  (metric: unknown): string => {
    return String(metric);
  },
);

type Window = [number, number];

function windowOf(start: Date, end: Date): Window {
  return [start.getTime(), end.getTime()];
}

function lastFetchedWindowFor(metricName: string): Window | undefined {
  let last: Window | undefined = undefined;
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
      last = [
        data.startAndEndDate.startValue.getTime(),
        data.startAndEndDate.endValue.getTime(),
      ];
    }
  }
  return last;
}

function panels(): Array<HTMLElement> {
  return screen.queryAllByTestId("chart-panel");
}

function recordOf(panel: HTMLElement): MockWrapperRecord {
  return (panel as unknown as { mockRecord: MockWrapperRecord }).mockRecord;
}

function pickerLabels(): Array<string> {
  return screen.getAllByTestId("card-picker").map((picker: HTMLElement) => {
    return picker.textContent || "";
  });
}

// One point per query, inside any window these tests chart.
function resultsFor(data: MetricViewData): Array<unknown> {
  return data.queryConfigs.map(() => {
    return {
      data: [
        {
          timestamp: new Date("2026-09-28T11:25:00.000Z"),
          value: 42,
        },
      ],
      truncated: false,
    };
  });
}

async function renderPage(expectedPanels: number): Promise<void> {
  render(<MonitorMetricsPage {...PAGE_PROPS} />);
  await waitFor(() => {
    expect(panels().length).toBeGreaterThanOrEqual(expectedPanels);
  });
  jest.setSystemTime(NOW);
}

async function clickPanel(
  panel: HTMLElement,
  testId: "panel-drag" | "panel-double-click",
): Promise<void> {
  jest.setSystemTime(NOW);
  fireEvent.click(
    panel.querySelector(`[data-testid='${testId}']`) as HTMLElement,
  );
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  getItemMock.mockReset();
  fetchResultsMock.mockReset();
  getItemMock.mockResolvedValue({ monitorType: MonitorType.Server });
  fetchResultsMock.mockImplementation((...args: Array<unknown>) => {
    return Promise.resolve(
      resultsFor(
        (args[0] as { metricViewData: MetricViewData }).metricViewData,
      ),
    );
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Monitor Metrics: every rendered chart panel on the tab shares one zoom", () => {
  test("every panel of every card takes the same drag, and none offers a reset before a zoom", async () => {
    await renderPage(ALL_SERVER_METRICS.length);

    const records: Array<MockWrapperRecord> = panels().map(recordOf);
    expect(records.length).toBeGreaterThanOrEqual(ALL_SERVER_METRICS.length);
    for (const record of records) {
      expect(record.onTimeRangeSelect).toBeInstanceOf(Function);
      expect(record.onTimeRangeSelect).toBe(records[0]!.onTimeRangeSelect);
      expect(record.onTimeRangeReset).toBeUndefined();
    }
  });

  test("a drag on a panel in the first card re-queries every card; a double-click on a panel in the last card takes them all back", async () => {
    await renderPage(ALL_SERVER_METRICS.length);

    await clickPanel(panels()[0]!, "panel-drag");

    await waitFor(() => {
      for (const metricName of ALL_SERVER_METRICS) {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      }
    });
    expect(pickerLabels()).toEqual(
      SERVER_CATEGORIES.map(() => {
        return TimeRange.CUSTOM;
      }),
    );
    await waitFor(() => {
      for (const panel of panels()) {
        expect(recordOf(panel).onTimeRangeReset).toBeInstanceOf(Function);
      }
    });

    const allPanels: Array<HTMLElement> = panels();
    await clickPanel(allPanels[allPanels.length - 1]!, "panel-double-click");

    await waitFor(() => {
      for (const metricName of ALL_SERVER_METRICS) {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(HOUR_AGO, NOW),
        );
      }
    });
    expect(pickerLabels()).toEqual(
      SERVER_CATEGORIES.map(() => {
        return TimeRange.PAST_ONE_HOUR;
      }),
    );
    await waitFor(() => {
      for (const panel of panels()) {
        expect(recordOf(panel).onTimeRangeReset).toBeUndefined();
      }
    });
  });

  test("the first card's own panels all follow a drag made on one of them", async () => {
    await renderPage(ALL_SERVER_METRICS.length);

    await clickPanel(panels()[FIRST_CARD_METRICS.length - 1]!, "panel-drag");

    await waitFor(() => {
      for (const metricName of FIRST_CARD_METRICS) {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      }
    });
  });
});

describe("Incident Metrics: the bar panels zoom and reset their card", () => {
  const INCIDENT_METRICS: Array<string> = [
    IncidentMetricType.IncidentCount,
    IncidentMetricType.TimeToAcknowledge,
    IncidentMetricType.TimeToResolve,
    IncidentMetricType.IncidentDuration,
  ];

  async function openIncidentMetrics(): Promise<void> {
    await renderPage(ALL_SERVER_METRICS.length);
    fireEvent.click(screen.getByRole("tab", { name: "Incident Metrics" }));
    await waitFor(() => {
      const barPanels: Array<HTMLElement> = panels().filter(
        (panel: HTMLElement) => {
          return panel.getAttribute("data-kind") === "bar";
        },
      );
      expect(barPanels).toHaveLength(INCIDENT_METRICS.length);
    });
    jest.setSystemTime(NOW);
  }

  test("every bar panel offers the drag", async () => {
    await openIncidentMetrics();

    for (const panel of panels()) {
      expect(panel.getAttribute("data-kind")).toBe("bar");
      expect(recordOf(panel).onTimeRangeSelect).toBeInstanceOf(Function);
      expect(recordOf(panel).onTimeRangeReset).toBeUndefined();
    }
  });

  test("a drag on one bar panel re-queries all four; a double-click on another brings the past day back", async () => {
    await openIncidentMetrics();

    await clickPanel(panels()[2]!, "panel-drag");

    await waitFor(() => {
      for (const metricName of INCIDENT_METRICS) {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      }
    });
    expect(pickerLabels()).toEqual([TimeRange.CUSTOM]);
    await waitFor(() => {
      expect(recordOf(panels()[0]!).onTimeRangeReset).toBeInstanceOf(Function);
    });

    await clickPanel(panels()[0]!, "panel-double-click");

    await waitFor(() => {
      for (const metricName of INCIDENT_METRICS) {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(DAY_AGO, NOW),
        );
      }
    });
    expect(pickerLabels()).toEqual([TimeRange.PAST_ONE_DAY]);
  });
});
