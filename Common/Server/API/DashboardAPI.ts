import UserMiddleware from "../Middleware/UserAuthorization";
import DashboardService, {
  Service as DashboardServiceType,
} from "../Services/DashboardService";
import DashboardDomainService from "../Services/DashboardDomainService";
import CookieUtil from "../Utils/Cookie";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import Dashboard from "../../Models/DatabaseModels/Dashboard";
import DashboardDomain from "../../Models/DatabaseModels/DashboardDomain";
import { DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE } from "../../Types/Dashboard/MasterPassword";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import JSONFunctions from "../../Types/JSONFunctions";
import TelemetryAttributeService from "../Services/TelemetryAttributeService";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import { JSONObject } from "../../Types/JSON";
import AggregateBy from "../Types/AnalyticsDatabase/AggregateBy";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Metric from "../../Models/AnalyticsModels/Metric";
import MetricType from "../../Models/DatabaseModels/MetricType";
import MetricService from "../Services/MetricService";
import MetricTypeService from "../Services/MetricTypeService";
import PositiveNumber from "../../Types/PositiveNumber";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsDataModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Incident from "../../Models/DatabaseModels/Incident";
import Alert from "../../Models/DatabaseModels/Alert";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Host from "../../Models/DatabaseModels/Host";
import KubernetesResource from "../../Models/DatabaseModels/KubernetesResource";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import DockerResource from "../../Models/DatabaseModels/DockerResource";
import PodmanHost from "../../Models/DatabaseModels/PodmanHost";
import PodmanResource from "../../Models/DatabaseModels/PodmanResource";
import ProxmoxResource from "../../Models/DatabaseModels/ProxmoxResource";
import CephResource from "../../Models/DatabaseModels/CephResource";
import DockerSwarmResource from "../../Models/DatabaseModels/DockerSwarmResource";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import Span from "../../Models/AnalyticsModels/Span";
import Log from "../../Models/AnalyticsModels/Log";
import IncidentService from "../Services/IncidentService";
import AlertService from "../Services/AlertService";
import MonitorService from "../Services/MonitorService";
import HostService from "../Services/HostService";
import KubernetesResourceService from "../Services/KubernetesResourceService";
import DockerHostService from "../Services/DockerHostService";
import DockerResourceService from "../Services/DockerResourceService";
import PodmanHostService from "../Services/PodmanHostService";
import PodmanResourceService from "../Services/PodmanResourceService";
import ProxmoxResourceService from "../Services/ProxmoxResourceService";
import CephResourceService from "../Services/CephResourceService";
import DockerSwarmResourceService from "../Services/DockerSwarmResourceService";
import NetworkSiteService from "../Services/NetworkSiteService";
import SpanService from "../Services/SpanService";
import LogService from "../Services/LogService";
import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../Types/Dashboard/DashboardVariable";
import Includes from "../../Types/BaseDatabase/Includes";

/*
 * Registry of the non-metric widgets a public dashboard may render.
 *
 * Nothing on this endpoint is taken from the client except a narrow set of
 * filter values:
 *
 * - `select` is the FIXED set of columns the corresponding widget displays,
 *   so an anonymous viewer can only ever read these columns.
 * - `widgets` lists the dashboard widgets that render this resource, mapped
 *   to the `kind` each one shows (null when the model is not partitioned by
 *   kind). The dashboard must actually contain one of these widgets before
 *   the endpoint will serve the resource at all, and the query is pinned to
 *   the kinds those widgets render. Adding a widget to a public dashboard is
 *   therefore the owner's explicit — and only — opt-in to exposing this data.
 * - `allowedQueryKeys` is the set of columns the widget legitimately filters
 *   on. Every other key in the client-supplied query is dropped, so a public
 *   viewer cannot turn the endpoint into a generic query API over columns the
 *   widget never exposes.
 */
interface PublicDashboardResourceConfig {
  modelType: { new (): BaseModel | AnalyticsDataModel };
  service: {
    findBy: (findBy: any) => Promise<Array<BaseModel | AnalyticsDataModel>>;
  };
  widgets: Partial<Record<DashboardComponentType, string | null>>;
  allowedQueryKeys: Array<string>;
  select: JSONObject;
}

const DEFAULT_DASHBOARD_RESOURCE_LIMIT: number = 100;

const PUBLIC_DASHBOARD_RESOURCES: Record<
  string,
  PublicDashboardResourceConfig
> = {
  incident: {
    modelType: Incident,
    service: IncidentService,
    widgets: {
      [DashboardComponentType.IncidentList]: null,
    },
    allowedQueryKeys: [
      "currentIncidentState",
      "currentIncidentStateId",
      "incidentSeverityId",
      "monitors",
      "labels",
    ],
    select: {
      _id: true,
      title: true,
      createdAt: true,
      currentIncidentState: { name: true, color: true },
      incidentSeverity: { name: true, color: true },
    },
  },
  alert: {
    modelType: Alert,
    service: AlertService,
    widgets: {
      [DashboardComponentType.AlertList]: null,
    },
    allowedQueryKeys: [
      "currentAlertState",
      "currentAlertStateId",
      "alertSeverityId",
      "monitorId",
      "labels",
    ],
    select: {
      _id: true,
      title: true,
      createdAt: true,
      currentAlertState: { name: true, color: true },
      alertSeverity: { name: true, color: true },
    },
  },
  monitor: {
    modelType: Monitor,
    service: MonitorService,
    widgets: {
      [DashboardComponentType.MonitorList]: null,
    },
    allowedQueryKeys: [
      "currentMonitorStatus",
      "currentMonitorStatusId",
      "monitorType",
      "labels",
    ],
    select: {
      _id: true,
      name: true,
      monitorType: true,
      currentMonitorStatus: { name: true, color: true },
    },
  },
  "network-site": {
    modelType: NetworkSite,
    service: NetworkSiteService,
    widgets: {
      [DashboardComponentType.NetworkMap]: null,
    },
    /*
     * The map filters by site type and by whether the rolled-up status is
     * operational — nothing else. Notably NOT `parentSiteId` or
     * `materializedPath`: the widget draws a flat set of pins rather than
     * walking a hierarchy, so exposing the tree shape here would hand an
     * anonymous viewer a structure the map never shows them.
     */
    allowedQueryKeys: [
      "networkSiteTypeId",
      "currentMonitorStatus",
      "currentMonitorStatusId",
    ],
    select: {
      _id: true,
      name: true,
      /*
       * The type NAME comes from the networkSiteType relation. NetworkSite
       * .siteType is the deprecated pre-lookup-table string and is dropped
       * in a follow-up PR, so it must not be read from new code.
       */
      networkSiteType: { name: true },
      latitude: true,
      longitude: true,
      currentMonitorStatus: {
        name: true,
        color: true,
        priority: true,
        isOperationalState: true,
      },
    },
  },
  host: {
    modelType: Host,
    service: HostService,
    widgets: {
      [DashboardComponentType.HostList]: null,
    },
    allowedQueryKeys: [
      "name",
      "hostIdentifier",
      "otelCollectorStatus",
      "osType",
    ],
    select: {
      _id: true,
      name: true,
      hostIdentifier: true,
      otelCollectorStatus: true,
      osType: true,
      osVersion: true,
      cpuCores: true,
      totalMemoryBytes: true,
      lastSeenAt: true,
    },
  },
  "kubernetes-resource": {
    modelType: KubernetesResource,
    service: KubernetesResourceService,
    widgets: {
      [DashboardComponentType.KubernetesPodList]: "Pod",
      [DashboardComponentType.KubernetesNodeList]: "Node",
      [DashboardComponentType.KubernetesNamespaceList]: "Namespace",
      [DashboardComponentType.KubernetesDeploymentList]: "Deployment",
      [DashboardComponentType.KubernetesStatefulSetList]: "StatefulSet",
      [DashboardComponentType.KubernetesDaemonSetList]: "DaemonSet",
      [DashboardComponentType.KubernetesJobList]: "Job",
      [DashboardComponentType.KubernetesCronJobList]: "CronJob",
    },
    allowedQueryKeys: [
      "kubernetesClusterId",
      "namespaceKey",
      "name",
      "phase",
      "isReady",
    ],
    select: {
      _id: true,
      name: true,
      namespaceKey: true,
      kind: true,
      phase: true,
      isReady: true,
      hasMemoryPressure: true,
      hasDiskPressure: true,
      hasPidPressure: true,
      containerCount: true,
      latestCpuPercent: true,
      latestMemoryBytes: true,
      controllerDeploymentName: true,
      controllerCronJobName: true,
      resourceCreationTimestamp: true,
      lastSeenAt: true,
      kubernetesClusterId: true,
      kubernetesCluster: { name: true },
    },
  },
  "docker-host": {
    modelType: DockerHost,
    service: DockerHostService,
    widgets: {
      [DashboardComponentType.DockerHostList]: null,
    },
    allowedQueryKeys: ["name", "otelCollectorStatus"],
    select: {
      _id: true,
      name: true,
      otelCollectorStatus: true,
      containersRunning: true,
      containersStopped: true,
      containersPaused: true,
      osType: true,
      osVersion: true,
    },
  },
  "docker-container": {
    modelType: DockerResource,
    service: DockerResourceService,
    widgets: {
      [DashboardComponentType.DockerContainerList]: "Container",
    },
    allowedQueryKeys: ["dockerHostId", "name", "imageName"],
    select: {
      _id: true,
      name: true,
      imageName: true,
      state: true,
      latestCpuPercent: true,
      latestMemoryBytes: true,
      dockerHostId: true,
      dockerHost: { name: true },
    },
  },
  "docker-image": {
    modelType: DockerResource,
    service: DockerResourceService,
    widgets: {
      [DashboardComponentType.DockerImageList]: "Image",
    },
    allowedQueryKeys: ["dockerHostId", "name"],
    select: {
      _id: true,
      name: true,
      containerId: true,
      dockerHostId: true,
      dockerHost: { name: true },
    },
  },
  "docker-network": {
    modelType: DockerResource,
    service: DockerResourceService,
    widgets: {
      [DashboardComponentType.DockerNetworkList]: "Network",
    },
    allowedQueryKeys: ["dockerHostId"],
    select: {
      _id: true,
      name: true,
      state: true,
      dockerHostId: true,
      dockerHost: { name: true },
    },
  },
  "docker-volume": {
    modelType: DockerResource,
    service: DockerResourceService,
    widgets: {
      [DashboardComponentType.DockerVolumeList]: "Volume",
    },
    allowedQueryKeys: ["dockerHostId"],
    select: {
      _id: true,
      name: true,
      state: true,
      dockerHostId: true,
      dockerHost: { name: true },
    },
  },
  "podman-host": {
    modelType: PodmanHost,
    service: PodmanHostService,
    widgets: {
      [DashboardComponentType.PodmanHostList]: null,
    },
    allowedQueryKeys: ["name", "otelCollectorStatus"],
    select: {
      _id: true,
      name: true,
      otelCollectorStatus: true,
      containersRunning: true,
      containersStopped: true,
      containersPaused: true,
      osType: true,
      osVersion: true,
    },
  },
  "podman-container": {
    modelType: PodmanResource,
    service: PodmanResourceService,
    widgets: {
      [DashboardComponentType.PodmanContainerList]: "Container",
    },
    allowedQueryKeys: ["podmanHostId", "name", "imageName"],
    select: {
      _id: true,
      name: true,
      imageName: true,
      state: true,
      latestCpuPercent: true,
      latestMemoryBytes: true,
      podmanHostId: true,
      podmanHost: { name: true },
    },
  },
  "podman-image": {
    modelType: PodmanResource,
    service: PodmanResourceService,
    widgets: {
      [DashboardComponentType.PodmanImageList]: "Image",
    },
    allowedQueryKeys: ["podmanHostId", "name"],
    select: {
      _id: true,
      name: true,
      containerId: true,
      podmanHostId: true,
      podmanHost: { name: true },
    },
  },
  "podman-network": {
    modelType: PodmanResource,
    service: PodmanResourceService,
    widgets: {
      [DashboardComponentType.PodmanNetworkList]: "Network",
    },
    allowedQueryKeys: ["podmanHostId"],
    select: {
      _id: true,
      name: true,
      state: true,
      podmanHostId: true,
      podmanHost: { name: true },
    },
  },
  "podman-volume": {
    modelType: PodmanResource,
    service: PodmanResourceService,
    widgets: {
      [DashboardComponentType.PodmanVolumeList]: "Volume",
    },
    allowedQueryKeys: ["podmanHostId"],
    select: {
      _id: true,
      name: true,
      state: true,
      podmanHostId: true,
      podmanHost: { name: true },
    },
  },
  "proxmox-resource": {
    modelType: ProxmoxResource,
    service: ProxmoxResourceService,
    widgets: {
      [DashboardComponentType.ProxmoxNodeList]: "Node",
      [DashboardComponentType.ProxmoxGuestList]: "Guest",
    },
    allowedQueryKeys: ["proxmoxClusterId", "guestType", "isUp", "name"],
    select: {
      _id: true,
      name: true,
      externalId: true,
      kind: true,
      vmid: true,
      guestType: true,
      parentNodeName: true,
      isUp: true,
      haState: true,
      latestCpuPercent: true,
      latestMemoryPercent: true,
      lastSeenAt: true,
      proxmoxClusterId: true,
      proxmoxCluster: { name: true },
    },
  },
  "ceph-resource": {
    modelType: CephResource,
    service: CephResourceService,
    widgets: {
      [DashboardComponentType.CephOsdList]: "Osd",
      [DashboardComponentType.CephPoolList]: "Pool",
    },
    allowedQueryKeys: ["cephClusterId", "isUp", "isIn", "externalId"],
    select: {
      _id: true,
      name: true,
      externalId: true,
      kind: true,
      hostname: true,
      deviceClass: true,
      isUp: true,
      isIn: true,
      statBytes: true,
      statBytesUsed: true,
      storedBytes: true,
      maxAvailBytes: true,
      objects: true,
      lastSeenAt: true,
      cephClusterId: true,
      cephCluster: { name: true },
    },
  },
  "docker-swarm-resource": {
    modelType: DockerSwarmResource,
    service: DockerSwarmResourceService,
    widgets: {
      [DashboardComponentType.DockerSwarmNodeList]: "Node",
      [DashboardComponentType.DockerSwarmServiceList]: "Service",
    },
    allowedQueryKeys: [
      "dockerSwarmClusterId",
      "role",
      "serviceMode",
      "isReady",
    ],
    select: {
      _id: true,
      name: true,
      externalId: true,
      kind: true,
      role: true,
      state: true,
      serviceMode: true,
      desiredReplicas: true,
      runningReplicas: true,
      image: true,
      isReady: true,
      latestCpuPercent: true,
      latestMemoryPercent: true,
      lastSeenAt: true,
      dockerSwarmClusterId: true,
      dockerSwarmCluster: { name: true },
    },
  },
  span: {
    modelType: Span,
    service: SpanService,
    widgets: {
      [DashboardComponentType.TraceList]: null,
    },
    allowedQueryKeys: ["startTime", "statusCode"],
    select: {
      startTime: true,
      name: true,
      statusCode: true,
      durationUnixNano: true,
      traceId: true,
      spanId: true,
      kind: true,
      primaryEntityId: true,
    },
  },
  log: {
    modelType: Log,
    service: LogService,
    widgets: {
      [DashboardComponentType.LogStream]: null,
    },
    allowedQueryKeys: ["time", "severityText", "body", "attributes"],
    select: {
      time: true,
      severityText: true,
      body: true,
      primaryEntityId: true,
      traceId: true,
      spanId: true,
      attributes: true,
    },
  },
};

type ResolveDashboardIdOrThrowFunction = (
  dashboardIdOrDomain: string,
) => Promise<ObjectID>;

/*
 * Resolve the :dashboardIdOrDomain route param to a dashboard ID. Accepts
 * either a dashboard ID (UUID) or a verified custom dashboard domain —
 * same contract as the status page overview endpoint.
 */
const resolveDashboardIdOrThrow: ResolveDashboardIdOrThrowFunction = async (
  dashboardIdOrDomain: string,
): Promise<ObjectID> => {
  if (!dashboardIdOrDomain) {
    throw new NotFoundException("Dashboard not found");
  }

  if (dashboardIdOrDomain.includes(".")) {
    const dashboardDomain: DashboardDomain | null =
      await DashboardDomainService.findOneBy({
        query: {
          fullDomain: dashboardIdOrDomain,
          domain: {
            isVerified: true,
          } as any,
        },
        select: {
          dashboardId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!dashboardDomain || !dashboardDomain.dashboardId) {
      throw new NotFoundException("Dashboard not found");
    }

    return dashboardDomain.dashboardId;
  }

  try {
    ObjectID.validateUUID(dashboardIdOrDomain);
    return new ObjectID(dashboardIdOrDomain);
  } catch (err) {
    logger.error(
      `Error converting dashboardIdOrDomain to ObjectID: ${dashboardIdOrDomain}`,
    );
    logger.error(err);
    throw new NotFoundException("Dashboard not found");
  }
};

export default class DashboardAPI extends BaseAPI<
  Dashboard,
  DashboardServiceType
> {
  public constructor() {
    super(Dashboard, DashboardService);

    // SEO endpoint - resolve dashboard by ID or domain
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/seo/:dashboardIdOrDomain`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const dashboardIdOrDomain: string = req.params[
            "dashboardIdOrDomain"
          ] as string;

          let dashboardId: ObjectID | null = null;

          if (dashboardIdOrDomain && dashboardIdOrDomain.includes(".")) {
            // This is a domain - resolve to dashboard ID
            const dashboardDomain: DashboardDomain | null =
              await DashboardDomainService.findOneBy({
                query: {
                  fullDomain: dashboardIdOrDomain,
                  domain: {
                    isVerified: true,
                  } as any,
                },
                select: {
                  dashboardId: true,
                },
                props: {
                  isRoot: true,
                },
              });

            if (!dashboardDomain || !dashboardDomain.dashboardId) {
              return Response.sendErrorResponse(
                req,
                res,
                new NotFoundException("Dashboard not found"),
              );
            }

            dashboardId = dashboardDomain.dashboardId;
          } else {
            try {
              dashboardId = new ObjectID(dashboardIdOrDomain);
            } catch (err) {
              logger.error(
                err,
                getLogAttributesFromRequest(req as OneUptimeRequest),
              );
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException("Invalid dashboard ID"),
              );
            }
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                name: true,
                description: true,
                pageTitle: true,
                pageDescription: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException("Dashboard not found"),
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            _id: dashboard._id?.toString() || "",
            title: dashboard.pageTitle || dashboard.name || "Dashboard",
            description:
              dashboard.pageDescription ||
              dashboard.description ||
              "View dashboard metrics and insights.",
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Shared handler for the public overview endpoint. Registered for both
     * POST and GET (machine-readable access for crawlers / AI agents that
     * only issue plain GET requests — discovered via llms.txt on public
     * dashboard URLs) so the authentication and authorization path can
     * never drift between the two methods. It does not read req.body.
     */
    const overviewHandler: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const dashboardId: ObjectID = await resolveDashboardIdOrThrow(
          req.params["dashboardIdOrDomain"] as string,
        );

        // Check read access (handles public check, IP whitelist, master password)
        const accessResult: {
          hasReadAccess: boolean;
          error?: NotAuthenticatedException | ForbiddenException;
        } = await DashboardService.hasReadAccess({
          dashboardId,
          req,
        });

        if (!accessResult.hasReadAccess) {
          throw (
            accessResult.error ||
            new BadDataException("Access denied to this dashboard.")
          );
        }

        const dashboard: Dashboard | null = await DashboardService.findOneById({
          id: dashboardId,
          select: {
            _id: true,
            name: true,
            description: true,
            pageTitle: true,
            pageDescription: true,
            dashboardViewConfig: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!dashboard) {
          throw new NotFoundException("Dashboard not found");
        }

        /*
         * Everything below is derived from columns the public /metadata and
         * /view-config endpoints already serve to anonymous viewers — the
         * overview only reshapes them into a single GET-able document.
         */
        return Response.sendJsonObjectResponse(req, res, {
          _id: dashboard._id?.toString() || "",
          name: dashboard.name || "Dashboard",
          description: dashboard.description || "",
          pageTitle: dashboard.pageTitle || "",
          pageDescription: dashboard.pageDescription || "",
          components: DashboardAPI.buildPublicComponentSummaries(
            dashboard.dashboardViewConfig,
          ),
          metricsUsed: Array.from(
            DashboardAPI.collectDashboardMetricNames(
              dashboard.dashboardViewConfig,
            ),
          ).sort(),
          dashboardViewConfig: dashboard.dashboardViewConfig
            ? JSONFunctions.serialize(dashboard.dashboardViewConfig as any)
            : null,
        });
      } catch (err) {
        next(err);
      }
    };

    const overviewApiPath: string = `${new this.entityType()
      .getCrudApiPath()
      ?.toString()}/overview/:dashboardIdOrDomain`;

    this.router.post(
      overviewApiPath,
      UserMiddleware.getUserMiddleware,
      overviewHandler,
    );

    /*
     * GET variant of the overview endpoint. Same middleware and same handler
     * as the POST route above — non-public dashboards are rejected for
     * unauthenticated callers exactly as they are on POST.
     */
    this.router.get(
      overviewApiPath,
      UserMiddleware.getUserMiddleware,
      overviewHandler,
    );

    // Domain resolution endpoint
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/domain`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!req.body["domain"]) {
            throw new BadDataException("domain is required in request body");
          }

          const domain: string = req.body["domain"] as string;

          const dashboardDomain: DashboardDomain | null =
            await DashboardDomainService.findOneBy({
              query: {
                fullDomain: domain,
                domain: {
                  isVerified: true,
                } as any,
              },
              select: {
                dashboardId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboardDomain) {
            throw new BadDataException("No dashboard found with this domain");
          }

          const objectId: ObjectID = dashboardDomain.dashboardId!;

          return Response.sendJsonObjectResponse(req, res, {
            dashboardId: objectId.toString(),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // Metadata endpoint - returns dashboard info for the public viewer
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/metadata/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                name: true,
                description: true,
                isPublicDashboard: true,
                enableMasterPassword: true,
                pageTitle: true,
                pageDescription: true,
                logoFile: {
                  file: true,
                  fileType: true,
                },
                faviconFile: {
                  file: true,
                  fileType: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard) {
            throw new NotFoundException("Dashboard not found");
          }

          return Response.sendJsonObjectResponse(req, res, {
            _id: dashboard._id?.toString() || "",
            name: dashboard.name || "Dashboard",
            description: dashboard.description || "",
            isPublicDashboard: dashboard.isPublicDashboard || false,
            enableMasterPassword: dashboard.enableMasterPassword || false,
            pageTitle: dashboard.pageTitle || "",
            pageDescription: dashboard.pageDescription || "",
            logoFile: DashboardAPI.getFileAsBase64JSONObject(
              dashboard.logoFile,
            ),
            faviconFile: DashboardAPI.getFileAsBase64JSONObject(
              dashboard.faviconFile,
            ),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // Public view-config endpoint - returns dashboard view config for the public viewer
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/view-config/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          // Check read access (handles public check, IP whitelist, master password)
          const accessResult: {
            hasReadAccess: boolean;
            error?: NotAuthenticatedException | ForbiddenException;
          } = await DashboardService.hasReadAccess({
            dashboardId,
            req,
          });

          if (!accessResult.hasReadAccess) {
            throw (
              accessResult.error ||
              new BadDataException("Access denied to this dashboard.")
            );
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                name: true,
                description: true,
                dashboardViewConfig: true,
                pageTitle: true,
                pageDescription: true,
                logoFile: {
                  file: true,
                  fileType: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard) {
            throw new NotFoundException("Dashboard not found");
          }

          return Response.sendJsonObjectResponse(req, res, {
            _id: dashboard._id?.toString() || "",
            name: dashboard.name || "Dashboard",
            description: dashboard.description || "",
            pageTitle: dashboard.pageTitle || "",
            pageDescription: dashboard.pageDescription || "",
            logoFile: DashboardAPI.getFileAsBase64JSONObject(
              dashboard.logoFile,
            ),
            dashboardViewConfig: dashboard.dashboardViewConfig
              ? JSONFunctions.serialize(dashboard.dashboardViewConfig as any)
              : null,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Public attribute-value lookup for dashboard variables.
     *
     * The private `/telemetry/metrics/get-attribute-values` route requires
     * a logged-in session; public dashboards have no session, so we mirror
     * the behaviour here scoped to the dashboard's owning projectId.
     * Authorization reuses DashboardService.hasReadAccess (public flag, IP
     * whitelist, master password) — never falls back to project-wide read.
     *
     * The requested attribute key is additionally allowlisted against the
     * keys this dashboard's own variables bind to. Project scoping alone is
     * not enough here: the underlying query is a SELECT DISTINCT over the
     * attribute map of every log, span, metric and exception in the project,
     * so an unrestricted key would let anyone holding a public dashboard id
     * read `user.email`, `db.statement`, `http.url`, ... out of telemetry the
     * dashboard never renders (GHSA-w332-x78m-vf3v).
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/attribute-values/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          const accessResult: {
            hasReadAccess: boolean;
            error?: NotAuthenticatedException | ForbiddenException;
          } = await DashboardService.hasReadAccess({
            dashboardId,
            req,
          });

          if (!accessResult.hasReadAccess) {
            throw (
              accessResult.error ||
              new BadDataException("Access denied to this dashboard.")
            );
          }

          const attributeKey: unknown = req.body
            ? req.body["attributeKey"]
            : undefined;

          if (typeof attributeKey !== "string" || !attributeKey.trim()) {
            throw new BadDataException("attributeKey is required.");
          }

          const telemetryTypeRaw: string | undefined =
            req.body && (req.body["telemetryType"] as string);
          let telemetryType: TelemetryType = TelemetryType.Metric;
          if (telemetryTypeRaw) {
            const match: TelemetryType | undefined = (
              Object.values(TelemetryType) as Array<string>
            ).includes(telemetryTypeRaw)
              ? (telemetryTypeRaw as TelemetryType)
              : undefined;
            if (match) {
              telemetryType = match;
            }
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                projectId: true,
                dashboardViewConfig: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard || !dashboard.projectId) {
            throw new NotFoundException("Dashboard not found");
          }

          /*
           * Only the attribute keys this dashboard's own variable dropdowns
           * offer may be read. Variable interpolation only ever substitutes
           * a variable's VALUE into a widget filter — never its key — so the
           * stored view config is an exact allowlist. A dashboard with no
           * telemetry-attribute variables has nothing to look up and is
           * refused outright.
           */
          const requestedAttributeKey: string = attributeKey.trim();

          const allowedAttributeKeys: Set<string> =
            DashboardAPI.collectDashboardVariableAttributeKeys(
              dashboard.dashboardViewConfig,
            );

          if (!allowedAttributeKeys.has(requestedAttributeKey)) {
            throw new BadDataException(
              "This attribute is not part of this dashboard.",
            );
          }

          const values: Array<string> =
            await TelemetryAttributeService.fetchAttributeValues({
              projectId: dashboard.projectId,
              telemetryType,
              attributeKey: requestedAttributeKey,
            });

          return Response.sendJsonObjectResponse(req, res, {
            values,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Public metric-type lookup for dashboard charts.
     *
     * The private `/metric-type/get-list` CRUD route requires a logged-in
     * session with Telemetry read permission; public dashboards have no
     * session, so the shared chart code used to fall through to it, 401 →
     * the global API error handler redirected the viewer to /accounts/login.
     * Mirror it here scoped to the dashboard's owning projectId.
     * Authorization reuses DashboardService.hasReadAccess (public flag, IP
     * whitelist, master password) — never falls back to project-wide read.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/metric-types/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          const accessResult: {
            hasReadAccess: boolean;
            error?: NotAuthenticatedException | ForbiddenException;
          } = await DashboardService.hasReadAccess({
            dashboardId,
            req,
          });

          if (!accessResult.hasReadAccess) {
            throw (
              accessResult.error ||
              new BadDataException("Access denied to this dashboard.")
            );
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                projectId: true,
                dashboardViewConfig: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard || !dashboard.projectId) {
            throw new NotFoundException("Dashboard not found");
          }

          /*
           * Only expose metric types the dashboard actually charts, so a
           * public viewer cannot enumerate the owning project's full metric
           * catalog.
           */
          const allowedMetricNames: Set<string> =
            DashboardAPI.collectDashboardMetricNames(
              dashboard.dashboardViewConfig,
            );

          if (allowedMetricNames.size === 0) {
            return Response.sendJsonObjectResponse(req, res, {
              metricTypes: [],
            });
          }

          const metricTypes: Array<MetricType> = await MetricTypeService.findBy(
            {
              query: {
                projectId: dashboard.projectId,
              },
              select: {
                name: true,
                unit: true,
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              sort: {
                name: SortOrder.Ascending,
              },
              props: {
                isRoot: true,
              },
            },
          );

          return Response.sendJsonObjectResponse(req, res, {
            metricTypes: metricTypes
              .filter((metricType: MetricType) => {
                return Boolean(
                  metricType.name && allowedMetricNames.has(metricType.name),
                );
              })
              .map((metricType: MetricType) => {
                return {
                  name: metricType.name || "",
                  unit: metricType.unit || "",
                };
              }),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Public metric aggregation for dashboard charts/values/gauges/tables.
     *
     * Mirrors the private `/metrics/aggregate` route (which requires a
     * logged-in session). The client-supplied projectId is IGNORED and the
     * aggregation is pinned to the dashboard's owning projectId, so a public
     * viewer can only read metrics belonging to this dashboard's project and
     * never another tenant's. Authorization reuses
     * DashboardService.hasReadAccess.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/metrics-aggregate/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          const accessResult: {
            hasReadAccess: boolean;
            error?: NotAuthenticatedException | ForbiddenException;
          } = await DashboardService.hasReadAccess({
            dashboardId,
            req,
          });

          if (!accessResult.hasReadAccess) {
            throw (
              accessResult.error ||
              new BadDataException("Access denied to this dashboard.")
            );
          }

          if (!req.body || !req.body["aggregateBy"]) {
            throw new BadDataException("aggregateBy is required.");
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                projectId: true,
                dashboardViewConfig: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard || !dashboard.projectId) {
            throw new NotFoundException("Dashboard not found");
          }

          const aggregateBy: AggregateBy<Metric> = {
            ...(JSONFunctions.deserialize(
              req.body["aggregateBy"] as JSONObject,
            ) as unknown as AggregateBy<Metric>),
            /*
             * Run as root: authorization is already enforced by hasReadAccess
             * above and the project scope is pinned below.
             */
            props: {
              isRoot: true,
            },
          };

          /*
           * Restrict aggregation to the metric names this dashboard actually
           * charts. Without this, a public viewer who knows the dashboard ID
           * could aggregate any metric in the owning project. Variable
           * interpolation only rewrites attribute filters, never the metric
           * name, so the stored view config is an exact allowlist.
           */
          const allowedMetricNames: Set<string> =
            DashboardAPI.collectDashboardMetricNames(
              dashboard.dashboardViewConfig,
            );

          /*
           * Read the query through an OWN-properties copy. JSON.parse turns a
           * literal "__proto__" member into a real own key and
           * JSONFunctions.deserialize copies it with `newVal[key] = ...`,
           * which fires Object.prototype's __proto__ setter — so a plain
           * `query["name"]` lookup walks the prototype chain and sees a name
           * that a later own-properties spread would silently drop, leaving
           * the aggregation with no metric predicate at all. The check and
           * the object that reaches the database must read the same keys.
           */
          const requestedQuery: Record<string, unknown> =
            aggregateBy.query &&
            typeof aggregateBy.query === "object" &&
            !Array.isArray(aggregateBy.query)
              ? { ...(aggregateBy.query as Record<string, unknown>) }
              : {};

          const requestedMetricName: unknown = requestedQuery["name"];

          if (
            typeof requestedMetricName !== "string" ||
            !allowedMetricNames.has(requestedMetricName)
          ) {
            throw new BadDataException(
              "This metric is not part of this dashboard.",
            );
          }

          /*
           * Pinning the metric name is not enough on its own: a grouped
           * aggregation echoes each group's key back in the result rows, so
           * `groupByAttributeKeys: ["enduser.id"]` — or the blunter
           * `groupBy: { attributes: true }`, which returns the WHOLE
           * attribute map — turns an allowlisted metric into a reader for
           * attribute values the widget never renders. Both grouping
           * dimensions are therefore allowlisted against the stored view
           * config as well; interpolation never rewrites either of them.
           */
          const allowedGroupByAttributeKeys: Set<string> =
            DashboardAPI.collectDashboardGroupByAttributeKeys(
              dashboard.dashboardViewConfig,
            );
          const requestedGroupByAttributeKeys: unknown =
            aggregateBy.groupByAttributeKeys;

          /*
           * `null` means "not grouped" here: JSONFunctions.serialize drops
           * undefined but preserves null, and both downstream sinks already
           * treat a null grouping as absent.
           */
          if (
            requestedGroupByAttributeKeys !== undefined &&
            requestedGroupByAttributeKeys !== null
          ) {
            if (!Array.isArray(requestedGroupByAttributeKeys)) {
              throw new BadDataException(
                "groupByAttributeKeys must be an array of attribute keys.",
              );
            }

            for (const requestedKey of requestedGroupByAttributeKeys) {
              if (
                typeof requestedKey !== "string" ||
                !allowedGroupByAttributeKeys.has(requestedKey)
              ) {
                throw new BadDataException(
                  "This attribute is not part of this dashboard.",
                );
              }
            }
          }

          const allowedGroupByColumns: Set<string> =
            DashboardAPI.collectDashboardGroupByColumns(
              dashboard.dashboardViewConfig,
            );
          const requestedGroupBy: unknown = aggregateBy.groupBy;

          if (requestedGroupBy !== undefined && requestedGroupBy !== null) {
            if (
              typeof requestedGroupBy !== "object" ||
              Array.isArray(requestedGroupBy)
            ) {
              throw new BadDataException("groupBy must be an object.");
            }

            for (const requestedColumn of Object.keys(requestedGroupBy)) {
              if (!allowedGroupByColumns.has(requestedColumn)) {
                throw new BadDataException(
                  "This grouping is not part of this dashboard.",
                );
              }
            }

            /*
             * Hand the SQL builder the same keys this guard validated. The
             * guard reads Object.keys but the GROUP BY builder walks the
             * object with for...in, so an inherited key would otherwise
             * reach the query without ever being checked.
             */
            aggregateBy.groupBy = {
              ...(requestedGroupBy as Record<string, unknown>),
            } as typeof aggregateBy.groupBy;
          }

          /*
           * The client never chooses what is aggregated over what: every
           * widget aggregates `value` over `time`. Left open, an anonymous
           * caller could aggregate `attributes` instead — `max(attributes)`
           * returns the whole map and the row mapper passes non-numeric
           * aggregates through untouched, handing back a full attribute map
           * per time bucket.
           */
          if (aggregateBy.aggregateColumnName !== "value") {
            throw new BadDataException("Invalid aggregateColumnName.");
          }

          if (aggregateBy.aggregationTimestampColumnName !== "time") {
            throw new BadDataException(
              "Invalid aggregationTimestampColumnName.",
            );
          }

          // Never let an anonymous caller choose an unbounded page.
          aggregateBy.limit = Math.min(
            Math.max(Number(aggregateBy.limit) || LIMIT_PER_PROJECT, 1),
            LIMIT_PER_PROJECT,
          );
          aggregateBy.skip = Math.max(Number(aggregateBy.skip) || 0, 0);

          /*
           * Security: the client does not get to choose what is filtered on a
           * public, unauthenticated endpoint. Rebuild the query from the
           * fields the dashboard's own widgets legitimately send — the
           * allowlisted metric name, the time window, and attribute filters
           * on keys those widgets already filter by — and pin the project.
           * Everything else the client sent is dropped rather than merged: a
           * foreign projectId, a filter on an arbitrary attribute key used as
           * a blind ILIKE oracle, a key smuggled in on the prototype
           * (GHSA-w332-x78m-vf3v).
           */
          const allowedFilterAttributeKeys: Set<string> =
            DashboardAPI.collectDashboardFilterAttributeKeys(
              dashboard.dashboardViewConfig,
            );

          const sanitizedAttributes: Record<string, unknown> = {};
          const requestedAttributes: unknown = requestedQuery["attributes"];

          if (
            requestedAttributes &&
            typeof requestedAttributes === "object" &&
            !Array.isArray(requestedAttributes)
          ) {
            for (const requestedAttributeKey of Object.keys(
              requestedAttributes as Record<string, unknown>,
            )) {
              if (!allowedFilterAttributeKeys.has(requestedAttributeKey)) {
                throw new BadDataException(
                  "This attribute is not part of this dashboard.",
                );
              }

              sanitizedAttributes[requestedAttributeKey] = (
                requestedAttributes as Record<string, unknown>
              )[requestedAttributeKey];
            }
          }

          aggregateBy.query = {
            name: requestedMetricName,
            ...(requestedQuery["time"] !== undefined
              ? { time: requestedQuery["time"] }
              : {}),
            ...(Object.keys(sanitizedAttributes).length > 0
              ? { attributes: sanitizedAttributes }
              : {}),
            projectId: dashboard.projectId,
          } as unknown as typeof aggregateBy.query;

          const aggregateResult: AggregatedResult =
            await MetricService.aggregateBy(aggregateBy);

          const responseBody: JSONObject = {
            ...(aggregateResult as unknown as JSONObject),
          };

          return Response.sendJsonObjectResponse(req, res, responseBody);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Public resource lists for non-metric dashboard widgets (incident /
     * alert / monitor / trace / log / kubernetes / docker / host lists).
     *
     * Each widget renders a fixed set of columns; the server pins the select
     * to exactly those columns (see PUBLIC_DASHBOARD_RESOURCES) and forces the
     * project scope to the dashboard's project, so a public viewer can only
     * read the data the widget was built to show, for this dashboard's
     * project. Authorization reuses DashboardService.hasReadAccess.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/resource-list/:dashboardId/:resourceType`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const resourceType: string = req.params["resourceType"] as string;
          const config: PublicDashboardResourceConfig | undefined =
            PUBLIC_DASHBOARD_RESOURCES[resourceType];

          if (!config) {
            throw new BadDataException(
              `Unsupported dashboard resource type: ${resourceType}`,
            );
          }

          await DashboardAPI.servePublicResourceList({ req, res, config });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/master-password/:dashboardId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!req.params["dashboardId"]) {
            throw new BadDataException("Dashboard ID not found");
          }

          const dashboardId: ObjectID = new ObjectID(
            req.params["dashboardId"] as string,
          );

          const password: unknown = req.body && req.body["password"];

          if (typeof password !== "string" || !password) {
            throw new BadDataException("Master password is required.");
          }

          const dashboard: Dashboard | null =
            await DashboardService.findOneById({
              id: dashboardId,
              select: {
                _id: true,
                projectId: true,
                enableMasterPassword: true,
                masterPassword: true,
                masterPasswordSalt: true,
                isPublicDashboard: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard) {
            throw new NotFoundException("Dashboard not found");
          }

          if (!dashboard.isPublicDashboard) {
            throw new BadDataException(
              "This dashboard is not publicly accessible.",
            );
          }

          if (!dashboard.enableMasterPassword || !dashboard.masterPassword) {
            throw new BadDataException(
              "Master password has not been configured for this dashboard.",
            );
          }

          const isMasterPasswordValid: boolean =
            await DashboardService.verifyHashedColumnValue({
              item: dashboard,
              columnName: "masterPassword",
              plainValue: password,
            });

          if (!isMasterPasswordValid) {
            throw new BadDataException(
              DASHBOARD_MASTER_PASSWORD_INVALID_MESSAGE,
            );
          }

          CookieUtil.setDashboardMasterPasswordCookie({
            expressResponse: res,
            dashboardId,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Build a compact machine-readable summary of the widgets on a dashboard
   * for the public overview endpoint. Derived entirely from the stored
   * dashboardViewConfig (already served to public viewers by /view-config) —
   * this only lifts out the human-meaningful fields (widget type, title,
   * text, metric names). The config comes straight from a JSON column, so
   * every field is read defensively.
   */
  private static buildPublicComponentSummaries(
    dashboardViewConfig: unknown,
  ): Array<JSONObject> {
    const summaries: Array<JSONObject> = [];

    const components: unknown =
      dashboardViewConfig && typeof dashboardViewConfig === "object"
        ? (dashboardViewConfig as Record<string, unknown>)["components"]
        : undefined;

    if (!Array.isArray(components)) {
      return summaries;
    }

    for (const component of components) {
      if (!component || typeof component !== "object") {
        continue;
      }

      const componentObject: Record<string, unknown> = component as Record<
        string,
        unknown
      >;

      const argumentsObject: Record<string, unknown> =
        componentObject["arguments"] &&
        typeof componentObject["arguments"] === "object"
          ? (componentObject["arguments"] as Record<string, unknown>)
          : {};

      const getStringArgument: (key: string) => string | null = (
        key: string,
      ): string | null => {
        const value: unknown = argumentsObject[key];
        return typeof value === "string" && value.trim().length > 0
          ? value
          : null;
      };

      summaries.push({
        componentType:
          typeof componentObject["componentType"] === "string"
            ? componentObject["componentType"]
            : "",
        title: getStringArgument("chartTitle") || getStringArgument("title"),
        description: getStringArgument("chartDescription"),
        text: getStringArgument("text"),
        metricNames: Array.from(
          DashboardAPI.collectDashboardMetricNames(component),
        ).sort(),
      });
    }

    return summaries;
  }

  /*
   * Walk a stored dashboard view config and collect every metric name it
   * references (chart/value/gauge/table widgets all carry their metric in a
   * `metricName` field somewhere under their query config). Used to build an
   * allowlist for the public metric endpoints so an anonymous viewer can only
   * read the metrics this dashboard was built to show.
   */
  private static collectDashboardMetricNames(
    dashboardViewConfig: unknown,
  ): Set<string> {
    const metricNames: Set<string> = new Set<string>();

    const walk: (node: unknown) => void = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }

      const obj: Record<string, unknown> = node as Record<string, unknown>;

      const metricName: unknown = obj["metricName"];
      if (typeof metricName === "string" && metricName.trim().length > 0) {
        metricNames.add(metricName);
      }

      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    };

    walk(dashboardViewConfig);

    return metricNames;
  }

  /*
   * Walk a stored dashboard view config and collect every OpenTelemetry
   * attribute key its variables bind to (a `Telemetry Attribute` variable
   * carries the key its dropdown lists values for). Used as the allowlist
   * for the public attribute-values endpoint, so an anonymous viewer can
   * only read the values behind this dashboard's own variable pickers and
   * not every attribute in the owning project.
   */
  private static collectDashboardVariableAttributeKeys(
    dashboardViewConfig: unknown,
  ): Set<string> {
    const attributeKeys: Set<string> = new Set<string>();

    const walk: (node: unknown) => void = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }

      const obj: Record<string, unknown> = node as Record<string, unknown>;

      if (obj["type"] === DashboardVariableType.TelemetryAttribute) {
        const attributeKey: unknown = obj["attributeKey"];

        if (
          typeof attributeKey === "string" &&
          attributeKey.trim().length > 0
        ) {
          attributeKeys.add(attributeKey.trim());
        }
      }

      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    };

    walk(dashboardViewConfig);

    return attributeKeys;
  }

  /*
   * Walk a stored dashboard view config and collect every OpenTelemetry
   * attribute key its metric widgets group by — `groupByAttributeKeys`
   * (chart / value / gauge / legacy table queries) and `groupByAttributes`
   * (the table widget's richer per-key form). Used as the allowlist for the
   * public metric-aggregate endpoint, whose grouped results echo each
   * group's key values back to the caller.
   */
  private static collectDashboardGroupByAttributeKeys(
    dashboardViewConfig: unknown,
  ): Set<string> {
    const attributeKeys: Set<string> = new Set<string>();

    const addKey: (value: unknown) => void = (value: unknown): void => {
      if (typeof value === "string" && value.length > 0) {
        attributeKeys.add(value);
      }
    };

    const walk: (node: unknown) => void = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }

      const obj: Record<string, unknown> = node as Record<string, unknown>;

      const groupByAttributeKeys: unknown = obj["groupByAttributeKeys"];
      if (Array.isArray(groupByAttributeKeys)) {
        for (const key of groupByAttributeKeys) {
          addKey(key);
        }
      }

      const groupByAttributes: unknown = obj["groupByAttributes"];
      if (Array.isArray(groupByAttributes)) {
        for (const groupByAttribute of groupByAttributes) {
          if (groupByAttribute && typeof groupByAttribute === "object") {
            addKey((groupByAttribute as Record<string, unknown>)["key"]);
          }
        }
      }

      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    };

    walk(dashboardViewConfig);

    return attributeKeys;
  }

  /*
   * Attribute keys a public metric aggregation may FILTER on.
   *
   * Two sources, and both are needed:
   *
   * - Keys the widgets themselves persist — `filterData.attributes` on a
   *   chart/value/gauge query, and the table widget's widget-level
   *   `attributeFilters`.
   * - Keys the dashboard's `Telemetry Attribute` variables bind to. The
   *   shipped templates store `filterData: { metricName, aggegationType }`
   *   and no attributes at all; the filter on e.g.
   *   `resource.k8s.cluster.name` only appears once the viewer picks a value
   *   and DashboardVariableInterpolation injects it at render time. An
   *   allowlist built from stored filters alone would refuse every real
   *   templated dashboard the moment its variable is used.
   */
  private static collectDashboardFilterAttributeKeys(
    dashboardViewConfig: unknown,
  ): Set<string> {
    const attributeKeys: Set<string> =
      DashboardAPI.collectDashboardVariableAttributeKeys(dashboardViewConfig);

    const addKeysOf: (value: unknown) => void = (value: unknown): void => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return;
      }

      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (key.length > 0) {
          attributeKeys.add(key);
        }
      }
    };

    const walk: (node: unknown) => void = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }

      const obj: Record<string, unknown> = node as Record<string, unknown>;

      const filterData: unknown = obj["filterData"];
      if (filterData && typeof filterData === "object") {
        addKeysOf((filterData as Record<string, unknown>)["attributes"]);
      }

      addKeysOf(obj["attributeFilters"]);

      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    };

    walk(dashboardViewConfig);

    return attributeKeys;
  }

  /*
   * Walk a stored dashboard view config and collect every model column its
   * widgets group by. Used as the allowlist for the public metric-aggregate
   * endpoint: grouping echoes the grouped column back in every result row,
   * so `groupBy: { attributes: true }` would hand an anonymous viewer the
   * entire attribute map of an allowlisted metric.
   */
  private static collectDashboardGroupByColumns(
    dashboardViewConfig: unknown,
  ): Set<string> {
    const groupByColumns: Set<string> = new Set<string>();

    const walk: (node: unknown) => void = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }

      const obj: Record<string, unknown> = node as Record<string, unknown>;

      const groupBy: unknown = obj["groupBy"];
      if (groupBy && typeof groupBy === "object" && !Array.isArray(groupBy)) {
        for (const column of Object.keys(groupBy as Record<string, unknown>)) {
          if ((groupBy as Record<string, unknown>)[column]) {
            groupByColumns.add(column);
          }
        }
      }

      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    };

    walk(dashboardViewConfig);

    return groupByColumns;
  }

  /*
   * Walk a stored dashboard view config and collect every widget type it
   * renders. Used to build an allowlist for the public resource-list
   * endpoint so an anonymous viewer can only read the resources this
   * dashboard was actually built to show — a dashboard with a monitor list
   * on it must not double as a project-wide log or incident reader.
   */
  private static collectDashboardComponentTypes(
    dashboardViewConfig: unknown,
  ): Set<string> {
    const componentTypes: Set<string> = new Set<string>();

    const walk: (node: unknown) => void = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }

      const obj: Record<string, unknown> = node as Record<string, unknown>;

      const componentType: unknown = obj["componentType"];
      if (typeof componentType === "string" && componentType.length > 0) {
        componentTypes.add(componentType);
      }

      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    };

    walk(dashboardViewConfig);

    return componentTypes;
  }

  /*
   * Reduce a client-supplied query to the filter keys the widget is allowed
   * to narrow by. Anything else the client sends — a foreign projectId, a
   * filter on a column the widget never renders, an operator on a secret
   * column used as a blind oracle — is dropped rather than merged.
   */
  private static sanitizePublicResourceQuery(data: {
    query: unknown;
    allowedQueryKeys: Array<string>;
  }): JSONObject {
    const { query, allowedQueryKeys } = data;

    const sanitized: Record<string, unknown> = {};

    if (!query || typeof query !== "object" || Array.isArray(query)) {
      return sanitized as JSONObject;
    }

    const queryObject: Record<string, unknown> = query as Record<
      string,
      unknown
    >;

    for (const key of allowedQueryKeys) {
      if (
        Object.prototype.hasOwnProperty.call(queryObject, key) &&
        queryObject[key] !== undefined
      ) {
        sanitized[key] = queryObject[key];
      }
    }

    return sanitized as JSONObject;
  }

  /*
   * Reduce a client-supplied sort to the columns the widget already renders
   * (the registry's fixed select). Sorting by a column the viewer cannot see
   * would otherwise order rows by a hidden value and leak it.
   */
  private static sanitizePublicResourceSort(data: {
    sort: unknown;
    select: JSONObject;
  }): JSONObject {
    const { sort, select } = data;

    const sanitized: JSONObject = {};

    if (!sort || typeof sort !== "object" || Array.isArray(sort)) {
      return sanitized;
    }

    const sortObject: Record<string, unknown> = sort as Record<string, unknown>;

    for (const key of Object.keys(sortObject)) {
      // Only scalar columns of the fixed select are sortable.
      if (select[key] !== true) {
        continue;
      }

      const order: unknown = sortObject[key];

      if (
        typeof order === "string" &&
        order.toUpperCase() === SortOrder.Descending
      ) {
        sanitized[key] = SortOrder.Descending;
      } else {
        sanitized[key] = SortOrder.Ascending;
      }
    }

    return sanitized;
  }

  /*
   * Shared handler for the public resource-list endpoint. Loads the
   * dashboard, enforces read access, checks the resource is one this
   * dashboard's widgets actually render, pins the query to the dashboard's
   * project and to those widgets' kinds, and lists the resource using the
   * registry's FIXED select.
   */
  private static async servePublicResourceList(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    config: PublicDashboardResourceConfig;
  }): Promise<void> {
    const { req, res, config } = data;

    const dashboardId: ObjectID = new ObjectID(
      req.params["dashboardId"] as string,
    );

    const accessResult: {
      hasReadAccess: boolean;
      error?: NotAuthenticatedException | ForbiddenException;
    } = await DashboardService.hasReadAccess({ dashboardId, req });

    if (!accessResult.hasReadAccess) {
      throw (
        accessResult.error ||
        new BadDataException("Access denied to this dashboard.")
      );
    }

    const dashboard: Dashboard | null = await DashboardService.findOneById({
      id: dashboardId,
      select: {
        _id: true,
        projectId: true,
        dashboardViewConfig: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!dashboard || !dashboard.projectId) {
      throw new NotFoundException("Dashboard not found");
    }

    /*
     * Security: the dashboard must actually contain a widget that renders
     * this resource. Without this check, knowing any public dashboard ID
     * would be enough to read every resource type in its project — the
     * dashboard's own widgets are the owner's opt-in, so they are the
     * allowlist.
     */
    const dashboardComponentTypes: Set<string> =
      DashboardAPI.collectDashboardComponentTypes(
        dashboard.dashboardViewConfig,
      );

    const presentWidgets: Array<string> = Object.keys(config.widgets).filter(
      (componentType: string) => {
        return dashboardComponentTypes.has(componentType);
      },
    );

    if (presentWidgets.length === 0) {
      throw new BadDataException(
        "This resource is not part of this dashboard.",
      );
    }

    const clientQuery: JSONObject =
      req.body && req.body["query"]
        ? (JSONFunctions.deserialize(
            req.body["query"] as JSONObject,
          ) as JSONObject)
        : {};

    const query: JSONObject = DashboardAPI.sanitizePublicResourceQuery({
      query: clientQuery,
      allowedQueryKeys: config.allowedQueryKeys,
    });

    /*
     * Security: pin to the dashboard's project; never trust a client-supplied
     * projectId on a public, unauthenticated endpoint.
     */
    (query as Record<string, unknown>)["projectId"] = dashboard.projectId;

    /*
     * Models that pack several resource kinds into one table (Kubernetes,
     * Docker, Podman, Proxmox, Ceph, Swarm) are constrained to the kinds the
     * dashboard's widgets render, so a "volumes" widget cannot be used to
     * list containers. A widget may pick one of those kinds; anything else is
     * rejected, and a request that names no kind gets all of them.
     */
    const allowedKinds: Array<string> = presentWidgets
      .map((componentType: string) => {
        return config.widgets[componentType as DashboardComponentType];
      })
      .filter((kind: string | null | undefined): kind is string => {
        return Boolean(kind);
      });

    if (allowedKinds.length > 0) {
      const requestedKind: unknown = (clientQuery as Record<string, unknown>)[
        "kind"
      ];

      if (requestedKind !== undefined && requestedKind !== null) {
        if (
          typeof requestedKind !== "string" ||
          !allowedKinds.includes(requestedKind)
        ) {
          throw new BadDataException(
            "This resource is not part of this dashboard.",
          );
        }

        (query as Record<string, unknown>)["kind"] = requestedKind;
      } else if (allowedKinds.length === 1) {
        (query as Record<string, unknown>)["kind"] = allowedKinds[0];
      } else {
        (query as Record<string, unknown>)["kind"] = new Includes(allowedKinds);
      }
    }

    const sort: JSONObject = DashboardAPI.sanitizePublicResourceSort({
      sort:
        req.body && req.body["sort"]
          ? JSONFunctions.deserialize(req.body["sort"] as JSONObject)
          : {},
      select: config.select,
    });

    const requestedLimit: number = req.query["limit"]
      ? parseInt(req.query["limit"] as string, 10)
      : DEFAULT_DASHBOARD_RESOURCE_LIMIT;
    const limit: number = Math.min(
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : DEFAULT_DASHBOARD_RESOURCE_LIMIT,
      LIMIT_PER_PROJECT,
    );

    const requestedSkip: number = req.query["skip"]
      ? parseInt(req.query["skip"] as string, 10)
      : 0;
    const skip: number =
      Number.isFinite(requestedSkip) && requestedSkip > 0 ? requestedSkip : 0;

    const list: Array<BaseModel | AnalyticsDataModel> =
      await config.service.findBy({
        query: query,
        select: config.select,
        sort: sort,
        limit: limit,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

    return Response.sendEntityArrayResponse(
      req,
      res,
      list,
      new PositiveNumber(list.length),
      config.modelType,
    );
  }

  private static getFileAsBase64JSONObject(
    file: any,
  ): { file: string; fileType: string } | null {
    if (!file || !file.file) {
      return null;
    }

    let base64: string;
    const fileBuffer: any = file.file;

    if (Buffer.isBuffer(fileBuffer)) {
      base64 = fileBuffer.toString("base64");
    } else if (
      fileBuffer &&
      typeof fileBuffer === "object" &&
      fileBuffer.value &&
      fileBuffer.value.data
    ) {
      base64 = Buffer.from(fileBuffer.value.data).toString("base64");
    } else if (typeof fileBuffer === "string") {
      base64 = fileBuffer;
    } else {
      return null;
    }

    return {
      file: base64,
      fileType: (file.fileType as string) || "image/png",
    };
  }
}
