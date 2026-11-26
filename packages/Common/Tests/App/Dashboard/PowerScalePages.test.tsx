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
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * A DELL POWERSCALE CLUSTER'S PAGES (#11003).
 *
 * PowerScale is a shipped platform with kinds of its own (Node, Quota) and
 * words of its own (attention, smartfail, full), so its array gets: tabs
 * for its nodes and quotas besides Hardware; an inventory list per kind in
 * the columns its definition names, quotas fullest first; Overview panels
 * of its own (protocols, throughput, busiest nodes, capacity) in place of
 * Pure's latency pairs; sensor readings in their units on Hardware; and
 * status pills and Needs attention that read its words. A Pure array's
 * pages are held as they were elsewhere (StorageArrayPurePagesGolden).
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ARRAY_ID: string = "0193c0de-7777-4aaa-8bbb-000000000043";
const BASE: string = `/dashboard/${PROJECT_ID}/storage-arrays/${ARRAY_ID}`;
const MINUTE: number = 60 * 1000;
const TIB: number = 1024 * 1024 * 1024 * 1024;

type Row = Record<string, unknown>;

let mockArray: Row = {};
let mockParts: Array<Row> = [];
let mockLastParam: string = "";
let mockListRequests: Array<{
  query: Record<string, unknown>;
  sort: Record<string, unknown> | undefined;
}> = [];

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
        sort?: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "unknown";
        if (modelName !== "StorageArrayResource") {
          return Promise.resolve({ data: [], count: 0 });
        }
        const query: Record<string, unknown> = request.query || {};
        mockListRequests.push({ query, sort: request.sort });
        const rows: Array<Row> = mockParts.filter((row: Row): boolean => {
          return query["kind"] === undefined || query["kind"] === row["kind"];
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
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0 });
      },
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

import StorageArrayInventory from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Inventory";
import { getHardwareReading } from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Hardware";
import {
  getAlertMetricNames,
  getGoldenChartQueries,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import {
  InsightsSection,
  getInsightsQueries,
  getInsightsSections,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Insights";
import {
  InventoryMenuItem,
  PlatformKindMenuItem,
  getInventoryMenuItems,
  getPlatformKindMenuItems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/SideMenu";
import {
  StorageArrayAssessment,
  assessStorageArray,
  assessStorageArrayPart,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth";
import StorageArrayResourceUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getStorageArrayMetricById } from "../../../Types/Monitor/StorageArrayMetricCatalog";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import {
  POWERSCALE_NODE_KIND,
  POWERSCALE_QUOTA_KIND,
} from "../../../Types/StorageArray/Platforms/Dell/PowerScale/PowerScalePlatform";
import { StatusBadgeType } from "../../../UI/Components/StatusBadge/StatusBadge";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";

const POWERSCALE: string = StorageSystem.DellPowerScale;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

function node(name: string, fields: Row = {}): Row {
  return {
    _id: `49000000-0000-4000-8000-${name.replace(/\D/g, "").padStart(12, "0")}`,
    storageArrayId: ARRAY_ID,
    kind: POWERSCALE_NODE_KIND,
    externalId: name,
    name: name,
    status: "ok",
    componentType: "storage",
    model: "F600",
    firmwareVersion: "9.5.0.0",
    readBytesPerSec: 104857600,
    writeBytesPerSec: 52428800,
    details: { cpuBusyPercent: 12.5, readOnly: false },
    lastSeenAt: minutesAgo(1),
    ...fields,
  };
}

function quota(name: string, usedBytes: number, fields: Row = {}): Row {
  return {
    _id: `4a000000-0000-4000-8000-${String(usedBytes % 1e12).padStart(12, "0")}`,
    storageArrayId: ARRAY_ID,
    kind: POWERSCALE_QUOTA_KIND,
    externalId: name,
    name: name,
    status: "ok",
    componentType: "directory",
    usedBytes: usedBytes,
    capacityBytes: 10 * TIB,
    details: { hardLimitBytes: 10 * TIB },
    lastSeenAt: minutesAgo(1),
    ...fields,
  };
}

// A sensor row as ingest stores it: its readings fresh from the last poll.
function resource(fields: Row): StorageArrayResource {
  return Object.assign(new StorageArrayResource(), {
    kind: StorageArrayResourceKind.Hardware,
    lastSeenAt: minutesAgo(1),
    metricsUpdatedAt: minutesAgo(1),
    ...fields,
  });
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  mockArray = {
    _id: ARRAY_ID,
    name: "ps-prod",
    storageSystem: POWERSCALE,
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    osName: "OneFS",
    osVersion: "9.5.0.0",
    countsByKind: { [POWERSCALE_NODE_KIND]: 4, [POWERSCALE_QUOTA_KIND]: 3 },
  };
  mockParts = [];
  mockLastParam = "";
  mockListRequests = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(ARRAY_ID));
  jest.spyOn(Navigation, "getLastParamAsString").mockImplementation(() => {
    return mockLastParam;
  });
  const permissions: Array<Permission> = [Permission.ReadStorageArray];
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
  } as never);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a PowerScale cluster's menu", () => {
  test("has its nodes and quotas as tabs of their own, and Hardware, and none of Pure's pages", () => {
    expect(
      getPlatformKindMenuItems(POWERSCALE).map(
        (item: PlatformKindMenuItem): string => {
          return `${item.kind}:${item.title}`;
        },
      ),
    ).toEqual([
      `${POWERSCALE_NODE_KIND}:Nodes`,
      `${POWERSCALE_QUOTA_KIND}:Quotas`,
    ]);
    const pages: Array<string> = getInventoryMenuItems(POWERSCALE).map(
      (item: InventoryMenuItem): string => {
        return item.kind;
      },
    );
    for (const pureOnly of [
      StorageArrayResourceKind.Volume,
      StorageArrayResourceKind.Host,
      StorageArrayResourceKind.Pod,
      StorageArrayResourceKind.Bucket,
      StorageArrayResourceKind.Directory,
    ]) {
      expect(pages).not.toContain(pureOnly);
    }
  });
});

describe("a PowerScale cluster's Overview", () => {
  test("draws its own panels: each protocol's latency and load, throughput, the busiest nodes and capacity", () => {
    const queries: Array<MetricQueryConfigData> = getGoldenChartQueries({
      storageSystem: POWERSCALE,
      arrayName: "ps-prod",
    });
    // A panel's first line names it; the lines after it are drawn on it.
    const titled: Array<string> = queries
      .filter((query: MetricQueryConfigData): boolean => {
        return !(query as { overlayWithPreviousQuery?: boolean })
          .overlayWithPreviousQuery;
      })
      .map((query: MetricQueryConfigData): string => {
        return query.metricAliasData?.title || "";
      });
    expect(titled).toEqual([
      "Protocol Latency",
      "Protocol Operations",
      "Throughput",
      "Busiest Nodes",
      "Capacity Used",
    ]);
    // Throughput draws reads and writes on one chart.
    expect(queries).toHaveLength(6);
    expect(
      (queries[3] as { overlayWithPreviousQuery?: boolean })
        .overlayWithPreviousQuery,
    ).toBe(true);
    // Every line is the catalog's series, of this array, grouped as the panel says.
    const expected: Array<[string, string | undefined]> = [
      ["powerscale-protocol-latency", "protocol"],
      ["powerscale-protocol-operations", "protocol"],
      ["powerscale-read-throughput", undefined],
      ["powerscale-write-throughput", undefined],
      ["powerscale-node-cpu-busy", "node"],
      ["powerscale-capacity-used-percent", undefined],
    ];
    queries.forEach((query: MetricQueryConfigData, index: number): void => {
      const [metricId, groupBy] = expected[index]!;
      expect(query.metricQueryData.filterData.metricName).toBe(
        getStorageArrayMetricById(metricId)!.metricName,
      );
      expect(JSON.stringify(query.metricQueryData.filterData)).toContain(
        "ps-prod",
      );
      expect(query.metricQueryData.groupByAttributeKeys?.[0]).toBe(groupBy);
    });
  });

  test("reads no alert series: OneFS reports one health, and the Overview says where OneFS lists why", () => {
    expect(getAlertMetricNames(POWERSCALE)).toEqual([]);
    expect(
      StorageArrayPlatformRegistry.getPlatform(POWERSCALE)!.overview
        .alertDetailsUnavailable,
    ).toContain("isi event groups list");
  });

  test("reads capacity at its templates' lines, and judges no latency pair it does not report", () => {
    const judge: (
      state: Record<string, number | null>,
    ) => StorageArrayAssessment = (
      state: Record<string, number | null>,
    ): StorageArrayAssessment => {
      return assessStorageArray({
        storageSystem: POWERSCALE,
        criticalAlertCount: 0,
        warningAlertCount: 0,
        capacityUsedPercent: 50,
        readLatencyUsec: null,
        writeLatencyUsec: null,
        ...state,
      });
    };
    expect(judge({}).severity).toBeNull();
    expect(judge({ capacityUsedPercent: 85 }).severity).toBe("warning");
    expect(judge({ capacityUsedPercent: 95 }).severity).toBe("critical");
    // OneFS's health, counted as an alert, is what makes the cluster unhealthy.
    expect(judge({ warningAlertCount: 1 }).severity).toBe("warning");
    expect(judge({ criticalAlertCount: 1 }).severity).toBe("critical");
  });
});

describe("a PowerScale cluster's words for its parts", () => {
  test("a node in attention needs a look, an offline one is critical, a healthy one is neither", () => {
    const part: (status: string) => StorageArrayAssessment = (
      status: string,
    ): StorageArrayAssessment => {
      return assessStorageArrayPart({
        kind: POWERSCALE_NODE_KIND,
        name: "ps-prod-2",
        status,
      } as never);
    };
    expect(part("attention").severity).toBe("warning");
    expect(part("offline").severity).toBe("critical");
    expect(part("down").severity).toBe("critical");
    expect(part("ok").severity).toBeNull();
  });

  test("a smartfailing drive needs a look and a dead one is critical", () => {
    const drive: (status: string) => StorageArrayAssessment = (
      status: string,
    ): StorageArrayAssessment => {
      return assessStorageArrayPart({
        kind: StorageArrayResourceKind.Drive,
        name: "ps-prod-2 bay 5",
        status,
      } as never);
    };
    expect(drive("smartfail").severity).toBe("warning");
    expect(drive("dead").severity).toBe("critical");
    expect(drive("healthy").severity).toBeNull();
  });

  test("colors each word as it means: OneFS's and a quota's beside the shared ones", () => {
    const badge: (status: string) => StatusBadgeType = (
      status: string,
    ): StatusBadgeType => {
      return StorageArrayResourceUtils.getResourceStatusBadgeType(status);
    };
    expect(badge("dead")).toBe(StatusBadgeType.Danger);
    expect(badge("offline")).toBe(StatusBadgeType.Danger);
    expect(badge("full")).toBe(StatusBadgeType.Danger);
    expect(badge("smartfail")).toBe(StatusBadgeType.Warning);
    expect(badge("attention")).toBe(StatusBadgeType.Warning);
    expect(badge("over_soft_limit")).toBe(StatusBadgeType.Warning);
    expect(badge("up")).toBe(StatusBadgeType.Success);
    expect(badge("healthy")).toBe(StatusBadgeType.Success);
    // Pure's words keep their colors.
    expect(badge("failed")).toBe(StatusBadgeType.Danger);
    expect(badge("degraded")).toBe(StatusBadgeType.Warning);
  });
});

describe("a PowerScale node's sensors on Hardware", () => {
  test("read in their units: a temperature, a fan's speed, a power sensor's volts", () => {
    expect(
      getHardwareReading(
        resource({
          componentType: "temperature sensor",
          temperatureCelsius: 41,
        }),
      ),
    ).toBe(StorageArrayResourceUtils.formatTemperature(41));
    expect(
      getHardwareReading(
        resource({ componentType: "fan", details: { rpm: 9130 } }),
      ),
    ).toBe("9130 rpm");
    expect(
      getHardwareReading(
        resource({
          componentType: "voltage sensor",
          details: { reading: 12.06, unit: "V" },
        }),
      ),
    ).toBe("12.1 V");
  });

  test("a reading that fell off the polls shows nothing, rather than an old figure", () => {
    expect(
      getHardwareReading(
        resource({
          componentType: "fan",
          details: { rpm: 9130 },
          lastSeenAt: minutesAgo(30),
          metricsUpdatedAt: minutesAgo(30),
        }),
      ),
    ).toBe("");
    expect(getHardwareReading(resource({ componentType: "fan" }))).toBe("");
  });

  test("formatReading writes whole figures as they are and the rest to a tenth", () => {
    expect(StorageArrayResourceUtils.formatReading(230, "V")).toBe("230 V");
    expect(StorageArrayResourceUtils.formatReading(11.46, "A")).toBe("11.5 A");
    expect(StorageArrayResourceUtils.formatReading(null, "V")).toBe(
      StorageArrayResourceUtils.formatReading(undefined, "V"),
    );
  });
});

describe("a PowerScale cluster's Resource Usage page", () => {
  test("draws every section from PowerScale's own series, split by the label each names", () => {
    const sections: Array<InsightsSection> = getInsightsSections(POWERSCALE);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const queries: Array<MetricQueryConfigData> = getInsightsQueries({
        section,
        arrayName: "ps-prod",
        storageSystem: POWERSCALE,
      });
      expect(queries.length).toBeGreaterThan(0);
      for (const query of queries) {
        expect(query.metricQueryData.filterData.metricName).toMatch(
          /^powerscale_/,
        );
      }
    }
  });
});

describe("a PowerScale cluster's inventory lists", () => {
  test("lists its nodes in the columns PowerScale names: health, type, model, OneFS, CPU, throughput", async () => {
    mockLastParam = POWERSCALE_NODE_KIND;
    mockParts = [node("ps-prod-1"), node("ps-prod-2", { status: "attention" })];
    window.history.pushState(
      {},
      "",
      `${BASE}/inventory/${POWERSCALE_NODE_KIND}`,
    );
    render(<StorageArrayInventory {...PAGE_PROPS} />);
    await settle();

    expect(await screen.findByText("ps-prod-1")).toBeInTheDocument();
    expect(screen.getByText("ps-prod-2")).toBeInTheDocument();
    const headers: Array<string> = screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return (header.textContent || "").trim();
      })
      .filter((text: string): boolean => {
        return text.length > 0;
      });
    for (const title of [
      "Name",
      "Health",
      "Type",
      "Model",
      "OneFS",
      "CPU",
      "Read",
      "Write",
    ]) {
      expect(
        headers.some((header: string): boolean => {
          return header.startsWith(title);
        }),
      ).toBe(true);
    }
    // Hidden until asked for.
    expect(
      headers.some((header: string): boolean => {
        return header.startsWith("Serial Number");
      }),
    ).toBe(false);
    expect(document.body).toHaveTextContent("F600");
    expect(document.body).toHaveTextContent("9.5.0.0");
    expect(document.body).toHaveTextContent("Attention");
    // Nothing of Pure's is said about it.
    expect(document.body).not.toHaveTextContent(/Purity|FlashArray|FlashBlade/);
  });

  test("lists its quotas fullest first", async () => {
    mockLastParam = POWERSCALE_QUOTA_KIND;
    mockParts = [
      quota("/ifs/data/home", 2 * TIB),
      quota("/ifs/data/projects", 9 * TIB, { status: "over_soft_limit" }),
    ];
    window.history.pushState(
      {},
      "",
      `${BASE}/inventory/${POWERSCALE_QUOTA_KIND}`,
    );
    render(<StorageArrayInventory {...PAGE_PROPS} />);
    await settle();

    expect(await screen.findByText("/ifs/data/home")).toBeInTheDocument();
    const listed: Array<{
      query: Record<string, unknown>;
      sort: Record<string, unknown> | undefined;
    }> = mockListRequests.filter(
      (request: {
        query: Record<string, unknown>;
        sort: Record<string, unknown> | undefined;
      }): boolean => {
        return request.query["kind"] === POWERSCALE_QUOTA_KIND;
      },
    );
    expect(listed.length).toBeGreaterThan(0);
    expect(JSON.stringify(listed[0]!.sort)).toContain("usedBytes");
    expect(JSON.stringify(listed[0]!.sort).toLowerCase()).toContain("desc");
    expect(document.body).toHaveTextContent("Hard Limit");
    expect(document.body).toHaveTextContent("Over Soft Limit");
  });
});
