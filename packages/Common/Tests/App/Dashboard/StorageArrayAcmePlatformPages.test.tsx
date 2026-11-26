/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * A PLATFORM'S PAGES, WITH NO PAGE CHANGED FOR IT (#11000).
 *
 * Acme (Tests/Helpers/StorageArray/AcmePlatform.ts) is registered in this
 * test alone. Its array gets the menu tabs its kinds call for - Volumes, a
 * shared kind with its own page, and Aggregates, a kind only Acme has,
 * which opens the inventory page - each with its count; the Overview counts
 * both kinds from StorageArray.countsByKind; the inventory page lists its
 * aggregates under Acme's words; the monitor form offers its filter, the
 * Resource Usage page its sections. Pure Storage's arrays get none of it.
 * The setup guide, whose steps are Pure's, does not offer Acme's agent
 * config until it has steps for it.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ARRAY_ID: string = "0193c0de-7777-4aaa-8bbb-000000000042";
const BASE: string = `/dashboard/${PROJECT_ID}/storage-arrays/${ARRAY_ID}`;
const MINUTE: number = 60 * 1000;

type Row = Record<string, unknown>;

let mockArray: Row = {};
let mockParts: Array<Row> = [];
let mockLastParam: string = "";
let mockListQueries: Array<Record<string, unknown>> = [];

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
import StorageArrayInventory from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Inventory";
import {
  InventoryMenuItem,
  PlatformKindMenuItem,
  getInventoryMenuItems,
  getPlatformKindMenuItems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/SideMenu";
import { getInsightsSections } from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Insights";
import {
  getStorageArrayInventoryTileWords,
  getStorageArrayKindCount,
  getStorageArrayKindWords,
  getStorageArrayTopListWords,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayKindWords";
import {
  ResourceFilterField,
  getResourceFilterFields,
  resourceFilterFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/StorageArrayMonitor/StorageArrayMonitorStepForm";
import {
  STORAGE_ARRAY_PLATFORMS,
  getStorageArrayPlatformForSystem,
  getStorageArrayPlatformOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import {
  StorageArrayPartRoutes,
  getStorageArrayPartRoutes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/Part/StorageArrayPartRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import IconProp from "../../../Types/Icon/IconProp";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import {
  ACME_AGGREGATE_KIND,
  ACME_PLATFORM,
  ACME_STORAGE_SYSTEM,
  registerAcmePlatform,
  unregisterAcmePlatform,
} from "../../Helpers/StorageArray/AcmePlatform";

const FLASHARRAY: string = StorageSystem.PureStorageFlashArray;
const FLASHBLADE: string = StorageSystem.PureStorageFlashBlade;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

function acmeArray(fields: Row = {}): Row {
  return {
    _id: ARRAY_ID,
    name: "acme-prod-01",
    storageSystem: ACME_STORAGE_SYSTEM,
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    osName: "AcmeOS",
    osVersion: "9.1",
    // The shared column says 1; the per-kind counts say 3, and win.
    volumeCount: 1,
    countsByKind: { Volume: 3, [ACME_AGGREGATE_KIND]: 2 },
    ...fields,
  };
}

function aggregate(name: string, usedBytes: number): Row {
  return {
    _id: `48000000-0000-4000-8000-${String(usedBytes).padStart(12, "0")}`,
    storageArrayId: ARRAY_ID,
    kind: ACME_AGGREGATE_KIND,
    externalId: name,
    name: name,
    status: "online",
    usedBytes: usedBytes,
    capacityBytes: 10 * usedBytes,
    lastSeenAt: minutesAgo(1),
  };
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeAll(() => {
  registerAcmePlatform();
});

afterAll(() => {
  unregisterAcmePlatform();
});

beforeEach(() => {
  mockArray = acmeArray();
  mockParts = [aggregate("aggr1", 700), aggregate("aggr2", 50)];
  mockLastParam = "";
  mockListQueries = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(ARRAY_ID));
  jest.spyOn(Navigation, "getLastParamAsString").mockImplementation(() => {
    return mockLastParam;
  });
  // Someone who may read the array's inventory.
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

describe("an Acme array's menu", () => {
  test("its shared kinds keep their pages: Volumes, and no other", () => {
    expect(
      getInventoryMenuItems(ACME_STORAGE_SYSTEM).map(
        (item: InventoryMenuItem): string => {
          return item.title;
        },
      ),
    ).toEqual(["Volumes"]);
  });

  test("its own kind gets a tab of its own, in its words, opening the inventory page", () => {
    expect(getPlatformKindMenuItems(ACME_STORAGE_SYSTEM)).toEqual([
      {
        kind: ACME_AGGREGATE_KIND,
        title: "Aggregates",
        icon: IconProp.Database,
      },
    ] as Array<PlatformKindMenuItem>);
    expect(RouteMap[PageMap.STORAGE_ARRAY_VIEW_INVENTORY]?.toString()).toBe(
      "/dashboard/:projectId/storage-arrays/:id/inventory/:subModelId",
    );
  });

  test("a part of its own kind links to that kind's tab; every other part as before", () => {
    const routes: StorageArrayPartRoutes = getStorageArrayPartRoutes(
      new ObjectID(ARRAY_ID),
    );
    // Acme draws no page per part: its parts link to their kind's tab.
    expect(routes.getPartRoute(ACME_AGGREGATE_KIND, "aggr1").toString()).toBe(
      `${BASE}/inventory/${ACME_AGGREGATE_KIND}`,
    );
    expect(routes.getPartRoute("Volume", "vol-a").toString()).toBe(
      `${BASE}/volumes/vol-a`,
    );
    expect(routes.getPartRoute("Drive", "CH0.BAY1").toString()).toBe(
      `${BASE}/hardware`,
    );
    /*
     * A kind no platform defines, or a name Object has, opens the array
     * (a Lun is ONTAP's since #11001, so a Qtree stands in for it).
     */
    for (const kind of ["Qtree", "constructor", "toString"]) {
      expect(routes.getPartRoute(kind, "x").toString()).toBe(BASE);
    }
  });

  test("a Pure array gets no tab of that kind: every kind of theirs has a page", () => {
    for (const system of [FLASHARRAY, FLASHBLADE, "hitachi.vsp", null]) {
      expect(getPlatformKindMenuItems(system)).toEqual([]);
    }
  });
});

describe("an Acme array's counts", () => {
  test("each kind is counted from countsByKind first, the shared column after", () => {
    const array: StorageArray = Object.assign(new StorageArray(), mockArray);
    expect(
      getStorageArrayKindCount(array, StorageArrayResourceKind.Volume),
    ).toBe(3);
    expect(getStorageArrayKindCount(array, ACME_AGGREGATE_KIND)).toBe(2);
    expect(
      getStorageArrayKindCount(
        Object.assign(new StorageArray(), acmeArray({ countsByKind: {} })),
        StorageArrayResourceKind.Volume,
      ),
    ).toBe(1);
    expect(
      getStorageArrayKindCount(
        Object.assign(new StorageArray(), acmeArray({ countsByKind: null })),
        ACME_AGGREGATE_KIND,
      ),
    ).toBeUndefined();
  });

  test("its kind is worded and drawn from its definition", () => {
    expect(
      getStorageArrayKindWords(ACME_AGGREGATE_KIND, ACME_STORAGE_SYSTEM),
    ).toEqual({
      count: { one: "{{count}} aggregate", other: "{{count}} aggregates" },
      icon: IconProp.Database,
    });
    expect(getStorageArrayInventoryTileWords(ACME_AGGREGATE_KIND).title).toBe(
      "Aggregates",
    );
    // No ranked lists are written for it.
    expect(getStorageArrayTopListWords(ACME_AGGREGATE_KIND)).toBeNull();
  });

  test("the Overview shows both kinds' counts and the aggregates tile", async () => {
    window.history.pushState({}, "", BASE);
    render(<StorageArrayOverview {...PAGE_PROPS} />);
    await screen.findByRole("heading", { level: 1, name: "acme-prod-01" });
    await settle();

    expect(document.body).toHaveTextContent("3 volumes");
    expect(document.body).toHaveTextContent("2 aggregates");
    // Nothing of Pure's is said about it.
    expect(document.body).not.toHaveTextContent(/Purity|FlashArray|FlashBlade/);
  });
});

describe("an Acme array's inventory page", () => {
  test("lists its aggregates, under Acme's words for them", async () => {
    mockLastParam = ACME_AGGREGATE_KIND;
    window.history.pushState(
      {},
      "",
      `${BASE}/inventory/${ACME_AGGREGATE_KIND}`,
    );
    render(<StorageArrayInventory {...PAGE_PROPS} />);
    await settle();

    expect(await screen.findByText("aggr1")).toBeInTheDocument();
    expect(screen.getByText("aggr2")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("Aggregates");
    expect(document.body).toHaveTextContent(
      ACME_PLATFORM.kindDefinitions![0]!.description,
    );
    // It asked for that kind of this array only.
    expect(
      mockListQueries.some((query: Record<string, unknown>): boolean => {
        return query["kind"] === ACME_AGGREGATE_KIND;
      }),
    ).toBe(true);
  });

  test("says what its definition says while there is none", async () => {
    mockParts = [];
    mockLastParam = ACME_AGGREGATE_KIND;
    render(<StorageArrayInventory {...PAGE_PROPS} />);
    await settle();

    // The table's empty state is its title, without the closing period.
    await waitFor(() => {
      expect(document.body.textContent).toContain(
        ACME_PLATFORM.kindDefinitions![0]!.noItemsMessage.replace(/\.$/, ""),
      );
    });
  });

  test("a kind no platform defines still lists, under its own name", async () => {
    mockParts = [
      {
        ...aggregate("qtree-7", 9),
        kind: "Qtree",
        externalId: "qtree-7",
        name: "qtree-7",
      },
    ];
    mockLastParam = "Qtree";
    render(<StorageArrayInventory {...PAGE_PROPS} />);
    await settle();

    expect(await screen.findByText("qtree-7")).toBeInTheDocument();
    expect(within(document.body).getAllByText("Qtree").length).toBeGreaterThan(
      0,
    );
  });
});

describe("an Acme array's monitors and Resource Usage", () => {
  test("the monitor form offers the filter Acme declares, in Acme's words", () => {
    const fields: Array<ResourceFilterField> =
      getResourceFilterFields(ACME_STORAGE_SYSTEM);
    expect(
      fields.map((field: ResourceFilterField) => {
        return [field.key, field.title, field.description];
      }),
    ).toEqual([
      ["volumeName", "Volume", ACME_PLATFORM.resourceFilters[0]!.description],
    ]);
  });

  test("a Pure array's form is as it was: its own fields, in its own words", () => {
    for (const system of [FLASHARRAY, FLASHBLADE]) {
      const fields: Array<ResourceFilterField> =
        getResourceFilterFields(system);
      expect(
        fields.map((field: ResourceFilterField) => {
          return [field.key, field.description];
        }),
      ).toEqual(
        StorageArrayPlatformRegistry.getPlatform(system)!.resourceFilters.map(
          (filter: { key: string; description: string }) => {
            return [filter.key, filter.description];
          },
        ),
      );
      for (const field of fields) {
        // A field lists every platform that offers it, Acme's Volume too.
        expect(field.storageSystems).toContain(system);
        expect(field.description).not.toContain("Acme");
      }
    }
    // Built when the form loaded, before Acme was registered.
    for (const field of resourceFilterFields) {
      expect(field.storageSystems).not.toContain(ACME_STORAGE_SYSTEM);
    }
  });

  test("while an array's platform is unknown, every platform's filters, Acme's among them", () => {
    const volume: ResourceFilterField | undefined = getResourceFilterFields(
      null,
    ).find((field: ResourceFilterField): boolean => {
      return field.key === "volumeName";
    });
    expect(volume?.storageSystems).toEqual([
      FLASHARRAY,
      "netapp.ontap",
      ACME_STORAGE_SYSTEM,
    ]);
    // The first platform's words describe it.
    expect(volume?.description).toContain("FlashArray");
  });

  test("the Resource Usage page draws Acme's sections", () => {
    expect(getInsightsSections(ACME_STORAGE_SYSTEM)).toBe(
      ACME_PLATFORM.insightsSections,
    );
  });
});

describe("the setup guide, whose steps are Pure Storage's", () => {
  test("does not offer Acme's agent config until it has steps for it", () => {
    expect(
      getStorageArrayPlatformOptions().map(
        (option: { key: string }): string => {
          return option.key;
        },
      ),
    ).toEqual(["flasharray", "flasharray-exporter", "flashblade"]);
    expect(STORAGE_ARRAY_PLATFORMS).toEqual(getStorageArrayPlatformOptions());
    expect(
      getStorageArrayPlatformForSystem(ACME_STORAGE_SYSTEM),
    ).toBeUndefined();
    expect(getStorageArrayPlatformForSystem(FLASHBLADE)).toBe("flashblade");
  });
});
