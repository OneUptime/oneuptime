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
import { Mock } from "jest-mock";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

/*
 * ISSUE #6859: A LIST'S NAMES, TILES AND SITES IN THE WIDGET SETTINGS'
 * LIVE PREVIEW.
 *
 * The widget settings dialog draws the widget as a reader sees it, out of
 * edit mode, but it only opens while the board is edited - and nothing
 * asks before leaving a board with widgets not saved yet. A click on a
 * list's name, a honeycomb's tile or a map's site in the preview went to
 * that page, and the unsaved widgets went with it.
 *
 * Every list widget is opened here in the settings dialog, as a list and
 * as a honeycomb, and the network map as its map:
 *
 *   - in the preview a name is its words, drawn as on the board, with no
 *     link and nothing a click does; a tile and a site are no buttons, a
 *     click on one opens nothing and the tile's card says no "Click to
 *     open";
 *   - the same widget on the board, out of edit mode, keeps every link: a
 *     name's click goes to its page, a tile's and a site's open theirs.
 *
 * The lists read their rows through ModelAPI and AnalyticsModelAPI, stood
 * in for here; everything else - AppLink, the honeycomb, the map, the
 * routes - is the app's own.
 */

type ListRequest = { query: unknown; limit: number };
type ListResponse = { data: Array<Record<string, unknown>>; count: number };

const listMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();
const analyticsListMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();

// Lazy dereference: jest.mock factories are hoisted above these assignments.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest) => {
        return listMock(request);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest) => {
        return analyticsListMock(request);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("44444444-4444-4444-8444-444444444444");
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

// The map's land outlines: none, and nothing to fetch.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldGeometry",
  () => {
    return {
      __esModule: true,
      getCachedGeometryFeatures: () => {
        return [];
      },
      loadGeometryFeatures: () => {
        return Promise.resolve([]);
      },
    };
  },
);

// The settings form is not under test; the preview above it is.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import { HONEYCOMB_TILE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceHoneycomb";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import {
  BOARD_PATH,
  PREVIEW_WIDGET_ID,
  PreviewResizeObserver,
  boardCard,
  currentPath,
  drawWidgetOnBoard,
  linksIn,
  openWidgetSettings,
  previewBox,
  roleButtonsIn,
} from "./WidgetPreviewHarness";

// The names the rows carry: one for each kind of cell a list draws.
const NAME: string = "checkout-api-production-7d9f8b6c4";
const NAMESPACE: string = "payments-production";
const CLUSTER: string = "eu-west-production";
const HOST: string = "ip-10-0-12-34.eu-west-1.compute.internal";
const IMAGE: string = "registry.example.com/shop/checkout:1.4.2";
const SEEN_AT: string = "2026-11-10T10:00:00.000Z";

/*
 * A row every Postgres-backed list reads its own fields from (as the
 * lists' reading-direction suite builds it, DashboardListWidgetNameCells),
 * with the ids each one builds its row's page from: the host, cluster,
 * array or vCenter it belongs to, and its id there (externalId - a Ceph
 * OSD's name, osd.3, is its id as well).
 */
function modelRow(name: string): Record<string, unknown> {
  return {
    _id: ObjectID.generate().toString(),
    externalId: name,
    dockerHostId: ObjectID.generate().toString(),
    podmanHostId: ObjectID.generate().toString(),
    dockerSwarmClusterId: ObjectID.generate().toString(),
    kubernetesClusterId: ObjectID.generate().toString(),
    cephClusterId: ObjectID.generate().toString(),
    proxmoxClusterId: ObjectID.generate().toString(),
    storageArrayId: ObjectID.generate().toString(),
    vmwareVCenterId: ObjectID.generate().toString(),
    name: name,
    title: name,
    createdAt: SEEN_AT,
    monitorType: "API",
    currentMonitorStatus: { name: "Operational", color: "#10b981" },
    currentIncidentState: { name: "Identified", color: "#ef4444" },
    incidentSeverity: { name: "Critical" },
    currentAlertState: { name: "Identified", color: "#ef4444" },
    alertSeverity: { name: "Critical" },
    osType: "linux",
    osVersion: "6.8.0-124-generic",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(SEEN_AT),
    imageName: IMAGE,
    image: IMAGE,
    containerId: "sha256:3f4e9b2c7a1d",
    state: "running",
    dockerHost: { name: HOST },
    podmanHost: { name: HOST },
    namespaceKey: NAMESPACE,
    kubernetesCluster: { name: CLUSTER },
    phase: "Running",
    dockerSwarmCluster: { name: CLUSTER },
    role: "manager",
    serviceMode: "replicated",
    hostname: HOST,
    cephCluster: { name: CLUSTER },
    parentNodeName: "pve-eu-west-1",
    proxmoxCluster: { name: CLUSTER },
    guestType: "qemu",
    vmid: 101,
    storageArray: { name: "flasharray-eu-west" },
    clusterName: CLUSTER,
    vmwareVCenter: { name: "vcenter.eu-west.example.com" },
    hostName: "esxi-07.eu-west.example.com",
    networkSiteType: { name: "Edge data center" },
    latitude: 52.37,
    longitude: 4.9,
  };
}

// A span and a security event, as the analytics lists read them.
function analyticsRow(name: string): Record<string, unknown> {
  return {
    name: name,
    statusCode: 0,
    durationUnixNano: 1500000,
    startTime: SEEN_AT,
    spanId: ObjectID.generate().toString(),
    traceId: ObjectID.generate().toString(),
    time: SEEN_AT,
    severityName: "High",
    className: "Authentication",
    message: name,
    principalHost: HOST,
  };
}

interface ListWidgetCase {
  type: DashboardComponentType;
  // Its rows' names link to their pages, and its tiles open them.
  hasLinks: boolean;
  // It can be drawn as a honeycomb (viewMode "honeycomb").
  hasHoneycomb: boolean;
}

// Every list widget, as the reading-direction suite lists them.
const LIST_WIDGETS: Array<ListWidgetCase> = [
  { type: DashboardComponentType.MonitorList, hasLinks: true },
  { type: DashboardComponentType.IncidentList, hasLinks: true },
  { type: DashboardComponentType.AlertList, hasLinks: true },
  { type: DashboardComponentType.SloList, hasLinks: true },
  { type: DashboardComponentType.TraceList, hasLinks: false },
  {
    type: DashboardComponentType.SecurityEventsList,
    hasLinks: false,
    hasHoneycomb: false,
  },
  { type: DashboardComponentType.HostList, hasLinks: true },
  { type: DashboardComponentType.DockerHostList, hasLinks: true },
  { type: DashboardComponentType.DockerContainerList, hasLinks: true },
  { type: DashboardComponentType.DockerImageList, hasLinks: false },
  { type: DashboardComponentType.DockerNetworkList, hasLinks: false },
  { type: DashboardComponentType.DockerVolumeList, hasLinks: false },
  { type: DashboardComponentType.PodmanHostList, hasLinks: true },
  { type: DashboardComponentType.PodmanContainerList, hasLinks: true },
  { type: DashboardComponentType.PodmanImageList, hasLinks: false },
  { type: DashboardComponentType.PodmanNetworkList, hasLinks: false },
  { type: DashboardComponentType.PodmanVolumeList, hasLinks: false },
  { type: DashboardComponentType.DockerSwarmNodeList, hasLinks: true },
  { type: DashboardComponentType.DockerSwarmServiceList, hasLinks: true },
  { type: DashboardComponentType.KubernetesPodList, hasLinks: true },
  { type: DashboardComponentType.KubernetesDeploymentList, hasLinks: true },
  { type: DashboardComponentType.KubernetesStatefulSetList, hasLinks: true },
  { type: DashboardComponentType.KubernetesDaemonSetList, hasLinks: true },
  { type: DashboardComponentType.KubernetesJobList, hasLinks: true },
  { type: DashboardComponentType.KubernetesCronJobList, hasLinks: true },
  { type: DashboardComponentType.KubernetesNamespaceList, hasLinks: true },
  { type: DashboardComponentType.KubernetesNodeList, hasLinks: true },
  { type: DashboardComponentType.CephOsdList, hasLinks: true },
  { type: DashboardComponentType.CephPoolList, hasLinks: true },
  { type: DashboardComponentType.ProxmoxNodeList, hasLinks: true },
  { type: DashboardComponentType.ProxmoxGuestList, hasLinks: true },
  { type: DashboardComponentType.StorageArrayHardwareList, hasLinks: true },
  { type: DashboardComponentType.StorageArrayVolumeList, hasLinks: true },
  { type: DashboardComponentType.VMwareHostList, hasLinks: true },
  { type: DashboardComponentType.VMwareVirtualMachineList, hasLinks: true },
  // Drawn as its list (viewMode "list"), the network map's sites.
  {
    type: DashboardComponentType.NetworkMap,
    hasLinks: true,
    hasHoneycomb: false,
  },
].map((listWidget: Partial<ListWidgetCase>): ListWidgetCase => {
  return {
    type: listWidget.type!,
    hasLinks: Boolean(listWidget.hasLinks),
    hasHoneycomb: listWidget.hasHoneycomb !== false,
  };
});

const LINKED_LIST_WIDGETS: Array<ListWidgetCase> = LIST_WIDGETS.filter(
  (listWidget: ListWidgetCase): boolean => {
    return listWidget.hasLinks;
  },
);

const HONEYCOMB_WIDGETS: Array<ListWidgetCase> = LIST_WIDGETS.filter(
  (listWidget: ListWidgetCase): boolean => {
    return listWidget.hasHoneycomb;
  },
);

function componentOf(
  type: DashboardComponentType,
  viewMode: "list" | "honeycomb" | "map",
): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: PREVIEW_WIDGET_ID,
    componentType: type,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: viewMode === "map" ? {} : { viewMode: viewMode },
  } as unknown as DashboardBaseComponent;
}

function casesOf(
  listWidgets: Array<ListWidgetCase>,
): Array<[string, ListWidgetCase]> {
  return listWidgets.map(
    (listWidget: ListWidgetCase): [string, ListWidgetCase] => {
      return [listWidget.type, listWidget];
    },
  );
}

// The rows are in once the row's name is drawn.
async function waitForName(within: () => HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(within().textContent || "").toContain(NAME);
  });
}

// The innermost element that holds the row's name and nothing else.
function nameIn(element: HTMLElement): HTMLElement {
  const holders: Array<HTMLElement> = Array.from(
    element.querySelectorAll<HTMLElement>("tbody *"),
  ).filter((node: HTMLElement): boolean => {
    return (
      (node.textContent || "").trim() === NAME &&
      Array.from(node.children).every((child: Element): boolean => {
        return (child.textContent || "").trim() !== NAME;
      })
    );
  });

  expect(holders.length).toBeGreaterThan(0);

  return holders[0]!;
}

function tilesIn(element: HTMLElement): Array<HTMLElement> {
  return Array.from(
    element.querySelectorAll<HTMLElement>(
      `[data-testid="${HONEYCOMB_TILE_TEST_ID}"]`,
    ),
  );
}

async function waitForTiles(within: () => HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(tilesIn(within()).length).toBeGreaterThan(0);
  });
}

function markersIn(element: HTMLElement): Array<HTMLElement> {
  return Array.from(
    element.querySelectorAll<HTMLElement>(
      '[data-testid="network-map-widget-marker"]',
    ),
  );
}

// The classes that say a click does something.
const INTERACTIVE_CLASS: RegExp =
  /(?:^|:)(?:cursor-pointer)$|^(?:group-)?hover:/;

function interactiveClassesOf(element: HTMLElement): Array<string> {
  return Array.from(element.classList).filter((token: string): boolean => {
    return INTERACTIVE_CLASS.test(token);
  });
}

let navigateSpy: ReturnType<typeof jest.spyOn>;

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    PreviewResizeObserver;

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: readDashboardLocale("en") } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  listMock.mockReset();
  analyticsListMock.mockReset();
  listMock.mockResolvedValue({ data: [modelRow(NAME)], count: 1 });
  analyticsListMock.mockResolvedValue({
    data: [analyticsRow(NAME)],
    count: 1,
  });
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

test("every list widget is opened here, as a list and as a honeycomb", () => {
  // Thirty-six lists: a new one joins this suite, or the count says so.
  expect(LIST_WIDGETS).toHaveLength(36);
  expect(
    new Set(
      LIST_WIDGETS.map((listWidget: ListWidgetCase): string => {
        return listWidget.type;
      }),
    ).size,
  ).toBe(36);
  expect(LINKED_LIST_WIDGETS).toHaveLength(28);
  expect(HONEYCOMB_WIDGETS).toHaveLength(34);
});

describe("a list's names", () => {
  test.each(casesOf(LIST_WIDGETS))(
    "%s: in the settings' preview a name is its words, and a click on it stays on the board",
    async (_type: string, listWidget: ListWidgetCase) => {
      openWidgetSettings(componentOf(listWidget.type, "list"));
      await waitForName(previewBox);

      expect(linksIn(previewBox())).toEqual([]);
      expect(roleButtonsIn(previewBox())).toEqual([]);

      const name: HTMLElement = nameIn(previewBox());

      // Drawn as the board draws it, less what says "click me".
      expect(name.closest("a")).toBeNull();
      expect(interactiveClassesOf(name)).toEqual([]);
      if (listWidget.hasLinks) {
        expect(name.closest(".text-gray-700")).not.toBeNull();
      }

      fireEvent.click(name);

      expect(currentPath()).toBe(BOARD_PATH);
      expect(navigateSpy).not.toHaveBeenCalled();
    },
  );

  test.each(casesOf(LINKED_LIST_WIDGETS))(
    "%s: on the board, out of edit mode, the name links to its page",
    async (_type: string, listWidget: ListWidgetCase) => {
      drawWidgetOnBoard(componentOf(listWidget.type, "list"));
      await waitForName(boardCard);

      const links: Array<HTMLAnchorElement> = linksIn(boardCard());

      expect(links.length).toBeGreaterThan(0);

      const link: HTMLAnchorElement = nameIn(boardCard()).closest("a")!;

      expect(link).not.toBeNull();
      expect(link.getAttribute("href")).toMatch(/^\/dashboard\//);
      expect(link).toHaveClass("cursor-pointer");

      fireEvent.click(link);

      // The board's page is left for the row's.
      expect(currentPath()).toBe(link.getAttribute("href"));
      expect(currentPath()).not.toBe(BOARD_PATH);
    },
  );
});

describe("a list's honeycomb", () => {
  test.each(casesOf(HONEYCOMB_WIDGETS))(
    "%s: in the settings' preview a tile opens nothing and says nothing of opening",
    async (_type: string, listWidget: ListWidgetCase) => {
      openWidgetSettings(componentOf(listWidget.type, "honeycomb"));
      await waitForTiles(previewBox);

      expect(roleButtonsIn(previewBox())).toEqual([]);
      expect(linksIn(previewBox())).toEqual([]);

      for (const tile of tilesIn(previewBox())) {
        expect(tile).not.toHaveAttribute("role");
        expect(tile).not.toHaveAttribute("tabindex");
        expect(tile).toHaveClass("cursor-default");
        expect(tile).not.toHaveClass("cursor-pointer");

        fireEvent.click(tile);
        fireEvent.keyDown(tile, { key: "Enter" });
        fireEvent.mouseEnter(tile);

        // The tile's card names it, and no click.
        expect(document.body.textContent || "").toContain("Status");
        expect(screen.queryByText("Click to open")).toBeNull();

        fireEvent.mouseLeave(tile);
      }

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(currentPath()).toBe(BOARD_PATH);
    },
  );

  test.each(
    casesOf(
      HONEYCOMB_WIDGETS.filter((listWidget: ListWidgetCase): boolean => {
        return listWidget.hasLinks;
      }),
    ),
  )(
    "%s: on the board, out of edit mode, a tile opens its page",
    async (_type: string, listWidget: ListWidgetCase) => {
      drawWidgetOnBoard(componentOf(listWidget.type, "honeycomb"));
      await waitForTiles(boardCard);

      const tile: HTMLElement = tilesIn(boardCard())[0]!;

      expect(tile).toHaveAttribute("role", "button");
      expect(tile).toHaveAttribute("tabindex", "0");
      expect(tile).toHaveClass("cursor-pointer");

      fireEvent.mouseEnter(tile);
      expect(screen.getByText("Click to open")).toBeInTheDocument();
      fireEvent.mouseLeave(tile);

      fireEvent.click(tile);

      expect(navigateSpy).toHaveBeenCalledTimes(1);
      expect(String(navigateSpy.mock.calls[0]![0])).toMatch(/^\/dashboard\//);

      fireEvent.keyDown(tile, { key: "Enter" });

      expect(navigateSpy).toHaveBeenCalledTimes(2);
    },
  );
});

describe("the network map's sites", () => {
  test("in the settings' preview a site's marker is no button and opens nothing", async () => {
    openWidgetSettings(componentOf(DashboardComponentType.NetworkMap, "map"));

    await waitFor(() => {
      expect(markersIn(previewBox()).length).toBeGreaterThan(0);
    });

    expect(roleButtonsIn(previewBox())).toEqual([]);

    for (const marker of markersIn(previewBox())) {
      expect(marker).not.toHaveAttribute("role");
      expect(marker).not.toHaveAttribute("tabindex");
      expect(marker.style.cursor).toBe("default");
      // Still named, for whoever reads the map with a screen reader.
      expect(marker.getAttribute("aria-label") || "").toContain(NAME);

      fireEvent.click(marker);
      fireEvent.keyDown(marker, { key: "Enter" });
    }

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(currentPath()).toBe(BOARD_PATH);
  });

  test("on the board, out of edit mode, a site's marker opens the site", async () => {
    drawWidgetOnBoard(componentOf(DashboardComponentType.NetworkMap, "map"));

    await waitFor(() => {
      expect(markersIn(boardCard()).length).toBeGreaterThan(0);
    });

    const marker: HTMLElement = markersIn(boardCard())[0]!;

    expect(marker).toHaveAttribute("role", "button");
    expect(marker).toHaveAttribute("tabindex", "0");
    expect(marker.style.cursor).toBe("pointer");

    fireEvent.click(marker);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toContain(
      "/network-sites/view/",
    );
  });
});
