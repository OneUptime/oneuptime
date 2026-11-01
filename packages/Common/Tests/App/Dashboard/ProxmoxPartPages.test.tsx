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
 * A Proxmox VE node's, guest's and storage's own pages, rendered for real
 * against a stubbed data layer: the hero above the tabs, what needs
 * attention on the part, its tiles, what is open on it, its alerts and
 * details, and a node's Guests and Storage tabs. The metric charts are
 * stood in (their suites are ProxmoxResourcePageTooltips and
 * ProxmoxRateChartReload); the rest is the page as it ships.
 */

const CLUSTER_ID: string = "71000000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_PATH: string = `/dashboard/${PROJECT_ID}/proxmox/${CLUSTER_ID}`;
const NOW: Date = new Date("2026-11-01T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const GIB: number = 1024 * 1024 * 1024;

type Row = Record<string, unknown>;

let mockLastParam: string = "node%2Fpve1";
let mockInventory: Array<Row> = [];
let mockIncidents: Array<Row> = [];
let mockMonitors: Array<Row> = [];

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
      getItem: (): Promise<unknown> => {
        return Promise.resolve({ _id: CLUSTER_ID, name: "pve-prod" });
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
        query: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "";
        let records: Array<Row> = [];
        if (modelName === "ProxmoxResource") {
          records = mockInventory.filter((row: Row): boolean => {
            for (const field of ["kind", "externalId", "parentNodeName"]) {
              const wanted: unknown = request.query[field];
              if (wanted !== undefined && row[field] !== wanted) {
                return false;
              }
            }
            return true;
          });
        } else if (modelName === "Incident") {
          records = mockIncidents;
        } else if (modelName === "IncidentState") {
          records = [
            {
              _id: "50000000-0000-4000-8000-000000000001",
              name: "Created",
              isResolvedState: false,
              order: 1,
            },
          ];
        } else if (modelName === "Monitor") {
          records = mockMonitors;
        }
        const data: Array<unknown> = records.map((record: Row) => {
          return Object.assign(new Model(), record);
        });
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

import ProxmoxClusterNodeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/NodeDetail";
import ProxmoxClusterGuestDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/GuestDetail";
import ProxmoxClusterStorageDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/StorageDetail";
import ProxmoxClusterStorage from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Storage";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function inventory(): Array<Row> {
  return [
    {
      kind: "Node",
      externalId: "node/pve1",
      name: "pve1",
      isUp: true,
      haState: "online",
      cpuCount: 64,
      subscriptionLevel: "c",
      uptimeSeconds: 41 * 86400 + 5 * 3600,
      latestCpuPercent: 42,
      latestMemoryBytes: 154 * GIB,
      maxMemoryBytes: 256 * GIB,
      latestDiskBytes: 30 * GIB,
      maxDiskBytes: 100 * GIB,
      metricsUpdatedAt: ago(MINUTE),
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "Guest",
      externalId: "qemu/100",
      name: "web-01",
      vmid: 100,
      guestType: "qemu",
      parentNodeName: "pve1",
      isUp: true,
      onboot: true,
      isBackedUp: true,
      cpuCount: 4,
      tags: "prod;web",
      lastBackupStatus: "ok",
      lastBackupAt: ago(7 * HOUR),
      lastSuccessfulBackupAt: ago(7 * HOUR),
      lastBackupBytes: 18.4 * GIB,
      lastBackupDurationSeconds: 212,
      latestCpuPercent: 22,
      latestMemoryBytes: 5.6 * GIB,
      maxMemoryBytes: 8 * GIB,
      maxDiskBytes: 64 * GIB,
      metricsUpdatedAt: ago(MINUTE),
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "Guest",
      externalId: "lxc/105",
      name: "ci-runner",
      vmid: 105,
      guestType: "lxc",
      parentNodeName: "pve1",
      isUp: true,
      isBackedUp: true,
      lockState: "backup",
      lastBackupStatus: "failed",
      lastBackupAt: ago(2 * HOUR),
      lastSuccessfulBackupAt: ago(26 * HOUR),
      latestCpuPercent: 64,
      latestMemoryBytes: 6.9 * GIB,
      maxMemoryBytes: 16 * GIB,
      latestDiskBytes: 12 * GIB,
      maxDiskBytes: 32 * GIB,
      metricsUpdatedAt: ago(MINUTE),
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "Guest",
      externalId: "qemu/9000",
      name: "debian-12-template",
      vmid: 9000,
      guestType: "qemu",
      parentNodeName: "pve1",
      isUp: false,
      isTemplate: true,
      isBackedUp: false,
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "Guest",
      externalId: "qemu/104",
      name: "mail",
      vmid: 104,
      guestType: "qemu",
      parentNodeName: "pve2",
      isUp: false,
      onboot: true,
      isBackedUp: false,
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "Storage",
      externalId: "storage/pve1/local-zfs",
      name: "local-zfs",
      parentNodeName: "pve1",
      isUp: true,
      storageType: "zfspool",
      storageContent: "images,rootdir",
      isShared: false,
      latestDiskBytes: 91 * GIB,
      maxDiskBytes: 100 * GIB,
      lastSeenAt: ago(MINUTE),
    },
    {
      kind: "Storage",
      externalId: "storage/pve1/pbs",
      name: "pbs",
      parentNodeName: "pve1",
      isUp: false,
      storageType: "pbs",
      storageContent: "backup",
      isShared: true,
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

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
  lastParam: string,
  heroTestId: string,
): Promise<void> {
  mockLastParam = lastParam;
  render(<Page {...PAGE_PROPS} />);
  await screen.findByTestId(heroTestId);
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
        (item.querySelector("a, span.font-medium") as HTMLElement | null)
          ?.textContent || "";
      return `${name}: ${reasons.join(", ")}`;
    });
}

function tile(tilesTestId: string, title: string): HTMLElement {
  const label: HTMLElement = within(
    screen.getByTestId(tilesTestId),
  ).getAllByText(title)[0]!;
  return label.closest("div.rounded-xl") as HTMLElement;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockInventory = inventory();
  mockIncidents = [];
  mockMonitors = [];
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a node's page", () => {
  test("its hero: the node, its state, its cluster a step away, and its size", async () => {
    await renderPage(
      ProxmoxClusterNodeDetail,
      "node%2Fpve1",
      "proxmox-node-hero",
    );

    expect(screen.getByTestId("proxmox-node-hero-name")).toHaveTextContent(
      "pve1",
    );
    expect(screen.getByTestId("proxmox-node-hero-status")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    expect(
      screen
        .getAllByTestId("proxmox-node-hero-badge")
        .map((badge: HTMLElement) => {
          return badge.textContent;
        }),
    ).toEqual(["HA: online"]);
    const location: HTMLElement = screen.getByTestId(
      "proxmox-node-hero-location",
    );
    expect(location).toHaveTextContent("Node of cluster pve-prod");
    expect(within(location).getByText("pve-prod").closest("a")).toHaveAttribute(
      "href",
      CLUSTER_PATH,
    );
    // Two guests run here; the template is not one that runs.
    expect(screen.getByTestId("proxmox-node-hero-chips")).toHaveTextContent(
      "64 cores256 GiB memory2/2 guests runningup 41d 5hCommunity subscription",
    );
  });

  test("what needs attention: the node's own storage and guests, most urgent first", async () => {
    await renderPage(
      ProxmoxClusterNodeDetail,
      "node%2Fpve1",
      "proxmox-node-hero",
    );

    expect(attentionRows("proxmox-node-attention")).toEqual([
      "pbs: Unavailable",
      "local-zfs: 91% full",
      "ci-runner: Last backup failed",
    ]);
    // mail runs on pve2: not this node's.
    expect(
      screen.getByTestId("proxmox-node-attention").textContent,
    ).not.toContain("mail");
    expect(
      within(screen.getByTestId("proxmox-node-attention"))
        .getByText("ci-runner")
        .closest("a"),
    ).toHaveAttribute(
      "href",
      `${CLUSTER_PATH}/guests/${encodeURIComponent("lxc/105")}`,
    );
  });

  test("an offline node is on its own list, without a link to the page it is on", async () => {
    mockInventory = mockInventory.map((row: Row): Row => {
      return row["externalId"] === "node/pve1" ? { ...row, isUp: false } : row;
    });
    await renderPage(
      ProxmoxClusterNodeDetail,
      "node%2Fpve1",
      "proxmox-node-hero",
    );

    expect(attentionRows("proxmox-node-attention")[0]).toBe("pve1: Offline");
    expect(
      within(screen.getByTestId("proxmox-node-attention"))
        .getByText("pve1")
        .closest("a"),
    ).toBeNull();
  });

  test("its tiles: CPU of its cores, memory, root disk, and the guests it runs", async () => {
    await renderPage(
      ProxmoxClusterNodeDetail,
      "node%2Fpve1",
      "proxmox-node-hero",
    );

    expect(tile("proxmox-node-tiles", "CPU")).toHaveTextContent(
      "42.0%of 64 cores",
    );
    expect(tile("proxmox-node-tiles", "Memory")).toHaveTextContent(
      "60.2%154 GiB of 256 GiB",
    );
    expect(tile("proxmox-node-tiles", "Root Disk")).toHaveTextContent(
      "30.0%30.0 GiB of 100 GiB",
    );
    expect(tile("proxmox-node-tiles", "Guests")).toHaveTextContent(
      "2/2running · 1 template",
    );
  });

  test("its busiest guests, and the step to all of them on the Guests tab", async () => {
    await renderPage(
      ProxmoxClusterNodeDetail,
      "node%2Fpve1",
      "proxmox-node-hero",
    );

    expect(
      screen.getAllByTestId("proxmox-busy-guest").map((row: HTMLElement) => {
        return within(row).getByRole("link").textContent;
      }),
    ).toEqual(["ci-runner", "web-01"]);

    fireEvent.click(
      within(screen.getByTestId("proxmox-busiest-guests-all")).getByRole(
        "button",
        { name: "View all 3 guests" },
      ),
    );
    await flush();

    const table: HTMLElement = screen.getByRole("table");
    const rows: Array<string> = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row: HTMLElement): string => {
        return row.textContent || "";
      });
    expect(rows).toHaveLength(3);
    // By VMID, the kind in words, the backup as the notifications told it.
    expect(rows[0]).toContain("web-01");
    expect(rows[0]).toContain("VM");
    expect(rows[0]).toContain("Backed up 7 hours ago");
    expect(rows[1]).toContain("ci-runner");
    expect(rows[1]).toContain("Container");
    expect(rows[1]).toContain("Failed 2 hours ago");
    expect(rows[2]).toContain("debian-12-template");
    expect(rows[2]).toContain("Template");
  });

  test("its Storage tab lists what the node reports, with type and sharing", async () => {
    await renderPage(
      ProxmoxClusterNodeDetail,
      "node%2Fpve1",
      "proxmox-node-hero",
    );

    fireEvent.click(screen.getByRole("tab", { name: /Storage/ }));
    await flush();

    const table: HTMLElement = screen.getByRole("table");
    expect(
      within(table).getByText("local-zfs").closest("tr"),
    ).toHaveTextContent("ZFS");
    expect(within(table).getByText("pbs").closest("tr")).toHaveTextContent(
      "Proxmox Backup Server",
    );
    expect(within(table).getByText("pbs").closest("tr")).toHaveTextContent(
      "Shared",
    );
  });

  test("what is open on it: only the records about this node", async () => {
    mockIncidents = [
      {
        _id: "60000000-0000-4000-8000-000000000001",
        title: "pve1 is offline",
        incidentNumber: 7,
        createdAt: ago(10 * MINUTE),
        seriesLabels: { id: "node/pve1" },
        currentIncidentState: { name: "Created" },
        incidentSeverity: { name: "Critical", color: "#ff0000" },
        proxmoxClusters: [{ _id: CLUSTER_ID }],
      },
      {
        _id: "60000000-0000-4000-8000-000000000002",
        title: "web-01 is down",
        incidentNumber: 8,
        createdAt: ago(5 * MINUTE),
        seriesLabels: { id: "qemu/100" },
        currentIncidentState: { name: "Created" },
        incidentSeverity: { name: "Critical", color: "#ff0000" },
        proxmoxClusters: [{ _id: CLUSTER_ID }],
      },
    ];

    await renderPage(
      ProxmoxClusterNodeDetail,
      "node%2Fpve1",
      "proxmox-node-hero",
    );

    const open: HTMLElement = await screen.findByTestId("proxmox-node-open");
    expect(within(open).getAllByTestId("proxmox-node-open-item")).toHaveLength(
      1,
    );
    expect(open).toHaveTextContent("pve1 is offline");
    expect(open).not.toHaveTextContent("web-01 is down");
  });

  test("its alerts: the node alerts the cluster offers, with one step to turn them on", async () => {
    await renderPage(
      ProxmoxClusterNodeDetail,
      "node%2Fpve1",
      "proxmox-node-hero",
    );

    const alerts: HTMLElement = await screen.findByTestId(
      "proxmox-node-alerts",
    );
    expect(
      within(alerts)
        .getAllByTestId("proxmox-node-alerts-item")
        .map((row: HTMLElement) => {
          // Each alert's own name, above its one-line summary.
          return row.querySelector("div.font-medium")?.textContent;
        }),
    ).toEqual([
      "Node Offline",
      "Node Restarted",
      "High Node CPU Usage",
      "High Node Memory Usage",
      "Node Fenced",
    ]);
    expect(
      within(alerts).getByTestId("proxmox-node-alerts-turn-on"),
    ).toHaveTextContent("Turn on 5 alerts");
    expect(
      within(alerts).getByTestId("proxmox-node-alerts-turn-on"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`${CLUSTER_PATH}/recommendations?`),
    );
  });
});

describe("a guest's page", () => {
  test("its hero: kind, VMID, size, tags, its node and cluster a step away", async () => {
    await renderPage(
      ProxmoxClusterGuestDetail,
      "qemu%2F100",
      "proxmox-guest-hero",
    );

    expect(screen.getByTestId("proxmox-guest-hero-status")).toHaveTextContent(
      "Running",
    );
    const location: HTMLElement = screen.getByTestId(
      "proxmox-guest-hero-location",
    );
    expect(location).toHaveTextContent("On node pve1 of cluster pve-prod");
    expect(within(location).getByText("pve1").closest("a")).toHaveAttribute(
      "href",
      `${CLUSTER_PATH}/nodes/${encodeURIComponent("node/pve1")}`,
    );
    expect(screen.getByTestId("proxmox-guest-hero-chips")).toHaveTextContent(
      "VMVMID 1004 cores8.0 GiB memory64.0 GiB diskprodweb",
    );
  });

  test("a good last backup: when it finished, how big it was and how long it took", async () => {
    await renderPage(
      ProxmoxClusterGuestDetail,
      "qemu%2F100",
      "proxmox-guest-hero",
    );

    expect(tile("proxmox-guest-tiles", "Last Backup")).toHaveTextContent(
      "OKfinished 7 hours ago · 18.4 GiB in 3m 32s",
    );
    expect(screen.queryByTestId("proxmox-guest-attention")).toBeNull();
  });

  test("a failed last backup: when, the last good one, and on the attention list; a lock shows as what it is", async () => {
    await renderPage(
      ProxmoxClusterGuestDetail,
      "lxc%2F105",
      "proxmox-guest-hero",
    );

    expect(tile("proxmox-guest-tiles", "Last Backup")).toHaveTextContent(
      "Failedfinished 2 hours ago · last good yesterday",
    );
    expect(attentionRows("proxmox-guest-attention")).toEqual([
      "ci-runner: Last backup failed",
    ]);
    expect(
      screen
        .getAllByTestId("proxmox-guest-hero-badge")
        .map((badge: HTMLElement) => {
          return badge.textContent;
        }),
    ).toEqual(["Backup running"]);
    // A container's disk use is known, and its alerts include its root disk.
    expect(tile("proxmox-guest-tiles", "Disk")).toHaveTextContent(
      "37.5%12.0 GiB of 32.0 GiB",
    );
    expect(
      (await screen.findByTestId("proxmox-guest-alerts")).textContent,
    ).toContain("Container Root Disk Near Full");
  });

  test("a template: never running, never in need of anything, no host to look inside", async () => {
    await renderPage(
      ProxmoxClusterGuestDetail,
      "qemu%2F9000",
      "proxmox-guest-hero",
    );

    expect(screen.getByTestId("proxmox-guest-hero-status")).toHaveTextContent(
      "Template",
    );
    expect(screen.queryByTestId("proxmox-guest-attention")).toBeNull();
    expect(screen.getByTestId("proxmox-guest-details-type")).toHaveTextContent(
      "VM template",
    );
    expect(screen.queryByText("Process-Level Visibility")).toBeNull();
  });

  test("a stopped guest that starts on boot needs a look", async () => {
    await renderPage(
      ProxmoxClusterGuestDetail,
      "qemu%2F104",
      "proxmox-guest-hero",
    );

    expect(screen.getByTestId("proxmox-guest-hero-status")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(attentionRows("proxmox-guest-attention")).toEqual([
      "mail: Stopped, but starts on boot, In no backup job",
    ]);
    expect(tile("proxmox-guest-tiles", "Last Backup")).toHaveTextContent(
      "Nonein no backup job",
    );
  });

  test("a guest not in the inventory says so", async () => {
    await renderPage(
      ProxmoxClusterGuestDetail,
      "qemu%2F999",
      "proxmox-guest-hero",
    );

    expect(screen.getByTestId("proxmox-guest-not-reported")).toHaveTextContent(
      "Guest details not reported yet.",
    );
    expect(screen.getByTestId("proxmox-guest-hero-name")).toHaveTextContent(
      "999",
    );
  });
});

describe("a storage's page", () => {
  test("its hero: available or not, shared or local, its type and size", async () => {
    await renderPage(
      ProxmoxClusterStorageDetail,
      "storage%2Fpve1%2Fpbs",
      "proxmox-storage-hero",
    );

    expect(screen.getByTestId("proxmox-storage-hero-status")).toHaveTextContent(
      "Unavailable",
    );
    expect(
      screen
        .getAllByTestId("proxmox-storage-hero-badge")
        .map((badge: HTMLElement) => {
          return badge.textContent;
        }),
    ).toEqual(["Shared"]);
    expect(
      screen.getByTestId("proxmox-storage-hero-location"),
    ).toHaveTextContent("Storage on node pve1 of cluster pve-prod");
    expect(attentionRows("proxmox-storage-attention")).toEqual([
      "pbs: Unavailable",
    ]);
    expect(
      screen.getByTestId("proxmox-storage-details-content"),
    ).toHaveTextContent("Backups");
  });

  test("a storage filling up: how full, what is free, and that it needs a look", async () => {
    await renderPage(
      ProxmoxClusterStorageDetail,
      "storage%2Fpve1%2Flocal-zfs",
      "proxmox-storage-hero",
    );

    expect(tile("proxmox-storage-tiles", "Used")).toHaveTextContent(
      "91.0%91.0 GiB of 100 GiB",
    );
    expect(tile("proxmox-storage-tiles", "Free")).toHaveTextContent(
      "9.0 GiBof 100 GiB",
    );
    expect(attentionRows("proxmox-storage-attention")).toEqual([
      "local-zfs: 91% full",
    ]);
    expect(
      screen.getByTestId("proxmox-storage-details-type"),
    ).toHaveTextContent("ZFS");
    expect(
      screen.getByTestId("proxmox-storage-details-content"),
    ).toHaveTextContent("Disk images, Container disks");
  });
});

describe("the cluster's storage list", () => {
  test("names each storage's type and whether it is shared", async () => {
    mockLastParam = CLUSTER_ID;
    render(<ProxmoxClusterStorage {...PAGE_PROPS} />);
    await screen.findByText("local-zfs");
    await flush();

    expect(screen.getByText("local-zfs").closest("tr")).toHaveTextContent(
      "ZFS",
    );
    expect(screen.getByText("local-zfs").closest("tr")).toHaveTextContent(
      "Local",
    );
    expect(screen.getByText("pbs").closest("tr")).toHaveTextContent(
      "Proxmox Backup Server",
    );
    expect(screen.getByText("pbs").closest("tr")).toHaveTextContent("Shared");
  });
});
