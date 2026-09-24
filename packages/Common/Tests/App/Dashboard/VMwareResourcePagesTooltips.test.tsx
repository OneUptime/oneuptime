/**
 * @timezone UTC
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";

/*
 * The VMware detail pages (host, VM, datastore, cluster) and list pages
 * (hosts, VMs, datastores, clusters, resource pools), rendered for real
 * against a stubbed inventory. Every metric summary field and every metric
 * column header must carry an (i) with its own explanation; identity
 * fields (names, IDs, timestamps) and plain metadata columns must not.
 */

interface ListRequest {
  query: Record<string, unknown>;
}

const mockGetListCalls: Array<ListRequest> = [];
let mockVCenter: unknown = null;
let mockRowsByKind: Record<string, Array<unknown>> = {};
let mockAggregateData: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve(mockVCenter);
      },
      getList: (request: ListRequest): Promise<unknown> => {
        mockGetListCalls.push(request);
        const rows: Array<unknown> =
          mockRowsByKind[String(request.query["kind"])] || [];
        return Promise.resolve({ data: rows, count: rows.length });
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: mockAggregateData });
      },
    },
  };
});

// The Metrics tab is not the subject here, and it is not the open tab.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "metrics-tab" });
      },
    };
  },
);

import HostDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/HostDetail";
import VirtualMachineDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/VirtualMachineDetail";
import DatastoreDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/DatastoreDetail";
import ClusterDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/ClusterDetail";
import HostsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Hosts";
import VirtualMachinesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/VirtualMachines";
import DatastoresPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Datastores";
import ClustersPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/Clusters";
import ResourcePoolsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/ResourcePools";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  VMWARE_METRIC_DESCRIPTIONS,
  VMwareMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/VMwareMetricDescriptions";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  GIB,
  explainedLabels,
  explanationOnFocus,
  expectNotNested,
  infoButtons,
  infoButtonsFor,
  infoLabels,
  inventoryRow,
  vcenterModel,
} from "./VMwareTooltipHarness";

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const VCENTER_ID: string = "11111111-1111-4111-8111-111111111111";
const BASE: string = `/dashboard/${PROJECT_ID}/vmware/${VCENTER_ID}`;

const D: Record<VMwareMetric, string> = VMWARE_METRIC_DESCRIPTIONS;
const MIB: number = 1024 * 1024;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

function openAt(pathname: string): void {
  window.history.pushState({}, "", pathname);
}

function detailUrl(segment: string, externalId: string): string {
  return `${BASE}/${segment}/${encodeURIComponent(externalId)}`;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGetListCalls.length = 0;
  mockVCenter = vcenterModel();
  mockRowsByKind = {};
  mockAggregateData = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.pushState({}, "", "/");
});

/*
 * The labels of a detail page's summary cards that carry NO (i): identity
 * and timestamp fields, which need no explanation.
 */
function expectNoInfoOn(titles: Array<string>): void {
  for (const title of titles) {
    expect({ title, buttons: infoButtonsFor(title).length }).toEqual({
      title,
      buttons: 0,
    });
  }
}

async function waitForInfo(label: string): Promise<void> {
  await waitFor(() => {
    expect(infoButtonsFor(label).length).toBeGreaterThan(0);
  });
}

describe("VMware ESXi host detail", () => {
  const EXTERNAL_ID: string = "host/dc1/esx01";

  function host(fields: Record<string, unknown>): unknown {
    return inventoryRow({
      kind: "Host",
      externalId: EXTERNAL_ID,
      name: "esx01",
      datacenterName: "dc1",
      clusterName: "cl1",
      metricsUpdatedAt: new Date(),
      lastSeenAt: new Date(),
      ...fields,
    });
  }

  test("CPU and memory carry their explanations; identity fields do not", async () => {
    mockRowsByKind["Host"] = [
      host({
        latestCpuPercent: 37.5,
        latestCpuMhz: 12000,
        cpuCapacityMhz: 48000,
        latestMemoryBytes: 64 * GIB,
        maxMemoryBytes: 256 * GIB,
        latestMemoryPercent: 25,
      }),
    ];
    openAt(detailUrl("hosts", EXTERNAL_ID));

    render(<HostDetail {...PAGE_PROPS} />);
    await waitForInfo("CPU");

    expect(await explainedLabels()).toEqual([
      ["CPU", D.hostCpu],
      ["Memory (Used / Capacity)", D.hostMemory],
    ]);
    expect(
      screen.getByText("37.5% (12.00 GHz of 48.00 GHz)"),
    ).toBeInTheDocument();
    expectNoInfoOn([
      "Host Name",
      "vCenter",
      "Datacenter",
      "Cluster",
      "External ID",
      "Metrics Updated",
      "Last Seen",
    ]);
  });

  test("a host that reports capacity but no usage explains its CPU Capacity instead", async () => {
    mockRowsByKind["Host"] = [host({ cpuCapacityMhz: 48000 })];
    openAt(detailUrl("hosts", EXTERNAL_ID));

    render(<HostDetail {...PAGE_PROPS} />);
    await waitForInfo("CPU Capacity");

    expect(await explainedLabels()).toEqual([
      ["CPU Capacity", D.hostCpuCapacity],
    ]);
  });
});

describe("VMware virtual machine detail", () => {
  const EXTERNAL_ID: string = "vm/4210aaaa-bbbb-cccc-dddd-eeeeffff0001";

  function vm(fields: Record<string, unknown>): unknown {
    return inventoryRow({
      kind: "VirtualMachine",
      externalId: EXTERNAL_ID,
      name: "web-01",
      vmInstanceUuid: "4210aaaa-bbbb-cccc-dddd-eeeeffff0001",
      hostName: "esx01",
      clusterName: "cl1",
      datacenterName: "dc1",
      resourcePoolName: "Resources",
      isTemplate: false,
      metricsUpdatedAt: new Date(),
      lastSeenAt: new Date(),
      ...fields,
    });
  }

  test("a running VM under memory pressure explains every number it shows", async () => {
    mockRowsByKind["VirtualMachine"] = [
      vm({
        isPoweredOn: true,
        latestCpuPercent: 64,
        latestCpuMhz: 2400,
        cpuReadinessPercent: 12.5,
        latestMemoryBytes: 3 * GIB,
        maxMemoryBytes: 8 * GIB,
        latestMemoryPercent: 37.5,
        memoryBalloonedBytes: 512 * MIB,
        memorySwappedBytes: 128 * MIB,
        latestDiskBytes: 40 * GIB,
        maxDiskBytes: 100 * GIB,
        latestDiskPercent: 40,
      }),
    ];
    openAt(detailUrl("virtual-machines", EXTERNAL_ID));

    render(<VirtualMachineDetail {...PAGE_PROPS} />);
    await waitForInfo("Power State");

    expect(await explainedLabels()).toEqual([
      ["Power State", D.vmPowerState],
      ["CPU", D.vmCpu],
      ["CPU Ready", D.vmCpuReady],
      ["Memory (Used / Configured)", D.vmMemory],
      ["Memory Ballooned", D.vmMemoryBallooned],
      ["Memory Swapped", D.vmMemorySwapped],
      ["Disk (Used / Provisioned)", D.vmDisk],
    ]);
    // Above 10% CPU Ready the value itself is flagged.
    expect(screen.getByText("12.5% — CPU contention")).toBeInTheDocument();
    expectNoInfoOn([
      "VM Name",
      "vCenter",
      "Instance UUID",
      "Host",
      "Cluster",
      "Datacenter",
      "Resource Pool",
      "External ID",
      "Metrics Updated",
      "Last Seen",
    ]);
  });

  test("a powered-off VM with no CPU reading still explains its N/A", async () => {
    mockRowsByKind["VirtualMachine"] = [
      vm({
        isPoweredOn: false,
        latestDiskBytes: 40 * GIB,
        maxDiskBytes: 100 * GIB,
      }),
    ];
    openAt(detailUrl("virtual-machines", EXTERNAL_ID));

    render(<VirtualMachineDetail {...PAGE_PROPS} />);
    await waitForInfo("CPU");

    expect(
      screen.getByText("N/A — CPU metrics are only reported while powered on"),
    ).toBeInTheDocument();
    expect(await explainedLabels()).toEqual([
      ["Power State", D.vmPowerState],
      ["CPU", D.vmCpu],
      ["Disk (Used / Provisioned)", D.vmDisk],
    ]);
    // Ballooned / swapped are only shown above zero.
    expectNoInfoOn(["Memory Ballooned", "Memory Swapped", "CPU Ready"]);
  });

  test("a template's Type row reuses the power-state explanation, which names templates", async () => {
    mockRowsByKind["VirtualMachine"] = [
      vm({
        isTemplate: true,
        latestDiskBytes: 20 * GIB,
        maxDiskBytes: 60 * GIB,
      }),
    ];
    openAt(detailUrl("virtual-machines", EXTERNAL_ID));

    render(<VirtualMachineDetail {...PAGE_PROPS} />);
    await waitForInfo("Type");

    expect(await explainedLabels()).toEqual([
      ["Type", D.vmPowerState],
      ["Disk (Used / Provisioned)", D.vmDisk],
    ]);
    expect(D.vmPowerState).toContain("Templates never run");
  });
});

describe("VMware datastore detail", () => {
  const EXTERNAL_ID: string = "datastore/dc1/ds1";

  test("capacity fields and the growth forecast are explained", async () => {
    mockRowsByKind["Datastore"] = [
      inventoryRow({
        kind: "Datastore",
        externalId: EXTERNAL_ID,
        name: "ds1",
        datacenterName: "dc1",
        latestDiskBytes: 85 * GIB,
        maxDiskBytes: 100 * GIB,
        latestDiskPercent: 85,
        metricsUpdatedAt: new Date(),
      }),
    ];
    // Growing 1 GiB an hour over the last 24 hours: full in about 15 hours.
    const now: number = Date.now();
    mockAggregateData = [0, 1, 2, 3, 4, 5].map(
      (step: number): Record<string, unknown> => {
        return {
          timestamp: new Date(now - (5 - step) * 60 * 60 * 1000),
          value: (80 + step) * GIB,
        };
      },
    );
    openAt(detailUrl("datastores", EXTERNAL_ID));

    render(<DatastoreDetail {...PAGE_PROPS} />);
    await waitForInfo("Growth Forecast");

    expect(await explainedLabels()).toEqual([
      ["Used", D.datastoreUsed],
      ["Capacity", D.datastoreCapacity],
      ["Free", D.datastoreFree],
      ["Used %", D.datastoreUsedPercent],
      ["Growth Forecast", D.datastoreGrowthForecast],
    ]);
    expectNoInfoOn([
      "Datastore Name",
      "vCenter",
      "Datacenter",
      "External ID",
      "Metrics Updated",
    ]);
  });

  test("without a forecast the other fields keep their (i)s", async () => {
    mockRowsByKind["Datastore"] = [
      inventoryRow({
        kind: "Datastore",
        externalId: EXTERNAL_ID,
        name: "ds1",
        latestDiskBytes: 10 * GIB,
        maxDiskBytes: 100 * GIB,
      }),
    ];
    openAt(detailUrl("datastores", EXTERNAL_ID));

    render(<DatastoreDetail {...PAGE_PROPS} />);
    await waitForInfo("Used %");

    expect(infoLabels()).toEqual(["Used", "Capacity", "Free", "Used %"]);
  });
});

describe("VMware cluster detail", () => {
  const EXTERNAL_ID: string = "cluster/dc1/cl1";

  test("host, VM and capacity counts are explained", async () => {
    mockRowsByKind["Cluster"] = [
      inventoryRow({
        kind: "Cluster",
        externalId: EXTERNAL_ID,
        name: "cl1",
        datacenterName: "dc1",
        hostCount: 4,
        effectiveHostCount: 3,
        vmCount: 20,
        poweredOnVmCount: 18,
        vmTemplateCount: 2,
        cpuEffectiveMhz: 90000,
        cpuCapacityMhz: 120000,
        memoryEffectiveBytes: 768 * GIB,
        maxMemoryBytes: 1024 * GIB,
        metricsUpdatedAt: new Date(),
      }),
    ];
    openAt(detailUrl("clusters", EXTERNAL_ID));

    render(<ClusterDetail {...PAGE_PROPS} />);
    await waitForInfo("Hosts");

    expect(await explainedLabels()).toEqual([
      ["Hosts", D.clusterHosts],
      ["Virtual Machines", D.clusterVirtualMachines],
      ["VM Templates", D.clusterTemplates],
      ["CPU (Effective / Total)", D.clusterCpu],
      ["Memory (Effective / Total)", D.clusterMemory],
    ]);
    // The not-effective host is flagged in the value the (i) explains.
    expect(
      screen.getByText(
        "3 of 4 effective — 1 in maintenance mode or unresponsive",
      ),
    ).toBeInTheDocument();
    expectNoInfoOn([
      "Cluster Name",
      "vCenter",
      "Datacenter",
      "External ID",
      "Metrics Updated",
    ]);
  });
});

describe("VMware list pages: metric column headers", () => {
  const now: Date = new Date();

  async function renderList(
    Page: React.FunctionComponent<PageComponentProps>,
    segment: string,
    waitLabel: string,
  ): Promise<void> {
    openAt(`${BASE}/${segment}`);
    render(<Page {...PAGE_PROPS} />);
    await waitForInfo(waitLabel);
  }

  test("Hosts: CPU Capacity, CPU and Memory", async () => {
    mockRowsByKind["Host"] = [
      inventoryRow({
        kind: "Host",
        externalId: "host/dc1/esx01",
        name: "esx01",
        datacenterName: "dc1",
        clusterName: "cl1",
        latestCpuPercent: 20,
        cpuCapacityMhz: 48000,
        latestMemoryBytes: 64 * GIB,
        maxMemoryBytes: 256 * GIB,
        metricsUpdatedAt: now,
      }),
    ];

    await renderList(HostsPage, "hosts", "CPU Capacity");

    expect(await explainedLabels()).toEqual([
      ["CPU Capacity", D.hostListCpuCapacity],
      ["CPU", D.hostListCpu],
      ["Memory", D.hostListMemory],
    ]);
    expectNoInfoOn(["Name", "Datacenter", "Cluster"]);
  });

  test("Virtual Machines: status, power state, CPU Ready, CPU, memory and age", async () => {
    mockRowsByKind["VirtualMachine"] = [
      inventoryRow({
        kind: "VirtualMachine",
        externalId: "vm/uuid-1",
        name: "web-01",
        hostName: "esx01",
        isTemplate: false,
        isPoweredOn: true,
        latestCpuPercent: 30,
        cpuReadinessPercent: 2,
        latestMemoryBytes: 2 * GIB,
        maxMemoryBytes: 8 * GIB,
        metricsUpdatedAt: now,
      }),
    ];

    await renderList(VirtualMachinesPage, "virtual-machines", "Power State");

    expect(await explainedLabels()).toEqual([
      ["Status", D.vmListStatus],
      ["Power State", D.vmListPowerState],
      ["CPU Ready", D.vmListCpuReady],
      ["CPU", D.vmListCpu],
      ["Memory", D.vmListMemory],
      ["Age", D.vmListAge],
    ]);
    expectNoInfoOn(["Name", "Host", "Cluster", "Resource Pool"]);
  });

  test("Datastores: Used / Capacity", async () => {
    mockRowsByKind["Datastore"] = [
      inventoryRow({
        kind: "Datastore",
        externalId: "datastore/dc1/ds1",
        name: "ds1",
        datacenterName: "dc1",
        latestDiskBytes: 40 * GIB,
        maxDiskBytes: 100 * GIB,
      }),
    ];

    await renderList(DatastoresPage, "datastores", "Used / Capacity");

    expect(await explainedLabels()).toEqual([
      ["Used / Capacity", D.datastoreListUsedCapacity],
    ]);
  });

  test("Clusters: every count and capacity column", async () => {
    mockRowsByKind["Cluster"] = [
      inventoryRow({
        kind: "Cluster",
        externalId: "cluster/dc1/cl1",
        name: "cl1",
        datacenterName: "dc1",
        hostCount: 4,
        effectiveHostCount: 4,
        vmCount: 10,
        poweredOnVmCount: 9,
        vmTemplateCount: 1,
        cpuEffectiveMhz: 90000,
        cpuCapacityMhz: 120000,
        memoryEffectiveBytes: 768 * GIB,
        maxMemoryBytes: 1024 * GIB,
      }),
    ];

    await renderList(ClustersPage, "clusters", "Effective CPU");

    expect(await explainedLabels()).toEqual([
      ["Hosts (effective / total)", D.clusterListHosts],
      ["VMs (powered on / total)", D.clusterListVirtualMachines],
      ["Templates", D.clusterListTemplates],
      ["Effective CPU", D.clusterListEffectiveCpu],
      ["Effective Memory", D.clusterListEffectiveMemory],
    ]);
  });

  test("Resource Pools: CPU, memory and ballooned / swapped", async () => {
    mockRowsByKind["ResourcePool"] = [
      inventoryRow({
        kind: "ResourcePool",
        externalId: "resourcepool/dc1/cl1/Resources",
        name: "Resources",
        clusterName: "cl1",
        resourcePoolPath: "/dc1/host/cl1/Resources",
        latestCpuMhz: 1500,
        latestMemoryBytes: 4 * GIB,
        memoryBalloonedBytes: 0,
        memorySwappedBytes: 0,
        metricsUpdatedAt: now,
      }),
    ];

    await renderList(ResourcePoolsPage, "resource-pools", "CPU Usage");

    expect(await explainedLabels()).toEqual([
      ["CPU Usage", D.resourcePoolListCpu],
      ["Memory Usage", D.resourcePoolListMemory],
      ["Ballooned / Swapped", D.resourcePoolListBalloonedSwapped],
    ]);
    expectNoInfoOn(["Inventory Path", "Cluster / Host"]);
  });

  test("a header (i) sits beside the sort button, and explaining does not sort", async () => {
    mockRowsByKind["VirtualMachine"] = [
      inventoryRow({
        kind: "VirtualMachine",
        externalId: "vm/uuid-a",
        name: "alpha",
        isPoweredOn: true,
        latestCpuPercent: 90,
        metricsUpdatedAt: now,
      }),
      inventoryRow({
        kind: "VirtualMachine",
        externalId: "vm/uuid-b",
        name: "bravo",
        isPoweredOn: true,
        latestCpuPercent: 10,
        metricsUpdatedAt: now,
      }),
    ];

    await renderList(VirtualMachinesPage, "virtual-machines", "CPU");

    for (const button of infoButtons()) {
      expectNotNested(button);
    }

    const cpuInfo: HTMLElement = infoButtonsFor("CPU")[0]!;
    const header: HTMLElement = cpuInfo.closest("th") as HTMLElement;

    expect(header).not.toBeNull();
    expect(header.getAttribute("aria-sort")).toBe("none");

    fireEvent.click(cpuInfo);
    // Pressing the (i) did not sort the column.
    expect(header.getAttribute("aria-sort")).toBe("none");
    expect(await explanationOnFocus(cpuInfo)).toBe(D.vmListCpu);

    // The sort button next to it still sorts.
    fireEvent.click(
      header.querySelector("button:not([aria-label])") as HTMLElement,
    );
    expect(header.getAttribute("aria-sort")).not.toBe("none");
  });
});
