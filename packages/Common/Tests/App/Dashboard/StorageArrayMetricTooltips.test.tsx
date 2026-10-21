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
 * The (i) tooltips on the storage array pages: the overview, the Storage
 * Arrays list, the inventory tables (volumes, hosts, replication,
 * hardware, directories, file systems, buckets) and the detail pages.
 *
 * Each page is rendered for real, with only the network, the charts and
 * the heavy shared tables replaced, and every metric title is checked for
 * an (i) whose tooltip is the matching STORAGE_ARRAY_METRIC_DESCRIPTIONS
 * entry - and pure metadata (names, platform, versions, "Last Seen") is
 * checked for having none. Where a description makes a claim about the
 * data ("left out when older than 15 minutes", "the last 10 minutes",
 * "amber at 80% and red at 90%", "every 30 minutes"), the page is fed data
 * that tells the difference and the claim is checked against what it
 * shows.
 */

const ARRAY_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const NOW: Date = new Date("2026-10-05T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;
const TIB: number = 1024 * GIB;

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const modelTableMock: MockFunction = getJestMockFunction();

let mockLastParam: string = "";

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
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
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
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
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
 * The Golden Signals card draws MetricView charts, which carry their own
 * descriptions; this suite is about the (i)s around them, so the card
 * renders its title only.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title?: React.ReactNode }) => {
        return (
          <section data-testid="embedded-metric-card">
            <div>{props.title}</div>
          </section>
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
      default: () => {
        return <div data-testid="resource-metrics-tab" />;
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
 * The list and the inventory tables are ModelTables. It is replaced by a
 * recorder, so the columns each page hands it - titles, header tooltips and
 * cell renderers - can be read and run without a server.
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

import StorageArrayOverview, {
  StorageArrayMetricTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import StorageArrays from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/StorageArrays";
import StorageArrayVolumes from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Volumes";
import StorageArrayHosts from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Hosts";
import StorageArrayReplication from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Replication";
import StorageArrayHardware from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Hardware";
import StorageArrayDirectories from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Directories";
import StorageArrayFileSystems from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/FileSystems";
import StorageArrayBuckets from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Buckets";
import StorageArrayVolumeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/VolumeDetail";
import StorageArrayHostDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/HostDetail";
import StorageArrayFileSystemDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/FileSystemDetail";
import StorageArrayBucketDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/BucketDetail";
import {
  STORAGE_ARRAY_METRIC_DESCRIPTIONS,
  StorageArrayMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/StorageArrayMetricDescriptions";
import {
  StorageArrayHealthState,
  getStorageArrayHealthPillStyle,
  getStorageArrayHealthState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/StorageArrayHealthPill";
import {
  METRIC_STALE_MS,
  SLOW_SCRAPE_METRIC_STALE_MS,
  UNHEALTHY_RESOURCE_STATUSES,
  formatLatencyUsec,
  formatRatio,
  getMetricStaleMs,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";
import {
  STORAGE_ARRAY_FLASHARRAY_COLLECTOR_CONFIG,
  STORAGE_ARRAY_FLASHARRAY_EXPORTER_COLLECTOR_CONFIG,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- fixtures

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

type Row = Record<string, unknown>;

function arrayFixture(overrides: Row = {}): Row {
  return {
    _id: ARRAY_ID,
    name: "fa-prod-01",
    storageSystem: StorageSystem.PureStorageFlashArray,
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    osName: "Purity//FA",
    osVersion: "6.7.2",
    capacityBytes: 100 * TIB,
    usedBytes: 85 * TIB,
    capacityUsedPercent: 85,
    dataReductionRatio: 4.2,
    // Critical, with open alerts, so the Active Alerts card is shown.
    healthStatus: 2,
    openAlertCount: 3,
    criticalAlertCount: 1,
    warningAlertCount: 1,
    volumeCount: 4,
    hostCount: 2,
    podCount: 0,
    fileSystemCount: 2,
    bucketCount: 1,
    hardwareComponentCount: 30,
    unhealthyHardwareCount: 2,
    ...overrides,
  };
}

const FLASHBLADE_OVERRIDES: Row = {
  name: "fb-prod-01",
  storageSystem: StorageSystem.PureStorageFlashBlade,
  osName: "Purity//FB",
  osVersion: "4.5.6",
};

const VOLUME_ROWS: Array<Row> = [
  {
    kind: "Volume",
    externalId: "vol-quick",
    name: "vol-quick",
    readLatencyUsec: 200,
    writeLatencyUsec: 300,
    usedBytes: 2 * TIB,
    metricsUpdatedAt: minutesAgo(1),
  },
  {
    kind: "Volume",
    externalId: "vg1/vol-db",
    name: "vg1/vol-db",
    // Its writes are the slow part: ranked by the worse of the two.
    readLatencyUsec: 400,
    writeLatencyUsec: 5200,
    usedBytes: TIB,
    metricsUpdatedAt: minutesAgo(14),
  },
  {
    // The slowest and the largest - but 16 minutes old.
    kind: "Volume",
    externalId: "vol-gone",
    name: "vol-gone",
    readLatencyUsec: 90000,
    writeLatencyUsec: 90000,
    usedBytes: 50 * TIB,
    metricsUpdatedAt: minutesAgo(16),
  },
];

const FILE_SYSTEM_ROWS: Array<Row> = [
  {
    kind: "FileSystem",
    externalId: "home",
    name: "home",
    readLatencyUsec: 800,
    writeLatencyUsec: 1500,
    usedBytes: 3 * TIB,
    capacityBytes: 10 * TIB,
    metricsUpdatedAt: minutesAgo(2),
    details: { protocols: ["nfs"] },
  },
  {
    kind: "FileSystem",
    externalId: "scratch",
    name: "scratch",
    readLatencyUsec: 99000,
    writeLatencyUsec: 99000,
    usedBytes: 40 * TIB,
    metricsUpdatedAt: minutesAgo(30),
  },
];

/*
 * Server order (name ascending) puts the degraded fan first; the card puts
 * the failed drive first.
 */
const UNHEALTHY_PARTS: Array<Row> = [
  {
    kind: "Hardware",
    externalId: "CT0.FAN1",
    name: "CT0.FAN1",
    componentType: "cooling",
    status: "degraded",
  },
  {
    kind: "Drive",
    externalId: "SH9.BAY3",
    name: "SH9.BAY3",
    componentType: "SSD",
    status: "failed",
  },
];

const DETAIL_ROWS: Array<Row> = [
  {
    kind: "Volume",
    externalId: "vg1/vol-db",
    name: "vg1/vol-db",
    groupName: "vg1",
    capacityBytes: 4 * TIB,
    usedBytes: TIB,
    dataReductionRatio: 3.1,
    readLatencyUsec: 400,
    writeLatencyUsec: 900,
    readIops: 1200,
    writeIops: 800,
    readBytesPerSec: 100 * 1024 * 1024,
    writeBytesPerSec: 50 * 1024 * 1024,
    connectionCount: 2,
    metricsUpdatedAt: minutesAgo(1),
    lastSeenAt: minutesAgo(1),
    details: { naaId: "naa.624a9370" },
  },
  {
    kind: "Host",
    externalId: "esxi-01",
    name: "esxi-01",
    status: "healthy",
    statusDetail: "Redundant",
    groupName: "esxi-cluster",
    connectionCount: 3,
    capacityBytes: 8 * TIB,
    usedBytes: 2 * TIB,
    dataReductionRatio: 3.4,
    readLatencyUsec: 300,
    writeLatencyUsec: 500,
    readIops: 900,
    writeIops: 400,
    metricsUpdatedAt: minutesAgo(1),
    lastSeenAt: minutesAgo(1),
  },
  {
    kind: "FileSystem",
    externalId: "home",
    name: "home",
    capacityBytes: 10 * TIB,
    usedBytes: 3 * TIB,
    dataReductionRatio: 2.2,
    readLatencyUsec: 800,
    writeLatencyUsec: 1500,
    readIops: 300,
    writeIops: 200,
    metricsUpdatedAt: minutesAgo(1),
    lastSeenAt: minutesAgo(1),
    details: { protocols: ["nfs", "smb"] },
  },
  {
    kind: "Bucket",
    externalId: "backups",
    name: "backups",
    groupName: "backup-account",
    capacityBytes: 20 * TIB,
    usedBytes: 6 * TIB,
    objectCount: 120000,
    dataReductionRatio: 1.4,
    readLatencyUsec: 2000,
    writeLatencyUsec: 3000,
    readIops: 50,
    writeIops: 20,
    metricsUpdatedAt: minutesAgo(1),
    lastSeenAt: minutesAgo(1),
  },
];

interface AlertSeries {
  minutesAgo: number;
  severity: string;
  code: string;
  component: string;
  summary: string;
  created: string;
}

/*
 * Time-descending, as ClickHouse answers. One alert is hidden, and one
 * stopped being exported eight minutes ago - the array closed it.
 */
const ALERT_SERIES: Array<AlertSeries> = [
  {
    minutesAgo: 1,
    severity: "info",
    code: "12",
    component: "array",
    summary: "Phonehome disabled",
    created: "3",
  },
  {
    minutesAgo: 1,
    severity: "warning",
    code: "7",
    component: "CH0.FAN0",
    summary: "Fan running slow",
    created: "2",
  },
  {
    minutesAgo: 1,
    severity: "critical",
    code: "42",
    component: "CH0.BAY9",
    summary: "Drive failure",
    created: "1",
  },
  {
    minutesAgo: 1,
    severity: "hidden",
    code: "99",
    component: "array",
    summary: "Internal housekeeping",
    created: "4",
  },
  {
    minutesAgo: 8,
    severity: "warning",
    code: "8",
    component: "CT1",
    summary: "Controller failover finished",
    created: "5",
  },
];

let mockArray: Row = arrayFixture();

function sortedRows(
  rows: Array<Row>,
  sort: Record<string, unknown>,
): Array<Row> {
  const [column] = Object.keys(sort);
  if (!column) {
    return rows;
  }
  return [...rows].sort((a: Row, b: Row) => {
    return Number(b[column] ?? 0) - Number(a[column] ?? 0);
  });
}

function arrange(): void {
  modelGetItemMock.mockImplementation(async () => {
    return mockArray;
  });

  modelGetListMock.mockImplementation(async (args: unknown) => {
    const request: {
      query: Record<string, unknown>;
      sort?: Record<string, unknown>;
      limit?: number;
    } = args as never;
    const query: Record<string, unknown> = request.query;
    let rows: Array<Row> = [];

    if (query["status"]) {
      // The overview's Hardware Needing Attention query, by the kinds asked.
      const kinds: Array<string> = (query["kind"] as { values: Array<string> })
        .values;
      rows = UNHEALTHY_PARTS.filter((row: Row) => {
        return kinds.includes(String(row["kind"]));
      });
    } else if (typeof query["kind"] === "string" && query["externalId"]) {
      // A detail page looks one object up.
      rows = DETAIL_ROWS.filter((row: Row) => {
        return (
          row["kind"] === query["kind"] &&
          row["externalId"] === query["externalId"]
        );
      });
    } else if (query["kind"] === "Volume") {
      rows = sortedRows(VOLUME_ROWS, request.sort || {});
    } else if (query["kind"] === "FileSystem") {
      rows = sortedRows(FILE_SYSTEM_ROWS, request.sort || {});
    }

    const limited: Array<Row> = rows.slice(0, request.limit || 100);
    return { data: limited, count: limited.length, skip: 0, limit: 100 };
  });

  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    const name: string = (args as { query: { name: string } }).query.name;
    if (name !== "purefa_alerts_open") {
      return { data: [], count: 0 };
    }
    const data: Array<Row> = ALERT_SERIES.map((alert: AlertSeries) => {
      return {
        time: minutesAgo(alert.minutesAgo),
        value: 1,
        attributes: {
          severity: alert.severity,
          code: alert.code,
          component_name: alert.component,
          summary: alert.summary,
          created: alert.created,
          "resource.storage.array.name": "fa-prod-01",
        },
      };
    });
    return { data: data, count: data.length };
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

function infoLabels(): Array<string> {
  return allInfoButtons()
    .map((button: HTMLElement): string => {
      return (button.getAttribute("aria-label") || "").replace(/^About /, "");
    })
    .sort();
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

async function expectExplained(
  title: string,
  key: StorageArrayMetric,
): Promise<void> {
  expect(await tooltipTextOf(infoButton(title))).toBe(
    STORAGE_ARRAY_METRIC_DESCRIPTIONS[key],
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

// Texts in document order that match one of `texts` exactly.
function inOrder(texts: Array<string>): Array<string> {
  return screen
    .queryAllByText((_: string, element: Element | null): boolean => {
      return (
        Boolean(element) &&
        texts.includes(element!.textContent || "") &&
        // The innermost element only.
        Array.from(element!.children).every((child: Element) => {
          return !texts.includes(child.textContent || "");
        })
      );
    })
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

interface RecordedColumn {
  title: string;
  headerTooltip?: string | undefined;
  getElement?: ((item: Row) => React.ReactElement) | undefined;
}

interface RecordedTable {
  id: string;
  columns: Array<RecordedColumn>;
}

// The latest props of each table the page rendered, by its id.
function recordedTables(): Map<string, RecordedTable> {
  const tables: Map<string, RecordedTable> = new Map();
  for (const call of modelTableMock.mock.calls) {
    const props: RecordedTable = call[0] as RecordedTable;
    tables.set(props.id, props);
  }
  return tables;
}

function recordedTable(id: string): RecordedTable {
  const table: RecordedTable | undefined = recordedTables().get(id);
  if (!table) {
    throw new Error(
      `Table "${id}" was not rendered. Rendered: ${Array.from(
        recordedTables().keys(),
      ).join(", ")}`,
    );
  }
  return table;
}

type ColumnPairs = Array<[string, StorageArrayMetric | null]>;

// Each column's title and the description key its header tooltip shows.
function columnPairs(table: RecordedTable): ColumnPairs {
  return table.columns.map(
    (column: RecordedColumn): [string, StorageArrayMetric | null] => {
      if (!column.headerTooltip) {
        return [column.title, null];
      }
      const key: string | undefined = Object.keys(
        STORAGE_ARRAY_METRIC_DESCRIPTIONS,
      ).find((candidate: string) => {
        return (
          STORAGE_ARRAY_METRIC_DESCRIPTIONS[candidate as StorageArrayMetric] ===
          column.headerTooltip
        );
      });
      if (!key) {
        throw new Error(
          `Column "${column.title}" has a tooltip that is not in STORAGE_ARRAY_METRIC_DESCRIPTIONS.`,
        );
      }
      return [column.title, key as StorageArrayMetric];
    },
  );
}

function columnByTitle(table: RecordedTable, title: string): RecordedColumn {
  const found: Array<RecordedColumn> = table.columns.filter(
    (column: RecordedColumn) => {
      return column.title === title;
    },
  );
  expect(found).toHaveLength(1);
  return found[0]!;
}

function cellText(column: RecordedColumn, item: Row): string {
  const { container } = render(<div>{column.getElement!(item)}</div>);
  const text: string = container.textContent || "";
  cleanup();
  return text;
}

function cellHtml(column: RecordedColumn, item: Row): string {
  const { container } = render(<div>{column.getElement!(item)}</div>);
  const html: string = container.innerHTML;
  cleanup();
  return html;
}

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<void> {
  render(<Page {...PAGE_PROPS} />);
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockLastParam = "";
  mockArray = arrayFixture();
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    analyticsGetListMock,
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

const OVERVIEW_FLASHARRAY_TITLES: Array<[string, StorageArrayMetric]> = [
  ["Storage array health", "health"],
  ["Storage array inventory counts", "inventoryCounts"],
  ["Active Alerts", "activeAlerts"],
  ["Capacity Used", "capacityUsed"],
  ["Data Reduction", "dataReduction"],
  ["Open Alerts", "openAlerts"],
  ["Unhealthy Hardware", "unhealthyHardware"],
  ["Volumes", "volumesTile"],
  ["Hardware Needing Attention", "unhealthyHardwareList"],
  ["Slowest Volumes", "slowestVolumes"],
  ["Largest Volumes", "largestVolumes"],
];

const OVERVIEW_FLASHBLADE_TITLES: Array<[string, StorageArrayMetric]> = [
  ["Storage array health", "health"],
  ["Storage array inventory counts", "inventoryCounts"],
  ["Active Alerts", "activeAlerts"],
  ["Capacity Used", "capacityUsed"],
  ["Data Reduction", "dataReduction"],
  ["Open Alerts", "openAlerts"],
  ["Unhealthy Hardware", "unhealthyHardware"],
  ["File Systems", "fileSystemsTile"],
  ["Hardware Needing Attention", "unhealthyHardwareList"],
  ["Slowest File Systems", "slowestFileSystems"],
  ["Largest File Systems", "largestFileSystems"],
];

const LIST_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Platform", null],
  ["Health", "health"],
  ["Status", null],
  ["Capacity", "arrayCapacity"],
  ["Data Reduction", "arrayDataReduction"],
  ["Inventory", "arrayInventory"],
  ["Open Alerts", "arrayOpenAlerts"],
  ["Version", null],
  ["Last Seen", null],
  ["Labels", null],
  ["Owners", null],
];

const PERFORMANCE_COLUMNS: ColumnPairs = [
  ["Read Latency", "readLatencyColumn"],
  ["Write Latency", "writeLatencyColumn"],
  ["Read IOPS", "readIopsColumn"],
  ["Write IOPS", "writeIopsColumn"],
  ["Read Bandwidth", "readBandwidthColumn"],
  ["Write Bandwidth", "writeBandwidthColumn"],
];

const VOLUMES_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Pod / Group", "volumeGroupColumn"],
  ["Provisioned", "provisionedColumn"],
  ["Physical", "physicalColumn"],
  ["Data Reduction", "dataReductionColumn"],
  ...PERFORMANCE_COLUMNS,
  ["Hosts", "volumeHostsColumn"],
  ["Last Seen", null],
];

const HOSTS_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Connectivity", "hostConnectivityColumn"],
  ["Host Group", "hostGroupColumn"],
  ["Volumes", "hostVolumesColumn"],
  ["Provisioned", "hostProvisionedColumn"],
  ["Physical", "physicalColumn"],
  ["Data Reduction", "dataReductionColumn"],
  ...PERFORMANCE_COLUMNS,
  ["Last Seen", null],
];

const REPLICATION_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Link Status", "podLinkStatusColumn"],
  ["Replication Lag", "podLagColumn"],
  ["Average Lag", "podAverageLagColumn"],
  ["Remote", "podRemoteColumn"],
  ["Direction", null],
  ["Mediator", "podMediatorColumn"],
  ["Physical", "physicalColumn"],
  ["Read Latency", "readLatencyColumn"],
  ["Write Latency", "writeLatencyColumn"],
  ["Last Seen", null],
];

const HARDWARE_COMPONENTS_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Type", null],
  ["Status", "hardwareStatusColumn"],
  ["Temperature", "hardwareTemperatureColumn"],
  ["Last Seen", null],
];

const DRIVES_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Type", null],
  ["Status", "driveStatusColumn"],
  ["Capacity", "driveCapacityColumn"],
  ["Protocol", null],
  ["Last Seen", null],
];

const CONTROLLERS_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Mode", "controllerModeColumn"],
  ["Status", "controllerStatusColumn"],
  ["Model", null],
  ["Version", null],
  ["Type", null],
  ["Last Seen", null],
];

const NETWORK_INTERFACES_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Type", null],
  ["Status", "interfaceStatusColumn"],
  ["Speed", "interfaceSpeedColumn"],
  ["Received / Transmitted", "interfaceTrafficColumn"],
  ["Errors", "interfaceErrorsColumn"],
  ["Services", null],
  ["Last Seen", null],
];

const FLASHBLADE_HARDWARE_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Type", null],
  ["Health", "flashBladeHardwareStatusColumn"],
  ["Slot", null],
  ["Last Seen", null],
];

const DIRECTORIES_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Physical", "directorySpaceColumn"],
  ["Data Reduction", "dataReductionColumn"],
  ...PERFORMANCE_COLUMNS,
  ["Last Seen", null],
];

const FILE_SYSTEMS_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Protocols", "fileSystemProtocolsColumn"],
  ["Provisioned", "fileSystemProvisionedColumn"],
  ["Physical", "physicalColumn"],
  ["Data Reduction", "dataReductionColumn"],
  ...PERFORMANCE_COLUMNS,
  ["Last Seen", null],
];

const BUCKETS_COLUMNS: ColumnPairs = [
  ["Name", null],
  ["Account", "bucketAccountColumn"],
  ["Quota", "bucketQuotaColumn"],
  ["Used", "bucketUsedColumn"],
  ["Objects", "bucketObjectsColumn"],
  ["Data Reduction", "dataReductionColumn"],
  ...PERFORMANCE_COLUMNS,
  ["Last Seen", null],
];

const VOLUME_DETAIL_FIELDS: Array<[string, StorageArrayMetric]> = [
  ["Pod / Group", "volumeGroupColumn"],
  ["Provisioned", "provisionedColumn"],
  ["Physical", "physicalColumn"],
  ["Data Reduction", "dataReductionColumn"],
  ["Read Latency", "readLatencyColumn"],
  ["Write Latency", "writeLatencyColumn"],
  ["Read IOPS", "readIopsColumn"],
  ["Write IOPS", "writeIopsColumn"],
  ["Read Bandwidth", "readBandwidthColumn"],
  ["Write Bandwidth", "writeBandwidthColumn"],
  ["Connected Hosts", "volumeHostsColumn"],
];

const HOST_DETAIL_FIELDS: Array<[string, StorageArrayMetric]> = [
  ["Connectivity", "hostConnectivityColumn"],
  ["Host Group", "hostGroupColumn"],
  ["Connected Volumes", "hostVolumesColumn"],
  ["Provisioned", "hostProvisionedColumn"],
  ["Physical", "physicalColumn"],
  ["Data Reduction", "dataReductionColumn"],
  ["Read Latency", "readLatencyColumn"],
  ["Write Latency", "writeLatencyColumn"],
  ["Read IOPS", "readIopsColumn"],
  ["Write IOPS", "writeIopsColumn"],
];

const FILE_SYSTEM_DETAIL_FIELDS: Array<[string, StorageArrayMetric]> = [
  ["Protocols", "fileSystemProtocolsColumn"],
  ["Provisioned", "fileSystemProvisionedColumn"],
  ["Physical", "physicalColumn"],
  ["Data Reduction", "dataReductionColumn"],
  ["Read Latency", "readLatencyColumn"],
  ["Write Latency", "writeLatencyColumn"],
  ["Read IOPS", "readIopsColumn"],
  ["Write IOPS", "writeIopsColumn"],
];

const BUCKET_DETAIL_FIELDS: Array<[string, StorageArrayMetric]> = [
  ["Account", "bucketAccountColumn"],
  ["Quota", "bucketQuotaColumn"],
  ["Used", "bucketUsedColumn"],
  ["Objects", "bucketObjectsColumn"],
  ["Data Reduction", "dataReductionColumn"],
  ["Read Latency", "readLatencyColumn"],
  ["Write Latency", "writeLatencyColumn"],
  ["Read IOPS", "readIopsColumn"],
  ["Write IOPS", "writeIopsColumn"],
];

function keysOf(
  pairs: Array<[string, StorageArrayMetric | null]>,
): Array<StorageArrayMetric> {
  return pairs
    .map(([, key]: [string, StorageArrayMetric | null]) => {
      return key;
    })
    .filter((key: StorageArrayMetric | null): key is StorageArrayMetric => {
      return key !== null;
    });
}

describe("STORAGE_ARRAY_METRIC_DESCRIPTIONS", () => {
  test("every text is a short, finished, plain sentence and none repeats another", () => {
    expectReadableDescriptionRecord(
      STORAGE_ARRAY_METRIC_DESCRIPTIONS,
      "STORAGE_ARRAY_METRIC_DESCRIPTIONS",
    );
  });

  test("every title on every storage array page is explained by its own text", () => {
    for (const [title, key] of [
      ...OVERVIEW_FLASHARRAY_TITLES,
      ...OVERVIEW_FLASHBLADE_TITLES,
      ...VOLUME_DETAIL_FIELDS,
      ...HOST_DETAIL_FIELDS,
      ...FILE_SYSTEM_DETAIL_FIELDS,
      ...BUCKET_DETAIL_FIELDS,
    ]) {
      expectTitleExplained(title, STORAGE_ARRAY_METRIC_DESCRIPTIONS[key]);
    }
  });

  test("every key is used by exactly the pages listed here", () => {
    const used: Set<StorageArrayMetric> = new Set<StorageArrayMetric>([
      ...keysOf(OVERVIEW_FLASHARRAY_TITLES),
      ...keysOf(OVERVIEW_FLASHBLADE_TITLES),
      ...keysOf(LIST_COLUMNS),
      ...keysOf(VOLUMES_COLUMNS),
      ...keysOf(HOSTS_COLUMNS),
      ...keysOf(REPLICATION_COLUMNS),
      ...keysOf(HARDWARE_COMPONENTS_COLUMNS),
      ...keysOf(DRIVES_COLUMNS),
      ...keysOf(CONTROLLERS_COLUMNS),
      ...keysOf(NETWORK_INTERFACES_COLUMNS),
      ...keysOf(FLASHBLADE_HARDWARE_COLUMNS),
      ...keysOf(DIRECTORIES_COLUMNS),
      ...keysOf(FILE_SYSTEMS_COLUMNS),
      ...keysOf(BUCKETS_COLUMNS),
      ...keysOf(VOLUME_DETAIL_FIELDS),
      ...keysOf(HOST_DETAIL_FIELDS),
      ...keysOf(FILE_SYSTEM_DETAIL_FIELDS),
      ...keysOf(BUCKET_DETAIL_FIELDS),
    ]);

    expect([...used].sort()).toEqual(
      Object.keys(STORAGE_ARRAY_METRIC_DESCRIPTIONS).sort(),
    );
  });

  test("the staleness cut-off the texts name is the one the pages use", () => {
    expect(METRIC_STALE_MS).toBe(15 * MINUTE);
    expect(getMetricStaleMs(StorageArrayResourceKind.Volume)).toBe(15 * MINUTE);
    expect(getMetricStaleMs(StorageArrayResourceKind.FileSystem)).toBe(
      15 * MINUTE,
    );
    for (const key of [
      "slowestVolumes",
      "slowestFileSystems",
    ] as Array<StorageArrayMetric>) {
      expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS[key]).toMatch(
        /not reported in the last 15 minutes/,
      );
    }
  });

  test("directories: the agent reads them every 30 minutes, and a dash takes 90", () => {
    expect(SLOW_SCRAPE_METRIC_STALE_MS).toBe(90 * MINUTE);
    expect(getMetricStaleMs(StorageArrayResourceKind.Directory)).toBe(
      90 * MINUTE,
    );
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.directorySpaceColumn).toMatch(
      /every 30 minutes/,
    );
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.directorySpaceColumn).toMatch(
      /90 minutes without data/,
    );

    /*
     * Both FlashArray collector configs (as the setup guide embeds them)
     * scrape the directories every 30 minutes - in the directories job
     * itself, not a neighbouring one.
     */
    for (const config of [
      STORAGE_ARRAY_FLASHARRAY_COLLECTOR_CONFIG,
      STORAGE_ARRAY_FLASHARRAY_EXPORTER_COLLECTOR_CONFIG,
    ]) {
      const start: number = config.indexOf("job_name: purefa-directories");
      expect(start).toBeGreaterThan(-1);
      const next: number = config.indexOf("job_name:", start + 1);
      const job: string = config.slice(start, next < 0 ? undefined : next);
      expect(job).toContain("scrape_interval: 30m");
    }
    // A dash only after three missed directory scrapes.
    expect(SLOW_SCRAPE_METRIC_STALE_MS).toBe(3 * 30 * MINUTE);
  });

  /*
   * StorageArray.healthStatus is 0 / 1 / 2, or null before the first full
   * batch; the one text behind the overview's pill and the list's has to
   * name every state either can show.
   */
  test("the health text names every state the pill can show", () => {
    const states: Array<[number | null, StorageArrayHealthState, string]> = [
      [0, StorageArrayHealthState.Ok, "OK"],
      [1, StorageArrayHealthState.Warning, "Warning"],
      [2, StorageArrayHealthState.Critical, "Critical"],
      [null, StorageArrayHealthState.Unknown, "Unknown"],
    ];

    for (const [healthStatus, state, expectedLabel] of states) {
      expect(getStorageArrayHealthState(healthStatus)).toBe(state);
      const label: string = getStorageArrayHealthPillStyle(healthStatus).label;
      expect(label).toBe(expectedLabel);
      expect([label, STORAGE_ARRAY_METRIC_DESCRIPTIONS.health]).toEqual([
        label,
        expect.stringMatching(new RegExp(`\\b${label}\\b`)),
      ]);
    }
  });

  test("the unhealthy hardware text names every status the pages count as unhealthy", () => {
    for (const status of UNHEALTHY_RESOURCE_STATUSES) {
      expect([
        status,
        STORAGE_ARRAY_METRIC_DESCRIPTIONS.unhealthyHardware,
      ]).toEqual([status, expect.stringContaining(status)]);
    }
  });

  test("the capacity texts name the thresholds the bars use", () => {
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.arrayCapacity).toMatch(
      /amber at 80% and red at 90%/,
    );
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.capacityUsed).toMatch(
      /80%, 90% and 100%/,
    );
  });

  test("the ratio examples are written the way the pages write a ratio", () => {
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.arrayDataReduction).toContain(
      `${formatRatio(4)} means four bytes written take one byte of flash`,
    );
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.dataReductionColumn).toContain(
      `${formatRatio(3)} means three bytes written take one byte of flash`,
    );
  });

  test("latency is described in microseconds below a millisecond, as it is shown", () => {
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.readLatencyColumn).toMatch(
      /microseconds \(µs\) below a millisecond/,
    );
    expect(formatLatencyUsec(250)).toBe("250 µs");
    expect(formatLatencyUsec(999)).toBe("999 µs");
    expect(formatLatencyUsec(1500)).toBe("1.50 ms");
  });

  test("the active alerts text names the 10-minute window the card reads", () => {
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.activeAlerts).toMatch(
      /in the last 10 minutes, critical first/,
    );
  });
});

// ------------------------------------------------ small exported helpers

describe("StorageArrayMetricTitle", () => {
  test("renders the title and an (i) that shows the description", async () => {
    render(
      <h2>
        <StorageArrayMetricTitle
          title="Slowest Volumes"
          description={STORAGE_ARRAY_METRIC_DESCRIPTIONS.slowestVolumes}
        />
      </h2>,
    );

    expect(screen.getByRole("heading")).toHaveTextContent("Slowest Volumes");
    await expectExplained("Slowest Volumes", "slowestVolumes");
  });

  test("renders no (i) when there is nothing to explain", () => {
    render(<StorageArrayMetricTitle title="Slowest Volumes" description="" />);

    expect(screen.getByText("Slowest Volumes")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- overview

async function renderOverview(name: string = "fa-prod-01"): Promise<void> {
  render(<StorageArrayOverview {...PAGE_PROPS} />);
  await screen.findAllByText(name);
  await flush();
}

describe("Storage array overview (FlashArray)", () => {
  test("every metric on the page has an (i), and there are no others", async () => {
    await renderOverview();

    expect(infoLabels()).toEqual(
      OVERVIEW_FLASHARRAY_TITLES.map(
        ([title]: [string, StorageArrayMetric]) => {
          return title;
        },
      ).sort(),
    );
  });

  test.each(OVERVIEW_FLASHARRAY_TITLES)(
    "%s shows its STORAGE_ARRAY_METRIC_DESCRIPTIONS text",
    async (title: string, key: StorageArrayMetric) => {
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
      "Data Reduction",
      "Open Alerts",
      "Unhealthy Hardware",
      "Volumes",
    ]) {
      const tile: HTMLElement = tileByTitle(title);
      expect(within(tile).getByText(title)).toHaveClass("uppercase");
    }
  });

  test("Capacity Used turns amber at 80% and red at 90%, as the text says", async () => {
    for (const [percent, colour] of [
      [79.9, "bg-emerald-500"],
      [80, "bg-amber-500"],
      [89.9, "bg-amber-500"],
      [90, "bg-red-500"],
    ] as Array<[number, string]>) {
      mockArray = arrayFixture({ capacityUsedPercent: percent });
      await renderOverview();

      const tile: HTMLElement = tileByTitle("Capacity Used");
      expect([percent, tile.querySelector(`.${colour}`)]).toEqual([
        percent,
        expect.anything(),
      ]);
      cleanup();
    }
  });

  test("Slowest Volumes ranks by the worse of read and write latency and leaves out a volume over 15 minutes old", async () => {
    await renderOverview();

    // vg1/vol-db is 14 minutes old: still in. vol-gone is 16: out.
    expect(inOrder(["vg1/vol-db", "vol-quick", "vol-gone"])).toEqual([
      // Slowest Volumes, then Largest Volumes.
      "vg1/vol-db",
      "vol-quick",
      "vol-quick",
      "vg1/vol-db",
    ]);
    expect(screen.getByText("5.20 ms")).toBeInTheDocument();
    expect(screen.queryByText("vol-gone")).not.toBeInTheDocument();
    expect(screen.queryByText("90.00 ms")).not.toBeInTheDocument();
  });

  test("Largest Volumes ranks by the flash each volume uses", async () => {
    await renderOverview();

    expect(screen.getByText("2.0 TiB")).toBeInTheDocument();
    expect(screen.getByText("1.0 TiB")).toBeInTheDocument();
    // The 50 TiB volume stopped reporting 16 minutes ago.
    expect(screen.queryByText("50.0 TiB")).not.toBeInTheDocument();
  });

  test("Active Alerts reads the last 10 minutes and shows only the alerts still open, critical first", async () => {
    await renderOverview();

    const calls: Array<{
      query: {
        name: string;
        time: { startValue: Date; endValue: Date };
        attributes: Record<string, unknown>;
      };
    }> = analyticsGetListMock.mock.calls.map((call: Array<unknown>) => {
      return call[0] as never;
    });
    expect(
      calls.map((call: { query: { name: string } }) => {
        return call.query.name;
      }),
    ).toEqual(["purefa_alerts_open"]);
    const window: { startValue: Date; endValue: Date } = calls[0]!.query.time;
    expect(
      (new Date(window.endValue).getTime() -
        new Date(window.startValue).getTime()) /
        MINUTE,
    ).toBe(10);
    expect(calls[0]!.query.attributes["resource.storage.array.name"]).toBe(
      "fa-prod-01",
    );

    expect(
      inOrder([
        "Drive failure",
        "Fan running slow",
        "Phonehome disabled",
        "Internal housekeeping",
        "Controller failover finished",
      ]),
    ).toEqual(["Drive failure", "Fan running slow", "Phonehome disabled"]);
    expect(screen.getByText("Code 42 · CH0.BAY9")).toBeInTheDocument();
  });

  test("Hardware Needing Attention asks only for the unhealthy statuses and lists critical parts first", async () => {
    await renderOverview();

    const hardwareQuery: Record<string, unknown> | undefined =
      modelGetListMock.mock.calls
        .map((call: Array<unknown>) => {
          return (call[0] as { query: Record<string, unknown> }).query;
        })
        .find((query: Record<string, unknown>) => {
          return Boolean(query["status"]);
        });
    expect(hardwareQuery).toBeDefined();
    expect(
      [
        ...(hardwareQuery!["status"] as { values: Array<string> }).values,
      ].sort(),
    ).toEqual([...UNHEALTHY_RESOURCE_STATUSES].sort());
    // Parts that are not installed, powered off or unused are never asked for.
    for (const expected of ["not_installed", "device_off", "unused", "ok"]) {
      expect(
        (hardwareQuery!["status"] as { values: Array<string> }).values,
      ).not.toContain(expected);
    }
    expect(
      [...(hardwareQuery!["kind"] as { values: Array<string> }).values].sort(),
    ).toEqual(
      [
        StorageArrayResourceKind.Hardware,
        StorageArrayResourceKind.Drive,
        StorageArrayResourceKind.Controller,
      ].sort(),
    );

    expect(inOrder(["CT0.FAN1", "SH9.BAY3"])).toEqual(["SH9.BAY3", "CT0.FAN1"]);
  });

  test("a healthy array hides Active Alerts and its (i)", async () => {
    mockArray = arrayFixture({
      healthStatus: 0,
      openAlertCount: 0,
      criticalAlertCount: 0,
      warningAlertCount: 0,
    });
    await renderOverview();

    expectNoInfo("Active Alerts");
    expect(screen.queryByText("Drive failure")).not.toBeInTheDocument();
  });

  test("a row holding only the version chip gets no inventory (i)", async () => {
    mockArray = arrayFixture({
      volumeCount: undefined,
      hostCount: undefined,
      podCount: undefined,
      hardwareComponentCount: undefined,
    });
    await renderOverview();

    expect(screen.getByText("Purity//FA 6.7.2")).toBeInTheDocument();
    expectNoInfo("Storage array inventory counts");
  });

  test("the quick links and the details card carry no (i) - they are navigation and metadata", async () => {
    await renderOverview();

    for (const title of ["Quick Links", "Hosts", "Hardware", "Metrics"]) {
      expectNoInfo(title);
    }
  });
});

describe("Storage array overview (FlashBlade)", () => {
  beforeEach(() => {
    mockArray = arrayFixture(FLASHBLADE_OVERRIDES);
  });

  test("every metric on the page has an (i), and there are no others", async () => {
    await renderOverview("fb-prod-01");

    expect(infoLabels()).toEqual(
      OVERVIEW_FLASHBLADE_TITLES.map(
        ([title]: [string, StorageArrayMetric]) => {
          return title;
        },
      ).sort(),
    );
  });

  test.each(OVERVIEW_FLASHBLADE_TITLES)(
    "%s shows its STORAGE_ARRAY_METRIC_DESCRIPTIONS text",
    async (title: string, key: StorageArrayMetric) => {
      await renderOverview("fb-prod-01");
      await expectExplained(title, key);
    },
  );

  test("the top file system lists leave out a file system over 15 minutes old", async () => {
    await renderOverview("fb-prod-01");

    expect(inOrder(["home", "scratch"])).toEqual(["home", "home"]);
    expect(screen.queryByText("40.0 TiB")).not.toBeInTheDocument();
  });
});

// --------------------------------------------------------------- the list

describe("Storage Arrays list", () => {
  async function renderList(): Promise<RecordedTable> {
    await renderPage(StorageArrays);
    return recordedTable("storage-arrays-table");
  }

  test("each metric column carries its header tooltip; the rest carry none", async () => {
    expect(columnPairs(await renderList())).toEqual(LIST_COLUMNS);
  });

  test("the Capacity bar colours match the thresholds its text names", async () => {
    const capacity: RecordedColumn = columnByTitle(
      await renderList(),
      "Capacity",
    );

    for (const [percent, colour] of [
      [79.9, "bg-emerald-500"],
      [80, "bg-amber-500"],
      [89.9, "bg-amber-500"],
      [90, "bg-red-500"],
    ] as Array<[number, string]>) {
      expect([
        percent,
        cellHtml(capacity, { capacityUsedPercent: percent }),
      ]).toEqual([percent, expect.stringContaining(colour)]);
    }
    expect(cellText(capacity, {})).toBe("—");
  });

  test("Open Alerts counts the open alerts and how many are critical", async () => {
    const openAlerts: RecordedColumn = columnByTitle(
      await renderList(),
      "Open Alerts",
    );

    expect(
      cellText(openAlerts, { openAlertCount: 3, criticalAlertCount: 1 }),
    ).toBe("3 open, 1 critical");
    expect(
      cellHtml(openAlerts, { openAlertCount: 3, criticalAlertCount: 1 }),
    ).toContain("text-red-700");
    expect(
      cellHtml(openAlerts, { openAlertCount: 2, criticalAlertCount: 0 }),
    ).toContain("text-amber-700");
    expect(cellText(openAlerts, { openAlertCount: 0 })).toBe("0");
  });

  test("Inventory shows volumes and hosts on a FlashArray, file systems on a FlashBlade", async () => {
    const inventory: RecordedColumn = columnByTitle(
      await renderList(),
      "Inventory",
    );

    expect(
      cellText(inventory, {
        storageSystem: StorageSystem.PureStorageFlashArray,
        volumeCount: 12,
        hostCount: 1,
      }),
    ).toBe("12 volumes · 1 host");
    expect(
      cellText(inventory, {
        storageSystem: StorageSystem.PureStorageFlashBlade,
        fileSystemCount: 4,
        volumeCount: 0,
      }),
    ).toBe("4 file systems");
  });

  test("Data Reduction is written the way the text writes it", async () => {
    const reduction: RecordedColumn = columnByTitle(
      await renderList(),
      "Data Reduction",
    );

    expect(cellText(reduction, { dataReductionRatio: 4 })).toBe("4.0:1");
  });
});

// ------------------------------------------------------ inventory tables

describe("Inventory tables: column headers", () => {
  test("Volumes", async () => {
    await renderPage(StorageArrayVolumes);
    expect(columnPairs(recordedTable("storage-array-volumes-table"))).toEqual(
      VOLUMES_COLUMNS,
    );
  });

  test("Hosts", async () => {
    await renderPage(StorageArrayHosts);
    expect(columnPairs(recordedTable("storage-array-hosts-table"))).toEqual(
      HOSTS_COLUMNS,
    );
  });

  test("Replication", async () => {
    await renderPage(StorageArrayReplication);
    expect(
      columnPairs(recordedTable("storage-array-replication-table")),
    ).toEqual(REPLICATION_COLUMNS);
  });

  test("Hardware on a FlashArray: components, drives, controllers and network interfaces", async () => {
    await renderPage(StorageArrayHardware);

    expect(Array.from(recordedTables().keys()).sort()).toEqual(
      [
        "storage-array-hardware-components-table",
        "storage-array-drives-table",
        "storage-array-controllers-table",
        "storage-array-network-interfaces-table",
      ].sort(),
    );
    expect(
      columnPairs(recordedTable("storage-array-hardware-components-table")),
    ).toEqual(HARDWARE_COMPONENTS_COLUMNS);
    expect(columnPairs(recordedTable("storage-array-drives-table"))).toEqual(
      DRIVES_COLUMNS,
    );
    expect(
      columnPairs(recordedTable("storage-array-controllers-table")),
    ).toEqual(CONTROLLERS_COLUMNS);
    expect(
      columnPairs(recordedTable("storage-array-network-interfaces-table")),
    ).toEqual(NETWORK_INTERFACES_COLUMNS);
  });

  test("Hardware on a FlashBlade: one table, with health", async () => {
    mockArray = arrayFixture(FLASHBLADE_OVERRIDES);
    await renderPage(StorageArrayHardware);

    expect(Array.from(recordedTables().keys())).toEqual([
      "storage-array-flashblade-hardware-table",
    ]);
    expect(
      columnPairs(recordedTable("storage-array-flashblade-hardware-table")),
    ).toEqual(FLASHBLADE_HARDWARE_COLUMNS);
  });

  test("Directories", async () => {
    await renderPage(StorageArrayDirectories);
    expect(
      columnPairs(recordedTable("storage-array-directories-table")),
    ).toEqual(DIRECTORIES_COLUMNS);
  });

  test("File Systems", async () => {
    await renderPage(StorageArrayFileSystems);
    expect(
      columnPairs(recordedTable("storage-array-file-systems-table")),
    ).toEqual(FILE_SYSTEMS_COLUMNS);
  });

  test("Buckets", async () => {
    await renderPage(StorageArrayBuckets);
    expect(columnPairs(recordedTable("storage-array-buckets-table"))).toEqual(
      BUCKETS_COLUMNS,
    );
  });

  test("Volumes: bandwidth and Last Seen start hidden; the column picker offers them", async () => {
    await renderPage(StorageArrayVolumes);
    const columns: Array<RecordedColumn & { isHiddenByDefault?: boolean }> =
      recordedTable("storage-array-volumes-table").columns;

    for (const column of columns) {
      expect([column.title, Boolean(column.isHiddenByDefault)]).toEqual([
        column.title,
        ["Read Bandwidth", "Write Bandwidth", "Last Seen"].includes(
          column.title,
        ),
      ]);
    }
  });
});

describe("Inventory tables: the cells keep the promises the texts make", () => {
  test("a volume that has not reported in 15 minutes shows a dash, as the text says", async () => {
    await renderPage(StorageArrayVolumes);
    const table: RecordedTable = recordedTable("storage-array-volumes-table");
    const latency: RecordedColumn = columnByTitle(table, "Read Latency");
    const physical: RecordedColumn = columnByTitle(table, "Physical");

    const fresh: Row = {
      kind: "Volume",
      readLatencyUsec: 250,
      usedBytes: 2 * TIB,
      metricsUpdatedAt: minutesAgo(14),
    };
    const stale: Row = { ...fresh, metricsUpdatedAt: minutesAgo(16) };

    expect(cellText(latency, fresh)).toBe("250 µs");
    expect(cellText(physical, fresh)).toBe("2.0 TiB");
    expect(cellText(latency, stale)).toBe("—");
    expect(cellText(physical, stale)).toBe("—");
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.readLatencyColumn).toMatch(
      /Shows a dash if it has not reported recently/,
    );
  });

  test("a directory keeps its space for 90 minutes, since it is read every 30", async () => {
    await renderPage(StorageArrayDirectories);
    const space: RecordedColumn = columnByTitle(
      recordedTable("storage-array-directories-table"),
      "Physical",
    );

    const directory: Row = {
      kind: "Directory",
      usedBytes: 10 * GIB,
      metricsUpdatedAt: minutesAgo(60),
    };

    expect(cellText(space, directory)).toBe("10.0 GiB");
    expect(
      cellText(space, { ...directory, metricsUpdatedAt: minutesAgo(89) }),
    ).toBe("10.0 GiB");
    expect(
      cellText(space, { ...directory, metricsUpdatedAt: minutesAgo(91) }),
    ).toBe("—");
  });

  test("Connectivity shows Pure's own detail beside the status", async () => {
    await renderPage(StorageArrayHosts);
    const connectivity: RecordedColumn = columnByTitle(
      recordedTable("storage-array-hosts-table"),
      "Connectivity",
    );

    const text: string = cellText(connectivity, {
      kind: "Host",
      status: "critical",
      statusDetail: "Single Controller",
    });
    expect(text).toContain("Critical");
    expect(text).toContain("Single Controller");
    expect(STORAGE_ARRAY_METRIC_DESCRIPTIONS.hostConnectivityColumn).toMatch(
      /such as Redundant or Single Controller, is Pure's own/,
    );
  });
});

// ------------------------------------------------------------ detail pages

async function renderDetail(
  Page: React.FunctionComponent<PageComponentProps>,
  externalId: string,
): Promise<void> {
  mockLastParam = encodeURIComponent(externalId);
  render(<Page {...PAGE_PROPS} />);
  await flush();
  await screen.findAllByText(externalId);
}

describe("Detail pages: summary fields", () => {
  test.each([
    [
      "volume",
      StorageArrayVolumeDetail,
      "vg1/vol-db",
      VOLUME_DETAIL_FIELDS,
      ["Volume", "Storage Array", "NAA ID", "Last Seen"],
      undefined,
    ],
    [
      "host",
      StorageArrayHostDetail,
      "esxi-01",
      HOST_DETAIL_FIELDS,
      ["Host", "Storage Array", "Last Seen"],
      undefined,
    ],
    [
      "file system",
      StorageArrayFileSystemDetail,
      "home",
      FILE_SYSTEM_DETAIL_FIELDS,
      ["File System", "Storage Array", "Last Seen"],
      FLASHBLADE_OVERRIDES,
    ],
    [
      "bucket",
      StorageArrayBucketDetail,
      "backups",
      BUCKET_DETAIL_FIELDS,
      ["Bucket", "Storage Array", "Last Seen"],
      FLASHBLADE_OVERRIDES,
    ],
  ] as Array<
    [
      string,
      React.FunctionComponent<PageComponentProps>,
      string,
      Array<[string, StorageArrayMetric]>,
      Array<string>,
      Row | undefined,
    ]
  >)(
    "the %s page: each metric field has an (i) with its text; identity fields have none",
    async (
      _: string,
      Page: React.FunctionComponent<PageComponentProps>,
      externalId: string,
      fields: Array<[string, StorageArrayMetric]>,
      identity: Array<string>,
      overrides: Row | undefined,
    ) => {
      mockArray = arrayFixture(overrides || {});
      await renderDetail(Page, externalId);

      expect(infoLabels()).toEqual(
        fields
          .map(([title]: [string, StorageArrayMetric]) => {
            return title;
          })
          .sort(),
      );
      for (const [title, key] of fields) {
        await expectExplained(title, key);
      }
      for (const title of identity) {
        expect(screen.getAllByText(title).length).toBeGreaterThan(0);
        expectNoInfo(title);
      }
      expectNoNestedInfoButtons();
    },
  );
});
