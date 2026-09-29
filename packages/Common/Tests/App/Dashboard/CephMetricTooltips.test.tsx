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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The (i) tooltips on the Ceph cluster pages: the overview, the OSD and
 * pool lists and detail pages, the daemons table, the Insights rate charts
 * and the Clusters list.
 *
 * Each page is rendered for real, with only the network, the charts and
 * the heavy shared cards replaced, and every metric title is checked for an
 * (i) whose tooltip is the matching CEPH_METRIC_DESCRIPTIONS entry - and
 * pure metadata (names, hosts, versions, "Last Seen") is checked for having
 * none. Where a description makes a claim about the data ("the last 10
 * minutes", "counted twice", "left out when older than 15 minutes",
 * "ignores the chart time range"), the page is fed data that tells the
 * difference and the claim is checked against what it shows.
 */

const CLUSTER_ID: string = "0193c0de-6666-4aaa-8bbb-000000000006";
const NOW: Date = new Date("2026-09-24T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;
// Where one sentence ends and the next begins.
const SENTENCE_BREAK: RegExp = /(?<=[.!?])\s+(?=[A-Z])/;

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsAggregateMock: MockFunction = getJestMockFunction();
const rateChartMock: MockFunction = getJestMockFunction();
const modelTableMock: MockFunction = getJestMockFunction();

let mockLastParam: string = "osd.1";

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

/*
 * The Golden Signals and Insights cards draw ChartGroup charts (which carry
 * their own visible descriptions); only the rate-chart headers inside them
 * are this suite's business, so the card renders its title and children and
 * offers a way to change the range.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        title?: React.ReactNode;
        children?: React.ReactNode;
        onTimeRangeChange?: (range: unknown) => void;
      }) => {
        return (
          <section data-testid="embedded-metric-card">
            <div>{props.title}</div>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeChange?.({ range: "Past 1 Day" });
              }}
            >
              Pick past day
            </button>
            {props.children}
          </section>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephRateChart",
  () => {
    return {
      __esModule: true,
      default: (props: { series: Array<{ metricName: string }> }) => {
        rateChartMock(props);
        return (
          <div data-testid="ceph-rate-chart">
            {props.series
              .map((s: { metricName: string }) => {
                return s.metricName;
              })
              .join(",")}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: (props: {
        renderExtraCharts?: (range: {
          startValue: Date;
          endValue: Date;
        }) => React.ReactNode;
      }) => {
        return (
          <div data-testid="resource-metrics-tab">
            {props.renderExtraCharts
              ? props.renderExtraCharts({
                  startValue: new Date("2026-09-24T11:00:00.000Z"),
                  endValue: new Date("2026-09-24T12:00:00.000Z"),
                })
              : null}
          </div>
        );
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="card-model-detail" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="auto-refresh-control" />;
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

/*
 * The Clusters list is a ModelTable. It is replaced by a recorder, so the
 * columns the page hands it - titles, header tooltips and cell renderers -
 * can be read and run without a server.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: null,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { archiveBulkActions: [] };
    },
  };
});

import CephClusterOverview, {
  CephMetricTitle,
  OsdMatrix,
  OsdStateCell,
  OsdStateCellView,
  buildOsdStateCells,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index";
import CephClusterOsds from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Osds";
import CephClusterOsdDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/OsdDetail";
import CephClusterPools from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Pools";
import CephClusterPoolDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/PoolDetail";
import CephClusterDaemons from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Daemons";
import CephClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Insights";
import CephClusters from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Clusters";
import {
  CEPH_METRIC_DESCRIPTIONS,
  CephMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/CephMetricDescriptions";
import { METRIC_STALE_MS } from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephResourceUtils";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- fixtures

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

const CLUSTER: Record<string, unknown> = {
  _id: CLUSTER_ID,
  name: "ceph-prod",
  description: "",
  fsid: "3b0c1f7e-aaaa-bbbb-cccc-000000000001",
  otelCollectorStatus: "connected",
  lastSeenAt: minutesAgo(1),
  cephVersion: "18.2.4",
  agentVersion: "1.2.3",
  // HEALTH_WARN, so the Active Health Checks card is shown.
  healthStatus: 1,
  monCount: 3,
  osdCount: 4,
  osdUpCount: 3,
  osdInCount: 3,
  poolCount: 3,
  capacityUsedPercent: 12.34,
};

type Row = Record<string, unknown>;

const OSD_ROWS: Array<Row> = [
  {
    kind: "Osd",
    externalId: "osd.0",
    hostname: "node-a",
    deviceClass: "ssd",
    isUp: true,
    isIn: true,
    statBytes: 1000 * GIB,
    statBytesUsed: 250 * GIB,
    pgCount: 97,
    applyLatencyMs: 4,
    commitLatencyMs: 5,
    metricsUpdatedAt: minutesAgo(1),
    createdAt: minutesAgo(60 * 24 * 3),
  },
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
    daemonVersion: "18.2.4",
    lastSeenAt: minutesAgo(1),
    metricsUpdatedAt: minutesAgo(1),
    createdAt: minutesAgo(60 * 24 * 3),
  },
  {
    kind: "Osd",
    externalId: "osd.2",
    hostname: "node-c",
    deviceClass: "hdd",
    isUp: true,
    isIn: false,
    statBytes: 2000 * GIB,
    statBytesUsed: 10 * GIB,
    pgCount: 0,
    metricsUpdatedAt: minutesAgo(1),
    createdAt: minutesAgo(60 * 24 * 3),
  },
  {
    // Down + In, and its figures are 20 minutes old.
    kind: "Osd",
    externalId: "osd.3",
    hostname: "node-d",
    deviceClass: "hdd",
    isUp: false,
    isIn: true,
    statBytes: 2000 * GIB,
    statBytesUsed: 1900 * GIB,
    pgCount: 88,
    applyLatencyMs: 900,
    commitLatencyMs: 950,
    metricsUpdatedAt: minutesAgo(20),
    createdAt: minutesAgo(60 * 24 * 3),
  },
];

const POOL_ROWS: Array<Row> = [
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
  {
    kind: "Pool",
    externalId: "2",
    name: "cephfs_data",
    storedBytes: 100 * GIB,
    maxAvailBytes: 100 * GIB,
    objects: 25600,
    metricsUpdatedAt: minutesAgo(1),
    lastSeenAt: minutesAgo(1),
    createdAt: minutesAgo(60 * 24 * 3),
  },
  {
    // The biggest and fullest pool - but its figures are 20 minutes old.
    kind: "Pool",
    externalId: "3",
    name: "stale-archive",
    storedBytes: 5000 * GIB,
    maxAvailBytes: GIB,
    objects: 999999,
    metricsUpdatedAt: minutesAgo(20),
    lastSeenAt: minutesAgo(20),
    createdAt: minutesAgo(60 * 24 * 3),
  },
];

const MON_ROWS: Array<Row> = [
  {
    kind: "Mon",
    externalId: "mon.a",
    hostname: "node-a",
    daemonVersion: "18.2.4",
    inQuorum: true,
    lastSeenAt: minutesAgo(1),
  },
  {
    kind: "Mon",
    externalId: "mon.b",
    hostname: "node-b",
    daemonVersion: "18.2.4",
    inQuorum: true,
    lastSeenAt: minutesAgo(1),
  },
  {
    // Last seen 20 minutes ago: Stale, whatever its quorum flag says.
    kind: "Mon",
    externalId: "mon.c",
    hostname: "node-c",
    daemonVersion: "18.2.4",
    inQuorum: true,
    lastSeenAt: minutesAgo(20),
  },
];

const MGR_ROWS: Array<Row> = [
  {
    kind: "Mgr",
    externalId: "mgr.x",
    hostname: "node-a",
    daemonVersion: "18.2.4",
    lastSeenAt: minutesAgo(2),
  },
];

const ROWS_BY_KIND: Record<string, Array<Row>> = {
  Osd: OSD_ROWS,
  Pool: POOL_ROWS,
  Mon: MON_ROWS,
  Mgr: MGR_ROWS,
  Mds: [],
  Rgw: [],
};

function perPool(values: Record<string, number>): Array<Row> {
  return Object.entries(values).map(([poolId, value]: [string, number]) => {
    return {
      time: minutesAgo(1),
      value: value,
      attributes: { pool_id: poolId },
    };
  });
}

/*
 * PG counts per pool. Pool 1 has five groups that are BOTH degraded and
 * undersized - the overview adds the two states, so they count twice.
 */
const PG_SERIES: Record<string, Array<Row>> = {
  ceph_pg_total: perPool({ "1": 128, "2": 64 }),
  ceph_pg_active: perPool({ "1": 128, "2": 60 }),
  ceph_pg_clean: perPool({ "1": 120, "2": 60 }),
  ceph_pg_degraded: perPool({ "1": 5, "2": 1 }),
  ceph_pg_undersized: perPool({ "1": 5 }),
};

const HEALTH_DETAIL: Array<Row> = [
  {
    time: minutesAgo(1),
    value: 1,
    attributes: { name: "OSD_DOWN", severity: "HEALTH_WARN" },
  },
  {
    time: minutesAgo(1),
    value: 0,
    attributes: { name: "MON_DOWN", severity: "HEALTH_WARN" },
  },
];

interface CapturedQuery {
  name: string;
  start: Date;
  end: Date;
}

function listQuery(args: unknown): CapturedQuery {
  const query: {
    name: string;
    time: { startValue: Date; endValue: Date };
  } = (args as { query: CapturedQuery & { time: never } }).query as never;
  return {
    name: query.name,
    start: query.time.startValue,
    end: query.time.endValue,
  };
}

function aggregateQuery(args: unknown): CapturedQuery {
  const aggregateBy: {
    query: { name: string };
    startTimestamp: Date;
    endTimestamp: Date;
  } = (args as { aggregateBy: never }).aggregateBy;
  return {
    name: aggregateBy.query.name,
    start: aggregateBy.startTimestamp,
    end: aggregateBy.endTimestamp,
  };
}

function counterSeries(
  poolId: string,
  startValue: number,
  perSecond: number,
): Array<Row> {
  return [0, 1, 2].map((i: number) => {
    return {
      timestamp: minutesAgo(10 - i * 5),
      value: startValue + perSecond * i * 5 * 60,
      attributes: { pool_id: poolId },
    };
  });
}

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

  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    const name: string = listQuery(args).name;
    if (name === "ceph_health_detail") {
      return { data: HEALTH_DETAIL, count: HEALTH_DETAIL.length };
    }
    if (name === "ceph_cluster_total_bytes") {
      return {
        data: [{ time: minutesAgo(1), value: 1000 * GIB, attributes: {} }],
        count: 1,
      };
    }
    const rows: Array<Row> = PG_SERIES[name] || [];
    return { data: rows, count: rows.length };
  });

  analyticsAggregateMock.mockImplementation(async (args: unknown) => {
    const name: string = aggregateQuery(args).name;
    if (name === "ceph_cluster_total_used_bytes") {
      return {
        data: [
          { timestamp: minutesAgo(120), value: 100 * GIB },
          { timestamp: minutesAgo(60), value: 200 * GIB },
          { timestamp: minutesAgo(0), value: 300 * GIB },
        ],
      };
    }
    if (name === "ceph_pool_rd") {
      return { data: counterSeries("1", 1000, 10) };
    }
    if (name === "ceph_pool_wr") {
      return { data: counterSeries("1", 5000, 2.5) };
    }
    if (name === "ceph_pool_stored") {
      return {
        data: [
          { timestamp: minutesAgo(180), value: 100 * GIB },
          { timestamp: minutesAgo(120), value: 200 * GIB },
          { timestamp: minutesAgo(60), value: 250 * GIB },
          { timestamp: minutesAgo(0), value: 300 * GIB },
        ],
      };
    }
    if (name === "ceph_pool_max_avail") {
      return { data: [{ timestamp: minutesAgo(0), value: 700 * GIB }] };
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

function infoButton(title: string): HTMLElement {
  const found: Array<HTMLElement> = screen.getAllByRole("button", {
    name: `About ${title}`,
  });
  expect(found).toHaveLength(1);
  return found[0]!;
}

function allInfoButtons(): Array<HTMLElement> {
  return screen.queryAllByRole("button", { name: /^About / });
}

async function tooltipTextOf(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();

  const text: string =
    document.getElementById(describedBy as string)?.textContent || "";

  fireEvent.mouseLeave(button);

  return text;
}

async function expectExplained(title: string, key: CephMetric): Promise<void> {
  expect(await tooltipTextOf(infoButton(title))).toBe(
    CEPH_METRIC_DESCRIPTIONS[key],
  );
}

function expectNoInfo(title: string): void {
  expect(
    screen.queryByRole("button", { name: `About ${title}` }),
  ).not.toBeInTheDocument();
}

/*
 * The (i) is a button: it must never sit inside another button or a link,
 * where it would be invalid HTML and would navigate on click.
 */
function expectNoNestedInfoButtons(): void {
  for (const button of allInfoButtons()) {
    expect(button.parentElement?.closest("a, button")).toBeNull();
  }
}

function tileByTitle(title: string): HTMLElement {
  return infoButton(title).closest("div.rounded-xl") as HTMLElement;
}

function queriesFor(mock: MockFunction, name: string): Array<CapturedQuery> {
  const read: (args: unknown) => CapturedQuery =
    mock === analyticsAggregateMock ? aggregateQuery : listQuery;
  return mock.mock.calls
    .map((call: Array<unknown>) => {
      return read(call[0]);
    })
    .filter((q: CapturedQuery) => {
      return q.name === name;
    });
}

function windowMinutes(q: CapturedQuery): number {
  return Math.round(
    (new Date(q.end).getTime() - new Date(q.start).getTime()) / MINUTE,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockLastParam = "osd.1";
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    analyticsGetListMock,
    analyticsAggregateMock,
    rateChartMock,
    modelTableMock,
  ]) {
    mock.mockReset();
  }
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ------------------------------------------------------------------- texts

const OVERVIEW_TITLES: Array<[string, CephMetric]> = [
  ["Cluster inventory counts", "inventoryCounts"],
  ["Cluster health", "health"],
  ["Active Health Checks", "activeHealthChecks"],
  ["Capacity Used", "capacityUsed"],
  ["OSDs Up", "osdsUp"],
  ["Mons In Quorum", "monsInQuorum"],
  ["Pools", "pools"],
  ["Problem PGs", "problemPgs"],
  ["OSD States", "osdStates"],
  ["Up + In", "osdUpIn"],
  ["Up + Out", "osdUpOut"],
  ["Down + In", "osdDownIn"],
  ["Down + Out", "osdDownOut"],
  ["Placement Group States", "pgStates"],
  ["Client IOPS", "clientIops"],
  ["Client Throughput", "clientThroughput"],
  ["Largest Pools", "largestPools"],
  ["Fullest Pools", "fullestPools"],
];

const OSD_LIST_TITLES: Array<[string, CephMetric]> = [
  ["Status", "osdStatusColumn"],
  ["In / Out", "osdInOutColumn"],
  ["Used / Total", "osdUsedColumn"],
  ["PGs", "osdPgsColumn"],
  ["Apply / Commit Latency", "osdLatencyColumn"],
  ["Age", "osdAgeColumn"],
];

const OSD_DETAIL_TITLES: Array<[string, CephMetric]> = [
  ["Status", "osdStatus"],
  ["Placement", "osdPlacement"],
  ["Used / Total", "osdUsed"],
  ["Placement Groups", "osdPlacementGroups"],
  ["Apply / Commit Latency", "osdLatency"],
];

const POOL_LIST_TITLES: Array<[string, CephMetric]> = [
  ["Stored", "poolStoredColumn"],
  ["Max Avail", "poolMaxAvailColumn"],
  ["Used", "poolUsedColumn"],
  ["Objects", "poolObjectsColumn"],
  ["Read IOPS", "poolReadIopsColumn"],
  ["Write IOPS", "poolWriteIopsColumn"],
];

const POOL_DETAIL_TITLES: Array<[string, CephMetric]> = [
  ["Stored", "poolStored"],
  ["Max Available", "poolMaxAvail"],
  ["Used", "poolUsed"],
  ["Growth", "poolGrowth"],
  ["Objects", "poolObjects"],
];

const CLUSTER_LIST_TITLES: Array<[string, CephMetric]> = [
  ["Health", "health"],
  ["OSDs", "clusterOsds"],
  ["Mons", "clusterMons"],
  ["Pools", "pools"],
  ["Capacity", "clusterCapacity"],
];

describe("CEPH_METRIC_DESCRIPTIONS", () => {
  test("every text is a short, finished, plain sentence and none repeats another", () => {
    expectReadableDescriptionRecord(
      CEPH_METRIC_DESCRIPTIONS,
      "CEPH_METRIC_DESCRIPTIONS",
    );
  });

  test("every title on every Ceph page is explained by its own text", () => {
    for (const [title, key] of [
      ...OVERVIEW_TITLES,
      ...OSD_LIST_TITLES,
      ...OSD_DETAIL_TITLES,
      ...POOL_LIST_TITLES,
      ...POOL_DETAIL_TITLES,
      ...CLUSTER_LIST_TITLES,
    ]) {
      expectTitleExplained(title, CEPH_METRIC_DESCRIPTIONS[key]);
    }
  });

  test("every key is used by exactly the pages listed here", () => {
    const used: Set<CephMetric> = new Set<CephMetric>(
      [
        ...OVERVIEW_TITLES,
        ...OSD_LIST_TITLES,
        ...OSD_DETAIL_TITLES,
        ...POOL_LIST_TITLES,
        ...POOL_DETAIL_TITLES,
        ...CLUSTER_LIST_TITLES,
        ["Status", "daemonStatus"],
        ["Client IOPS", "poolClientIops"],
        ["Client Throughput", "poolClientThroughput"],
      ].map(([, key]: Array<string>) => {
        return key as CephMetric;
      }),
    );

    expect([...used].sort()).toEqual(
      Object.keys(CEPH_METRIC_DESCRIPTIONS).sort(),
    );
  });

  /*
   * Ceph jargon has to be spelled out where it is first met, not assumed.
   */
  test.each([
    ["osdsUp", /daemons that store your data/],
    ["clusterOsds", /daemons that store data/],
    ["monsInQuorum", /majority \(a quorum\)/],
    ["problemPgs", /chunks Ceph splits each pool into/],
    ["osdPgsColumn", /chunks Ceph splits pools into/],
    ["osdPlacementGroups", /chunks Ceph splits pools into/],
    ["problemPgs", /degraded \(missing copies\)/],
    ["problemPgs", /undersized \(on fewer OSDs than the pool's copy count\)/],
    ["osdStates", /up means its daemon is running/],
    ["osdStates", /in means Ceph places data on it/],
    ["osdStates", /a daemon that stores data, usually one per disk/],
    ["pgStates", /chunks Ceph splits each pool into/],
    ["clientIops", /operations per second \(IOPS\)/],
    ["poolClientIops", /operations per second \(IOPS\)/],
    ["poolReadIopsColumn", /read operations per second \(IOPS\)/],
    ["poolWriteIopsColumn", /write operations per second \(IOPS\)/],
    ["poolObjectsColumn", /not a count of your files/],
    ["capacityUsed", /nearfull/],
  ] as Array<[CephMetric, RegExp]>)(
    "%s explains its jargon (%s)",
    (key: CephMetric, pattern: RegExp) => {
      expect(CEPH_METRIC_DESCRIPTIONS[key]).toMatch(pattern);
    },
  );

  test("pool STORED is described as the data before replication, never after", () => {
    for (const key of [
      "largestPools",
      "poolStoredColumn",
      "poolStored",
    ] as Array<CephMetric>) {
      expect(CEPH_METRIC_DESCRIPTIONS[key]).toMatch(/before replication/);
    }
    for (const text of Object.values(CEPH_METRIC_DESCRIPTIONS)) {
      expect(text).not.toMatch(/after replication/i);
    }
  });

  test("raw capacity is described as counting every copy", () => {
    for (const key of [
      "capacityUsed",
      "clusterCapacity",
    ] as Array<CephMetric>) {
      expect(CEPH_METRIC_DESCRIPTIONS[key]).toMatch(
        /raw disk space in use, counting every copy/,
      );
    }
  });

  test("the staleness cut-off the texts name is the one the pages use", () => {
    expect(METRIC_STALE_MS).toBe(15 * MINUTE);
    for (const key of [
      "largestPools",
      "osdUsedColumn",
      "osdUsed",
      "poolStoredColumn",
      "poolStored",
      "daemonStatus",
      // The OSD figures blank to a dash on the same cut-off.
      "osdPgsColumn",
      "osdLatencyColumn",
      "osdPlacementGroups",
      "osdLatency",
    ] as Array<CephMetric>) {
      expect(CEPH_METRIC_DESCRIPTIONS[key]).toMatch(/15 minutes/);
    }
  });

  /*
   * A tooltip is a glance, not a paragraph: one or two sentences each.
   */
  test("every text is one or two sentences", () => {
    const tooLong: Array<string> = Object.entries(CEPH_METRIC_DESCRIPTIONS)
      .filter(([, text]: [string, string]) => {
        return text.split(SENTENCE_BREAK).length > 2;
      })
      .map(([key]: [string, string]) => {
        return key;
      });

    expect(tooLong).toEqual([]);
  });

  /*
   * The health pill reads "Health OK / Warning / Error / Unknown" on the
   * overview and "OK / WARN / ERR / Unknown" on the Clusters list; the one
   * text behind both has to name every state either page can show.
   */
  test("the health text names every state the pills can show", () => {
    for (const state of [
      /\bOK\b/,
      /\bWarning\b/,
      /\bWARN\b/,
      /\bError\b/,
      /\bERR\b/,
      /\bUnknown\b/,
    ]) {
      expect(CEPH_METRIC_DESCRIPTIONS.health).toMatch(state);
    }
  });

  test("the placement-group bar is described as approximate, since states overlap", () => {
    expect(CEPH_METRIC_DESCRIPTIONS.pgStates).toMatch(
      /several states at once, so the segments are approximate/,
    );
    expect(CEPH_METRIC_DESCRIPTIONS.pgStates).toMatch(/Other is the rest/);
  });

  test("Active Health Checks are the checks still raised in the latest data, not every check seen", () => {
    expect(CEPH_METRIC_DESCRIPTIONS.activeHealthChecks).toMatch(
      /still raised in the latest data/,
    );
  });
});

// ------------------------------------------------ small exported helpers

describe("CephMetricTitle", () => {
  test("renders the title and an (i) that shows the description", async () => {
    render(
      <h2>
        <CephMetricTitle
          title="OSD States"
          description={CEPH_METRIC_DESCRIPTIONS.osdStates}
        />
      </h2>,
    );

    expect(screen.getByRole("heading")).toHaveTextContent("OSD States");
    await expectExplained("OSD States", "osdStates");
  });

  test("renders no (i) when there is nothing to explain", () => {
    render(<CephMetricTitle title="OSD States" description="" />);

    expect(screen.getByText("OSD States")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("OSD state cells", () => {
  const MATRIX: OsdMatrix = {
    upIn: 7,
    upOut: 2,
    downIn: 1,
    downOut: 3,
    total: 13,
  };

  test("build the four up/in quadrants in order, each with its own text", () => {
    const cells: Array<OsdStateCell> = buildOsdStateCells(MATRIX);

    expect(
      cells.map((cell: OsdStateCell) => {
        return [cell.label, cell.count, cell.description];
      }),
    ).toEqual([
      ["Up + In", 7, CEPH_METRIC_DESCRIPTIONS.osdUpIn],
      ["Up + Out", 2, CEPH_METRIC_DESCRIPTIONS.osdUpOut],
      ["Down + In", 1, CEPH_METRIC_DESCRIPTIONS.osdDownIn],
      ["Down + Out", 3, CEPH_METRIC_DESCRIPTIONS.osdDownOut],
    ]);
  });

  test.each(buildOsdStateCells(MATRIX))(
    "$label renders its count, label, sublabel and (i)",
    async (cell: OsdStateCell) => {
      render(<OsdStateCellView cell={cell} />);

      expect(screen.getByText(String(cell.count))).toBeInTheDocument();
      expect(screen.getByText(cell.label)).toBeInTheDocument();
      expect(screen.getByText(cell.sublabel)).toBeInTheDocument();
      expect(await tooltipTextOf(infoButton(cell.label))).toBe(
        cell.description,
      );
    },
  );
});

// ---------------------------------------------------------------- overview

async function renderOverview(): Promise<void> {
  render(<CephClusterOverview {...PAGE_PROPS} />);
  await screen.findByText("ceph-prod");
  await flush();
}

describe("Ceph cluster overview", () => {
  test("every metric on the page has an (i), and there are no others", async () => {
    await renderOverview();

    expect(
      allInfoButtons()
        .map((b: HTMLElement) => {
          return b.getAttribute("aria-label");
        })
        .sort(),
    ).toEqual(
      OVERVIEW_TITLES.map(([title]: [string, CephMetric]) => {
        return `About ${title}`;
      }).sort(),
    );
  });

  test.each(OVERVIEW_TITLES)(
    "%s shows its CEPH_METRIC_DESCRIPTIONS text",
    async (title: string, key: CephMetric) => {
      await renderOverview();
      await expectExplained(title, key);
    },
  );

  test("no (i) sits inside a link or another button", async () => {
    await renderOverview();
    expectNoNestedInfoButtons();
  });

  test("the five golden tiles carry their (i) beside the title", async () => {
    await renderOverview();

    for (const title of [
      "Capacity Used",
      "OSDs Up",
      "Mons In Quorum",
      "Pools",
      "Problem PGs",
    ]) {
      const tile: HTMLElement = tileByTitle(title);
      expect(within(tile).getByText(title)).toHaveClass("uppercase");
    }
  });

  test("Problem PGs adds degraded and undersized, so a group in both states counts twice", async () => {
    await renderOverview();

    // 6 degraded + 5 undersized, and pool 1's five are the same groups.
    const tile: HTMLElement = tileByTitle("Problem PGs");
    expect(within(tile).getByText("11")).toBeInTheDocument();
    expect(
      within(tile).getByText("6 degraded, 5 undersized"),
    ).toBeInTheDocument();
    expect(CEPH_METRIC_DESCRIPTIONS.problemPgs).toMatch(/counted twice/);
  });

  test("the PG counts and health checks read the last 10 minutes", async () => {
    await renderOverview();

    for (const name of [
      "ceph_health_detail",
      "ceph_pg_total",
      "ceph_pg_clean",
      "ceph_pg_degraded",
      "ceph_pg_undersized",
    ]) {
      const queries: Array<CapturedQuery> = queriesFor(
        analyticsGetListMock,
        name,
      );
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(windowMinutes(q)).toBe(10);
      }
    }
    expect(CEPH_METRIC_DESCRIPTIONS.problemPgs).toMatch(/last 10 minutes/);
    expect(CEPH_METRIC_DESCRIPTIONS.pgStates).toMatch(/last 10 minutes/);
    expect(CEPH_METRIC_DESCRIPTIONS.activeHealthChecks).toMatch(
      /last 10 minutes/,
    );
  });

  test("only checks that are raised show under Active Health Checks", async () => {
    await renderOverview();

    expect(screen.getByText("OSD_DOWN")).toBeInTheDocument();
    expect(screen.queryByText("MON_DOWN")).not.toBeInTheDocument();
  });

  test("Capacity Used is the latest reading and projects the last 24 hours to 85%", async () => {
    await renderOverview();

    const tile: HTMLElement = tileByTitle("Capacity Used");
    // Latest 300 GiB of 1000 GiB - not the 200 GiB average of the day.
    expect(within(tile).getByText("30.0%")).toBeInTheDocument();
    expect(
      within(tile).getByText(
        "300 GiB of 1000 GiB — 85% in ~1d at current growth",
      ),
    ).toBeInTheDocument();

    const used: Array<CapturedQuery> = queriesFor(
      analyticsAggregateMock,
      "ceph_cluster_total_used_bytes",
    );
    expect(used).toHaveLength(1);
    expect(windowMinutes(used[0]!)).toBe(24 * 60);
    expect(CEPH_METRIC_DESCRIPTIONS.capacityUsed).toMatch(/24 hours/);
    expect(CEPH_METRIC_DESCRIPTIONS.capacityUsed).toMatch(/85%/);
  });

  test("Capacity Used ignores the chart time range, while the rate charts follow it", async () => {
    await renderOverview();

    const capacityQueriesBefore: number = queriesFor(
      analyticsAggregateMock,
      "ceph_cluster_total_used_bytes",
    ).length;
    const rateCallsBefore: number = rateChartMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Pick past day" }));
    await flush();

    expect(
      queriesFor(analyticsAggregateMock, "ceph_cluster_total_used_bytes"),
    ).toHaveLength(capacityQueriesBefore);

    const lastRateProps: { startDate: Date; endDate: Date } = rateChartMock.mock
      .calls[rateChartMock.mock.calls.length - 1]![0] as {
      startDate: Date;
      endDate: Date;
    };
    expect(rateChartMock.mock.calls.length).toBeGreaterThan(rateCallsBefore);
    expect(
      (lastRateProps.endDate.getTime() - lastRateProps.startDate.getTime()) /
        MINUTE,
    ).toBe(24 * 60);
    expect(CEPH_METRIC_DESCRIPTIONS.capacityUsed).toMatch(
      /rather than the chart time range/,
    );
    expect(CEPH_METRIC_DESCRIPTIONS.clientIops).toMatch(/selected time range/);
  });

  test("the rate charts under Client IOPS and Client Throughput are the summed pool counters", async () => {
    await renderOverview();

    const charts: Array<HTMLElement> = screen.getAllByTestId("ceph-rate-chart");
    expect(
      charts.map((c: HTMLElement) => {
        return c.textContent;
      }),
    ).toEqual([
      "ceph_pool_rd,ceph_pool_wr",
      "ceph_pool_rd_bytes,ceph_pool_wr_bytes",
    ]);
    expect(infoButton("Client IOPS").closest("div")?.nextElementSibling).toBe(
      charts[0],
    );
    expect(
      infoButton("Client Throughput").closest("div")?.nextElementSibling,
    ).toBe(charts[1]);
    expect(CEPH_METRIC_DESCRIPTIONS.clientIops).toMatch(/across all pools/);
    expect(CEPH_METRIC_DESCRIPTIONS.clientThroughput).toMatch(
      /across all pools/,
    );
  });

  test("Largest and Fullest Pools leave out a pool whose figures are over 15 minutes old", async () => {
    await renderOverview();

    const rowsOf: (title: string) => Array<string> = (
      title: string,
    ): Array<string> => {
      const card: HTMLElement = infoButton(title).closest(
        "[data-testid='card']",
      ) as HTMLElement;
      return Array.from(card.querySelectorAll("div.py-3")).map(
        (row: Element): string => {
          return (row.textContent || "").trim();
        },
      );
    };

    // The 5000 GiB, 99.98%-full pool stopped reporting 20 minutes ago.
    expect(rowsOf("Largest Pools")).toEqual([
      "rbd300 GiB",
      "cephfs_data100 GiB",
    ]);
    expect(rowsOf("Fullest Pools")).toEqual(["cephfs_data50.0%", "rbd30.0%"]);
    expect(screen.queryByText("stale-archive")).not.toBeInTheDocument();
  });

  test("the OSD States cells count each up/in quadrant from the inventory", async () => {
    await renderOverview();

    for (const [label, count] of [
      ["Up + In", "2"],
      ["Up + Out", "1"],
      ["Down + In", "1"],
      ["Down + Out", "0"],
    ]) {
      const cell: HTMLElement = infoButton(label as string).closest(
        "div.rounded-lg",
      ) as HTMLElement;
      expect(within(cell).getByText(count as string)).toBeInTheDocument();
    }
  });

  test("Mons In Quorum counts monitors in quorum out of all known monitors", async () => {
    await renderOverview();

    expect(
      within(tileByTitle("Mons In Quorum")).getByText("3/3"),
    ).toBeInTheDocument();
    expect(within(tileByTitle("OSDs Up")).getByText("3/4")).toBeInTheDocument();
    expect(
      within(tileByTitle("OSDs Up")).getByText("3 in"),
    ).toBeInTheDocument();
  });

  test("a healthy cluster hides Active Health Checks and its (i) with it", async () => {
    modelGetItemMock.mockImplementation(async () => {
      return { ...CLUSTER, healthStatus: 0 };
    });
    await renderOverview();

    expectNoInfo("Active Health Checks");
    expect(infoButton("Cluster health")).toBeInTheDocument();
  });

  test("the quick links and the details card carry no (i) - they are navigation and metadata", async () => {
    await renderOverview();

    expectNoInfo("Quick Links");
    expectNoInfo("OSDs");
    expectNoInfo("Daemons");
    expectNoInfo("Metrics");
    expectNoInfo("Ceph Cluster Details");
  });
});

/*
 * The OSD / monitor / pool count chips beside the cluster name. Their text
 * says they come from the cluster's latest data rather than a time range,
 * that quorum is monitors in quorum out of all known monitors, and that
 * only the monitor count shows when quorum is not reported.
 */
describe("Ceph cluster overview: the count chips", () => {
  function chipRow(): HTMLElement {
    return infoButton("Cluster inventory counts").parentElement as HTMLElement;
  }

  function withInventory(overrides: Record<string, Array<Row>>): void {
    modelGetListMock.mockImplementation(async (args: unknown) => {
      const kind: string = String(
        (args as { query: Record<string, unknown> }).query["kind"],
      );
      const rows: Array<Row> = overrides[kind] ?? ROWS_BY_KIND[kind] ?? [];
      return { data: rows, count: rows.length, skip: 0, limit: 100 };
    });
  }

  test("the OSD, monitor and pool chips share one (i), and the version chip sits beside them", async () => {
    await renderOverview();

    expect(within(chipRow()).getByText("3/4 OSDs up")).toBeInTheDocument();
    expect(
      within(chipRow()).getByText("3/3 mons in quorum"),
    ).toBeInTheDocument();
    expect(within(chipRow()).getByText("3 pools")).toBeInTheDocument();
    expect(within(chipRow()).getByText("18.2.4")).toBeInTheDocument();
    expect(within(chipRow()).getAllByRole("button")).toHaveLength(1);
    await expectExplained("Cluster inventory counts", "inventoryCounts");
  });

  test("OSDs come from the cluster's latest snapshot and quorum from each monitor's latest state", async () => {
    modelGetItemMock.mockImplementation(async () => {
      return { ...CLUSTER, osdCount: 5, osdUpCount: 2 };
    });
    withInventory({
      Mon: MON_ROWS.map((row: Row): Row => {
        return row["externalId"] === "mon.b"
          ? { ...row, inQuorum: false }
          : row;
      }),
    });
    await renderOverview();

    expect(within(chipRow()).getByText("2/5 OSDs up")).toBeInTheDocument();
    expect(
      within(chipRow()).getByText("2/3 mons in quorum"),
    ).toBeInTheDocument();
    expect(CEPH_METRIC_DESCRIPTIONS.inventoryCounts).toMatch(
      /monitors in quorum out of all known monitors/,
    );
  });

  test("without monitor rows, the chip shows only the monitor count, as the text says", async () => {
    withInventory({ Mon: [] });
    await renderOverview();

    expect(within(chipRow()).getByText("3 mons")).toBeInTheDocument();
    expect(screen.queryByText(/mons in quorum$/)).not.toBeInTheDocument();
    expect(CEPH_METRIC_DESCRIPTIONS.inventoryCounts).toMatch(
      /only the monitor count when quorum is not reported/,
    );
  });

  test("the chips ignore the chart time range", async () => {
    await renderOverview();

    const clusterReads: number = modelGetItemMock.mock.calls.length;
    const inventoryReads: number = modelGetListMock.mock.calls.length;

    fireEvent.click(
      screen.getAllByRole("button", { name: "Pick past day" })[0]!,
    );
    await flush();

    expect(modelGetItemMock.mock.calls.length).toBe(clusterReads);
    expect(modelGetListMock.mock.calls.length).toBe(inventoryReads);
    expect(within(chipRow()).getByText("3/4 OSDs up")).toBeInTheDocument();
    expect(CEPH_METRIC_DESCRIPTIONS.inventoryCounts).toMatch(
      /latest data, not a time range/,
    );
  });

  test("a cluster that has reported only its version gets no (i) on the chip row", async () => {
    modelGetItemMock.mockImplementation(async () => {
      return {
        ...CLUSTER,
        osdCount: 0,
        osdUpCount: 0,
        monCount: 0,
        poolCount: 0,
      };
    });
    withInventory({ Mon: [] });
    await renderOverview();

    expect(screen.getByText("18.2.4")).toBeInTheDocument();
    expectNoInfo("Cluster inventory counts");
  });
});

// ------------------------------------------------------------------- lists

async function renderAndSettle(element: React.ReactElement): Promise<void> {
  render(element);
  await flush();
}

describe("OSD list", () => {
  test("each metric column header has an (i) with its text", async () => {
    await renderAndSettle(<CephClusterOsds {...PAGE_PROPS} />);
    await screen.findByText("osd.0");

    for (const [title, key] of OSD_LIST_TITLES) {
      await expectExplained(title, key);
    }
    expectNoNestedInfoButtons();
  });

  test("identity columns carry no (i)", async () => {
    await renderAndSettle(<CephClusterOsds {...PAGE_PROPS} />);
    await screen.findByText("osd.0");

    for (const title of ["Name", "Host", "Class"]) {
      expectNoInfo(title);
    }
    expect(allInfoButtons()).toHaveLength(OSD_LIST_TITLES.length);
  });

  /*
   * Ceph reports no creation time for an OSD, so Age is how long OneUptime
   * has had the OSD's inventory row - which is what its text says.
   */
  test("Age counts from when OneUptime first recorded the OSD, not from anything Ceph reports", async () => {
    const rows: Array<Row> = OSD_ROWS.map((row: Row): Row => {
      // osd.2 was first recorded 10 minutes ago; the rest 3 days ago.
      return row["externalId"] === "osd.2"
        ? { ...row, createdAt: minutesAgo(10) }
        : row;
    });
    modelGetListMock.mockImplementation(async () => {
      return { data: rows, count: rows.length, skip: 0, limit: 100 };
    });

    await renderAndSettle(<CephClusterOsds {...PAGE_PROPS} />);
    await screen.findByText("osd.0");

    const ageHeader: HTMLElement = infoButton("Age").closest(
      "th",
    ) as HTMLElement;
    const ageIndex: number = Array.from(
      ageHeader.parentElement!.children,
    ).indexOf(ageHeader);
    expect(ageIndex).toBeGreaterThan(0);

    const cellUnderAge: (name: string) => string = (name: string): string => {
      const row: HTMLElement = screen
        .getByText(name)
        .closest("tr") as HTMLElement;
      return (row.children[ageIndex]?.textContent || "").trim();
    };

    expect(cellUnderAge("osd.0")).toBe("3d");
    expect(cellUnderAge("osd.2")).toBe("10m");
    // Its 20-minute-old figures do not touch Age: that is the row's age.
    expect(cellUnderAge("osd.3")).toBe("3d");
    expect(CEPH_METRIC_DESCRIPTIONS.osdAgeColumn).toMatch(
      /first saw this OSD in the data the Ceph agent sends, not how old the OSD or its disk is/,
    );
  });

  test("an OSD that has not reported in 15 minutes shows a dash, as the text says", async () => {
    await renderAndSettle(<CephClusterOsds {...PAGE_PROPS} />);
    const row: HTMLElement = (await screen.findByText("osd.3")).closest(
      "tr",
    ) as HTMLElement;

    // Used / Total, PGs and latency all fall back to a dash.
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(within(row).getByText("Down")).toBeInTheDocument();
    expect(within(row).getByText("In")).toBeInTheDocument();

    const fresh: HTMLElement = screen
      .getByText("osd.1")
      .closest("tr") as HTMLElement;
    expect(
      within(fresh).getByText("500 GiB / 2.0 TiB (25.0%)"),
    ).toBeInTheDocument();
    expect(within(fresh).getByText("12 / 13 ms")).toBeInTheDocument();
  });
});

describe("Pool list", () => {
  test("each metric column header has an (i) with its text", async () => {
    await renderAndSettle(<CephClusterPools {...PAGE_PROPS} />);
    await screen.findByText("rbd");

    for (const [title, key] of POOL_LIST_TITLES) {
      await expectExplained(title, key);
    }
    expectNoInfo("Name");
    expect(allInfoButtons()).toHaveLength(POOL_LIST_TITLES.length);
    expectNoNestedInfoButtons();
  });

  test("Read and Write IOPS always average the last 15 minutes", async () => {
    await renderAndSettle(<CephClusterPools {...PAGE_PROPS} />);
    const row: HTMLElement = (await screen.findByText("rbd")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getByText("10.0/s")).toBeInTheDocument();
    expect(within(row).getByText("2.5/s")).toBeInTheDocument();

    for (const name of ["ceph_pool_rd", "ceph_pool_wr"]) {
      const queries: Array<CapturedQuery> = queriesFor(
        analyticsAggregateMock,
        name,
      );
      expect(queries).toHaveLength(1);
      expect(windowMinutes(queries[0]!)).toBe(15);
    }
    expect(CEPH_METRIC_DESCRIPTIONS.poolReadIopsColumn).toMatch(
      /last 15 minutes/,
    );
    expect(CEPH_METRIC_DESCRIPTIONS.poolWriteIopsColumn).toMatch(
      /last 15 minutes/,
    );
  });

  test("Used is Stored over Stored plus Max Avail", async () => {
    await renderAndSettle(<CephClusterPools {...PAGE_PROPS} />);
    const row: HTMLElement = (await screen.findByText("rbd")).closest(
      "tr",
    ) as HTMLElement;

    // 300 / (300 + 700)
    expect(within(row).getByText("30.0%")).toBeInTheDocument();
    expect(CEPH_METRIC_DESCRIPTIONS.poolUsedColumn).toMatch(
      /Stored divided by Stored plus Max Avail/,
    );
  });
});

describe("Daemons table", () => {
  test("the Status header explains quorum, Reporting and Stale", async () => {
    await renderAndSettle(<CephClusterDaemons {...PAGE_PROPS} />);
    await screen.findByText("mon.a");

    await expectExplained("Status", "daemonStatus");
    expect(allInfoButtons()).toHaveLength(1);
    for (const title of ["Daemon", "Kind", "Host", "Version"]) {
      expectNoInfo(title);
    }
  });

  test("statuses follow the rules the text gives", async () => {
    await renderAndSettle(<CephClusterDaemons {...PAGE_PROPS} />);

    const row: (name: string) => HTMLElement = (name: string) => {
      return screen.getByText(name).closest("tr") as HTMLElement;
    };
    await screen.findByText("mon.a");

    expect(within(row("mon.a")).getByText("In Quorum")).toBeInTheDocument();
    // In quorum when last seen, but silent for 20 minutes now.
    expect(within(row("mon.c")).getByText("Stale")).toBeInTheDocument();
    expect(within(row("mgr.x")).getByText("Reporting")).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------- details

describe("OSD detail", () => {
  test("each metric summary field has an (i) with its text; identity fields have none", async () => {
    mockLastParam = "osd.1";
    await renderAndSettle(<CephClusterOsdDetail {...PAGE_PROPS} />);
    await screen.findByText("node-b");

    for (const [title, key] of OSD_DETAIL_TITLES) {
      await expectExplained(title, key);
    }
    for (const title of [
      "OSD",
      "Cluster",
      "Host",
      "Device Class",
      "Version",
      "Last Seen",
    ]) {
      expectNoInfo(title);
    }
    expect(allInfoButtons()).toHaveLength(OSD_DETAIL_TITLES.length);
  });

  test("a stale OSD keeps its Up/In state but blanks the figures", async () => {
    mockLastParam = "osd.3";
    await renderAndSettle(<CephClusterOsdDetail {...PAGE_PROPS} />);
    await screen.findByText("node-d");

    expect(screen.getByText("Down")).toBeInTheDocument();
    expect(screen.getByText("In")).toBeInTheDocument();
    // Used / Total and Apply / Commit Latency.
    expect(screen.getAllByText("— / —")).toHaveLength(2);
  });
});

describe("Pool detail", () => {
  test("each metric summary field has an (i) with its text; identity fields have none", async () => {
    mockLastParam = "1";
    await renderAndSettle(<CephClusterPoolDetail {...PAGE_PROPS} />);
    await screen.findByText("Growth");
    await flush();

    for (const [title, key] of POOL_DETAIL_TITLES) {
      await expectExplained(title, key);
    }
    for (const title of ["Pool", "Pool ID", "Cluster", "Last Seen"]) {
      expectNoInfo(title);
    }
  });

  test("Growth projects the 24-hour stored trend to Stored plus Max Available", async () => {
    mockLastParam = "1";
    await renderAndSettle(<CephClusterPoolDetail {...PAGE_PROPS} />);
    await screen.findByText("Growth");
    await flush();

    expect(
      screen.getByText(/^Full in ~\d+d at current growth$/),
    ).toBeInTheDocument();
    const stored: Array<CapturedQuery> = queriesFor(
      analyticsAggregateMock,
      "ceph_pool_stored",
    );
    expect(stored).toHaveLength(1);
    expect(windowMinutes(stored[0]!)).toBe(24 * 60);
  });

  test("the Metrics tab's rate charts carry the pool's own IOPS and throughput texts", async () => {
    mockLastParam = "1";
    await renderAndSettle(<CephClusterPoolDetail {...PAGE_PROPS} />);
    await screen.findByText("Growth");

    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await flush();

    await expectExplained("Client IOPS", "poolClientIops");
    await expectExplained("Client Throughput", "poolClientThroughput");
    expectNoNestedInfoButtons();
  });
});

describe("Insights", () => {
  test("the Client I/O rate charts carry the cluster-wide IOPS and throughput texts", async () => {
    await renderAndSettle(<CephClusterInsights {...PAGE_PROPS} />);
    await screen.findByText("Client IOPS");

    await expectExplained("Client IOPS", "clientIops");
    await expectExplained("Client Throughput", "clientThroughput");
    expect(allInfoButtons()).toHaveLength(2);
  });
});

// ------------------------------------------------------------ clusters list

type CapturedColumn = {
  title: string;
  headerTooltip?: string | undefined;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
};

async function clusterColumns(): Promise<Array<CapturedColumn>> {
  await renderAndSettle(<CephClusters {...PAGE_PROPS} />);
  expect(modelTableMock).toHaveBeenCalled();
  const props: { columns: Array<CapturedColumn> } = modelTableMock.mock.calls[
    modelTableMock.mock.calls.length - 1
  ]![0] as { columns: Array<CapturedColumn> };
  return props.columns;
}

describe("Clusters list", () => {
  test("each metric column carries its header tooltip; the rest carry none", async () => {
    const columns: Array<CapturedColumn> = await clusterColumns();
    const tooltips: Record<string, string | undefined> = {};
    for (const column of columns) {
      tooltips[column.title] = column.headerTooltip;
    }

    for (const [title, key] of CLUSTER_LIST_TITLES) {
      expect({ title, tooltip: tooltips[title] }).toEqual({
        title,
        tooltip: CEPH_METRIC_DESCRIPTIONS[key],
      });
    }
    for (const title of [
      "Name",
      "Status",
      "Version",
      "Last Seen",
      "Labels",
      "Owners",
    ]) {
      expect({ title, tooltip: tooltips[title] }).toEqual({
        title,
        tooltip: undefined,
      });
    }
  });

  test("the Capacity bar colours match the thresholds its text names", async () => {
    const columns: Array<CapturedColumn> = await clusterColumns();
    const capacity: CapturedColumn = columns.find((c: CapturedColumn) => {
      return c.title === "Capacity";
    })!;

    const barFor: (pct: number) => string = (pct: number): string => {
      const { container, unmount } = render(
        capacity.getElement!({ capacityUsedPercent: pct }),
      );
      const bar: Element | null = container.querySelector(
        "div.h-2.rounded-full[style]",
      );
      const className: string = bar?.className || "";
      unmount();
      return className;
    };

    expect(barFor(74.9)).toContain("bg-emerald-500");
    expect(barFor(75)).toContain("bg-amber-500");
    expect(barFor(89.9)).toContain("bg-amber-500");
    expect(barFor(90)).toContain("bg-red-500");
    expect(CEPH_METRIC_DESCRIPTIONS.clusterCapacity).toMatch(
      /amber at 75% and red at 90%/,
    );
  });

  test("the OSDs cell turns amber when any OSD is down or out, as its text says", async () => {
    const columns: Array<CapturedColumn> = await clusterColumns();
    const osds: CapturedColumn = columns.find((c: CapturedColumn) => {
      return c.title === "OSDs";
    })!;

    const allGood: ReturnType<typeof render> = render(
      osds.getElement!({ osdCount: 4, osdUpCount: 4, osdInCount: 4 }),
    );
    expect(allGood.getByText("4 up / 4 in / 4 total")).not.toHaveClass(
      "text-amber-700",
    );
    allGood.unmount();

    const oneOut: ReturnType<typeof render> = render(
      osds.getElement!({ osdCount: 4, osdUpCount: 4, osdInCount: 3 }),
    );
    expect(oneOut.getByText("4 up / 3 in / 4 total")).toHaveClass(
      "text-amber-700",
    );
  });
});
