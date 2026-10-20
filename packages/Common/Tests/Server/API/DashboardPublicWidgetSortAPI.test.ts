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
  PublicDashboardResourceListPolicyResult,
} from "../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DASHBOARD_WIDGET_SORT_MAX_LENGTH,
  DashboardWidgetSortDirection,
} from "../../../Types/Dashboard/DashboardWidgetSort";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DashboardWidgetListSortColumn,
  KUBERNETES_POD_PHASE_RANKS,
  getDashboardWidgetListSort,
  getDashboardWidgetSortColumns,
  getDashboardWidgetSortSpec,
  withDashboardWidgetListSortSelect,
} from "../../../Utils/Dashboard/DashboardWidgetSorts";
import { mockRouter } from "./Helpers";
import { mockProjectStates } from "../TestingUtils/Services/ProjectStatesHelper";
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

/*
 * A public dashboard's list widgets sorted by a viewer (issue #5082).
 *
 * The route reads a list for an anonymous viewer, so the request may name a
 * sort only as a column and a direction (`widgetSort`), and only one of the
 * stored widget's own sortable columns; anything else - another column,
 * another shape, a database order in the request's `sort` - is ignored and
 * the widget's own sort decides. The database order is always built on the
 * server from the registry (DashboardWidgetSorts), and a status written as a
 * word is read rank by rank, every read kept to the dashboard's project.
 */

const RESOURCE_LIST_ROUTE: string =
  "/dashboard/resource-list/:dashboardId/:resourceType";

type ListService = {
  findBy: (findBy: never) => Promise<Array<unknown>>;
};

const ASC: DashboardWidgetSortDirection = DashboardWidgetSortDirection.Ascending;
const DESC: DashboardWidgetSortDirection =
  DashboardWidgetSortDirection.Descending;

// Every public list widget the sort registry orders, and how it is read.
const SORTED_WIDGETS: Array<{
  resourceType: string;
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
  {
    resourceType: "monitor",
    componentType: DashboardComponentType.MonitorList,
    service: MonitorService,
  },
  {
    resourceType: "host",
    componentType: DashboardComponentType.HostList,
    service: HostService,
  },
  ...[
    DashboardComponentType.KubernetesPodList,
    DashboardComponentType.KubernetesNodeList,
    DashboardComponentType.KubernetesNamespaceList,
    DashboardComponentType.KubernetesDeploymentList,
    DashboardComponentType.KubernetesStatefulSetList,
    DashboardComponentType.KubernetesDaemonSetList,
    DashboardComponentType.KubernetesJobList,
    DashboardComponentType.KubernetesCronJobList,
  ].map((componentType: DashboardComponentType) => {
    return {
      resourceType: "kubernetes-resource",
      componentType,
      service: KubernetesResourceService as ListService,
    };
  }),
  {
    resourceType: "docker-host",
    componentType: DashboardComponentType.DockerHostList,
    service: DockerHostService,
  },
  {
    resourceType: "docker-container",
    componentType: DashboardComponentType.DockerContainerList,
    service: DockerResourceService,
  },
  {
    resourceType: "docker-image",
    componentType: DashboardComponentType.DockerImageList,
    service: DockerResourceService,
  },
  {
    resourceType: "docker-network",
    componentType: DashboardComponentType.DockerNetworkList,
    service: DockerResourceService,
  },
  {
    resourceType: "docker-volume",
    componentType: DashboardComponentType.DockerVolumeList,
    service: DockerResourceService,
  },
  {
    resourceType: "podman-host",
    componentType: DashboardComponentType.PodmanHostList,
    service: PodmanHostService,
  },
  {
    resourceType: "podman-container",
    componentType: DashboardComponentType.PodmanContainerList,
    service: PodmanResourceService,
  },
  {
    resourceType: "podman-image",
    componentType: DashboardComponentType.PodmanImageList,
    service: PodmanResourceService,
  },
  {
    resourceType: "podman-network",
    componentType: DashboardComponentType.PodmanNetworkList,
    service: PodmanResourceService,
  },
  {
    resourceType: "podman-volume",
    componentType: DashboardComponentType.PodmanVolumeList,
    service: PodmanResourceService,
  },
  {
    resourceType: "proxmox-resource",
    componentType: DashboardComponentType.ProxmoxNodeList,
    service: ProxmoxResourceService,
  },
  {
    resourceType: "proxmox-resource",
    componentType: DashboardComponentType.ProxmoxGuestList,
    service: ProxmoxResourceService,
  },
  {
    resourceType: "vmware-resource",
    componentType: DashboardComponentType.VMwareHostList,
    service: VMwareResourceService,
  },
  {
    resourceType: "vmware-resource",
    componentType: DashboardComponentType.VMwareVirtualMachineList,
    service: VMwareResourceService,
  },
  {
    resourceType: "ceph-resource",
    componentType: DashboardComponentType.CephOsdList,
    service: CephResourceService,
  },
  {
    resourceType: "ceph-resource",
    componentType: DashboardComponentType.CephPoolList,
    service: CephResourceService,
  },
  {
    resourceType: "storage-array-resource",
    componentType: DashboardComponentType.StorageArrayVolumeList,
    service: StorageArrayResourceService,
  },
  {
    resourceType: "storage-array-resource",
    componentType: DashboardComponentType.StorageArrayHardwareList,
    service: StorageArrayResourceService,
  },
  {
    resourceType: "docker-swarm-resource",
    componentType: DashboardComponentType.DockerSwarmNodeList,
    service: DockerSwarmResourceService,
  },
  {
    resourceType: "docker-swarm-resource",
    componentType: DashboardComponentType.DockerSwarmServiceList,
    service: DockerSwarmResourceService,
  },
  {
    resourceType: "span",
    componentType: DashboardComponentType.TraceList,
    service: SpanService,
  },
  {
    resourceType: "slo-list",
    componentType: DashboardComponentType.SloList,
    service: ServiceLevelObjectiveService,
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

describe("a public dashboard's list widgets sorted by a viewer", () => {
  let dashboardId: ObjectID;
  let projectId: ObjectID;
  let dashboard: Dashboard;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new DashboardAPI();
  });

  function buildWidget(
    componentType: DashboardComponentType,
    argumentsObject: JSONObject = {},
  ): { widget: JSONObject; componentId: ObjectID } {
    const componentId: ObjectID = ObjectID.generate();

    return {
      componentId,
      widget: {
        _type: "DashboardComponent",
        componentId: componentId as unknown as JSONValue,
        componentType,
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 12,
        heightInDashboardUnits: 6,
        minWidthInDashboardUnits: 1,
        minHeightInDashboardUnits: 1,
        arguments: argumentsObject,
      },
    };
  }

  function showOnly(widget: JSONObject): void {
    dashboard.dashboardViewConfig = {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: [widget],
    } as unknown as DashboardViewConfig;
  }

  function telemetryQuery(resourceType: string): JSONObject {
    if (resourceType !== "span") {
      return {};
    }

    return {
      startTime: new InBetween<Date>(
        new Date("2026-10-20T10:00:00.000Z"),
        new Date("2026-10-20T11:00:00.000Z"),
      ).toJSON(),
    };
  }

  async function callRoute(data: {
    resourceType: string;
    body: JSONObject;
  }): Promise<void> {
    const request: ExpressRequest = {
      params: {
        dashboardId: dashboardId.toString(),
        resourceType: data.resourceType,
      },
      body: data.body,
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", RESOURCE_LIST_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  }

  function getReads(service: ListService): Array<JSONObject> {
    return ((service.findBy as jest.Mock).mock.calls as Array<Array<unknown>>).map(
      (call: Array<unknown>) => {
        return call[0] as JSONObject;
      },
    );
  }

  // Lists one widget, as a viewer asks for it, and returns its reads.
  async function listWidget(data: {
    resourceType: string;
    componentType: DashboardComponentType;
    service: ListService;
    argumentsObject?: JSONObject;
    widgetSort?: unknown;
    extraBody?: JSONObject;
  }): Promise<Array<JSONObject>> {
    jest.clearAllMocks();
    const { widget, componentId } = buildWidget(
      data.componentType,
      data.argumentsObject || {},
    );
    showOnly(widget);

    await callRoute({
      resourceType: data.resourceType,
      body: {
        componentId: componentId.toString(),
        query: telemetryQuery(data.resourceType),
        ...(data.widgetSort !== undefined
          ? { widgetSort: data.widgetSort as JSONValue }
          : {}),
        ...(data.extraBody || {}),
      },
    });

    expect(nextFunction).not.toHaveBeenCalled();
    return getReads(data.service);
  }

  beforeEach(() => {
    jest.clearAllMocks();

    dashboardId = ObjectID.generate();
    projectId = ObjectID.generate();
    dashboard = new Dashboard();
    dashboard.id = dashboardId;
    dashboard.projectId = projectId;
    dashboard.isPublicDashboard = true;
    dashboard.enableMasterPassword = false;

    jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);
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

  describe.each(SORTED_WIDGETS)(
    "$componentType",
    (entry: {
      resourceType: string;
      componentType: DashboardComponentType;
      service: ListService;
    }) => {
      it("lists in the order it always had when the viewer picked none", async () => {
        const reads: Array<JSONObject> = await listWidget(entry);

        expect(reads).toHaveLength(1);
        expect(JSON.stringify(reads[0]!["sort"])).toBe(
          JSON.stringify(getDashboardWidgetListSort(entry.componentType, null)),
        );
      });

      it("orders the list by each of the widget's own columns, both ways, built on the server", async () => {
        for (const column of getDashboardWidgetSortColumns(entry.componentType)) {
          for (const direction of [ASC, DESC]) {
            const reads: Array<JSONObject> = await listWidget({
              ...entry,
              widgetSort: `${column.key}:${direction}`,
            });

            expect(reads.length).toBeGreaterThan(0);

            if (!column.ranks) {
              expect(reads).toHaveLength(1);
              expect(JSON.stringify(reads[0]!["sort"])).toBe(
                JSON.stringify(
                  getDashboardWidgetListSort(entry.componentType, {
                    column: column.key,
                    direction,
                  }),
                ),
              );
            }

            for (const read of reads) {
              // Every read, every rank, is kept to the dashboard's project.
              expect((read["query"] as JSONObject)["projectId"]).toBe(projectId);
              expect(read["skip"]).toBe(0);
            }
          }
        }
      });

      it("ignores a sort the widget cannot be sorted by: its own order decides", async () => {
        const defaultSort: string = JSON.stringify(
          getDashboardWidgetListSort(entry.componentType, null),
        );

        for (const widgetSort of [
          "notAColumn:desc",
          "name:sideways",
          "name",
          ":desc",
          "",
          5,
          true,
          null,
          ["name", "desc"],
          { column: "name", direction: "desc" },
          { password: SortOrder.Ascending },
          `${"x".repeat(DASHBOARD_WIDGET_SORT_MAX_LENGTH)}:asc`,
        ]) {
          const reads: Array<JSONObject> = await listWidget({
            ...entry,
            widgetSort,
          });

          expect(reads).toHaveLength(1);
          expect(JSON.stringify(reads[0]!["sort"])).toBe(defaultSort);
        }
      });

      it("never takes a database order from the request", async () => {
        const reads: Array<JSONObject> = await listWidget({
          ...entry,
          extraBody: {
            sort: { password: SortOrder.Ascending, _id: SortOrder.Descending },
          },
        });

        expect(JSON.stringify(reads[0]!["sort"])).toBe(
          JSON.stringify(getDashboardWidgetListSort(entry.componentType, null)),
        );
      });

      it("selects what its order reads, the same for every sort", async () => {
        const spec: { columns: Array<DashboardWidgetListSortColumn> } | null =
          getDashboardWidgetSortSpec(entry.componentType);
        const firstColumn: DashboardWidgetListSortColumn = spec!.columns[0]!;

        const unsorted: Array<JSONObject> = await listWidget(entry);
        const sorted: Array<JSONObject> = await listWidget({
          ...entry,
          widgetSort: `${firstColumn.key}:desc`,
        });

        const { widget } = buildWidget(entry.componentType);
        const policy: PublicDashboardResourceListPolicyResult =
          PublicDashboardResourceListPolicy.build({
            widget,
            dashboardViewConfig: {
              components: [widget],
            },
            requestedVariables: [],
            requestedQuery: telemetryQuery(entry.resourceType),
          });

        expect(unsorted[0]!["select"]).toEqual(policy.select);
        expect(sorted[0]!["select"]).toEqual(policy.select);
        expect(policy.select).toEqual(
          withDashboardWidgetListSortSelect(entry.componentType, policy.select),
        );
      });
    },
  );

  it("a monitor list sorted worst first reads the status's place in the project's list", async () => {
    const reads: Array<JSONObject> = await listWidget({
      resourceType: "monitor",
      componentType: DashboardComponentType.MonitorList,
      service: MonitorService,
      widgetSort: "status:desc",
    });

    expect(reads[0]!["sort"]).toEqual({
      currentMonitorStatus: {
        priority: { direction: SortOrder.Descending, nulls: "LAST" },
      },
      name: SortOrder.Ascending,
    });
    expect(reads[0]!["select"]).toEqual({
      _id: true,
      name: true,
      monitorType: true,
      currentMonitorStatus: { name: true, color: true, priority: true },
    });
  });

  it("an incident list sorted by severity, worst first, by the project's order", async () => {
    const reads: Array<JSONObject> = await listWidget({
      resourceType: "incident",
      componentType: DashboardComponentType.IncidentList,
      service: IncidentService,
      widgetSort: "severity:desc",
    });

    expect(reads[0]!["sort"]).toEqual({
      incidentSeverity: { order: SortOrder.Ascending },
      createdAt: SortOrder.Descending,
    });
  });

  it("the widget's own sort orders the list when the viewer picked none", async () => {
    const reads: Array<JSONObject> = await listWidget({
      resourceType: "monitor",
      componentType: DashboardComponentType.MonitorList,
      service: MonitorService,
      argumentsObject: { sort: "status:desc" },
    });

    expect(reads[0]!["sort"]).toEqual(
      getDashboardWidgetListSort(DashboardComponentType.MonitorList, {
        column: "status",
        direction: DESC,
      }),
    );
  });

  it("the viewer's pick beats the widget's own sort", async () => {
    const reads: Array<JSONObject> = await listWidget({
      resourceType: "monitor",
      componentType: DashboardComponentType.MonitorList,
      service: MonitorService,
      argumentsObject: { sort: "status:desc" },
      widgetSort: "type:asc",
    });

    expect(reads[0]!["sort"]).toEqual({
      monitorType: SortOrder.Ascending,
      name: SortOrder.Ascending,
    });
  });

  it("a pick the widget cannot be sorted by falls back to the widget's own sort, not to the built-in one", async () => {
    const reads: Array<JSONObject> = await listWidget({
      resourceType: "monitor",
      componentType: DashboardComponentType.MonitorList,
      service: MonitorService,
      argumentsObject: { sort: "status:desc" },
      // A pod's column, asked of a monitor list.
      widgetSort: "phase:desc",
    });

    expect(reads[0]!["sort"]).toEqual(
      getDashboardWidgetListSort(DashboardComponentType.MonitorList, {
        column: "status",
        direction: DESC,
      }),
    );
  });

  it("a widget's own sort that names no column of its kind is read as none", async () => {
    const reads: Array<JSONObject> = await listWidget({
      resourceType: "monitor",
      componentType: DashboardComponentType.MonitorList,
      service: MonitorService,
      argumentsObject: { sort: "severity:desc" },
    });

    expect(reads[0]!["sort"]).toEqual({ name: SortOrder.Ascending });
  });

  it("a pod list sorted worst phase first reads rank by rank, each read the widget's own query", async () => {
    (KubernetesResourceService.findBy as unknown as jest.Mock).mockResolvedValue(
      [],
    );

    const reads: Array<JSONObject> = await listWidget({
      resourceType: "kubernetes-resource",
      componentType: DashboardComponentType.KubernetesPodList,
      service: KubernetesResourceService,
      argumentsObject: { maxRows: 7, namespaces: "web, jobs" },
      widgetSort: "phase:desc",
    });

    expect(
      reads.map((read: JSONObject) => {
        const phase: unknown = (read["query"] as JSONObject)["phase"];

        if (phase instanceof Includes) {
          return phase.values;
        }

        if (phase instanceof IncludesNone) {
          return { notIn: phase.values };
        }

        return phase instanceof IsNull ? "none" : phase;
      }),
    ).toEqual([
      ["Failed"],
      ["Unknown"],
      ["Pending"],
      ["Running", "Succeeded"],
      { notIn: KUBERNETES_POD_PHASE_RANKS.flat() },
      "none",
    ]);

    for (const read of reads) {
      const query: JSONObject = read["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect(query["kind"]).toBe("Pod");
      expect((query["namespaceKey"] as Includes).values).toEqual([
        "web",
        "jobs",
      ]);
      expect(read["sort"]).toEqual({
        namespaceKey: SortOrder.Ascending,
        name: SortOrder.Ascending,
      });
      // Nothing came back, so each rank was asked for the whole list.
      expect(read["limit"]).toBe(7);
    }
  });

  it("stops reading ranks once the list is full, asking each for the rows still wanted", async () => {
    let call: number = 0;

    (KubernetesResourceService.findBy as unknown as jest.Mock).mockImplementation(
      async (findBy: unknown): Promise<Array<unknown>> => {
        call++;
        const limit: number = (findBy as JSONObject)["limit"] as number;
        // Two failed pods, then a full page of unknown ones.
        return Array.from({ length: Math.min(limit, call === 1 ? 2 : 10) }).map(
          (_: unknown, index: number) => {
            return { id: `${call}-${index}` };
          },
        );
      },
    );

    const reads: Array<JSONObject> = await listWidget({
      resourceType: "kubernetes-resource",
      componentType: DashboardComponentType.KubernetesPodList,
      service: KubernetesResourceService,
      argumentsObject: { maxRows: 5 },
      widgetSort: "phase:desc",
    });

    expect(
      reads.map((read: JSONObject) => {
        return read["limit"];
      }),
    ).toEqual([5, 3]);
  });

  it("widgets the registry does not order keep their own order and ignore a viewer's sort", async () => {
    for (const routeCase of [
      {
        resourceType: "network-site",
        componentType: DashboardComponentType.NetworkMap,
        service: NetworkSiteService as ListService,
        sort: { name: SortOrder.Ascending },
        argumentsObject: {},
      },
      {
        resourceType: "slo",
        componentType: DashboardComponentType.Slo,
        service: ServiceLevelObjectiveService as ListService,
        sort: { name: SortOrder.Ascending },
        argumentsObject: {
          serviceLevelObjectiveId: ObjectID.generate().toString(),
        },
      },
    ]) {
      const reads: Array<JSONObject> = await listWidget({
        ...routeCase,
        widgetSort: "name:desc",
      });

      expect(reads).toHaveLength(1);
      expect(reads[0]!["sort"]).toEqual(routeCase.sort);
    }
  });

  it("the policy names the order it read with, or none for a widget it does not sort", () => {
    const monitor: JSONObject = buildWidget(DashboardComponentType.MonitorList, {
      sort: "type:desc",
    }).widget;

    expect(
      PublicDashboardResourceListPolicy.build({
        widget: monitor,
        dashboardViewConfig: { components: [monitor] },
        requestedVariables: [],
        requestedQuery: {},
      }).sortChoice,
    ).toEqual({ column: "type", direction: DESC });

    expect(
      PublicDashboardResourceListPolicy.build({
        widget: monitor,
        dashboardViewConfig: { components: [monitor] },
        requestedVariables: [],
        requestedQuery: {},
        requestedSort: "status:asc",
      }).sortChoice,
    ).toEqual({ column: "status", direction: ASC });

    const map: JSONObject = buildWidget(DashboardComponentType.NetworkMap)
      .widget;

    expect(
      PublicDashboardResourceListPolicy.build({
        widget: map,
        dashboardViewConfig: { components: [map] },
        requestedVariables: [],
        requestedQuery: {},
        requestedSort: "name:desc",
      }).sortChoice,
    ).toBeNull();
  });
});
