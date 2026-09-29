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
 * The (i) tooltips on the Proxmox node, guest and storage pages - their
 * detail pages (summary fields and the throughput chart headers), their
 * lists (column headers) and the Insights disk-throughput chart.
 *
 * Each page is rendered for real with the network, the charts and the
 * metric-view tab replaced. Every metric field or column is checked for an
 * (i) whose tooltip is its PROXMOX_METRIC_DESCRIPTIONS entry, metadata
 * (names, IDs, "Last Seen") for having none, and the claims the texts make
 * ("N/A after 15 minutes", "the last value the agent sent", "uptime",
 * "a straight-line estimate over 24 hours") against what the page shows.
 */

const CLUSTER_ID: string = "0193c0de-8888-4aaa-8bbb-000000000008";
const NOW: Date = new Date("2026-09-24T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const GIB: number = 1024 * 1024 * 1024;

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsAggregateMock: MockFunction = getJestMockFunction();
const rateChartMock: MockFunction = getJestMockFunction();

let mockLastParam: string = "node%2Fpve1";

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
        return new ObjectIDType("0193c0de-8888-4aaa-8bbb-000000000008");
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
 * The metric-view tab draws ChartGroup charts, which carry their own visible
 * descriptions; only the extra rate charts below them are this suite's
 * business, so the tab just renders those.
 */
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Proxmox/ProxmoxRateChart",
  () => {
    return {
      __esModule: true,
      default: (props: { series: Array<{ metricName: string }> }) => {
        rateChartMock(props);
        return (
          <div data-testid="proxmox-rate-chart">
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        title?: React.ReactNode;
        description?: string;
        children?: React.ReactNode;
        renderExtraCharts?: (range: {
          startValue: Date;
          endValue: Date;
        }) => React.ReactNode;
      }) => {
        return (
          <section data-testid="embedded-metric-card">
            <div>{props.title}</div>
            <p>{props.description}</p>
            {props.children}
            {props.renderExtraCharts
              ? props.renderExtraCharts({
                  startValue: new Date("2026-09-24T11:00:00.000Z"),
                  endValue: new Date("2026-09-24T12:00:00.000Z"),
                })
              : null}
          </section>
        );
      },
    };
  },
);

import ProxmoxClusterNodeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/NodeDetail";
import ProxmoxClusterGuestDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/GuestDetail";
import ProxmoxClusterStorageDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/StorageDetail";
import ProxmoxClusterNodes from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Nodes";
import ProxmoxClusterGuests from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Guests";
import ProxmoxClusterStorage from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Storage";
import ProxmoxClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Insights";
import {
  PROXMOX_METRIC_DESCRIPTIONS,
  ProxmoxMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/ProxmoxMetricDescriptions";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- fixtures

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

type Row = Record<string, unknown>;

let inventory: Array<Row>;
let diskSamples: Array<{ timestamp: Date; value: number }>;

function arrange(): void {
  inventory = [
    {
      kind: "Node",
      externalId: "node/pve1",
      name: "pve1",
      isUp: true,
      haState: "online",
      uptimeSeconds: 26 * 3600,
      latestCpuPercent: 10,
      latestMemoryBytes: 4 * GIB,
      maxMemoryBytes: 16 * GIB,
      metricsUpdatedAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
    },
    {
      // Has not reported for 20 minutes: the list hides its numbers.
      kind: "Node",
      externalId: "node/pve2",
      name: "pve2",
      isUp: true,
      uptimeSeconds: 3 * 3600,
      latestCpuPercent: 42,
      latestMemoryBytes: 8 * GIB,
      maxMemoryBytes: 16 * GIB,
      metricsUpdatedAt: minutesAgo(20),
      lastSeenAt: minutesAgo(20),
    },
    {
      kind: "Guest",
      externalId: "qemu/100",
      name: "web",
      vmid: 100,
      guestType: "qemu",
      parentNodeName: "pve1",
      isUp: true,
      haState: "started",
      onboot: true,
      isBackedUp: true,
      uptimeSeconds: 90 * 60,
      latestCpuPercent: 75,
      latestMemoryBytes: 3 * GIB,
      maxMemoryBytes: 4 * GIB,
      maxDiskBytes: 32 * GIB,
      metricsUpdatedAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
    },
    {
      kind: "Guest",
      externalId: "lxc/101",
      name: "db",
      vmid: 101,
      guestType: "lxc",
      parentNodeName: "pve2",
      isUp: false,
      isBackedUp: false,
      uptimeSeconds: 0,
      latestCpuPercent: 0,
      latestMemoryBytes: 0,
      maxMemoryBytes: 2 * GIB,
      metricsUpdatedAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
    },
    {
      kind: "Guest",
      externalId: "lxc/102",
      name: "cache",
      vmid: 102,
      guestType: "lxc",
      parentNodeName: "pve2",
      isUp: true,
      latestCpuPercent: 5,
      latestMemoryBytes: GIB,
      maxMemoryBytes: 2 * GIB,
      metricsUpdatedAt: minutesAgo(1),
      lastSeenAt: minutesAgo(1),
    },
    {
      kind: "Storage",
      externalId: "storage/pve1/local",
      name: "local",
      parentNodeName: "pve1",
      isUp: true,
      latestDiskBytes: 50 * GIB,
      maxDiskBytes: 100 * GIB,
      lastSeenAt: minutesAgo(1),
    },
    {
      kind: "Storage",
      externalId: "storage/pve2/backup",
      name: "backup",
      parentNodeName: "pve2",
      isUp: false,
      lastSeenAt: minutesAgo(1),
    },
  ];

  // 40 -> 45 -> 50 GiB over 24 hours: 10 GiB a day, 50 GiB left = 5 days.
  diskSamples = [
    { timestamp: new Date(NOW.getTime() - 24 * HOUR), value: 40 * GIB },
    { timestamp: new Date(NOW.getTime() - 12 * HOUR), value: 45 * GIB },
    { timestamp: NOW, value: 50 * GIB },
  ];

  modelGetItemMock.mockImplementation(() => {
    return Promise.resolve({ _id: CLUSTER_ID, name: "pve-prod" });
  });

  modelGetListMock.mockImplementation((request: unknown) => {
    const { modelType, query } = request as {
      modelType: unknown;
      query: Record<string, unknown>;
    };

    if (modelType !== ProxmoxResource) {
      return Promise.resolve({ data: [], count: 0 });
    }

    const rows: Array<Row> = inventory.filter((row: Row) => {
      return (
        (!query["kind"] || row["kind"] === query["kind"]) &&
        (!query["externalId"] || row["externalId"] === query["externalId"])
      );
    });

    return Promise.resolve({ data: rows, count: rows.length });
  });

  analyticsAggregateMock.mockImplementation((request: unknown) => {
    const name: string = (
      request as { aggregateBy: { query: { name: string } } }
    ).aggregateBy.query.name;

    return Promise.resolve({
      data: name === "pve_disk_usage_bytes" ? diskSamples : [],
    });
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

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
  lastParam: string,
  waitFor: string,
): Promise<void> {
  mockLastParam = lastParam;
  render(<Page {...PAGE_PROPS} />);
  await screen.findAllByText(waitFor);
  await flush();
}

function infoLabels(scope?: HTMLElement): Array<string> {
  return (scope ? within(scope) : screen)
    .queryAllByRole("button", { name: /^About / })
    .map((button: HTMLElement) => {
      return (button.getAttribute("aria-label") || "").replace("About ", "");
    });
}

function infoButton(title: string): HTMLElement {
  const found: Array<HTMLElement> = screen.getAllByRole("button", {
    name: `About ${title}`,
  });
  expect(found).toHaveLength(1);
  return found[0]!;
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

async function expectExplained(
  pairs: Array<[string, ProxmoxMetric]>,
): Promise<void> {
  for (const [title, key] of pairs) {
    expect({ title, text: await tooltipTextOf(infoButton(title)) }).toEqual({
      title,
      text: PROXMOX_METRIC_DESCRIPTIONS[key],
    });
  }
}

// A summary field's card, found by its title.
function fieldCard(title: string): HTMLElement {
  const label: HTMLElement = screen
    .getAllByText(title, { selector: "label span" })
    .find((el: HTMLElement) => {
      return el.textContent?.trim().startsWith(title);
    }) as HTMLElement;
  expect(label).toBeTruthy();
  return label.closest("div.rounded-xl") as HTMLElement;
}

function expectNoNestedInfoButtons(): void {
  for (const button of screen.queryAllByRole("button", {
    name: /^About /,
  })) {
    expect(
      button.parentElement?.closest("a, button, [role='button']"),
    ).toBeNull();
  }
}

async function openMetricsTab(): Promise<void> {
  fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
  await flush();
}

/*
 * The (i) sits in the header immediately above its rate chart, so a
 * reader can tell which chart it explains.
 */
function expectHeaderAboveChart(title: string, metricName: string): void {
  const header: HTMLElement = infoButton(title).parentElement as HTMLElement;
  expect(header).toHaveTextContent(title);
  const chart: Element | null = header.nextElementSibling;
  expect(chart).not.toBeNull();
  expect(chart!.getAttribute("data-testid")).toBe("proxmox-rate-chart");
  expect(chart!.textContent).toContain(metricName);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    analyticsAggregateMock,
    rateChartMock,
  ]) {
    mock.mockReset();
  }
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ------------------------------------------------------------ node detail

const NODE_FIELDS: Array<[string, ProxmoxMetric]> = [
  ["Status", "nodeStatus"],
  ["Uptime", "nodeUptime"],
  ["CPU", "nodeCpu"],
  ["Memory (Used / Total)", "nodeMemory"],
  ["HA State", "nodeHaState"],
];

describe("Proxmox node detail", () => {
  test("every metric field has an (i), in order, and metadata has none", async () => {
    await renderPage(ProxmoxClusterNodeDetail, "node%2Fpve1", "pve1");

    expect(infoLabels()).toEqual(
      NODE_FIELDS.map(([title]: [string, ProxmoxMetric]) => {
        return title;
      }),
    );
    for (const title of ["Node Name", "Cluster", "External ID", "Last Seen"]) {
      expect(fieldCard(title)).toBeTruthy();
      expect(infoLabels(fieldCard(title))).toEqual([]);
    }
  });

  test("each field's (i) shows its own description", async () => {
    await renderPage(ProxmoxClusterNodeDetail, "node%2Fpve1", "pve1");
    await expectExplained(NODE_FIELDS);
    expectNoNestedInfoButtons();
  });

  test("the fields show the latest report: uptime, CPU share and used / total memory", async () => {
    await renderPage(ProxmoxClusterNodeDetail, "node%2Fpve1", "pve1");

    expect(fieldCard("Uptime")).toHaveTextContent("1d 2h");
    expect(fieldCard("CPU")).toHaveTextContent("10.0%");
    expect(fieldCard("Memory (Used / Total)")).toHaveTextContent(
      "4.0 GiB / 16.0 GiB",
    );
    expect(fieldCard("HA State")).toHaveTextContent("online");
  });

  test("a detail page keeps showing the last value the agent sent, however old", async () => {
    // pve2 last reported 20 minutes ago; the list shows N/A, this does not.
    await renderPage(ProxmoxClusterNodeDetail, "node%2Fpve2", "pve2");

    expect(fieldCard("CPU")).toHaveTextContent("42.0%");
    expect(await tooltipTextOf(infoButton("CPU"))).toContain(
      "last value the agent sent",
    );
  });

  test("the throughput charts on the Metrics tab each carry an (i) in their header", async () => {
    await renderPage(ProxmoxClusterNodeDetail, "node%2Fpve1", "pve1");
    await openMetricsTab();

    expect(infoLabels()).toEqual(["Network Throughput", "Disk Throughput"]);
    await expectExplained([
      ["Network Throughput", "nodeNetworkThroughput"],
      ["Disk Throughput", "nodeDiskThroughput"],
    ]);
    expectHeaderAboveChart("Network Throughput", "pve_network_receive_bytes");
    expectHeaderAboveChart("Disk Throughput", "pve_disk_read_bytes");
  });
});

// ----------------------------------------------------------- guest detail

const GUEST_FIELDS: Array<[string, ProxmoxMetric]> = [
  ["Status", "guestStatus"],
  ["HA State", "guestHaState"],
  ["Start on Boot", "guestStartOnBoot"],
  ["Backup Job Coverage", "guestBackupCoverage"],
  ["Uptime", "guestUptime"],
  ["CPU", "guestCpu"],
  ["Memory (Used / Max)", "guestMemory"],
  ["Disk (Used / Max)", "guestDisk"],
];

describe("Proxmox guest detail", () => {
  test("every metric field has an (i), in order, and metadata has none", async () => {
    await renderPage(ProxmoxClusterGuestDetail, "qemu%2F100", "web");

    expect(infoLabels()).toEqual(
      GUEST_FIELDS.map(([title]: [string, ProxmoxMetric]) => {
        return title;
      }),
    );
    for (const title of [
      "Guest Name",
      "Cluster",
      "VMID",
      "Type",
      "Node",
      "External ID",
      "Last Seen",
    ]) {
      expect(infoLabels(fieldCard(title))).toEqual([]);
    }
  });

  test("each field's (i) shows its own description", async () => {
    await renderPage(ProxmoxClusterGuestDetail, "qemu%2F100", "web");
    await expectExplained(GUEST_FIELDS);
    expectNoNestedInfoButtons();
  });

  test("a QEMU VM with no disk figure explains why it reads N/A", async () => {
    await renderPage(ProxmoxClusterGuestDetail, "qemu%2F100", "web");

    expect(fieldCard("Disk (Used / Max)")).toHaveTextContent(
      "N/A — install the QEMU guest agent for disk usage",
    );
    expect(await tooltipTextOf(infoButton("Disk (Used / Max)"))).toContain(
      "QEMU guest agent",
    );
  });

  test("a measured disk figure carries the same (i)", async () => {
    inventory = inventory.map((row: Row) => {
      return row["externalId"] === "qemu/100"
        ? { ...row, latestDiskBytes: 8 * GIB }
        : row;
    });

    await renderPage(ProxmoxClusterGuestDetail, "qemu%2F100", "web");

    expect(fieldCard("Disk (Used / Max)")).toHaveTextContent(
      "8.0 GiB / 32.0 GiB",
    );
    expect(await tooltipTextOf(infoButton("Disk (Used / Max)"))).toBe(
      PROXMOX_METRIC_DESCRIPTIONS.guestDisk,
    );
  });

  test("CPU and memory are shares of what the guest was assigned", async () => {
    await renderPage(ProxmoxClusterGuestDetail, "qemu%2F100", "web");

    expect(fieldCard("CPU")).toHaveTextContent("75.0%");
    expect(fieldCard("Memory (Used / Max)")).toHaveTextContent(
      "3.0 GiB / 4.0 GiB",
    );
    expect(fieldCard("Backup Job Coverage")).toHaveTextContent(
      "In a backup job",
    );
  });

  test("the throughput charts on the Metrics tab each carry an (i) in their header", async () => {
    await renderPage(ProxmoxClusterGuestDetail, "qemu%2F100", "web");
    await openMetricsTab();

    expect(infoLabels()).toEqual(["Network Throughput", "Disk Throughput"]);
    await expectExplained([
      ["Network Throughput", "guestNetworkThroughput"],
      ["Disk Throughput", "guestDiskThroughput"],
    ]);
    expectHeaderAboveChart("Network Throughput", "pve_network_transmit_bytes");
    expectHeaderAboveChart("Disk Throughput", "pve_disk_write_bytes");
  });
});

// --------------------------------------------------------- storage detail

const STORAGE_FIELDS: Array<[string, ProxmoxMetric]> = [
  ["Status", "storageStatus"],
  ["Used", "storageUsed"],
  ["Total", "storageTotal"],
  ["Used %", "storageUsedPercent"],
  ["Growth Forecast", "storageGrowthForecast"],
];

describe("Proxmox storage detail", () => {
  test("every metric field has an (i), in order, and metadata has none", async () => {
    await renderPage(
      ProxmoxClusterStorageDetail,
      "storage%2Fpve1%2Flocal",
      "local",
    );

    expect(infoLabels()).toEqual(
      STORAGE_FIELDS.map(([title]: [string, ProxmoxMetric]) => {
        return title;
      }),
    );
    for (const title of [
      "Storage Name",
      "Cluster",
      "Node",
      "External ID",
      "Last Seen",
    ]) {
      expect(infoLabels(fieldCard(title))).toEqual([]);
    }
  });

  test("each field's (i) shows its own description", async () => {
    await renderPage(
      ProxmoxClusterStorageDetail,
      "storage%2Fpve1%2Flocal",
      "local",
    );
    await expectExplained(STORAGE_FIELDS);
  });

  test("the forecast is a straight line through the last 24 hours", async () => {
    await renderPage(
      ProxmoxClusterStorageDetail,
      "storage%2Fpve1%2Flocal",
      "local",
    );

    expect(fieldCard("Used %")).toHaveTextContent("50.0%");
    // 10 GiB a day and 50 GiB free: five days.
    expect(fieldCard("Growth Forecast")).toHaveTextContent(
      "will be full in ~5 days (linear fit over the last 24 h)",
    );

    const window: { startTimestamp: Date; endTimestamp: Date } = (
      analyticsAggregateMock.mock.calls[0]![0] as {
        aggregateBy: { startTimestamp: Date; endTimestamp: Date };
      }
    ).aggregateBy;
    expect(
      (window.endTimestamp.getTime() - window.startTimestamp.getTime()) / HOUR,
    ).toBe(24);
  });

  test("a shrinking volume gets no forecast, and so no forecast (i)", async () => {
    diskSamples = [...diskSamples]
      .reverse()
      .map(
        (
          sample: { timestamp: Date; value: number },
          index: number,
        ): { timestamp: Date; value: number } => {
          return {
            timestamp: diskSamples[index]!.timestamp,
            value: sample.value,
          };
        },
      );

    await renderPage(
      ProxmoxClusterStorageDetail,
      "storage%2Fpve1%2Flocal",
      "local",
    );

    expect(infoLabels()).not.toContain("Growth Forecast");
    expect(screen.queryByText("Growth Forecast")).not.toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ lists

function columnHeader(title: string): HTMLElement {
  return infoButton(title).closest("th") as HTMLElement;
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

describe("Proxmox nodes list", () => {
  test("Status, CPU, Memory and Age headers each explain their column", async () => {
    await renderPage(ProxmoxClusterNodes, CLUSTER_ID, "pve1");

    expect(infoLabels()).toEqual(["Status", "CPU", "Memory", "Age"]);
    await expectExplained([
      ["Status", "nodesTableStatus"],
      ["CPU", "nodesTableCpu"],
      ["Memory", "nodesTableMemory"],
      ["Age", "nodesTableUptime"],
    ]);
    for (const title of ["Status", "CPU", "Memory", "Age"]) {
      expect(columnHeader(title)).toBeTruthy();
    }
    expectNoNestedInfoButtons();
  });

  test("a node with no update in 15 minutes shows N/A for CPU and memory", async () => {
    await renderPage(ProxmoxClusterNodes, CLUSTER_ID, "pve1");

    const fresh: HTMLElement = rowOf("pve1");
    expect(fresh).toHaveTextContent("10.0%");
    expect(fresh).toHaveTextContent("25%");

    const stale: HTMLElement = rowOf("pve2");
    expect(within(stale).getAllByText("N/A")).toHaveLength(2);
    expect(stale).not.toHaveTextContent("42.0%");
  });

  test("the Age column is the node's uptime", async () => {
    await renderPage(ProxmoxClusterNodes, CLUSTER_ID, "pve1");

    expect(rowOf("pve1")).toHaveTextContent("1d 2h");
    expect(rowOf("pve2")).toHaveTextContent("3h 0m");
  });
});

describe("Proxmox guests list", () => {
  test("every metric column explains itself; identity columns do not", async () => {
    await renderPage(ProxmoxClusterGuests, CLUSTER_ID, "web");

    expect(infoLabels()).toEqual([
      "Status",
      "HA State",
      "Backup",
      "CPU",
      "Memory",
      "Age",
    ]);
    await expectExplained([
      ["Status", "guestsTableStatus"],
      ["HA State", "guestsTableHaState"],
      ["Backup", "guestsTableBackup"],
      ["CPU", "guestsTableCpu"],
      ["Memory", "guestsTableMemory"],
      ["Age", "guestsTableUptime"],
    ]);
    for (const title of ["VMID", "Type", "Node", "Name"]) {
      expect(
        screen.queryByRole("button", { name: `About ${title}` }),
      ).not.toBeInTheDocument();
    }
  });

  test("the Backup column shows the three values its (i) spells out", async () => {
    await renderPage(ProxmoxClusterGuests, CLUSTER_ID, "web");

    expect(rowOf("web")).toHaveTextContent("In job");
    expect(rowOf("db")).toHaveTextContent("Not backed up");
    expect(within(rowOf("cache")).getAllByText("-").length).toBeGreaterThan(0);
  });

  test("HA State shows a dash for a guest HA does not manage", async () => {
    await renderPage(ProxmoxClusterGuests, CLUSTER_ID, "web");

    expect(rowOf("web")).toHaveTextContent("started");
    expect(rowOf("cache")).not.toHaveTextContent("started");
  });

  test("a stopped guest shows a dash for its uptime", async () => {
    await renderPage(ProxmoxClusterGuests, CLUSTER_ID, "web");

    expect(rowOf("web")).toHaveTextContent("1h 30m");
    const stopped: HTMLElement = rowOf("db");
    expect(stopped).toHaveTextContent("Stopped");
    expect(stopped).not.toHaveTextContent(/\d+m\b/);
  });

  test("memory is compared with what the guest was assigned", async () => {
    await renderPage(ProxmoxClusterGuests, CLUSTER_ID, "web");

    // 3 of 4 GiB assigned.
    expect(rowOf("web")).toHaveTextContent("75%");
    expect(rowOf("web")).toHaveTextContent("3.00 GB / 4.00 GB");
  });
});

describe("Proxmox storage list", () => {
  test("Status, Used / Total and Age explain themselves; there are no CPU or memory columns", async () => {
    await renderPage(ProxmoxClusterStorage, CLUSTER_ID, "local");

    expect(infoLabels()).toEqual(["Status", "Used / Total", "Age"]);
    await expectExplained([
      ["Status", "storageTableStatus"],
      ["Used / Total", "storageTableUsage"],
      ["Age", "storageTableAge"],
    ]);
    expect(screen.queryByText("CPU")).not.toBeInTheDocument();
  });

  test("usage shows used, total and percentage, or N/A when a figure is missing", async () => {
    await renderPage(ProxmoxClusterStorage, CLUSTER_ID, "local");

    expect(rowOf("local")).toHaveTextContent("50.0 GiB / 100 GiB (50.0%)");
    expect(rowOf("backup")).toHaveTextContent("N/A");
  });

  test("storage reports no uptime, so Age is a dash", async () => {
    await renderPage(ProxmoxClusterStorage, CLUSTER_ID, "local");

    const ageIndex: number = Array.from(
      columnHeader("Age").parentElement!.children,
    ).indexOf(columnHeader("Age"));
    for (const name of ["local", "backup"]) {
      expect(rowOf(name).children[ageIndex]).toHaveTextContent("-");
    }
  });
});

// --------------------------------------------------------------- insights

describe("Proxmox insights", () => {
  test("the Disk Throughput chart header is the only (i), and it explains the cluster-wide sum", async () => {
    await renderPage(ProxmoxClusterInsights, CLUSTER_ID, "Compute");

    expect(infoLabels()).toEqual(["Disk Throughput"]);
    await expectExplained([["Disk Throughput", "insightsDiskThroughput"]]);
    expectHeaderAboveChart("Disk Throughput", "pve_disk_read_bytes");

    // The cluster-wide chart is not filtered to one resource.
    const diskChart: { extraAttributes?: unknown } = rateChartMock.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          series: Array<{ metricName: string }>;
          extraAttributes?: unknown;
        };
      })
      .find((props: { series: Array<{ metricName: string }> }) => {
        return props.series[0]!.metricName === "pve_disk_read_bytes";
      })!;
    expect(diskChart.extraAttributes).toBeUndefined();
  });

  test("the network chart is explained by its card's visible description", async () => {
    await renderPage(ProxmoxClusterInsights, CLUSTER_ID, "Compute");

    expect(
      screen.getByText(
        "Per-second inbound and outbound network throughput summed across all guests.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "About Network" }),
    ).not.toBeInTheDocument();
  });
});
