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
 * A Ceph cluster's Overview, its OSDs and Pools lists and an OSD's and a
 * pool's own page (Pages/Ceph/View/{Index,Osds,Pools,OsdDetail,PoolDetail}),
 * rendered for real against a stubbed data layer: the cluster's health and
 * Needs attention by its rules (CephHealth) - Ceph's own checks on the
 * cluster's row, as Ceph names them, then each OSD, monitor and pool with
 * why - the lists' statuses with why and their cells coloured at their
 * alerts' lines, and a part's page: its state in the hero, where it sits,
 * what about it needs attention, its tiles, what is open on it, the alerts
 * that watch it with Turn on N, its details, and what each says when the
 * inventory cannot be read.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "38000000-0000-4000-8000-000000000001";
const BASE: string = `/dashboard/${PROJECT_ID}/ceph/${CLUSTER_ID}`;
const GIB: number = 1024 * 1024 * 1024;

let mockCluster: Record<string, unknown> = {};
let mockRows: Array<Record<string, unknown>> = [];
let mockInventoryFails: boolean = false;
let mockInventoryReads: number = 0;
let mockIncidents: Array<Record<string, unknown>> = [];
let mockAlerts: Array<Record<string, unknown>> = [];
let mockMetrics: Record<string, Array<Record<string, unknown>>> = {};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: new () => Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => Record<string, unknown> = request.modelType;
        return Promise.resolve(Object.assign(new Model(), mockCluster));
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
        query?: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "unknown";

        let records: Array<Record<string, unknown>> = [];
        if (modelName === "CephResource") {
          mockInventoryReads++;
          if (mockInventoryFails) {
            return Promise.reject(
              new Error("The server could not be reached."),
            );
          }
          records = mockRows.filter((row: Record<string, unknown>) => {
            return row["kind"] === request.query?.["kind"];
          });
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
      getList: (request: { query: { name: string } }): Promise<unknown> => {
        const data: Array<Record<string, unknown>> =
          mockMetrics[request.query.name] || [];
        return Promise.resolve({ data, count: data.length });
      },
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

function mockStub(testId: string): {
  __esModule: boolean;
  default: () => React.ReactElement;
} {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid={testId} />;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return mockStub("metric-card");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephRateChart",
  () => {
    return mockStub("rate-chart");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return mockStub("metrics-tab");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard",
  () => {
    return mockStub("ai-agent-card");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return mockStub("refresh-control");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceRecordDetailsCard",
  () => {
    return mockStub("cluster-details");
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
import CephClusterOsds from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Osds";
import CephClusterPools from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Pools";
import CephClusterOsdDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/OsdDetail";
import CephClusterPoolDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/PoolDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

const CLUSTER: Record<string, unknown> = {
  _id: CLUSTER_ID,
  name: "ceph-prod",
  otelCollectorStatus: "connected",
  lastSeenAt: minutesAgo(1),
  cephVersion: "18.2.4",
  healthStatus: 1,
  monCount: 3,
  osdCount: 6,
  osdUpCount: 5,
  osdInCount: 5,
  poolCount: 3,
  capacityUsedPercent: 41.2,
};

let rowNumber: number = 0;

function base(fields: Record<string, unknown>): Record<string, unknown> {
  rowNumber++;
  return {
    _id: `47000000-0000-4000-8000-${String(rowNumber).padStart(12, "0")}`,
    lastSeenAt: minutesAgo(1),
    metricsUpdatedAt: minutesAgo(1),
    createdAt: minutesAgo(3 * 24 * 60),
    ...fields,
  };
}

function osd(
  id: number,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return base({
    kind: "Osd",
    externalId: `osd.${id}`,
    hostname: `ceph-${String.fromCharCode(97 + (id % 3))}`,
    deviceClass: "ssd",
    daemonVersion: "18.2.4",
    isUp: true,
    isIn: true,
    statBytes: 1000 * GIB,
    statBytesUsed: 400 * GIB,
    applyLatencyMs: 4,
    commitLatencyMs: 5,
    pgCount: 96,
    ...fields,
  });
}

function pool(
  id: string,
  name: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return base({
    kind: "Pool",
    externalId: id,
    name: name,
    storedBytes: 300 * GIB,
    maxAvailBytes: 700 * GIB,
    objects: 76800,
    ...fields,
  });
}

function mon(
  name: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return base({
    kind: "Mon",
    externalId: `mon.${name}`,
    hostname: `ceph-${name}`,
    daemonVersion: "18.2.4",
    inQuorum: true,
    ...fields,
  });
}

function perPool(
  values: Record<string, number>,
): Array<Record<string, unknown>> {
  return Object.entries(values).map(([poolId, value]: [string, number]) => {
    return {
      time: minutesAgo(1),
      value: value,
      attributes: { pool_id: poolId },
    };
  });
}

/*
 * A cluster in trouble: osd.3 is down but still in, osd.5 is past the full
 * ratio, osd.4 writes slowly, osd.2 is up but out; mon.c is out of quorum;
 * the cold pool is past 95% of its writable space and rbd has degraded
 * placement groups. Ceph says HEALTH_WARN, raising OSD_DOWN and
 * PG_DEGRADED (MON_DOWN's latest reading is 0: no longer raised).
 */
function troubledCluster(): void {
  mockCluster = { ...CLUSTER };
  mockRows = [
    osd(0),
    osd(1),
    osd(2, { isIn: false, statBytesUsed: 10 * GIB, pgCount: 0 }),
    osd(3, { isUp: false, isIn: true, hostname: "ceph-b" }),
    osd(4, { applyLatencyMs: 150, commitLatencyMs: 160 }),
    osd(5, { statBytesUsed: 960 * GIB }),
    mon("a"),
    mon("b"),
    mon("c", { inQuorum: false }),
    pool("1", "rbd"),
    pool("2", "cold", { storedBytes: 97 * GIB, maxAvailBytes: 3 * GIB }),
    pool("3", "cephfs_data"),
  ];
  mockMetrics = {
    ceph_health_detail: [
      {
        time: minutesAgo(1),
        value: 1,
        attributes: { name: "PG_DEGRADED", severity: "HEALTH_WARN" },
      },
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
    ],
    ceph_pg_total: perPool({ "1": 128, "2": 32, "3": 64 }),
    ceph_pg_active: perPool({ "1": 128, "2": 32, "3": 64 }),
    ceph_pg_clean: perPool({ "1": 116, "2": 32, "3": 64 }),
    ceph_pg_degraded: perPool({ "1": 12, "2": 0, "3": 0 }),
    ceph_pg_undersized: perPool({ "1": 0, "2": 0, "3": 0 }),
  };
}

// A cluster with nothing to say: HEALTH_OK, every part fine.
function calmCluster(): void {
  mockCluster = { ...CLUSTER, healthStatus: 0, osdUpCount: 3, osdCount: 3 };
  mockRows = [osd(0), osd(1), osd(2), mon("a"), pool("1", "rbd")];
  mockMetrics = {
    ceph_pg_total: perPool({ "1": 128 }),
    ceph_pg_active: perPool({ "1": 128 }),
    ceph_pg_clean: perPool({ "1": 128 }),
    ceph_pg_degraded: perPool({ "1": 0 }),
    ceph_pg_undersized: perPool({ "1": 0 }),
  };
}

interface AttentionRow {
  key: string | null;
  severity: string | null;
  text: string;
  href: string | null;
}

function attentionRows(testId: string): Array<AttentionRow> {
  return within(screen.getByTestId(testId))
    .getAllByTestId(`${testId}-item`)
    .map((item: HTMLElement): AttentionRow => {
      return {
        key: item.getAttribute("data-key"),
        severity: item.getAttribute("data-severity"),
        text: item.textContent || "",
        href: item.querySelector("a")?.getAttribute("href") || null,
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
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// A list row's cells, by the row's name.
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

beforeEach(() => {
  rowNumber = 0;
  mockInventoryFails = false;
  mockInventoryReads = 0;
  mockIncidents = [];
  mockAlerts = [];
  troubledCluster();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("a Ceph cluster's Overview", () => {
  async function openOverview(): Promise<void> {
    window.history.pushState({}, "", BASE);
    render(<CephClusterOverview {...PAGE_PROPS} />);
    await screen.findByRole("heading", { level: 1, name: "ceph-prod" });
    await settle();
  }

  test("Needs attention: Ceph's own checks on the cluster's row, then each OSD, monitor and pool with why, the most urgent first", async () => {
    await openOverview();

    // Six show at first; the other two are a click away.
    const toggle: HTMLElement = screen.getByTestId(
      "ceph-needs-attention-toggle",
    );
    expect(toggle).toHaveTextContent("Show 2 more");
    fireEvent.click(toggle);

    const rows: Array<AttentionRow> = attentionRows("ceph-needs-attention");
    expect(
      rows.map((row: AttentionRow): [string | null, string | null] => {
        return [row.key, row.severity];
      }),
    ).toEqual([
      ["Osd:osd.3", "critical"],
      ["Osd:osd.5", "critical"],
      ["Mon:mon.c", "critical"],
      ["Pool:2", "critical"],
      ["Cluster", "warning"],
      ["Osd:osd.2", "warning"],
      ["Osd:osd.4", "warning"],
      ["Pool:1", "warning"],
    ]);

    const byKey: Map<string | null, AttentionRow> = new Map(
      rows.map((row: AttentionRow): [string | null, AttentionRow] => {
        return [row.key, row];
      }),
    );
    expect(byKey.get("Osd:osd.3")!.text).toContain(
      "Down, still in the cluster",
    );
    expect(byKey.get("Osd:osd.3")!.text).toContain("ceph-b");
    expect(byKey.get("Osd:osd.5")!.text).toContain(
      "96% used, past the full ratio",
    );
    expect(byKey.get("Osd:osd.4")!.text).toContain("Apply latency 150 ms");
    expect(byKey.get("Mon:mon.c")!.text).toContain("Out of quorum");
    expect(byKey.get("Pool:2")!.text).toContain(
      "97% of its writable space used",
    );
    expect(byKey.get("Pool:1")!.text).toContain("12 placement groups degraded");

    /*
     * The cluster's row says Ceph's checks, as Ceph names them, and only
     * those it still raises.
     */
    expect(byKey.get("Cluster")!.text).toContain("ceph-prod");
    expect(byKey.get("Cluster")!.text).toContain("OSD_DOWN");
    expect(byKey.get("Cluster")!.text).toContain("PG_DEGRADED");
    expect(byKey.get("Cluster")!.text).not.toContain("MON_DOWN");

    /*
     * Each row is one step from where to look: an OSD's and a pool's own
     * page, a monitor's row of the Daemons list.
     */
    expect(byKey.get("Osd:osd.3")!.href).toBe(`${BASE}/osds/osd.3`);
    expect(byKey.get("Pool:2")!.href).toBe(`${BASE}/pools/2`);
    expect(byKey.get("Mon:mon.c")!.href).toBe(`${BASE}/daemons`);
    expect(byKey.get("Cluster")!.href).toBeNull();
  });

  test("the hero's health is the rules': Unhealthy beside Connected", async () => {
    await openOverview();

    const health: HTMLElement = screen.getByTestId("ceph-hero-health");
    expect(health).toHaveAttribute("data-health", "Unhealthy");
    expect(health).toHaveTextContent("Unhealthy");
  });

  test("HEALTH_OK and every part fine: Healthy, and Needs attention draws nothing", async () => {
    calmCluster();
    await openOverview();

    expect(screen.getByTestId("ceph-hero-health")).toHaveAttribute(
      "data-health",
      "Healthy",
    );
    expect(screen.queryByTestId("ceph-needs-attention")).toBeNull();
  });

  test("a disconnected cluster's last picture is no longer the truth: Health Unknown, and no Needs attention", async () => {
    mockCluster = { ...CLUSTER, otelCollectorStatus: "disconnected" };
    await openOverview();

    const health: HTMLElement = screen.getByTestId("ceph-hero-health");
    expect(health).toHaveAttribute("data-health", "Unknown");
    expect(health).toHaveTextContent("Health Unknown");
    expect(screen.queryByTestId("ceph-needs-attention")).toBeNull();
  });

  test("an inventory that cannot be read says so in Needs attention's frame, and Refresh reads it again", async () => {
    mockInventoryFails = true;
    await openOverview();

    const error: HTMLElement = screen.getByTestId("ceph-needs-attention-error");
    expect(error).toHaveTextContent("The server could not be reached.");
    // No health without what it is worked out from.
    expect(screen.queryByTestId("ceph-hero-health")).toBeNull();

    mockInventoryFails = false;
    const reads: number = mockInventoryReads;
    fireEvent.click(within(error).getByRole("button", { name: /Refresh/ }));
    await settle();

    expect(mockInventoryReads).toBeGreaterThan(reads);
    await waitFor(() => {
      expect(screen.getByTestId("ceph-needs-attention")).toBeInTheDocument();
    });
    expect(screen.getByTestId("ceph-hero-health")).toHaveAttribute(
      "data-health",
      "Unhealthy",
    );
  });

  test("the count chips open their lists", async () => {
    await openOverview();

    expect(screen.getByTestId("ceph-hero-osds")).toHaveAttribute(
      "href",
      `${BASE}/osds`,
    );
    expect(screen.getByTestId("ceph-hero-osds")).toHaveTextContent(
      "5/6 OSDs up",
    );
    expect(screen.getByTestId("ceph-hero-mons")).toHaveAttribute(
      "href",
      `${BASE}/daemons`,
    );
    expect(screen.getByTestId("ceph-hero-mons")).toHaveTextContent(
      "2/3 mons in quorum",
    );
    expect(screen.getByTestId("ceph-hero-pools")).toHaveAttribute(
      "href",
      `${BASE}/pools`,
    );
  });
});

describe("the OSDs list", () => {
  async function openList(): Promise<void> {
    window.history.pushState({}, "", `${BASE}/osds`);
    render(<CephClusterOsds {...PAGE_PROPS} />);
    await screen.findByText("osd.0");
    await settle();
  }

  function statusOf(name: string): HTMLElement {
    return within(rowOf(name)).getByText(
      (_content: string, element: Element | null): boolean => {
        return (
          Boolean(element?.getAttribute("data-tone")) &&
          element?.tagName === "SPAN" &&
          Boolean(element?.className.includes("rounded"))
        );
      },
    );
  }

  test("each OSD's status is the rules', with why under it", async () => {
    await openList();

    expect(statusOf("osd.0")).toHaveTextContent("Up");
    expect(statusOf("osd.0")).toHaveAttribute("data-tone", "positive");

    expect(statusOf("osd.3")).toHaveTextContent("Down");
    expect(statusOf("osd.3")).toHaveAttribute("data-tone", "danger");
    // The status and the In / Out column say it: no reason repeats them.
    expect(
      within(rowOf("osd.3")).queryByTestId("resource-status-reason"),
    ).toBeNull();

    expect(statusOf("osd.2")).toHaveTextContent("Out of cluster");
    expect(statusOf("osd.2")).toHaveAttribute("data-tone", "warning");

    expect(statusOf("osd.5")).toHaveTextContent("Up");
    expect(statusOf("osd.5")).toHaveAttribute("data-tone", "danger");
    expect(
      within(rowOf("osd.5")).getByTestId("resource-status-reason"),
    ).toHaveTextContent("96% used, past the full ratio");

    expect(statusOf("osd.4")).toHaveAttribute("data-tone", "warning");
    expect(
      within(rowOf("osd.4")).getByTestId("resource-status-reason"),
    ).toHaveTextContent("Apply latency 150 ms");
  });

  test("Used and latency are coloured at their alerts' lines", async () => {
    await openList();

    expect(within(rowOf("osd.5")).getByText(/\(96\.0%\)$/)).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(within(rowOf("osd.0")).getByText(/\(40\.0%\)$/)).not.toHaveAttribute(
      "data-tone",
    );
    expect(within(rowOf("osd.4")).getByText("150 / 160 ms")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(within(rowOf("osd.0")).getByText("4 / 5 ms")).not.toHaveAttribute(
      "data-tone",
    );
  });
});

describe("the Pools list", () => {
  async function openList(): Promise<void> {
    window.history.pushState({}, "", `${BASE}/pools`);
    render(<CephClusterPools {...PAGE_PROPS} />);
    await screen.findByText("rbd");
    await settle();
  }

  test("each pool's status is the rules', its placement groups read, and Used coloured at the Pool Near Full alert's line", async () => {
    await openList();

    const cold: HTMLElement = rowOf("cold");
    expect(within(cold).getByText("Available")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(
      within(cold).getByTestId("resource-status-reason"),
    ).toHaveTextContent("97% of its writable space used");
    expect(within(cold).getByText("97.0%")).toHaveAttribute(
      "data-tone",
      "danger",
    );

    const rbd: HTMLElement = rowOf("rbd");
    expect(within(rbd).getByText("Available")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(within(rbd).getByTestId("resource-status-reason")).toHaveTextContent(
      "12 placement groups degraded",
    );
    expect(within(rbd).getByText("116 of 128 clean")).toBeInTheDocument();
    expect(within(rbd).getByText("30.0%")).not.toHaveAttribute("data-tone");

    expect(within(rowOf("cephfs_data")).getByText("Available")).toHaveAttribute(
      "data-tone",
      "positive",
    );
  });

  test("a pool whose placement groups cannot be read keeps its status from its fullness", async () => {
    mockMetrics = {};
    await openList();

    expect(within(rowOf("rbd")).getByText("Available")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    expect(within(rowOf("cold")).getByText("Available")).toHaveAttribute(
      "data-tone",
      "danger",
    );
  });
});

describe("an OSD's page", () => {
  async function openOsd(name: string): Promise<void> {
    window.history.pushState({}, "", `${BASE}/osds/${name}`);
    render(<CephClusterOsdDetail {...PAGE_PROPS} />);
    await screen.findByTestId("ceph-osd-page");
    await waitFor(() => {
      expect(
        screen.queryByTestId("ceph-osd-overview") ||
          screen.queryByTestId("ceph-osd-not-reported") ||
          screen.queryByTestId("ceph-osd-read-error"),
      ).not.toBeNull();
    });
    await settle();
  }

  test("one that is down but still in: Down in red, its placement and host, This OSD in Needs attention, and no readings as its current ones", async () => {
    await openOsd("osd.3");

    const status: HTMLElement = screen.getByTestId("ceph-osd-hero-status");
    expect(status).toHaveTextContent(/^Down/);
    expect(status).toHaveAttribute("data-tone", "danger");
    expect(screen.getByTestId("ceph-osd-hero-badge")).toHaveTextContent(
      "In cluster",
    );
    expect(screen.getByTestId("ceph-osd-hero-location")).toHaveTextContent(
      "OSD of cluster ceph-prod on host ceph-b",
    );
    expect(
      within(screen.getByTestId("ceph-osd-hero-location"))
        .getByRole("link")
        .getAttribute("href"),
    ).toBe(BASE);

    expect(attentionRows("ceph-osd-attention")).toEqual([
      {
        key: "Osd:osd.3",
        severity: "critical",
        text: expect.stringContaining("Down, still in the cluster"),
        href: null,
      },
    ]);
    expect(screen.getByTestId("ceph-osd-attention")).toHaveTextContent(
      "This OSD",
    );
    expect(screen.queryByTestId("ceph-osd-tiles")).toBeNull();
  });

  test("one past the full ratio: Up in red, its tiles at their lines, its chips and its details", async () => {
    await openOsd("osd.5");

    expect(screen.getByTestId("ceph-osd-hero-status")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    const chips: HTMLElement = screen.getByTestId("ceph-osd-hero-chips");
    expect(chips).toHaveTextContent("ssd");
    expect(chips).toHaveTextContent("1000 GiB capacity");
    expect(chips).toHaveTextContent("96 placement groups");

    const tiles: HTMLElement = screen.getByTestId("ceph-osd-tiles");
    expect(tiles).toHaveTextContent("96.0%");
    expect(tiles).toHaveTextContent("960 GiB of 1000 GiB");
    expect(tiles).toHaveTextContent("4 ms");
    expect(tiles).toHaveTextContent("Commit latency 5 ms");

    const details: HTMLElement = screen.getByTestId("ceph-osd-details");
    expect(details).toHaveTextContent("osd.5");
    expect(details).toHaveTextContent("In cluster");
    expect(details).toHaveTextContent("18.2.4");
  });

  test("the OSD alerts: each that watches its OSDs, and one step to turn them on", async () => {
    await openOsd("osd.0");

    const card: HTMLElement = await screen.findByTestId("ceph-osd-alerts");
    const items: Array<HTMLElement> = within(card).getAllByTestId(
      "ceph-osd-alerts-item",
    );
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveTextContent("OSD Down");
    const turnOn: HTMLElement = within(card).getByTestId(
      "ceph-osd-alerts-turn-on",
    );
    expect(turnOn).toHaveTextContent("Turn on 8 alerts");
    expect(selectionOf(turnOn)).toEqual([
      "Ceph:ceph-osd-down",
      "Ceph:ceph-osd-out",
      "Ceph:ceph-osd-high-latency",
      "Ceph:ceph-daemon-slow-ops",
      "Ceph:ceph-osd-nearfull",
      "Ceph:ceph-osd-backfillfull",
      "Ceph:ceph-osd-full",
      "Ceph:ceph-osd-slow-heartbeats",
    ]);
  });

  test("an alert its ceph_daemon names is open on it; another OSD's and a check-based one are not", async () => {
    mockAlerts = [
      {
        _id: "61000000-0000-4000-8000-000000000001",
        title: "[Ceph] OSD Down - ceph-prod",
        alertNumber: 4,
        createdAt: minutesAgo(5),
        seriesLabels: { ceph_daemon: "osd.3" },
      },
      {
        _id: "61000000-0000-4000-8000-000000000002",
        title: "[Ceph] OSD High Latency - ceph-prod",
        alertNumber: 5,
        createdAt: minutesAgo(4),
        seriesLabels: { ceph_daemon: "osd.4" },
      },
      {
        _id: "61000000-0000-4000-8000-000000000003",
        title: "[Ceph] OSD Nearfull - ceph-prod",
        alertNumber: 6,
        createdAt: minutesAgo(3),
        seriesLabels: {},
      },
    ];
    await openOsd("osd.3");

    const card: HTMLElement = await screen.findByTestId("ceph-osd-open");
    await waitFor(() => {
      expect(within(card).getAllByTestId("ceph-osd-open-title")).toHaveLength(
        1,
      );
    });
    expect(within(card).getByTestId("ceph-osd-open-title")).toHaveTextContent(
      "[Ceph] OSD Down - ceph-prod",
    );
  });

  test("one the inventory has no row for says so", async () => {
    await openOsd("osd.9");

    expect(screen.getByTestId("ceph-osd-not-reported")).toHaveTextContent(
      "OSD osd.9 is not in the inventory yet.",
    );
    expect(screen.queryByTestId("ceph-osd-hero-status")).toBeNull();
  });

  test("an inventory that cannot be read says so, with Try again, and reads it again", async () => {
    mockInventoryFails = true;
    await openOsd("osd.3");

    const error: HTMLElement = screen.getByTestId("ceph-osd-read-error");
    expect(error).toHaveTextContent("Couldn't load this OSD");
    expect(error).toHaveTextContent("The server could not be reached.");

    mockInventoryFails = false;
    const reads: number = mockInventoryReads;
    fireEvent.click(within(error).getByRole("button", { name: /Try again/ }));
    await settle();

    expect(mockInventoryReads).toBe(reads + 1);
    expect(await screen.findByTestId("ceph-osd-overview")).toBeInTheDocument();
    expect(screen.getByTestId("ceph-osd-hero-status")).toHaveTextContent(
      /^Down/,
    );
  });
});

describe("a pool's page", () => {
  async function openPool(id: string): Promise<void> {
    window.history.pushState({}, "", `${BASE}/pools/${id}`);
    render(<CephClusterPoolDetail {...PAGE_PROPS} />);
    await screen.findByTestId("ceph-pool-page");
    await waitFor(() => {
      expect(
        screen.queryByTestId("ceph-pool-overview") ||
          screen.queryByTestId("ceph-pool-not-reported") ||
          screen.queryByTestId("ceph-pool-read-error"),
      ).not.toBeNull();
    });
    await settle();
  }

  test("one with degraded placement groups: Available in amber, why, and its placement groups' tile", async () => {
    await openPool("1");

    const status: HTMLElement = screen.getByTestId("ceph-pool-hero-status");
    expect(status).toHaveTextContent(/^Available/);
    expect(status).toHaveAttribute("data-tone", "warning");
    expect(screen.getByTestId("ceph-pool-hero-location")).toHaveTextContent(
      "Pool of cluster ceph-prod",
    );
    const chips: HTMLElement = screen.getByTestId("ceph-pool-hero-chips");
    expect(chips).toHaveTextContent("Pool ID 1");
    expect(chips).toHaveTextContent("300 GiB stored");
    expect(chips).toHaveTextContent("76,800 objects");

    expect(attentionRows("ceph-pool-attention")).toEqual([
      {
        key: "Pool:1",
        severity: "warning",
        text: expect.stringContaining("12 placement groups degraded"),
        href: null,
      },
    ]);
    expect(screen.getByTestId("ceph-pool-attention")).toHaveTextContent(
      "This pool",
    );

    const tiles: HTMLElement = screen.getByTestId("ceph-pool-tiles");
    expect(tiles).toHaveTextContent("30.0%");
    expect(tiles).toHaveTextContent("300 GiB of 1000 GiB");
    expect(tiles).toHaveTextContent("128");
    expect(tiles).toHaveTextContent("12 not active + clean");
  });

  test("one past 95% of its writable space: Available in red", async () => {
    await openPool("2");

    expect(screen.getByTestId("ceph-pool-hero-status")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(attentionRows("ceph-pool-attention")[0]!.text).toContain(
      "97% of its writable space used",
    );
    expect(screen.getByTestId("ceph-pool-tiles")).toHaveTextContent(
      "All active + clean",
    );
  });

  test("the pool alerts, and one step to turn them on", async () => {
    await openPool("3");

    const card: HTMLElement = await screen.findByTestId("ceph-pool-alerts");
    expect(within(card).getAllByTestId("ceph-pool-alerts-item")).toHaveLength(
      4,
    );
    expect(
      selectionOf(within(card).getByTestId("ceph-pool-alerts-turn-on")),
    ).toEqual([
      "Ceph:ceph-pool-near-full",
      "Ceph:ceph-pg-inactive",
      "Ceph:ceph-pg-degraded",
      "Ceph:ceph-pg-undersized",
    ]);
  });

  test("an incident its pool_id names is open on it; another pool's is not", async () => {
    mockIncidents = [
      {
        _id: "62000000-0000-4000-8000-000000000001",
        title: "[Ceph] Degraded Placement Groups - ceph-prod",
        incidentNumber: 7,
        createdAt: minutesAgo(5),
        seriesLabels: { pool_id: "1" },
      },
      {
        _id: "62000000-0000-4000-8000-000000000002",
        title: "[Ceph] Pool Near Full - ceph-prod",
        incidentNumber: 8,
        createdAt: minutesAgo(4),
        seriesLabels: { pool_id: "2" },
      },
    ];
    await openPool("1");

    const card: HTMLElement = await screen.findByTestId("ceph-pool-open");
    await waitFor(() => {
      expect(within(card).getAllByTestId("ceph-pool-open-title")).toHaveLength(
        1,
      );
    });
    expect(within(card).getByTestId("ceph-pool-open-title")).toHaveTextContent(
      "[Ceph] Degraded Placement Groups - ceph-prod",
    );
  });

  test("an inventory that cannot be read says so, with Try again", async () => {
    mockInventoryFails = true;
    await openPool("1");

    expect(screen.getByTestId("ceph-pool-read-error")).toHaveTextContent(
      "Couldn't load this pool",
    );
    expect(screen.queryByTestId("ceph-pool-hero-status")).toBeNull();
  });
});
