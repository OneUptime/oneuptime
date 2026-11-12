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
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import i18next from "i18next";
import React, { FunctionComponent } from "react";
import { initReactI18next } from "react-i18next";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import DashboardResourceListBase, {
  RESOURCE_LIST_COUNT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceListBase";
import {
  getStandaloneText,
  getUnnamedText,
  getUnsetText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetFallbackWords";
import { setPublicDashboardContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { PluralTemplate, Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A LIST WIDGET'S COUNT, AND THE WORDS IT DRAWS FOR WHAT A ROW DOES NOT
 * HAVE, IN THE READER'S LANGUAGE (#6992, #7091).
 *
 * Every list widget wrote its count as a figure and an English noun: "1
 * hosts" on an English board, "12 pods" on a German or Persian one. The
 * count is a plural sentence now, in the reader's language and in the
 * form its count takes: "1 host", "12 Hosts", "المضيفون: 12", "۱۲ میزبان".
 *
 * And a row with no name read "Unnamed", a VMware host in no cluster
 * "Standalone", in English on every board. Each is the reader's word now.
 *
 * Each list widget is rendered here for real, over the Dashboard's
 * shipped locales.
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

const NAME: string = "checkout-api-production-7d9f8b6c4";
const OTHER_NAME: string = "search-api-production-5c8d7e6f1";
const CLUSTER: string = "eu-west-production";
const HOST: string = "ip-10-0-12-34.eu-west-1.compute.internal";
const SEEN_AT: string = "2026-11-12T10:00:00.000Z";
const TITLE: string = "Fleet";

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000006992",
);
const DASHBOARD_ID: string = "d0000000-0000-4000-8000-000000006992";

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

// The languages each list is drawn in here; every language's words are checked in its locale.
const DRAWN_LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

/*
 * A row every Postgres-backed list reads its own fields from, as the
 * name cells suite builds it.
 */
function modelRow(name: string, overrides: JSONObject = {}): JSONObject {
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
    imageName: "registry.example.com/shop/checkout:1.4.2",
    image: "registry.example.com/shop/checkout:1.4.2",
    containerId: "sha256:3f4e9b2c7a1d",
    state: "bridge / local",
    dockerHost: { name: HOST },
    podmanHost: { name: HOST },
    namespaceKey: "payments-production",
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
    ...overrides,
  };
}

// A span and a security event, as the analytics lists read them.
function analyticsRow(name: string): JSONObject {
  return {
    name: name,
    statusCode: 0,
    durationUnixNano: 1500000,
    startTime: SEEN_AT,
    spanId: ObjectID.generate().toString(),
    traceId: ObjectID.generate().toString(),
    time: SEEN_AT,
    severityName: "High",
    className: name,
    message: `Failed login for ${name}`,
    principalHost: HOST,
  };
}

type ListWidgetElement = FunctionComponent<
  DashboardBaseComponentProps & { component: DashboardBaseComponent }
>;

function widget<TProps>(element: FunctionComponent<TProps>): ListWidgetElement {
  return element as unknown as ListWidgetElement;
}

interface ListWidgetCase {
  type: DashboardComponentType;
  element: ListWidgetElement;
  // Its count, in English, as the widget hands it to the list base.
  countLabel: PluralTemplate;
  // Read from ClickHouse (AnalyticsModelAPI), not Postgres.
  isAnalytics?: boolean;
  // Its name cell says Unnamed for a row with no name.
  namesTheUnnamed?: boolean;
}

function count(one: string, other: string): PluralTemplate {
  return { one: `{{count}} ${one}`, other: `{{count}} ${other}` };
}

const LIST_WIDGETS: Array<ListWidgetCase> = [
  {
    type: DashboardComponentType.MonitorList,
    element: widget(DashboardMonitorListComponentElement),
    countLabel: count("monitor", "monitors"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.IncidentList,
    element: widget(DashboardIncidentListComponentElement),
    countLabel: count("incident", "incidents"),
  },
  {
    type: DashboardComponentType.AlertList,
    element: widget(DashboardAlertListComponentElement),
    countLabel: count("alert", "alerts"),
  },
  {
    type: DashboardComponentType.SloList,
    element: widget(DashboardSloListComponentElement),
    countLabel: count("SLO", "SLOs"),
  },
  {
    type: DashboardComponentType.TraceList,
    element: widget(DashboardTraceListComponentElement),
    countLabel: count("trace", "traces"),
    isAnalytics: true,
  },
  {
    type: DashboardComponentType.SecurityEventsList,
    element: widget(DashboardSecurityEventsListComponentElement),
    countLabel: count("event", "events"),
    isAnalytics: true,
  },
  {
    type: DashboardComponentType.HostList,
    element: widget(DashboardHostListComponentElement),
    countLabel: count("host", "hosts"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.DockerHostList,
    element: widget(DashboardDockerHostListComponentElement),
    countLabel: count("host", "hosts"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.DockerContainerList,
    element: widget(DashboardDockerContainerListComponentElement),
    countLabel: count("container", "containers"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.DockerImageList,
    element: widget(DashboardDockerImageListComponentElement),
    countLabel: count("container image", "container images"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.DockerNetworkList,
    element: widget(DashboardDockerNetworkListComponentElement),
    countLabel: count("network", "networks"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.DockerVolumeList,
    element: widget(DashboardDockerVolumeListComponentElement),
    countLabel: count("volume", "volumes"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.PodmanHostList,
    element: widget(DashboardPodmanHostListComponentElement),
    countLabel: count("host", "hosts"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.PodmanContainerList,
    element: widget(DashboardPodmanContainerListComponentElement),
    countLabel: count("container", "containers"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.PodmanImageList,
    element: widget(DashboardPodmanImageListComponentElement),
    countLabel: count("container image", "container images"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.PodmanNetworkList,
    element: widget(DashboardPodmanNetworkListComponentElement),
    countLabel: count("network", "networks"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.PodmanVolumeList,
    element: widget(DashboardPodmanVolumeListComponentElement),
    countLabel: count("volume", "volumes"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.DockerSwarmNodeList,
    element: widget(DashboardDockerSwarmNodeListComponentElement),
    countLabel: count("node", "nodes"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.DockerSwarmServiceList,
    element: widget(DashboardDockerSwarmServiceListComponentElement),
    countLabel: count("service", "services"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.KubernetesPodList,
    element: widget(DashboardKubernetesPodListComponentElement),
    countLabel: count("pod", "pods"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.KubernetesDeploymentList,
    element: widget(DashboardKubernetesDeploymentListComponentElement),
    countLabel: count("deployment", "deployments"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.KubernetesStatefulSetList,
    element: widget(DashboardKubernetesStatefulSetListComponentElement),
    countLabel: count("statefulset", "statefulsets"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.KubernetesDaemonSetList,
    element: widget(DashboardKubernetesDaemonSetListComponentElement),
    countLabel: count("daemonset", "daemonsets"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.KubernetesJobList,
    element: widget(DashboardKubernetesJobListComponentElement),
    countLabel: count("job", "jobs"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.KubernetesCronJobList,
    element: widget(DashboardKubernetesCronJobListComponentElement),
    countLabel: count("cronjob", "cronjobs"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.KubernetesNamespaceList,
    element: widget(DashboardKubernetesNamespaceListComponentElement),
    countLabel: count("namespace", "namespaces"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.KubernetesNodeList,
    element: widget(DashboardKubernetesNodeListComponentElement),
    countLabel: count("node", "nodes"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.CephOsdList,
    element: widget(DashboardCephOsdListComponentElement),
    countLabel: count("OSD", "OSDs"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.CephPoolList,
    element: widget(DashboardCephPoolListComponentElement),
    countLabel: count("pool", "pools"),
  },
  {
    type: DashboardComponentType.ProxmoxNodeList,
    element: widget(DashboardProxmoxNodeListComponentElement),
    countLabel: count("node", "nodes"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.ProxmoxGuestList,
    element: widget(DashboardProxmoxGuestListComponentElement),
    countLabel: count("guest", "guests"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.StorageArrayHardwareList,
    element: widget(DashboardStorageArrayHardwareListComponentElement),
    countLabel: count("component", "components"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.StorageArrayVolumeList,
    element: widget(DashboardStorageArrayVolumeListComponentElement),
    countLabel: count("volume", "volumes"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.VMwareHostList,
    element: widget(DashboardVMwareHostListComponentElement),
    countLabel: count("host", "hosts"),
    namesTheUnnamed: true,
  },
  {
    type: DashboardComponentType.VMwareVirtualMachineList,
    element: widget(DashboardVMwareVirtualMachineListComponentElement),
    countLabel: count("virtual machine", "virtual machines"),
    namesTheUnnamed: true,
  },
  // Drawn as its list (viewMode "list"), the network map's sites.
  {
    type: DashboardComponentType.NetworkMap,
    element: widget(DashboardNetworkMapComponentElement),
    countLabel: count("site", "sites"),
  },
];

function componentOf(
  type: DashboardComponentType,
  widgetArguments: JSONObject = {},
): DashboardBaseComponent {
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
    // As a list, under a title: the count is drawn beside the title.
    arguments: { viewMode: "list", title: TITLE, ...widgetArguments },
  } as unknown as DashboardBaseComponent;
}

function propsOf(
  type: DashboardComponentType,
  widgetArguments: JSONObject = {},
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
    component: componentOf(type, widgetArguments),
  };
}

function bodyCells(container: HTMLElement): Array<HTMLElement> {
  return Array.from(container.querySelectorAll("tbody td"));
}

function cellsHolding(
  container: HTMLElement,
  text: string,
): Array<HTMLElement> {
  return bodyCells(container).filter((cell: HTMLElement): boolean => {
    return (cell.textContent || "").trim() === text;
  });
}

// Draws the list over `rows` and waits for the row named `named`.
async function drawList(
  listWidget: ListWidgetCase,
  named: string,
): Promise<RenderResult> {
  const Element: ListWidgetElement = listWidget.element;
  const result: RenderResult = render(
    <Element {...propsOf(listWidget.type)} />,
  );

  await waitFor(() => {
    expect(cellsHolding(result.container, named).length).toBeGreaterThan(0);
  });

  return result;
}

function countBesideTitle(): HTMLElement {
  return screen.getByTestId(RESOURCE_LIST_COUNT_TEST_ID);
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

function rowsAre(modelRows: Array<JSONObject>, names: Array<string>): void {
  listMock.mockResolvedValue({ data: modelRows, count: modelRows.length });
  analyticsListMock.mockResolvedValue({
    data: names.map((name: string): JSONObject => {
      return analyticsRow(name);
    }),
    count: names.length,
  });
}

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    StillResizeObserver;

  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  listMock.mockReset();
  analyticsListMock.mockReset();
  rowsAre([modelRow(NAME), modelRow(OTHER_NAME)], [NAME, OTHER_NAME]);
  window.localStorage.clear();
  setPublicDashboardContext(null);
  await inLanguage("en");
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
  // Thirty-six lists, as the name cells suite has: a new one joins both.
  expect(LIST_WIDGETS).toHaveLength(36);
  expect(
    new Set(
      LIST_WIDGETS.map((listWidget: ListWidgetCase): string => {
        return listWidget.type;
      }),
    ).size,
  ).toBe(LIST_WIDGETS.length);
});

describe("a list's count beside its title", () => {
  function drawBase(countValue: number, title: string | undefined): void {
    render(
      <DashboardResourceListBase
        title={title}
        countLabel={{ one: "{{count}} host", other: "{{count}} hosts" }}
        columns={[{ label: "Host", widthPct: "100%" }]}
        count={countValue}
        isLoading={false}
        error={null}
        isEmpty={true}
        emptyMessage="No hosts yet"
        emptyIcon={IconProp.Server}
      />,
    );
  }

  test.each([
    ["en", 1, "1 host"],
    ["en", 12, "12 hosts"],
    ["en", 0, "0 hosts"],
    ["en", 1234, "1,234 hosts"],
    ["de", 1, "1 Host"],
    ["de", 12, "12 Hosts"],
    ["de", 1234, "1.234 Hosts"],
    ["ar", 1, "1 مضيف"],
    ["ar", 12, "المضيفون: 12"],
    ["fa", 1, "۱ میزبان"],
    ["fa", 12, "۱۲ میزبان"],
  ])(
    "on a %s board, %d of them read %s",
    async (language: string, countValue: number, expected: string) => {
      await inLanguage(language);
      drawBase(countValue, "Fleet hosts");

      expect(countBesideTitle().textContent).toBe(expected);
    },
  );

  test("an English board no longer says 1 hosts", async () => {
    drawBase(1, "Fleet hosts");

    expect(countBesideTitle()).not.toHaveTextContent("1 hosts");
  });

  test("a Persian board writes the count in Persian digits, an Arabic one in Latin digits", async () => {
    await inLanguage("fa");
    drawBase(12, "Fleet hosts");
    expect(countBesideTitle().textContent).not.toMatch(/[0-9]/);
    cleanup();

    await inLanguage("ar");
    drawBase(12, "Fleet hosts");
    expect(countBesideTitle().textContent).toContain("12");
  });

  test("the count follows the reader when they change language", async () => {
    drawBase(12, "Fleet hosts");
    expect(countBesideTitle().textContent).toBe("12 hosts");

    await inLanguage("de");
    expect(countBesideTitle().textContent).toBe("12 Hosts");

    await inLanguage("en");
    expect(countBesideTitle().textContent).toBe("12 hosts");
  });

  test("with no title there is no count to draw", () => {
    drawBase(12, undefined);

    expect(screen.queryByTestId(RESOURCE_LIST_COUNT_TEST_ID)).toBeNull();
  });

  /*
   * As plain as the title beside it, as a Table widget's count is: gray-300
   * all but vanished on a light board (1.5:1 on white) and outshone the
   * title on a dark one.
   */
  test("the count is drawn in its title's gray", () => {
    drawBase(12, "Fleet hosts");

    expect(screen.getByText("Fleet hosts")).toHaveClass("text-gray-400");
    expect(countBesideTitle()).toHaveClass("text-gray-400");
    expect(countBesideTitle()).not.toHaveClass("text-gray-300");
  });
});

describe("every list widget's count, in the reader's language", () => {
  test.each(
    LIST_WIDGETS.map((listWidget: ListWidgetCase): [string, ListWidgetCase] => {
      return [listWidget.type, listWidget];
    }),
  )(
    "%s: its count is a sentence in the reader's language, in the form its count takes",
    async (_type: string, listWidget: ListWidgetCase) => {
      for (const language of DRAWN_LANGUAGES) {
        await inLanguage(language);

        const translator: Translator = dashboardTranslator(language);

        await drawList(listWidget, NAME);

        expect({ language, count: countBesideTitle().textContent }).toEqual({
          language,
          count: translator.translatePlural(listWidget.countLabel, 2),
        });

        if (language === "en") {
          expect(countBesideTitle().textContent).toBe(
            listWidget.countLabel.other.replace("{{count}}", "2"),
          );
        }

        cleanup();
      }
    },
  );

  test.each(
    LIST_WIDGETS.map((listWidget: ListWidgetCase): [string, ListWidgetCase] => {
      return [listWidget.type, listWidget];
    }),
  )(
    "%s: one of them reads in the language's form for one",
    async (_type: string, listWidget: ListWidgetCase) => {
      rowsAre([modelRow(NAME)], [NAME]);

      for (const language of ["en", "de"]) {
        await inLanguage(language);
        await drawList(listWidget, NAME);

        expect(countBesideTitle().textContent).toBe(
          dashboardTranslator(language).translatePlural(
            listWidget.countLabel,
            1,
          ),
        );

        if (language === "en") {
          expect(countBesideTitle().textContent).toBe(
            listWidget.countLabel.one.replace("{{count}}", "1"),
          );
        }

        cleanup();
      }
    },
  );

  test("every list's count is worded in every Dashboard language, both its forms, its count kept", () => {
    const unworded: Array<string> = [];

    for (const listWidget of LIST_WIDGETS) {
      for (const language of DASHBOARD_LANGUAGES) {
        const words: Record<string, string> = readDashboardLocale(language);

        for (const key of [
          listWidget.countLabel.other,
          `${listWidget.countLabel.other}_one`,
        ]) {
          if (!isWordedInDashboardLocale(key, language)) {
            unworded.push(`${language}: ${key}`);
            continue;
          }

          expect({
            language,
            key,
            placeholders: placeholdersOf(words[key]!),
          }).toEqual({ language, key, placeholders: ["{{count}}"] });
        }
      }
    }

    expect(unworded).toEqual([]);
  });

  test("the English locale holds each count's one form under its other form's key", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const listWidget of LIST_WIDGETS) {
      expect(english[listWidget.countLabel.other]).toBe(
        listWidget.countLabel.other,
      );
      expect(english[`${listWidget.countLabel.other}_one`]).toBe(
        listWidget.countLabel.one,
      );
    }
  });
});

describe("a row with no name, in the reader's language", () => {
  const NAMING_WIDGETS: Array<ListWidgetCase> = LIST_WIDGETS.filter(
    (listWidget: ListWidgetCase): boolean => {
      return Boolean(listWidget.namesTheUnnamed);
    },
  );

  test("twenty-nine lists name a row that has no name", () => {
    expect(NAMING_WIDGETS).toHaveLength(29);
  });

  test.each(
    NAMING_WIDGETS.map(
      (listWidget: ListWidgetCase): [string, ListWidgetCase] => {
        return [listWidget.type, listWidget];
      },
    ),
  )(
    "%s: a row with no name reads the reader's word for Unnamed",
    async (_type: string, listWidget: ListWidgetCase) => {
      rowsAre([modelRow(""), modelRow(NAME)], ["", NAME]);

      for (const language of DRAWN_LANGUAGES) {
        await inLanguage(language);

        const unnamed: string =
          readDashboardLocale(language)["Unnamed"] || "Unnamed";
        const { container } = await drawList(listWidget, NAME);

        expect({
          language,
          cells: cellsHolding(container, unnamed).length,
        }).toEqual({ language, cells: 1 });

        if (language !== "en") {
          expect(unnamed).not.toBe("Unnamed");
          expect(cellsHolding(container, "Unnamed")).toHaveLength(0);
        }

        cleanup();
      }
    },
  );

  test("a German board says Unbenannt", async () => {
    rowsAre([modelRow(""), modelRow(NAME)], ["", NAME]);
    await inLanguage("de");

    const { container } = await drawList(LIST_WIDGETS[0]!, NAME);

    expect(cellsHolding(container, "Unbenannt")).toHaveLength(1);
  });
});

describe("a VMware host in no cluster, in the reader's language", () => {
  const VMWARE_HOSTS: ListWidgetCase = LIST_WIDGETS.find(
    (listWidget: ListWidgetCase): boolean => {
      return listWidget.type === DashboardComponentType.VMwareHostList;
    },
  )!;

  test.each([
    ["en", "Standalone"],
    ["de", "Eigenständig"],
    ["ar", "مستقل"],
    ["fa", "مستقل"],
  ])(
    "on a %s board it reads %s",
    async (language: string, standalone: string) => {
      rowsAre(
        [modelRow(NAME, { clusterName: "" }), modelRow(OTHER_NAME)],
        [NAME, OTHER_NAME],
      );
      await inLanguage(language);

      const { container } = await drawList(VMWARE_HOSTS, NAME);

      expect(cellsHolding(container, standalone)).toHaveLength(1);
      // The host in a cluster still says its cluster.
      expect(cellsHolding(container, CLUSTER)).toHaveLength(1);

      if (language !== "en") {
        expect(cellsHolding(container, "Standalone")).toHaveLength(0);
      }
    },
  );
});

describe("the words a widget draws for what it does not have", () => {
  test("each is the reader's word, from the translator it is handed", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);
      const words: Record<string, string> = readDashboardLocale(language);

      expect(getUnnamedText(translator)).toBe(words["Unnamed"]);
      expect(getStandaloneText(translator)).toBe(words["Standalone"]);
      expect(getUnsetText(translator)).toBe(words["(unset)"]);

      for (const key of ["Unnamed", "Standalone", "(unset)"]) {
        expect({
          language,
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ language, key, worded: true });
      }
    }
  });

  test("with no translator handed, the page's: English until a language is set", async () => {
    expect(getUnnamedText()).toBe("Unnamed");
    expect(getStandaloneText()).toBe("Standalone");
    expect(getUnsetText()).toBe("(unset)");

    await inLanguage("de");

    expect(getUnnamedText()).toBe("Unbenannt");
    expect(getStandaloneText()).toBe("Eigenständig");
    expect(getUnsetText()).toBe("(nicht gesetzt)");
  });
});

/*
 * The source, held to it: no list hands its list base an English noun to
 * put after its count, and no widget writes Unnamed, Standalone or (unset)
 * itself - each is looked up (DashboardWidgetFallbackWords).
 */
describe("the widgets' source", () => {
  const WIDGETS_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard",
  );
  // The list base the infrastructure lists draw through, kept beside their pages.
  const MODEL_LIST_BASE: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/DashboardModelResourceListBase.tsx",
  );
  const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
  // The prop that put an English noun after a list's count.
  const PLURAL_LABEL_PROP: RegExp = /\bpluralLabel\b/;

  function sourcesUnder(
    directory: string,
  ): Array<{ file: string; source: string }> {
    const found: Array<{ file: string; source: string }> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        found.push(...sourcesUnder(full));
      } else if (TYPESCRIPT_FILE.test(entry.name)) {
        found.push({ file: full, source: fs.readFileSync(full, "utf8") });
      }
    }

    return found;
  }

  // The code alone: what a comment says is not drawn.
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  const SOURCES: Array<{ file: string; source: string }> = [
    ...sourcesUnder(WIDGETS_DIR),
    { file: MODEL_LIST_BASE, source: fs.readFileSync(MODEL_LIST_BASE, "utf8") },
  ];

  test("reads the widgets", () => {
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  test("no list hands its list base a plural label: every count is a plural sentence", () => {
    const offenders: Array<string> = SOURCES.filter(
      (entry: { file: string; source: string }): boolean => {
        return PLURAL_LABEL_PROP.test(entry.source);
      },
    ).map((entry: { file: string }): string => {
      return path.basename(entry.file);
    });

    expect(offenders).toEqual([]);
  });

  test("no widget writes Unnamed, Standalone or (unset) itself", () => {
    const offenders: Array<string> = [];

    for (const entry of SOURCES) {
      if (path.basename(entry.file) === "DashboardWidgetFallbackWords.ts") {
        continue;
      }

      const code: string = withoutComments(entry.source);

      for (const word of [
        '"Unnamed"',
        '"Standalone"',
        '"(unset)"',
        ">(unset)<",
      ]) {
        if (code.includes(word)) {
          offenders.push(`${path.basename(entry.file)}: ${word}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("every list widget's count label is one this suite draws", () => {
    const COUNT_LABEL: RegExp =
      /countLabel=\{\{\s*one: "([^"]*)",\s*other: "([^"]*)",?\s*\}\}/g;
    const inSource: Array<string> = [];

    for (const entry of SOURCES) {
      for (const match of entry.source.matchAll(COUNT_LABEL)) {
        inSource.push(`${match[1]} | ${match[2]}`);
      }
    }

    expect(inSource.sort()).toEqual(
      LIST_WIDGETS.map((listWidget: ListWidgetCase): string => {
        return `${listWidget.countLabel.one} | ${listWidget.countLabel.other}`;
      }).sort(),
    );
  });
});
