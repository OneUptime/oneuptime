import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import AlertService from "../../../Server/Services/AlertService";
import CephResourceService from "../../../Server/Services/CephResourceService";
import DashboardService from "../../../Server/Services/DashboardService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerResourceService from "../../../Server/Services/DockerResourceService";
import DockerSwarmResourceService from "../../../Server/Services/DockerSwarmResourceService";
import HostService from "../../../Server/Services/HostService";
import IncidentService from "../../../Server/Services/IncidentService";
import KubernetesResourceService from "../../../Server/Services/KubernetesResourceService";
import LogService from "../../../Server/Services/LogService";
import MonitorService from "../../../Server/Services/MonitorService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import PodmanResourceService from "../../../Server/Services/PodmanResourceService";
import ProxmoxResourceService from "../../../Server/Services/ProxmoxResourceService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import SpanService from "../../../Server/Services/SpanService";
import StorageArrayResourceService from "../../../Server/Services/StorageArrayResourceService";
import VMwareResourceService from "../../../Server/Services/VMwareResourceService";
import PublicDashboardResourceListPolicy, {
  BuildPublicDashboardResourceListPolicyData,
  PublicDashboardResourceListPolicyResult,
} from "../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import { SloWidgetDisplayType } from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import SloHistoryService from "../../../Server/Services/SloHistoryService";
import {
  PUBLIC_SLO_WIDGET_MULTIPLE_SELECTION_MESSAGE,
  PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE,
  PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE,
} from "../../../Server/Utils/Dashboard/PublicDashboardSloWidget";
import { SLO_LIST_DEFAULT_MAX_ROWS } from "../../../Utils/Slo/SloListWidgetFormat";
import DashboardResourceList from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardResourceList";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { FindOperator } from "typeorm";

import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  idsOfAnyFilter,
  makeIncidentStates,
  mockProjectStates,
  openStateIds,
} from "../TestingUtils/Services/ProjectStatesHelper";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const RESOURCE_LIST_ROUTE: string =
  "/dashboard/resource-list/:dashboardId/:resourceType";

type ListService = {
  findBy: (findBy: never) => Promise<Array<unknown>>;
};

interface BuiltWidget {
  widget: JSONObject;
  componentId: ObjectID;
}

interface BuildWidgetData {
  componentType: DashboardComponentType;
  argumentsObject?: JSONObject | undefined;
  componentId?: ObjectID | undefined;
  storedIdShape?: "object" | "string" | "serialized" | undefined;
}

interface CallRouteData {
  resourceType: string;
  body?: JSONObject | undefined;
  query?: JSONObject | undefined;
}

interface ResourceRouteCase {
  resourceType: string;
  componentType: DashboardComponentType;
  service: ListService;
  kind: string | null;
  /** Stored widget arguments this component type cannot be built without. */
  argumentsObject?: JSONObject | undefined;
}

/*
 * The SLO widget names one SLO outright, so unlike every other resource it
 * has no valid empty configuration.
 */
const SLO_ID: ObjectID = ObjectID.generate();

const RESOURCE_ROUTE_CASES: Array<ResourceRouteCase> = [
  {
    resourceType: "incident",
    componentType: DashboardComponentType.IncidentList,
    service: IncidentService,
    kind: null,
  },
  {
    resourceType: "alert",
    componentType: DashboardComponentType.AlertList,
    service: AlertService,
    kind: null,
  },
  {
    resourceType: "monitor",
    componentType: DashboardComponentType.MonitorList,
    service: MonitorService,
    kind: null,
  },
  {
    resourceType: "network-site",
    componentType: DashboardComponentType.NetworkMap,
    service: NetworkSiteService,
    kind: null,
  },
  {
    resourceType: "host",
    componentType: DashboardComponentType.HostList,
    service: HostService,
    kind: null,
  },
  {
    resourceType: "kubernetes-resource",
    componentType: DashboardComponentType.KubernetesPodList,
    service: KubernetesResourceService,
    kind: "Pod",
  },
  {
    resourceType: "kubernetes-resource",
    componentType: DashboardComponentType.KubernetesNodeList,
    service: KubernetesResourceService,
    kind: "Node",
  },
  {
    resourceType: "kubernetes-resource",
    componentType: DashboardComponentType.KubernetesNamespaceList,
    service: KubernetesResourceService,
    kind: "Namespace",
  },
  {
    resourceType: "kubernetes-resource",
    componentType: DashboardComponentType.KubernetesDeploymentList,
    service: KubernetesResourceService,
    kind: "Deployment",
  },
  {
    resourceType: "kubernetes-resource",
    componentType: DashboardComponentType.KubernetesStatefulSetList,
    service: KubernetesResourceService,
    kind: "StatefulSet",
  },
  {
    resourceType: "kubernetes-resource",
    componentType: DashboardComponentType.KubernetesDaemonSetList,
    service: KubernetesResourceService,
    kind: "DaemonSet",
  },
  {
    resourceType: "kubernetes-resource",
    componentType: DashboardComponentType.KubernetesJobList,
    service: KubernetesResourceService,
    kind: "Job",
  },
  {
    resourceType: "kubernetes-resource",
    componentType: DashboardComponentType.KubernetesCronJobList,
    service: KubernetesResourceService,
    kind: "CronJob",
  },
  {
    resourceType: "docker-host",
    componentType: DashboardComponentType.DockerHostList,
    service: DockerHostService,
    kind: null,
  },
  {
    resourceType: "docker-container",
    componentType: DashboardComponentType.DockerContainerList,
    service: DockerResourceService,
    kind: "Container",
  },
  {
    resourceType: "docker-image",
    componentType: DashboardComponentType.DockerImageList,
    service: DockerResourceService,
    kind: "Image",
  },
  {
    resourceType: "docker-network",
    componentType: DashboardComponentType.DockerNetworkList,
    service: DockerResourceService,
    kind: "Network",
  },
  {
    resourceType: "docker-volume",
    componentType: DashboardComponentType.DockerVolumeList,
    service: DockerResourceService,
    kind: "Volume",
  },
  {
    resourceType: "podman-host",
    componentType: DashboardComponentType.PodmanHostList,
    service: PodmanHostService,
    kind: null,
  },
  {
    resourceType: "podman-container",
    componentType: DashboardComponentType.PodmanContainerList,
    service: PodmanResourceService,
    kind: "Container",
  },
  {
    resourceType: "podman-image",
    componentType: DashboardComponentType.PodmanImageList,
    service: PodmanResourceService,
    kind: "Image",
  },
  {
    resourceType: "podman-network",
    componentType: DashboardComponentType.PodmanNetworkList,
    service: PodmanResourceService,
    kind: "Network",
  },
  {
    resourceType: "podman-volume",
    componentType: DashboardComponentType.PodmanVolumeList,
    service: PodmanResourceService,
    kind: "Volume",
  },
  {
    resourceType: "proxmox-resource",
    componentType: DashboardComponentType.ProxmoxNodeList,
    service: ProxmoxResourceService,
    kind: "Node",
  },
  {
    resourceType: "proxmox-resource",
    componentType: DashboardComponentType.ProxmoxGuestList,
    service: ProxmoxResourceService,
    kind: "Guest",
  },
  {
    resourceType: "vmware-resource",
    componentType: DashboardComponentType.VMwareHostList,
    service: VMwareResourceService,
    kind: "Host",
  },
  {
    resourceType: "vmware-resource",
    componentType: DashboardComponentType.VMwareVirtualMachineList,
    service: VMwareResourceService,
    kind: "VirtualMachine",
  },
  {
    resourceType: "ceph-resource",
    componentType: DashboardComponentType.CephOsdList,
    service: CephResourceService,
    kind: "Osd",
  },
  {
    resourceType: "ceph-resource",
    componentType: DashboardComponentType.CephPoolList,
    service: CephResourceService,
    kind: "Pool",
  },
  {
    resourceType: "storage-array-resource",
    componentType: DashboardComponentType.StorageArrayVolumeList,
    service: StorageArrayResourceService,
    kind: "Volume",
  },
  {
    resourceType: "storage-array-resource",
    componentType: DashboardComponentType.StorageArrayHardwareList,
    service: StorageArrayResourceService,
    // Three kinds, pinned with Includes (asserted on its own below).
    kind: null,
  },
  {
    resourceType: "docker-swarm-resource",
    componentType: DashboardComponentType.DockerSwarmNodeList,
    service: DockerSwarmResourceService,
    kind: "Node",
  },
  {
    resourceType: "docker-swarm-resource",
    componentType: DashboardComponentType.DockerSwarmServiceList,
    service: DockerSwarmResourceService,
    kind: "Service",
  },
  {
    resourceType: "span",
    componentType: DashboardComponentType.TraceList,
    service: SpanService,
    kind: null,
  },
  {
    resourceType: "log",
    componentType: DashboardComponentType.LogStream,
    service: LogService,
    kind: null,
  },
  {
    resourceType: "slo",
    componentType: DashboardComponentType.Slo,
    service: ServiceLevelObjectiveService,
    kind: null,
    argumentsObject: { serviceLevelObjectiveId: SLO_ID.toString() },
  },
];

const ALL_SERVICES: Array<ListService> = [
  IncidentService,
  AlertService,
  MonitorService,
  NetworkSiteService,
  HostService,
  KubernetesResourceService,
  DockerHostService,
  DockerResourceService,
  PodmanHostService,
  PodmanResourceService,
  ProxmoxResourceService,
  VMwareResourceService,
  CephResourceService,
  StorageArrayResourceService,
  DockerSwarmResourceService,
  SpanService,
  LogService,
  ServiceLevelObjectiveService,
];

describe("DashboardAPI public resource-list", () => {
  let dashboardId: ObjectID;
  let projectId: ObjectID;
  let dashboard: Dashboard;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new DashboardAPI();
  });

  const buildWidget: (data: BuildWidgetData) => BuiltWidget = (
    data: BuildWidgetData,
  ): BuiltWidget => {
    const componentId: ObjectID = data.componentId || ObjectID.generate();
    let storedComponentId: JSONValue = componentId;

    if (data.storedIdShape === "string") {
      storedComponentId = componentId.toString();
    } else if (data.storedIdShape === "serialized") {
      storedComponentId = componentId.toJSON();
    }

    return {
      componentId,
      widget: {
        _type: "DashboardComponent",
        componentId: storedComponentId,
        componentType: data.componentType,
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 12,
        heightInDashboardUnits: 6,
        minWidthInDashboardUnits: 1,
        minHeightInDashboardUnits: 1,
        arguments: data.argumentsObject || {},
      },
    };
  };

  const setDashboardWidgets: (
    widgets: Array<JSONObject>,
    variables?: Array<JSONObject>,
  ) => void = (
    widgets: Array<JSONObject>,
    variables?: Array<JSONObject>,
  ): void => {
    dashboard.dashboardViewConfig = {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: widgets,
      ...(variables ? { variables } : {}),
    } as unknown as DashboardViewConfig;
  };

  const telemetryQuery: (resourceType: string) => JSONObject = (
    resourceType: string,
  ): JSONObject => {
    const start: Date = new Date("2026-08-09T10:00:00.000Z");
    const end: Date = new Date("2026-08-09T11:00:00.000Z");

    if (resourceType === "log") {
      return { time: new InBetween<Date>(start, end).toJSON() };
    }
    if (resourceType === "span") {
      return { startTime: new InBetween<Date>(start, end).toJSON() };
    }
    return {};
  };

  const callRoute: (data: CallRouteData) => Promise<void> = async (
    data: CallRouteData,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: {
        dashboardId: dashboardId.toString(),
        resourceType: data.resourceType,
      },
      body: data.body || {},
      query: data.query || {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", RESOURCE_LIST_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  const getFindByArgs: (service: ListService) => JSONObject = (
    service: ListService,
  ): JSONObject => {
    const calls: Array<Array<unknown>> = (service.findBy as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);
    return calls[0]![0] as JSONObject;
  };

  const getThrownError: () => unknown = (): unknown => {
    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);
    return calls[0]![0];
  };

  const expectNothingListed: () => void = (): void => {
    for (const service of ALL_SERVICES) {
      expect(service.findBy).not.toHaveBeenCalled();
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();

    dashboardId = ObjectID.generate();
    projectId = ObjectID.generate();
    dashboard = new Dashboard();
    dashboard.id = dashboardId;
    dashboard.projectId = projectId;
    dashboard.isPublicDashboard = true;
    dashboard.enableMasterPassword = false;
    setDashboardWidgets([]);

    jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);
    // Unresolved and Resolved are read off the project's states.
    mockProjectStates();

    for (const service of ALL_SERVICES) {
      jest
        .spyOn(
          service as unknown as { findBy: () => Promise<Array<unknown>> },
          "findBy",
        )
        .mockResolvedValue([]);
    }

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("exact widget authorization (GHSA-qv79-j844-cc7m)", () => {
    it("serves every registered widget only through its own resource policy", async () => {
      for (const routeCase of RESOURCE_ROUTE_CASES) {
        jest.clearAllMocks();
        const { widget, componentId } = buildWidget({
          componentType: routeCase.componentType,
          argumentsObject: routeCase.argumentsObject,
        });
        setDashboardWidgets([widget]);

        await callRoute({
          resourceType: routeCase.resourceType,
          body: {
            componentId: componentId.toString(),
            query: telemetryQuery(routeCase.resourceType),
          },
        });

        expect(nextFunction).not.toHaveBeenCalled();
        const findByArgs: JSONObject = getFindByArgs(routeCase.service);
        const query: JSONObject = findByArgs["query"] as JSONObject;

        expect(query["projectId"]).toBe(projectId);
        if (routeCase.kind) {
          expect(query["kind"]).toBe(routeCase.kind);
        }
        const expectedSelect: JSONObject =
          PublicDashboardResourceListPolicy.build({
            widget,
            variables: [],
            requestedVariables: [],
            requestedQuery: telemetryQuery(routeCase.resourceType),
          }).select;
        expect(findByArgs["select"]).toEqual(expectedSelect);
        expect(findByArgs["skip"]).toBe(0);
      }
    });

    it("does not return sibling-only Proxmox, VMware, Swarm or Storage Array fields", async () => {
      const cases: Array<{
        resourceType: string;
        componentType: DashboardComponentType;
        service: ListService;
        included: string;
        excluded: string;
      }> = [
        {
          resourceType: "proxmox-resource",
          componentType: DashboardComponentType.ProxmoxGuestList,
          service: ProxmoxResourceService,
          included: "vmid",
          excluded: "latestCpuPercent",
        },
        {
          resourceType: "proxmox-resource",
          componentType: DashboardComponentType.ProxmoxNodeList,
          service: ProxmoxResourceService,
          included: "latestCpuPercent",
          excluded: "vmid",
        },
        {
          resourceType: "vmware-resource",
          componentType: DashboardComponentType.VMwareVirtualMachineList,
          service: VMwareResourceService,
          included: "isPoweredOn",
          excluded: "cpuCapacityMhz",
        },
        {
          resourceType: "vmware-resource",
          componentType: DashboardComponentType.VMwareHostList,
          service: VMwareResourceService,
          included: "cpuCapacityMhz",
          excluded: "isPoweredOn",
        },
        {
          resourceType: "docker-swarm-resource",
          componentType: DashboardComponentType.DockerSwarmServiceList,
          service: DockerSwarmResourceService,
          included: "desiredReplicas",
          excluded: "latestCpuPercent",
        },
        {
          resourceType: "docker-swarm-resource",
          componentType: DashboardComponentType.DockerSwarmNodeList,
          service: DockerSwarmResourceService,
          included: "latestCpuPercent",
          excluded: "desiredReplicas",
        },
        {
          resourceType: "storage-array-resource",
          componentType: DashboardComponentType.StorageArrayVolumeList,
          service: StorageArrayResourceService,
          included: "readLatencyUsec",
          excluded: "status",
        },
        {
          resourceType: "storage-array-resource",
          componentType: DashboardComponentType.StorageArrayHardwareList,
          service: StorageArrayResourceService,
          included: "status",
          excluded: "readLatencyUsec",
        },
      ];

      for (const testCase of cases) {
        jest.clearAllMocks();
        const selectedWidget: BuiltWidget = buildWidget({
          componentType: testCase.componentType,
        });
        setDashboardWidgets([selectedWidget.widget]);

        await callRoute({
          resourceType: testCase.resourceType,
          body: { componentId: selectedWidget.componentId.toString() },
        });

        const select: JSONObject = getFindByArgs(testCase.service)[
          "select"
        ] as JSONObject;
        expect(select[testCase.included]).toBe(true);
        expect(select[testCase.excluded]).toBeUndefined();
      }
    });

    it("fails closed when the dashboard has no matching top-level widget", async () => {
      const monitor: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.MonitorList,
        argumentsObject: {
          nestedImpostor: buildWidget({
            componentType: DashboardComponentType.LogStream,
          }).widget,
        },
      });
      setDashboardWidgets([monitor.widget]);

      await callRoute({
        resourceType: "log",
        body: { query: telemetryQuery("log") },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });

    it("auto-binds only when exactly one widget matches the resource", async () => {
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: { severityFilter: "Error" },
      });
      const monitor: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.MonitorList,
      });
      setDashboardWidgets([log.widget, monitor.widget]);

      await callRoute({
        resourceType: "log",
        body: { query: telemetryQuery("log") },
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(
        (getFindByArgs(LogService)["query"] as JSONObject)["severityText"],
      ).toBe("Error");
    });

    it("requires componentId when several matching widgets have different policies", async () => {
      const first: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: { severityFilter: "Error" },
      });
      const second: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: { severityFilter: "Warning" },
      });
      setDashboardWidgets([first.widget, second.widget]);

      await callRoute({
        resourceType: "log",
        body: { query: telemetryQuery("log") },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });

    it("uses the exact selected widget when several widgets share a resource", async () => {
      const first: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: { severityFilter: "Error" },
      });
      const second: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: { severityFilter: "Warning" },
      });
      setDashboardWidgets([first.widget, second.widget]);

      await callRoute({
        resourceType: "log",
        body: {
          componentId: second.componentId.toString(),
          query: {
            ...telemetryQuery("log"),
            severityText: "Debug",
          },
        },
      });

      const query: JSONObject = getFindByArgs(LogService)[
        "query"
      ] as JSONObject;
      expect(query["severityText"]).toBe("Warning");
    });

    it("rejects a componentId belonging to a different resource", async () => {
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
      });
      const monitor: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.MonitorList,
      });
      setDashboardWidgets([log.widget, monitor.widget]);

      await callRoute({
        resourceType: "log",
        body: {
          componentId: monitor.componentId.toString(),
          query: telemetryQuery("log"),
        },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });

    it("requires the requested componentId to be a string UUID", async () => {
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
      });
      setDashboardWidgets([log.widget]);

      const invalidIds: Array<JSONValue> = [
        42,
        [],
        {},
        "not-a-uuid",
        ObjectID.generate().toJSON(),
      ];
      for (const invalidId of invalidIds) {
        jest.clearAllMocks();
        await callRoute({
          resourceType: "log",
          body: {
            componentId: invalidId,
            query: telemetryQuery("log"),
          },
        });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingListed();
      }
    });

    it("matches legacy stored ObjectID, string, and serialized ID shapes", async () => {
      const storedIdShapes: Array<"object" | "string" | "serialized"> = [
        "object",
        "string",
        "serialized",
      ];

      for (const storedIdShape of storedIdShapes) {
        jest.clearAllMocks();
        const log: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.LogStream,
          storedIdShape,
        });
        setDashboardWidgets([log.widget]);

        await callRoute({
          resourceType: "log",
          body: {
            componentId: log.componentId.toString(),
            query: telemetryQuery("log"),
          },
        });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(LogService.findBy).toHaveBeenCalledTimes(1);
      }
    });

    it("rejects malformed view configs and unsupported resource types", async () => {
      const malformedConfigs: Array<unknown> = [
        null,
        "not-an-object",
        {},
        { components: null },
        { components: [null, 7, { componentType: 123 }] },
      ];

      for (const config of malformedConfigs) {
        jest.clearAllMocks();
        dashboard.dashboardViewConfig = config as DashboardViewConfig;
        await callRoute({ resourceType: "log" });
        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingListed();
      }

      jest.clearAllMocks();
      setDashboardWidgets([]);
      await callRoute({ resourceType: "user" });
      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });
  });

  describe("server-owned query policy", () => {
    it("rebuilds log filters, sort, limit, skip, and select from stored policy", async () => {
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: {
          severityFilter: "Error",
          bodyContains: "timeout",
          attributeFilterQuery: "@service.name:api",
          maxRows: 13,
        },
      });
      setDashboardWidgets([log.widget]);

      await callRoute({
        resourceType: "log",
        body: {
          componentId: log.componentId.toString(),
          query: {
            ...telemetryQuery("log"),
            severityText: "Debug",
            body: "",
            attributes: {},
            projectId: ObjectID.generate().toString(),
          },
          sort: { severityText: SortOrder.Ascending },
          select: { severityNumber: true, password: true },
          limit: 9999,
          skip: 9999,
        },
        query: { limit: "9999", skip: "9999" },
      });

      const findByArgs: JSONObject = getFindByArgs(LogService);
      const query: JSONObject = findByArgs["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect(query["severityText"]).toBe("Error");
      expect(query["body"]).toBe("timeout");
      expect((query["attributes"] as JSONObject)["service.name"]).toBe("api");
      expect(query["time"]).toBeInstanceOf(InBetween);
      expect(findByArgs["sort"]).toEqual({
        time: SortOrder.Descending,
      });
      expect(findByArgs["limit"]).toBe(13);
      expect(findByArgs["skip"]).toBe(0);
      expect(findByArgs["select"]).toEqual({
        time: true,
        severityText: true,
        body: true,
      });
    });

    it("does not let omitted or changed request filters widen stored incident policy", async () => {
      const severityId: ObjectID = ObjectID.generate();
      const incident: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.IncidentList,
        argumentsObject: {
          stateFilter: "unresolved",
          severityIds: [severityId.toString()],
          maxRows: 9,
        },
      });
      setDashboardWidgets([incident.widget]);

      await callRoute({
        resourceType: "incident",
        body: {
          componentId: incident.componentId.toString(),
          query: {
            currentIncidentState: { isResolvedState: true },
            incidentSeverityId: [],
          },
        },
      });

      const findByArgs: JSONObject = getFindByArgs(IncidentService);
      const query: JSONObject = findByArgs["query"] as JSONObject;

      // Unresolved: the project's states above its resolved state.
      expect(query["currentIncidentState"]).toBeUndefined();
      expect(idsOfAnyFilter(query["currentIncidentStateId"])).toEqual(
        openStateIds(INCIDENT_STATE_IDS),
      );
      expect(query["incidentSeverityId"]).toBeInstanceOf(Includes);
      expect((query["incidentSeverityId"] as Includes).values).toEqual([
        severityId.toString(),
      ]);
      expect(findByArgs["sort"]).toEqual({
        createdAt: SortOrder.Descending,
      });
      expect(findByArgs["limit"]).toBe(9);
      expect(findByArgs["skip"]).toBe(0);
    });

    /*
     * An Acknowledged list is the project's acknowledged state and every
     * state placed after it short of resolved
     * (Common/Utils/AcknowledgedState) - a query on the acknowledged flag
     * left out an incident in "Investigating", placed between Acknowledged
     * and Resolved.
     */
    it("keeps an Acknowledged incident list to the acknowledged state and the states after it, short of resolved", async () => {
      const investigatingId: ObjectID = new ObjectID(
        "7c0a3f10-0000-4000-8000-0000000000a9",
      );
      const states: Array<IncidentState> = makeIncidentStates();
      const investigating: IncidentState = new IncidentState();
      investigating._id = investigatingId.toString();
      investigating.name = "Investigating";
      investigating.order = 2.5;
      investigating.isCreatedState = false;
      investigating.isAcknowledgedState = false;
      investigating.isResolvedState = false;
      mockProjectStates({ incidentStates: [...states, investigating] });

      const incident: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.IncidentList,
        argumentsObject: { stateFilter: "acknowledged" },
      });
      setDashboardWidgets([incident.widget]);

      await callRoute({
        resourceType: "incident",
        body: {
          componentId: incident.componentId.toString(),
          query: { currentIncidentState: { isAcknowledgedState: false } },
        },
      });

      const query: JSONObject = getFindByArgs(IncidentService)[
        "query"
      ] as JSONObject;

      expect(query["currentIncidentState"]).toBeUndefined();
      expect(idsOfAnyFilter(query["currentIncidentStateId"]).sort()).toEqual(
        [
          INCIDENT_STATE_IDS.acknowledged.toString(),
          investigatingId.toString(),
        ].sort(),
      );
      expect(query["projectId"]).toBe(projectId);
    });

    it("keeps an Acknowledged alert list within the states the list names", async () => {
      const alert: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.AlertList,
        argumentsObject: {
          stateFilter: "acknowledged",
          stateIds: [
            ALERT_STATE_IDS.created.toString(),
            ALERT_STATE_IDS.acknowledged.toString(),
            ALERT_STATE_IDS.resolved.toString(),
          ],
        },
      });
      setDashboardWidgets([alert.widget]);

      await callRoute({
        resourceType: "alert",
        body: { componentId: alert.componentId.toString() },
      });

      const query: JSONObject = getFindByArgs(AlertService)[
        "query"
      ] as JSONObject;

      expect(query["currentAlertState"]).toBeUndefined();
      expect(idsOfAnyFilter(query["currentAlertStateId"])).toEqual([
        ALERT_STATE_IDS.acknowledged.toString(),
      ]);
    });

    it("takes kind from the selected widget policy, not from the caller", async () => {
      const pod: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.KubernetesPodList,
      });
      setDashboardWidgets([pod.widget]);

      await callRoute({
        resourceType: "kubernetes-resource",
        body: {
          componentId: pod.componentId.toString(),
          query: { kind: "Node" },
        },
      });

      const query: JSONObject = getFindByArgs(KubernetesResourceService)[
        "query"
      ] as JSONObject;
      expect(query["kind"]).toBe("Pod");
    });

    it("pins a storage array hardware widget to its three kinds, whatever the caller asks", async () => {
      const hardware: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.StorageArrayHardwareList,
      });
      setDashboardWidgets([hardware.widget]);

      await callRoute({
        resourceType: "storage-array-resource",
        body: {
          componentId: hardware.componentId.toString(),
          query: { kind: "Volume", status: "ok" },
        },
      });

      expect(nextFunction).not.toHaveBeenCalled();
      const query: JSONObject = getFindByArgs(StorageArrayResourceService)[
        "query"
      ] as JSONObject;
      expect(query["kind"]).toEqual(
        new Includes(["Hardware", "Drive", "Controller"]),
      );
      expect(query["status"]).toBeUndefined();
      expect(query["projectId"]).toBe(projectId);
    });

    it("never serves storage array inventory from a dashboard without a storage array widget", async () => {
      const monitor: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.MonitorList,
      });
      setDashboardWidgets([monitor.widget]);

      await callRoute({
        resourceType: "storage-array-resource",
        body: { componentId: monitor.componentId.toString() },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });

    describe("published monitor label variable selections", () => {
      const firstLabelId: string = ObjectID.generate().toString();
      const secondLabelId: string = ObjectID.generate().toString();
      const fixedLabelId: string = ObjectID.generate().toString();
      const labelVariable: JSONObject = {
        id: "unit",
        name: "UNIT",
        type: DashboardVariableType.ProjectLabel,
        labelOptions: [
          { label: "Payments", value: firstLabelId },
          { label: "Support", value: secondLabelId },
        ],
        defaultValue: firstLabelId,
      };

      it("applies the chosen label while preserving stored monitor policy and project", async () => {
        const monitor: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.MonitorList,
          argumentsObject: {
            labelVariableId: "unit",
            labelIds: [fixedLabelId],
            statusFilter: "operational",
            monitorTypes: ["Ping"],
            maxRows: 6,
          },
        });
        setDashboardWidgets([monitor.widget], [labelVariable]);

        await callRoute({
          resourceType: "monitor",
          body: {
            componentId: monitor.componentId.toString(),
            variables: [{ id: "unit", selectedValue: secondLabelId }],
          },
        });

        expect(nextFunction).not.toHaveBeenCalled();
        const findBy: JSONObject = getFindByArgs(MonitorService);
        expect(findBy["query"]).toEqual({
          projectId,
          currentMonitorStatus: { isOperationalState: true },
          monitorType: new Includes(["Ping"]),
          labels: new IncludesAnyOfGroups([[fixedLabelId], [secondLabelId]]),
        });
        expect(findBy["limit"]).toBe(6);
        expect(findBy["sort"]).toEqual({ name: SortOrder.Ascending });
        /*
         * The status's place in the project's list is read too: a viewer
         * may sort the list worst first by it (issue #5082).
         */
        expect(findBy["select"]).toEqual({
          _id: true,
          name: true,
          monitorType: true,
          currentMonitorStatus: { name: true, color: true, priority: true },
        });
      });

      it("retains fixed labels when the public viewer chooses All", async () => {
        const monitor: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.MonitorList,
          argumentsObject: {
            labelVariableId: "unit",
            labelIds: [fixedLabelId],
          },
        });
        setDashboardWidgets([monitor.widget], [labelVariable]);

        await callRoute({
          resourceType: "monitor",
          body: {
            componentId: monitor.componentId.toString(),
            variables: [{ id: "unit", selectedValue: "" }],
          },
        });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(getFindByArgs(MonitorService)["query"]).toEqual({
          projectId,
          labels: new Includes([fixedLabelId]),
        });
      });

      it("accepts several published label IDs for a saved multi-select", async () => {
        const monitor: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.MonitorList,
          argumentsObject: { labelVariableId: "unit" },
        });
        setDashboardWidgets(
          [monitor.widget],
          [{ ...labelVariable, isMultiSelect: true }],
        );

        await callRoute({
          resourceType: "monitor",
          body: {
            componentId: monitor.componentId.toString(),
            variables: [
              { id: "unit", selectedValues: [firstLabelId, secondLabelId] },
            ],
          },
        });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(getFindByArgs(MonitorService)["query"]).toEqual({
          projectId,
          labels: new Includes([firstLabelId, secondLabelId]),
        });
      });

      it("reports an invalid selection before reading monitors when a choice was removed", async () => {
        const monitor: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.MonitorList,
          argumentsObject: { labelVariableId: "unit" },
        });
        setDashboardWidgets([monitor.widget], [labelVariable]);

        await callRoute({
          resourceType: "monitor",
          body: {
            componentId: monitor.componentId.toString(),
            variables: [
              { id: "unit", selectedValue: ObjectID.generate().toString() },
            ],
          },
        });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingListed();
      });
    });

    it("passes only dynamic time and bounded variable selections into policy", async () => {
      const buildSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        PublicDashboardResourceListPolicy,
        "build",
      );
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
        argumentsObject: {
          attributeFilterQuery: "@service.name:stored-service",
        },
      });
      const variable: JSONObject = {
        id: "service-variable",
        name: "Service",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "service.name",
        defaultValue: "default-service",
      };
      setDashboardWidgets([log.widget], [variable]);
      const requestedVariables: Array<JSONObject> = [
        {
          id: "service-variable",
          selectedValue: "checkout",
          selectedValues: [],
        },
      ];

      await callRoute({
        resourceType: "log",
        body: {
          componentId: log.componentId.toString(),
          query: telemetryQuery("log"),
          variables: requestedVariables,
        },
      });

      expect(buildSpy).toHaveBeenCalledTimes(1);
      const policyInput: BuildPublicDashboardResourceListPolicyData =
        buildSpy.mock.calls[0]![0];
      // The widget and the variables as the public page draws them.
      const drawn: DashboardViewConfig =
        PublicDashboardViewConfig.getDrawnConfig(dashboard.dashboardViewConfig);
      expect(policyInput.widget).toEqual(drawn.components[0]);
      expect(policyInput.variables).toEqual(drawn.variables);
      expect(policyInput.variables).toHaveLength(1);
      expect(policyInput.requestedVariables).toEqual(requestedVariables);
      expect((policyInput.requestedQuery as JSONObject)["time"]).toBeInstanceOf(
        InBetween,
      );

      const query: JSONObject = getFindByArgs(LogService)[
        "query"
      ] as JSONObject;
      expect((query["attributes"] as JSONObject)["service.name"]).toBe(
        "checkout",
      );
    });

    it("fails closed when a telemetry request omits its time range", async () => {
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
      });
      setDashboardWidgets([log.widget]);

      await callRoute({
        resourceType: "log",
        body: { componentId: log.componentId.toString(), query: {} },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });

    it("rejects a policy result for any resource other than the URL resource", async () => {
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
      });
      setDashboardWidgets([log.widget]);
      const mismatchedPolicy: PublicDashboardResourceListPolicyResult = {
        resourceType: "monitor",
        query: {},
        select: {},
        sort: {},
        limit: 1,
        sortChoice: null,
      };
      jest
        .spyOn(PublicDashboardResourceListPolicy, "build")
        .mockReturnValue(mismatchedPolicy);

      await callRoute({
        resourceType: "log",
        body: { componentId: log.componentId.toString() },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });

    it("pins projectId after policy construction", async () => {
      const otherProjectId: ObjectID = ObjectID.generate();
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
      });
      setDashboardWidgets([log.widget]);
      const policy: PublicDashboardResourceListPolicyResult = {
        resourceType: "log",
        query: { projectId: otherProjectId },
        select: { time: true },
        sort: { time: SortOrder.Descending },
        limit: 7,
        sortChoice: null,
      };
      jest
        .spyOn(PublicDashboardResourceListPolicy, "build")
        .mockReturnValue(policy);

      await callRoute({
        resourceType: "log",
        body: { componentId: log.componentId.toString() },
      });

      const query: JSONObject = getFindByArgs(LogService)[
        "query"
      ] as JSONObject;
      expect(query["projectId"]).toBe(projectId);
      expect(query["projectId"]).not.toBe(otherProjectId);
    });
  });

  describe("public incident and alert privacy", () => {
    it("adds anonymous privacy clauses before root incident and alert reads", async () => {
      const privacyCases: Array<{
        resourceType: "incident" | "alert";
        componentType: DashboardComponentType;
        service: ListService;
      }> = [
        {
          resourceType: "incident",
          componentType: DashboardComponentType.IncidentList,
          service: IncidentService,
        },
        {
          resourceType: "alert",
          componentType: DashboardComponentType.AlertList,
          service: AlertService,
        },
      ];

      for (const privacyCase of privacyCases) {
        jest.clearAllMocks();
        const { widget, componentId } = buildWidget({
          componentType: privacyCase.componentType,
        });
        setDashboardWidgets([widget]);

        await callRoute({
          resourceType: privacyCase.resourceType,
          body: { componentId: componentId.toString() },
        });

        const findByArgs: JSONObject = getFindByArgs(privacyCase.service);
        const query: JSONObject = findByArgs["query"] as JSONObject;
        expect(query["isPrivate"]).toBeInstanceOf(FindOperator);
        expect(query["projectId"]).toBe(projectId);
        expect(findByArgs["props"]).toEqual({ isRoot: true });
      }
    });
  });

  describe("dashboard authorization", () => {
    it("rejects a non-public or missing dashboard before listing", async () => {
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
      });
      setDashboardWidgets([log.widget]);
      dashboard.isPublicDashboard = false;

      await callRoute({
        resourceType: "log",
        body: {
          componentId: log.componentId.toString(),
          query: telemetryQuery("log"),
        },
      });
      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingListed();

      jest.clearAllMocks();
      jest.spyOn(DashboardService, "findOneById").mockResolvedValue(null);
      await callRoute({ resourceType: "log" });
      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingListed();
    });

    it("rejects a dashboard with no project", async () => {
      const log: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.LogStream,
      });
      setDashboardWidgets([log.widget]);
      delete dashboard.projectId;

      await callRoute({
        resourceType: "log",
        body: {
          componentId: log.componentId.toString(),
          query: telemetryQuery("log"),
        },
      });

      expect(getThrownError()).toBeInstanceOf(NotFoundException);
      expectNothingListed();
    });
  });

  /*
   * Issue #4571. A config is stored as it was sent, and the API reference
   * documented it inside `{"_type": "DashboardViewConfig", "value": {...}}`.
   * The public page now draws such a dashboard's widgets
   * (StoredDashboardViewConfig), so the route that serves a widget's rows
   * has to find the widget there too - and find it by the id the page draws
   * it under, which is derived when the widget was stored without one or
   * with one an earlier widget already has.
   */
  describe("a dashboard stored in another shape (issue #4571)", () => {
    // The id the visitor's page asks with: what /view-config serves, read.
    const pageIdsFor: (stored: unknown) => Array<string> = (
      stored: unknown,
    ): Array<string> => {
      return StoredDashboardViewConfig.read(
        PublicDashboardViewConfig.sanitize(stored as DashboardViewConfig),
      ).components.map((component: { componentId: ObjectID }) => {
        return component.componentId.toString();
      });
    };

    const listedLimit: () => unknown = (): unknown => {
      return getFindByArgs(IncidentService)["limit"];
    };

    it.each([
      [
        "the DashboardViewConfig envelope",
        (components: Array<JSONObject>): unknown => {
          return {
            _type: "DashboardViewConfig",
            value: { components },
          };
        },
      ],
      [
        "JSON text",
        (components: Array<JSONObject>): unknown => {
          return JSON.stringify({ components });
        },
      ],
      [
        "a widget in the DashboardComponent envelope",
        (components: Array<JSONObject>): unknown => {
          return {
            components: components.map((component: JSONObject) => {
              return { _type: "DashboardComponent", value: component };
            }),
          };
        },
      ],
    ])(
      "serves the widget of a config stored as %s",
      async (
        _name: string,
        storeAs: (components: Array<JSONObject>) => unknown,
      ) => {
        const incident: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.IncidentList,
          argumentsObject: { maxRows: 7 },
          storedIdShape: "string",
        });
        dashboard.dashboardViewConfig = storeAs([
          incident.widget,
        ]) as DashboardViewConfig;

        await callRoute({
          resourceType: "incident",
          body: { componentId: incident.componentId.toString() },
        });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(listedLimit()).toBe(7);
        expect(
          (getFindByArgs(IncidentService)["query"] as JSONObject)["projectId"],
        ).toBe(projectId);
      },
    );

    it("serves a widget stored without an id by the id the page draws it under", async () => {
      const incident: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.IncidentList,
        argumentsObject: { maxRows: 5 },
      });
      delete incident.widget["componentId"];
      setDashboardWidgets([incident.widget]);

      const [pageId] = pageIdsFor(dashboard.dashboardViewConfig);

      await callRoute({
        resourceType: "incident",
        body: { componentId: pageId },
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(listedLimit()).toBe(5);
    });

    it("serves a widget stored with spaces around its id by the trimmed id the page asks with", async () => {
      const incident: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.IncidentList,
        argumentsObject: { maxRows: 6 },
      });
      incident.widget["componentId"] = `  ${incident.componentId.toString()}  `;
      setDashboardWidgets([incident.widget]);

      const [pageId] = pageIdsFor(dashboard.dashboardViewConfig);
      expect(pageId).toBe(incident.componentId.toString());

      await callRoute({
        resourceType: "incident",
        body: { componentId: pageId },
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(listedLimit()).toBe(6);
    });

    it("still refuses an id no widget is drawn under", async () => {
      const incident: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.IncidentList,
      });
      delete incident.widget["componentId"];
      setDashboardWidgets([incident.widget]);

      await callRoute({
        resourceType: "incident",
        body: { componentId: ObjectID.generate().toString() },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });

    it("answers two widgets that were stored with the same id each from its own settings", async () => {
      const sharedId: ObjectID = ObjectID.generate();
      const first: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.IncidentList,
        argumentsObject: { maxRows: 7 },
        componentId: sharedId,
      });
      const second: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.IncidentList,
        argumentsObject: { maxRows: 11 },
        componentId: sharedId,
      });
      setDashboardWidgets([first.widget, second.widget]);

      const [firstPageId, secondPageId] = pageIdsFor(
        dashboard.dashboardViewConfig,
      );
      expect(firstPageId).toBe(sharedId.toString());
      expect(secondPageId).not.toBe(sharedId.toString());

      await callRoute({
        resourceType: "incident",
        body: { componentId: firstPageId },
      });
      expect(listedLimit()).toBe(7);

      jest.clearAllMocks();

      await callRoute({
        resourceType: "incident",
        body: { componentId: secondPageId },
      });
      expect(listedLimit()).toBe(11);
    });

    /*
     * Issue #6297. Inside the widget list a widget can also be stored as
     * JSON text, in the DashboardComponent envelope with its value as text,
     * in a widget list written as text, or with its arguments written as
     * text - which this route refused as "Dashboard widget arguments must
     * be an object." while the page drew the widget. Each is served from
     * the settings the page draws it with.
     */
    it.each([
      [
        "as JSON text",
        (widget: JSONObject): unknown => {
          return { components: [JSON.stringify(widget)] };
        },
      ],
      [
        "in the DashboardComponent envelope, its value as JSON text",
        (widget: JSONObject): unknown => {
          return {
            components: [
              { _type: "DashboardComponent", value: JSON.stringify(widget) },
            ],
          };
        },
      ],
      [
        "in a widget list written as JSON text",
        (widget: JSONObject): unknown => {
          return { components: JSON.stringify([widget]) };
        },
      ],
      [
        "with its arguments as JSON text",
        (widget: JSONObject): unknown => {
          return {
            components: [
              { ...widget, arguments: JSON.stringify(widget["arguments"]) },
            ],
          };
        },
      ],
      [
        "as JSON text, its arguments as JSON text in it",
        (widget: JSONObject): unknown => {
          return {
            components: [
              JSON.stringify({
                ...widget,
                arguments: JSON.stringify(widget["arguments"]),
              }),
            ],
          };
        },
      ],
    ])(
      "serves a widget stored %s from the settings the page draws it with (issue #6297)",
      async (_name: string, storeAs: (widget: JSONObject) => unknown) => {
        const incident: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.IncidentList,
          argumentsObject: { maxRows: 7 },
          storedIdShape: "string",
        });
        dashboard.dashboardViewConfig = storeAs(
          incident.widget,
        ) as DashboardViewConfig;

        const [pageId] = pageIdsFor(dashboard.dashboardViewConfig);
        expect(pageId).toBe(incident.componentId.toString());

        await callRoute({
          resourceType: "incident",
          body: { componentId: pageId },
        });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(listedLimit()).toBe(7);
        expect(
          (getFindByArgs(IncidentService)["query"] as JSONObject)["projectId"],
        ).toBe(projectId);
      },
    );

    it.each([
      [
        "encoded twice",
        (text: string): string => {
          return JSON.stringify(text);
        },
      ],
      [
        "cut short",
        (text: string): string => {
          return text.slice(0, 5);
        },
      ],
      [
        "a list",
        (): string => {
          return "[1, 2]";
        },
      ],
    ])(
      "serves a widget whose arguments are text that says no object with its defaults, as the page draws it: %s (issue #6315)",
      async (_name: string, encode: (text: string) => string) => {
        const incident: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.IncidentList,
          argumentsObject: { maxRows: 7, stateFilter: "resolved" },
        });
        setDashboardWidgets([
          {
            ...incident.widget,
            arguments: encode(JSON.stringify(incident.widget["arguments"])),
          },
        ]);

        // The page draws it with no settings at all, signed in and public alike.
        expect(
          PublicDashboardViewConfig.getDrawnConfig(
            dashboard.dashboardViewConfig,
          ).components[0]?.arguments,
        ).toEqual({});

        await callRoute({
          resourceType: "incident",
          body: { componentId: incident.componentId.toString() },
        });

        expect(nextFunction).not.toHaveBeenCalled();

        // Its defaults: no filter of its own, 25 rows, newest first.
        const findBy: JSONObject = getFindByArgs(IncidentService);
        expect(findBy["limit"]).toBe(25);
        expect(findBy["sort"]).toEqual({ createdAt: SortOrder.Descending });
        expect(
          (findBy["query"] as JSONObject)["currentIncidentStateId"],
        ).toBeUndefined();
      },
    );

    it("never serves a Data Source widget with its arguments as JSON text (issue #6297)", async () => {
      const dataSourceTable: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.DataSourceTable,
        argumentsObject: { maxRows: 7 },
      });
      setDashboardWidgets([
        {
          ...dataSourceTable.widget,
          arguments: JSON.stringify(dataSourceTable.widget["arguments"]),
        },
      ]);

      await callRoute({
        resourceType: "incident",
        body: { componentId: dataSourceTable.componentId.toString() },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });

    it("never serves a Data Source widget hidden in the envelope", async () => {
      const dataSourceTable: BuiltWidget = buildWidget({
        componentType: DashboardComponentType.DataSourceTable,
      });
      dashboard.dashboardViewConfig = {
        _type: "DashboardViewConfig",
        value: { components: [dataSourceTable.widget] },
      } as unknown as DashboardViewConfig;

      await callRoute({
        resourceType: "incident",
        body: { componentId: dataSourceTable.componentId.toString() },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingListed();
    });
  });

  /*
   * Issue #6315. Both routes read the dashboard as the public page draws it
   * (PublicDashboardViewConfig.getDrawnConfig): its widgets, their settings
   * and its variables. So a list stored in a shape the editor never writes
   * - its variables as JSON text, without ids or sharing one,
   * `isMultiSelect` as "true", a default as a number; the widget saved
   * without settings, or with typed values in them - lists exactly what the
   * same list stored as the editor stores it lists, as it does signed in.
   * The page's own request is sent: every variable's pick under the id the
   * page draws it under (DashboardResourceList.getVariableSelections).
   */
  describe("variables and widgets stored in another shape (issue #6315)", () => {
    const TA: DashboardVariableType = DashboardVariableType.TelemetryAttribute;

    interface Pick {
      selectedValue?: string | null | undefined;
      selectedValues?: Array<string> | undefined;
    }

    // What the public page draws: what /view-config serves, sent as JSON, read as the page reads it.
    const pageDraws: (stored: unknown) => DashboardViewConfig = (
      stored: unknown,
    ): DashboardViewConfig => {
      const served: unknown = JSON.parse(
        JSON.stringify(
          JSONFunctions.serialize(
            PublicDashboardViewConfig.sanitize(
              stored as DashboardViewConfig,
            ) as unknown as JSONObject,
          ),
        ),
      );

      return StoredDashboardViewConfig.read(served);
    };

    // The page's request for a widget it draws: its id, and every variable's pick as the page sends it.
    const pageBody: (data: {
      stored: unknown;
      resourceType: string;
      widgetIndex?: number | undefined;
      picks?: Array<Pick | null> | undefined;
    }) => JSONObject = (data: {
      stored: unknown;
      resourceType: string;
      widgetIndex?: number | undefined;
      picks?: Array<Pick | null> | undefined;
    }): JSONObject => {
      const drawn: DashboardViewConfig = pageDraws(data.stored);
      const variables: Array<DashboardVariable> = (drawn.variables || []).map(
        (variable: DashboardVariable, index: number): DashboardVariable => {
          const pick: Pick | null | undefined = data.picks?.[index];
          return pick
            ? ({ ...variable, ...pick } as DashboardVariable)
            : variable;
        },
      );

      return {
        componentId:
          drawn.components[data.widgetIndex || 0]!.componentId.toString(),
        variables: DashboardResourceList.getVariableSelections(variables),
        query: telemetryQuery(data.resourceType),
      };
    };

    // The errors the last call ended in, as words: none when it listed.
    const errorsOfLastCall: () => Array<string> = (): Array<string> => {
      return (
        (nextFunction as jest.Mock).mock.calls as Array<Array<unknown>>
      ).map((call: Array<unknown>): string => {
        return String((call[0] as Error | undefined)?.message);
      });
    };

    // What one call read, with the mocks cleared first.
    const listedWith: (data: {
      resourceType: string;
      service: ListService;
      body: JSONObject;
    }) => Promise<JSONObject> = async (data: {
      resourceType: string;
      service: ListService;
      body: JSONObject;
    }): Promise<JSONObject> => {
      jest.clearAllMocks();
      await callRoute({ resourceType: data.resourceType, body: data.body });
      expect(errorsOfLastCall()).toEqual([]);
      return getFindByArgs(data.service);
    };

    /*
     * A whole read as plain JSON, to compare two reads: an incident or alert
     * list's privacy clause builds its SQL with a new function on every read.
     */
    const comparable: (findBy: JSONObject) => unknown = (
      findBy: JSONObject,
    ): unknown => {
      return JSON.parse(JSON.stringify(findBy));
    };

    const refusalOf: (data: {
      resourceType: string;
      body: JSONObject;
    }) => Promise<string> = async (data: {
      resourceType: string;
      body: JSONObject;
    }): Promise<string> => {
      jest.clearAllMocks();
      await callRoute({ resourceType: data.resourceType, body: data.body });
      const error: unknown = getThrownError();
      expect(error).toBeInstanceOf(BadDataException);
      expectNothingListed();
      return (error as Error).message;
    };

    const configWith: (
      widgets: Array<unknown>,
      variables?: unknown,
    ) => DashboardViewConfig = (
      widgets: Array<unknown>,
      variables?: unknown,
    ): DashboardViewConfig => {
      return {
        _type: "DashboardViewConfig",
        heightInDashboardUnits: 24,
        components: widgets,
        ...(variables === undefined ? {} : { variables }),
      } as unknown as DashboardViewConfig;
    };

    const withoutId: (variable: JSONObject) => JSONObject = (
      variable: JSONObject,
    ): JSONObject => {
      const copy: JSONObject = { ...variable };
      delete copy["id"];
      return copy;
    };

    interface VariableRouteCase {
      name: string;
      resourceType: string;
      componentType: DashboardComponentType;
      service: ListService;
      // The variables as the editor stores them.
      variables: Array<JSONObject>;
      picks: Array<Pick | null>;
      // What the picks decide in the query read, field by field.
      expected: JSONObject;
    }

    const VARIABLE_ROUTE_CASES: Array<VariableRouteCase> = [
      {
        name: "a host list filtered by the picked host",
        resourceType: "host",
        componentType: DashboardComponentType.HostList,
        service: HostService,
        variables: [
          {
            id: "host",
            name: "Host",
            type: TA,
            attributeKey: "host.name",
            isMultiSelect: false,
            defaultValue: "42",
          },
        ],
        picks: [{ selectedValue: "web-1" }],
        expected: { name: "web-1" },
      },
      {
        name: "a host list filtered by its variable's default, with no pick",
        resourceType: "host",
        componentType: DashboardComponentType.HostList,
        service: HostService,
        variables: [
          {
            id: "host",
            name: "Host",
            type: TA,
            attributeKey: "host.name",
            isMultiSelect: false,
            defaultValue: "42",
          },
        ],
        picks: [null],
        expected: { name: "42" },
      },
      {
        name: "a pod list filtered by the picked namespaces",
        resourceType: "kubernetes-resource",
        componentType: DashboardComponentType.KubernetesPodList,
        service: KubernetesResourceService,
        variables: [
          {
            id: "namespace",
            name: "Namespace",
            type: TA,
            attributeKey: "k8s.namespace.name",
            isMultiSelect: true,
          },
        ],
        picks: [{ selectedValues: ["prod", "staging"] }],
        expected: {
          kind: "Pod",
          namespaceKey: new Includes(["prod", "staging"]),
        },
      },
      {
        name: "a container list filtered by one variable and on All for the other",
        resourceType: "docker-container",
        componentType: DashboardComponentType.DockerContainerList,
        service: DockerResourceService,
        variables: [
          {
            id: "name",
            name: "Name",
            type: TA,
            attributeKey: "container.name",
            isMultiSelect: false,
            defaultValue: "7",
          },
          {
            id: "image",
            name: "Image",
            type: TA,
            attributeKey: "container.image.name",
            isMultiSelect: true,
          },
        ],
        picks: [{ selectedValue: "" }, { selectedValues: ["redis"] }],
        expected: {
          kind: "Container",
          name: undefined,
          imageName: new Includes(["redis"]),
        },
      },
      {
        name: "a log stream filtered by the picked service",
        resourceType: "log",
        componentType: DashboardComponentType.LogStream,
        service: LogService,
        variables: [
          {
            id: "service",
            name: "Service",
            type: TA,
            attributeKey: "service.name",
            isMultiSelect: false,
            defaultValue: "42",
          },
        ],
        picks: [{ selectedValue: "checkout" }],
        expected: { attributes: { "service.name": "checkout" } },
      },
      {
        name: "an SLO list kept to the picked objective",
        resourceType: "slo-list",
        componentType: DashboardComponentType.SloList,
        service: ServiceLevelObjectiveService,
        variables: [
          {
            id: "slo",
            name: "slo",
            type: TA,
            attributeKey: "sloName",
            isMultiSelect: false,
          },
        ],
        picks: [{ selectedValue: "Checkout API" }],
        expected: { isArchived: false, name: "Checkout API" },
      },
    ];

    const VARIABLE_SHAPES: Array<
      [string, (variables: Array<JSONObject>) => unknown]
    > = [
      [
        "its variables written as JSON text",
        (variables: Array<JSONObject>): unknown => {
          return JSON.stringify(variables);
        },
      ],
      [
        "its variables stored without ids",
        (variables: Array<JSONObject>): unknown => {
          return variables.map(withoutId);
        },
      ],
      [
        "its variables sharing one id",
        (variables: Array<JSONObject>): unknown => {
          return variables.map((variable: JSONObject) => {
            return { ...variable, id: "shared" };
          });
        },
      ],
      [
        'isMultiSelect written as "true" or "false"',
        (variables: Array<JSONObject>): unknown => {
          return variables.map((variable: JSONObject) => {
            return {
              ...variable,
              isMultiSelect: String(variable["isMultiSelect"]),
            };
          });
        },
      ],
      [
        "defaults written as numbers",
        (variables: Array<JSONObject>): unknown => {
          return variables.map((variable: JSONObject) => {
            return typeof variable["defaultValue"] === "string"
              ? { ...variable, defaultValue: Number(variable["defaultValue"]) }
              : variable;
          });
        },
      ],
      [
        "ids written as numbers",
        (variables: Array<JSONObject>): unknown => {
          return variables.map((variable: JSONObject, index: number) => {
            return { ...variable, id: 100 + index };
          });
        },
      ],
      [
        "ids with spaces around them",
        (variables: Array<JSONObject>): unknown => {
          return variables.map((variable: JSONObject) => {
            return { ...variable, id: ` ${String(variable["id"])} ` };
          });
        },
      ],
      [
        "entries that are no variable among them",
        (variables: Array<JSONObject>): unknown => {
          return [null, ...variables, "junk", 7, []];
        },
      ],
      [
        "all of these at once, written as JSON text",
        (variables: Array<JSONObject>): unknown => {
          return JSON.stringify([
            "junk",
            ...variables.map((variable: JSONObject, index: number) => {
              const shaped: JSONObject = {
                ...(index % 2 === 0
                  ? withoutId(variable)
                  : { ...variable, id: 7 }),
                isMultiSelect: String(variable["isMultiSelect"]),
              };

              if (typeof variable["defaultValue"] === "string") {
                shaped["defaultValue"] = Number(variable["defaultValue"]);
              }

              return shaped;
            }),
            null,
          ]);
        },
      ],
    ];

    describe.each(VARIABLE_ROUTE_CASES)(
      "$name",
      (routeCase: VariableRouteCase) => {
        it.each(VARIABLE_SHAPES)(
          "lists exactly as with the editor's variables, with %s",
          async (
            _shape: string,
            storeAs: (variables: Array<JSONObject>) => unknown,
          ) => {
            const list: BuiltWidget = buildWidget({
              componentType: routeCase.componentType,
              argumentsObject: { maxRows: 9 },
            });

            const asEditor: DashboardViewConfig = configWith(
              [list.widget],
              routeCase.variables,
            );
            dashboard.dashboardViewConfig = asEditor;
            const expected: JSONObject = await listedWith({
              resourceType: routeCase.resourceType,
              service: routeCase.service,
              body: pageBody({
                stored: asEditor,
                resourceType: routeCase.resourceType,
                picks: routeCase.picks,
              }),
            });

            // Not vacuous: the picks decide the query.
            for (const [field, value] of Object.entries(routeCase.expected)) {
              expect([field, (expected["query"] as JSONObject)[field]]).toEqual(
                [field, value],
              );
            }
            expect(expected["limit"]).toBe(9);

            const asShape: DashboardViewConfig = configWith(
              [list.widget],
              storeAs(routeCase.variables),
            );
            dashboard.dashboardViewConfig = asShape;

            expect(
              comparable(
                await listedWith({
                  resourceType: routeCase.resourceType,
                  service: routeCase.service,
                  body: pageBody({
                    stored: asShape,
                    resourceType: routeCase.resourceType,
                    picks: routeCase.picks,
                  }),
                }),
              ),
            ).toEqual(comparable(expected));
          },
        );
      },
    );

    describe("a monitor list that follows a label variable", () => {
      const PAYMENTS: string = ObjectID.generate().toString();
      const SUPPORT: string = ObjectID.generate().toString();
      const UNIT: JSONObject = {
        id: "unit",
        name: "UNIT",
        type: DashboardVariableType.ProjectLabel,
        isMultiSelect: false,
        labelOptions: [
          { label: "Payments", value: PAYMENTS },
          { label: "Support", value: SUPPORT },
        ],
      };

      const monitorsWith: (data: {
        variables: unknown;
        labelVariableId: string;
        picks: Array<Pick | null>;
      }) => Promise<JSONObject> = async (data: {
        variables: unknown;
        labelVariableId: string;
        picks: Array<Pick | null>;
      }): Promise<JSONObject> => {
        const monitor: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.MonitorList,
          argumentsObject: { labelVariableId: data.labelVariableId },
        });
        const stored: DashboardViewConfig = configWith(
          [monitor.widget],
          data.variables,
        );
        dashboard.dashboardViewConfig = stored;

        return (
          await listedWith({
            resourceType: "monitor",
            service: MonitorService,
            body: pageBody({
              stored,
              resourceType: "monitor",
              picks: data.picks,
            }),
          })
        )["query"] as JSONObject;
      };

      it("filters by the picked label in every shape the binding can still name the variable in", async () => {
        const expected: JSONObject = {
          projectId,
          labels: new Includes([SUPPORT]),
        };
        const shapes: Array<[string, unknown, string]> = [
          ["as the editor stores it", [UNIT], "unit"],
          ["written as JSON text", JSON.stringify([UNIT]), "unit"],
          ["its id written as a number", [{ ...UNIT, id: 7 }], "7"],
          [
            "its id with spaces around it",
            [{ ...UNIT, id: "  unit  " }],
            "unit",
          ],
          [
            'isMultiSelect written as "false"',
            [{ ...UNIT, isMultiSelect: "false" }],
            "unit",
          ],
          [
            "first of two variables sharing its id",
            [
              UNIT,
              { ...UNIT, labelOptions: [{ label: "Other", value: PAYMENTS }] },
            ],
            "unit",
          ],
          ["after an entry that is no variable", [null, "unit", UNIT], "unit"],
        ];

        for (const [shape, variables, labelVariableId] of shapes) {
          expect([
            shape,
            await monitorsWith({
              variables,
              labelVariableId,
              picks: [{ selectedValue: SUPPORT }],
            }),
          ]).toEqual([shape, expected]);
        }
      });

      it("refuses a pick that is none of the variable's own choices, and a binding that names a variable of another type", async () => {
        const monitor: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.MonitorList,
          argumentsObject: { labelVariableId: "unit" },
        });

        // A choice of the second variable, which shares the id but is drawn under its own.
        const stored: DashboardViewConfig = configWith(
          [monitor.widget],
          [
            UNIT,
            {
              ...UNIT,
              labelOptions: [
                { label: "Other", value: ObjectID.generate().toString() },
              ],
            },
          ],
        );
        dashboard.dashboardViewConfig = stored;
        const otherChoice: string = pageDraws(stored).variables![1]!
          .labelOptions![0]!.value as string;

        expect(
          await refusalOf({
            resourceType: "monitor",
            body: pageBody({
              stored,
              resourceType: "monitor",
              picks: [{ selectedValue: otherChoice }],
            }),
          }),
        ).toBe(
          "Choose up to 100 labels offered by this dashboard variable, or select All.",
        );

        // The id is drawn for a Telemetry Attribute variable first: the binding is to that one.
        const typed: DashboardViewConfig = configWith(
          [monitor.widget],
          [{ id: "unit", name: "UNIT", type: TA, attributeKey: "unit" }, UNIT],
        );
        dashboard.dashboardViewConfig = typed;

        expect(
          await refusalOf({
            resourceType: "monitor",
            body: pageBody({
              stored: typed,
              resourceType: "monitor",
              picks: [null, { selectedValue: SUPPORT }],
            }),
          }),
        ).toBe(
          "The monitor widget's label variable is missing or is not a project label variable. Edit the widget to select a label variable.",
        );
      });
    });

    /*
     * The routes' protections hold in every variable shape: a pick under an
     * id the page draws no variable under is never read, a derived id never
     * reaches another variable, and the request's bounds hold under it.
     */
    describe("a viewer's pick under a derived id", () => {
      const IMAGE: JSONObject = {
        name: "Image",
        type: TA,
        attributeKey: "container.image.name",
        defaultValue: "nginx",
      };

      const listContainers: (data: {
        variables: unknown;
        requestedVariables: Array<JSONObject>;
      }) => Promise<JSONObject> = async (data: {
        variables: unknown;
        requestedVariables: Array<JSONObject>;
      }): Promise<JSONObject> => {
        const list: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.DockerContainerList,
        });
        dashboard.dashboardViewConfig = configWith(
          [list.widget],
          data.variables,
        );

        return (
          await listedWith({
            resourceType: "docker-container",
            service: DockerResourceService,
            body: {
              componentId: list.componentId.toString(),
              variables: data.requestedVariables,
            },
          })
        )["query"] as JSONObject;
      };

      it("is never read under an id the page draws no variable under, however variable-shaped the stored config is elsewhere", async () => {
        const hiddenId: string = ObjectID.generate().toString();
        const list: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.DockerContainerList,
          argumentsObject: {
            // A variable-shaped object in the widget's own settings.
            variables: [{ ...IMAGE, id: hiddenId }],
          },
        });
        dashboard.dashboardViewConfig = {
          ...configWith([list.widget], [IMAGE]),
          // ...and under another key of the config: no toolbar reads either.
          hiddenVariables: [{ ...IMAGE, id: hiddenId }],
        } as unknown as DashboardViewConfig;

        const [pageId] = (
          pageDraws(dashboard.dashboardViewConfig).variables || []
        ).map((variable: DashboardVariable) => {
          return variable.id;
        });

        for (const id of [
          hiddenId,
          "00000000-0000-4000-9000-0000000000ff",
          ObjectID.generate().toString(),
        ]) {
          const query: JSONObject = (
            await listedWith({
              resourceType: "docker-container",
              service: DockerResourceService,
              body: {
                componentId: list.componentId.toString(),
                variables: [{ id, selectedValue: "redis", selectedValues: [] }],
              },
            })
          )["query"] as JSONObject;

          // Its default, as when nothing is picked.
          expect([id, query["imageName"]]).toEqual([id, "nginx"]);
        }

        // Under the id the page draws it under, the pick is read.
        expect(
          (
            (
              await listedWith({
                resourceType: "docker-container",
                service: DockerResourceService,
                body: {
                  componentId: list.componentId.toString(),
                  variables: [{ id: pageId!, selectedValue: "redis" }],
                },
              })
            )["query"] as JSONObject
          )["imageName"],
        ).toBe("redis");
      });

      it("never reaches another variable, even one stored under that very id", async () => {
        const firstDerivedId: string = pageDraws(configWith([], [IMAGE]))
          .variables![0]!.id;
        const variables: Array<JSONObject> = [
          IMAGE,
          {
            id: firstDerivedId,
            name: "Name",
            type: TA,
            attributeKey: "container.name",
          },
        ];
        const imageId: string = pageDraws(configWith([], variables))
          .variables![0]!.id;

        expect(imageId).not.toBe(firstDerivedId);

        expect(
          await listContainers({
            variables,
            requestedVariables: [{ id: firstDerivedId, selectedValue: "web" }],
          }),
        ).toEqual({
          kind: "Container",
          name: "web",
          imageName: "nginx",
          projectId,
        });

        expect(
          await listContainers({
            variables,
            requestedVariables: [{ id: imageId, selectedValue: "redis" }],
          }),
        ).toEqual({ kind: "Container", imageName: "redis", projectId });
      });

      it("is refused, before anything is read, when it is over-long or one of too many", async () => {
        const list: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.DockerContainerList,
        });
        dashboard.dashboardViewConfig = configWith([list.widget], [IMAGE]);
        const pageId: string = pageDraws(dashboard.dashboardViewConfig)
          .variables![0]!.id;

        for (const requestedVariables of [
          [{ id: pageId, selectedValue: "x".repeat(1025) }],
          [{ id: pageId, selectedValues: Array(101).fill("v") }],
          [
            { id: pageId, selectedValue: "a" },
            { id: pageId, selectedValue: "b" },
          ],
          Array.from({ length: 51 }, (_: unknown, index: number) => {
            return {
              id: index === 0 ? pageId : `v-${index}`,
              selectedValue: "v",
            };
          }),
        ]) {
          await refusalOf({
            resourceType: "docker-container",
            body: {
              componentId: list.componentId.toString(),
              variables: requestedVariables,
            },
          });
        }
      });
    });

    /*
     * Item 2 of the issue: a list widget saved without settings - before
     * November 2024, or written by hand - or with settings that say none is
     * drawn with its defaults, signed in and on the public page. It is now
     * listed with them, rather than refused as "Dashboard widget arguments
     * must be an object.".
     */
    describe("a widget saved without settings", () => {
      const NO_SETTINGS: Array<[string, (widget: JSONObject) => JSONObject]> = [
        [
          "saved without arguments",
          (widget: JSONObject): JSONObject => {
            const copy: JSONObject = { ...widget };
            delete copy["arguments"];
            return copy;
          },
        ],
        [
          "with arguments null",
          (widget: JSONObject): JSONObject => {
            return { ...widget, arguments: null };
          },
        ],
        [
          "with arguments a list",
          (widget: JSONObject): JSONObject => {
            return { ...widget, arguments: [{ maxRows: 7 }] };
          },
        ],
        [
          "with arguments encoded twice",
          (widget: JSONObject): JSONObject => {
            return {
              ...widget,
              arguments: JSON.stringify(JSON.stringify({ maxRows: 7 })),
            };
          },
        ],
        [
          "with arguments cut short",
          (widget: JSONObject): JSONObject => {
            return { ...widget, arguments: '{"maxRows": 7' };
          },
        ],
        [
          "as JSON text, without arguments",
          (widget: JSONObject): JSONObject => {
            const copy: JSONObject = { ...widget };
            delete copy["arguments"];
            return JSON.stringify(copy) as unknown as JSONObject;
          },
        ],
      ];

      it.each(
        RESOURCE_ROUTE_CASES.filter((routeCase: ResourceRouteCase) => {
          return routeCase.componentType !== DashboardComponentType.Slo;
        }).map((routeCase: ResourceRouteCase): [string, ResourceRouteCase] => {
          return [routeCase.componentType, routeCase];
        }),
      )(
        "lists a %s saved without settings exactly as one saved with none, as the page draws it",
        async (_componentType: string, routeCase: ResourceRouteCase) => {
          const list: BuiltWidget = buildWidget({
            componentType: routeCase.componentType,
          });
          const body: JSONObject = {
            componentId: list.componentId.toString(),
            query: telemetryQuery(routeCase.resourceType),
          };

          dashboard.dashboardViewConfig = configWith([list.widget]);
          const asNone: JSONObject = await listedWith({
            resourceType: routeCase.resourceType,
            service: routeCase.service,
            body,
          });

          for (const [shape, storeAs] of NO_SETTINGS) {
            dashboard.dashboardViewConfig = configWith([storeAs(list.widget)]);

            // The page draws it with no settings at all, signed in and public alike.
            expect([
              shape,
              pageDraws(dashboard.dashboardViewConfig).components[0]?.arguments,
            ]).toEqual([shape, {}]);

            expect([
              shape,
              comparable(
                await listedWith({
                  resourceType: routeCase.resourceType,
                  service: routeCase.service,
                  body,
                }),
              ),
            ]).toEqual([shape, comparable(asNone)]);
          }
        },
      );

      it("lists an incident list saved without settings with the list's own defaults", async () => {
        const incident: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.IncidentList,
        });
        delete incident.widget["arguments"];
        dashboard.dashboardViewConfig = configWith([incident.widget]);

        const listed: JSONObject = await listedWith({
          resourceType: "incident",
          service: IncidentService,
          body: { componentId: incident.componentId.toString() },
        });

        expect(listed["limit"]).toBe(25);
        expect(listed["sort"]).toEqual({ createdAt: SortOrder.Descending });
        expect(Object.keys(listed["query"] as JSONObject).sort()).toEqual([
          "isPrivate",
          "projectId",
        ]);
      });

      it("still lists nothing for a Data Source widget, or a type the page does not draw, saved without settings", async () => {
        for (const componentType of [
          DashboardComponentType.DataSourceTable,
          "incidentlist",
          " IncidentList ",
        ]) {
          const hidden: BuiltWidget = buildWidget({
            componentType: componentType as DashboardComponentType,
          });
          delete hidden.widget["arguments"];
          dashboard.dashboardViewConfig = configWith([hidden.widget]);

          expect(
            await refusalOf({
              resourceType: "incident",
              body: { componentId: hidden.componentId.toString() },
            }),
          ).toBe("This resource is not part of this dashboard.");
        }
      });
    });

    /*
     * Item 3 of the issue: the page reads a widget's settings deserialized,
     * so a list of ids stored as ObjectID JSON filters by those ids - also
     * when the page draws the widget from its stored JSON because something
     * else in it cannot be revived. The route lists it as with the ids
     * stored as text.
     */
    describe("ids stored as ObjectIDs", () => {
      const ENCODINGS: Array<[string, (settings: JSONObject) => unknown]> = [
        [
          "object arguments",
          (settings: JSONObject): unknown => {
            return settings;
          },
        ],
        [
          "JSON-text arguments",
          (settings: JSONObject): unknown => {
            return JSON.stringify(settings);
          },
        ],
        [
          "object arguments of a widget the page cannot revive",
          (settings: JSONObject): unknown => {
            return { ...settings, unrelated: { _type: "Includes", value: 5 } };
          },
        ],
        [
          "JSON-text arguments of a widget the page cannot revive",
          (settings: JSONObject): unknown => {
            return JSON.stringify({
              ...settings,
              unrelated: { _type: "Includes", value: 5 },
            });
          },
        ],
      ];

      it.each(ENCODINGS)(
        "lists an incident list whose ids are stored as ObjectIDs, in %s, as with the ids stored as text",
        async (
          _encoding: string,
          encode: (settings: JSONObject) => unknown,
        ) => {
          const severityId: string = ObjectID.generate().toString();
          const monitorId: string = ObjectID.generate().toString();
          const labelId: string = ObjectID.generate().toString();
          const settings: (asId: (id: string) => JSONValue) => JSONObject = (
            asId: (id: string) => JSONValue,
          ): JSONObject => {
            return {
              maxRows: 6,
              severityIds: [asId(severityId)],
              monitorIds: [asId(monitorId)],
              labelIds: [asId(labelId)],
            };
          };
          const incident: BuiltWidget = buildWidget({
            componentType: DashboardComponentType.IncidentList,
          });
          const body: JSONObject = {
            componentId: incident.componentId.toString(),
          };

          dashboard.dashboardViewConfig = configWith([
            {
              ...incident.widget,
              arguments: settings((id: string): JSONValue => {
                return id;
              }),
            },
          ]);
          const asText: JSONObject = await listedWith({
            resourceType: "incident",
            service: IncidentService,
            body,
          });

          expect((asText["query"] as JSONObject)["incidentSeverityId"]).toEqual(
            new Includes([severityId]),
          );

          dashboard.dashboardViewConfig = configWith([
            {
              ...incident.widget,
              arguments: encode(
                settings((id: string): JSONValue => {
                  return new ObjectID(id).toJSON();
                }),
              ) as JSONObject,
            },
          ]);

          expect(
            comparable(
              await listedWith({
                resourceType: "incident",
                service: IncidentService,
                body,
              }),
            ),
          ).toEqual(comparable(asText));
        },
      );

      it("reads a row cap stored as a date as none, not as the date's time in milliseconds", async () => {
        const incident: BuiltWidget = buildWidget({
          componentType: DashboardComponentType.IncidentList,
          argumentsObject: {
            maxRows: OneUptimeDate.toJSON(new Date("2026-11-08T00:00:00.000Z")),
          },
        });
        dashboard.dashboardViewConfig = configWith([incident.widget]);

        expect(
          (
            await listedWith({
              resourceType: "incident",
              service: IncidentService,
              body: { componentId: incident.componentId.toString() },
            })
          )["limit"],
        ).toBe(25);
      });

      it("still refuses a query operator where a list of ids belongs, in either encoding", async () => {
        for (const encode of [
          (settings: JSONObject): unknown => {
            return settings;
          },
          (settings: JSONObject): unknown => {
            return JSON.stringify(settings);
          },
        ]) {
          const incident: BuiltWidget = buildWidget({
            componentType: DashboardComponentType.IncidentList,
          });
          dashboard.dashboardViewConfig = configWith([
            {
              ...incident.widget,
              arguments: encode({
                severityIds: new Includes([
                  ObjectID.generate().toString(),
                ]).toJSON(),
              }),
            },
          ]);

          expect(
            await refusalOf({
              resourceType: "incident",
              body: { componentId: incident.componentId.toString() },
            }),
          ).toBe("Dashboard widget severityIds must be an array.");
        }
      });
    });
  });

  /*
   * Issue #6315, as a property. Dashboards are generated with list and SLO
   * widgets and variables in mixed shapes: each widget as the editor saves
   * it, as JSON text or in its envelope, with its settings as an object, as
   * JSON text or none at all, or hidden (a Data Source widget, a type the
   * page does not draw); each variable with its own id, none, one an
   * earlier variable has, a number or one with spaces, `isMultiSelect` as a
   * flag or as text, a default as text or a number; junk among them; the
   * variable list and the whole config as text or not.
   *
   * What each widget lists is worked out from what was generated alone -
   * its row cap, and each column the variables decide, by the rules the
   * toolbar applies (DashboardVariableInterpolation.resolveValue) - and
   * checked against what the public page draws: the config /view-config
   * serves, sent as JSON, read as the page reads it. Then the page's own
   * request is sent for every widget it draws, on both routes, every
   * variable's pick under the id the page draws it under, with a pick under
   * an id it draws no variable under thrown in; and every hidden widget is
   * asked for by its stored id.
   */
  describe("property: the list and SLO routes serve exactly what the public page draws (issue #6315)", () => {
    const SLO_HISTORY_ROUTE: string =
      "/dashboard/slo-history-aggregate/:dashboardId";
    const TA: DashboardVariableType = DashboardVariableType.TelemetryAttribute;

    interface ListType {
      resourceType: string;
      componentType: DashboardComponentType;
      service: ListService;
      // The column each variable key filters; a log stream filters every key in its attributes.
      columns: Record<string, string> | "attributes";
      defaultLimit: number;
    }

    const LIST_TYPES: Array<ListType> = [
      {
        resourceType: "host",
        componentType: DashboardComponentType.HostList,
        service: HostService,
        columns: { "host.name": "name", "host.id": "hostIdentifier" },
        defaultLimit: 25,
      },
      {
        resourceType: "docker-container",
        componentType: DashboardComponentType.DockerContainerList,
        service: DockerResourceService,
        columns: {
          "container.name": "name",
          "container.image.name": "imageName",
        },
        defaultLimit: 25,
      },
      {
        resourceType: "kubernetes-resource",
        componentType: DashboardComponentType.KubernetesPodList,
        service: KubernetesResourceService,
        columns: {
          "k8s.pod.name": "name",
          "k8s.namespace.name": "namespaceKey",
        },
        defaultLimit: 25,
      },
      {
        resourceType: "incident",
        componentType: DashboardComponentType.IncidentList,
        service: IncidentService,
        columns: {},
        defaultLimit: 25,
      },
      {
        resourceType: "log",
        componentType: DashboardComponentType.LogStream,
        service: LogService,
        columns: "attributes",
        defaultLimit: 50,
      },
      {
        resourceType: "slo-list",
        componentType: DashboardComponentType.SloList,
        service: ServiceLevelObjectiveService,
        columns: { sloName: "name" },
        defaultLimit: SLO_LIST_DEFAULT_MAX_ROWS,
      },
    ];

    const KEYS: Array<string> = [
      "host.name",
      "container.name",
      "container.image.name",
      "k8s.namespace.name",
      "service.name",
      "sloName",
    ];

    const VALUES: Array<string> = ["api", "web-1", "prod", "redis", "7"];

    type Pick =
      | { kind: "none" }
      | { kind: "all" }
      | { kind: "values"; values: Array<string> };

    interface GeneratedVariable {
      key: string;
      isMultiSelect: boolean;
      // Single-selects only: numeric text, so it can be stored as a number too.
      defaultValue: string | undefined;
      idShape: "own" | "none" | "shared" | "number" | "spaced";
      flagShape: "a flag" | "text" | "none";
      defaultShape: "text" | "a number";
      ownId: string;
      pick: Pick;
    }

    type SettingsShape =
      | "an object"
      | "JSON text"
      | "none"
      | "null"
      | "text encoded twice"
      | "text cut short";

    const READABLE: Array<SettingsShape> = ["an object", "JSON text"];

    type Visibility =
      | "drawn"
      | "a Data Source widget"
      | "a type the page does not draw";

    interface GeneratedWidget {
      kind: ListType | "a pinned SLO" | "an SLO chart that follows a variable";
      maxRows: number;
      settingsShape: SettingsShape;
      entryShape:
        | "the widget"
        | "JSON text"
        | "the envelope"
        | "the envelope, as text";
      visibility: Visibility;
      componentId: string;
      hasStoredId: boolean;
      pinnedSloId: string;
      // For an SLO chart that follows a variable: the one it follows.
      followed?: GeneratedVariable | undefined;
    }

    const pick: (random: SeededRandom, isMultiSelect: boolean) => Pick = (
      random: SeededRandom,
      isMultiSelect: boolean,
    ): Pick => {
      const roll: number = random(4);

      if (roll === 0) {
        return { kind: "none" };
      }

      if (roll === 1) {
        return { kind: "all" };
      }

      return {
        kind: "values",
        values: shuffled(VALUES, random).slice(
          0,
          isMultiSelect ? 1 + random(2) : 1,
        ),
      };
    };

    const generateVariable: (
      random: SeededRandom,
      key: string,
      idShapes: Array<GeneratedVariable["idShape"]>,
    ) => GeneratedVariable = (
      random: SeededRandom,
      key: string,
      idShapes: Array<GeneratedVariable["idShape"]>,
    ): GeneratedVariable => {
      const isMultiSelect: boolean = random(3) === 0;

      return {
        key,
        isMultiSelect,
        defaultValue:
          !isMultiSelect && random(2) === 0
            ? String(10 + random(90))
            : undefined,
        idShape: idShapes[random(idShapes.length)]!,
        flagShape: isMultiSelect
          ? random(2) === 0
            ? "a flag"
            : "text"
          : (["a flag", "text", "none"] as const)[random(3)]!,
        defaultShape: random(2) === 0 ? "text" : "a number",
        ownId: ObjectID.generate().toString(),
        pick: pick(random, isMultiSelect),
      };
    };

    // The variable as it is stored, in its own shapes.
    const storedVariableOf: (
      variable: GeneratedVariable,
      index: number,
      previous: JSONObject | undefined,
    ) => JSONObject = (
      variable: GeneratedVariable,
      index: number,
      previous: JSONObject | undefined,
    ): JSONObject => {
      const stored: JSONObject = {
        name: `variable${index}`,
        type: TA,
        attributeKey: variable.key,
      };

      if (variable.idShape === "own") {
        stored["id"] = variable.ownId;
      } else if (variable.idShape === "shared") {
        stored["id"] = (previous?.["id"] as JSONValue) ?? variable.ownId;
      } else if (variable.idShape === "number") {
        stored["id"] = 500 + index;
      } else if (variable.idShape === "spaced") {
        stored["id"] = `  ${variable.ownId}  `;
      }

      if (variable.flagShape === "a flag") {
        stored["isMultiSelect"] = variable.isMultiSelect;
      } else if (variable.flagShape === "text") {
        stored["isMultiSelect"] = String(variable.isMultiSelect);
      }

      if (variable.defaultValue !== undefined) {
        stored["defaultValue"] =
          variable.defaultShape === "text"
            ? variable.defaultValue
            : Number(variable.defaultValue);
      }

      return stored;
    };

    // What a variable means for the query, by the toolbar's rules: a value, values, or nothing.
    const meaningOf: (variable: GeneratedVariable) => unknown = (
      variable: GeneratedVariable,
    ): unknown => {
      if (variable.isMultiSelect) {
        return variable.pick.kind === "values"
          ? new Includes(variable.pick.values)
          : undefined;
      }

      if (variable.pick.kind === "all") {
        return undefined;
      }

      if (variable.pick.kind === "values") {
        return variable.pick.values[0];
      }

      return variable.defaultValue;
    };

    // The pick the page sends for it, as DashboardResourceList.getVariableSelections sends it.
    const pickOf: (variable: GeneratedVariable) => {
      selectedValue?: string;
      selectedValues?: Array<string>;
    } = (
      variable: GeneratedVariable,
    ): { selectedValue?: string; selectedValues?: Array<string> } => {
      if (variable.pick.kind === "none") {
        return {};
      }

      if (variable.pick.kind === "all") {
        return variable.isMultiSelect
          ? { selectedValues: [] }
          : { selectedValue: "" };
      }

      return variable.isMultiSelect
        ? { selectedValues: variable.pick.values }
        : { selectedValue: variable.pick.values[0]! };
    };

    const settingsOf: (generated: GeneratedWidget) => JSONObject = (
      generated: GeneratedWidget,
    ): JSONObject => {
      if (generated.kind === "a pinned SLO") {
        return {
          serviceLevelObjectiveId: generated.pinnedSloId,
          displayType: SloWidgetDisplayType.Chart,
          maxRows: generated.maxRows,
        };
      }

      if (generated.kind === "an SLO chart that follows a variable") {
        return {
          serviceLevelObjectiveVariableId: generated.followed!.ownId,
          displayType: SloWidgetDisplayType.Chart,
        };
      }

      return { maxRows: generated.maxRows };
    };

    const componentTypeOf: (generated: GeneratedWidget) => string = (
      generated: GeneratedWidget,
    ): string => {
      if (generated.visibility === "a Data Source widget") {
        return DashboardComponentType.DataSourceTable;
      }

      const componentType: string =
        typeof generated.kind === "string"
          ? DashboardComponentType.Slo
          : generated.kind.componentType;

      return generated.visibility === "a type the page does not draw"
        ? ` ${componentType} `
        : componentType;
    };

    // The widget as one entry of the stored list, in its own shapes.
    const entryOf: (generated: GeneratedWidget) => unknown = (
      generated: GeneratedWidget,
    ): unknown => {
      const settings: JSONObject = settingsOf(generated);
      const text: string = JSON.stringify(settings);
      const storedArguments: JSONValue | undefined = {
        "an object": settings,
        "JSON text": text,
        none: undefined,
        null: null,
        "text encoded twice": JSON.stringify(text),
        "text cut short": text.slice(0, text.length - 3),
      }[generated.settingsShape];

      const widget: JSONObject = {
        _type: "DashboardComponent",
        componentType: componentTypeOf(generated),
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 6,
        heightInDashboardUnits: 4,
      };

      if (generated.hasStoredId) {
        widget["componentId"] = generated.componentId;
      }

      if (storedArguments !== undefined) {
        widget["arguments"] = storedArguments;
      }

      switch (generated.entryShape) {
        case "JSON text":
          return JSON.stringify(widget);
        case "the envelope":
          return { _type: "DashboardComponent", value: widget };
        case "the envelope, as text":
          return { _type: "DashboardComponent", value: JSON.stringify(widget) };
        default:
          return widget;
      }
    };

    // What the public page draws: what /view-config serves, sent as JSON, read as the page reads it.
    const pageDraws: (stored: unknown) => DashboardViewConfig = (
      stored: unknown,
    ): DashboardViewConfig => {
      return StoredDashboardViewConfig.read(
        JSON.parse(
          JSON.stringify(
            JSONFunctions.serialize(
              PublicDashboardViewConfig.sanitize(
                stored as DashboardViewConfig,
              ) as unknown as JSONObject,
            ),
          ),
        ),
      );
    };

    // Why the last call was refused, as words: none when it was served.
    const errorsOfLastCall: () => Array<string> = (): Array<string> => {
      return (
        (nextFunction as jest.Mock).mock.calls as Array<Array<unknown>>
      ).map((call: Array<unknown>): string => {
        const error: unknown = call[0];

        return error instanceof BadDataException
          ? error.message
          : `not a BadDataException: ${String(error)}`;
      });
    };

    const callSloHistory: (body: JSONObject) => Promise<void> = async (
      body: JSONObject,
    ): Promise<void> => {
      await mockRouter.match("post", SLO_HISTORY_ROUTE).handlerFunction(
        {
          params: { dashboardId: dashboardId.toString() },
          body,
          query: {},
          cookies: {},
          headers: {},
          socket: {},
          ips: [],
        } as unknown as ExpressRequest,
        mockResponse,
        nextFunction,
      );
    };

    const MATCHED_SLO_ID: string = ObjectID.generate().toString();

    beforeEach(() => {
      jest
        .spyOn(SloHistoryService, "aggregateBy")
        .mockResolvedValue({ data: [] } as never);
    });

    test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
      "seed %i",
      async (seed: number) => {
        const random: SeededRandom = seededRandom(6315 + seed);
        const context: string = `seed ${seed}`;

        // The variables, one now and then for an SLO chart to follow.
        const variables: Array<GeneratedVariable> = [];
        const variableCount: number = 1 + random(4);

        for (let index: number = 0; index < variableCount; index++) {
          variables.push(
            generateVariable(random, KEYS[random(KEYS.length)]!, [
              "own",
              "none",
              "shared",
              "number",
              "spaced",
            ]),
          );
        }

        const widgets: Array<GeneratedWidget> = [];
        const widgetCount: number = 3 + random(5);

        for (let index: number = 0; index < widgetCount; index++) {
          const roll: number = random(8);
          const kind: GeneratedWidget["kind"] =
            roll === 0
              ? "a pinned SLO"
              : roll === 1
                ? "an SLO chart that follows a variable"
                : LIST_TYPES[random(LIST_TYPES.length)]!;

          const widget: GeneratedWidget = {
            kind,
            maxRows: 1 + random(40),
            settingsShape: (
              [
                "an object",
                "JSON text",
                "an object",
                "JSON text",
                "none",
                "null",
                "text encoded twice",
                "text cut short",
              ] as const
            )[random(8)]!,
            entryShape: (
              [
                "the widget",
                "JSON text",
                "the envelope",
                "the envelope, as text",
              ] as const
            )[random(4)]!,
            visibility:
              random(5) === 0
                ? (
                    [
                      "a Data Source widget",
                      "a type the page does not draw",
                    ] as const
                  )[random(2)]!
                : "drawn",
            componentId: ObjectID.generate().toString(),
            hasStoredId: random(4) !== 0,
            pinnedSloId: ObjectID.generate().toString(),
          };

          if (kind === "an SLO chart that follows a variable") {
            // Its own variable on the SLO's name, under an id it can name.
            widget.followed = generateVariable(random, "sloName", ["own"]);
            variables.splice(random(variables.length + 1), 0, widget.followed);
          }

          // A hidden widget is asked for by the id it is stored under.
          if (widget.visibility !== "drawn") {
            widget.hasStoredId = true;
          }

          widgets.push(widget);
        }

        // The stored variables, in their shapes, junk among them.
        const storedVariables: Array<unknown> = [];
        let previous: JSONObject | undefined = undefined;

        variables.forEach((variable: GeneratedVariable, index: number) => {
          if (random(5) === 0) {
            storedVariables.push([null, "junk", 7, []][random(4)]);
          }

          const stored: JSONObject = storedVariableOf(
            variable,
            index,
            previous,
          );
          storedVariables.push(stored);
          previous = stored;
        });

        const entries: Array<unknown> = [];

        for (const widget of widgets) {
          if (random(4) === 0) {
            entries.push([null, 7, "junk", [], "{"][random(5)]);
          }

          entries.push(entryOf(widget));
        }

        const config: JSONObject = {
          _type: "DashboardViewConfig",
          heightInDashboardUnits: 24,
          components: (random(4) === 0
            ? JSON.stringify(entries)
            : entries) as JSONValue,
          variables: (random(3) === 0
            ? JSON.stringify(storedVariables)
            : storedVariables) as JSONValue,
        };

        const stored: unknown = [
          config,
          JSON.stringify(config),
          { _type: "DashboardViewConfig", value: config },
        ][random(3)];

        dashboard.dashboardViewConfig = stored as DashboardViewConfig;

        /*
         * What the page draws is what was generated: every widget but the
         * Data Source ones, in order - one of a type it does not draw is
         * drawn as the note saying so - and every variable.
         */
        const drawn: DashboardViewConfig = pageDraws(stored);
        const onPage: Array<GeneratedWidget> = widgets.filter(
          (widget: GeneratedWidget): boolean => {
            return widget.visibility !== "a Data Source widget";
          },
        );

        expect([
          context,
          drawn.components.map((component: { componentType: string }) => {
            return component.componentType;
          }),
        ]).toEqual([context, onPage.map(componentTypeOf)]);
        expect([context, (drawn.variables || []).length]).toEqual([
          context,
          variables.length,
        ]);

        // The page's request: each variable's pick under the id the page draws it under.
        const requested: JSONArray =
          DashboardResourceList.getVariableSelections(
            (drawn.variables || []).map(
              (
                variable: DashboardVariable,
                index: number,
              ): DashboardVariable => {
                return {
                  ...variable,
                  ...pickOf(variables[index]!),
                } as DashboardVariable;
              },
            ),
          );

        const withStrayPick: JSONArray = [
          ...requested,
          // An id the page draws no variable under: never read.
          {
            id: ObjectID.generate().toString(),
            selectedValue: "stray",
            selectedValues: [],
          },
        ];

        let served: number = 0;
        let refused: number = 0;

        for (let index: number = 0; index < onPage.length; index++) {
          const generated: GeneratedWidget = onPage[index]!;

          // A type the page does not draw is asked for below, with the hidden widgets.
          if (generated.visibility !== "drawn") {
            continue;
          }

          const componentId: string =
            drawn.components[index]!.componentId.toString();
          const readable: boolean = READABLE.includes(generated.settingsShape);
          const label: string = `${context}, widget ${index} (${componentTypeOf(generated)}, settings ${generated.settingsShape})`;

          jest.clearAllMocks();
          jest.spyOn(ServiceLevelObjectiveService, "findBy").mockResolvedValue([
            Object.assign(new ServiceLevelObjective(), {
              _id: MATCHED_SLO_ID,
            }),
          ] as never);
          jest
            .spyOn(SloHistoryService, "aggregateBy")
            .mockResolvedValue({ data: [] } as never);

          if (typeof generated.kind !== "string") {
            const listType: ListType = generated.kind;

            await callRoute({
              resourceType: listType.resourceType,
              body: {
                componentId,
                variables: random(2) === 0 ? withStrayPick : requested,
                query: telemetryQuery(listType.resourceType),
              },
            });

            expect([label, errorsOfLastCall()]).toEqual([label, []]);
            const findBy: JSONObject = getFindByArgs(listType.service);
            const query: JSONObject = findBy["query"] as JSONObject;

            expect([label, findBy["limit"]]).toEqual([
              label,
              readable ? generated.maxRows : listType.defaultLimit,
            ]);
            expect([label, query["projectId"]]).toEqual([label, projectId]);

            // Each column the variables decide: the last variable on its key decides it.
            if (listType.columns === "attributes") {
              const attributes: JSONObject = {};

              for (const variable of variables) {
                const meaning: unknown = meaningOf(variable);

                if (meaning === undefined) {
                  delete attributes[variable.key];
                } else {
                  attributes[variable.key] = meaning as JSONValue;
                }
              }

              expect([label, query["attributes"]]).toEqual([
                label,
                Object.keys(attributes).length > 0 ? attributes : undefined,
              ]);
            } else {
              for (const [key, column] of Object.entries(listType.columns)) {
                const deciding: GeneratedVariable | undefined = [...variables]
                  .reverse()
                  .find((variable: GeneratedVariable): boolean => {
                    return variable.key === key;
                  });

                expect([label, column, query[column]]).toEqual([
                  label,
                  column,
                  deciding ? meaningOf(deciding) : undefined,
                ]);
              }
            }

            served++;
            continue;
          }

          // A pinned SLO: its numbers and its history, or no SLO selected when its settings say none.
          if (generated.kind === "a pinned SLO") {
            await callRoute({
              resourceType: "slo",
              body: { componentId, variables: requested },
            });

            if (readable) {
              expect([label, errorsOfLastCall()]).toEqual([label, []]);
              expect([
                label,
                (
                  (
                    getFindByArgs(ServiceLevelObjectiveService)[
                      "query"
                    ] as JSONObject
                  )["_id"] as ObjectID
                ).toString(),
              ]).toEqual([label, generated.pinnedSloId]);
            } else {
              expect([label, errorsOfLastCall()]).toEqual([
                label,
                [PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE],
              ]);
              expectNothingListed();
            }

            jest.clearAllMocks();
            await callSloHistory({
              componentId,
              variables: requested,
              aggregateBy: {
                startTimestamp: new Date("2026-08-09T00:00:00.000Z"),
                endTimestamp: new Date("2026-08-09T06:00:00.000Z"),
              },
            });

            if (readable) {
              expect([label, errorsOfLastCall()]).toEqual([label, []]);
              const aggregated: JSONObject = (
                SloHistoryService.aggregateBy as jest.Mock
              ).mock.calls[0]![0] as JSONObject;
              expect([
                label,
                (
                  (aggregated["query"] as JSONObject)["sloId"] as ObjectID
                ).toString(),
              ]).toEqual([label, generated.pinnedSloId]);
              served++;
            } else {
              expect([label, errorsOfLastCall()]).toEqual([
                label,
                [PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE],
              ]);
              expect(SloHistoryService.aggregateBy).not.toHaveBeenCalled();
              refused++;
            }

            continue;
          }

          // An SLO chart that follows a variable: the SLO the viewer picked, by name, or a reason it shows none.
          const followed: GeneratedVariable = generated.followed!;
          const meaning: unknown = meaningOf(followed);
          const expectedRefusal: string | null = !readable
            ? PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE
            : meaning === undefined
              ? PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE
              : meaning instanceof Includes && meaning.values.length > 1
                ? PUBLIC_SLO_WIDGET_MULTIPLE_SELECTION_MESSAGE
                : null;
          const pickedName: string | undefined =
            meaning instanceof Includes
              ? (meaning.values[0] as string)
              : (meaning as string | undefined);

          await callSloHistory({
            componentId,
            variables: random(2) === 0 ? withStrayPick : requested,
            aggregateBy: {
              startTimestamp: new Date("2026-08-09T00:00:00.000Z"),
              endTimestamp: new Date("2026-08-09T06:00:00.000Z"),
            },
          });

          if (expectedRefusal) {
            expect([label, errorsOfLastCall()]).toEqual([
              label,
              [expectedRefusal],
            ]);
            expect(SloHistoryService.aggregateBy).not.toHaveBeenCalled();
            refused++;
          } else {
            expect([label, errorsOfLastCall()]).toEqual([label, []]);
            expect([
              label,
              (
                getFindByArgs(ServiceLevelObjectiveService)[
                  "query"
                ] as JSONObject
              )["name"],
            ]).toEqual([label, pickedName]);
            const aggregated: JSONObject = (
              SloHistoryService.aggregateBy as jest.Mock
            ).mock.calls[0]![0] as JSONObject;
            expect([
              label,
              (
                (aggregated["query"] as JSONObject)["sloId"] as ObjectID
              ).toString(),
            ]).toEqual([label, MATCHED_SLO_ID]);
            served++;
          }
        }

        // Every hidden widget, asked for by its stored id: refused, nothing read.
        for (const hidden of widgets.filter(
          (widget: GeneratedWidget): boolean => {
            return widget.visibility !== "drawn";
          },
        )) {
          const resourceType: string =
            typeof hidden.kind === "string" ? "slo" : hidden.kind.resourceType;

          jest.clearAllMocks();
          await callRoute({
            resourceType,
            body: {
              componentId: hidden.componentId,
              variables: requested,
              query: telemetryQuery(resourceType),
            },
          });

          expect([context, hidden.visibility, errorsOfLastCall()]).toEqual([
            context,
            hidden.visibility,
            ["This resource is not part of this dashboard."],
          ]);
          expectNothingListed();
          refused++;
        }

        // The sweep served widgets in every seed.
        expect([context, served > 0]).toEqual([context, true]);
        expect(served + refused).toBeGreaterThan(0);
      },
    );
  });
});
