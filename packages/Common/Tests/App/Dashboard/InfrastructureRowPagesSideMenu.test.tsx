import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  AppPlatformsRoutePath,
  CephRoutePath,
  DockerRoutePath,
  DockerSwarmRoutePath,
  HostRoutePath,
  IoTRoutePath,
  KubernetesRoutePath,
  PodmanRoutePath,
  ProxmoxRoutePath,
  StorageArrayRoutePath,
  VMwareRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import AppPlatformsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/SideMenu";
import AppPlatformsViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/SideMenu";
import CephSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/SideMenu";
import CephViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/SideMenu";
import DockerSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/SideMenu";
import DockerViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/SideMenu";
import DockerSwarmSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/SideMenu";
import DockerSwarmViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/SideMenu";
import HostSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/SideMenu";
import HostViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SideMenu";
import IoTSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/SideMenu";
import IoTViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/SideMenu";
import KubernetesSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/SideMenu";
import KubernetesViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/SideMenu";
import PodmanSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/SideMenu";
import PodmanViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/SideMenu";
import ProxmoxSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/SideMenu";
import ProxmoxViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/View/SideMenu";
import StorageArraySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/SideMenu";
import StorageArrayViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/SideMenu";
import VMwareSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/SideMenu";
import VMwareViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/SideMenu";
import Dictionary from "../../../Types/Dictionary";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  activeLinkTitles,
  allLinks,
  currentEntries,
  DESKTOP_WIDTH,
  goTo,
  linksIn,
  MenuLink,
  MOBILE_WIDTH,
  mobileSummaryText,
  PROJECT_ID,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

// No unresolved states: the Activity badges never reach for a count.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

/*
 * Every infrastructure product's row pages light their list.
 *
 * A Docker Swarm node's page, a Proxmox guest's, a Ceph OSD's, a storage
 * array's volume, an IoT device, a Podman or Docker host's container, a
 * host's process, service or systemd unit, an owner or label rule of any of
 * them: each is one of the rows its list shows, and its menu has an entry
 * for the list, never for the row. Kubernetes, a vCenter and an app
 * platform lit their list there by hand (#5305); the Docker Swarm, Proxmox,
 * Ceph, storage, IoT, Podman and Docker host menus did not, so nothing in
 * them was lit on such a page, and the phone's button read the trail's
 * "Node Detail" instead of "Infrastructure / Nodes". The shared side menu
 * now does it for every menu (Common's SideMenuRowPage).
 *
 * The row pages are read from each product's own route table: a page whose
 * address is a list's plus one id. A row page a product adds later is
 * checked here too, and fails unless its list's entry lights.
 */

const MODEL_ID: ObjectID = new ObjectID("44444444-0000-4000-8000-000000000004");
const OTHER_MODEL_ID: ObjectID = new ObjectID(
  "55555555-0000-4000-8000-000000000005",
);

// A row's own id: a name, as Kubernetes, Docker and Proxmox key their rows.
const ROW_ID: string = "checkout-api-7d9f8b6c5-x2x8k";

const MODEL_PARAM: string = ":id";
const ROW_PARAM: string = ":subModelId";

type MenuOf = (data: { modelId: ObjectID; listPage: string }) => ReactElement;

interface Product {
  name: string;
  table: Dictionary<string>;
  // The product's own menu: its lists, settings and rules.
  productMenu: MenuOf;
  // One resource's menu: its pages, and the lists of what is in it.
  viewMenu: MenuOf;
  // The resource the view menu reads, when what it lists depends on it.
  resourceFor?: (listPage: string) => Record<string, unknown>;
}

// The Kubernetes rows only an OpenShift cluster has are drawn when it has some.
const OPENSHIFT_COUNTS: Dictionary<number> = {
  deploymentConfigs: 3,
  routes: 5,
  services: 40,
};

// A storage array's lists are its platform's: a FlashBlade has buckets.
function storageSystemFor(listPage: string): StorageSystem {
  return [
    PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEMS,
    PageMap.STORAGE_ARRAY_VIEW_BUCKETS,
  ].includes(listPage as PageMap)
    ? StorageSystem.PureStorageFlashBlade
    : StorageSystem.PureStorageFlashArray;
}

const PRODUCTS: Array<Product> = [
  {
    name: "Docker Swarm",
    table: DockerSwarmRoutePath,
    productMenu: () => {
      return <DockerSwarmSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return <DockerSwarmViewSideMenu modelId={modelId} />;
    },
  },
  {
    name: "Proxmox",
    table: ProxmoxRoutePath,
    productMenu: () => {
      return <ProxmoxSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return <ProxmoxViewSideMenu modelId={modelId} />;
    },
  },
  {
    name: "Ceph",
    table: CephRoutePath,
    productMenu: () => {
      return <CephSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return <CephViewSideMenu modelId={modelId} />;
    },
  },
  {
    name: "Storage Arrays",
    table: StorageArrayRoutePath,
    productMenu: () => {
      return <StorageArraySideMenu />;
    },
    viewMenu: ({
      modelId,
      listPage,
    }: {
      modelId: ObjectID;
      listPage: string;
    }) => {
      return (
        <StorageArrayViewSideMenu
          modelId={modelId}
          storageSystem={storageSystemFor(listPage)}
        />
      );
    },
  },
  {
    name: "IoT",
    table: IoTRoutePath,
    productMenu: () => {
      return <IoTSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return <IoTViewSideMenu modelId={modelId} />;
    },
  },
  {
    name: "Podman",
    table: PodmanRoutePath,
    productMenu: () => {
      return <PodmanSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return <PodmanViewSideMenu modelId={modelId} />;
    },
  },
  {
    name: "Docker",
    table: DockerRoutePath,
    productMenu: () => {
      return <DockerSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return <DockerViewSideMenu modelId={modelId} />;
    },
  },
  {
    name: "Hosts",
    table: HostRoutePath,
    productMenu: () => {
      return <HostSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return <HostViewSideMenu modelId={modelId} />;
    },
    // A host lists Services when it runs Windows, Systemd Units on Linux.
    resourceFor: (listPage: string): Record<string, unknown> => {
      return {
        osType: listPage === PageMap.HOST_VIEW_SERVICES ? "windows" : "linux",
      };
    },
  },
  {
    name: "VMware",
    table: VMwareRoutePath,
    productMenu: () => {
      return <VMwareSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return <VMwareViewSideMenu modelId={modelId} />;
    },
  },
  {
    name: "Kubernetes",
    table: KubernetesRoutePath,
    productMenu: () => {
      return <KubernetesSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return (
        <KubernetesViewSideMenu
          modelId={modelId}
          resourceCounts={OPENSHIFT_COUNTS}
        />
      );
    },
  },
  {
    name: "App Platforms",
    table: AppPlatformsRoutePath,
    productMenu: () => {
      return <AppPlatformsSideMenu />;
    },
    viewMenu: ({ modelId }: { modelId: ObjectID }) => {
      return <AppPlatformsViewSideMenu modelId={modelId} />;
    },
  },
];

interface RowPage {
  product: Product;
  rowPage: string;
  listPage: string;
  // A resource's own row (under its view menu), or one of the product's.
  isInResource: boolean;
}

// The pages of a table that are one of a list's rows: the list's address plus one id.
function rowPagesOf(product: Product): Array<RowPage> {
  const listByPath: Map<string, string> = new Map<string, string>();

  for (const [page, path] of Object.entries(product.table)) {
    listByPath.set(path, page);
  }

  return Object.entries(product.table).flatMap(
    ([page, path]: [string, string]): Array<RowPage> => {
      const lastSlash: number = path.lastIndexOf("/");
      const lastPart: string = path.slice(lastSlash + 1);

      if (
        lastSlash === -1 ||
        (lastPart !== ROW_PARAM && lastPart !== MODEL_PARAM)
      ) {
        return [];
      }

      const listPage: string | undefined = listByPath.get(
        path.slice(0, lastSlash),
      );

      if (!listPage) {
        return [];
      }

      return [
        {
          product,
          rowPage: page,
          listPage,
          isInResource: lastPart === ROW_PARAM,
        },
      ];
    },
  );
}

const ROW_PAGES: Array<RowPage> = PRODUCTS.flatMap(rowPagesOf);

/*
 * A real address of a page. Built from the pattern, not with
 * populateRouteParams, which fills the project id from whatever address the
 * previous test left.
 */
function pathOf(
  page: string,
  data: { modelId?: ObjectID; rowId?: string } = {},
): string {
  const isResourceRow: boolean = RouteMap[page]!.toString().includes(ROW_PARAM);

  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(
      MODEL_PARAM,
      isResourceRow
        ? (data.modelId || MODEL_ID).toString()
        : data.rowId || (data.modelId || MODEL_ID).toString(),
    )
    .replace(ROW_PARAM, data.rowId || ROW_ID);
}

function menuFor(row: RowPage, modelId: ObjectID = MODEL_ID): ReactElement {
  const menuOf: MenuOf = row.isInResource
    ? row.product.viewMenu
    : row.product.productMenu;

  if (row.product.resourceFor) {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(row.product.resourceFor(row.listPage) as never);
  }

  return menuOf({ modelId, listPage: row.listPage });
}

// The menu's entry that leads to the row page's list.
function listEntryOf(row: RowPage): MenuLink {
  const listPath: string = pathOf(row.listPage);
  const entries: Array<MenuLink> = allLinks().filter(
    (link: MenuLink): boolean => {
      return link.href === listPath;
    },
  );

  expect({ list: row.listPage, entries: entries.length }).toEqual({
    list: row.listPage,
    entries: 1,
  });

  return entries[0]!;
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as ListResult<never>);
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
  // The Recommendations entries read their resource; there is none.
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the infrastructure products' row pages", () => {
  test("are many, from every product, inside a resource and the product's own", () => {
    expect(ROW_PAGES.length).toBeGreaterThanOrEqual(60);

    for (const product of PRODUCTS) {
      const rows: Array<RowPage> = ROW_PAGES.filter((row: RowPage) => {
        return row.product === product;
      });

      // Every product has its owner and label rules at least.
      expect({ product: product.name, rows: rows.length > 1 }).toEqual({
        product: product.name,
        rows: true,
      });
    }

    // The products the line named, each with a resource's rows of its own.
    for (const rowPage of [
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL,
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL,
      PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL,
      PageMap.PROXMOX_CLUSTER_VIEW_NODE_DETAIL,
      PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL,
      PageMap.PROXMOX_CLUSTER_VIEW_STORAGE_DETAIL,
      PageMap.CEPH_CLUSTER_VIEW_OSD_DETAIL,
      PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL,
      PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL,
      PageMap.STORAGE_ARRAY_VIEW_HOST_DETAIL,
      PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL,
      PageMap.STORAGE_ARRAY_VIEW_BUCKET_DETAIL,
      PageMap.IOT_FLEET_VIEW_DEVICE_DETAIL,
      PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL,
      PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL,
      PageMap.HOST_VIEW_PROCESS_VIEW,
      PageMap.HOST_VIEW_SERVICE_VIEW,
      PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW,
    ]) {
      expect(
        ROW_PAGES.some((row: RowPage): boolean => {
          return row.rowPage === rowPage && row.isInResource;
        }),
      ).toBe(true);
    }
  });

  test.each(ROW_PAGES)(
    "$product.name: on a row of $listPage, its list's entry is lit and holds the page",
    async (row: RowPage) => {
      goTo(pathOf(row.rowPage));
      await renderMenu(menuFor(row));

      const list: MenuLink = listEntryOf(row);

      expect(activeLinkTitles()).toEqual([list.title]);
      expect(currentEntries()).toEqual([
        { title: list.title, current: "true" },
      ]);
    },
  );

  test.each(ROW_PAGES)(
    "$product.name: on $listPage itself, its entry is the page",
    async (row: RowPage) => {
      goTo(pathOf(row.listPage));
      await renderMenu(menuFor(row));

      const list: MenuLink = listEntryOf(row);

      expect(currentEntries()).toEqual([
        { title: list.title, current: "page" },
      ]);
    },
  );

  test.each(ROW_PAGES)(
    "$product.name: on a phone, a row of $listPage names its list on the menu's button",
    async (row: RowPage) => {
      setViewportWidth(MOBILE_WIDTH);
      goTo(pathOf(row.rowPage));
      await renderMenu(menuFor(row));

      const summary: string = mobileSummaryText();

      // The opened menu marks the same entry, under its section.
      fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));
      const list: MenuLink = listEntryOf(row);
      const section: string = sectionTitlesInOrder().find(
        (title: string): boolean => {
          return linksIn(title).some((link: MenuLink): boolean => {
            return link.href === list.href;
          });
        },
      )!;

      expect(currentEntries()).toEqual([
        { title: list.title, current: "true" },
      ]);
      expect(summary).toBe(
        section.toLowerCase() === list.title.toLowerCase()
          ? `Navigate to${list.title}`
          : `Navigate to${section} / ${list.title}`,
      );
    },
  );

  test.each(
    ROW_PAGES.filter((row: RowPage): boolean => {
      return row.isInResource;
    }),
  )(
    "$product.name: another resource's row of $listPage lights nothing here",
    async (row: RowPage) => {
      goTo(pathOf(row.rowPage, { modelId: OTHER_MODEL_ID }));
      await renderMenu(menuFor(row));

      expect(currentEntries()).toEqual([]);
    },
  );

  test.each(
    ROW_PAGES.filter((row: RowPage): boolean => {
      return row.isInResource;
    }),
  )(
    "$product.name: a page below a row of $listPage is not one of its rows",
    async (row: RowPage) => {
      goTo(`${pathOf(row.rowPage)}/logs`);
      await renderMenu(menuFor(row));

      expect(currentEntries()).toEqual([]);
    },
  );
});
