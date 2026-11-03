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
 * A storage array's Overview and a part's own page
 * (Pages/StorageArray/View/{Index,HostDetail,FileSystemDetail,VolumeDetail}
 * on Components/StorageArray/StorageArrayResourceDetail), rendered for real
 * against a stubbed data layer: the array's health and Needs attention by
 * its rules (StorageArrayHealth) - the array's own row (its open alerts, how
 * full and how slow it is), then each part with why, one step from its page
 * - Health Unknown while the agent is not connected, a read that fails in
 * the card's frame with Refresh; and a part's page: its state in the hero,
 * where it sits, what about it needs attention, what is open on it, the
 * array's alerts that watch it with Turn on N, its details, and what it says
 * when the inventory cannot be read or has no such part.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ARRAY_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const BASE: string = `/dashboard/${PROJECT_ID}/storage-arrays/${ARRAY_ID}`;
const MINUTE: number = 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;
const TIB: number = 1024 * GIB;

type Row = Record<string, unknown>;

let mockArray: Row = {};
let mockParts: Array<Row> = [];
let mockPartsFail: boolean = false;
let mockSeries: Record<string, Array<Row>> = {};
let mockLastParam: string = "";
let mockListQueries: Array<Record<string, unknown>> = [];

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve({ ...mockArray });
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
        query?: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "unknown";
        if (modelName !== "StorageArrayResource") {
          return Promise.resolve({ data: [], count: 0 });
        }
        const query: Record<string, unknown> = request.query || {};
        mockListQueries.push(query);
        if (mockPartsFail) {
          return Promise.reject(new Error("The server could not be reached."));
        }

        const matches: (value: unknown, actual: unknown) => boolean = (
          value: unknown,
          actual: unknown,
        ): boolean => {
          if (value === undefined) {
            return true;
          }
          if (typeof value === "string") {
            return value === actual;
          }
          const asIncludes: { values?: Array<unknown> } = value as {
            values?: Array<unknown>;
          };
          if (Array.isArray(asIncludes.values)) {
            return asIncludes.values.includes(actual);
          }
          const asGreater: { value?: number } = value as { value?: number };
          if (typeof asGreater.value === "number") {
            return Number(actual) > asGreater.value;
          }
          return true;
        };

        const rows: Array<Row> = mockParts.filter((row: Row): boolean => {
          return (
            matches(query["kind"], row["kind"]) &&
            matches(query["status"], row["status"]) &&
            matches(query["name"], row["name"]) &&
            matches(query["externalId"], row["externalId"]) &&
            matches(query["replicationLagMs"], row["replicationLagMs"])
          );
        });
        const data: Array<{ tableName?: string }> = rows.map(
          (record: Row): { tableName?: string } => {
            return Object.assign(new Model(), record);
          },
        );
        return Promise.resolve({ data: data, count: data.length });
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
      getList: (request: {
        query: { name: string; attributes?: Record<string, unknown> };
      }): Promise<unknown> => {
        const attributes: Record<string, unknown> =
          request.query.attributes || {};
        const data: Array<Row> = (mockSeries[request.query.name] || []).filter(
          (point: Row): boolean => {
            const pointAttributes: Record<string, unknown> =
              (point["attributes"] as Record<string, unknown>) || {};
            return Object.entries(attributes).every(
              ([key, value]: [string, unknown]): boolean => {
                return (
                  key === "resource.storage.array.name" ||
                  pointAttributes[key] === value
                );
              },
            );
          },
        );
        return Promise.resolve({ data: data, count: data.length });
      },
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return mockStub("metrics-tab");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceRecordDetailsCard",
  () => {
    return mockStub("array-details");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return mockStub("refresh-control");
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

import StorageArrayOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import StorageArrayHostDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/HostDetail";
import StorageArrayFileSystemDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/FileSystemDetail";
import StorageArrayVolumeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/VolumeDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

function flashArray(fields: Row = {}): Row {
  return {
    _id: ARRAY_ID,
    name: "fa-prod-01",
    storageSystem: StorageSystem.PureStorageFlashArray,
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    osName: "Purity//FA",
    osVersion: "6.7.2",
    capacityBytes: 100 * TIB,
    usedBytes: 92 * TIB,
    capacityUsedPercent: 92,
    dataReductionRatio: 4.2,
    healthStatus: 2,
    openAlertCount: 1,
    criticalAlertCount: 1,
    warningAlertCount: 0,
    volumeCount: 2,
    hostCount: 2,
    podCount: 1,
    hardwareComponentCount: 30,
    unhealthyHardwareCount: 2,
    ...fields,
  };
}

function partRow(fields: Row): Row {
  return {
    _id: `48000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`,
    storageArrayId: ARRAY_ID,
    lastSeenAt: minutesAgo(1),
    metricsUpdatedAt: minutesAgo(1),
    ...fields,
  };
}

/*
 * A FlashArray in trouble: a critical alert open, 92% of its capacity used
 * and reads at 6.1 ms; a failed drive, a degraded fan, a host that reaches
 * it through one controller and a pod a minute and a half behind. The
 * controller is fine.
 */
function troubledFlashArray(): void {
  mockArray = flashArray();
  mockParts = [
    partRow({
      kind: "Drive",
      externalId: "SH9.BAY3",
      name: "SH9.BAY3",
      status: "failed",
    }),
    partRow({
      kind: "Hardware",
      externalId: "CT0.FAN1",
      name: "CT0.FAN1",
      status: "degraded",
    }),
    partRow({
      kind: "Controller",
      externalId: "CT0",
      name: "CT0",
      status: "ready",
    }),
    partRow({
      kind: "Host",
      externalId: "esx-07",
      name: "esx-07",
      status: "critical",
      statusDetail: "Single Controller",
      groupName: "vsphere-prod",
      connectionCount: 3,
    }),
    partRow({
      kind: "Host",
      externalId: "esx-08",
      name: "esx-08",
      status: "healthy",
      statusDetail: "Redundant",
      connectionCount: 3,
    }),
    partRow({
      kind: "Pod",
      externalId: "dr-pod",
      name: "dr-pod",
      status: "replicating",
      replicationLagMs: 95000,
    }),
    partRow({
      kind: "Volume",
      externalId: "vg1/vol-db",
      name: "vg1/vol-db",
      capacityBytes: 4 * TIB,
      usedBytes: TIB,
      connectionCount: 2,
    }),
  ];
  mockSeries = {
    purefa_array_performance_latency_usec: [
      {
        time: minutesAgo(1),
        value: 6100,
        attributes: { dimension: "usec_per_read_op" },
      },
      {
        time: minutesAgo(1),
        value: 800,
        attributes: { dimension: "usec_per_write_op" },
      },
    ],
  };
}

// A FlashBlade whose scratch file system has 5% of its size left.
function flashBladeWithAFullFileSystem(): void {
  mockArray = flashArray({
    name: "fb-prod-01",
    storageSystem: StorageSystem.PureStorageFlashBlade,
    osName: "Purity//FB",
    healthStatus: 0,
    openAlertCount: 0,
    criticalAlertCount: 0,
    capacityUsedPercent: 40,
  });
  mockParts = [
    partRow({
      kind: "FileSystem",
      externalId: "scratch",
      name: "scratch",
      capacityBytes: 10 * TIB,
      usedBytes: 2 * TIB,
    }),
    partRow({
      kind: "FileSystem",
      externalId: "home",
      name: "home",
      capacityBytes: 10 * TIB,
    }),
  ];
  mockSeries = {
    purefb_file_systems_space_bytes: [
      {
        time: minutesAgo(1),
        value: 0.05,
        attributes: { name: "scratch", space: "available_ratio" },
      },
      {
        time: minutesAgo(1),
        value: 0.6,
        attributes: { name: "home", space: "available_ratio" },
      },
    ],
  };
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
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
        href:
          item.getAttribute("href") ||
          item.querySelector("a")?.getAttribute("href") ||
          null,
      };
    });
}

beforeEach(() => {
  mockPartsFail = false;
  mockListQueries = [];
  mockLastParam = "";
  troubledFlashArray();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(ARRAY_ID));
  jest.spyOn(Navigation, "getLastParamAsString").mockImplementation(() => {
    return mockLastParam;
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

async function openOverview(): Promise<void> {
  window.history.pushState({}, "", BASE);
  render(<StorageArrayOverview {...PAGE_PROPS} />);
  await screen.findByRole("heading", {
    level: 1,
    name: String(mockArray["name"]),
  });
  await settle();
}

describe("a storage array's Overview", () => {
  test("Needs attention: the array's own row, then each part with why, the most urgent first, one step from its page", async () => {
    await openOverview();

    const rows: Array<AttentionRow> = attentionRows(
      "storage-array-needs-attention",
    );
    expect(
      rows.map((row: AttentionRow): [string | null, string | null] => {
        return [row.key, row.severity];
      }),
    ).toEqual([
      ["Array", "critical"],
      ["Drive:SH9.BAY3", "critical"],
      ["Hardware:CT0.FAN1", "warning"],
      ["Host:esx-07", "warning"],
      ["Pod:dr-pod", "warning"],
    ]);

    const byKey: Map<string | null, AttentionRow> = new Map(
      rows.map((row: AttentionRow): [string | null, AttentionRow] => {
        return [row.key, row];
      }),
    );
    // The array's own row: its alert, how full and how slow it is.
    expect(byKey.get("Array")!.text).toContain("fa-prod-01");
    expect(byKey.get("Array")!.text).toContain("1 critical alert open");
    expect(byKey.get("Array")!.text).toContain("92% of usable capacity used");
    expect(byKey.get("Array")!.text).toContain("Read latency 6.1 ms");
    expect(byKey.get("Drive:SH9.BAY3")!.text).toContain("Reports failed");
    expect(byKey.get("Host:esx-07")!.text).toContain(
      "Reaches the array through one controller only",
    );
    expect(byKey.get("Pod:dr-pod")!.text).toContain(
      "Replication 1 min 35 s behind",
    );

    // Each row one step from where to look: a host's page, the lists.
    expect(byKey.get("Host:esx-07")!.href).toBe(`${BASE}/hosts/esx-07`);
    expect(byKey.get("Drive:SH9.BAY3")!.href).toBe(`${BASE}/hardware`);
    expect(byKey.get("Pod:dr-pod")!.href).toBe(`${BASE}/replication`);
    expect(byKey.get("Array")!.href).toBeNull();

    // The healthy controller and host are never listed.
    expect(screen.queryByText("CT0")).not.toBeInTheDocument();
    expect(screen.queryByText("esx-08")).not.toBeInTheDocument();
  });

  test("the health pill follows the rules: Unhealthy, in red", async () => {
    await openOverview();

    const pill: HTMLElement = screen.getByTestId("storage-array-hero-health");
    expect(pill).toHaveAttribute("data-health", "Unhealthy");
    expect(pill).toHaveTextContent("Unhealthy");
    expect(pill.className).toContain("bg-red-50");
  });

  test("a calm array: Healthy, and no Needs attention card", async () => {
    mockArray = flashArray({
      healthStatus: 0,
      openAlertCount: 0,
      criticalAlertCount: 0,
      capacityUsedPercent: 61,
    });
    mockParts = [];
    mockSeries = {};
    await openOverview();

    expect(screen.getByTestId("storage-array-hero-health")).toHaveAttribute(
      "data-health",
      "Healthy",
    );
    expect(
      screen.queryByTestId("storage-array-needs-attention"),
    ).not.toBeInTheDocument();
  });

  test("while the agent is not connected: Health Unknown, in grey, and no Needs attention", async () => {
    mockArray = flashArray({ otelCollectorStatus: "disconnected" });
    await openOverview();

    const pill: HTMLElement = screen.getByTestId("storage-array-hero-health");
    expect(pill).toHaveAttribute("data-health", "Unknown");
    expect(pill).toHaveTextContent("Health Unknown");
    expect(pill.className).toContain("bg-gray-50");
    expect(
      screen.queryByTestId("storage-array-needs-attention"),
    ).not.toBeInTheDocument();
  });

  test("a read that fails says so in the card's frame, and Refresh reads again", async () => {
    mockPartsFail = true;
    await openOverview();

    // The card's frame, with what failed.
    const card: HTMLElement = screen.getByTestId(
      "storage-array-needs-attention-error",
    );
    expect(card).toHaveTextContent("Needs attention");
    expect(card).toHaveTextContent("The server could not be reached.");
    // No health while what it rests on could not be read.
    expect(
      screen.queryByTestId("storage-array-hero-health"),
    ).not.toBeInTheDocument();

    mockPartsFail = false;
    fireEvent.click(within(card).getByRole("button", { name: /Refresh/ }));
    await settle();

    expect(
      attentionRows("storage-array-needs-attention").map(
        (row: AttentionRow) => {
          return row.key;
        },
      ),
    ).toContain("Drive:SH9.BAY3");
  });

  test("it asks the inventory for the parts the rules read, never the whole array", async () => {
    await openOverview();

    // A short list each, however many volumes the array holds.
    for (const query of mockListQueries) {
      if (query["kind"] === "Volume") {
        continue;
      }
      expect(
        Boolean(query["status"] || query["replicationLagMs"] || query["name"]),
      ).toBe(true);
    }
    expect(mockListQueries).toContainEqual(
      expect.objectContaining({ kind: "Host", status: "critical" }),
    );
  });

  test("a FlashBlade file system its latest reading says is nearly full needs a look", async () => {
    flashBladeWithAFullFileSystem();
    await openOverview();

    const rows: Array<AttentionRow> = attentionRows(
      "storage-array-needs-attention",
    );
    expect(
      rows.map((row: AttentionRow) => {
        return row.key;
      }),
    ).toEqual(["FileSystem:scratch"]);
    expect(rows[0]!.text).toContain("95% of its provisioned size used");
    expect(rows[0]!.href).toBe(`${BASE}/file-systems/scratch`);
    expect(screen.getByTestId("storage-array-hero-health")).toHaveAttribute(
      "data-health",
      "Degraded",
    );
  });
});

async function openPart(
  Page: React.FunctionComponent<PageComponentProps>,
  externalId: string,
): Promise<void> {
  mockLastParam = encodeURIComponent(externalId);
  render(<Page {...PAGE_PROPS} />);
  await screen.findByTestId("storage-array-part-page");
  await waitFor(() => {
    expect(
      screen.queryByTestId("storage-array-part-overview") ||
        screen.queryByTestId("storage-array-part-not-reported") ||
        screen.queryByTestId("storage-array-part-read-error"),
    ).not.toBeNull();
  });
  await settle();
}

describe("a part's own page", () => {
  test("a host that lost a path: Lost redundant paths in amber, where it sits, why, and the host alerts", async () => {
    await openPart(StorageArrayHostDetail, "esx-07");

    const hero: HTMLElement = screen.getByTestId("storage-array-part-hero");
    const status: HTMLElement = screen.getByTestId(
      "storage-array-part-hero-status",
    );
    expect(status).toHaveTextContent("Lost redundant paths");
    expect(status).toHaveAttribute("data-tone", "warning");
    expect(hero).toHaveTextContent("Host of array fa-prod-01");
    expect(
      within(hero).getByRole("link", { name: "fa-prod-01" }),
    ).toHaveAttribute("href", BASE);
    expect(hero).toHaveTextContent("3 volumes");
    expect(hero).toHaveTextContent("vsphere-prod");

    // What about it needs attention, said of this host.
    const attention: Array<AttentionRow> = attentionRows(
      "storage-array-part-attention",
    );
    expect(attention).toHaveLength(1);
    expect(attention[0]!.text).toContain("This host");
    expect(attention[0]!.text).toContain(
      "Reaches the array through one controller only",
    );

    // The array's host alert, with Turn on 1 into its Recommendations.
    const alerts: HTMLElement = screen.getByTestId("storage-array-part-alerts");
    await waitFor(() => {
      expect(alerts).toHaveTextContent("Host Lost Redundant Paths");
    });
    const turnOn: HTMLElement = within(alerts).getByTestId(
      "storage-array-part-alerts-turn-on",
    );
    expect(turnOn.getAttribute("href")).toContain(`${BASE}/recommendations`);

    // Its facts, the name first; the hero says the rest.
    const details: HTMLElement = screen.getByTestId(
      "storage-array-part-details",
    );
    expect(details).toHaveTextContent("Host Group");
    expect(details).not.toHaveTextContent("Storage Array");
    expect(details).not.toHaveTextContent("Connectivity");
  });

  test("a host on both controllers: Redundant paths in green, nothing needs attention", async () => {
    await openPart(StorageArrayHostDetail, "esx-08");

    expect(
      screen.getByTestId("storage-array-part-hero-status"),
    ).toHaveTextContent("Redundant paths");
    expect(
      screen.getByTestId("storage-array-part-hero-status"),
    ).toHaveAttribute("data-tone", "positive");
    expect(
      screen.queryByTestId("storage-array-part-attention"),
    ).not.toBeInTheDocument();
  });

  test("a nearly full file system: Near full, how much is used, and the file system alerts", async () => {
    flashBladeWithAFullFileSystem();
    await openPart(StorageArrayFileSystemDetail, "scratch");

    expect(
      screen.getByTestId("storage-array-part-hero-status"),
    ).toHaveTextContent("Near full");
    expect(screen.getByTestId("storage-array-part-hero")).toHaveTextContent(
      "File system of array fb-prod-01",
    );
    expect(screen.getByTestId("storage-array-part-hero")).toHaveTextContent(
      "10.0 TiB provisioned",
    );
    expect(attentionRows("storage-array-part-attention")[0]!.text).toContain(
      "95% of its provisioned size used",
    );
    await waitFor(() => {
      expect(screen.getByTestId("storage-array-part-alerts")).toHaveTextContent(
        "File System Near Full",
      );
    });

    /*
     * A fact only once the FlashBlade sent it, as on every resource's
     * Details: a file system that sends no latency, IOPS or data reduction
     * had a row of dashes for each.
     */
    const details: HTMLElement = screen.getByTestId(
      "storage-array-part-details",
    );
    expect(details).toHaveTextContent("scratch");
    expect(details).toHaveTextContent("10.0 TiB");
    expect(details).toHaveTextContent("2.0 TiB");
    expect(details).not.toHaveTextContent("—");
    for (const unsent of [
      "Data Reduction",
      "Read Latency",
      "Write Latency",
      "Read IOPS",
      "Write IOPS",
    ]) {
      expect(details).not.toHaveTextContent(unsent);
    }
  });

  test("a volume: Available, its size and hosts, and no alerts card - no alert watches one", async () => {
    await openPart(StorageArrayVolumeDetail, "vg1/vol-db");

    expect(
      screen.getByTestId("storage-array-part-hero-status"),
    ).toHaveTextContent("Available");
    const hero: HTMLElement = screen.getByTestId("storage-array-part-hero");
    expect(hero).toHaveTextContent("Volume of array fa-prod-01");
    expect(hero).toHaveTextContent("4.0 TiB provisioned");
    expect(hero).toHaveTextContent("2 hosts");
    expect(
      screen.queryByTestId("storage-array-part-alerts"),
    ).not.toBeInTheDocument();
  });

  test("a part the inventory does not have says so", async () => {
    await openPart(StorageArrayHostDetail, "esx-99");

    expect(
      screen.getByTestId("storage-array-part-not-reported"),
    ).toHaveTextContent("Host esx-99 is not in the inventory yet.");
  });

  test("a read that fails says so in its own frame, and Try again reads again", async () => {
    mockPartsFail = true;
    await openPart(StorageArrayHostDetail, "esx-07");

    const error: HTMLElement = screen.getByTestId(
      "storage-array-part-read-error",
    );
    expect(error).toHaveTextContent("Couldn't load this host");
    expect(error).toHaveTextContent("The server could not be reached.");

    mockPartsFail = false;
    fireEvent.click(within(error).getByRole("button", { name: /Try again/ }));
    await waitFor(() => {
      expect(
        screen.getByTestId("storage-array-part-overview"),
      ).toBeInTheDocument();
    });
  });
});
