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
import {
  act,
  cleanup,
  render,
  RenderResult,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import React, { FunctionComponent } from "react";
import { initReactI18next } from "react-i18next";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import URL from "../../../Types/API/URL";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * EVERY LIST WIDGET'S NAMES, ON AN ARABIC OR PERSIAN BOARD (#6927).
 *
 * A list widget cuts a name short where its column ends (truncate). On an
 * Arabic or Persian board a cell runs from the right, so an English name
 * too long for it overflowed on the left and lost its start:
 * "checkout-api-production-7d9f8b6c4" read "...production-7d9f8b6c4", and
 * names that share their start - a cluster's pods, a host's containers -
 * all looked alike. The SLO list was fixed first (#6778); every other list
 * drew its names, images, namespaces, hosts and clusters as before.
 *
 * Each list widget is rendered here for real, with an English row and an
 * Arabic one, over the Dashboard's shipped locales:
 *
 *   - on an Arabic or Persian board, every cell that holds an English name
 *     reads left to right (dir="ltr"), so it is cut at its own end, and is
 *     lined up by its end (text-end), the board's side; an Arabic name's
 *     cell is drawn as it was;
 *   - on a German or English board an English name's cell is drawn as it
 *     always was, and an Arabic name's reads right to left;
 *   - a cell that holds a figure or a state (a time, a count, a status) is
 *     the board's on every board: it is written for its reader already;
 *   - on a public dashboard - an English page whatever its visitor's
 *     browser speaks - an English name is drawn as the English page draws
 *     it.
 */

type ListRequest = { query: JSONObject; limit: number };
type ListResponse = { data: Array<JSONObject>; count: number };

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return React.createElement("a", {}, props.children);
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      populateRouteParams: () => {
        return {
          toString: () => {
            return "/dashboard/resource";
          },
        };
      },
    },
  };
});

import DashboardAlertListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardAlertListComponent";
import DashboardCephOsdListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardCephOsdListComponent";
import DashboardCephPoolListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardCephPoolListComponent";
import DashboardDockerContainerListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerContainerListComponent";
import DashboardDockerHostListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerHostListComponent";
import DashboardDockerImageListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerImageListComponent";
import DashboardDockerNetworkListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerNetworkListComponent";
import DashboardDockerSwarmNodeListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerSwarmNodeListComponent";
import DashboardDockerSwarmServiceListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerSwarmServiceListComponent";
import DashboardDockerVolumeListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerVolumeListComponent";
import DashboardHostListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardHostListComponent";
import DashboardIncidentListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardIncidentListComponent";
import DashboardKubernetesCronJobListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesCronJobListComponent";
import DashboardKubernetesDaemonSetListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesDaemonSetListComponent";
import DashboardKubernetesDeploymentListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesDeploymentListComponent";
import DashboardKubernetesJobListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesJobListComponent";
import DashboardKubernetesNamespaceListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesNamespaceListComponent";
import DashboardKubernetesNodeListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesNodeListComponent";
import DashboardKubernetesPodListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesPodListComponent";
import DashboardKubernetesStatefulSetListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesStatefulSetListComponent";
import DashboardMonitorListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent";
import DashboardNetworkMapComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardNetworkMapComponent";
import DashboardPodmanContainerListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardPodmanContainerListComponent";
import DashboardPodmanHostListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardPodmanHostListComponent";
import DashboardPodmanImageListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardPodmanImageListComponent";
import DashboardPodmanNetworkListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardPodmanNetworkListComponent";
import DashboardPodmanVolumeListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardPodmanVolumeListComponent";
import DashboardProxmoxGuestListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProxmoxGuestListComponent";
import DashboardProxmoxNodeListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProxmoxNodeListComponent";
import DashboardSecurityEventsListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSecurityEventsListComponent";
import DashboardSloListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloListComponent";
import DashboardStorageArrayHardwareListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardStorageArrayHardwareListComponent";
import DashboardStorageArrayVolumeListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardStorageArrayVolumeListComponent";
import DashboardTraceListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceListComponent";
import DashboardVMwareHostListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardVMwareHostListComponent";
import DashboardVMwareVirtualMachineListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardVMwareVirtualMachineListComponent";

// The names the rows carry: one English name for each kind of cell.
const NAME: string = "checkout-api-production-7d9f8b6c4";
const ARABIC_NAME: string = "خادم الدفع الرئيسي";
const NAMESPACE: string = "payments-production";
const CLUSTER: string = "eu-west-production";
const HOST: string = "ip-10-0-12-34.eu-west-1.compute.internal";
const IMAGE: string = "registry.example.com/shop/checkout:1.4.2";
const IMAGE_ID: string = "sha256:3f4e9b2c7a1d";
const DRIVER_AND_SCOPE: string = "bridge / local";
const OS: string = "linux 6.8.0-124-generic";
const PROXMOX_NODE: string = "pve-eu-west-1";
const STORAGE_ARRAY: string = "flasharray-eu-west";
const VCENTER: string = "vcenter.eu-west.example.com";
const ESXI_HOST: string = "esxi-07.eu-west.example.com";
const EVENT_CLASS: string = "Authentication";
const EVENT_MESSAGE: string = "Failed login for admin from 203.0.113.7";
const SITE_TYPE: string = "Edge data center";

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-0000000000d1",
);
const DASHBOARD_ID: string = "d0000000-0000-4000-8000-0000000000d2";
const SEEN_AT: string = "2026-11-10T10:00:00.000Z";

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

const PUBLIC_DASHBOARD: PublicDashboardContext = {
  dashboardId: new ObjectID(DASHBOARD_ID),
  apiUrl: URL.fromString("https://dev.oneuptime.com/public-dashboard-api"),
  postJSON: async () => {
    throw new Error("Unexpected public request");
  },
  apiClient: {} as unknown as PublicDashboardContext["apiClient"],
};

/*
 * A row every Postgres-backed list reads its own fields from: each list
 * shows its name and the names it holds beside it (a container's image
 * and host, a pod's namespace and cluster, a VM's host and vCenter).
 */
function modelRow(name: string): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    name: name,
    title: name,
    createdAt: SEEN_AT,
    monitorType: "API",
    currentMonitorStatus: { name: "Operational" },
    currentIncidentState: { name: "Identified" },
    incidentSeverity: { name: "Critical" },
    currentAlertState: { name: "Identified" },
    alertSeverity: { name: "Critical" },
    osType: "linux",
    osVersion: "6.8.0-124-generic",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(SEEN_AT),
    imageName: IMAGE,
    image: IMAGE,
    containerId: IMAGE_ID,
    state: DRIVER_AND_SCOPE,
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
    parentNodeName: PROXMOX_NODE,
    proxmoxCluster: { name: CLUSTER },
    guestType: "qemu",
    vmid: 101,
    storageArray: { name: STORAGE_ARRAY },
    clusterName: CLUSTER,
    vmwareVCenter: { name: VCENTER },
    hostName: ESXI_HOST,
    networkSiteType: { name: SITE_TYPE },
    latitude: 52.37,
    longitude: 4.9,
  };
}

// A span and a security event, as the analytics lists read them.
function analyticsRow(name: string, eventClass: string): JSONObject {
  return {
    name: name,
    statusCode: 0,
    durationUnixNano: 1500000,
    startTime: SEEN_AT,
    spanId: ObjectID.generate().toString(),
    traceId: ObjectID.generate().toString(),
    time: SEEN_AT,
    severityName: "High",
    className: eventClass,
    message: EVENT_MESSAGE,
    principalHost: HOST,
  };
}

type ListWidgetElement = FunctionComponent<
  DashboardBaseComponentProps & { component: DashboardBaseComponent }
>;

// Each widget takes its own kind of component; this suite hands it its own.
function widget<TProps>(element: FunctionComponent<TProps>): ListWidgetElement {
  return element as unknown as ListWidgetElement;
}

interface ListWidgetCase {
  type: DashboardComponentType;
  element: ListWidgetElement;
  // Read from ClickHouse (AnalyticsModelAPI), not Postgres; never public.
  isAnalytics?: boolean;
  // The English names its cells hold, from the rows above.
  names: Array<string>;
}

const LIST_WIDGETS: Array<ListWidgetCase> = [
  {
    type: DashboardComponentType.MonitorList,
    element: widget(DashboardMonitorListComponentElement),
    names: [NAME],
  },
  {
    type: DashboardComponentType.IncidentList,
    element: widget(DashboardIncidentListComponentElement),
    names: [NAME],
  },
  {
    type: DashboardComponentType.AlertList,
    element: widget(DashboardAlertListComponentElement),
    names: [NAME],
  },
  {
    type: DashboardComponentType.SloList,
    element: widget(DashboardSloListComponentElement),
    names: [NAME],
  },
  {
    type: DashboardComponentType.TraceList,
    element: widget(DashboardTraceListComponentElement),
    isAnalytics: true,
    names: [NAME],
  },
  {
    type: DashboardComponentType.SecurityEventsList,
    element: widget(DashboardSecurityEventsListComponentElement),
    isAnalytics: true,
    names: [EVENT_CLASS, EVENT_MESSAGE, HOST],
  },
  {
    type: DashboardComponentType.HostList,
    element: widget(DashboardHostListComponentElement),
    names: [NAME, OS],
  },
  {
    type: DashboardComponentType.DockerHostList,
    element: widget(DashboardDockerHostListComponentElement),
    names: [NAME, OS],
  },
  {
    type: DashboardComponentType.DockerContainerList,
    element: widget(DashboardDockerContainerListComponentElement),
    names: [NAME, IMAGE, HOST],
  },
  {
    type: DashboardComponentType.DockerImageList,
    element: widget(DashboardDockerImageListComponentElement),
    names: [NAME, IMAGE_ID, HOST],
  },
  {
    type: DashboardComponentType.DockerNetworkList,
    element: widget(DashboardDockerNetworkListComponentElement),
    names: [NAME, DRIVER_AND_SCOPE, HOST],
  },
  {
    type: DashboardComponentType.DockerVolumeList,
    element: widget(DashboardDockerVolumeListComponentElement),
    names: [NAME, DRIVER_AND_SCOPE, HOST],
  },
  {
    type: DashboardComponentType.PodmanHostList,
    element: widget(DashboardPodmanHostListComponentElement),
    names: [NAME, OS],
  },
  {
    type: DashboardComponentType.PodmanContainerList,
    element: widget(DashboardPodmanContainerListComponentElement),
    names: [NAME, IMAGE, HOST],
  },
  {
    type: DashboardComponentType.PodmanImageList,
    element: widget(DashboardPodmanImageListComponentElement),
    names: [NAME, IMAGE_ID, HOST],
  },
  {
    type: DashboardComponentType.PodmanNetworkList,
    element: widget(DashboardPodmanNetworkListComponentElement),
    names: [NAME, DRIVER_AND_SCOPE, HOST],
  },
  {
    type: DashboardComponentType.PodmanVolumeList,
    element: widget(DashboardPodmanVolumeListComponentElement),
    names: [NAME, DRIVER_AND_SCOPE, HOST],
  },
  {
    type: DashboardComponentType.DockerSwarmNodeList,
    element: widget(DashboardDockerSwarmNodeListComponentElement),
    names: [NAME, CLUSTER],
  },
  {
    type: DashboardComponentType.DockerSwarmServiceList,
    element: widget(DashboardDockerSwarmServiceListComponentElement),
    names: [NAME, IMAGE],
  },
  {
    type: DashboardComponentType.KubernetesPodList,
    element: widget(DashboardKubernetesPodListComponentElement),
    names: [NAME, NAMESPACE, CLUSTER],
  },
  {
    type: DashboardComponentType.KubernetesDeploymentList,
    element: widget(DashboardKubernetesDeploymentListComponentElement),
    names: [NAME, NAMESPACE, CLUSTER],
  },
  {
    type: DashboardComponentType.KubernetesStatefulSetList,
    element: widget(DashboardKubernetesStatefulSetListComponentElement),
    names: [NAME, NAMESPACE, CLUSTER],
  },
  {
    type: DashboardComponentType.KubernetesDaemonSetList,
    element: widget(DashboardKubernetesDaemonSetListComponentElement),
    names: [NAME, NAMESPACE, CLUSTER],
  },
  {
    type: DashboardComponentType.KubernetesJobList,
    element: widget(DashboardKubernetesJobListComponentElement),
    names: [NAME, NAMESPACE, CLUSTER],
  },
  {
    type: DashboardComponentType.KubernetesCronJobList,
    element: widget(DashboardKubernetesCronJobListComponentElement),
    names: [NAME, NAMESPACE, CLUSTER],
  },
  {
    type: DashboardComponentType.KubernetesNamespaceList,
    element: widget(DashboardKubernetesNamespaceListComponentElement),
    names: [NAME, CLUSTER],
  },
  {
    type: DashboardComponentType.KubernetesNodeList,
    element: widget(DashboardKubernetesNodeListComponentElement),
    names: [NAME, CLUSTER],
  },
  {
    type: DashboardComponentType.CephOsdList,
    element: widget(DashboardCephOsdListComponentElement),
    names: [NAME, HOST, CLUSTER],
  },
  {
    type: DashboardComponentType.CephPoolList,
    element: widget(DashboardCephPoolListComponentElement),
    names: [NAME, CLUSTER],
  },
  {
    type: DashboardComponentType.ProxmoxNodeList,
    element: widget(DashboardProxmoxNodeListComponentElement),
    names: [NAME, CLUSTER],
  },
  {
    type: DashboardComponentType.ProxmoxGuestList,
    element: widget(DashboardProxmoxGuestListComponentElement),
    names: [NAME, PROXMOX_NODE, CLUSTER],
  },
  {
    type: DashboardComponentType.StorageArrayHardwareList,
    element: widget(DashboardStorageArrayHardwareListComponentElement),
    names: [NAME, STORAGE_ARRAY],
  },
  {
    type: DashboardComponentType.StorageArrayVolumeList,
    element: widget(DashboardStorageArrayVolumeListComponentElement),
    names: [NAME, STORAGE_ARRAY],
  },
  {
    type: DashboardComponentType.VMwareHostList,
    element: widget(DashboardVMwareHostListComponentElement),
    names: [NAME, CLUSTER, VCENTER],
  },
  {
    type: DashboardComponentType.VMwareVirtualMachineList,
    element: widget(DashboardVMwareVirtualMachineListComponentElement),
    names: [NAME, ESXI_HOST, VCENTER],
  },
  // Drawn as its list (viewMode "list"), the network map's sites.
  {
    type: DashboardComponentType.NetworkMap,
    element: widget(DashboardNetworkMapComponentElement),
    names: [NAME, SITE_TYPE],
  },
];

const POSTGRES_LIST_WIDGETS: Array<ListWidgetCase> = LIST_WIDGETS.filter(
  (listWidget: ListWidgetCase): boolean => {
    return !listWidget.isAnalytics;
  },
);

function componentOf(type: DashboardComponentType): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: type,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    /*
     * As a list: the Ceph OSD and storage hardware lists start as
     * honeycombs, the network map as a map.
     */
    arguments: { viewMode: "list" },
  } as unknown as DashboardBaseComponent;
}

function propsOf(
  type: DashboardComponentType,
): DashboardBaseComponentProps & { component: DashboardBaseComponent } {
  return {
    componentId: COMPONENT_ID,
    key: COMPONENT_ID.toString(),
    isEditMode: false,
    isSelected: false,
    onComponentUpdate: (): void => {
      // A list never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1280,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1280,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    refreshTick: 0,
    variables: [],
    dashboardId: DASHBOARD_ID,
    component: componentOf(type),
  };
}

// Every body cell of the widget's table.
function bodyCells(container: HTMLElement): Array<HTMLElement> {
  return Array.from(container.querySelectorAll("tbody td"));
}

// The body cells whose whole text is `text`.
function cellsHolding(
  container: HTMLElement,
  text: string,
): Array<HTMLElement> {
  return bodyCells(container).filter((cell: HTMLElement): boolean => {
    return (cell.textContent || "").trim() === text;
  });
}

async function drawList(listWidget: ListWidgetCase): Promise<RenderResult> {
  const Element: ListWidgetElement = listWidget.element;
  const result: RenderResult = render(
    <Element {...propsOf(listWidget.type)} />,
  );

  // Its rows are in once the Arabic row's name is.
  await waitFor(() => {
    expect(cellsHolding(result.container, ARABIC_NAME)).toHaveLength(1);
  });

  return result;
}

/*
 * The Ceph OSD and storage hardware lists watch their width; jsdom has no
 * ResizeObserver, and nothing here resizes.
 */
class StillResizeObserver {
  public observe(): void {
    // Nothing resizes here.
  }

  public unobserve(): void {
    // Nothing to stop watching.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    StillResizeObserver;

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ar: { translation: readDashboardLocale("ar") },
      fa: { translation: readDashboardLocale("fa") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  listMock.mockReset();
  analyticsListMock.mockReset();
  listMock.mockResolvedValue({
    data: [modelRow(NAME), modelRow(ARABIC_NAME)],
    count: 2,
  });
  analyticsListMock.mockResolvedValue({
    data: [
      analyticsRow(NAME, EVENT_CLASS),
      analyticsRow(ARABIC_NAME, ARABIC_NAME),
    ],
    count: 2,
  });
  window.localStorage.clear();
  setPublicDashboardContext(null);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setPublicDashboardContext(null);
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

test("every list widget is drawn here", () => {
  // Thirty-six lists: a new one joins this suite, or the count says so.
  expect(LIST_WIDGETS).toHaveLength(36);
  expect(
    new Set(
      LIST_WIDGETS.map((listWidget: ListWidgetCase): string => {
        return listWidget.type;
      }),
    ).size,
  ).toBe(LIST_WIDGETS.length);
});

describe.each(["ar", "fa"])("on a %s board", (language: string) => {
  beforeEach(async () => {
    await inLanguage(language);
  });

  test.each(
    LIST_WIDGETS.map((listWidget: ListWidgetCase): [string, ListWidgetCase] => {
      return [listWidget.type, listWidget];
    }),
  )(
    "%s: an English name is cut at its own end and lined up on the board's side; an Arabic one is drawn as it was",
    async (_type: string, listWidget: ListWidgetCase) => {
      const { container } = await drawList(listWidget);

      for (const name of listWidget.names) {
        const cells: Array<HTMLElement> = cellsHolding(container, name);

        // Named in the failure: the list draws this name in a cell of its own.
        expect({ name, drawn: cells.length > 0 }).toEqual({
          name,
          drawn: true,
        });

        for (const cell of cells) {
          expect({ name, dir: cell.getAttribute("dir") }).toEqual({
            name,
            dir: "ltr",
          });
          expect(cell).toHaveClass(
            "truncate",
            LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
          );
        }
      }

      const arabicCell: HTMLElement = cellsHolding(container, ARABIC_NAME)[0]!;

      expect(arabicCell).not.toHaveAttribute("dir");
      expect(arabicCell).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);

      /*
       * Only a name's cell reads its own way: a figure's or a state's is
       * the board's.
       */
      for (const cell of bodyCells(container)) {
        if (cell.hasAttribute("dir")) {
          expect(listWidget.names).toContain((cell.textContent || "").trim());
        }
      }
    },
  );
});

describe.each(["de", "en"])("on a %s board", (language: string) => {
  beforeEach(async () => {
    await inLanguage(language);
  });

  test.each(
    LIST_WIDGETS.map((listWidget: ListWidgetCase): [string, ListWidgetCase] => {
      return [listWidget.type, listWidget];
    }),
  )(
    "%s: an English name's cell is drawn as it always was; an Arabic name's reads right to left",
    async (_type: string, listWidget: ListWidgetCase) => {
      const { container } = await drawList(listWidget);

      for (const name of listWidget.names) {
        for (const cell of cellsHolding(container, name)) {
          expect(cell).not.toHaveAttribute("dir");
          expect(cell).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
          expect(cell).toHaveClass("truncate");
        }
      }

      const arabicCell: HTMLElement = cellsHolding(container, ARABIC_NAME)[0]!;

      expect(arabicCell).toHaveAttribute("dir", "rtl");
      expect(arabicCell).toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);

      // The Arabic name's is the only cell that reads its own way.
      expect(
        bodyCells(container).filter((cell: HTMLElement): boolean => {
          return cell.hasAttribute("dir");
        }),
      ).toEqual([arabicCell]);
    },
  );
});

describe("on a public dashboard, an English page whatever its visitor's browser speaks", () => {
  test.each(
    POSTGRES_LIST_WIDGETS.map(
      (listWidget: ListWidgetCase): [string, ListWidgetCase] => {
        return [listWidget.type, listWidget];
      },
    ),
  )(
    "%s: a visitor reading Arabic sees an English name as the English page draws it",
    async (_type: string, listWidget: ListWidgetCase) => {
      setPublicDashboardContext(PUBLIC_DASHBOARD);
      await inLanguage("ar");

      const { container } = await drawList(listWidget);

      for (const name of listWidget.names) {
        const cells: Array<HTMLElement> = cellsHolding(container, name);

        expect(cells.length).toBeGreaterThan(0);

        for (const cell of cells) {
          expect(cell).not.toHaveAttribute("dir");
          expect(cell).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        }
      }

      // An Arabic name there reads right to left, as on any English page.
      expect(cellsHolding(container, ARABIC_NAME)[0]).toHaveAttribute(
        "dir",
        "rtl",
      );
    },
  );
});
