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
} from "@testing-library/react";
import * as React from "react";

/*
 * A NETAPP ONTAP CLUSTER'S PAGES, IN ONTAP'S WORDS AND ON ONTAP'S METRICS
 * (#11001, #11122).
 *
 * The shared kinds' pages (Volumes, a volume's page) and a kind of ONTAP's
 * own (an aggregate, an SVM, a LUN, a SnapMirror relationship) read the
 * cluster's platform: its columns and descriptions, its fields, its
 * charts, scoped by the labels Harvest names each object by, and its
 * alerts. A part of an ONTAP-only kind has a page of its own under its
 * kind's list. The Hardware page draws ONTAP's tables, and on Amazon FSx
 * leaves out the parts AWS runs and says so. The Overview asks for ONTAP's
 * words for a part in trouble, and lists the open problems Harvest reports
 * on series of their own. The Documentation tab sends an ONTAP cluster to
 * its own steps, never Pure's. A FlashArray's pages are as they were.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ARRAY_ID: string = "0193c0de-7777-4aaa-8bbb-0000000000aa";
const BASE: string = `/dashboard/${PROJECT_ID}/storage-arrays/${ARRAY_ID}`;
const MINUTE: number = 60 * 1000;

type Row = Record<string, unknown>;

let mockArray: Row = {};
let mockParts: Array<Row> = [];
let mockKindParam: string = "";
let mockPartParam: string = "";
let mockMetricTabs: Array<Record<string, unknown>> = [];
let mockAlertCards: Array<Record<string, unknown>> = [];

// A query value as the API reads it: a value, or an Includes of values.
function mockMatches(expected: unknown, actual: unknown): boolean {
  if (expected === undefined) {
    return true;
  }
  if (
    expected &&
    typeof expected === "object" &&
    Array.isArray((expected as { values?: unknown }).values)
  ) {
    return ((expected as { values: Array<unknown> }).values || []).includes(
      actual,
    );
  }
  if (expected && typeof expected === "object") {
    // A range or a search the page adds: not what these tests are about.
    return true;
  }
  return expected === actual;
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
        const rows: Array<Row> = mockParts.filter((row: Row): boolean => {
          return (
            mockMatches(query["kind"], row["kind"]) &&
            mockMatches(query["externalId"], row["externalId"]) &&
            mockMatches(query["componentType"], row["componentType"])
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
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0 });
      },
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

// The charts a page asks for: what these tests read, not what they draw.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        mockMetricTabs.push(props);
        return <div data-testid="part-metrics" />;
      },
    };
  },
);
// The alerts that watch a part: which templates, under which title.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertsCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        mockAlertCards.push(props);
        return (
          <div data-testid={String(props["testId"] || "part-alerts")}>
            {String(props["title"] || "")}
          </div>
        );
      },
    };
  },
);
// Pure's setup guide, whose steps are Pure's: only whether it shows.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/DocumentationCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="pure-setup-guide" />;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="refresh-control" />;
      },
    };
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

import StorageArrayVolumes from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Volumes";
import StorageArrayVolumeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/VolumeDetail";
import StorageArrayInventory from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Inventory";
import StorageArrayInventoryPart from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/InventoryPart";
import StorageArrayHardware from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Hardware";
import StorageArrayDocumentation from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Documentation";
import {
  getOpenProblemRows,
  getStatusKinds,
  getUnhealthyStatusWords,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import {
  getPlatformKindMenuItems,
  PlatformKindMenuItem,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/SideMenu";
import {
  getStorageArrayInventoryTileWords,
  getStorageArrayKindWords,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayKindWords";
import {
  StorageArrayPartRoutes,
  getStorageArrayInventoryPartRoute,
  getStorageArrayPartRoutes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/Part/StorageArrayPartRoutes";
import {
  getStorageArrayPartObjectFilters,
  getStorageArrayPartQueries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/StorageArrayKindView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import IconProp from "../../../Types/Icon/IconProp";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import {
  StorageArrayKindPage,
  StorageArrayPlatform,
} from "../../../Types/StorageArray/StorageArrayPlatform";
import { ONTAP_FSX_OS_NAME } from "../../../Types/StorageArray/Platforms/NetApp/NetApp";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

const ONTAP: string = StorageSystem.NetAppOntap;
const FLASHARRAY: string = StorageSystem.PureStorageFlashArray;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

// The English reader: a template's values put in, nothing translated.
const ENGLISH: Translator = {
  translateText: (text: string): string => {
    return text;
  },
  translateTemplate: (
    template: string,
    values?: Record<string, string | number>,
  ): string => {
    return template.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => {
      return String(values?.[name] ?? "");
    });
  },
} as unknown as Translator;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

function ontapCluster(fields: Row = {}): Row {
  return {
    _id: ARRAY_ID,
    name: "ontap-prod-01",
    storageSystem: ONTAP,
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    osName: "NetApp ONTAP",
    osVersion: "9.16.1",
    countsByKind: { Volume: 2, Aggregate: 2, Svm: 1, Lun: 1, SnapMirror: 1 },
    ...fields,
  };
}

function part(kind: string, externalId: string, fields: Row = {}): Row {
  return {
    _id: ObjectID.generate().toString(),
    storageArrayId: ARRAY_ID,
    kind: kind,
    externalId: externalId,
    name: externalId,
    status: "online",
    lastSeenAt: minutesAgo(1),
    ...fields,
  };
}

const VOLUME: Row = part(StorageArrayResourceKind.Volume, "svm1:vol_projects", {
  name: "vol_projects",
  groupName: "svm1",
  componentType: "rw",
  capacityBytes: 100 * 1024 ** 3,
  usedBytes: 96 * 1024 ** 3,
  readLatencyUs: 812,
  writeLatencyUs: 1240,
  details: {
    aggregate: "aggr1_node1",
    node: "cluster1-01",
    style: "flexvol",
    junctionPath: "/projects",
    snapshotPolicy: "default",
    availableBytes: 4 * 1024 ** 3,
  },
});
const SECOND_SVM_VOLUME: Row = part(
  StorageArrayResourceKind.Volume,
  "svm2:vol_projects",
  { name: "vol_projects", groupName: "svm2" },
);
const AGGREGATE: Row = part("Aggregate", "aggr1_node1", {
  groupName: "cluster1-01",
  componentType: "SSD",
  capacityBytes: 2 * 1024 ** 4,
  usedBytes: 1.7 * 1024 ** 4,
  details: { availableBytes: 0.3 * 1024 ** 4, encrypted: true },
});
const LUN: Row = part("Lun", "svm1:/vol/vol_db/lun_db01", {
  name: "/vol/vol_db/lun_db01",
  groupName: "svm1",
  details: { lun: "lun_db01", volume: "vol_db", node: "cluster1-01" },
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/*
 * The charts a part page's Metrics tab asks for, once the tab is open:
 * never none, so a check over them can never pass for want of any.
 */
async function openMetricsTab(): Promise<Array<MetricQueryConfigData>> {
  fireEvent.click(screen.getByRole("tab", { name: /Metrics/ }));
  await settle();
  const props: Record<string, unknown> | undefined =
    mockMetricTabs[mockMetricTabs.length - 1];
  const queries: Array<MetricQueryConfigData> = (props?.["queryConfigs"] ||
    []) as Array<MetricQueryConfigData>;
  expect(queries.length).toBeGreaterThan(0);
  return queries;
}

function metricNamesOf(queries: Array<MetricQueryConfigData>): Array<string> {
  return queries.map((query: MetricQueryConfigData): string => {
    return String(query.metricQueryData.filterData.metricName || "");
  });
}

function kindPage(kind: string): StorageArrayKindPage {
  const page: StorageArrayKindPage | null =
    StorageArrayPlatformRegistry.getKindPage(ONTAP, kind);
  expect(page).not.toBeNull();
  return page!;
}

beforeEach(() => {
  mockArray = ontapCluster();
  mockParts = [VOLUME, SECOND_SVM_VOLUME, AGGREGATE, LUN];
  mockKindParam = "";
  mockPartParam = "";
  mockMetricTabs = [];
  mockAlertCards = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(ARRAY_ID));
  jest
    .spyOn(Navigation, "getLastParamAsString")
    .mockImplementation((fromLast?: number): string => {
      // As Navigation counts: the last segment is 0, the one before it 1.
      return fromLast === 1 ? mockKindParam : mockPartParam;
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
  window.history.pushState({}, "", "/");
});

describe("an ONTAP cluster's parts link to pages of their own", () => {
  const routes: StorageArrayPartRoutes = getStorageArrayPartRoutes(
    new ObjectID(ARRAY_ID),
    ONTAP,
  );

  test("a part of a kind only ONTAP has opens its page, under its kind's list", () => {
    expect(routes.getPartRoute("Aggregate", "aggr1_node1").toString()).toBe(
      `${BASE}/inventory/Aggregate/aggr1_node1`,
    );
    expect(routes.getPartRoute("Svm", "svm1").toString()).toBe(
      `${BASE}/inventory/Svm/svm1`,
    );
  });

  test("a name with slashes and colons is one path segment, and comes back whole", () => {
    const lun: string = "svm1:/vol/vol_db/lun_db01";
    const route: string = routes.getPartRoute("Lun", lun).toString();
    expect(route).toBe(`${BASE}/inventory/Lun/${encodeURIComponent(lun)}`);
    expect(route.split("/").length).toBe(BASE.split("/").length + 3);
    expect(decodeURIComponent(route.split("/").pop()!)).toBe(lun);
    expect(
      getStorageArrayInventoryPartRoute({
        storageArrayId: new ObjectID(ARRAY_ID),
        kind: "SnapMirror",
        externalId: "svm_dr:vol_projects_dst",
      }).toString(),
    ).toBe(`${BASE}/inventory/SnapMirror/svm_dr%3Avol_projects_dst`);
  });

  test("a volume opens the shared volume page; a disk, a shelf and a node the Hardware tab", () => {
    expect(routes.getPartRoute("Volume", "svm1:vol_projects").toString()).toBe(
      `${BASE}/volumes/svm1%3Avol_projects`,
    );
    for (const kind of [
      "Drive",
      "Hardware",
      "Controller",
      "NetworkInterface",
    ]) {
      expect(routes.getPartRoute(kind, "x").toString()).toBe(
        `${BASE}/hardware`,
      );
    }
  });

  test("where the array's platform is not known, a kind's part links to its tab", () => {
    expect(
      getStorageArrayPartRoutes(new ObjectID(ARRAY_ID))
        .getPartRoute("Aggregate", "aggr1_node1")
        .toString(),
    ).toBe(`${BASE}/inventory/Aggregate`);
  });

  test("its own kinds are tabs, in ONTAP's words and icons", () => {
    expect(getPlatformKindMenuItems(ONTAP)).toEqual([
      // Not OpenStack's host aggregates: a key of its own (MeaningKeys).
      {
        kind: "Aggregate",
        title: "Aggregates (disk aggregates)",
        icon: IconProp.Layers,
      },
      { kind: "Svm", title: "SVMs", icon: IconProp.ServerStack },
      { kind: "Lun", title: "LUNs", icon: IconProp.Cube },
      {
        kind: "SnapMirror",
        title: "SnapMirror Relationships",
        icon: IconProp.ArrowPath,
      },
    ] as Array<PlatformKindMenuItem>);
    expect(getStorageArrayKindWords("Aggregate", ONTAP)).toEqual({
      count: { one: "{{count}} aggregate", other: "{{count}} aggregates" },
      icon: IconProp.Layers,
    });
    expect(getStorageArrayInventoryTileWords("Volume", ONTAP).description).toBe(
      kindPage("Volume").tileDescription,
    );
  });
});

describe("an ONTAP volume's page reads ONTAP's metrics (#11122)", () => {
  test("its charts are ONTAP's volume series, scoped to the volume within its SVM", () => {
    const queries: Array<MetricQueryConfigData> = getStorageArrayPartQueries(
      kindPage("Volume").part!,
      {
        arrayName: "ontap-prod-01",
        externalId: "svm1:vol_projects",
        row: Object.assign(new StorageArrayResource(), VOLUME),
      },
    );
    expect(metricNamesOf(queries)).toEqual([
      "netapp_volume_read_latency",
      "netapp_volume_write_latency",
      "netapp_volume_read_ops",
      "netapp_volume_write_ops",
      "netapp_volume_read_data",
      "netapp_volume_write_data",
      "netapp_volume_size_used_percent",
      "netapp_volume_snapshots_size_used",
    ]);
    for (const query of queries) {
      expect(query.metricQueryData.filterData.attributes).toMatchObject({
        volume: "vol_projects",
        svm: "svm1",
      });
      expect(JSON.stringify(query)).not.toMatch(/purefa_|purefb_/);
    }
  });

  test("two SVMs' volumes of one name are two parts, each charted alone", () => {
    expect(
      getStorageArrayPartObjectFilters(kindPage("Volume").part!.labels, {
        externalId: "svm2:vol_projects",
        row: Object.assign(new StorageArrayResource(), SECOND_SVM_VOLUME),
      }),
    ).toEqual({ volume: "vol_projects", svm: "svm2" });
  });

  test("the volume page draws ONTAP's facts, alerts and charts", async () => {
    mockPartParam = "svm1%3Avol_projects";
    window.history.pushState({}, "", `${BASE}/volumes/svm1%3Avol_projects`);
    render(<StorageArrayVolumeDetail {...PAGE_PROPS} />);
    await settle();

    expect(
      await screen.findByText("What ONTAP reports about this volume."),
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent("Junction Path");
    expect(document.body).toHaveTextContent("/projects");
    expect(document.body).toHaveTextContent("aggr1_node1");
    expect(mockAlertCards[mockAlertCards.length - 1]?.["templateIds"]).toEqual([
      "netapp-volume-nearly-full",
      "netapp-volume-full",
      "netapp-volume-offline",
      "netapp-volume-latency-high",
    ]);
    // Nothing of Pure's is said.
    expect(document.body).not.toHaveTextContent(/Purity|FlashArray|purefa/);

    const queries: Array<MetricQueryConfigData> = await openMetricsTab();
    expect(metricNamesOf(queries)[0]).toBe("netapp_volume_read_latency");
    expect(JSON.stringify(queries)).not.toMatch(/purefa_|purefb_/);
    expect(document.body).toHaveTextContent(
      "Latency, IOPS, bandwidth and space of this volume, as ONTAP reports them.",
    );
  });

  test("the Volumes list is ONTAP's: its words, the SVM and aggregate of each", async () => {
    window.history.pushState({}, "", `${BASE}/volumes`);
    render(<StorageArrayVolumes {...PAGE_PROPS} />);
    await settle();

    expect(
      await screen.findByText(kindPage("Volume").description!),
    ).toBeInTheDocument();
    expect(screen.getAllByText("vol_projects").length).toBe(2);
    expect(document.body).toHaveTextContent("svm2");
    expect(document.body).toHaveTextContent("aggr1_node1");
    // A FlashArray's columns are not drawn for it.
    expect(screen.queryByText("Pod / Group")).not.toBeInTheDocument();
  });

  test("a FlashArray's Volumes list keeps its own columns", async () => {
    mockArray = ontapCluster({ storageSystem: FLASHARRAY, name: "fa-prod-01" });
    mockParts = [
      part(StorageArrayResourceKind.Volume, "vol-a", { groupName: "pod1" }),
    ];
    window.history.pushState({}, "", `${BASE}/volumes`);
    render(<StorageArrayVolumes {...PAGE_PROPS} />);
    await settle();

    expect(await screen.findByText("vol-a")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("Pod / Group");
    expect(document.body).not.toHaveTextContent(
      kindPage("Volume").description!,
    );
  });
});

describe("a kind only ONTAP has: its list and a page per part", () => {
  test("the aggregates list draws ONTAP's columns and links each row to its page", async () => {
    mockPartParam = "Aggregate";
    window.history.pushState({}, "", `${BASE}/inventory/Aggregate`);
    render(<StorageArrayInventory {...PAGE_PROPS} />);
    await settle();

    expect(await screen.findByText("aggr1_node1")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("cluster1-01");
    const link: HTMLElement | null = screen
      .getByText("aggr1_node1")
      .closest("a");
    expect(link?.getAttribute("href")).toBe(
      `${BASE}/inventory/Aggregate/aggr1_node1`,
    );
  });

  test("an aggregate's page: what ONTAP reports, the aggregate alerts and its charts", async () => {
    mockKindParam = "Aggregate";
    mockPartParam = "aggr1_node1";
    window.history.pushState({}, "", `${BASE}/inventory/Aggregate/aggr1_node1`);
    render(<StorageArrayInventoryPart {...PAGE_PROPS} />);
    await settle();

    expect(
      await screen.findByText("What ONTAP reports about this aggregate."),
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent("cluster1-01");
    expect(screen.getByTestId("storage-array-part-alerts")).toHaveTextContent(
      "Aggregate alerts",
    );
    const queries: Array<MetricQueryConfigData> = await openMetricsTab();
    expect(metricNamesOf(queries)).toEqual([
      "netapp_aggr_space_used_percent",
      "netapp_aggr_space_used",
      "netapp_aggr_read_latency",
      "netapp_aggr_write_latency",
      "netapp_aggr_read_ops",
      "netapp_aggr_write_ops",
    ]);
    for (const query of queries) {
      expect(query.metricQueryData.filterData.attributes).toMatchObject({
        aggr: "aggr1_node1",
      });
    }
  });

  test("a LUN's page finds the LUN by its whole name, slashes and all", async () => {
    mockKindParam = "Lun";
    mockPartParam = encodeURIComponent("svm1:/vol/vol_db/lun_db01");
    render(<StorageArrayInventoryPart {...PAGE_PROPS} />);
    await settle();

    expect(
      await screen.findByText("What ONTAP reports about this LUN."),
    ).toBeInTheDocument();
    expect(document.body).toHaveTextContent("vol_db");
    const queries: Array<MetricQueryConfigData> = await openMetricsTab();
    expect(metricNamesOf(queries)[0]).toBe("netapp_lun_avg_read_latency");
    for (const query of queries) {
      // Harvest names a LUN by its own name, within its volume and SVM.
      expect(query.metricQueryData.filterData.attributes).toMatchObject({
        lun: "lun_db01",
        volume: "vol_db",
        svm: "svm1",
      });
    }
  });

  test("a part the inventory does not have yet says so, in a sentence", async () => {
    mockKindParam = "Aggregate";
    mockPartParam = "aggr_new";
    render(<StorageArrayInventoryPart {...PAGE_PROPS} />);
    await settle();

    expect(document.body).toHaveTextContent(
      "aggr_new is not in the inventory yet.",
    );
  });
});

describe("an ONTAP cluster's Hardware page", () => {
  test("draws ONTAP's tables: nodes, disks, shelves, their parts, sensors and ports", async () => {
    window.history.pushState({}, "", `${BASE}/hardware`);
    render(<StorageArrayHardware {...PAGE_PROPS} />);
    await settle();

    for (const title of [
      "Nodes",
      "Disks",
      "Shelves",
      "Shelf Parts",
      "Node Sensors",
      "Ports",
    ]) {
      expect(
        await screen.findByRole("heading", { name: title }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByTestId("storage-array-hardware-managed-note"),
    ).not.toBeInTheDocument();
  });

  test("on Amazon FSx, leaves out the parts AWS runs, and says so", async () => {
    mockArray = ontapCluster({ osName: ONTAP_FSX_OS_NAME });
    window.history.pushState({}, "", `${BASE}/hardware`);
    render(<StorageArrayHardware {...PAGE_PROPS} />);
    await settle();

    expect(
      await screen.findByTestId("storage-array-hardware-managed-note"),
    ).toHaveTextContent("hardware AWS manages");
    expect(
      await screen.findByRole("heading", { name: "Nodes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ports" })).toBeInTheDocument();
    for (const title of ["Disks", "Shelves", "Shelf Parts", "Node Sensors"]) {
      expect(
        screen.queryByRole("heading", { name: title }),
      ).not.toBeInTheDocument();
    }
  });
});

describe("an ONTAP cluster's Overview", () => {
  test("asks for ONTAP's words for a part in trouble; a FlashArray's as before", () => {
    const ontap: Array<string> = getUnhealthyStatusWords(ONTAP);
    for (const word of ["offline", "broken", "stopped", "restricted"]) {
      expect(ontap).toContain(word);
    }
    const flashArray: Array<string> = getUnhealthyStatusWords(FLASHARRAY);
    for (const word of ["broken", "restricted", "offlined_by_system"]) {
      expect(flashArray).not.toContain(word);
    }
    // Every platform's shared words come first, for either.
    expect(ontap.slice(0, 3)).toEqual(flashArray.slice(0, 3));
  });

  test("reads the status of its own kinds and its volumes; a FlashArray's kinds as before", () => {
    const platform: StorageArrayPlatform | null =
      StorageArrayPlatformRegistry.getPlatform(ONTAP);
    expect(getStatusKinds(ONTAP, platform!.kinds)).toEqual([
      "Volume",
      "Aggregate",
      "Svm",
      "Lun",
      "SnapMirror",
      "Controller",
      "Drive",
      "Hardware",
      "NetworkInterface",
    ]);
    expect(
      getStatusKinds(FLASHARRAY, [
        StorageArrayResourceKind.Volume,
        StorageArrayResourceKind.Host,
        StorageArrayResourceKind.Pod,
        StorageArrayResourceKind.Directory,
        StorageArrayResourceKind.Hardware,
      ]),
    ).toEqual([
      StorageArrayResourceKind.Pod,
      StorageArrayResourceKind.Hardware,
    ]);
  });

  test("lists each open problem Harvest reports once, by its newest reading, while it lasts", () => {
    const platform: StorageArrayPlatform | null =
      StorageArrayPlatformRegistry.getPlatform(ONTAP);
    const now: number = Date.now();
    const rows: Array<{
      metricName: string;
      time: number;
      value: number;
      attributes: Record<string, unknown>;
    }> = [
      // A broken disk, read twice: one row.
      {
        metricName: "netapp_health_disk_alerts",
        time: now - 4 * MINUTE,
        value: 1,
        attributes: {
          disk: "1.0.3",
          container_type: "broken",
          severity: "error",
        },
      },
      {
        metricName: "netapp_health_disk_alerts",
        time: now - MINUTE,
        value: 1,
        attributes: {
          disk: "1.0.3",
          container_type: "broken",
          severity: "error",
        },
      },
      // A port that came back up: its newest reading is 0.
      {
        metricName: "netapp_health_network_ethernet_port_alerts",
        time: now - 4 * MINUTE,
        value: 1,
        attributes: { node: "cluster1-01", port: "e0d", severity: "warning" },
      },
      {
        metricName: "netapp_health_network_ethernet_port_alerts",
        time: now - MINUTE,
        value: 0,
        attributes: { node: "cluster1-01", port: "e0d", severity: "warning" },
      },
      // A node that cannot take over its partner, a warning.
      {
        metricName: "netapp_health_ha_alerts",
        time: now - MINUTE,
        value: 1,
        attributes: {
          node: "cluster1-02",
          partner: "cluster1-01",
          state_description: "Takeover is not possible: partner is down",
          severity: "warning",
        },
      },
      // A series no problem of ONTAP's names.
      {
        metricName: "netapp_volume_size_used_percent",
        time: now,
        value: 99,
        attributes: { volume: "vol1" },
      },
    ];

    const open: Array<{
      severity: string;
      summary: string;
      component: string;
    }> = getOpenProblemRows({
      problems: platform!.overview.openProblems || [],
      rows: rows,
      translator: ENGLISH,
      staleAfterMs: 10 * MINUTE,
    });

    expect(
      open.map(
        (row: { severity: string; summary: string; component: string }) => {
          return [row.severity, row.summary, row.component];
        },
      ),
    ).toEqual([
      ["critical", "Disk 1.0.3 is broken", "1.0.3"],
      [
        "warning",
        "Node cluster1-02 cannot take over cluster1-01: Takeover is not possible: partner is down",
        "cluster1-02",
      ],
    ]);
  });

  test("an open problem whose newest reading is old is not listed: Harvest stopped saying it", () => {
    const platform: StorageArrayPlatform | null =
      StorageArrayPlatformRegistry.getPlatform(ONTAP);
    const now: number = Date.now();
    expect(
      getOpenProblemRows({
        problems: platform!.overview.openProblems || [],
        rows: [
          {
            metricName: "netapp_health_disk_alerts",
            time: now - 30 * MINUTE,
            value: 1,
            attributes: { disk: "1.0.3", container_type: "broken" },
          },
          {
            metricName: "netapp_health_node_alerts",
            time: now,
            value: 1,
            attributes: { node: "cluster1-01", severity: "error" },
          },
        ],
        translator: ENGLISH,
        staleAfterMs: 10 * MINUTE,
      }).map((row: { summary: string }) => {
        return row.summary;
      }),
    ).toEqual(["Node cluster1-01 is not healthy"]);
  });
});

describe("an ONTAP cluster's Documentation tab", () => {
  test("gives ONTAP's own steps and the guide, never Pure's", async () => {
    render(<StorageArrayDocumentation {...PAGE_PROPS} />);
    await settle();

    const guide: HTMLElement = await screen.findByTestId(
      "storage-array-platform-guide",
    );
    expect(guide).toHaveTextContent(
      "Create a read-only user for the agent on the ONTAP cluster.",
    );
    expect(guide).toHaveTextContent("choose NetApp ONTAP.");
    expect(
      screen.getByTestId("storage-array-platform-guide-option"),
    ).toHaveTextContent(
      "ONTAP 9.12.1 or later, or Amazon FSx for NetApp ONTAP",
    );
    expect(
      screen
        .getByTestId("storage-array-platform-guide-link")
        .getAttribute("href"),
    ).toMatch(/\/docs\/telemetry\/storage-arrays$/);
    expect(screen.queryByTestId("pure-setup-guide")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/FlashArray|API token/);
  });

  test("a FlashArray keeps its in-app guide", async () => {
    mockArray = ontapCluster({ storageSystem: FLASHARRAY, name: "fa-prod-01" });
    render(<StorageArrayDocumentation {...PAGE_PROPS} />);
    await settle();

    expect(await screen.findByTestId("pure-setup-guide")).toBeInTheDocument();
    expect(
      screen.queryByTestId("storage-array-platform-guide"),
    ).not.toBeInTheDocument();
  });
});
