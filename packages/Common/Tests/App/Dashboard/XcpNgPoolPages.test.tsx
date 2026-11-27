/**
 * @timezone UTC
 */
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

/*
 * An XCP-ng pool's own pages, rendered for real against a stubbed data
 * layer: the Overview (its hero, its counts and what is wrong among them,
 * what needs attention, its tiles, the busiest VMs and hosts, every host
 * and storage repository at a glance), the Hosts, VMs and Storage lists,
 * and a host's, a VM's and a storage repository's own page. The metric
 * charts are stood in (their builder is XcpNgPartCharts' suite), and so are
 * the cards every resource's Overview shares; the rest is the page as it
 * ships.
 */

const POOL_ID: string = "71000000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const POOL_PATH: string = `/dashboard/${PROJECT_ID}/xcp-ng/${POOL_ID}`;
const NOW: Date = new Date("2026-11-24T12:00:00.000Z");
const INVENTORY_DOWN: string = "Server is not available. Please try again.";
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const GIB: number = 1024 * 1024 * 1024;

type Row = Record<string, unknown>;

let mockLastParam: string = "h1";
let mockPool: Row = {};
let mockInventory: Array<Row> = [];
// While true, every read of the inventory fails, as a server that is down.
let mockInventoryDown: boolean = false;

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
  // The inventory's query, as the pages ask it: a field's value, or Includes.
  const matches: (row: Row, query: Record<string, unknown>) => boolean = (
    row: Row,
    query: Record<string, unknown>,
  ): boolean => {
    for (const field of [
      "kind",
      "externalId",
      "parentHostExternalId",
      "vmExternalId",
      "storageRepositoryExternalId",
    ]) {
      const wanted: unknown = query[field];
      if (wanted === undefined) {
        continue;
      }
      const values: unknown =
        wanted && typeof wanted === "object"
          ? (wanted as { values?: unknown }).values
          : undefined;
      if (Array.isArray(values)) {
        if (!values.includes(row[field])) {
          return false;
        }
      } else if (row[field] !== wanted) {
        return false;
      }
    }
    return true;
  };
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: new () => { tableName?: string };
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const model: { tableName?: string } = new Model();
        if (model.tableName === "XcpNgPool") {
          return Promise.resolve(Object.assign(model, mockPool));
        }
        return Promise.resolve(null);
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
        query: Record<string, unknown>;
        sort?: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "";
        let records: Array<Row> = [];
        if (modelName === "XcpNgResource") {
          if (mockInventoryDown) {
            return Promise.reject(new Error(INVENTORY_DOWN));
          }
          records = mockInventory.filter((row: Row): boolean => {
            return matches(row, request.query);
          });
          // In the order the server returns them: by name, when asked.
          if (request.sort && request.sort["name"]) {
            records = [...records].sort((a: Row, b: Row): number => {
              return String(a["name"]).localeCompare(String(b["name"]));
            });
          }
        }
        const data: Array<unknown> = records.map((record: Row) => {
          return Object.assign(new Model(), record);
        });
        return Promise.resolve({ data, count: data.length });
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
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
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

/*
 * What the pages ask the server besides the pool's rows: which recommended
 * alerts already have a monitor (none, here), and how OneUptime AI reaches
 * the pool (its Overview's AI agent card, answered with a refusal, which
 * never fails the page). Every other request is a test that forgot one.
 */
let mockApiPosts: Array<string> = [];

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (request: { url: unknown }): Promise<unknown> => {
        const url: string = String(request.url);
        mockApiPosts.push(url);

        if (url.endsWith("/recommendation-coverage")) {
          return Promise.resolve({ data: { covered: {} } });
        }

        return Promise.reject(new Error(`No stand-in for ${url}`));
      },
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
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
        return new ObjectIDType("71000000-0000-4000-8000-000000000001");
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

// The charts: what they would read, written onto the page.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: (props: {
        queryConfigs: Array<{
          metricQueryData: { filterData: Record<string, unknown> };
        }>;
      }) => {
        return (
          <div data-testid="resource-metrics-tab">
            {props.queryConfigs
              .map(
                (query: {
                  metricQueryData: { filterData: Record<string, unknown> };
                }): string => {
                  return String(query.metricQueryData.filterData["metricName"]);
                },
              )
              .join(",")}
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
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="resource-activity-cards" />;
      },
    };
  },
);

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

import XcpNgPoolOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Index";
import XcpNgPoolHosts from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Hosts";
import XcpNgPoolVms, {
  XCP_NG_SHOW_CONTROL_DOMAINS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Vms";
import XcpNgPoolStorage from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/Storage";
import XcpNgPoolHostDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/HostDetail";
import XcpNgPoolVmDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/VmDetail";
import XcpNgPoolStorageDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/View/StorageDetail";
import {
  XCP_NG_PART_READ_ERROR_TEST_ID,
  XCP_NG_PART_READ_ERROR_TITLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/XcpNg/Part/XcpNgPartReadError";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MonitorRecommendationCoverageApi from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/MonitorRecommendationCoverageApi";
import ObjectID from "../../../Types/ObjectID";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function pool(fields: Row = {}): Row {
  return {
    _id: POOL_ID,
    name: "Production",
    poolIdentifier: "b7569d99-30f8-178a-7d94-801de3e29b5b",
    reportedName: "Production",
    xenOrchestraName: "xo-paris",
    agentVersion: "0.165.0",
    otelCollectorStatus: "connected",
    lastSeenAt: ago(MINUTE),
    agentLastSeenAt: ago(MINUTE),
    hostCount: 3,
    runningHostCount: 2,
    disabledHostCount: 1,
    vmCount: 3,
    runningVmCount: 1,
    storageRepositoryCount: 3,
    storageCapacityBytes: 200 * GIB,
    storageUsedBytes: 102 * GIB,
    ...fields,
  };
}

/*
 * Three hosts (one running, one disabled, one halted), three VMs (one
 * running, one halted two hours after it ran, one suspended) and a host's
 * control domain, a shared NFS repository 92% full, a local one allocated
 * three times its size, an ISO library, and the virtual disks between them.
 */
function inventory(): Array<Row> {
  return [
    {
      kind: "Host",
      externalId: "h1",
      name: "xcp-prod-01",
      powerState: "Running",
      isUp: true,
      isEnabled: true,
      latestCpuPercent: 42,
      latestMemoryBytes: 64 * GIB,
      maxMemoryBytes: 256 * GIB,
      cpuCount: 32,
      runningVcpuCount: 12,
      loadAverage: 2.48,
      powerWatts: 241,
      uptimeSeconds: 41 * 86400 + 5 * 3600,
      metricsUpdatedAt: ago(MINUTE),
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "Host",
      externalId: "h2",
      name: "xcp-prod-02",
      powerState: "Running",
      isUp: true,
      isEnabled: false,
      latestCpuPercent: 8,
      latestMemoryBytes: 32 * GIB,
      maxMemoryBytes: 256 * GIB,
      cpuCount: 32,
      metricsUpdatedAt: ago(MINUTE),
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "Host",
      externalId: "h3",
      name: "xcp-prod-03",
      powerState: "Halted",
      isUp: false,
      isEnabled: true,
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "VM",
      externalId: "v1",
      name: "web-01",
      powerState: "Running",
      isUp: true,
      isControlDomain: false,
      parentHostExternalId: "h1",
      parentHostName: "xcp-prod-01",
      latestCpuPercent: 22,
      latestMemoryBytes: 2 * GIB,
      maxMemoryBytes: 8 * GIB,
      latestMemoryPercent: 25,
      cpuCount: 4,
      tags: "production,web",
      uptimeSeconds: 2 * 86400,
      lastRunningAt: ago(MINUTE),
      metricsUpdatedAt: ago(MINUTE),
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "VM",
      externalId: "v2",
      name: "db-01",
      powerState: "Halted",
      isUp: false,
      isControlDomain: false,
      parentHostExternalId: "h1",
      parentHostName: "xcp-prod-01",
      maxMemoryBytes: 16 * GIB,
      cpuCount: 8,
      lastRunningAt: ago(2 * HOUR),
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "VM",
      externalId: "v3",
      name: "win-03",
      powerState: "Suspended",
      isUp: false,
      isControlDomain: false,
      maxMemoryBytes: 4 * GIB,
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "VM",
      externalId: "dom0-h1",
      name: "Control domain on host: xcp-prod-01",
      powerState: "Running",
      isUp: true,
      isControlDomain: true,
      parentHostExternalId: "h1",
      parentHostName: "xcp-prod-01",
      latestCpuPercent: 3,
      maxMemoryBytes: 4 * GIB,
      metricsUpdatedAt: ago(MINUTE),
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "StorageRepository",
      externalId: "s1",
      name: "NFS VM store",
      isShared: true,
      contentType: "user",
      srType: "nfs",
      latestDiskBytes: 92 * GIB,
      maxDiskBytes: 100 * GIB,
      virtualAllocationBytes: 80 * GIB,
      metricsUpdatedAt: ago(MINUTE),
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "StorageRepository",
      externalId: "s2",
      name: "Local storage",
      isShared: false,
      parentHostExternalId: "h1",
      parentHostName: "xcp-prod-01",
      contentType: "user",
      srType: "lvm",
      latestDiskBytes: 10 * GIB,
      maxDiskBytes: 100 * GIB,
      virtualAllocationBytes: 300 * GIB,
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "StorageRepository",
      externalId: "s3",
      name: "XCP-ng Tools",
      isShared: true,
      contentType: "iso",
      srType: "iso",
      latestDiskBytes: 0,
      maxDiskBytes: 0,
      virtualAllocationBytes: 0,
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "VDI",
      externalId: "d1",
      name: "web-01 system",
      vmExternalId: "v1",
      vmName: "web-01",
      storageRepositoryExternalId: "s1",
      storageRepositoryName: "NFS VM store",
      latestDiskBytes: 12 * GIB,
      maxDiskBytes: 64 * GIB,
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "VDI",
      externalId: "d2",
      name: "db-01 data",
      vmExternalId: "v2",
      vmName: "db-01",
      storageRepositoryExternalId: "s2",
      storageRepositoryName: "Local storage",
      latestDiskBytes: 40 * GIB,
      maxDiskBytes: 200 * GIB,
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "VDI",
      externalId: "d3",
      name: "scratch",
      storageRepositoryExternalId: "s1",
      storageRepositoryName: "NFS VM store",
      latestDiskBytes: GIB,
      maxDiskBytes: 10 * GIB,
      lastSeenAt: ago(MINUTE),
    },
  ];
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderList(
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<void> {
  render(<Page {...PAGE_PROPS} />);
  await screen.findByRole("table");
  await flush();
}

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
  testId: string,
  lastParam: string = "",
): Promise<void> {
  mockLastParam = lastParam;
  render(<Page {...PAGE_PROPS} />);
  await screen.findByTestId(testId);
  await flush();
}

function attentionRows(testId: string): Array<string> {
  return screen
    .queryAllByTestId(`${testId}-item`)
    .map((item: HTMLElement): string => {
      const reasons: Array<string> = within(item)
        .queryAllByTestId(`${testId}-reason`)
        .map((reason: HTMLElement): string => {
          return reason.textContent || "";
        });
      const name: string =
        within(item).getByTestId(`${testId}-name`).textContent || "";
      return `${name}: ${reasons.join(", ")}`;
    });
}

function tile(tilesTestId: string, title: string): HTMLElement {
  const label: HTMLElement = within(
    screen.getByTestId(tilesTestId),
  ).getAllByText(title)[0]!;
  return label.closest("div.rounded-xl") as HTMLElement;
}

function texts(testId: string): Array<string> {
  return screen.queryAllByTestId(testId).map((element: HTMLElement): string => {
    return element.textContent || "";
  });
}

// Each row of the one table on the page, as read.
function tableRows(): Array<string> {
  const table: HTMLElement = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row: HTMLElement): string => {
      return row.textContent || "";
    });
}

function tableRow(name: string): string {
  const row: string | undefined = tableRows().find(
    (candidate: string): boolean => {
      return candidate.includes(name);
    },
  );
  if (row === undefined) {
    throw new Error(`no row for ${name} in ${tableRows().join(" | ")}`);
  }
  return row;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  /*
   * Which of a part's recommended alerts are on: the server says it now
   * (POST /monitor/recommendation-coverage, #11074) - none, here.
   */
  jest
    .spyOn(MonitorRecommendationCoverageApi, "findCoveringMonitors")
    .mockResolvedValue(new Map<string, ObjectID>());
  mockPool = pool();
  mockInventory = inventory();
  mockInventoryDown = false;
  mockApiPosts = [];
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a pool's Overview", () => {
  test("ends with its XCP-ng AI agent's card, which asks how OneUptime AI reaches this pool", async () => {
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(
      mockApiPosts.filter((url: string): boolean => {
        return url.endsWith("/resource-ai-access/status");
      }),
    ).toHaveLength(1);
  });

  test("its hero: the pool, connected, its health, when it was last seen and where it is read from", async () => {
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Production",
    );
    expect(screen.getByTestId("xcp-ng-hero-connection")).toHaveTextContent(
      "Connected",
    );
    // A host is halted: the pool is Unhealthy, and the pill opens why.
    expect(screen.getByTestId("xcp-ng-hero-health")).toHaveTextContent(
      "Unhealthy",
    );
    expect(screen.getByTestId("xcp-ng-hero-last-seen")).toHaveTextContent(
      /^Last seen/,
    );
    const provenance: HTMLElement = screen.getByTestId(
      "xcp-ng-hero-provenance",
    );
    expect(provenance).toHaveTextContent(
      "Read from Xen Orchestra xo-paris by the XCP-ng Agent",
    );
    expect(provenance).toHaveTextContent("0.165.0");
    // Connected: nothing to set up.
    expect(screen.queryByTestId("resource-connection-guide")).toBeNull();
  });

  test("its counts open their lists, and each count of what is wrong opens which and why", async () => {
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(screen.getByTestId("xcp-ng-hero-hosts")).toHaveTextContent(
      "2/3 hosts running",
    );
    expect(screen.getByTestId("xcp-ng-hero-hosts")).toHaveAttribute(
      "href",
      `${POOL_PATH}/hosts`,
    );
    // The control domain is the host's own: three VMs, not four.
    expect(screen.getByTestId("xcp-ng-hero-vms")).toHaveTextContent(
      "1/3 VMs running",
    );
    expect(screen.getByTestId("xcp-ng-hero-vms")).toHaveAttribute(
      "href",
      `${POOL_PATH}/vms`,
    );
    expect(screen.getByTestId("xcp-ng-hero-storage")).toHaveTextContent(
      "3 storage repositories",
    );
    expect(screen.getByTestId("xcp-ng-hero-hosts-offline")).toHaveTextContent(
      "1 offline",
    );
    expect(screen.getByTestId("xcp-ng-hero-hosts-offline")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    // Disabled is someone's choice: grey.
    expect(screen.getByTestId("xcp-ng-hero-hosts-disabled")).toHaveTextContent(
      "1 disabled",
    );
    expect(screen.getByTestId("xcp-ng-hero-hosts-disabled")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    expect(screen.getByTestId("xcp-ng-hero-vms-stopped")).toHaveTextContent(
      "1 stopped",
    );
    expect(screen.getByTestId("xcp-ng-hero-storage-full")).toHaveTextContent(
      "1 nearly full",
    );
    expect(screen.getByTestId("xcp-ng-hero-storage-over")).toHaveTextContent(
      "1 over-provisioned",
    );

    fireEvent.click(screen.getByTestId("xcp-ng-hero-vms-stopped"));
    await flush();
    expect(screen.getByText("1 VM stopped after running")).toBeInTheDocument();
    const dialog: HTMLElement = screen.getByTestId(
      "xcp-ng-hero-vms-stopped-dialog",
    );
    expect(dialog).toHaveTextContent("db-01");
    expect(dialog).toHaveTextContent("Halted after running");
    // Where it ran, and when it last did.
    expect(dialog).toHaveTextContent("Host:xcp-prod-01");
    expect(dialog).toHaveTextContent("Last running 2 hours ago");
    // A suspended VM, and one never seen running, are not in it.
    expect(dialog).not.toHaveTextContent("win-03");
  });

  test("what needs attention, most urgent first, each a step from its page", async () => {
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(attentionRows("xcp-ng-needs-attention")).toEqual([
      "xcp-prod-03: Halted",
      "xcp-prod-02: Disabled",
      "Local storage: 300\u00A0GiB allocated of 100\u00A0GiB",
      "NFS VM store: 92% full",
      "db-01: Halted after running",
    ]);
    expect(
      within(screen.getByTestId("xcp-ng-needs-attention"))
        .getByText("xcp-prod-03")
        .closest("a"),
    ).toHaveAttribute("href", `${POOL_PATH}/hosts/h3`);
  });

  test("its tiles: hosts and VMs running, and the storage that holds VM disks", async () => {
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(tile("xcp-ng-tiles", "Hosts")).toHaveTextContent(
      "2/3running · 1 disabled",
    );
    expect(
      within(tile("xcp-ng-tiles", "Hosts")).getByTestId(
        "xcp-ng-tile-hosts-offline",
      ),
    ).toHaveTextContent("1 offline");
    expect(tile("xcp-ng-tiles", "VMs")).toHaveTextContent("1/3running");
    // The ISO library holds no VM disk: 102 GiB of the 200 GiB that do.
    expect(tile("xcp-ng-tiles", "Storage")).toHaveTextContent(
      "51%102 GiB of 200 GiB",
    );
  });

  test("the busiest VMs and hosts, by CPU and by memory, each a step from its page", async () => {
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    // A control domain is its host's own, never a busy VM.
    expect(texts("xcp-ng-busiest-vms-cpu-name")).toEqual(["web-01"]);
    expect(texts("xcp-ng-busiest-vms-memory-name")).toEqual(["web-01"]);
    expect(texts("xcp-ng-busiest-hosts-cpu-name")).toEqual([
      "xcp-prod-01",
      "xcp-prod-02",
    ]);
    expect(texts("xcp-ng-busiest-hosts-memory-name")).toEqual([
      "xcp-prod-01",
      "xcp-prod-02",
    ]);
    expect(
      within(screen.getByTestId("xcp-ng-busiest-vms-cpu"))
        .getByText("web-01")
        .closest("a"),
    ).toHaveAttribute("href", `${POOL_PATH}/vms/v1`);
    expect(
      within(screen.getByTestId("xcp-ng-busiest-vms-all")).getByRole("link"),
    ).toHaveAttribute("href", `${POOL_PATH}/vms`);
  });

  test("every host and storage repository at a glance: the halted host and the fullest repository first", async () => {
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(texts("xcp-ng-hosts-card-name")).toEqual([
      "xcp-prod-03",
      "xcp-prod-02",
      "xcp-prod-01",
    ]);
    expect(screen.getByTestId("xcp-ng-hosts-card-disabled")).toHaveTextContent(
      "Disabled",
    );
    expect(texts("xcp-ng-storage-card-name")).toEqual([
      "NFS VM store",
      "Local storage",
      "XCP-ng Tools",
    ]);
    expect(
      screen.getByTestId("xcp-ng-storage-card-over-provisioned"),
    ).toHaveTextContent("300% allocated");
  });

  test("a pool Xen Orchestra stopped reporting says so, and its last inventory counts nothing as wrong", async () => {
    mockPool = pool({
      otelCollectorStatus: "disconnected",
      lastSeenAt: ago(2 * HOUR),
      agentLastSeenAt: ago(MINUTE),
    });
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(screen.getByTestId("xcp-ng-hero-last-seen")).toHaveTextContent(
      "Xen Orchestra stopped reporting this pool",
    );
    expect(screen.getByTestId("xcp-ng-hero-health")).toHaveTextContent(
      "Health Unknown",
    );
    expect(screen.queryByTestId("xcp-ng-needs-attention")).toBeNull();
    expect(screen.queryByTestId("xcp-ng-hero-hosts-offline")).toBeNull();
    expect(screen.getByTestId("resource-connection-guide")).toBeInTheDocument();
  });

  test("a brand-new pool reads helpful, not broken: how to connect it, and no page of zeros", async () => {
    mockPool = pool({
      otelCollectorStatus: "disconnected",
      lastSeenAt: null,
      agentLastSeenAt: null,
      reportedName: null,
      xenOrchestraName: null,
      agentVersion: null,
      hostCount: 0,
      runningHostCount: 0,
      disabledHostCount: 0,
      vmCount: 0,
      runningVmCount: 0,
      storageRepositoryCount: 0,
      storageCapacityBytes: 0,
      storageUsedBytes: 0,
    });
    mockInventory = [];
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(screen.getByTestId("xcp-ng-hero-last-seen")).toHaveTextContent(
      "Never seen",
    );
    expect(screen.getByTestId("resource-connection-guide")).toBeInTheDocument();
    expect(screen.queryByTestId("xcp-ng-hero-health")).toBeNull();
    expect(screen.queryByTestId("xcp-ng-hero-chips")).toBeNull();
    expect(screen.queryByTestId("xcp-ng-hero-provenance")).toBeNull();
    expect(screen.queryByTestId("xcp-ng-tiles")).toBeNull();
    expect(screen.queryByTestId("xcp-ng-hosts-card")).toBeNull();
    // Not read yet: the card under the hero says how, not "nothing yet".
    expect(screen.queryByTestId("xcp-ng-waiting-for-inventory")).toBeNull();
  });

  test("a pool Xen Orchestra reports with nothing in it yet says what comes", async () => {
    mockInventory = [];
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(
      screen.getByTestId("xcp-ng-waiting-for-inventory"),
    ).toHaveTextContent("No hosts, VMs or storage repositories yet");
    expect(screen.queryByTestId("xcp-ng-tiles")).toBeNull();
    expect(screen.queryByTestId("xcp-ng-needs-attention")).toBeNull();
  });

  test("an inventory that could not be read says why, never zeros that read as an empty pool", async () => {
    mockInventoryDown = true;
    await renderPage(XcpNgPoolOverview, "xcp-ng-overview");

    expect(screen.getByText(INVENTORY_DOWN)).toBeInTheDocument();
    expect(screen.queryByTestId("xcp-ng-tiles")).toBeNull();
    expect(screen.queryByTestId("xcp-ng-waiting-for-inventory")).toBeNull();
    // The hero still counts from the pool's own row.
    expect(screen.getByTestId("xcp-ng-hero-hosts")).toHaveTextContent(
      "2/3 hosts running",
    );
  });
});

describe("the pool's lists", () => {
  test("hosts: each one's state, a disabled one saying so in grey under it, each a step from its page", async () => {
    await renderList(XcpNgPoolHosts);

    expect(tableRows()).toHaveLength(3);
    expect(tableRow("xcp-prod-01")).toContain("Running");
    expect(tableRow("xcp-prod-02")).toContain("Disabled: starts no new VMs");
    expect(tableRow("xcp-prod-03")).toContain("Halted");
    // The vCPUs its VMs run, of its threads.
    expect(tableRow("xcp-prod-01")).toContain("12/32");
  });

  test("VMs: the control domains are the hosts' own, left out until the switch shows them", async () => {
    await renderPage(XcpNgPoolVms, "xcp-ng-vms-page");

    expect(tableRows()).toHaveLength(3);
    expect(tableRows().join(" ")).not.toContain("Control domain on host");
    expect(tableRow("win-03")).toContain("Suspended");
    // A stopped VM says when it last ran; a running one, how long it has.
    expect(tableRow("db-01")).toContain("Last running");
    expect(tableRow("web-01")).toContain("xcp-prod-01");
    expect(tableRow("web-01")).toContain("production");

    fireEvent.click(screen.getByTestId(XCP_NG_SHOW_CONTROL_DOMAINS_TEST_ID));
    await flush();

    expect(tableRows()).toHaveLength(4);
    expect(tableRow("Control domain on host")).toContain("Control domain");
  });

  test("VMs: no switch for control domains a pool does not report", async () => {
    mockInventory = inventory().filter((row: Row): boolean => {
      return row["isControlDomain"] !== true;
    });
    await renderPage(XcpNgPoolVms, "xcp-ng-vms-page");

    expect(
      screen.queryByTestId(XCP_NG_SHOW_CONTROL_DOMAINS_TEST_ID),
    ).toBeNull();
  });

  test("storage repositories: shared or a host's, how full, what is allocated on them and how many virtual disks", async () => {
    await renderList(XcpNgPoolStorage);

    expect(tableRows()).toHaveLength(3);
    const nfs: string = tableRow("NFS VM store");
    expect(nfs).toContain("Shared");
    expect(nfs).toContain("NFS");
    expect(nfs).toContain("VM disks");
    const local: string = tableRow("Local storage");
    expect(local).toContain("xcp-prod-01");
    expect(local).toContain("LVM (local)");
    expect(local).toContain("over-provisioned");
    expect(tableRow("XCP-ng Tools")).toContain("ISO library");
  });

  test("a list that could not be read says why, not that the pool has none", async () => {
    mockInventoryDown = true;
    render(<XcpNgPoolHosts {...PAGE_PROPS} />);
    await flush();

    expect(screen.getByText(INVENTORY_DOWN)).toBeInTheDocument();
    expect(screen.queryByText(/No hosts yet/)).toBeNull();
  });
});

describe("a host's page", () => {
  test("its hero: the host, its state, its pool a step away, and its size", async () => {
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "h1");

    expect(screen.getByTestId("xcp-ng-host-hero-name")).toHaveTextContent(
      "xcp-prod-01",
    );
    expect(screen.getByTestId("xcp-ng-host-hero-status")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    const location: HTMLElement = screen.getByTestId(
      "xcp-ng-host-hero-location",
    );
    expect(location).toHaveTextContent("Host of pool Production");
    expect(
      within(location).getByText("Production").closest("a"),
    ).toHaveAttribute("href", POOL_PATH);
    const chips: HTMLElement = screen.getByTestId("xcp-ng-host-hero-chips");
    expect(chips).toHaveTextContent("32 CPU threads");
    expect(chips).toHaveTextContent("256 GiB memory");
    // Its control domain is its own, not one of its VMs.
    expect(chips).toHaveTextContent("1/2 VMs running");
    expect(chips).toHaveTextContent("up 41d 5h");
  });

  test("what needs attention on it: its own storage and VMs, most urgent first", async () => {
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "h1");

    expect(attentionRows("xcp-ng-host-attention")).toEqual([
      "Local storage: 300\u00A0GiB allocated of 100\u00A0GiB",
      "db-01: Halted after running",
    ]);
  });

  test("its tiles: CPU of its threads, memory, the VMs it runs and its power draw", async () => {
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "h1");

    expect(tile("xcp-ng-host-tiles", "CPU")).toHaveTextContent(
      "42.0%of 32 threads",
    );
    expect(tile("xcp-ng-host-tiles", "Memory")).toHaveTextContent(
      "25.0%64 GiB of 256 GiB",
    );
    expect(tile("xcp-ng-host-tiles", "VMs")).toHaveTextContent("1/2running");
    expect(tile("xcp-ng-host-tiles", "Power")).toHaveTextContent("241 W");
  });

  test("its busiest VMs, and the step to all of them on its VMs tab", async () => {
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "h1");

    expect(texts("xcp-ng-host-busiest-vms-cpu-name")).toEqual(["web-01"]);
    fireEvent.click(
      within(screen.getByTestId("xcp-ng-host-busiest-vms-all")).getByRole(
        "button",
        { name: "View all 2 VMs" },
      ),
    );
    await flush();

    expect(tableRows()).toHaveLength(2);
    expect(tableRow("web-01")).toContain("Running");
    expect(tableRow("db-01")).toContain("Halted");
  });

  test("its Storage tab: only its local storage repositories", async () => {
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "h1");

    fireEvent.click(screen.getByRole("tab", { name: /Storage/ }));
    await flush();

    expect(tableRows()).toHaveLength(1);
    expect(tableRow("Local storage")).toContain("over-provisioned");
  });

  test("its Metrics tab draws the host's own series", async () => {
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "h1");

    fireEvent.click(screen.getByRole("tab", { name: /Metrics/ }));
    await flush();

    expect(screen.getByTestId("resource-metrics-tab").textContent).toContain(
      "xcp_host_cpu_average",
    );
  });

  test("a disabled host says so in grey, and the page says it is its own", async () => {
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "h2");

    expect(texts("xcp-ng-host-hero-badge")).toContain("Disabled");
    expect(attentionRows("xcp-ng-host-attention")).toEqual([
      "This host: Disabled",
    ]);
  });

  test("a halted host is red, and first on its own list", async () => {
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "h3");

    expect(screen.getByTestId("xcp-ng-host-hero-status")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(attentionRows("xcp-ng-host-attention")).toEqual([
      "This host: Halted",
    ]);
  });

  test("a host the pool no longer reports says so, by the UUID in its address", async () => {
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "gone");

    expect(screen.getByTestId("xcp-ng-host-not-reported")).toBeInTheDocument();
  });

  test("an inventory that could not be read says so, not that the host has not reported", async () => {
    mockInventoryDown = true;
    await renderPage(XcpNgPoolHostDetail, "xcp-ng-host-hero", "h1");

    const readError: HTMLElement = screen.getByTestId(
      XCP_NG_PART_READ_ERROR_TEST_ID,
    );
    expect(readError).toHaveTextContent(XCP_NG_PART_READ_ERROR_TITLES.Host);
    expect(readError).toHaveTextContent(INVENTORY_DOWN);
    expect(screen.queryByTestId("xcp-ng-host-not-reported")).toBeNull();
    expect(screen.queryByTestId("xcp-ng-host-overview")).toBeNull();
  });
});

describe("a VM's page", () => {
  test("its hero: the VM, running on its host of its pool, its size and its tags", async () => {
    await renderPage(XcpNgPoolVmDetail, "xcp-ng-vm-hero", "v1");

    expect(screen.getByTestId("xcp-ng-vm-hero-name")).toHaveTextContent(
      "web-01",
    );
    expect(screen.getByTestId("xcp-ng-vm-hero-status")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    const location: HTMLElement = screen.getByTestId("xcp-ng-vm-hero-location");
    expect(location).toHaveTextContent(
      "On host xcp-prod-01 of pool Production",
    );
    expect(
      within(location).getByText("xcp-prod-01").closest("a"),
    ).toHaveAttribute("href", `${POOL_PATH}/hosts/h1`);
    const chips: HTMLElement = screen.getByTestId("xcp-ng-vm-hero-chips");
    expect(chips).toHaveTextContent("4 vCPUs");
    expect(chips).toHaveTextContent("8 GiB memory");
    expect(texts("xcp-ng-vm-hero-tag")).toEqual(["production", "web"]);
  });

  test("its tiles: CPU of its vCPUs, the memory its guest tools say it uses, and how long it has run", async () => {
    await renderPage(XcpNgPoolVmDetail, "xcp-ng-vm-hero", "v1");

    expect(tile("xcp-ng-vm-tiles", "CPU")).toHaveTextContent("22.0%of 4 vCPUs");
    expect(tile("xcp-ng-vm-tiles", "Memory")).toHaveTextContent(
      "25.0%2 GiB of 8 GiB",
    );
    expect(tile("xcp-ng-vm-tiles", "Uptime")).toHaveTextContent(
      "since it last started",
    );
  });

  test("its virtual disks, each on its storage repository a step away", async () => {
    await renderPage(XcpNgPoolVmDetail, "xcp-ng-vm-hero", "v1");

    expect(texts("xcp-ng-vm-disks-name")).toEqual(["web-01 system"]);
    expect(
      within(screen.getByTestId("xcp-ng-vm-disks"))
        .getByText("NFS VM store")
        .closest("a"),
    ).toHaveAttribute("href", `${POOL_PATH}/storage/s1`);
  });

  test("a VM halted after it ran is amber, says when it last ran, and what it was given", async () => {
    await renderPage(XcpNgPoolVmDetail, "xcp-ng-vm-hero", "v2");

    expect(screen.getByTestId("xcp-ng-vm-hero-status")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(screen.getByTestId("xcp-ng-vm-hero-location")).toHaveTextContent(
      "Last ran on host xcp-prod-01 of pool Production",
    );
    expect(attentionRows("xcp-ng-vm-attention")).toEqual([
      "This VM: Halted after running",
    ]);
    // No guest tools reading: what it was given, and how to see more.
    expect(tile("xcp-ng-vm-tiles", "Memory")).toHaveTextContent(
      "16 GiBgiven; install the guest tools to see how much it uses",
    );
    expect(tile("xcp-ng-vm-tiles", "Uptime")).toHaveTextContent("last running");
  });

  test("a suspended VM is grey: someone suspended it", async () => {
    await renderPage(XcpNgPoolVmDetail, "xcp-ng-vm-hero", "v3");

    expect(screen.getByTestId("xcp-ng-vm-hero-status")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    expect(screen.queryAllByTestId("xcp-ng-vm-attention-item")).toHaveLength(0);
  });

  test("a control domain says it is one, and offers no VM alerts", async () => {
    await renderPage(XcpNgPoolVmDetail, "xcp-ng-vm-hero", "dom0-h1");

    expect(texts("xcp-ng-vm-hero-badge")).toContain("Control domain");
    expect(screen.queryByTestId("xcp-ng-vm-alerts")).toBeNull();
  });

  test("its Metrics tab draws the VM's own series", async () => {
    await renderPage(XcpNgPoolVmDetail, "xcp-ng-vm-hero", "v1");

    fireEvent.click(screen.getByRole("tab", { name: /Metrics/ }));
    await flush();

    expect(screen.getByTestId("resource-metrics-tab").textContent).toContain(
      "xcp_vm_",
    );
  });

  test("an inventory that could not be read says so", async () => {
    mockInventoryDown = true;
    await renderPage(XcpNgPoolVmDetail, "xcp-ng-vm-hero", "v1");

    expect(
      screen.getByTestId(XCP_NG_PART_READ_ERROR_TEST_ID),
    ).toHaveTextContent(XCP_NG_PART_READ_ERROR_TITLES.VM);
    expect(screen.queryByTestId("xcp-ng-vm-not-reported")).toBeNull();
  });
});

describe("a storage repository's page", () => {
  test("its hero: the repository, how full, shared by its pool, how it stores disks and its size", async () => {
    await renderPage(XcpNgPoolStorageDetail, "xcp-ng-sr-hero", "s1");

    expect(screen.getByTestId("xcp-ng-sr-hero-name")).toHaveTextContent(
      "NFS VM store",
    );
    expect(screen.getByTestId("xcp-ng-sr-hero-status")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(screen.getByTestId("xcp-ng-sr-hero-location")).toHaveTextContent(
      "Storage repository of pool Production",
    );
    const chips: HTMLElement = screen.getByTestId("xcp-ng-sr-hero-chips");
    expect(chips).toHaveTextContent("NFS");
    expect(chips).toHaveTextContent("VM disks");
    expect(chips).toHaveTextContent("100 GiB total");
    expect(chips).toHaveTextContent("2 virtual disks");
  });

  test("its tiles: what is allocated on it, and its virtual disks with the VMs they belong to", async () => {
    await renderPage(XcpNgPoolStorageDetail, "xcp-ng-sr-hero", "s1");

    expect(tile("xcp-ng-sr-tiles", "Allocated")).toHaveTextContent(
      "80 GiB of 100 GiB allocated",
    );
    expect(tile("xcp-ng-sr-tiles", "Virtual Disks")).toHaveTextContent(
      "2attached to 1 VM",
    );
    expect(texts("xcp-ng-sr-disks-name")).toEqual(["scratch", "web-01 system"]);
    expect(
      within(screen.getByTestId("xcp-ng-sr-disks"))
        .getByText("web-01")
        .closest("a"),
    ).toHaveAttribute("href", `${POOL_PATH}/vms/v1`);
    expect(screen.getByTestId("xcp-ng-sr-disks")).toHaveTextContent(
      "Not attached",
    );
  });

  test("a host's own repository allocated past its size: amber, saying so, its host a step away", async () => {
    await renderPage(XcpNgPoolStorageDetail, "xcp-ng-sr-hero", "s2");

    const location: HTMLElement = screen.getByTestId("xcp-ng-sr-hero-location");
    expect(location).toHaveTextContent(
      "Storage repository of host xcp-prod-01 in pool Production",
    );
    expect(
      within(location).getByText("xcp-prod-01").closest("a"),
    ).toHaveAttribute("href", `${POOL_PATH}/hosts/h1`);
    expect(tile("xcp-ng-sr-tiles", "Allocated")).toHaveTextContent(
      "300 GiB of 100 GiB: over-provisioned",
    );
    expect(attentionRows("xcp-ng-sr-attention")).toEqual([
      "This storage repository: 300\u00A0GiB allocated of 100\u00A0GiB",
    ]);
  });

  test("its Metrics tab draws the repository's own series", async () => {
    await renderPage(XcpNgPoolStorageDetail, "xcp-ng-sr-hero", "s1");

    fireEvent.click(screen.getByRole("tab", { name: /Metrics/ }));
    await flush();

    expect(screen.getByTestId("resource-metrics-tab").textContent).toContain(
      "xcp_sr_",
    );
  });

  test("an inventory that could not be read says so", async () => {
    mockInventoryDown = true;
    await renderPage(XcpNgPoolStorageDetail, "xcp-ng-sr-hero", "s1");

    expect(
      screen.getByTestId(XCP_NG_PART_READ_ERROR_TEST_ID),
    ).toHaveTextContent(XCP_NG_PART_READ_ERROR_TITLES.StorageRepository);
    expect(screen.queryByTestId("xcp-ng-sr-not-reported")).toBeNull();
  });
});
