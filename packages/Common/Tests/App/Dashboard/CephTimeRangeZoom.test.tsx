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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the Ceph cluster pages. Every time-series chart on them
 * zooms the range it is drawn over, and a double-click on any of them (or
 * "Reset zoom" in the card header) puts the range back:
 *
 *   - Overview: the Golden Signals card's range is the PAGE's (it feeds the
 *     card's metric charts and its two rate charts, and the auto-refresh
 *     slides it), so every chart in the card zooms the page;
 *   - Insights: four cards share the page's one range, so they share one
 *     zoom - a drag in one card retimes all four, a double-click in any card
 *     resets them all;
 *   - Pool and OSD detail, Metrics tab: the tab's card owns its range, and
 *     its metric charts and the pool's rate charts share the card's zoom.
 *
 * The network is replaced (model and analytics APIs), and so are the
 * MetricView inside each card (its own zoom handling has its own suite: the
 * stand-in records the handlers the card hands it and the window it is
 * asked for) and the card's range picker (a stand-in that shows the range
 * and can pick "Past 1 Day"). EmbeddedMetricCard, CephRateChart, the pages
 * and ResourceMetricsTab render for real; the rate charts' line chart is
 * ChartZoomStandIn, which resolves its zoom as the real wrapper does.
 */

const CLUSTER_ID: string = "0193c0de-6666-4aaa-8bbb-000000000006";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;
const ZOOM_START: Date = new Date("2026-09-28T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-28T11:40:00.000Z");
const INNER_ZOOM_START: Date = new Date("2026-09-28T11:25:00.000Z");
const INNER_ZOOM_END: Date = new Date("2026-09-28T11:30:00.000Z");

const IOPS_CHART: string = "Read + Write [ops/s]";
const THROUGHPUT_CHART: string = "Read + Write [By/s]";

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsAggregateMock: MockFunction = getJestMockFunction();

let mockLastParam: string = "1";

interface MockMetricViewProps {
  data: {
    startAndEndDate: { startValue: Date; endValue: Date };
    queryConfigs: Array<{ metricAliasData?: { metricVariable?: string } }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

// The latest props of each MetricView, by its query variables.
const mockMetricViews: Map<string, MockMetricViewProps> = new Map();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (props: MockMetricViewProps): React.ReactElement => {
        const name: string = props.data.queryConfigs
          .map((query: { metricAliasData?: { metricVariable?: string } }) => {
            return query.metricAliasData?.metricVariable || "";
          })
          .join("+");
        mockMetricViews.set(name, props);
        return (
          <div
            data-testid={`metric-view ${name}`}
            onDoubleClick={props.onTimeRangeReset}
          >
            <button
              type="button"
              onClick={() => {
                const drag: { start: Date; end: Date } = (
                  jest.requireActual("./ChartZoomStandIn") as {
                    standInDrag: { start: Date; end: Date };
                  }
                ).standInDrag;
                props.onTimeRangeSelect?.(drag.start, drag.end);
              }}
            >
              {`Drag across metrics ${name}`}
            </button>
          </div>
        );
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

// Each card's picker: shows its range, and can pick "Past 1 Day".
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
      onChange: (value: { range: string }) => void;
    }): React.ReactElement => {
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

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Line/LineChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return modelGetItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return modelGetListMock(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(1);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return analyticsGetListMock(...args);
      },
      aggregate: (...args: Array<unknown>): unknown => {
        return analyticsAggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-6666-4aaa-8bbb-000000000006");
      },
      getLastParamAsString: (): string => {
        return mockLastParam;
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="card-model-detail" />;
    },
  };
});

/*
 * The hero's refresh control: "Refresh now" is what an auto-refresh tick
 * calls too (fetchAll(false)).
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: { onManualRefresh: () => void }): React.ReactElement => {
        return (
          <button type="button" onClick={props.onManualRefresh}>
            Refresh now
          </button>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: () => {},
        };
      },
    };
  },
);

import CephClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index";
import CephClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Insights";
import CephClusterPoolDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/PoolDetail";
import CephClusterOsdDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/OsdDetail";
import CephRateChart from "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephRateChart";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  StandInChartRecord,
  getStandInChart,
  resetStandInCharts,
  standInCharts,
  standInDrag,
} from "./ChartZoomStandIn";
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import TimeRange from "../../../Types/Time/TimeRange";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- fixtures

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

const CLUSTER: Record<string, unknown> = {
  _id: CLUSTER_ID,
  name: "ceph-prod",
  fsid: "3b0c1f7e-aaaa-bbbb-cccc-000000000001",
  otelCollectorStatus: "connected",
  lastSeenAt: minutesAgo(1),
  cephVersion: "18.2.4",
  healthStatus: 0,
  monCount: 3,
  osdCount: 2,
  osdUpCount: 2,
  osdInCount: 2,
  poolCount: 1,
  capacityUsedPercent: 12.34,
};

type Row = Record<string, unknown>;

const ROWS_BY_KIND: Record<string, Array<Row>> = {
  Osd: [
    {
      kind: "Osd",
      externalId: "osd.1",
      hostname: "node-b",
      deviceClass: "hdd",
      isUp: true,
      isIn: true,
      statBytes: 2000 * GIB,
      statBytesUsed: 500 * GIB,
      pgCount: 101,
      applyLatencyMs: 12,
      commitLatencyMs: 13,
      metricsUpdatedAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
      createdAt: minutesAgo(60 * 24 * 3),
    },
  ],
  Pool: [
    {
      kind: "Pool",
      externalId: "1",
      name: "rbd",
      storedBytes: 300 * GIB,
      maxAvailBytes: 700 * GIB,
      objects: 76800,
      metricsUpdatedAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
      createdAt: minutesAgo(60 * 24 * 3),
    },
  ],
  Mon: [],
  Mgr: [],
  Mds: [],
  Rgw: [],
};

const RATE_METRICS: Array<string> = [
  "ceph_pool_rd",
  "ceph_pool_wr",
  "ceph_pool_rd_bytes",
  "ceph_pool_wr_bytes",
];

interface CapturedAggregate {
  name: string;
  start: Date;
  end: Date;
  attributes: Record<string, unknown>;
}

function aggregateCall(args: unknown): CapturedAggregate {
  const aggregateBy: {
    query: { name: string; attributes?: Record<string, unknown> };
    startTimestamp: Date;
    endTimestamp: Date;
  } = (args as { aggregateBy: never }).aggregateBy;
  return {
    name: aggregateBy.query.name,
    start: aggregateBy.startTimestamp,
    end: aggregateBy.endTimestamp,
    attributes: aggregateBy.query.attributes || {},
  };
}

// A cumulative counter climbing through the window it is asked for.
function counterRows(start: Date, end: Date, perSecond: number): Array<Row> {
  const step: number = (end.getTime() - start.getTime()) / 4;
  return [1, 2, 3].map((i: number) => {
    return {
      timestamp: new Date(start.getTime() + i * step),
      value: 1000 + perSecond * ((i * step) / 1000),
      attributes: { pool_id: "1" },
    };
  });
}

// Rate metrics answer this for a window of the given length (null: data).
let mockQuietWindowMinutes: number | null = null;

function arrange(): void {
  modelGetItemMock.mockImplementation(async () => {
    return CLUSTER;
  });

  modelGetListMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> = (
      args as { query: Record<string, unknown> }
    ).query;
    const rows: Array<Row> = ROWS_BY_KIND[String(query["kind"])] || [];
    const filtered: Array<Row> = query["externalId"]
      ? rows.filter((row: Row) => {
          return row["externalId"] === query["externalId"];
        })
      : rows;
    return { data: filtered, count: filtered.length, skip: 0, limit: 100 };
  });

  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });

  analyticsAggregateMock.mockImplementation(async (args: unknown) => {
    const call: CapturedAggregate = aggregateCall(args);
    if (RATE_METRICS.includes(call.name)) {
      const minutes: number =
        (call.end.getTime() - call.start.getTime()) / MINUTE;
      if (
        mockQuietWindowMinutes !== null &&
        minutes === mockQuietWindowMinutes
      ) {
        return { data: [] };
      }
      return { data: counterRows(call.start, call.end, 10) };
    }
    if (call.name === "ceph_cluster_total_used_bytes") {
      return {
        data: [
          { timestamp: minutesAgo(120), value: 100 * GIB },
          { timestamp: minutesAgo(0), value: 300 * GIB },
        ],
      };
    }
    return { data: [] };
  });
}

// ----------------------------------------------------------------- helpers

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function metricView(name: string): MockMetricViewProps {
  const props: MockMetricViewProps | undefined = mockMetricViews.get(name);
  if (!props) {
    throw new Error(
      `MetricView "${name}" has not rendered. Rendered: ${Array.from(
        mockMetricViews.keys(),
      ).join(", ")}`,
    );
  }
  return props;
}

function metricViewWindow(name: string): [string, string] {
  const window: { startValue: Date; endValue: Date } =
    metricView(name).data.startAndEndDate;
  return [window.startValue.toISOString(), window.endValue.toISOString()];
}

function metricViewMinutes(name: string): number {
  const window: { startValue: Date; endValue: Date } =
    metricView(name).data.startAndEndDate;
  return (window.endValue.getTime() - window.startValue.getTime()) / MINUTE;
}

// The latest window each rate metric was fetched over.
function rateWindow(metricName: string): [string, string] {
  const calls: Array<CapturedAggregate> = analyticsAggregateMock.mock.calls
    .map((call: Array<unknown>) => {
      return aggregateCall(call[0]);
    })
    .filter((call: CapturedAggregate) => {
      return call.name === metricName;
    });
  const last: CapturedAggregate | undefined = calls[calls.length - 1];
  if (!last) {
    throw new Error(`${metricName} was never fetched`);
  }
  return [last.start.toISOString(), last.end.toISOString()];
}

function rateCalls(metricName: string): Array<CapturedAggregate> {
  return analyticsAggregateMock.mock.calls
    .map((call: Array<unknown>) => {
      return aggregateCall(call[0]);
    })
    .filter((call: CapturedAggregate) => {
      return call.name === metricName;
    });
}

function chartWindow(name: string): [string, string] {
  const record: StandInChartRecord = getStandInChart(name);
  return [
    (record.props.xAxis.options.min as Date).toISOString(),
    (record.props.xAxis.options.max as Date).toISOString(),
  ];
}

const ZOOM_WINDOW: [string, string] = [
  ZOOM_START.toISOString(),
  ZOOM_END.toISOString(),
];

async function waitForCharts(names: Array<string>): Promise<void> {
  await waitFor(() => {
    for (const name of names) {
      expect(screen.getByTestId(`chart ${name}`)).toBeInTheDocument();
    }
  });
}

async function dragAcrossChart(
  name: string,
  start: Date = ZOOM_START,
  end: Date = ZOOM_END,
): Promise<void> {
  standInDrag.start = start;
  standInDrag.end = end;
  fireEvent.click(screen.getByRole("button", { name: `Drag across ${name}` }));
  await flush();
}

async function dragAcrossMetrics(
  name: string,
  start: Date = ZOOM_START,
  end: Date = ZOOM_END,
): Promise<void> {
  standInDrag.start = start;
  standInDrag.end = end;
  fireEvent.click(
    screen.getByRole("button", { name: `Drag across metrics ${name}` }),
  );
  await flush();
}

async function doubleClickTestId(testId: string): Promise<void> {
  fireEvent.doubleClick(screen.getByTestId(testId));
  await flush();
}

function pickers(): Array<string> {
  return screen
    .getAllByTestId("card-picker")
    .map((picker: HTMLElement): string => {
      return picker.textContent || "";
    });
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockLastParam = "1";
  mockQuietWindowMinutes = null;
  mockMetricViews.clear();
  resetStandInCharts();
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    analyticsGetListMock,
    analyticsAggregateMock,
  ]) {
    mock.mockReset();
  }
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// --------------------------------------------------------------- Overview

const GOLDEN_METRICS: string =
  "cluster_used_bytes+osd_apply_latency+osd_commit_latency";

async function renderOverview(): Promise<void> {
  render(<CephClusterOverview {...PAGE_PROPS} />);
  await flush();
  await waitFor(() => {
    expect(
      screen.getByTestId(`metric-view ${GOLDEN_METRICS}`),
    ).toBeInTheDocument();
  });
  await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);
}

describe("Ceph cluster Overview: the Golden Signals card zooms the page's range", () => {
  test("the card's metric charts and both rate charts share the page's zoom", async () => {
    await renderOverview();

    const select: unknown = metricView(GOLDEN_METRICS).onTimeRangeSelect;
    expect(select).toBeInstanceOf(Function);
    expect(getStandInChart(IOPS_CHART).zoom.onTimeRangeSelect).toBe(select);
    expect(getStandInChart(THROUGHPUT_CHART).zoom.onTimeRangeSelect).toBe(
      select,
    );
    // The rate charts pass no handlers of their own: they take the page's.
    expect(getStandInChart(IOPS_CHART).props.onTimeRangeSelect).toBeUndefined();
    // Nothing to reset yet.
    expect(metricView(GOLDEN_METRICS).onTimeRangeReset).toBeUndefined();
    expect(getStandInChart(IOPS_CHART).zoom.onTimeRangeReset).toBeUndefined();
    expect(resetButtons()).toHaveLength(0);
  });

  test("a drag on a rate chart re-fetches the metric charts and both rate charts over the dragged window", async () => {
    await renderOverview();
    expect(metricViewMinutes(GOLDEN_METRICS)).toBe(60);

    await dragAcrossChart(IOPS_CHART);
    await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);

    expect(metricViewWindow(GOLDEN_METRICS)).toEqual(ZOOM_WINDOW);
    for (const metricName of RATE_METRICS) {
      expect([metricName, ...rateWindow(metricName)]).toEqual([
        metricName,
        ...ZOOM_WINDOW,
      ]);
    }
    expect(chartWindow(IOPS_CHART)).toEqual(ZOOM_WINDOW);
    expect(chartWindow(THROUGHPUT_CHART)).toEqual(ZOOM_WINDOW);
  });

  test("after a drag the card's picker reads Custom and its header offers Reset zoom", async () => {
    await renderOverview();

    await dragAcrossMetrics(GOLDEN_METRICS);

    expect(pickers()).toEqual([TimeRange.CUSTOM]);
    expect(resetButtons()).toHaveLength(1);
    expect(metricView(GOLDEN_METRICS).onTimeRangeReset).toBeInstanceOf(
      Function,
    );
    await waitForCharts([IOPS_CHART]);
    expect(getStandInChart(IOPS_CHART).zoom.onTimeRangeReset).toBe(
      metricView(GOLDEN_METRICS).onTimeRangeReset,
    );
  });

  test("a double-click on the metric chart undoes a zoom made on a rate chart", async () => {
    await renderOverview();

    await dragAcrossChart(THROUGHPUT_CHART);
    await doubleClickTestId(`metric-view ${GOLDEN_METRICS}`);
    await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(GOLDEN_METRICS)).toBe(60);
    expect(resetButtons()).toHaveLength(0);
    const [start, end]: [string, string] = rateWindow("ceph_pool_rd");
    expect((Date.parse(end) - Date.parse(start)) / MINUTE).toBe(60);
  });

  test("a double-click on a rate chart undoes a zoom made on the metric chart", async () => {
    await renderOverview();

    await dragAcrossMetrics(GOLDEN_METRICS);
    await waitForCharts([IOPS_CHART]);
    await doubleClickTestId(`chart ${IOPS_CHART}`);

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(GOLDEN_METRICS)).toBe(60);
  });

  test("Reset zoom in the card header puts the range back", async () => {
    await renderOverview();

    await dragAcrossChart(IOPS_CHART);
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(GOLDEN_METRICS)).toBe(60);
    expect(resetButtons()).toHaveLength(0);
  });

  test("a zoom within a zoom: one double-click returns to the past hour", async () => {
    await renderOverview();

    await dragAcrossChart(IOPS_CHART);
    await waitForCharts([THROUGHPUT_CHART]);
    await dragAcrossChart(THROUGHPUT_CHART, INNER_ZOOM_START, INNER_ZOOM_END);
    expect(metricViewWindow(GOLDEN_METRICS)).toEqual([
      INNER_ZOOM_START.toISOString(),
      INNER_ZOOM_END.toISOString(),
    ]);

    await doubleClickTestId(`metric-view ${GOLDEN_METRICS}`);

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(GOLDEN_METRICS)).toBe(60);
  });

  test("an auto-refresh leaves a zoom pinned; after a reset it slides the past hour again", async () => {
    await renderOverview();

    await dragAcrossChart(IOPS_CHART);
    await waitForCharts([IOPS_CHART]);

    // A minute later, the auto-refresh ticks.
    jest.setSystemTime(new Date(NOW.getTime() + MINUTE));
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await flush();

    expect(metricViewWindow(GOLDEN_METRICS)).toEqual(ZOOM_WINDOW);
    expect(resetButtons()).toHaveLength(1);

    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();
    const before: string = metricViewWindow(GOLDEN_METRICS)[1];

    jest.setSystemTime(new Date(NOW.getTime() + 2 * MINUTE));
    fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
    await flush();

    // The preset slides forward with the clock again.
    expect(Date.parse(metricViewWindow(GOLDEN_METRICS)[1])).toBeGreaterThan(
      Date.parse(before),
    );
    expect(metricViewMinutes(GOLDEN_METRICS)).toBe(60);
  });

  test("the card's own Refresh keeps the zoom", async () => {
    await renderOverview();

    await dragAcrossChart(IOPS_CHART);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await flush();

    expect(pickers()).toEqual([TimeRange.CUSTOM]);
    expect(metricViewWindow(GOLDEN_METRICS)).toEqual(ZOOM_WINDOW);
    expect(resetButtons()).toHaveLength(1);
  });

  test("the Capacity tile's 24-hour projection does not follow the zoom", async () => {
    await renderOverview();
    const capacityCalls: number = rateCalls(
      "ceph_cluster_total_used_bytes",
    ).length;

    await dragAcrossChart(IOPS_CHART);

    expect(rateCalls("ceph_cluster_total_used_bytes")).toHaveLength(
      capacityCalls,
    );
  });

  test("a zoom into a quiet stretch: the empty rate chart takes the double-click", async () => {
    await renderOverview();
    mockQuietWindowMinutes = 20;

    await dragAcrossChart(IOPS_CHART);

    const empty: HTMLElement = await screen.findByText(
      "No client I/O reported in the selected time range.",
    );
    fireEvent.doubleClick(empty);
    await flush();

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(GOLDEN_METRICS)).toBe(60);
  });

  test("picking a range in the card's picker ends the zoom", async () => {
    await renderOverview();

    await dragAcrossChart(IOPS_CHART);
    fireEvent.click(screen.getByTestId("card-picker"));
    await flush();

    expect(pickers()).toEqual([TimeRange.PAST_ONE_DAY]);
    expect(metricViewMinutes(GOLDEN_METRICS)).toBe(24 * 60);
    expect(resetButtons()).toHaveLength(0);
  });
});

// --------------------------------------------------------------- Insights

const CAPACITY_METRICS: string = "cluster_used_bytes+pool_stored";
const LATENCY_METRICS: string = "osd_apply_latency+osd_commit_latency";
const DATA_HEALTH_METRICS: string =
  "objects_degraded+objects_misplaced+pg_degraded+pg_undersized";
const INSIGHTS_METRIC_VIEWS: Array<string> = [
  CAPACITY_METRICS,
  LATENCY_METRICS,
  DATA_HEALTH_METRICS,
];

async function renderInsights(): Promise<void> {
  render(<CephClusterInsights {...PAGE_PROPS} />);
  await flush();
  await waitFor(() => {
    for (const name of INSIGHTS_METRIC_VIEWS) {
      expect(screen.getByTestId(`metric-view ${name}`)).toBeInTheDocument();
    }
  });
  await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);
}

function expectEveryInsightsChartOn(window: [string, string]): void {
  for (const name of INSIGHTS_METRIC_VIEWS) {
    expect([name, ...metricViewWindow(name)]).toEqual([name, ...window]);
  }
  for (const metricName of RATE_METRICS) {
    expect([metricName, ...rateWindow(metricName)]).toEqual([
      metricName,
      ...window,
    ]);
  }
}

function expectEveryInsightsChartOnThePastHour(): void {
  for (const name of INSIGHTS_METRIC_VIEWS) {
    expect([name, metricViewMinutes(name)]).toEqual([name, 60]);
  }
  expect(pickers()).toEqual([
    TimeRange.PAST_ONE_HOUR,
    TimeRange.PAST_ONE_HOUR,
    TimeRange.PAST_ONE_HOUR,
    TimeRange.PAST_ONE_HOUR,
  ]);
  expect(resetButtons()).toHaveLength(0);
}

describe("Ceph Insights: four cards, one range, one zoom", () => {
  test("every chart in every card takes the same page zoom", async () => {
    await renderInsights();

    const select: unknown = metricView(CAPACITY_METRICS).onTimeRangeSelect;
    expect(select).toBeInstanceOf(Function);
    for (const name of INSIGHTS_METRIC_VIEWS) {
      expect([name, metricView(name).onTimeRangeSelect]).toEqual([
        name,
        select,
      ]);
    }
    expect(getStandInChart(IOPS_CHART).zoom.onTimeRangeSelect).toBe(select);
    expect(getStandInChart(THROUGHPUT_CHART).zoom.onTimeRangeSelect).toBe(
      select,
    );
  });

  test("a drag in the Capacity card retimes all four cards", async () => {
    await renderInsights();

    await dragAcrossMetrics(CAPACITY_METRICS);
    await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);

    expectEveryInsightsChartOn(ZOOM_WINDOW);
    expect(pickers()).toEqual([
      TimeRange.CUSTOM,
      TimeRange.CUSTOM,
      TimeRange.CUSTOM,
      TimeRange.CUSTOM,
    ]);
    // Every card's header offers the way back.
    expect(resetButtons()).toHaveLength(4);
  });

  test("a drag on a rate chart in the Client I/O card retimes the other three", async () => {
    await renderInsights();

    await dragAcrossChart(THROUGHPUT_CHART);
    await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);

    expectEveryInsightsChartOn(ZOOM_WINDOW);
  });

  test("a double-click in ANOTHER card undoes the zoom in every card", async () => {
    await renderInsights();

    await dragAcrossMetrics(CAPACITY_METRICS);
    await doubleClickTestId(`metric-view ${DATA_HEALTH_METRICS}`);
    await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);

    expectEveryInsightsChartOnThePastHour();
  });

  test("a double-click on a rate chart undoes a zoom made in the Latency card", async () => {
    await renderInsights();

    await dragAcrossMetrics(LATENCY_METRICS);
    await waitForCharts([IOPS_CHART]);
    await doubleClickTestId(`chart ${IOPS_CHART}`);

    expectEveryInsightsChartOnThePastHour();
  });

  test("Reset zoom in any card's header resets them all", async () => {
    await renderInsights();

    await dragAcrossMetrics(LATENCY_METRICS);
    // The Data Health card's button (the last card).
    fireEvent.click(resetButtons()[3]!);
    await flush();

    expectEveryInsightsChartOnThePastHour();
  });

  test("a zoom within a zoom across cards: one reset goes back to the past hour", async () => {
    await renderInsights();

    await dragAcrossMetrics(CAPACITY_METRICS);
    await dragAcrossMetrics(
      DATA_HEALTH_METRICS,
      INNER_ZOOM_START,
      INNER_ZOOM_END,
    );
    await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);
    expectEveryInsightsChartOn([
      INNER_ZOOM_START.toISOString(),
      INNER_ZOOM_END.toISOString(),
    ]);

    await doubleClickTestId(`metric-view ${LATENCY_METRICS}`);

    expectEveryInsightsChartOnThePastHour();
  });

  test("a card's Refresh keeps the zoom for every card", async () => {
    await renderInsights();

    await dragAcrossMetrics(CAPACITY_METRICS);
    fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[2]!);
    await flush();

    for (const name of INSIGHTS_METRIC_VIEWS) {
      expect([name, ...metricViewWindow(name)]).toEqual([name, ...ZOOM_WINDOW]);
    }
    expect(resetButtons()).toHaveLength(4);
  });

  test("picking a range in one card ends the zoom in all of them", async () => {
    await renderInsights();

    await dragAcrossMetrics(CAPACITY_METRICS);
    fireEvent.click(screen.getAllByTestId("card-picker")[1]!);
    await flush();

    expect(pickers()).toEqual([
      TimeRange.PAST_ONE_DAY,
      TimeRange.PAST_ONE_DAY,
      TimeRange.PAST_ONE_DAY,
      TimeRange.PAST_ONE_DAY,
    ]);
    expect(resetButtons()).toHaveLength(0);
    for (const name of INSIGHTS_METRIC_VIEWS) {
      expect([name, metricViewMinutes(name)]).toEqual([name, 24 * 60]);
    }
  });
});

// ------------------------------------------------ Pool and OSD detail tabs

const POOL_METRICS: string = "pool_stored+pool_max_avail+pool_objects";
const OSD_METRICS: string =
  "osd_apply_latency+osd_commit_latency+osd_stat_bytes_used+osd_numpg";

async function openMetricsTab(): Promise<void> {
  fireEvent.click(await screen.findByTestId("tab-Metrics"));
  await flush();
}

describe("Ceph pool detail, Metrics tab: the card's zoom covers the pool's rate charts", () => {
  async function renderPool(): Promise<void> {
    mockLastParam = "1";
    render(<CephClusterPoolDetail {...PAGE_PROPS} />);
    await flush();
    await openMetricsTab();
    await waitFor(() => {
      expect(
        screen.getByTestId(`metric-view ${POOL_METRICS}`),
      ).toBeInTheDocument();
    });
    await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);
  }

  test("the metric charts and the pool's rate charts share the card's zoom", async () => {
    await renderPool();

    const select: unknown = metricView(POOL_METRICS).onTimeRangeSelect;
    expect(select).toBeInstanceOf(Function);
    expect(getStandInChart(IOPS_CHART).zoom.onTimeRangeSelect).toBe(select);
    expect(getStandInChart(THROUGHPUT_CHART).zoom.onTimeRangeSelect).toBe(
      select,
    );
  });

  test("a drag on a pool rate chart narrows the metric charts and both rate charts", async () => {
    await renderPool();

    await dragAcrossChart(THROUGHPUT_CHART);
    await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);

    expect(metricViewWindow(POOL_METRICS)).toEqual(ZOOM_WINDOW);
    for (const metricName of RATE_METRICS) {
      const calls: Array<CapturedAggregate> = rateCalls(metricName);
      const last: CapturedAggregate = calls[calls.length - 1]!;
      expect([
        metricName,
        last.start.toISOString(),
        last.end.toISOString(),
      ]).toEqual([metricName, ...ZOOM_WINDOW]);
      // Still this pool's counters only.
      expect(last.attributes["pool_id"]).toBe("1");
    }
    expect(pickers()).toEqual([TimeRange.CUSTOM]);
    expect(resetButtons()).toHaveLength(1);
  });

  test("a double-click on the metric chart puts the tab's range back", async () => {
    await renderPool();

    await dragAcrossChart(IOPS_CHART);
    await doubleClickTestId(`metric-view ${POOL_METRICS}`);
    await waitForCharts([IOPS_CHART, THROUGHPUT_CHART]);

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(POOL_METRICS)).toBe(60);
    expect(resetButtons()).toHaveLength(0);
  });

  test("Reset zoom beside the tab's picker puts the range back", async () => {
    await renderPool();

    await dragAcrossMetrics(POOL_METRICS);
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();

    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(metricViewMinutes(POOL_METRICS)).toBe(60);
  });
});

describe("Ceph OSD detail, Metrics tab", () => {
  async function renderOsd(): Promise<void> {
    mockLastParam = "osd.1";
    render(<CephClusterOsdDetail {...PAGE_PROPS} />);
    await flush();
    await openMetricsTab();
    await waitFor(() => {
      expect(
        screen.getByTestId(`metric-view ${OSD_METRICS}`),
      ).toBeInTheDocument();
    });
  }

  test("a drag narrows the tab's charts, and a double-click puts the range back", async () => {
    await renderOsd();
    expect(metricView(OSD_METRICS).onTimeRangeReset).toBeUndefined();

    await dragAcrossMetrics(OSD_METRICS);

    expect(metricViewWindow(OSD_METRICS)).toEqual(ZOOM_WINDOW);
    expect(pickers()).toEqual([TimeRange.CUSTOM]);
    expect(resetButtons()).toHaveLength(1);
    expect(metricView(OSD_METRICS).onTimeRangeReset).toBeInstanceOf(Function);

    await doubleClickTestId(`metric-view ${OSD_METRICS}`);

    expect(metricViewMinutes(OSD_METRICS)).toBe(60);
    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
    expect(resetButtons()).toHaveLength(0);
  });

  test("Reset zoom beside the tab's picker does the same", async () => {
    await renderOsd();

    await dragAcrossMetrics(OSD_METRICS);
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));
    await flush();

    expect(metricViewMinutes(OSD_METRICS)).toBe(60);
    expect(pickers()).toEqual([TimeRange.PAST_ONE_HOUR]);
  });
});

// ------------------------------------------------------- CephRateChart

describe("CephRateChart on its own", () => {
  const WINDOW_START: Date = new Date("2026-09-28T11:00:00.000Z");

  function fakeZoom(
    isZoomed: boolean,
    resetZoom: MockFunction,
    zoomToTimeRange: MockFunction,
  ): TimeRangeZoom {
    return {
      isZoomed: isZoomed,
      rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_HOUR } : null,
      zoomToTimeRange: zoomToTimeRange as unknown as (
        startTime: Date,
        endTime: Date,
      ) => void,
      resetZoom: resetZoom as unknown as () => void,
    };
  }

  function rateChart(): React.ReactElement {
    return (
      <CephRateChart
        clusterName="ceph-prod"
        series={[
          { metricName: "ceph_pool_rd", label: "Read" },
          { metricName: "ceph_pool_wr", label: "Write" },
        ]}
        seriesKeyAttributes={["pool_id"]}
        startDate={WINDOW_START}
        endDate={NOW}
        emptyMessage="Nothing in this window."
      />
    );
  }

  test("hands its line chart no handlers of its own, so the chart takes the zoom around it", async () => {
    const zoomToTimeRange: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider
        zoom={fakeZoom(false, getJestMockFunction(), zoomToTimeRange)}
      >
        {rateChart()}
      </TimeRangeZoomProvider>,
    );
    await flush();
    await waitForCharts([IOPS_CHART]);

    const record: StandInChartRecord = getStandInChart(IOPS_CHART);
    expect(record.props.onTimeRangeSelect).toBeUndefined();
    expect(record.props.onTimeRangeReset).toBeUndefined();
    expect(record.props.disableTimeRangeZoom).toBeUndefined();

    standInDrag.start = ZOOM_START;
    standInDrag.end = ZOOM_END;
    fireEvent.click(
      screen.getByRole("button", { name: `Drag across ${IOPS_CHART}` }),
    );
    expect(zoomToTimeRange).toHaveBeenCalledWith(ZOOM_START, ZOOM_END);
  });

  test("its window comes from its props, and it is fetched over exactly that window", async () => {
    render(rateChart());
    await flush();
    await waitForCharts([IOPS_CHART]);

    expect(chartWindow(IOPS_CHART)).toEqual([
      WINDOW_START.toISOString(),
      NOW.toISOString(),
    ]);
    expect(rateWindow("ceph_pool_rd")).toEqual([
      WINDOW_START.toISOString(),
      NOW.toISOString(),
    ]);
  });

  test("its empty state resets a zoom that found no data on double-click", async () => {
    analyticsAggregateMock.mockResolvedValue({ data: [] });
    const resetZoom: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider
        zoom={fakeZoom(true, resetZoom, getJestMockFunction())}
      >
        {rateChart()}
      </TimeRangeZoomProvider>,
    );
    await flush();

    fireEvent.doubleClick(await screen.findByText("Nothing in this window."));

    expect(resetZoom).toHaveBeenCalledTimes(1);
  });

  test("its empty state ignores a double-click when there is no zoom to undo", async () => {
    analyticsAggregateMock.mockResolvedValue({ data: [] });
    const resetZoom: MockFunction = getJestMockFunction();
    render(
      <TimeRangeZoomProvider
        zoom={fakeZoom(false, resetZoom, getJestMockFunction())}
      >
        {rateChart()}
      </TimeRangeZoomProvider>,
    );
    await flush();

    fireEvent.doubleClick(await screen.findByText("Nothing in this window."));

    expect(resetZoom).not.toHaveBeenCalled();
  });

  test("outside any zoom it draws with no drag at all", async () => {
    render(rateChart());
    await flush();
    await waitForCharts([IOPS_CHART]);

    expect(getStandInChart(IOPS_CHART).zoom.onTimeRangeSelect).toBeUndefined();
    expect(
      within(screen.getByTestId(`chart ${IOPS_CHART}`)).getByRole("button"),
    ).toBeInTheDocument();
    expect(standInCharts.size).toBe(1);
  });
});
