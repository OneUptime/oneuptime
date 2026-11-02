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
 * The page of a virtual machine, a datastore and a cluster inside a vCenter
 * (Pages/VMware/View/VirtualMachineDetail, DatastoreDetail, ClusterDetail),
 * rendered for real against a stubbed data layer: what each says about the
 * part - its state in vCenter's words and coloured by VMwareHealth, where it
 * sits, what on it needs attention, what is open on it, the alerts that
 * watch it with Turn on N, its details - and what each says when the part's
 * row cannot be read. The ESXi host's page has a suite of its own
 * (VMwareHostPage).
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const VCENTER_ID: string = "31000000-0000-4000-8000-000000000001";
const BASE: string = `/dashboard/${PROJECT_ID}/vmware/${VCENTER_ID}`;
const GIB: number = 1024 * 1024 * 1024;

interface ListRequest {
  modelName: string;
  query: Record<string, unknown>;
}

const mockListRequests: Array<ListRequest> = [];
let mockRowsByKind: Record<string, Array<Record<string, unknown>>> = {};
// A kind whose read fails, as a server or a role refuses it.
let mockFailingKinds: Array<string> = [];
let mockIncidents: Array<Record<string, unknown>> = [];
let mockAlerts: Array<Record<string, unknown>> = [];

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
        const Model: new () => { tableName?: string } = request.modelType;
        return Promise.resolve(
          Object.assign(new Model(), {
            _id: VCENTER_ID,
            name: "vcenter-prod",
            collectionMethod: "Agent",
          }),
        );
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
        query: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "unknown";
        mockListRequests.push({ modelName, query: request.query });

        let records: Array<Record<string, unknown>> = [];
        if (modelName === "VMwareResource") {
          const kind: string = String(request.query["kind"]);
          if (mockFailingKinds.includes(kind)) {
            return Promise.reject(
              new Error("The server could not be reached."),
            );
          }
          // The rows of the kind asked for, narrowed as the read narrows them.
          records = (mockRowsByKind[kind] || []).filter(
            (row: Record<string, unknown>): boolean => {
              for (const key of [
                "externalId",
                "hostName",
                "clusterName",
                "datacenterName",
              ]) {
                const wanted: unknown = request.query[key];
                if (typeof wanted === "string" && row[key] !== wanted) {
                  return false;
                }
              }
              return true;
            },
          );
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
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
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

// The Metrics tab is not the subject here, and it is not the open tab.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="metrics-tab" />;
      },
    };
  },
);

import VirtualMachineDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/VirtualMachineDetail";
import DatastoreDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/DatastoreDetail";
import ClusterDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/ClusterDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

function partUrl(segment: string, externalId: string): string {
  return `${BASE}/${segment}/${encodeURIComponent(externalId)}`;
}

function datacenter(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "43000000-0000-4000-8000-000000000001",
    kind: "Datacenter",
    externalId: "datacenter/dc-east",
    name: "dc-east",
    datacenterName: "dc-east",
    metricsUpdatedAt: minutesAgo(2),
    hostCount: 4,
    poweredOnHostCount: 4,
    notRespondingHostCount: 0,
    standbyHostCount: 0,
    criticalHostCount: 0,
    warningHostCount: 0,
    criticalVmCount: 0,
    criticalClusterCount: 0,
    ...fields,
  };
}

// A datacenter that has lost contact with one host and has none off.
function lostDatacenter(): Record<string, unknown> {
  return datacenter({ poweredOnHostCount: 3, notRespondingHostCount: 1 });
}

let hostNumber: number = 0;

function host(name: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  hostNumber++;
  return {
    _id: `44000000-0000-4000-8000-${String(hostNumber).padStart(12, "0")}`,
    kind: "Host",
    externalId: `host/dc-east/${name}`,
    name: name,
    hostName: name,
    clusterName: "prod-cluster",
    datacenterName: "dc-east",
    cpuCapacityMhz: 76800,
    maxMemoryBytes: 512 * GIB,
    latestCpuMhz: 30000,
    latestCpuPercent: 40,
    latestMemoryBytes: 256 * GIB,
    latestMemoryPercent: 50,
    metricsUpdatedAt: minutesAgo(2),
    ...fields,
  };
}

// A host vCenter reports no usage for: lost, off or in standby.
function silentHost(name: string): Record<string, unknown> {
  return host(name, {
    latestCpuMhz: 0,
    latestCpuPercent: 0,
    latestMemoryBytes: 0,
    latestMemoryPercent: 0,
  });
}

let vmNumber: number = 0;

function vm(name: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  vmNumber++;
  return {
    _id: `45000000-0000-4000-8000-${String(vmNumber).padStart(12, "0")}`,
    kind: "VirtualMachine",
    externalId: `vm/${name}-uuid`,
    vmInstanceUuid: `${name}-uuid`,
    name: name,
    hostName: "esx01",
    clusterName: "prod-cluster",
    datacenterName: "dc-east",
    resourcePoolName: "Resources",
    resourcePoolPath: "/dc-east/host/prod-cluster/Resources",
    isTemplate: false,
    isPoweredOn: true,
    latestCpuMhz: 1200,
    latestCpuPercent: 20,
    cpuReadinessPercent: 1,
    latestMemoryBytes: 8 * GIB,
    latestMemoryPercent: 25,
    maxMemoryBytes: 32 * GIB,
    memoryBalloonedBytes: 0,
    memorySwappedBytes: 0,
    latestDiskBytes: 100 * GIB,
    maxDiskBytes: 400 * GIB,
    metricsUpdatedAt: minutesAgo(2),
    ...fields,
  };
}

function cluster(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "46000000-0000-4000-8000-000000000001",
    kind: "Cluster",
    externalId: "cluster/dc-east/prod-cluster",
    name: "prod-cluster",
    clusterName: "prod-cluster",
    datacenterName: "dc-east",
    hostCount: 2,
    effectiveHostCount: 2,
    vmCount: 10,
    poweredOnVmCount: 9,
    vmTemplateCount: 1,
    cpuCapacityMhz: 153600,
    cpuEffectiveMhz: 150000,
    maxMemoryBytes: 1024 * GIB,
    memoryEffectiveBytes: 1000 * GIB,
    metricsUpdatedAt: minutesAgo(2),
    ...fields,
  };
}

function datastore(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "47000000-0000-4000-8000-000000000001",
    kind: "Datastore",
    externalId: "datastore/dc-east/ds-prod-01",
    name: "ds-prod-01",
    datacenterName: "dc-east",
    latestDiskBytes: 930 * GIB,
    maxDiskBytes: 1000 * GIB,
    latestDiskPercent: 93,
    metricsUpdatedAt: minutesAgo(2),
    ...fields,
  };
}

function attentionRows(testId: string): Array<{
  key: string | null;
  severity: string | null;
  text: string;
}> {
  return within(screen.getByTestId(testId))
    .getAllByTestId(`${testId}-item`)
    .map((item: HTMLElement) => {
      return {
        key: item.getAttribute("data-key"),
        severity: item.getAttribute("data-severity"),
        text: item.textContent || "",
      };
    });
}

function selectionOf(link: HTMLElement): Array<string> {
  const url: URL = new URL(
    link.getAttribute("href") || "",
    "https://oneuptime.example",
  );
  expect(url.pathname).toBe(`${BASE}/recommendations`);
  return (url.searchParams.get("select") || "").split(",");
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockListRequests.length = 0;
  mockRowsByKind = {
    Datacenter: [datacenter()],
    Host: [host("esx01"), host("esx02")],
    Cluster: [cluster()],
    VirtualMachine: [],
    Datastore: [datastore()],
  };
  mockFailingKinds = [];
  mockIncidents = [];
  mockAlerts = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("a virtual machine's page", () => {
  async function openVm(name: string): Promise<void> {
    window.history.pushState({}, "", partUrl("virtual-machines", `vm/${name}-uuid`));
    render(<VirtualMachineDetail {...PAGE_PROPS} />);
    await screen.findByTestId("vmware-vm-overview");
    await settle();
  }

  test("one its host swaps: Running in red, where it runs one step away, why it needs attention and its tiles", async () => {
    mockRowsByKind["VirtualMachine"] = [
      vm("db-primary", {
        latestCpuPercent: 78.4,
        latestCpuMhz: 7530,
        latestMemoryBytes: 58 * GIB,
        latestMemoryPercent: 90.6,
        maxMemoryBytes: 64 * GIB,
        memorySwappedBytes: 1.5 * GIB,
        cpuReadinessPercent: 6.2,
        latestDiskBytes: 410 * GIB,
        maxDiskBytes: 500 * GIB,
        latestDiskPercent: 82,
      }),
    ];
    await openVm("db-primary");

    const status: HTMLElement = screen.getByTestId("vmware-vm-hero-status");
    expect(status).toHaveTextContent(/^Running/);
    expect(status).toHaveAttribute("data-tone", "danger");
    // Where it runs, the host and the cluster each a link to its page.
    const location: HTMLElement = screen.getByTestId("vmware-vm-hero-location");
    expect(location).toHaveTextContent(
      "On host esx01 in cluster prod-cluster, datacenter dc-east",
    );
    expect(within(location).getByText("esx01").closest("a")).toHaveAttribute(
      "href",
      `${BASE}/hosts/${encodeURIComponent("host/dc-east/esx01")}`,
    );
    expect(
      within(location).getByText("prod-cluster").closest("a"),
    ).toHaveAttribute(
      "href",
      `${BASE}/clusters/${encodeURIComponent("cluster/dc-east/prod-cluster")}`,
    );
    // Its size; its cluster's root pool is no pool of anyone's making.
    const chips: HTMLElement = screen.getByTestId("vmware-vm-hero-chips");
    expect(chips).toHaveTextContent("64.0 GiB memory");
    expect(chips).toHaveTextContent("500 GiB provisioned");
    expect(chips).not.toHaveTextContent("Pool");

    // Its own row reads "This VM", critical, with how much the host swaps.
    expect(attentionRows("vmware-vm-attention")).toEqual([
      {
        key: "VirtualMachine:vm/db-primary-uuid",
        severity: "critical",
        text: expect.stringContaining("1.5 GiB of memory swapped by the host"),
      },
    ]);
    expect(screen.getByTestId("vmware-vm-attention")).toHaveTextContent(
      "This VM",
    );

    const tiles: HTMLElement = screen.getByTestId("vmware-vm-tiles");
    expect(tiles).toHaveTextContent("78.4%");
    expect(tiles).toHaveTextContent("90.6%");
    expect(tiles).toHaveTextContent("58.0 GiB of 64.0 GiB");
    expect(tiles).toHaveTextContent("82.0%");
  });

  test("the VM alerts: all seven, the ones that mean trouble first, and one step to turn them on", async () => {
    mockRowsByKind["VirtualMachine"] = [vm("web-01")];
    await openVm("web-01");

    const card: HTMLElement = await screen.findByTestId("vmware-vm-alerts");
    const items: Array<HTMLElement> = within(card).getAllByTestId(
      "vmware-vm-alerts-item",
    );
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveTextContent("VM Memory Swapping");
    const turnOn: HTMLElement = within(card).getByTestId(
      "vmware-vm-alerts-turn-on",
    );
    expect(turnOn).toHaveTextContent("Turn on 7 alerts");
    expect(selectionOf(turnOn)).toEqual([
      "VMware:vmware-vm-memory-swapping",
      "VMware:vmware-vm-memory-ballooning",
      "VMware:vmware-vm-cpu-ready-contention",
      "VMware:vmware-vm-cpu-saturation",
      "VMware:vmware-vm-memory-saturation",
      "VMware:vmware-vm-disk-latency-high",
      "VMware:vmware-vm-disk-usage-high",
    ]);
  });

  test("an alert that names it is open on it; another VM's is not", async () => {
    mockRowsByKind["VirtualMachine"] = [vm("web-01")];
    mockAlerts = [
      {
        _id: "61000000-0000-4000-8000-000000000001",
        title: "[VMware] VM CPU Ready Contention (>10%) - vcenter-prod",
        alertNumber: 9,
        createdAt: minutesAgo(5),
        seriesLabels: { "resource.vcenter.vm.name": "web-01" },
      },
      {
        _id: "61000000-0000-4000-8000-000000000002",
        title: "Another VM's alert",
        createdAt: minutesAgo(3),
        seriesLabels: { "resource.vcenter.vm.name": "web-02" },
      },
    ];
    await openVm("web-01");

    const card: HTMLElement = await screen.findByTestId("vmware-vm-open");
    expect(
      within(card)
        .getAllByTestId("vmware-vm-open-title")
        .map((title: HTMLElement): string => {
          return title.textContent || "";
        }),
    ).toEqual(["[VMware] VM CPU Ready Contention (>10%) - vcenter-prod"]);
    expect(
      within(card).getByTestId("vmware-vm-open-item").querySelector("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/alerts/61000000-0000-4000-8000-000000000001`,
    );
  });

  test("on a host vCenter lost: Disconnected in grey, no numbers, and the host in Needs attention", async () => {
    mockRowsByKind["Datacenter"] = [lostDatacenter()];
    mockRowsByKind["Host"] = [silentHost("esx03")];
    mockRowsByKind["VirtualMachine"] = [
      vm("cache-01", {
        hostName: "esx03",
        memorySwappedBytes: 4 * GIB,
        latestCpuPercent: 0,
      }),
    ];
    await openVm("cache-01");

    const status: HTMLElement = screen.getByTestId("vmware-vm-hero-status");
    expect(status).toHaveTextContent("Disconnected");
    expect(status).toHaveAttribute("data-tone", "neutral");
    expect(status).toHaveAttribute(
      "title",
      "vCenter cannot reach the ESXi host this VM runs on, so it does not know what the VM is doing.",
    );
    // Its 0% and its swap are no reading: dashes, and no swap row.
    const tiles: HTMLElement = screen.getByTestId("vmware-vm-tiles");
    expect(within(tiles).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByTestId("vmware-vm-details-swapped")).toBeNull();
    // What needs attention is its host, one step from its page.
    expect(attentionRows("vmware-vm-attention")).toEqual([
      {
        key: "Host:host/dc-east/esx03",
        severity: "critical",
        text: expect.stringContaining("Not responding"),
      },
    ]);
  });

  test("a VM in a pool someone made names it, in its hero and its details", async () => {
    mockRowsByKind["VirtualMachine"] = [
      vm("batch-worker-01", {
        resourcePoolName: "Batch",
        resourcePoolPath: "/dc-east/host/prod-cluster/Resources/Batch",
      }),
    ];
    await openVm("batch-worker-01");

    expect(screen.getByTestId("vmware-vm-hero-chips")).toHaveTextContent(
      "Pool Batch",
    );
    expect(screen.getByTestId("vmware-vm-details-pool")).toHaveTextContent(
      "Batch",
    );
    expect(screen.getByTestId("vmware-vm-details-path")).toHaveTextContent(
      "/dc-east/host/prod-cluster/Resources/Batch",
    );
  });

  test("a VM in its cluster's root pool has no pool row: it is in no pool of anyone's making", async () => {
    mockRowsByKind["VirtualMachine"] = [vm("web-01")];
    await openVm("web-01");

    expect(screen.queryByTestId("vmware-vm-details-pool")).toBeNull();
    expect(screen.queryByTestId("vmware-vm-details-path")).toBeNull();
    expect(screen.getByTestId("vmware-vm-details-uuid")).toHaveTextContent(
      "web-01-uuid",
    );
  });

  test("a template: Template, its disk alone, and no alerts card", async () => {
    mockRowsByKind["VirtualMachine"] = [
      vm("ubuntu-template", { isTemplate: true, isPoweredOn: false }),
    ];
    await openVm("ubuntu-template");

    expect(screen.getByTestId("vmware-vm-hero-status")).toHaveTextContent(
      "Template",
    );
    const tiles: HTMLElement = screen.getByTestId("vmware-vm-tiles");
    expect(within(tiles).queryByText("CPU")).toBeNull();
    expect(within(tiles).getByText("Disk")).toBeInTheDocument();
    expect(screen.queryByTestId("vmware-vm-alerts")).toBeNull();
    expect(screen.queryByTestId("vmware-vm-attention")).toBeNull();
  });

  test("a VM whose row cannot be read says so, with Try again; its hero says no state", async () => {
    mockFailingKinds = ["VirtualMachine"];
    window.history.pushState({}, "", partUrl("virtual-machines", "vm/web-01-uuid"));
    render(<VirtualMachineDetail {...PAGE_PROPS} />);

    const error: HTMLElement = await screen.findByTestId(
      "vmware-part-read-error",
    );
    expect(error).toHaveTextContent("Couldn't load this virtual machine");
    expect(error).toHaveTextContent("The server could not be reached.");
    expect(screen.queryByTestId("vmware-vm-hero-status")).toBeNull();
    expect(screen.queryByText("Not in inventory")).toBeNull();

    mockFailingKinds = [];
    mockRowsByKind["VirtualMachine"] = [vm("web-01")];
    fireEvent.click(within(error).getByTestId("refresh-button"));

    expect(await screen.findByTestId("vmware-vm-overview")).toBeInTheDocument();
    expect(screen.getByTestId("vmware-vm-hero-status")).toHaveTextContent(
      "Running",
    );
  });

  test("a VM gone from the inventory says so; a read that worked is never a read error", async () => {
    mockRowsByKind["VirtualMachine"] = [];
    window.history.pushState({}, "", partUrl("virtual-machines", "vm/gone-uuid"));
    render(<VirtualMachineDetail {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("vmware-vm-not-reported"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("vmware-vm-hero-status")).toHaveTextContent(
      "Not in inventory",
    );
    expect(screen.queryByTestId("vmware-part-read-error")).toBeNull();
  });
});

describe("a datastore's page", () => {
  async function openDatastore(): Promise<void> {
    window.history.pushState(
      {},
      "",
      partUrl("datastores", "datastore/dc-east/ds-prod-01"),
    );
    render(<DatastoreDetail {...PAGE_PROPS} />);
    await screen.findByTestId("vmware-datastore-overview");
    await settle();
  }

  test("93% full: how full in red, This datastore's reason, its tiles and its alerts", async () => {
    await openDatastore();

    const status: HTMLElement = screen.getByTestId(
      "vmware-datastore-hero-status",
    );
    expect(status).toHaveTextContent("93% used");
    expect(status).toHaveAttribute("data-tone", "danger");
    expect(
      screen.getByTestId("vmware-datastore-hero-location"),
    ).toHaveTextContent("Datastore in datacenter dc-east");
    expect(screen.getByTestId("vmware-datastore-hero-chips")).toHaveTextContent(
      "1000 GiB capacity",
    );
    expect(attentionRows("vmware-datastore-attention")).toEqual([
      {
        key: "Datastore:datastore/dc-east/ds-prod-01",
        severity: "critical",
        text: expect.stringContaining("93% full"),
      },
    ]);
    const tiles: HTMLElement = screen.getByTestId("vmware-datastore-tiles");
    expect(tiles).toHaveTextContent("93.0%");
    expect(tiles).toHaveTextContent("930 GiB of 1000 GiB");

    const card: HTMLElement = await screen.findByTestId(
      "vmware-datastore-alerts",
    );
    expect(
      within(card).getAllByTestId("vmware-datastore-alerts-item"),
    ).toHaveLength(2);
    expect(
      selectionOf(within(card).getByTestId("vmware-datastore-alerts-turn-on")),
    ).toEqual([
      "VMware:vmware-datastore-capacity-critical",
      "VMware:vmware-datastore-capacity-warning",
    ]);
  });

  test("40% full needs nothing: calm, and no Needs attention card", async () => {
    mockRowsByKind["Datastore"] = [
      datastore({
        latestDiskPercent: 40,
        latestDiskBytes: 400 * GIB,
      }),
    ];
    await openDatastore();

    expect(screen.getByTestId("vmware-datastore-hero-status")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    expect(screen.queryByTestId("vmware-datastore-attention")).toBeNull();
  });

  test("a datastore whose row cannot be read says so, with Try again", async () => {
    mockFailingKinds = ["Datastore"];
    window.history.pushState(
      {},
      "",
      partUrl("datastores", "datastore/dc-east/ds-prod-01"),
    );
    render(<DatastoreDetail {...PAGE_PROPS} />);

    const error: HTMLElement = await screen.findByTestId(
      "vmware-part-read-error",
    );
    expect(error).toHaveTextContent("Couldn't load this datastore");
    expect(screen.queryByTestId("vmware-datastore-hero-status")).toBeNull();

    mockFailingKinds = [];
    fireEvent.click(within(error).getByTestId("refresh-button"));
    expect(
      await screen.findByTestId("vmware-datastore-overview"),
    ).toBeInTheDocument();
  });
});

describe("a cluster's page", () => {
  async function openCluster(): Promise<void> {
    window.history.pushState(
      {},
      "",
      partUrl("clusters", "cluster/dc-east/prod-cluster"),
    );
    render(<ClusterDetail {...PAGE_PROPS} />);
    await screen.findByTestId("vmware-cluster-overview");
    await settle();
  }

  test("a host its vCenter lost: Unhealthy, what in it needs attention, its hosts the lost one first", async () => {
    mockRowsByKind["Datacenter"] = [lostDatacenter()];
    mockRowsByKind["Cluster"] = [cluster({ hostCount: 3, effectiveHostCount: 2 })];
    mockRowsByKind["Host"] = [
      host("esx01"),
      host("esx02", { latestCpuPercent: 94, latestCpuMhz: 72000 }),
      silentHost("esx03"),
    ];
    // The VMs in it that may need a look, as one read per kind of trouble returns them.
    mockRowsByKind["VirtualMachine"] = [
      vm("db-primary", { memorySwappedBytes: 1.5 * GIB }),
    ];
    await openCluster();

    const status: HTMLElement = screen.getByTestId("vmware-cluster-hero-status");
    expect(status).toHaveTextContent("Unhealthy");
    expect(status).toHaveAttribute("data-tone", "danger");
    expect(screen.getByTestId("vmware-cluster-hero-chips")).toHaveTextContent(
      "2/3 ESXi hosts effective",
    );

    expect(
      attentionRows("vmware-cluster-attention").map(
        (row: { key: string | null; severity: string | null }) => {
          return [row.key, row.severity];
        },
      ),
    ).toEqual([
      ["Host:host/dc-east/esx03", "critical"],
      ["VirtualMachine:vm/db-primary-uuid", "critical"],
      ["Host:host/dc-east/esx02", "warning"],
    ]);

    // Effective hosts: 2/3, the lost one named, the bar red.
    const tiles: HTMLElement = screen.getByTestId("vmware-cluster-tiles");
    expect(tiles).toHaveTextContent("2/3");
    expect(tiles).toHaveTextContent("1 not responding");

    const hosts: Array<string | null> = within(
      screen.getByTestId("vmware-cluster-hosts-card"),
    )
      .getAllByTestId("vmware-cluster-hosts-card-item")
      .map((item: HTMLElement): string | null => {
        return item.getAttribute("data-host");
      });
    expect(hosts).toEqual(["esx03", "esx02", "esx01"]);
  });

  test("one that could not take its largest host's VMs: Degraded, and how much memory it would be short", async () => {
    mockRowsByKind["Cluster"] = [cluster()];
    mockRowsByKind["Host"] = [
      host("esx-w1", { latestMemoryBytes: 200 * GIB, maxMemoryBytes: 256 * GIB }),
      host("esx-w2", { latestMemoryBytes: 200 * GIB, maxMemoryBytes: 256 * GIB }),
    ];
    await openCluster();

    expect(screen.getByTestId("vmware-cluster-hero-status")).toHaveTextContent(
      "Degraded",
    );
    const tiles: HTMLElement = screen.getByTestId("vmware-cluster-tiles");
    expect(tiles).toHaveTextContent("Not covered");
    expect(tiles).toHaveTextContent(
      "144 GiB of memory short without the largest host",
    );
    expect(attentionRows("vmware-cluster-attention")).toEqual([
      {
        key: "Cluster:cluster/dc-east/prod-cluster",
        severity: "warning",
        text: expect.stringContaining("Not enough memory to lose a host"),
      },
    ]);
    // Its own row reads "This cluster".
    expect(screen.getByTestId("vmware-cluster-attention")).toHaveTextContent(
      "This cluster",
    );
  });

  test("the cluster alerts: its hosts not effective and its vSAN, one step to turn them on", async () => {
    await openCluster();

    const card: HTMLElement = await screen.findByTestId(
      "vmware-cluster-alerts",
    );
    expect(
      selectionOf(within(card).getByTestId("vmware-cluster-alerts-turn-on")),
    ).toEqual([
      "VMware:vmware-cluster-host-not-effective",
      "VMware:vmware-vsan-latency-high",
      "VMware:vmware-vsan-congestion",
    ]);
  });

  test("its VMs are read when their tab first opens, by the cluster's name and datacenter", async () => {
    mockRowsByKind["VirtualMachine"] = [vm("web-01"), vm("web-02")];
    await openCluster();

    const readsBefore: number = mockListRequests.filter(
      (request: ListRequest): boolean => {
        return (
          request.query["kind"] === "VirtualMachine" &&
          request.query["memorySwappedBytes"] === undefined &&
          request.query["memoryBalloonedBytes"] === undefined &&
          request.query["cpuReadinessPercent"] === undefined
        );
      },
    ).length;
    expect(readsBefore).toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: /^Virtual Machines/ }));
    await waitFor(() => {
      expect(screen.getByText("web-02")).toBeInTheDocument();
    });
    const read: ListRequest | undefined = mockListRequests.find(
      (request: ListRequest): boolean => {
        return (
          request.query["kind"] === "VirtualMachine" &&
          request.query["isPoweredOn"] === undefined
        );
      },
    );
    expect(read?.query["clusterName"]).toBe("prod-cluster");
    expect(read?.query["datacenterName"]).toBe("dc-east");
  });

  test("a cluster whose rows cannot be read: its Overview says so with Try again, its hosts tab with Refresh", async () => {
    mockFailingKinds = ["Cluster"];
    window.history.pushState(
      {},
      "",
      partUrl("clusters", "cluster/dc-east/prod-cluster"),
    );
    render(<ClusterDetail {...PAGE_PROPS} />);

    const error: HTMLElement = await screen.findByTestId(
      "vmware-part-read-error",
    );
    expect(error).toHaveTextContent("Couldn't load this cluster");
    expect(screen.queryByTestId("vmware-cluster-hero-status")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /^ESXi Hosts/ }));
    expect(
      await screen.findByText("The server could not be reached."),
    ).toBeInTheDocument();
  });
});
