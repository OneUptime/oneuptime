import UserMiddleware from "../Middleware/UserAuthorization";
import PublicDashboardRateLimit, {
  PublicDashboardRateLimitBucket,
} from "../Middleware/PublicDashboardRateLimit";
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
import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import PublicDashboardViewConfig from "../Utils/Dashboard/PublicDashboardViewConfig";
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
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import Span from "../../Models/AnalyticsModels/Span";
import Log from "../../Models/AnalyticsModels/Log";
import SloHistory from "../../Models/AnalyticsModels/SloHistory";
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
import ServiceLevelObjectiveService from "../Services/ServiceLevelObjectiveService";
import SpanService from "../Services/SpanService";
import LogService from "../Services/LogService";
import SloHistoryService from "../Services/SloHistoryService";
import DashboardComponentType from "../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../Types/Dashboard/DashboardVariable";
import PublicDashboardResourceListPolicy, {
  PublicDashboardResourceListPolicyResult,
} from "../Utils/Dashboard/PublicDashboardResourceListPolicy";
import PublicDashboardSloHistoryPolicy, {
  PublicDashboardSloHistoryPolicyResult,
} from "../Utils/Dashboard/PublicDashboardSloHistoryPolicy";
import AggregationType from "../../Types/BaseDatabase/AggregationType";
import InBetween from "../../Types/BaseDatabase/InBetween";
import { applyIncidentSelfPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStatusTimelineService from "../Services/MonitorStatusTimelineService";
import QueryHelper from "../Types/Database/QueryHelper";
import PublicDashboardMonitorStateTimelinePolicy, {
  MAX_PUBLIC_STATE_TIMELINE_ROWS,
  PUBLIC_STATE_TIMELINE_SELECT,
} from "../Utils/Dashboard/PublicDashboardMonitorStateTimelinePolicy";
import { applyAlertSelfPrivacyFilter } from "../Utils/Alert/AlertPrivacyFilter";

/*
 * Registry of the non-metric widgets a public dashboard may render.
 *
 * - `widgets` lists the dashboard widgets that render this resource, mapped
 *   to the `kind` each one shows (null when the model is not partitioned by
 *   kind). The dashboard must actually contain one of these widgets before
 *   the endpoint will serve the resource at all, and the query is pinned to
 *   the kinds those widgets render. Adding a widget to a public dashboard is
 *   therefore the owner's explicit — and only — opt-in to exposing this data.
 * Query, select, sort and pagination policy are rebuilt from the exact stored
 * widget by PublicDashboardResourceListPolicy. Client copies of those fields
 * are never authoritative on this unauthenticated route.
 */
interface PublicDashboardResourceConfig {
  modelType: { new (): BaseModel | AnalyticsDataModel };
  service: {
    findBy: (findBy: any) => Promise<Array<BaseModel | AnalyticsDataModel>>;
  };
  widgets: Partial<Record<DashboardComponentType, string | null>>;
}

/*
 * Named rather than inlined below: the SLO history route selects its widget
 * through the same registry entry as the resource-list route, so both must
 * agree on which stored widgets count as "an SLO widget on this dashboard".
 */
const PUBLIC_DASHBOARD_SLO_RESOURCE: PublicDashboardResourceConfig = {
  modelType: ServiceLevelObjective,
  service: ServiceLevelObjectiveService,
  widgets: {
    [DashboardComponentType.Slo]: null,
  },
};

/*
 * Named rather than inlined below: the state-timeline route selects its
 * widget through the same registry entry as the resource-list route, so both
 * must agree on which stored widgets count as "a Monitor List on this
 * dashboard".
 */
const PUBLIC_DASHBOARD_MONITOR_RESOURCE: PublicDashboardResourceConfig = {
  modelType: Monitor,
  service: MonitorService,
  widgets: {
    [DashboardComponentType.MonitorList]: null,
  },
};

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
  },
  alert: {
    modelType: Alert,
    service: AlertService,
    widgets: {
      [DashboardComponentType.AlertList]: null,
    },
  },
  monitor: PUBLIC_DASHBOARD_MONITOR_RESOURCE,
  "network-site": {
    modelType: NetworkSite,
    service: NetworkSiteService,
    widgets: {
      [DashboardComponentType.NetworkMap]: null,
    },
  },
  host: {
    modelType: Host,
    service: HostService,
    widgets: {
      [DashboardComponentType.HostList]: null,
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
  },
  "docker-host": {
    modelType: DockerHost,
    service: DockerHostService,
    widgets: {
      [DashboardComponentType.DockerHostList]: null,
    },
  },
  "docker-container": {
    modelType: DockerResource,
    service: DockerResourceService,
    widgets: {
      [DashboardComponentType.DockerContainerList]: "Container",
    },
  },
  "docker-image": {
    modelType: DockerResource,
    service: DockerResourceService,
    widgets: {
      [DashboardComponentType.DockerImageList]: "Image",
    },
  },
  "docker-network": {
    modelType: DockerResource,
    service: DockerResourceService,
    widgets: {
      [DashboardComponentType.DockerNetworkList]: "Network",
    },
  },
  "docker-volume": {
    modelType: DockerResource,
    service: DockerResourceService,
    widgets: {
      [DashboardComponentType.DockerVolumeList]: "Volume",
    },
  },
  "podman-host": {
    modelType: PodmanHost,
    service: PodmanHostService,
    widgets: {
      [DashboardComponentType.PodmanHostList]: null,
    },
  },
  "podman-container": {
    modelType: PodmanResource,
    service: PodmanResourceService,
    widgets: {
      [DashboardComponentType.PodmanContainerList]: "Container",
    },
  },
  "podman-image": {
    modelType: PodmanResource,
    service: PodmanResourceService,
    widgets: {
      [DashboardComponentType.PodmanImageList]: "Image",
    },
  },
  "podman-network": {
    modelType: PodmanResource,
    service: PodmanResourceService,
    widgets: {
      [DashboardComponentType.PodmanNetworkList]: "Network",
    },
  },
  "podman-volume": {
    modelType: PodmanResource,
    service: PodmanResourceService,
    widgets: {
      [DashboardComponentType.PodmanVolumeList]: "Volume",
    },
  },
  "proxmox-resource": {
    modelType: ProxmoxResource,
    service: ProxmoxResourceService,
    widgets: {
      [DashboardComponentType.ProxmoxNodeList]: "Node",
      [DashboardComponentType.ProxmoxGuestList]: "Guest",
    },
  },
  "ceph-resource": {
    modelType: CephResource,
    service: CephResourceService,
    widgets: {
      [DashboardComponentType.CephOsdList]: "Osd",
      [DashboardComponentType.CephPoolList]: "Pool",
    },
  },
  "docker-swarm-resource": {
    modelType: DockerSwarmResource,
    service: DockerSwarmResourceService,
    widgets: {
      [DashboardComponentType.DockerSwarmNodeList]: "Node",
      [DashboardComponentType.DockerSwarmServiceList]: "Service",
    },
  },
  span: {
    modelType: Span,
    service: SpanService,
    widgets: {
      [DashboardComponentType.TraceList]: null,
    },
  },
  log: {
    modelType: Log,
    service: LogService,
    widgets: {
      [DashboardComponentType.LogStream]: null,
    },
  },
  slo: PUBLIC_DASHBOARD_SLO_RESOURCE,
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

    /*
     * Rate limiting for the anonymous public dashboard surface. Nginx exposes
     * every route below under /public-dashboard-api and rewrites it to
     * /api/dashboard before it reaches us, so this router IS that prefix and
     * the limiter goes on all of it uniformly rather than on the handful of
     * routes that happen to be the most expensive today.
     *
     * Registered ahead of UserMiddleware so a flood is rejected before it
     * costs a session lookup. See PublicDashboardRateLimit for the budgets
     * and for why the two buckets fail in opposite directions when Redis is
     * unreachable.
     */
    const publicDashboardRateLimit: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = PublicDashboardRateLimit.getMiddleware(
      PublicDashboardRateLimitBucket.Read,
    );

    /*
     * /master-password verifies a bcrypt hash per request, so unthrottled it
     * is an online password-guessing oracle that also burns a CPU-bound hash
     * per guess. Its own, much tighter bucket.
     */
    const masterPasswordRateLimit: (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ) => Promise<void> = PublicDashboardRateLimit.getMiddleware(
      PublicDashboardRateLimitBucket.MasterPassword,
    );

    // SEO endpoint - resolve dashboard by ID or domain
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/seo/:dashboardIdOrDomain`,
      publicDashboardRateLimit,
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
         * overview only reshapes them into a single GET-able document, and
         * applies the same external-Data-Source strip /view-config does.
         */
        const publicViewConfig: DashboardViewConfig | null =
          PublicDashboardViewConfig.sanitize(dashboard.dashboardViewConfig);

        return Response.sendJsonObjectResponse(req, res, {
          _id: dashboard._id?.toString() || "",
          name: dashboard.name || "Dashboard",
          description: dashboard.description || "",
          pageTitle: dashboard.pageTitle || "",
          pageDescription: dashboard.pageDescription || "",
          components:
            DashboardAPI.buildPublicComponentSummaries(publicViewConfig),
          metricsUsed: Array.from(
            DashboardAPI.collectDashboardMetricNames(publicViewConfig),
          ).sort(),
          dashboardViewConfig: publicViewConfig
            ? JSONFunctions.serialize(publicViewConfig as any)
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
      publicDashboardRateLimit,
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
      publicDashboardRateLimit,
      UserMiddleware.getUserMiddleware,
      overviewHandler,
    );

    // Domain resolution endpoint
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/domain`,
      publicDashboardRateLimit,
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
      publicDashboardRateLimit,
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
      publicDashboardRateLimit,
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

          const publicViewConfig: DashboardViewConfig | null =
            PublicDashboardViewConfig.sanitize(dashboard.dashboardViewConfig);

          return Response.sendJsonObjectResponse(req, res, {
            _id: dashboard._id?.toString() || "",
            name: dashboard.name || "Dashboard",
            description: dashboard.description || "",
            pageTitle: dashboard.pageTitle || "",
            pageDescription: dashboard.pageDescription || "",
            logoFile: DashboardAPI.getFileAsBase64JSONObject(
              dashboard.logoFile,
            ),
            /*
             * External Data Source widgets are stripped: they cannot render
             * for an anonymous viewer, and their config IS the query — raw
             * SQL / PromQL naming internal tables, jobs, and instances.
             *
             * The null stays null. JSONFunctions.serialize(null) returns
             * `{}`, and the public page falls back to a default config only
             * on a FALSY value — an empty object is truthy, so it would sail
             * through and the canvas would read `.components.length` off
             * undefined.
             */
            dashboardViewConfig: publicViewConfig
              ? JSONFunctions.serialize(publicViewConfig as any)
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
      publicDashboardRateLimit,
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
      publicDashboardRateLimit,
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
      publicDashboardRateLimit,
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
     * Each widget renders a fixed set of columns; the server-owned widget
     * policy pins the select to exactly those columns and forces the
     * project scope to the dashboard's project, so a public viewer can only
     * read the data the widget was built to show, for this dashboard's
     * project. Authorization reuses DashboardService.hasReadAccess.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/resource-list/:dashboardId/:resourceType`,
      publicDashboardRateLimit,
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

    /*
     * Public SLO history aggregation for the SLO widget's Chart display.
     *
     * The SLO's CURRENT numbers come back through /resource-list/.../slo
     * like every other widget's data; this route serves the time SERIES
     * behind them, which lives in ClickHouse and so needs an aggregation
     * rather than a list.
     *
     * Nothing the caller sends selects data. The SLO and the series are
     * read out of the stored widget (identified by componentId), the
     * aggregation columns are fixed, the bucket size is recomputed from the
     * window, and the project is pinned to the dashboard's — so the only
     * caller-supplied input that survives is the time window itself.
     * Authorization reuses DashboardService.hasReadAccess.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/slo-history-aggregate/:dashboardId`,
      publicDashboardRateLimit,
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

          const widget: JSONObject = DashboardAPI.selectPublicResourceWidget({
            dashboardViewConfig: dashboard.dashboardViewConfig,
            config: PUBLIC_DASHBOARD_SLO_RESOURCE,
            requestedComponentId: req.body["componentId"],
          });

          const policy: PublicDashboardSloHistoryPolicyResult =
            PublicDashboardSloHistoryPolicy.build({
              widget,
              requestedAggregateBy: JSONFunctions.deserialize(
                req.body["aggregateBy"] as JSONObject,
              ),
            });

          const aggregateResult: AggregatedResult =
            await SloHistoryService.aggregateBy({
              /*
               * Narrow the assertion to `query` alone. Everything else in
               * this literal is typed against SloHistory — the column names
               * below are `keyof SloHistory` — so asserting the whole object
               * would turn off exactly the check that catches a typo or a
               * renamed column at compile time instead of at runtime.
               */
              query: {
                projectId: dashboard.projectId,
                sloId: policy.serviceLevelObjectiveId,
                metricName: policy.metricName,
                bucketStart: new InBetween<Date>(
                  policy.startDate,
                  policy.endDate,
                ),
              } as unknown as AggregateBy<SloHistory>["query"],
              /*
               * All three SLO series are instantaneous gauges, so averaging
               * the raw buckets that fall inside one chart point is the only
               * roll-up that means anything — same as the authenticated
               * widget and the SLO detail page.
               */
              aggregationType: AggregationType.Avg,
              aggregateColumnName: "value",
              aggregationTimestampColumnName: "bucketStart",
              aggregationInterval: policy.aggregationInterval,
              startTimestamp: policy.startDate,
              endTimestamp: policy.endDate,
              // Oldest -> newest so the line renders left to right.
              sort: {
                bucketStart: SortOrder.Ascending,
              },
              limit: policy.limit,
              skip: 0,
              /*
               * Run as root: authorization is already enforced by
               * hasReadAccess above and the project scope is pinned in the
               * query.
               */
              props: {
                isRoot: true,
              },
            });

          return Response.sendJsonObjectResponse(req, res, {
            ...(aggregateResult as unknown as JSONObject),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Public monitor status history for the Monitor List widget's State
     * Timeline view.
     *
     * This is a dedicated route rather than another PUBLIC_DASHBOARD_RESOURCES
     * entry because the timeline is a read ABOUT a set of monitors, and that
     * set is a selector. The resource-list route rebuilds a widget's query
     * server side precisely so a public caller never supplies one; letting the
     * caller post monitor ids here would hand that back. So the monitor set is
     * re-derived from the STORED Monitor List widget with the same policy the
     * resource-list route uses, and the only caller-supplied input that
     * survives is the time window — validated and length-capped by
     * PublicDashboardMonitorStateTimelinePolicy.
     *
     * Authorization reuses DashboardService.hasReadAccess.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/monitor-status-timeline/:dashboardId`,
      publicDashboardRateLimit,
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

          const widget: JSONObject = DashboardAPI.selectPublicResourceWidget({
            dashboardViewConfig: dashboard.dashboardViewConfig,
            config: PUBLIC_DASHBOARD_MONITOR_RESOURCE,
            requestedComponentId: req.body
              ? req.body["componentId"]
              : undefined,
          });

          const window: InBetween<Date> =
            PublicDashboardMonitorStateTimelinePolicy.resolveWindowFromBody(
              req.body as JSONObject | undefined,
            );

          const policy: PublicDashboardResourceListPolicyResult =
            PublicDashboardResourceListPolicy.build({
              widget,
              dashboardViewConfig: dashboard.dashboardViewConfig,
              requestedVariables: req.body ? req.body["variables"] : undefined,
              /*
               * The Monitor List policy reads its whole query out of the
               * stored widget, so there is nothing for a caller to contribute
               * here — unlike the log and trace policies, which take their
               * time window through this argument.
               */
              requestedQuery: {},
            });

          /*
           * The same monitor set the widget's own list call resolves, in the
           * same order and under the same row cap — so the lanes the browser
           * draws and the history it gets back describe the same monitors.
           */
          const monitors: Array<Monitor> = (await MonitorService.findBy({
            query: {
              ...policy.query,
              // Never redirect this root read to another project.
              projectId: dashboard.projectId,
            },
            select: {
              _id: true,
            },
            sort: policy.sort,
            limit: policy.limit,
            skip: 0,
            props: {
              isRoot: true,
            },
          })) as Array<Monitor>;

          const monitorIds: Array<ObjectID> = monitors
            .map((monitor: Monitor) => {
              return monitor.id;
            })
            .filter((id: ObjectID | null): id is ObjectID => {
              return id !== null;
            });

          if (monitorIds.length === 0) {
            return Response.sendEntityArrayResponse(
              req,
              res,
              [],
              new PositiveNumber(0),
              MonitorStatusTimeline,
            );
          }

          const statusTimelines: Array<MonitorStatusTimeline> =
            await MonitorStatusTimelineService.findBy({
              query: {
                projectId: dashboard.projectId,
                monitorId: QueryHelper.any(monitorIds),
                /*
                 * Every row that OVERLAPS the window: it started on or before
                 * the window ends, and it either ended on or after the window
                 * started or is still open.
                 *
                 * The browser's own query says `endsAt > start` rather than
                 * `>=`. The difference is a row that ends exactly at the
                 * window start, which contributes a zero-length event that
                 * UptimeUtil discards and a zero-width bar the renderer skips
                 * — so the two paths draw the same timeline either way, and
                 * the inclusive form here is the one the rest of the server
                 * uses for this predicate.
                 */
                startsAt: QueryHelper.lessThanEqualTo(window.endValue),
                endsAt: QueryHelper.greaterThanEqualToOrNull(window.startValue),
              },
              select: PUBLIC_STATE_TIMELINE_SELECT,
              sort: {
                startsAt: SortOrder.Ascending,
              },
              limit: MAX_PUBLIC_STATE_TIMELINE_ROWS,
              skip: 0,
              /*
               * Run as root: authorization is already enforced by
               * hasReadAccess above, the monitor set comes from the stored
               * widget, and the project is pinned in the query.
               */
              props: {
                isRoot: true,
              },
            });

          return Response.sendEntityArrayResponse(
            req,
            res,
            statusTimelines,
            new PositiveNumber(statusTimelines.length),
            MonitorStatusTimeline,
          );
        } catch (err) {
          next(err);
        }
        return undefined;
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/master-password/:dashboardId`,
      masterPasswordRateLimit,
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
        /*
         * Widgets do not agree on where the author's heading lives — each
         * one's settings form names its own argument (`chartTitle`,
         * `gaugeTitle`, `tableTitle`, the SLO widget's `widgetTitle`, plain
         * `title` elsewhere). Read every key that is actually a heading
         * today, so a summary is not blank for a widget that plainly has a
         * title on the page. A widget type added later with yet another key
         * needs adding here too.
         */
        title:
          getStringArgument("chartTitle") ||
          getStringArgument("gaugeTitle") ||
          getStringArgument("tableTitle") ||
          getStringArgument("widgetTitle") ||
          getStringArgument("title"),
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
   * Read only the real, top-level dashboard components. Recursively scanning
   * arbitrary widget arguments would let a nested object carrying a
   * `componentType` masquerade as a widget and become an authorization input.
   */
  private static collectDashboardWidgets(
    dashboardViewConfig: unknown,
  ): Array<JSONObject> {
    if (
      !dashboardViewConfig ||
      typeof dashboardViewConfig !== "object" ||
      Array.isArray(dashboardViewConfig)
    ) {
      return [];
    }

    const components: unknown = (
      dashboardViewConfig as Record<string, unknown>
    )["components"];

    if (!Array.isArray(components)) {
      return [];
    }

    return components.filter((component: unknown): component is JSONObject => {
      return Boolean(
        component && typeof component === "object" && !Array.isArray(component),
      );
    });
  }

  private static readDashboardWidgetComponentId(
    widget: JSONObject,
  ): string | null {
    const componentId: unknown = widget["componentId"];

    if (componentId instanceof ObjectID) {
      return componentId.toString();
    }

    if (typeof componentId === "string" && componentId.length > 0) {
      return componentId;
    }

    if (
      componentId &&
      typeof componentId === "object" &&
      !Array.isArray(componentId)
    ) {
      const value: unknown = (componentId as Record<string, unknown>)["value"];

      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }

    return null;
  }

  /*
   * Select the exact stored widget whose policy will be executed. A legacy
   * caller may omit componentId only when there is exactly one matching
   * widget, so two differently-filtered widgets are never conflated.
   */
  private static selectPublicResourceWidget(data: {
    dashboardViewConfig: unknown;
    config: PublicDashboardResourceConfig;
    requestedComponentId: unknown;
  }): JSONObject {
    const matchingWidgets: Array<JSONObject> =
      DashboardAPI.collectDashboardWidgets(data.dashboardViewConfig).filter(
        (widget: JSONObject): boolean => {
          const componentType: unknown = widget["componentType"];

          return (
            typeof componentType === "string" &&
            Object.prototype.hasOwnProperty.call(
              data.config.widgets,
              componentType,
            )
          );
        },
      );

    if (matchingWidgets.length === 0) {
      throw new BadDataException(
        "This resource is not part of this dashboard.",
      );
    }

    if (
      data.requestedComponentId === undefined ||
      data.requestedComponentId === null
    ) {
      if (matchingWidgets.length === 1) {
        return matchingWidgets[0] as JSONObject;
      }

      throw new BadDataException(
        "A componentId is required to read this resource from this dashboard.",
      );
    }

    if (typeof data.requestedComponentId !== "string") {
      throw new BadDataException("componentId must be a string UUID.");
    }

    ObjectID.validateUUID(data.requestedComponentId);

    const selectedWidget: JSONObject | undefined = matchingWidgets.find(
      (widget: JSONObject): boolean => {
        return (
          DashboardAPI.readDashboardWidgetComponentId(widget) ===
          data.requestedComponentId
        );
      },
    );

    if (!selectedWidget) {
      throw new BadDataException(
        "This resource is not part of this dashboard.",
      );
    }

    return selectedWidget;
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

    const widget: JSONObject = DashboardAPI.selectPublicResourceWidget({
      dashboardViewConfig: dashboard.dashboardViewConfig,
      config,
      requestedComponentId: req.body ? req.body["componentId"] : undefined,
    });

    const requestedQuery: JSONObject =
      req.body && req.body["query"]
        ? (JSONFunctions.deserialize(
            req.body["query"] as JSONObject,
          ) as JSONObject)
        : {};

    const policy: PublicDashboardResourceListPolicyResult =
      PublicDashboardResourceListPolicy.build({
        widget,
        dashboardViewConfig: dashboard.dashboardViewConfig,
        requestedVariables: req.body ? req.body["variables"] : undefined,
        requestedQuery,
      });

    const requestedResourceType: string = req.params["resourceType"] as string;

    if (policy.resourceType !== requestedResourceType) {
      throw new BadDataException(
        "This resource is not part of this dashboard.",
      );
    }

    let query: JSONObject = {
      ...policy.query,
    };

    /*
     * IncidentService and AlertService normally apply privacy in their
     * onBeforeFind hooks. The root read below intentionally bypasses those
     * hooks' user context, so apply the anonymous form explicitly first:
     * public dashboards may show public rows, never private tenant rows.
     */
    if (requestedResourceType === "incident") {
      query = applyIncidentSelfPrivacyFilter(query, {});
    } else if (requestedResourceType === "alert") {
      query = applyAlertSelfPrivacyFilter(query, {});
    }

    /*
     * Project scope is the final query invariant. Neither the request nor a
     * future policy builder may redirect this root read to another project.
     * Resource kind, where applicable, comes solely from the selected
     * widget's policy query.
     */
    query["projectId"] = dashboard.projectId;

    const list: Array<BaseModel | AnalyticsDataModel> =
      await config.service.findBy({
        query: query,
        select: policy.select,
        sort: policy.sort,
        limit: policy.limit,
        skip: 0,
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
