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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * An ESXi host's page inside its vCenter (Pages/VMware/View/HostDetail),
 * rendered for real against a stubbed data layer: what it reads for one
 * host, what each part of it shows from that, and how it behaves when data
 * is missing, stale, partial or not the reader's to see.
 *
 * Stood in for: the charts (ChartCard: the series each is fed are what is
 * checked), the logs explorer and the Metrics tab's charts (the props they
 * are handed are what is checked), and the vCenter AI agent card (a shared
 * card with suites of its own).
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const VCENTER_ID: string = "31000000-0000-4000-8000-000000000001";
const HOST: string = "esx01.acme.example";
const EXTERNAL_ID: string = `host/dc-east/${HOST}`;
const BASE: string = `/dashboard/${PROJECT_ID}/vmware/${VCENTER_ID}`;
const GIB: number = 1024 * 1024 * 1024;

interface ListRequest {
  modelName: string;
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
}

interface AggregateRequest {
  name: string;
  attributes: Record<string, unknown>;
  aggregationType: string;
  groupByAttributeKeys: Array<string> | undefined;
}

const mockListRequests: Array<ListRequest> = [];
const mockAggregateRequests: Array<AggregateRequest> = [];
let mockVCenter: Record<string, unknown> | null = null;
let mockVCenterError: Error | null = null;
let mockHostRow: Record<string, unknown> | null = null;
let mockVirtualMachines: Array<Record<string, unknown>> = [];
let mockIncidents: Array<Record<string, unknown>> = [];
let mockAlerts: Array<Record<string, unknown>> = [];
let mockDeniedModels: Array<string> = [];
let mockSeries: Record<string, Array<Record<string, unknown>>> = {};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: new () => { tableName?: string };
      }): Promise<unknown> => {
        if (mockVCenterError) {
          return Promise.reject(mockVCenterError);
        }
        const Model: new () => { tableName?: string } = request.modelType;
        return Promise.resolve(
          mockVCenter ? Object.assign(new Model(), mockVCenter) : null,
        );
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
        query: Record<string, unknown>;
        select?: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "unknown";
        mockListRequests.push({
          modelName,
          query: request.query,
          select: request.select,
        });

        if (mockDeniedModels.includes(modelName)) {
          return Promise.reject(new Error(`No access to ${modelName}.`));
        }

        let records: Array<Record<string, unknown>> = [];

        if (modelName === "VMwareResource") {
          records =
            request.query["kind"] === "Host"
              ? mockHostRow
                ? [mockHostRow]
                : []
              : mockVirtualMachines;
        } else if (modelName === "Incident") {
          records = mockIncidents;
        } else if (modelName === "Alert") {
          records = mockAlerts;
        }

        const data: Array<{ tableName?: string }> = records.map(
          (record: Record<string, unknown>): { tableName?: string } => {
            return Object.assign(new Model(), record);
          },
        );

        return Promise.resolve({ data, count: data.length });
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
      aggregate: (request: {
        aggregateBy: {
          query: Record<string, unknown>;
          aggregationType: string;
          groupByAttributeKeys?: Array<string>;
        };
      }): Promise<unknown> => {
        const name: string = String(request.aggregateBy.query["name"]);
        mockAggregateRequests.push({
          name,
          attributes: request.aggregateBy.query["attributes"] as Record<
            string,
            unknown
          >,
          aggregationType: request.aggregateBy.aggregationType,
          groupByAttributeKeys: request.aggregateBy.groupByAttributeKeys,
        });
        return Promise.resolve({ data: mockSeries[name] || [] });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([
            {
              id: {
                toString: () => {
                  return "50000000-0000-4000-8000-000000000001";
                },
              },
            },
          ]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([
          {
            id: {
              toString: () => {
                return "51000000-0000-4000-8000-000000000001";
              },
            },
          },
        ]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        title: string;
        series: Array<{ seriesName: string; data: Array<unknown> }>;
        loading?: boolean;
      }): React.ReactElement => {
        return (
          <div
            data-testid="chart"
            data-title={props.title}
            data-loading={props.loading ? "true" : "false"}
          >
            {props.series.map(
              (series: {
                seriesName: string;
                data: Array<unknown>;
              }): React.ReactElement => {
                return (
                  <span
                    key={series.seriesName}
                    data-testid="chart-series"
                    data-name={series.seriesName}
                    data-points={series.data.length}
                  />
                );
              },
            )}
          </div>
        );
      },
    };
  },
);

const mockLogsViewerProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        mockLogsViewerProps.push(props);
        return (
          <div data-testid="logs-viewer">
            {props["emptyContentWhenUnfiltered"] as React.ReactElement}
          </div>
        );
      },
    };
  },
);

const mockMetricsTabProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        mockMetricsTabProps.push(props);
        return <div data-testid="metrics-tab" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        descriptor: { resourceType: string };
        resourceId: { toString: () => string };
      }): React.ReactElement => {
        return (
          <div
            data-testid="ai-agent-card"
            data-resource-type={props.descriptor.resourceType}
            data-resource-id={props.resourceId.toString()}
          />
        );
      },
    };
  },
);

import HostDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/HostDetail";
import { getCpuBarColor } from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import { keyForVMwareVCenter } from "../../../Utils/Telemetry/EntityKey";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

function hostRow(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: "40000000-0000-4000-8000-000000000001",
    kind: "Host",
    externalId: EXTERNAL_ID,
    name: HOST,
    hostName: HOST,
    datacenterName: "dc-east",
    clusterName: "prod-cluster",
    cpuCapacityMhz: 76800,
    maxMemoryBytes: 512 * GIB,
    latestCpuPercent: 41.6,
    metricsUpdatedAt: minutesAgo(2),
    lastSeenAt: minutesAgo(2),
    ...fields,
  };
}

function vm(
  number: number,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    _id: `41000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    kind: "VirtualMachine",
    externalId: `vm/uuid-${number}`,
    hostName: HOST,
    datacenterName: "dc-east",
    clusterName: "prod-cluster",
    resourcePoolName: "Resources",
    isTemplate: false,
    metricsUpdatedAt: minutesAgo(2),
    lastSeenAt: minutesAgo(2),
    ...fields,
  };
}

const VIRTUAL_MACHINES: Array<Record<string, unknown>> = [
  vm(1, {
    name: "db-primary",
    isPoweredOn: true,
    latestCpuPercent: 78.4,
    latestMemoryBytes: 58 * GIB,
    maxMemoryBytes: 64 * GIB,
    cpuReadinessPercent: 12.4,
  }),
  vm(2, { name: "web-01", isPoweredOn: true, latestCpuPercent: 31.9 }),
  vm(3, { name: "legacy-app", isPoweredOn: false }),
  vm(4, { name: "ubuntu-24-template", isTemplate: true }),
];

// Two buckets, and per device for the per-device reads.
function reportingSeries(): Record<string, Array<Record<string, unknown>>> {
  const at: (minutes: number) => Date = minutesAgo;
  return {
    "vcenter.host.cpu.utilization": [
      { timestamp: at(10), value: 80 },
      { timestamp: at(2), value: 40 },
    ],
    "vcenter.host.memory.utilization": [{ timestamp: at(2), value: 61.5 }],
    "vcenter.host.network.throughput": [
      {
        timestamp: at(2),
        value: 20480,
        attributes: { object: "", direction: "received" },
      },
      {
        timestamp: at(2),
        value: 10240,
        attributes: { object: "", direction: "transmitted" },
      },
      {
        timestamp: at(2),
        value: 15000,
        attributes: { object: "vmnic0", direction: "received" },
      },
      {
        timestamp: at(2),
        value: 5000,
        attributes: { object: "vmnic1", direction: "received" },
      },
    ],
    "vcenter.host.network.packet.error.rate": [
      {
        timestamp: at(2),
        value: 0.4,
        attributes: { object: "vmnic1", direction: "received" },
      },
    ],
    "vcenter.host.disk.throughput": [
      // 976.5625 KiB/s is exactly 1 MB/s.
      {
        timestamp: at(2),
        value: 976.5625,
        attributes: { object: "naa.600508b1", direction: "read" },
      },
    ],
    "vcenter.host.disk.latency.avg": [
      {
        timestamp: at(2),
        value: 57.4,
        attributes: { object: "naa.600508b1", direction: "write" },
      },
    ],
    "vcenter.host.disk.latency.max": [
      { timestamp: at(3), value: 12, attributes: { object: "" } },
      { timestamp: at(2), value: 44.8, attributes: { object: "" } },
    ],
  };
}

function openHostPage(externalId: string = EXTERNAL_ID): void {
  window.history.pushState(
    {},
    "",
    `${BASE}/hosts/${encodeURIComponent(externalId)}`,
  );
}

async function renderPage(): Promise<void> {
  render(<HostDetail {...PAGE_PROPS} />);
  await screen.findByTestId("vmware-host-hero");
  // Let the Overview's reads land.
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByTestId("vmware-host-tiles")).toBeInTheDocument();
  });
}

function tile(title: string): HTMLElement {
  const tiles: HTMLElement = screen.getByTestId("vmware-host-tiles");
  const label: HTMLElement = within(tiles).getAllByText(title)[0]!;
  return label.closest("div.rounded-xl") as HTMLElement;
}

function chart(title: string): HTMLElement {
  return screen.getAllByTestId("chart").find((element: HTMLElement) => {
    return element.getAttribute("data-title") === title;
  })!;
}

function seriesOf(title: string): Array<[string, number]> {
  return within(chart(title))
    .queryAllByTestId("chart-series")
    .map((series: HTMLElement): [string, number] => {
      return [
        series.getAttribute("data-name") || "",
        Number(series.getAttribute("data-points")),
      ];
    });
}

beforeEach(() => {
  mockListRequests.length = 0;
  mockAggregateRequests.length = 0;
  mockLogsViewerProps.length = 0;
  mockMetricsTabProps.length = 0;
  mockVCenter = {
    _id: VCENTER_ID,
    name: "vcenter-prod",
    collectionMethod: "Agent",
  };
  mockVCenterError = null;
  mockHostRow = hostRow();
  mockVirtualMachines = VIRTUAL_MACHINES;
  mockIncidents = [];
  mockAlerts = [];
  mockDeniedModels = [];
  mockSeries = reportingSeries();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  openHostPage();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("the hero says which host this is and whether vCenter still reports it", () => {
  test("a reporting host in a cluster: its name, status, place, capacity and VMs", async () => {
    await renderPage();

    const hero: HTMLElement = screen.getByTestId("vmware-host-hero");
    expect(hero).toHaveAttribute("data-report-state", "Reporting");
    expect(within(hero).getByTestId("vmware-host-name")).toHaveTextContent(
      HOST,
    );
    expect(within(hero).getByTestId("vmware-host-status")).toHaveTextContent(
      "Reporting",
    );
    expect(within(hero).getByTestId("vmware-host-location")).toHaveTextContent(
      "ESXi host in cluster prod-cluster, datacenter dc-east",
    );
    /*
     * "Last reported", in the status's own words; the exact time is the
     * line's title.
     */
    const lastReported: HTMLElement = within(hero).getByTestId(
      "vmware-host-last-seen",
    );
    expect(lastReported).toHaveTextContent(/^Last reported 2 minutes ago$/);
    expect(lastReported.getAttribute("title") || "").not.toBe("");
    expect(hero).not.toHaveTextContent("Last seen");
    expect(within(hero).getByTestId("vmware-host-chips")).toHaveTextContent(
      "76.80 GHz CPU512 GiB memory3 VMs, 2 running",
    );
    // The cluster is a link to the cluster's own page.
    const cluster: HTMLElement = within(hero).getByText("prod-cluster");
    expect(cluster.closest("a")).toHaveAttribute(
      "href",
      `${BASE}/clusters/${encodeURIComponent("cluster/dc-east/prod-cluster")}`,
    );
    // Reporting needs no notice.
    expect(screen.queryByTestId("vmware-host-report-notice")).toBeNull();
  });

  test("a standalone host says so, with no cluster to link", async () => {
    mockHostRow = hostRow({ clusterName: undefined });
    await renderPage();

    expect(screen.getByTestId("vmware-host-location")).toHaveTextContent(
      "Standalone ESXi host in datacenter dc-east",
    );
    expect(
      within(screen.getByTestId("vmware-host-detail-cluster")).getByText(
        "None - a standalone host",
      ),
    ).toBeInTheDocument();
  });

  test("not reporting: the notice says since when, and where to look", async () => {
    mockHostRow = hostRow({ metricsUpdatedAt: minutesAgo(120) });
    mockSeries = {};
    await renderPage();

    expect(screen.getByTestId("vmware-host-hero")).toHaveAttribute(
      "data-report-state",
      "NotReporting",
    );
    expect(screen.getByTestId("vmware-host-status")).toHaveTextContent(
      "Not reporting",
    );
    const notice: HTMLElement = screen.getByTestId("vmware-host-report-notice");
    expect(notice).toHaveTextContent(
      "vCenter last reported this host 2 hours ago",
    );
    expect(
      within(notice).getByText("Check the vCenter").closest("a"),
    ).toHaveAttribute("href", BASE);
    // Said once: the notice opens with the time, the hero leaves it out.
    expect(screen.queryByTestId("vmware-host-last-seen")).toBeNull();
  });

  test("no data yet: listed, but no metrics; the notice says they are coming", async () => {
    mockHostRow = hostRow({ metricsUpdatedAt: undefined });
    mockSeries = {};
    await renderPage();

    expect(screen.getByTestId("vmware-host-status")).toHaveTextContent(
      "No data yet",
    );
    expect(screen.getByTestId("vmware-host-report-notice")).toHaveTextContent(
      "Waiting for this host's first metrics",
    );
  });

  test("not in the inventory: no guesses about its cluster, and the way back to the hosts", async () => {
    mockHostRow = null;
    mockVirtualMachines = [];
    mockSeries = {};
    await renderPage();

    expect(screen.getByTestId("vmware-host-hero")).toHaveAttribute(
      "data-report-state",
      "NotInInventory",
    );
    expect(screen.getByTestId("vmware-host-name")).toHaveTextContent(HOST);
    expect(screen.getByTestId("vmware-host-location")).toHaveTextContent(
      "ESXi host in datacenter dc-east",
    );
    expect(screen.getByTestId("vmware-host-location")).not.toHaveTextContent(
      "Standalone",
    );
    expect(screen.queryByTestId("vmware-host-last-seen")).toBeNull();
    const notice: HTMLElement = screen.getByTestId("vmware-host-report-notice");
    expect(notice).toHaveTextContent(
      "This host is not in the vCenter's inventory",
    );
    /*
     * The page opens on 30 minutes, where it has no data: the notice says
     * where its earlier metrics are, not that they are below.
     */
    expect(notice).toHaveTextContent(
      "Its earlier metrics are kept: pick a longer time range to see them.",
    );
    expect(notice).not.toHaveTextContent("still below");
    expect(
      within(notice).getByText("See all hosts").closest("a"),
    ).toHaveAttribute("href", `${BASE}/hosts`);
    // Its earlier metrics are still read, by the name its address gives.
    expect(mockAggregateRequests.length).toBeGreaterThan(0);
    expect(mockAggregateRequests[0]!.attributes).toEqual({
      "resource.vmware.vcenter.name": "vcenter-prod",
      "resource.vcenter.datacenter.name": "dc-east",
      "resource.vcenter.host.name": HOST,
    });
    expect(screen.queryByTestId("vmware-host-detail-cluster")).toBeNull();
  });
});

describe("what the Overview reads for one host", () => {
  test("nine metric reads, every one filtered to this host's identity", async () => {
    await renderPage();

    expect(
      mockAggregateRequests.map((request: AggregateRequest): string => {
        return request.name;
      }),
    ).toEqual([
      "vcenter.host.cpu.utilization",
      "vcenter.host.memory.utilization",
      "vcenter.host.network.throughput",
      "vcenter.host.network.packet.rate",
      "vcenter.host.network.packet.error.rate",
      "vcenter.host.network.packet.drop.rate",
      "vcenter.host.disk.throughput",
      "vcenter.host.disk.latency.avg",
      "vcenter.host.disk.latency.max",
    ]);

    for (const request of mockAggregateRequests) {
      expect(request.attributes).toEqual({
        "resource.vmware.vcenter.name": "vcenter-prod",
        "resource.vcenter.datacenter.name": "dc-east",
        "resource.vcenter.host.name": HOST,
      });
    }

    const perDevice: Array<string> = mockAggregateRequests
      .filter((request: AggregateRequest): boolean => {
        return Boolean(request.groupByAttributeKeys);
      })
      .map((request: AggregateRequest): string => {
        return request.name;
      });
    expect(perDevice).toHaveLength(7);
    expect(perDevice).not.toContain("vcenter.host.cpu.utilization");
  });

  test("the host's VMs are read by its name and datacenter, nothing else", async () => {
    /*
     * The page cannot tell another host's VM from its own once it has the
     * rows, so the read itself must carry the scope.
     */
    await renderPage();

    const vmRead: ListRequest | undefined = mockListRequests.find(
      (request: ListRequest): boolean => {
        return (
          request.modelName === "VMwareResource" &&
          request.query["kind"] === "VirtualMachine"
        );
      },
    );
    expect(vmRead?.query["hostName"]).toBe(HOST);
    expect(vmRead?.query["datacenterName"]).toBe("dc-east");
    expect(String(vmRead?.query["vmwareVCenterId"])).toBe(VCENTER_ID);

    const hostRead: ListRequest | undefined = mockListRequests.find(
      (request: ListRequest): boolean => {
        return (
          request.modelName === "VMwareResource" &&
          request.query["kind"] === "Host"
        );
      },
    );
    expect(hostRead?.query["externalId"]).toBe(EXTERNAL_ID);
  });
});

describe("the tiles", () => {
  test("CPU, memory, the slowest disk and network, from the last minutes of the range", async () => {
    await renderPage();

    expect(tile("CPU")).toHaveTextContent("40.0%");
    expect(tile("CPU")).toHaveTextContent("of 76.80 GHz");
    expect(tile("Memory")).toHaveTextContent("61.5%");
    expect(tile("Memory")).toHaveTextContent("of 512 GiB");
    expect(tile("Disk latency")).toHaveTextContent("44.8 ms");
    expect(tile("Disk latency")).toHaveTextContent("slowest disk");
    // 20 MiB/s in + 10 MiB/s out of the host's own totals.
    expect(tile("Network")).toHaveTextContent("31.5 MB/s");
  });

  test("no metrics: every tile reads a dash, not zero", async () => {
    mockSeries = {};
    await renderPage();

    for (const title of ["CPU", "Memory", "Disk latency", "Network"]) {
      expect(tile(title)).toHaveTextContent("—");
    }
    /*
     * ...and only a dash: "— of 76.80 GHz" read as a value missing its
     * number (the hero's chips still give the host's size).
     */
    expect(tile("CPU")).not.toHaveTextContent("of 76.80 GHz");
    expect(tile("Memory")).not.toHaveTextContent("of 512 GiB");
    expect(tile("Disk latency")).not.toHaveTextContent("slowest disk");
    expect(screen.getByTestId("vmware-host-chips")).toHaveTextContent(
      "76.80 GHz CPU",
    );
  });
});

describe("the charts", () => {
  test("each chart is fed this host's series", async () => {
    await renderPage();

    expect(seriesOf("CPU")).toEqual([["CPU", 2]]);
    expect(seriesOf("Memory")).toEqual([["Memory", 1]]);
    expect(seriesOf("Disk latency")).toEqual([["Slowest disk", 2]]);
    expect(seriesOf("Network")).toEqual([
      ["Received", 1],
      ["Sent", 1],
    ]);
  });

  test("a chart with nothing to draw is fed nothing (it shows its own empty state)", async () => {
    mockSeries = {};
    await renderPage();

    for (const title of ["CPU", "Memory", "Disk latency", "Network"]) {
      expect(seriesOf(title)).toEqual([]);
      expect(chart(title)).toHaveAttribute("data-loading", "false");
    }
  });
});

describe("the cards", () => {
  test("the busiest running VMs, busiest first, each a link to its page", async () => {
    await renderPage();

    const card: HTMLElement = screen.getByTestId("vmware-host-busiest-vms");
    const rows: Array<HTMLElement> = within(card).getAllByTestId(
      "vmware-host-busy-vm",
    );
    expect(
      rows.map((row: HTMLElement): string => {
        return within(row).getByRole("link").textContent || "";
      }),
    ).toEqual(["db-primary", "web-01"]);
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
      "href",
      `${BASE}/virtual-machines/${encodeURIComponent("vm/uuid-1")}`,
    );
    expect(
      within(rows[0]!).getByTestId("vmware-host-busy-vm-cpu-ready"),
    ).toHaveTextContent("CPU Ready 12.4%");
    // A screen reader hears what the percentage is.
    expect(rows[0]).toHaveTextContent("CPU 78.4%");

    /*
     * "View all" is the line under the list, not a header button whose
     * long label squeezed the title beside the side menu.
     */
    expect(within(card).queryByTestId("card-button")).toBeNull();
    expect(
      within(within(card).getByTestId("vmware-host-busiest-vms-all")).getByRole(
        "button",
        { name: "View all 3 virtual machines" },
      ),
    ).toBeInTheDocument();
  });

  test("a VM's CPU bar is coloured as its row in the Virtual Machines tab colours it", async () => {
    await renderPage();

    const bars: Array<string> = within(
      screen.getByTestId("vmware-host-busiest-vms"),
    )
      .getAllByTestId("vmware-host-busy-vm")
      .map((row: HTMLElement): string => {
        const bar: Element | null = row.querySelector(
          "div.h-1\\.5.rounded-full[style]",
        );
        return bar?.className || "";
      });

    // 78.4% and 31.9%: the VM list's thresholds (60 and 80), not 70 and 90.
    expect(bars[0]).toContain(getCpuBarColor(78.4));
    expect(getCpuBarColor(78.4)).toBe("bg-yellow-500");
    expect(bars[1]).toContain(getCpuBarColor(31.9));
    expect(getCpuBarColor(31.9)).toBe("bg-green-500");
  });

  test("a host that runs no VM has no busiest list", async () => {
    mockVirtualMachines = [];
    await renderPage();

    expect(screen.queryByTestId("vmware-host-busiest-vms")).toBeNull();
  });

  test("the network adapters and storage devices, the host totals left out", async () => {
    await renderPage();

    const adapters: HTMLElement = screen.getByTestId(
      "vmware-host-network-adapters",
    );
    expect(
      within(adapters)
        .getAllByTestId("vmware-host-network-adapter")
        .map((row: HTMLElement): string => {
          return (row as HTMLTableRowElement).cells[0]!.textContent || "";
        }),
    ).toEqual(["vmnic0", "vmnic1"]);
    expect(
      within(adapters).getAllByTestId("vmware-host-trouble-rate").length,
    ).toBeGreaterThan(0);

    const devices: HTMLElement = screen.getByTestId(
      "vmware-host-storage-devices",
    );
    const device: HTMLElement = within(devices).getAllByTestId(
      "vmware-host-storage-device",
    )[0]!;
    expect(device).toHaveTextContent("naa.600508b1");
    expect(device).toHaveTextContent("1 MB/s");
    expect(
      within(device).getByTestId("vmware-host-latency-danger"),
    ).toHaveTextContent("57.4 ms");
  });

  test("each device table is a list of its own below xl, where a table ran past a card beside the side menu", async () => {
    await renderPage();

    for (const [cardTestId, rowTestId] of [
      ["vmware-host-network-adapters", "vmware-host-network-adapter"],
      ["vmware-host-storage-devices", "vmware-host-storage-device"],
    ] as Array<[string, string]>) {
      const card: HTMLElement = screen.getByTestId(cardTestId);
      const table: HTMLTableElement = card.querySelector(
        "table",
      ) as HTMLTableElement;
      // The table's ruled body: div.max-xl:hidden > div.overflow-x-auto.
      const tableBody: HTMLElement = table.parentElement!
        .parentElement as HTMLElement;
      const list: HTMLElement = within(card).getByTestId(`${rowTestId}-list`);

      expect(tableBody.className.split(" ")).toContain("max-xl:hidden");
      expect(list.className.split(" ")).toContain("xl:hidden");
      // Not the phone-only switch: at md the card is under 500px wide.
      expect(card.innerHTML).not.toContain("max-sm:hidden");
      expect(list.className.split(" ")).not.toContain("sm:hidden");
      // Each device's values wrap into as many columns as fit.
      expect(list.querySelector("dl")?.className || "").toContain(
        "grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]",
      );
    }
  });

  test("a vCenter that reports no per-device counters has no device tables", async () => {
    mockSeries = {
      "vcenter.host.cpu.utilization":
        reportingSeries()["vcenter.host.cpu.utilization"]!,
    };
    await renderPage();

    expect(screen.queryByTestId("vmware-host-network-adapters")).toBeNull();
    expect(screen.queryByTestId("vmware-host-storage-devices")).toBeNull();
  });

  test("the details: who the host is to vCenter and its size, laid out as every detail card is", async () => {
    await renderPage();

    const details: HTMLElement = screen.getByTestId("vmware-host-details");

    // Detail's grid: one column on a phone, two from sm, three from lg.
    const grid: HTMLElement = details.querySelector("dl") as HTMLElement;
    expect(grid.className.split(" ")).toEqual(
      expect.arrayContaining(["grid", "grid-cols-1", "sm:grid-cols-2"]),
    );
    expect(grid.className.split(" ")).toContain("lg:grid-cols-3");

    /*
     * The names a reader pastes elsewhere copy in one click: the host
     * name and the inventory id, nothing else.
     */
    const copyable: Array<string> = within(details)
      .getAllByTestId("vmware-host-detail-copy")
      .map((button: HTMLElement): string => {
        return (
          button
            .closest(
              "[data-testid^='vmware-host-detail-']:not([data-testid='vmware-host-detail-copy'])",
            )
            ?.getAttribute("data-testid") || ""
        );
      });
    expect(copyable).toEqual([
      "vmware-host-detail-host",
      "vmware-host-detail-inventory-id",
    ]);

    // When vCenter last reported the host is the hero's line, not a row.
    expect(
      within(details).queryByTestId("vmware-host-detail-metrics-updated"),
    ).toBeNull();
    expect(details).not.toHaveTextContent("Metrics updated");
    expect(
      within(details).getByTestId("vmware-host-detail-host"),
    ).toHaveTextContent(HOST);
    expect(
      within(details).getByTestId("vmware-host-detail-vcenter"),
    ).toHaveTextContent("vcenter-prod");
    expect(
      within(details).getByTestId("vmware-host-detail-datacenter"),
    ).toHaveTextContent("dc-east");
    expect(
      within(details).getByTestId("vmware-host-detail-cpu"),
    ).toHaveTextContent("76.80 GHz");
    expect(
      within(details).getByTestId("vmware-host-detail-memory"),
    ).toHaveTextContent("512 GiB");
    expect(
      within(details).getByTestId("vmware-host-detail-vms"),
    ).toHaveTextContent("3 (2 running, 1 off)");
    expect(
      within(details).getByTestId("vmware-host-detail-templates"),
    ).toHaveTextContent("1");
    expect(
      within(details).getByTestId("vmware-host-detail-inventory-id"),
    ).toHaveTextContent(EXTERNAL_ID);
  });

  test("the vCenter's AI agent card closes the page", async () => {
    await renderPage();

    const card: HTMLElement = screen.getByTestId("ai-agent-card");
    expect(card).toHaveAttribute("data-resource-type", "VMwareVCenter");
    expect(card).toHaveAttribute("data-resource-id", VCENTER_ID);
  });
});

describe("what is open on the host, and the alerts that watch it", () => {
  test("the open incident and alert that name this host, each a link; another host's left out", async () => {
    mockIncidents = [
      {
        _id: "60000000-0000-4000-8000-000000000001",
        title: "[VMware] Host CPU Saturation (>90%) - vcenter-prod",
        incidentNumber: 7,
        createdAt: minutesAgo(11),
        seriesLabels: { "resource.vcenter.host.name": HOST },
      },
      {
        _id: "60000000-0000-4000-8000-000000000002",
        title: "Another host's incident",
        createdAt: minutesAgo(3),
        seriesLabels: { "resource.vcenter.host.name": "esx02.acme.example" },
      },
    ];
    mockAlerts = [
      {
        _id: "61000000-0000-4000-8000-000000000001",
        title: "[VMware] Host Network Packet Errors - vcenter-prod",
        alertNumber: 3,
        createdAt: minutesAgo(4),
        seriesLabels: { "resource.vcenter.host.name": HOST },
      },
    ];
    await renderPage();

    const card: HTMLElement = await screen.findByTestId(
      "vmware-host-open-events",
    );
    const rows: Array<HTMLElement> = within(card).getAllByTestId(
      "vmware-host-open-event",
    );
    // The incident first, though the alert is newer.
    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-kind");
      }),
    ).toEqual(["Incident", "Alert"]);
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/incidents/60000000-0000-4000-8000-000000000001`,
    );
    expect(within(rows[1]!).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/alerts/61000000-0000-4000-8000-000000000001`,
    );
    expect(rows[0]).toHaveTextContent("Incident · #7");
    expect(card).not.toHaveTextContent("Another host's incident");
  });

  test("nothing open: no card", async () => {
    await renderPage();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("vmware-host-open-events")).toBeNull();
  });

  test("a role that may not read incidents still sees the host's alerts", async () => {
    mockDeniedModels = ["Incident"];
    mockAlerts = [
      {
        _id: "61000000-0000-4000-8000-000000000001",
        title: "Host alert",
        createdAt: minutesAgo(4),
        seriesLabels: { "resource.vcenter.host.name": HOST },
      },
    ];
    await renderPage();

    const card: HTMLElement = await screen.findByTestId(
      "vmware-host-open-events",
    );
    expect(within(card).getAllByTestId("vmware-host-open-event")).toHaveLength(
      1,
    );
  });

  test("the host alerts: none on, and one link that ticks all five on the Recommendations page", async () => {
    await renderPage();

    const card: HTMLElement = await screen.findByTestId("vmware-host-alerts");
    expect(within(card).getAllByTestId("vmware-host-alert")).toHaveLength(5);
    const turnOn: HTMLElement = within(card).getByTestId(
      "vmware-host-alerts-turn-on",
    );
    expect(turnOn).toHaveTextContent("Turn on 5 alerts");

    const href: string = turnOn.getAttribute("href") || "";
    const url: URL = new URL(href, "https://oneuptime.example");
    expect(url.pathname).toBe(`${BASE}/recommendations`);
    expect((url.searchParams.get("select") || "").split(",")).toEqual([
      "VMware:vmware-host-cpu-saturation",
      "VMware:vmware-host-memory-saturation",
      "VMware:vmware-host-disk-latency-high",
      "VMware:vmware-host-network-packet-errors",
      "VMware:vmware-host-network-packet-drops",
    ]);
  });

  test("a role that may not read monitors does not see the host alerts card at all", async () => {
    mockDeniedModels = ["Monitor"];
    await renderPage();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("vmware-host-alerts")).toBeNull();
    // The rest of the page is unaffected.
    expect(screen.getByTestId("vmware-host-details")).toBeInTheDocument();
  });
});

describe("the tabs", () => {
  test("Overview, Virtual Machines with its count, Metrics and Logs", async () => {
    await renderPage();

    /*
     * The VMs, templates left out: the 3 the hero and "View all 3 virtual
     * machines" give, as the vCenter's side menu counts them - not 4.
     */
    expect(
      screen.getAllByRole("tab").map((tab: HTMLElement): string => {
        return (tab.textContent || "").trim();
      }),
    ).toEqual(["Overview", "Virtual Machines3", "Metrics", "Logs"]);
    expect(screen.getByTestId("vmware-host-chips")).toHaveTextContent(
      "3 VMs, 2 running",
    );
  });

  test("a host with only templates shows no count on its Virtual Machines tab", async () => {
    mockVirtualMachines = [
      VIRTUAL_MACHINES.find((row: Record<string, unknown>): boolean => {
        return row["isTemplate"] === true;
      })!,
    ];
    await renderPage();

    expect(
      (
        screen.getByRole("tab", { name: /^Virtual Machines/ }).textContent || ""
      ).trim(),
    ).toBe("Virtual Machines");
  });

  test("View all virtual machines opens the Virtual Machines tab with every VM on the host", async () => {
    await renderPage();

    fireEvent.click(
      within(screen.getByTestId("vmware-host-busiest-vms")).getByRole(
        "button",
        { name: "View all 3 virtual machines" },
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("ubuntu-24-template")).toBeInTheDocument();
    });
    for (const name of ["db-primary", "web-01", "legacy-app"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Status already says Running / Powered off / Template.
    expect(screen.queryByText("Power State")).toBeNull();
    expect(screen.queryByTestId("vmware-host-tiles")).toBeNull();
  });

  test("Metrics: every host chart, filtered to this host", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await screen.findByTestId("metrics-tab");

    const queryConfigs: Array<{
      metricQueryData: {
        filterData: { metricName: string; attributes: Record<string, string> };
      };
    }> = mockMetricsTabProps[mockMetricsTabProps.length - 1]![
      "queryConfigs"
    ] as Array<{
      metricQueryData: {
        filterData: { metricName: string; attributes: Record<string, string> };
      };
    }>;

    expect(
      queryConfigs.map(
        (config: {
          metricQueryData: { filterData: { metricName: string } };
        }): string => {
          return config.metricQueryData.filterData.metricName;
        },
      ),
    ).toEqual([
      "vcenter.host.cpu.utilization",
      "vcenter.host.memory.usage",
      "vcenter.host.network.throughput",
      "vcenter.host.disk.throughput",
      "vcenter.host.disk.latency.max",
      "vcenter.host.network.packet.error.rate",
      "vcenter.host.network.packet.drop.rate",
    ]);
    for (const config of queryConfigs) {
      expect(config.metricQueryData.filterData.attributes).toEqual({
        "resource.vmware.vcenter.name": "vcenter-prod",
        "resource.vcenter.datacenter.name": "dc-east",
        "resource.vcenter.host.name": HOST,
      });
    }
  });

  test("Logs: the vCenter's syslog from this host, and how to send it while there is none", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    await screen.findByTestId("logs-viewer");

    const props: Record<string, unknown> =
      mockLogsViewerProps[mockLogsViewerProps.length - 1]!;
    expect(
      (props["logQuery"] as { attributes: Record<string, string> }).attributes,
    ).toEqual({
      "resource.vmware.vcenter.name": "vcenter-prod",
      hostname: HOST,
    });
    expect(props["entityScope"]).toEqual({
      entityKeys: [keyForVMwareVCenter(PROJECT_ID, "vcenter-prod")],
      attributeKey: "resource.vmware.vcenter.name",
      attributeValue: "vcenter-prod",
    });
    expect(props["attributeFilterDisplayKeys"]).toEqual({
      "resource.vmware.vcenter.name": "vCenter",
      hostname: "Host",
    });

    const setup: HTMLElement = screen.getByTestId("vmware-host-logs-setup");
    expect(
      within(setup).getByTestId("vmware-host-logs-esxcli"),
    ).toHaveTextContent(
      "esxcli system syslog config set --loghost='udp://<agent-host>:5514'",
    );
    expect(
      within(setup).getByTestId("vmware-host-logs-powercli"),
    ).toHaveTextContent(`Get-VMHost -Name '${HOST}'`);
    expect(
      within(setup).getByTestId("vmware-host-logs-powercli-cluster"),
    ).toHaveTextContent("Get-Cluster -Name 'prod-cluster'");
    expect(
      within(setup).getByText("Open the setup guide").closest("a"),
    ).toHaveAttribute("href", `${BASE}/documentation`);
    expect(
      within(setup).getByTestId("vmware-host-logs-name-hint"),
    ).toHaveTextContent("esxcli system hostname get");
  });

  test("Logs on a standalone host: no cluster command", async () => {
    mockHostRow = hostRow({ clusterName: undefined });
    await renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    await screen.findByTestId("vmware-host-logs-setup");

    expect(
      screen.queryByTestId("vmware-host-logs-powercli-cluster"),
    ).toBeNull();
  });

  test("Logs on a vCenter a probe collects: why there are none, and no commands", async () => {
    mockVCenter = { ...mockVCenter, collectionMethod: "Probe" };
    await renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    const probe: HTMLElement = await screen.findByTestId(
      "vmware-host-logs-probe",
    );

    expect(probe).toHaveTextContent("A probe collects this vCenter");
    expect(screen.queryByTestId("vmware-host-logs-setup")).toBeNull();
    expect(
      within(probe).getByText("Probe or agent?").closest("a"),
    ).toHaveAttribute(
      "href",
      "/docs/telemetry/vmware-agentless#probe-or-agent",
    );
  });
});

describe("refreshing and failing", () => {
  test("Refresh reads the metrics and the inventory again", async () => {
    await renderPage();

    const metricReads: number = mockAggregateRequests.length;
    const inventoryReads: number = mockListRequests.filter(
      (request: ListRequest): boolean => {
        return request.modelName === "VMwareResource";
      },
    ).length;

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

    await waitFor(() => {
      expect(mockAggregateRequests.length).toBe(metricReads * 2);
    });
    await waitFor(() => {
      expect(
        mockListRequests.filter((request: ListRequest): boolean => {
          return request.modelName === "VMwareResource";
        }).length,
      ).toBe(inventoryReads * 2);
    });
  });

  test("a vCenter that cannot be read shows why", async () => {
    mockVCenterError = new Error(
      "You do not have permission to read vCenters.",
    );
    render(<HostDetail {...PAGE_PROPS} />);

    expect(
      await screen.findByText("You do not have permission to read vCenters."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("vmware-host-hero")).toBeNull();
  });

  test("a vCenter that is gone says so", async () => {
    mockVCenter = null;
    render(<HostDetail {...PAGE_PROPS} />);

    expect(await screen.findByText("vCenter not found.")).toBeInTheDocument();
  });
});
