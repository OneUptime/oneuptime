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
 * The (i) tooltips on the Proxmox cluster overview, rendered for real with
 * only the network, the line charts and the self-fetching shared cards
 * replaced.
 *
 * Every metric title - golden tiles, chart cards, the HA chips, the summary
 * strip, the replication columns, the Ceph card and the top-consumer lists -
 * is checked for an (i) whose tooltip is the matching
 * PROXMOX_METRIC_DESCRIPTIONS entry, with nothing interactive nested around
 * it. Then the page is fed data that tells the difference, and the claims
 * the descriptions make ("the last 5 minutes", "a big node counts more",
 * "in bytes", "counted once for each node", "the fullest volume", "left out
 * after 15 minutes") are checked against what it shows.
 */

const CLUSTER_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const CEPH_ID: string = "0193c0de-7777-4aaa-8bbb-00000000ceph";
const NOW: Date = new Date("2026-09-24T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsAggregateMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

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
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
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
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
      },
      getLastParamAsString: (): string => {
        return "0193c0de-7777-4aaa-8bbb-000000000007";
      },
      navigate: (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
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
 * The line chart is replaced by a recorder that writes the series it was
 * given onto the DOM, so a test can read what a chart card plots.
 */
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: {
      data: Array<{ seriesName: string; data: Array<{ x: Date; y: number }> }>;
    }) => {
      return (
        <div
          data-testid="line-chart"
          data-series={JSON.stringify(
            props.data.map(
              (s: {
                seriesName: string;
                data: Array<{ x: Date; y: number }>;
              }) => {
                return {
                  name: s.seriesName,
                  points: s.data.map((p: { x: Date; y: number }) => {
                    return [new Date(p.x).toISOString(), p.y];
                  }),
                };
              },
            ),
          )}
        />
      );
    },
  };
});

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

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="time-range-picker" />;
      },
    };
  },
);

import ProxmoxClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Index";
import {
  PROXMOX_METRIC_DESCRIPTIONS,
  ProxmoxMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/ProxmoxMetricDescriptions";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import ValueFormatter from "../../../Utils/ValueFormatter";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- fixtures

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

type Row = Record<string, unknown>;
type Point = { timestamp: Date; value: number; attributes: Row };

let cluster: Row;
let cephCluster: Row;
let inventory: Array<Row>;
let series: Record<string, Array<Point>>;
// Aggregate calls held back until the test releases them.
let holdAggregates: boolean;
let releaseAggregates: () => void;

function point(minutes: number, id: string, value: number): Point {
  return { timestamp: minutesAgo(minutes), value, attributes: { id } };
}

function arrange(): void {
  cluster = {
    _id: CLUSTER_ID,
    name: "pve-prod",
    description: "",
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    pveVersion: "8.2.4",
    agentVersion: "1.4.0",
    nodeCount: 3,
    onlineNodeCount: 2,
    guestCount: 3,
    storageCount: 3,
    guestsWithoutBackupCount: 1,
    cephClusterId: CEPH_ID,
  };

  cephCluster = {
    _id: CEPH_ID,
    name: "ceph-prod",
    healthStatus: 1,
    capacityUsedPercent: 81.5,
  };

  inventory = [
    {
      kind: "Node",
      externalId: "node/pve1",
      name: "pve1",
      isUp: true,
      haState: "online",
      latestCpuPercent: 10,
      metricsUpdatedAt: minutesAgo(1),
    },
    {
      kind: "Node",
      externalId: "node/pve2",
      name: "pve2",
      isUp: true,
      haState: "online",
      metricsUpdatedAt: minutesAgo(1),
    },
    {
      kind: "Node",
      externalId: "node/pve3",
      name: "pve3",
      isUp: false,
      metricsUpdatedAt: minutesAgo(1),
    },
    {
      kind: "Guest",
      externalId: "qemu/100",
      name: "web",
      vmid: 100,
      isUp: true,
      haState: "started",
      isBackedUp: true,
      latestCpuPercent: 75,
      latestMemoryBytes: 3 * GIB,
      latestMemoryPercent: 75,
      metricsUpdatedAt: minutesAgo(1),
    },
    {
      kind: "Guest",
      externalId: "lxc/101",
      name: "db",
      vmid: 101,
      isUp: true,
      isBackedUp: false,
      latestCpuPercent: 20,
      latestMemoryBytes: GIB,
      latestMemoryPercent: 50,
      metricsUpdatedAt: minutesAgo(1),
    },
    {
      // The busiest guest - but its figures are 20 minutes old.
      kind: "Guest",
      externalId: "qemu/102",
      name: "stale-guest",
      vmid: 102,
      isUp: true,
      isBackedUp: true,
      latestCpuPercent: 99,
      latestMemoryBytes: 30 * GIB,
      latestMemoryPercent: 99,
      metricsUpdatedAt: minutesAgo(20),
    },
    {
      kind: "Storage",
      externalId: "storage/pve1/local",
      name: "local",
      isUp: true,
      latestDiskBytes: 90 * GIB,
      maxDiskBytes: 100 * GIB,
    },
    {
      // One NFS share, reported by both nodes that mount it.
      kind: "Storage",
      externalId: "storage/pve1/nfs",
      name: "nfs",
      isUp: true,
      latestDiskBytes: 100 * GIB,
      maxDiskBytes: 1000 * GIB,
    },
    {
      kind: "Storage",
      externalId: "storage/pve2/nfs",
      name: "nfs",
      isUp: true,
      latestDiskBytes: 100 * GIB,
      maxDiskBytes: 1000 * GIB,
    },
  ];

  series = {
    /*
     * 20 minutes ago only pve1 (4 cores) reports, at 90%. 2 minutes ago
     * pve1 is at 10% and pve2 (12 cores) at 50%: capacity-weighted that is
     * (0.1 x 4 + 0.5 x 12) / 16 = 40%, a plain mean would be 30%, and the
     * whole range would average to 65%.
     */
    pve_cpu_usage_ratio: [
      point(20, "node/pve1", 0.9),
      point(2, "node/pve1", 0.1),
      point(2, "node/pve2", 0.5),
      point(2, "qemu/100", 0.75),
    ],
    pve_cpu_usage_limit: [
      point(20, "node/pve1", 4),
      point(2, "node/pve1", 4),
      point(2, "node/pve2", 12),
    ],
    // 16 of 16 GiB used 20 minutes ago, 8 of 16 GiB 2 minutes ago.
    pve_memory_usage_bytes: [
      point(20, "node/pve1", 8 * GIB),
      point(20, "node/pve2", 8 * GIB),
      point(2, "node/pve1", 2 * GIB),
      point(2, "node/pve2", 6 * GIB),
      point(2, "qemu/100", 3 * GIB),
    ],
    pve_memory_size_bytes: [
      point(20, "node/pve1", 8 * GIB),
      point(20, "node/pve2", 8 * GIB),
      point(2, "node/pve1", 8 * GIB),
      point(2, "node/pve2", 8 * GIB),
    ],
    // The shared NFS share appears twice; the node root disk is not storage.
    pve_disk_usage_bytes: [
      point(2, "storage/pve1/local", 90 * GIB),
      point(2, "storage/pve1/nfs", 100 * GIB),
      point(2, "storage/pve2/nfs", 100 * GIB),
      point(2, "node/pve1", 5 * GIB),
    ],
    // 1000 B/s in and 2000 B/s out between the two samples.
    pve_network_receive_bytes: [
      point(20, "qemu/100", 0),
      point(2, "qemu/100", 1080000),
    ],
    pve_network_transmit_bytes: [
      point(20, "qemu/100", 0),
      point(2, "qemu/100", 2160000),
    ],
    pve_replication_info: [
      {
        timestamp: minutesAgo(1),
        value: 1,
        attributes: {
          id: "100-0",
          guest: "100",
          source: "pve1",
          target: "pve2",
        },
      },
    ],
    pve_replication_last_sync_timestamp_seconds: [
      point(1, "100-0", (NOW.getTime() - 2 * 60 * MINUTE) / 1000),
    ],
    pve_replication_duration_seconds: [point(1, "100-0", 42)],
    pve_replication_failed_syncs: [point(1, "100-0", 2)],
  };

  holdAggregates = false;
  releaseAggregates = (): void => {};

  modelGetItemMock.mockImplementation((request: unknown) => {
    const modelType: unknown = (request as { modelType: unknown }).modelType;
    return Promise.resolve(modelType === CephCluster ? cephCluster : cluster);
  });

  modelGetListMock.mockImplementation((request: unknown) => {
    const modelType: unknown = (request as { modelType: unknown }).modelType;
    return Promise.resolve({
      data: modelType === ProxmoxResource ? inventory : [],
      count: modelType === ProxmoxResource ? inventory.length : 0,
    });
  });

  let pending: Array<() => void> = [];

  releaseAggregates = (): void => {
    const waiting: Array<() => void> = pending;
    pending = [];
    holdAggregates = false;
    waiting.forEach((resume: () => void) => {
      resume();
    });
  };

  analyticsAggregateMock.mockImplementation((request: unknown) => {
    const name: string = (
      request as { aggregateBy: { query: { name: string } } }
    ).aggregateBy.query.name;
    const answer: () => { data: Array<Point> } = () => {
      return { data: series[name] || [] };
    };

    if (holdAggregates) {
      return new Promise((resolve: (value: unknown) => void) => {
        pending.push(() => {
          resolve(answer());
        });
      });
    }

    return Promise.resolve(answer());
  });
}

// ----------------------------------------------------------------- helpers

async function flush(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderOverview(): Promise<void> {
  render(<ProxmoxClusterOverview {...PAGE_PROPS} />);
  await screen.findByText("pve-prod");
  await flush();
}

function infoButtons(title: string): Array<HTMLElement> {
  return screen.queryAllByRole("button", { name: `About ${title}` });
}

function infoButton(title: string, index: number = 0): HTMLElement {
  const found: Array<HTMLElement> = infoButtons(title);
  expect(found.length).toBeGreaterThan(index);
  return found[index]!;
}

function allInfoLabels(): Array<string> {
  return screen
    .queryAllByRole("button", { name: /^About / })
    .map((button: HTMLElement) => {
      return (button.getAttribute("aria-label") || "").replace("About ", "");
    });
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
  await act(async () => {
    jest.advanceTimersByTime(400);
  });

  return text;
}

function cardOf(button: HTMLElement): HTMLElement {
  return button.closest("div.rounded-xl") as HTMLElement;
}

type ChartSeries = Array<{ name: string; points: Array<[string, number]> }>;

function chartSeriesOf(button: HTMLElement): ChartSeries {
  const chart: HTMLElement | null = cardOf(button).querySelector(
    "[data-testid='line-chart']",
  );
  expect(chart).not.toBeNull();
  return JSON.parse(chart!.getAttribute("data-series") || "[]") as ChartSeries;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    analyticsAggregateMock,
    navigateMock,
  ]) {
    mock.mockReset();
  }
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

/*
 * Every (i) on the overview, in page order. A title that appears twice
 * (the CPU tile and the CPU chart) is matched by position.
 */
const OVERVIEW_INFO: Array<[string, ProxmoxMetric]> = [
  ["Cluster inventory counts", "clusterInventoryCounts"],
  ["High-availability states", "haStates"],
  ["Node Availability", "nodeAvailability"],
  ["CPU", "clusterCpu"],
  ["Memory", "clusterMemory"],
  ["Storage", "fullestStorage"],
  ["Guests", "guestsRunning"],
  ["Backup Coverage", "backupCoverage"],
  ["CPU", "cpuChart"],
  ["Memory", "memoryChart"],
  ["Storage", "storageChart"],
  ["Network", "networkChart"],
  ["Last Sync", "replicationLastSync"],
  ["Duration", "replicationDuration"],
  ["Failed Syncs", "replicationFailedSyncs"],
  ["Capacity used", "cephCapacityUsed"],
  ["Cluster Health", "clusterHealth"],
  ["Quorum", "quorum"],
  ["Nodes", "nodeCount"],
  ["Guests", "guestCount"],
  ["Storage", "storageCount"],
  ["Agent Status", "agentStatus"],
  ["CPU Usage", "topGuestsByCpu"],
  ["Memory Usage", "topGuestsByMemory"],
];

// Position of each entry among the (i)s that share its title.
const OVERVIEW_INFO_WITH_INDEX: Array<[string, ProxmoxMetric, number]> =
  OVERVIEW_INFO.map(
    (
      [title, key]: [string, ProxmoxMetric],
      position: number,
    ): [string, ProxmoxMetric, number] => {
      const index: number = OVERVIEW_INFO.slice(0, position).filter(
        ([earlier]: [string, ProxmoxMetric]) => {
          return earlier === title;
        },
      ).length;
      return [title, key, index];
    },
  );

// ------------------------------------------------------------------- tests

describe("Proxmox cluster overview: every metric has an (i)", () => {
  test("the page shows exactly these (i)s, in this order", async () => {
    await renderOverview();

    expect(allInfoLabels()).toEqual(
      OVERVIEW_INFO.map(([title]: [string, ProxmoxMetric]) => {
        return title;
      }),
    );
  });

  test.each(OVERVIEW_INFO_WITH_INDEX)(
    "%s explains itself with %s",
    async (title: string, key: ProxmoxMetric, index: number) => {
      await renderOverview();

      expect(await tooltipTextOf(infoButton(title, index))).toBe(
        PROXMOX_METRIC_DESCRIPTIONS[key],
      );
    },
  );

  test("no (i) sits inside a link, a button or a card that acts as one", async () => {
    await renderOverview();

    const buttons: Array<HTMLElement> = screen.queryAllByRole("button", {
      name: /^About /,
    });

    expect(buttons.length).toBe(OVERVIEW_INFO.length);

    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(
        button.parentElement?.closest("a, button, [role='button']"),
      ).toBeNull();
    }
  });

  test("the metadata in the hero and the details card gets no (i)", async () => {
    await renderOverview();

    for (const title of [
      "Last seen",
      "Cluster Details",
      "Resources",
      "Nodes online",
    ]) {
      expect(infoButtons(title)).toHaveLength(0);
    }
  });
});

describe("Proxmox cluster overview: the hero's count chips", () => {
  test("the count chips carry one (i), after the chips it explains", async () => {
    await renderOverview();

    const button: HTMLElement = infoButton("Cluster inventory counts");
    const row: HTMLElement = button.parentElement?.closest(
      "div.flex-wrap",
    ) as HTMLElement;

    expect(row).toHaveTextContent("2/3 nodes online");
    expect(row).toHaveTextContent("3/3 guests running");
    /*
     * local plus one NFS share that two nodes report: 3, not 2 - shared
     * storage is counted once per node, as the (i) says.
     */
    expect(row).toHaveTextContent("3 storage volumes");
    // The chips it explains come first; the (i) closes the row.
    expect(row.lastElementChild?.contains(button)).toBe(true);
    expect(await tooltipTextOf(button)).toBe(
      PROXMOX_METRIC_DESCRIPTIONS.clusterInventoryCounts,
    );
  });

  test("a hero with only version chips gets no counts (i)", async () => {
    inventory = [];
    cluster["nodeCount"] = 0;
    cluster["onlineNodeCount"] = 0;
    cluster["guestCount"] = 0;
    cluster["storageCount"] = 0;

    await renderOverview();

    expect(screen.getByText("PVE 8.2.4")).toBeInTheDocument();
    expect(infoButtons("Cluster inventory counts")).toHaveLength(0);
  });
});

describe("Proxmox cluster overview: linked summary cards", () => {
  test.each([
    ["Nodes", "Open the node list", "/nodes"],
    ["Guests", "Open the guest list", "/guests"],
    ["Storage", "Open the storage list", "/storage"],
  ])(
    "the %s card still opens its list through a real link",
    async (title: string, linkName: string, suffix: string) => {
      await renderOverview();

      const link: HTMLElement = screen.getByRole("link", { name: linkName });

      expect(link.getAttribute("href")).toBe(
        `/dashboard/10000000-0000-4000-8000-000000000001/proxmox/${CLUSTER_ID}${suffix}`,
      );

      fireEvent.click(link);

      expect(navigateMock).toHaveBeenCalledTimes(1);
      expect(String(navigateMock.mock.calls[0]![0])).toBe(
        link.getAttribute("href"),
      );

      /*
       * The card's own (i) sits beside the link, not inside it, and asking
       * what the number means does not navigate.
       */
      const summaryInfo: HTMLElement = infoButtons(title).slice(-1)[0]!;
      expect(link.contains(summaryInfo)).toBe(false);
      expect(link.parentElement?.contains(summaryInfo)).toBe(true);

      navigateMock.mockClear();
      fireEvent.click(summaryInfo);
      fireEvent.keyDown(summaryInfo, { key: "Enter" });
      expect(navigateMock).not.toHaveBeenCalled();
    },
  );

  test("the linked cards show their counts and the offline call-out", async () => {
    await renderOverview();

    const nodesCard: HTMLElement = cardOf(infoButtons("Nodes")[0]!);

    expect(nodesCard).toHaveTextContent("3");
    expect(nodesCard).toHaveTextContent("(1 offline)");
    expect(cardOf(infoButtons("Guests")[1]!)).toHaveTextContent("3");
    expect(cardOf(infoButtons("Storage")[2]!)).toHaveTextContent("3");
  });

  test("no summary card is a role=button any more", async () => {
    await renderOverview();

    for (const title of [
      "Cluster Health",
      "Quorum",
      "Nodes",
      "Guests",
      "Storage",
      "Agent Status",
    ]) {
      const card: HTMLElement = cardOf(infoButtons(title).slice(-1)[0]!);
      expect(card).not.toHaveAttribute("role");
      expect(card).not.toHaveAttribute("tabindex");
    }
  });

  test("the Quorum value carries no second, native tooltip", async () => {
    await renderOverview();

    const card: HTMLElement = cardOf(infoButton("Quorum"));
    const value: HTMLElement = within(card).getByText("2/3");

    expect(value).not.toHaveAttribute("title");
    expect(card.querySelector("[title]")).toBeNull();
  });
});

describe("Proxmox cluster overview: chart cards before and after loading", () => {
  test("the chart skeletons already carry their (i)", async () => {
    holdAggregates = true;
    render(<ProxmoxClusterOverview {...PAGE_PROPS} />);
    await screen.findByText("pve-prod");
    await flush();

    // Tiles are still grey blocks; the four chart cards show their titles.
    expect(screen.queryAllByTestId("line-chart")).toHaveLength(0);
    expect(infoButtons("CPU")).toHaveLength(1);
    expect(await tooltipTextOf(infoButton("CPU"))).toBe(
      PROXMOX_METRIC_DESCRIPTIONS.cpuChart,
    );
    expect(await tooltipTextOf(infoButton("Network"))).toBe(
      PROXMOX_METRIC_DESCRIPTIONS.networkChart,
    );

    await act(async () => {
      releaseAggregates();
    });
    await flush();

    expect(screen.queryAllByTestId("line-chart")).toHaveLength(4);
    expect(infoButtons("CPU")).toHaveLength(2);
    expect(await tooltipTextOf(infoButton("CPU", 1))).toBe(
      PROXMOX_METRIC_DESCRIPTIONS.cpuChart,
    );
  });
});

describe("Proxmox cluster overview: the descriptions match what the page computes", () => {
  test("the CPU tile averages the last 5 minutes, weighted by cores", async () => {
    await renderOverview();

    // 40% weighted; a plain mean would be 30%, the whole range 65%.
    const tile: HTMLElement = cardOf(infoButton("CPU", 0));
    expect(tile).toHaveTextContent("40.0%");
    expect(tile).not.toHaveTextContent("30.0%");
    expect(tile).not.toHaveTextContent("65.0%");
  });

  test("with no data in the last 5 minutes the tile falls back to the whole range", async () => {
    series["pve_cpu_usage_ratio"] = [
      point(20, "node/pve1", 0.9),
      point(10, "node/pve1", 0.3),
    ];
    series["pve_cpu_usage_limit"] = [
      point(20, "node/pve1", 4),
      point(10, "node/pve1", 4),
    ];

    await renderOverview();

    expect(cardOf(infoButton("CPU", 0))).toHaveTextContent("60.0%");
  });

  test("the CPU chart covers the whole range, not just the tile window", async () => {
    await renderOverview();

    const cpu: ChartSeries = chartSeriesOf(infoButton("CPU", 1));
    expect(
      cpu[0]!.points.map((p: [string, number]) => {
        return p[1];
      }),
    ).toEqual([90, 40]);
  });

  test("the Memory tile is a percentage of combined memory, the chart is bytes", async () => {
    await renderOverview();

    const tile: HTMLElement = cardOf(infoButton("Memory", 0));
    expect(tile).toHaveTextContent("50.0%");
    // The sub-line is the latest point, not the average.
    expect(tile).toHaveTextContent("8.0 GiB of 16.0 GiB");

    const memory: ChartSeries = chartSeriesOf(infoButton("Memory", 1));
    expect(
      memory[0]!.points.map((p: [string, number]) => {
        return p[1];
      }),
    ).toEqual([16 * GIB, 8 * GIB]);
  });

  test("the Storage chart counts shared storage once per node and skips node disks", async () => {
    await renderOverview();

    const storage: ChartSeries = chartSeriesOf(infoButton("Storage", 1));
    // 90 (local) + 100 + 100 (the same NFS share, twice) = 290 GiB.
    expect(
      storage[0]!.points.map((p: [string, number]) => {
        return p[1];
      }),
    ).toEqual([290 * GIB]);
  });

  test("the Storage tile is the single fullest volume, not an average", async () => {
    await renderOverview();

    const tile: HTMLElement = cardOf(infoButton("Storage", 0));
    expect(tile).toHaveTextContent("90.0%");
    expect(tile).toHaveTextContent("fullest: local");
  });

  test("the Network chart and the Guests tile's net figure are per-second rates", async () => {
    await renderOverview();

    const network: ChartSeries = chartSeriesOf(infoButton("Network"));
    expect(
      network.map((s: { name: string; points: Array<[string, number]> }) => {
        return [
          s.name,
          s.points.map((p: [string, number]) => {
            return p[1];
          }),
        ];
      }),
    ).toEqual([
      ["In", [1000]],
      ["Out", [2000]],
    ]);

    const guests: HTMLElement = cardOf(infoButton("Guests", 0));
    expect(guests).toHaveTextContent("3/3");
    expect(guests).toHaveTextContent(
      `running · net ${ValueFormatter.formatValue(3000, "By/s")}`,
    );
  });

  test("backup coverage counts job coverage per guest", async () => {
    await renderOverview();

    const tile: HTMLElement = cardOf(infoButton("Backup Coverage"));
    expect(tile).toHaveTextContent("2/3");
    expect(tile).toHaveTextContent("1 guest not in any backup job");
  });

  test("top consumers leave out a guest with no update in 15 minutes", async () => {
    await renderOverview();

    const cpuSection: HTMLElement = infoButton("CPU Usage").closest(
      "div.p-5",
    ) as HTMLElement;
    expect(cpuSection).toHaveTextContent("web");
    expect(cpuSection).toHaveTextContent("75.0%");
    expect(cpuSection).not.toHaveTextContent("stale-guest");

    const memorySection: HTMLElement = infoButton("Memory Usage").closest(
      "div.p-5",
    ) as HTMLElement;
    expect(memorySection).toHaveTextContent("3.0 GiB");
    expect(memorySection).not.toHaveTextContent("stale-guest");
  });

  test("quorum and node availability count online nodes out of all nodes", async () => {
    await renderOverview();

    expect(cardOf(infoButton("Quorum"))).toHaveTextContent("2/3");
    expect(cardOf(infoButton("Node Availability"))).toHaveTextContent("2/3");
  });

  test("an offline node makes the cluster Unhealthy", async () => {
    await renderOverview();

    expect(cardOf(infoButton("Cluster Health"))).toHaveTextContent("Unhealthy");
  });

  test("with every node online, a failing replication job alone makes it Degraded", async () => {
    inventory = inventory
      .filter((row: Row) => {
        return row["externalId"] !== "node/pve3";
      })
      .map((row: Row) => {
        return {
          ...row,
          isBackedUp: row["kind"] === "Guest" ? true : undefined,
        };
      })
      .map((row: Row) => {
        // Keep every storage volume under 85%.
        return row["externalId"] === "storage/pve1/local"
          ? { ...row, latestDiskBytes: 50 * GIB }
          : row;
      });

    await renderOverview();

    expect(cardOf(infoButton("Cluster Health"))).toHaveTextContent("Degraded");
    expect(
      screen.getByText("Why is this cluster degraded?"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 failed syncs")).toBeInTheDocument();
  });

  test("a disconnected agent turns Cluster Health into Unknown", async () => {
    cluster["otelCollectorStatus"] = "disconnected";

    await renderOverview();

    expect(cardOf(infoButton("Cluster Health"))).toHaveTextContent("Unknown");
    expect(cardOf(infoButton("Agent Status"))).toHaveTextContent(
      "Disconnected",
    );
  });

  test("replication shows the sync age, duration and failures the columns explain", async () => {
    await renderOverview();

    const table: HTMLElement = infoButton("Last Sync").closest(
      "table",
    ) as HTMLElement;
    const row: HTMLElement = within(table)
      .getByText("100-0")
      .closest("tr") as HTMLElement;

    // Two hours without a sync is past the 1-hour amber step.
    const age: HTMLElement = within(row).getByText("2h ago");
    expect(age.className).toContain("text-amber-700");
    expect(row).toHaveTextContent("42s");
    expect(within(row).getByText("2").className).toContain("text-red-700");
  });

  test("the Ceph card shows the linked cluster's capacity snapshot", async () => {
    await renderOverview();

    const capacity: HTMLElement = infoButton("Capacity used").closest(
      "div.flex-1",
    ) as HTMLElement;
    expect(capacity).toHaveTextContent("81.5%");
  });

  test("the HA chips count each state, and their (i) explains them", async () => {
    await renderOverview();

    const row: HTMLElement = infoButton("High-availability states")
      .parentElement as HTMLElement;
    expect(row).toHaveTextContent("2HA online");
    expect(row).toHaveTextContent("1HA started");
  });
});
