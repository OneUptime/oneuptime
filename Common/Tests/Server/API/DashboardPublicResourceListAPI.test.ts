import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import AlertService from "../../../Server/Services/AlertService";
import CephResourceService from "../../../Server/Services/CephResourceService";
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
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
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

/*
 * Structural view of the model services the registry lists through — just
 * enough to spy on findBy and read back the arguments the API handed it.
 */
type ListService = {
  findBy: (findBy: never) => Promise<Array<unknown>>;
};

/*
 * Every public resource type, the widget that unlocks it, the `kind` that
 * widget renders, one filter the widget legitimately sends, one the widget
 * never sends (and which therefore must be dropped), a column of the fixed
 * select (sortable) and a column outside it (never sortable).
 */
interface ResourceCase {
  resourceType: string;
  componentType: DashboardComponentType;
  service: ListService;
  kind: string | null;
  allowedQueryKey: string;
  forbiddenQueryKey: string;
  selectColumn: string;
  nonSelectColumn: string;
  selectKeys: Array<string>;
}

const RESOURCE_CASES: Array<ResourceCase> = [
  {
    resourceType: "incident",
    componentType: DashboardComponentType.IncidentList,
    service: IncidentService,
    kind: null,
    allowedQueryKey: "incidentSeverityId",
    forbiddenQueryKey: "description",
    selectColumn: "createdAt",
    nonSelectColumn: "description",
    selectKeys: [
      "_id",
      "title",
      "createdAt",
      "currentIncidentState",
      "incidentSeverity",
    ],
  },
  {
    resourceType: "alert",
    componentType: DashboardComponentType.AlertList,
    service: AlertService,
    kind: null,
    allowedQueryKey: "alertSeverityId",
    forbiddenQueryKey: "description",
    selectColumn: "createdAt",
    nonSelectColumn: "description",
    selectKeys: [
      "_id",
      "title",
      "createdAt",
      "currentAlertState",
      "alertSeverity",
    ],
  },
  {
    resourceType: "monitor",
    componentType: DashboardComponentType.MonitorList,
    service: MonitorService,
    kind: null,
    allowedQueryKey: "monitorType",
    forbiddenQueryKey: "monitorSteps",
    selectColumn: "name",
    nonSelectColumn: "monitorSteps",
    selectKeys: ["_id", "name", "monitorType", "currentMonitorStatus"],
  },
  {
    /*
     * The Network Map draws a FLAT set of pins, so the hierarchy columns
     * (parentSiteId, materializedPath, depth) are deliberately outside both
     * the allowlist and the select — structure an anonymous viewer would be
     * able to walk but the map never shows them.
     */
    resourceType: "network-site",
    componentType: DashboardComponentType.NetworkMap,
    service: NetworkSiteService,
    kind: null,
    allowedQueryKey: "networkSiteTypeId",
    forbiddenQueryKey: "parentSiteId",
    selectColumn: "name",
    nonSelectColumn: "address",
    selectKeys: [
      "_id",
      "name",
      "networkSiteType",
      "latitude",
      "longitude",
      "currentMonitorStatus",
    ],
  },
  {
    resourceType: "host",
    componentType: DashboardComponentType.HostList,
    service: HostService,
    kind: null,
    allowedQueryKey: "otelCollectorStatus",
    forbiddenQueryKey: "createdAt",
    selectColumn: "name",
    nonSelectColumn: "createdAt",
    selectKeys: [
      "_id",
      "name",
      "hostIdentifier",
      "otelCollectorStatus",
      "osType",
      "osVersion",
      "cpuCores",
      "totalMemoryBytes",
      "lastSeenAt",
    ],
  },
  {
    resourceType: "kubernetes-resource",
    componentType: DashboardComponentType.KubernetesPodList,
    service: KubernetesResourceService,
    kind: "Pod",
    allowedQueryKey: "namespaceKey",
    forbiddenQueryKey: "createdAt",
    selectColumn: "name",
    nonSelectColumn: "createdAt",
    selectKeys: [
      "_id",
      "name",
      "namespaceKey",
      "kind",
      "phase",
      "isReady",
      "hasMemoryPressure",
      "hasDiskPressure",
      "hasPidPressure",
      "containerCount",
      "latestCpuPercent",
      "latestMemoryBytes",
      "controllerDeploymentName",
      "controllerCronJobName",
      "resourceCreationTimestamp",
      "lastSeenAt",
      "kubernetesClusterId",
      "kubernetesCluster",
    ],
  },
  {
    resourceType: "docker-host",
    componentType: DashboardComponentType.DockerHostList,
    service: DockerHostService,
    kind: null,
    allowedQueryKey: "otelCollectorStatus",
    forbiddenQueryKey: "createdAt",
    selectColumn: "name",
    nonSelectColumn: "createdAt",
    selectKeys: [
      "_id",
      "name",
      "otelCollectorStatus",
      "containersRunning",
      "containersStopped",
      "containersPaused",
      "osType",
      "osVersion",
    ],
  },
  {
    resourceType: "docker-container",
    componentType: DashboardComponentType.DockerContainerList,
    service: DockerResourceService,
    kind: "Container",
    allowedQueryKey: "imageName",
    forbiddenQueryKey: "createdAt",
    selectColumn: "name",
    nonSelectColumn: "createdAt",
    selectKeys: [
      "_id",
      "name",
      "imageName",
      "state",
      "latestCpuPercent",
      "latestMemoryBytes",
      "dockerHostId",
      "dockerHost",
    ],
  },
  {
    resourceType: "docker-image",
    componentType: DashboardComponentType.DockerImageList,
    service: DockerResourceService,
    kind: "Image",
    allowedQueryKey: "dockerHostId",
    forbiddenQueryKey: "state",
    selectColumn: "name",
    nonSelectColumn: "state",
    selectKeys: ["_id", "name", "containerId", "dockerHostId", "dockerHost"],
  },
  {
    resourceType: "docker-network",
    componentType: DashboardComponentType.DockerNetworkList,
    service: DockerResourceService,
    kind: "Network",
    allowedQueryKey: "dockerHostId",
    forbiddenQueryKey: "imageName",
    selectColumn: "name",
    nonSelectColumn: "imageName",
    selectKeys: ["_id", "name", "state", "dockerHostId", "dockerHost"],
  },
  {
    resourceType: "docker-volume",
    componentType: DashboardComponentType.DockerVolumeList,
    service: DockerResourceService,
    kind: "Volume",
    allowedQueryKey: "dockerHostId",
    forbiddenQueryKey: "imageName",
    selectColumn: "name",
    nonSelectColumn: "imageName",
    selectKeys: ["_id", "name", "state", "dockerHostId", "dockerHost"],
  },
  {
    resourceType: "podman-host",
    componentType: DashboardComponentType.PodmanHostList,
    service: PodmanHostService,
    kind: null,
    allowedQueryKey: "otelCollectorStatus",
    forbiddenQueryKey: "createdAt",
    selectColumn: "name",
    nonSelectColumn: "createdAt",
    selectKeys: [
      "_id",
      "name",
      "otelCollectorStatus",
      "containersRunning",
      "containersStopped",
      "containersPaused",
      "osType",
      "osVersion",
    ],
  },
  {
    resourceType: "podman-container",
    componentType: DashboardComponentType.PodmanContainerList,
    service: PodmanResourceService,
    kind: "Container",
    allowedQueryKey: "imageName",
    forbiddenQueryKey: "createdAt",
    selectColumn: "name",
    nonSelectColumn: "createdAt",
    selectKeys: [
      "_id",
      "name",
      "imageName",
      "state",
      "latestCpuPercent",
      "latestMemoryBytes",
      "podmanHostId",
      "podmanHost",
    ],
  },
  {
    resourceType: "podman-image",
    componentType: DashboardComponentType.PodmanImageList,
    service: PodmanResourceService,
    kind: "Image",
    allowedQueryKey: "podmanHostId",
    forbiddenQueryKey: "state",
    selectColumn: "name",
    nonSelectColumn: "state",
    selectKeys: ["_id", "name", "containerId", "podmanHostId", "podmanHost"],
  },
  {
    resourceType: "podman-network",
    componentType: DashboardComponentType.PodmanNetworkList,
    service: PodmanResourceService,
    kind: "Network",
    allowedQueryKey: "podmanHostId",
    forbiddenQueryKey: "imageName",
    selectColumn: "name",
    nonSelectColumn: "imageName",
    selectKeys: ["_id", "name", "state", "podmanHostId", "podmanHost"],
  },
  {
    resourceType: "podman-volume",
    componentType: DashboardComponentType.PodmanVolumeList,
    service: PodmanResourceService,
    kind: "Volume",
    allowedQueryKey: "podmanHostId",
    forbiddenQueryKey: "imageName",
    selectColumn: "name",
    nonSelectColumn: "imageName",
    selectKeys: ["_id", "name", "state", "podmanHostId", "podmanHost"],
  },
  {
    resourceType: "proxmox-resource",
    componentType: DashboardComponentType.ProxmoxNodeList,
    service: ProxmoxResourceService,
    kind: "Node",
    allowedQueryKey: "proxmoxClusterId",
    forbiddenQueryKey: "createdAt",
    selectColumn: "name",
    nonSelectColumn: "createdAt",
    selectKeys: [
      "_id",
      "name",
      "externalId",
      "kind",
      "vmid",
      "guestType",
      "parentNodeName",
      "isUp",
      "haState",
      "latestCpuPercent",
      "latestMemoryPercent",
      "lastSeenAt",
      "proxmoxClusterId",
      "proxmoxCluster",
    ],
  },
  {
    resourceType: "ceph-resource",
    componentType: DashboardComponentType.CephOsdList,
    service: CephResourceService,
    kind: "Osd",
    allowedQueryKey: "cephClusterId",
    forbiddenQueryKey: "createdAt",
    selectColumn: "externalId",
    nonSelectColumn: "createdAt",
    selectKeys: [
      "_id",
      "name",
      "externalId",
      "kind",
      "hostname",
      "deviceClass",
      "isUp",
      "isIn",
      "statBytes",
      "statBytesUsed",
      "storedBytes",
      "maxAvailBytes",
      "objects",
      "lastSeenAt",
      "cephClusterId",
      "cephCluster",
    ],
  },
  {
    resourceType: "docker-swarm-resource",
    componentType: DashboardComponentType.DockerSwarmNodeList,
    service: DockerSwarmResourceService,
    kind: "Node",
    allowedQueryKey: "role",
    forbiddenQueryKey: "createdAt",
    selectColumn: "name",
    nonSelectColumn: "createdAt",
    selectKeys: [
      "_id",
      "name",
      "externalId",
      "kind",
      "role",
      "state",
      "serviceMode",
      "desiredReplicas",
      "runningReplicas",
      "image",
      "isReady",
      "latestCpuPercent",
      "latestMemoryPercent",
      "lastSeenAt",
      "dockerSwarmClusterId",
      "dockerSwarmCluster",
    ],
  },
  {
    resourceType: "span",
    componentType: DashboardComponentType.TraceList,
    service: SpanService,
    kind: null,
    allowedQueryKey: "statusCode",
    forbiddenQueryKey: "traceId",
    selectColumn: "startTime",
    nonSelectColumn: "attributes",
    selectKeys: [
      "startTime",
      "name",
      "statusCode",
      "durationUnixNano",
      "traceId",
      "spanId",
      "kind",
      "primaryEntityId",
    ],
  },
  {
    resourceType: "log",
    componentType: DashboardComponentType.LogStream,
    service: LogService,
    kind: null,
    allowedQueryKey: "severityText",
    forbiddenQueryKey: "traceId",
    selectColumn: "time",
    nonSelectColumn: "severityNumber",
    selectKeys: [
      "time",
      "severityText",
      "body",
      "primaryEntityId",
      "traceId",
      "spanId",
      "attributes",
    ],
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

  type BuildViewConfigFunction = (
    componentTypes: Array<string>,
  ) => DashboardViewConfig;

  const buildViewConfig: BuildViewConfigFunction = (
    componentTypes: Array<string>,
  ): DashboardViewConfig => {
    return {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: componentTypes.map(
        (componentType: string, index: number): JSONObject => {
          return {
            _type: "DashboardComponent",
            componentId: ObjectID.generate().toString(),
            componentType: componentType,
            topInDashboardUnits: index,
            leftInDashboardUnits: 0,
            widthInDashboardUnits: 12,
            heightInDashboardUnits: 6,
            minWidthInDashboardUnits: 1,
            minHeightInDashboardUnits: 1,
            arguments: {},
          };
        },
      ),
    } as unknown as DashboardViewConfig;
  };

  type SetDashboardWidgetsFunction = (componentTypes: Array<string>) => void;

  const setDashboardWidgets: SetDashboardWidgetsFunction = (
    componentTypes: Array<string>,
  ): void => {
    dashboard.dashboardViewConfig = buildViewConfig(componentTypes);
  };

  type CallRouteFunction = (data: {
    resourceType: string;
    body?: JSONObject;
    query?: JSONObject;
  }) => Promise<void>;

  const callRoute: CallRouteFunction = async (data: {
    resourceType: string;
    body?: JSONObject;
    query?: JSONObject;
  }): Promise<void> => {
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

  type GetFindByArgsFunction = (service: ListService) => JSONObject;

  const getFindByArgs: GetFindByArgsFunction = (
    service: ListService,
  ): JSONObject => {
    const calls: Array<Array<unknown>> = (service.findBy as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);

    return calls[0]![0] as JSONObject;
  };

  type GetThrownErrorFunction = () => unknown;

  const getThrownError: GetThrownErrorFunction = (): unknown => {
    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);

    return calls[0]![0];
  };

  type ExpectNothingListedFunction = () => void;

  const expectNothingListed: ExpectNothingListedFunction = (): void => {
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

  describe("widget allowlist (GHSA-qv79-j844-cc7m)", () => {
    it("refuses to stream a project's logs from a dashboard that has no log widget", async () => {
      // The advisory's proof of concept: a metrics-only public dashboard.
      setDashboardWidgets([
        DashboardComponentType.Chart,
        DashboardComponentType.Text,
      ]);

      await callRoute({
        resourceType: "log",
        body: {
          query: {
            severityText: "Error",
          },
        },
      });

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "This resource is not part of this dashboard.",
      );
      expectNothingListed();
    });

    it("refuses to list incidents from a dashboard that only shows monitors", async () => {
      setDashboardWidgets([DashboardComponentType.MonitorList]);

      await callRoute({ resourceType: "incident" });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(IncidentService.findBy).not.toHaveBeenCalled();
    });

    it("refuses every resource type on a dashboard with no widgets at all", async () => {
      for (const resourceCase of RESOURCE_CASES) {
        jest.clearAllMocks();
        setDashboardWidgets([]);

        await callRoute({ resourceType: resourceCase.resourceType });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingListed();
      }
    });

    it("refuses every resource type when the stored view config is missing or malformed", async () => {
      const malformedConfigs: Array<unknown> = [
        null,
        undefined,
        "not-an-object",
        42,
        {},
        { components: null },
        { components: "not-an-array" },
        { components: [null, 7, "widget"] },
        { components: [{ componentType: 123 }] },
        { components: [{ componentType: "" }] },
      ];

      for (const config of malformedConfigs) {
        jest.clearAllMocks();
        dashboard.dashboardViewConfig = config as DashboardViewConfig;

        await callRoute({ resourceType: "log" });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingListed();
      }
    });

    it("serves each resource type once its own widget is on the dashboard", async () => {
      for (const resourceCase of RESOURCE_CASES) {
        jest.clearAllMocks();
        setDashboardWidgets([resourceCase.componentType]);

        await callRoute({ resourceType: resourceCase.resourceType });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(resourceCase.service.findBy).toHaveBeenCalledTimes(1);
      }
    });

    it("does not let one widget unlock a sibling resource served by the same model", async () => {
      // A Docker volume list must not become a Docker container reader.
      setDashboardWidgets([DashboardComponentType.DockerVolumeList]);

      await callRoute({ resourceType: "docker-container" });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(DockerResourceService.findBy).not.toHaveBeenCalled();
    });

    it("rejects a resource type that is not in the registry at all", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({ resourceType: "user" });

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "Unsupported dashboard resource type: user",
      );
      expectNothingListed();
    });
  });

  describe("authorization", () => {
    it("rejects a dashboard that is not public before reading anything", async () => {
      dashboard.isPublicDashboard = false;
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({ resourceType: "log" });

      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingListed();
    });

    /*
     * A missing dashboard never reaches the resource lookup: hasReadAccess
     * fails closed first, so the viewer is told they have no access rather
     * than whether the id exists.
     */
    it("rejects a dashboard that cannot be found", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);
      jest.spyOn(DashboardService, "findOneById").mockResolvedValue(null);

      await callRoute({ resourceType: "log" });

      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingListed();
    });

    it("rejects a dashboard with no project", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);
      delete dashboard.projectId;

      await callRoute({ resourceType: "log" });

      expect(getThrownError()).toBeInstanceOf(NotFoundException);
      expectNothingListed();
    });
  });

  describe("project scoping", () => {
    it("pins every resource type to the dashboard's own project", async () => {
      for (const resourceCase of RESOURCE_CASES) {
        jest.clearAllMocks();
        setDashboardWidgets([resourceCase.componentType]);

        await callRoute({ resourceType: resourceCase.resourceType });

        const findByArgs: JSONObject = getFindByArgs(resourceCase.service);
        const query: JSONObject = findByArgs["query"] as JSONObject;

        expect(query["projectId"]).toBe(projectId);
      }
    });

    it("ignores a client-supplied projectId pointing at another tenant", async () => {
      const otherProjectId: ObjectID = ObjectID.generate();

      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({
        resourceType: "log",
        body: {
          query: {
            projectId: otherProjectId.toString(),
            severityText: "Error",
          },
        },
      });

      const query: JSONObject = getFindByArgs(LogService)[
        "query"
      ] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect(query["projectId"]).not.toBe(otherProjectId.toString());
      expect(query["severityText"]).toBe("Error");
    });
  });

  describe("query allowlist", () => {
    it("keeps the widget's own filter and drops everything else", async () => {
      for (const resourceCase of RESOURCE_CASES) {
        jest.clearAllMocks();
        setDashboardWidgets([resourceCase.componentType]);

        await callRoute({
          resourceType: resourceCase.resourceType,
          body: {
            query: {
              [resourceCase.allowedQueryKey]: "allowed-value",
              [resourceCase.forbiddenQueryKey]: "smuggled-value",
              deletedAt: null,
              password: "smuggled-value",
            },
          },
        });

        const query: JSONObject = getFindByArgs(resourceCase.service)[
          "query"
        ] as JSONObject;

        expect(query[resourceCase.allowedQueryKey]).toBe("allowed-value");
        expect(Object.keys(query)).not.toContain(
          resourceCase.forbiddenQueryKey,
        );
        expect(Object.keys(query)).not.toContain("deletedAt");
        expect(Object.keys(query)).not.toContain("password");
      }
    });

    it("preserves deserialized query operators on allowed keys", async () => {
      const severityIds: Array<string> = [
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
      ];

      setDashboardWidgets([DashboardComponentType.IncidentList]);

      await callRoute({
        resourceType: "incident",
        body: {
          query: {
            incidentSeverityId: new Includes(severityIds).toJSON(),
            currentIncidentState: {
              isResolvedState: false,
            },
          },
        },
      });

      const query: JSONObject = getFindByArgs(IncidentService)[
        "query"
      ] as JSONObject;

      expect(query["incidentSeverityId"]).toBeInstanceOf(Includes);
      expect((query["incidentSeverityId"] as Includes).values).toEqual(
        severityIds,
      );
      expect(query["currentIncidentState"]).toEqual({
        isResolvedState: false,
      });
    });

    it("ignores a query that is not an object", async () => {
      const badQueries: Array<unknown> = [
        "severityText",
        ["severityText"],
        42,
        true,
      ];

      for (const badQuery of badQueries) {
        jest.clearAllMocks();
        setDashboardWidgets([DashboardComponentType.LogStream]);

        await callRoute({
          resourceType: "log",
          body: { query: badQuery as JSONObject },
        });

        expect(nextFunction).not.toHaveBeenCalled();

        const query: JSONObject = getFindByArgs(LogService)[
          "query"
        ] as JSONObject;

        expect(Object.keys(query)).toEqual(["projectId"]);
      }
    });

    it("does not carry prototype-polluting keys into the query", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      /*
       * JSON.parse (like the Express body parser) makes "__proto__" a real
       * own key rather than setting the prototype, which is how a pollution
       * payload actually arrives.
       */
      const pollutedQuery: JSONObject = JSON.parse(
        '{"__proto__":{"polluted":true},"constructor":{"polluted":true},"severityText":"Error"}',
      ) as JSONObject;

      await callRoute({
        resourceType: "log",
        body: { query: pollutedQuery },
      });

      const query: JSONObject = getFindByArgs(LogService)[
        "query"
      ] as JSONObject;

      expect(Object.keys(query).sort()).toEqual(["projectId", "severityText"]);
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    });

    it("sends no query at all when the body is empty", async () => {
      setDashboardWidgets([DashboardComponentType.MonitorList]);

      await callRoute({ resourceType: "monitor" });

      const query: JSONObject = getFindByArgs(MonitorService)[
        "query"
      ] as JSONObject;

      expect(query).toEqual({ projectId: projectId });
    });
  });

  describe("kind pinning", () => {
    it("pins the kind for every resource type whose model packs several kinds", async () => {
      for (const resourceCase of RESOURCE_CASES) {
        if (!resourceCase.kind) {
          continue;
        }

        jest.clearAllMocks();
        setDashboardWidgets([resourceCase.componentType]);

        await callRoute({ resourceType: resourceCase.resourceType });

        const query: JSONObject = getFindByArgs(resourceCase.service)[
          "query"
        ] as JSONObject;

        expect(query["kind"]).toBe(resourceCase.kind);
      }
    });

    it("rejects a kind the dashboard's widgets do not render", async () => {
      setDashboardWidgets([DashboardComponentType.DockerVolumeList]);

      await callRoute({
        resourceType: "docker-volume",
        body: {
          query: {
            kind: "Container",
          },
        },
      });

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "This resource is not part of this dashboard.",
      );
      expect(DockerResourceService.findBy).not.toHaveBeenCalled();
    });

    it("rejects a non-string kind", async () => {
      setDashboardWidgets([DashboardComponentType.CephPoolList]);

      await callRoute({
        resourceType: "ceph-resource",
        body: {
          query: {
            kind: { $ne: "Pool" },
          },
        },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(CephResourceService.findBy).not.toHaveBeenCalled();
    });

    it("lets a widget pick its own kind when the dashboard renders several", async () => {
      setDashboardWidgets([
        DashboardComponentType.KubernetesPodList,
        DashboardComponentType.KubernetesNodeList,
      ]);

      await callRoute({
        resourceType: "kubernetes-resource",
        body: {
          query: {
            kind: "Node",
          },
        },
      });

      const query: JSONObject = getFindByArgs(KubernetesResourceService)[
        "query"
      ] as JSONObject;

      expect(query["kind"]).toBe("Node");
    });

    it("falls back to every kind the dashboard renders when none is named", async () => {
      setDashboardWidgets([
        DashboardComponentType.KubernetesPodList,
        DashboardComponentType.KubernetesNodeList,
      ]);

      await callRoute({ resourceType: "kubernetes-resource" });

      const query: JSONObject = getFindByArgs(KubernetesResourceService)[
        "query"
      ] as JSONObject;

      expect(query["kind"]).toBeInstanceOf(Includes);
      expect((query["kind"] as Includes).values).toEqual(["Pod", "Node"]);
    });

    it("still rejects a kind that no widget on a multi-widget dashboard renders", async () => {
      setDashboardWidgets([
        DashboardComponentType.KubernetesPodList,
        DashboardComponentType.KubernetesNodeList,
      ]);

      await callRoute({
        resourceType: "kubernetes-resource",
        body: {
          query: {
            kind: "Namespace",
          },
        },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(KubernetesResourceService.findBy).not.toHaveBeenCalled();
    });

    it("does not add a kind filter to models that have no kinds", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({
        resourceType: "log",
        body: {
          query: {
            kind: "Volume",
          },
        },
      });

      const query: JSONObject = getFindByArgs(LogService)[
        "query"
      ] as JSONObject;

      expect(Object.keys(query)).not.toContain("kind");
    });
  });

  describe("fixed select", () => {
    it("serves exactly the columns the widget renders, whatever the client asks for", async () => {
      for (const resourceCase of RESOURCE_CASES) {
        jest.clearAllMocks();
        setDashboardWidgets([resourceCase.componentType]);

        await callRoute({
          resourceType: resourceCase.resourceType,
          body: {
            select: {
              [resourceCase.nonSelectColumn]: true,
              password: true,
            },
          },
        });

        const select: JSONObject = getFindByArgs(resourceCase.service)[
          "select"
        ] as JSONObject;

        expect(Object.keys(select).sort()).toEqual(
          [...resourceCase.selectKeys].sort(),
        );
        expect(select[resourceCase.selectColumn]).toBe(true);
        expect(Object.keys(select)).not.toContain("password");
      }
    });

    it("never exposes a log column the log stream widget does not render", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({ resourceType: "log" });

      const select: JSONObject = getFindByArgs(LogService)[
        "select"
      ] as JSONObject;

      expect(select).toEqual({
        time: true,
        severityText: true,
        body: true,
        primaryEntityId: true,
        traceId: true,
        spanId: true,
        attributes: true,
      });
    });
  });

  describe("sort allowlist", () => {
    it("keeps a sort on a rendered column and normalizes the order", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({
        resourceType: "log",
        body: {
          sort: {
            time: "DESC",
          },
        },
      });

      expect(getFindByArgs(LogService)["sort"]).toEqual({
        time: SortOrder.Descending,
      });
    });

    it("accepts a lower-case sort order", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({
        resourceType: "log",
        body: {
          sort: {
            time: "desc",
          },
        },
      });

      expect(getFindByArgs(LogService)["sort"]).toEqual({
        time: SortOrder.Descending,
      });
    });

    it("falls back to ascending for an unrecognised sort order", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({
        resourceType: "log",
        body: {
          sort: {
            time: { $gt: 1 },
          },
        },
      });

      expect(getFindByArgs(LogService)["sort"]).toEqual({
        time: SortOrder.Ascending,
      });
    });

    it("drops a sort on a column the viewer cannot see", async () => {
      for (const resourceCase of RESOURCE_CASES) {
        jest.clearAllMocks();
        setDashboardWidgets([resourceCase.componentType]);

        await callRoute({
          resourceType: resourceCase.resourceType,
          body: {
            sort: {
              [resourceCase.nonSelectColumn]: "DESC",
              [resourceCase.selectColumn]: "DESC",
            },
          },
        });

        expect(getFindByArgs(resourceCase.service)["sort"]).toEqual({
          [resourceCase.selectColumn]: SortOrder.Descending,
        });
      }
    });

    it("drops a sort on a related column that is only partially selected", async () => {
      setDashboardWidgets([DashboardComponentType.IncidentList]);

      await callRoute({
        resourceType: "incident",
        body: {
          sort: {
            currentIncidentState: "DESC",
          },
        },
      });

      expect(getFindByArgs(IncidentService)["sort"]).toEqual({});
    });

    it("ignores a sort that is not an object", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({
        resourceType: "log",
        body: { sort: ["time"] as unknown as JSONObject },
      });

      expect(getFindByArgs(LogService)["sort"]).toEqual({});
    });
  });

  describe("pagination", () => {
    it("defaults to the dashboard resource limit", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({ resourceType: "log" });

      const findByArgs: JSONObject = getFindByArgs(LogService);

      expect(findByArgs["limit"]).toBe(100);
      expect(findByArgs["skip"]).toBe(0);
    });

    it("clamps an oversized limit to the per-project maximum", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({
        resourceType: "log",
        query: { limit: "10000000" },
      });

      expect(getFindByArgs(LogService)["limit"]).toBe(LIMIT_PER_PROJECT);
    });

    it("falls back to the default for a nonsensical limit or skip", async () => {
      const cases: Array<{ limit: string; skip: string }> = [
        { limit: "-5", skip: "-5" },
        { limit: "0", skip: "not-a-number" },
        { limit: "not-a-number", skip: "0" },
      ];

      for (const testCase of cases) {
        jest.clearAllMocks();
        setDashboardWidgets([DashboardComponentType.LogStream]);

        await callRoute({
          resourceType: "log",
          query: { limit: testCase.limit, skip: testCase.skip },
        });

        const findByArgs: JSONObject = getFindByArgs(LogService);

        expect(findByArgs["limit"]).toBe(100);
        expect(findByArgs["skip"]).toBe(0);
      }
    });

    it("honours a sensible limit and skip", async () => {
      setDashboardWidgets([DashboardComponentType.LogStream]);

      await callRoute({
        resourceType: "log",
        query: { limit: "25", skip: "50" },
      });

      const findByArgs: JSONObject = getFindByArgs(LogService);

      expect(findByArgs["limit"]).toBe(25);
      expect(findByArgs["skip"]).toBe(50);
    });
  });
});
