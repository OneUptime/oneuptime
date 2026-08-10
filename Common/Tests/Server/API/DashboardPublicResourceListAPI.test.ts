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
import SpanService from "../../../Server/Services/SpanService";
import PublicDashboardResourceListPolicy, {
  BuildPublicDashboardResourceListPolicyData,
  PublicDashboardResourceListPolicyResult,
} from "../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
}

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
  CephResourceService,
  DockerSwarmResourceService,
  SpanService,
  LogService,
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
            dashboardViewConfig: dashboard.dashboardViewConfig,
            requestedVariables: [],
            requestedQuery: telemetryQuery(routeCase.resourceType),
          }).select;
        expect(findByArgs["select"]).toEqual(expectedSelect);
        expect(findByArgs["skip"]).toBe(0);
      }
    });

    it("does not return sibling-only Proxmox or Swarm fields", async () => {
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

      expect(query["currentIncidentState"]).toEqual({
        isResolvedState: false,
      });
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
      expect(policyInput.widget).toBe(log.widget);
      expect(policyInput.dashboardViewConfig).toBe(
        dashboard.dashboardViewConfig,
      );
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
});
