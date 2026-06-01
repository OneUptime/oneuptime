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
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import Dashboard from "../../Models/DatabaseModels/Dashboard";
import DashboardDomain from "../../Models/DatabaseModels/DashboardDomain";
import { EncryptionSecret } from "../EnvironmentConfig";
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
import Span from "../../Models/AnalyticsModels/Span";
import Log from "../../Models/AnalyticsModels/Log";
import IncidentService from "../Services/IncidentService";
import AlertService from "../Services/AlertService";
import MonitorService from "../Services/MonitorService";
import HostService from "../Services/HostService";
import KubernetesResourceService from "../Services/KubernetesResourceService";
import DockerHostService from "../Services/DockerHostService";
import DockerResourceService from "../Services/DockerResourceService";
import SpanService from "../Services/SpanService";
import LogService from "../Services/LogService";

/*
 * Registry of the non-metric widgets a public dashboard may render. The
 * `select` is the FIXED set of columns the corresponding widget displays —
 * the public list endpoint ignores any client-supplied select and uses this,
 * so an anonymous viewer can only ever read these columns (and only for the
 * dashboard's own project). Adding a widget to a public dashboard is the
 * owner's explicit opt-in to exposing these columns.
 */
interface PublicDashboardResourceConfig {
  modelType: { new (): BaseModel | AnalyticsDataModel };
  service: {
    findBy: (findBy: any) => Promise<Array<BaseModel | AnalyticsDataModel>>;
  };
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
    select: {
      _id: true,
      name: true,
      monitorType: true,
      currentMonitorStatus: { name: true, color: true },
    },
  },
  host: {
    modelType: Host,
    service: HostService,
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
    select: {
      _id: true,
      name: true,
      state: true,
      dockerHostId: true,
      dockerHost: { name: true },
    },
  },
  span: {
    modelType: Span,
    service: SpanService,
    select: {
      startTime: true,
      name: true,
      statusCode: true,
      durationUnixNano: true,
      traceId: true,
      spanId: true,
      kind: true,
      serviceId: true,
    },
  },
  log: {
    modelType: Log,
    service: LogService,
    select: {
      time: true,
      severityText: true,
      body: true,
      serviceId: true,
      traceId: true,
      spanId: true,
      attributes: true,
    },
  },
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

          const attributeKey: string | undefined =
            req.body && (req.body["attributeKey"] as string);

          if (!attributeKey || !attributeKey.trim()) {
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
              },
              props: {
                isRoot: true,
              },
            });

          if (!dashboard || !dashboard.projectId) {
            throw new NotFoundException("Dashboard not found");
          }

          const values: Array<string> =
            await TelemetryAttributeService.fetchAttributeValues({
              projectId: dashboard.projectId,
              telemetryType,
              attributeKey: attributeKey.trim(),
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
          const requestedMetricName: unknown = aggregateBy.query
            ? (aggregateBy.query as Record<string, unknown>)["name"]
            : undefined;

          if (
            typeof requestedMetricName !== "string" ||
            !allowedMetricNames.has(requestedMetricName)
          ) {
            throw new BadDataException(
              "This metric is not part of this dashboard.",
            );
          }

          /*
           * Security: never trust a client-supplied projectId on a public,
           * unauthenticated endpoint. Pin the aggregation to the dashboard's
           * project before it reaches the database service.
           */
          aggregateBy.query = {
            ...(aggregateBy.query || {}),
            projectId: dashboard.projectId,
          };

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

          const password: string | undefined =
            req.body && (req.body["password"] as string);

          if (!password) {
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

          const hashedInput: string = await HashedString.hashValue(
            password,
            EncryptionSecret,
          );

          if (hashedInput !== dashboard.masterPassword.toString()) {
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
   * Shared handler for the public resource-list endpoint. Loads the
   * dashboard, enforces read access, pins the query to the dashboard's
   * project, and lists the resource using the registry's FIXED select.
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
      },
      props: {
        isRoot: true,
      },
    });

    if (!dashboard || !dashboard.projectId) {
      throw new NotFoundException("Dashboard not found");
    }

    const query: JSONObject =
      req.body && req.body["query"]
        ? (JSONFunctions.deserialize(
            req.body["query"] as JSONObject,
          ) as JSONObject)
        : {};

    /*
     * Security: pin to the dashboard's project; never trust a client-supplied
     * projectId on a public, unauthenticated endpoint.
     */
    (query as Record<string, unknown>)["projectId"] = dashboard.projectId;

    const sort: JSONObject =
      req.body && req.body["sort"]
        ? (JSONFunctions.deserialize(
            req.body["sort"] as JSONObject,
          ) as JSONObject)
        : {};

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
