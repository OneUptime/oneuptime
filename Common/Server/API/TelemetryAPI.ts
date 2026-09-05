import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
  getClientIp,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import TelemetryAttributeService from "../Services/TelemetryAttributeService";
import TelemetrySourceMapService from "../Services/TelemetrySourceMapService";
import SourceMapResolver, {
  MAX_FRAMES_PER_RESOLVE_REQUEST,
} from "../Utils/Telemetry/SourceMapResolver";
import {
  MinifiedStackFrame,
  ResolveStackTraceResult,
} from "../../Types/Telemetry/SourceMap";
import LogAggregationService, {
  HistogramBucket,
  HistogramRequest,
  FacetValue,
  FacetRequest,
  LogAttributeFilters,
  AnalyticsRequest,
  AnalyticsChartType,
  AnalyticsAggregation,
  AnalyticsTimeseriesRow,
  AnalyticsTopItem,
  AnalyticsTableRow,
  ErrorPatternFilters,
  ErrorPatternTimelineRequest,
  TopErrorPattern,
  TopErrorPatternsRequest,
} from "../Services/LogAggregationService";
import TraceAggregationService, {
  HistogramBucket as TraceHistogramBucket,
  HistogramRequest as TraceHistogramRequest,
  FacetValue as TraceFacetValue,
  MultiFacetRequest as TraceMultiFacetRequest,
  TraceFilters,
  TraceAnalyticsChartType,
  TraceAnalyticsRequest,
  TraceAnalyticsTimeseriesRow,
  TraceAnalyticsTopItem,
  TraceAnalyticsTableRow,
} from "../Services/TraceAggregationService";
import ExceptionAggregationService, {
  HistogramBucket as ExceptionHistogramBucket,
  HistogramRequest as ExceptionHistogramRequest,
  FacetValue as ExceptionFacetValue,
  FacetRequest as ExceptionFacetRequest,
} from "../Services/ExceptionAggregationService";
import MetricAggregationService, {
  FacetValue as MetricFacetValue,
  FacetRequest as MetricFacetRequest,
  MetricAttributeFilters,
  MetricForTraceItem,
} from "../Services/MetricAggregationService";
import ProfileAggregationService, {
  FlamegraphRequest,
  FlamegraphResult,
  FunctionListRequest,
  FunctionListResult,
  FunctionFocusRequest,
  FunctionFocusResult,
  BreakdownRequest,
  BreakdownResult,
  DiffFlamegraphRequest,
  DiffFlamegraphNode,
  ServiceActivityRequest,
  ServiceActivityItem,
  TracePresenceResult,
} from "../Services/ProfileAggregationService";
import PprofEncoder, {
  PprofProfile,
  PprofSample,
} from "../Utils/Profile/PprofEncoder";
import Profile from "../../Models/AnalyticsModels/Profile";
import ProfileSample from "../../Models/AnalyticsModels/ProfileSample";
import ProfileService from "../Services/ProfileService";
import ProfileSampleService from "../Services/ProfileSampleService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../Types/Permission";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import { IsBillingEnabled, getAllEnvVars } from "../EnvironmentConfig";
import RumSession from "../../Models/AnalyticsModels/RumSession";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ResourceFacetResolver, {
  ResolvedFacetValue,
  ResourceFacetSpec,
} from "../Utils/Telemetry/ResourceFacetResolver";
import ResourceEntityFilter, {
  ResourceEntityScope,
} from "../Utils/Telemetry/ResourceEntityFilter";
import { ResourceEntityFacetSelections } from "../../Types/Telemetry/ResourceEntityFacet";
import Label from "../../Models/DatabaseModels/Label";
import RumApplication from "../../Models/DatabaseModels/RumApplication";
import RumApplicationService from "../Services/RumApplicationService";
import Project from "../../Models/DatabaseModels/Project";
import ProjectService from "../Services/ProjectService";
import SessionReplayIdentity from "../Utils/SessionReplay/SessionReplayIdentity";
import SessionReplayTargeting from "../Utils/SessionReplay/SessionReplayTargeting";
import SessionReplayUsage from "../Utils/SessionReplay/SessionReplayUsage";
import RumSessionReplayView from "../../Models/DatabaseModels/RumSessionReplayView";
import RumSessionReplayViewService, {
  normalizeSecondsWatched,
} from "../Services/RumSessionReplayViewService";
import SessionReplayReadService, {
  DEFAULT_SESSION_REPLAY_LIST_LIMIT,
  MAX_SESSION_REPLAY_FOR_EXCEPTION_LIMIT,
  MAX_SESSION_REPLAY_LIST_LIMIT,
  SESSION_REPLAY_EXCEPTION_WINDOW_PADDING_MS,
  SessionReplayApplicationActivitySummary,
  SessionReplayChunkReadResult,
  SessionReplayExceptionSession,
  SessionReplayExpiredSessionInfo,
  SessionReplayListCursor,
  SessionReplayListFilters,
  SessionReplayListResult,
  SessionReplayManifest,
  SessionReplaySessionHeader,
  SessionReplaySessionIdentity,
} from "../Utils/SessionReplay/SessionReplayReadService";
import SessionReplayHealthCounters, {
  SessionReplayDropCount,
} from "../Utils/SessionReplay/SessionReplayHealthCounters";
import { isSessionErased } from "../Utils/SessionReplay/SessionReplayErasureTombstone";
import NotFoundException from "../../Types/Exception/NotFoundException";
import {
  DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY,
  MAX_SESSION_REPLAY_CHUNKS_PER_READ,
  MAX_SESSION_REPLAY_READ_BYTES,
  SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH,
  SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS,
  SESSION_REPLAY_MAX_SESSION_MS,
  SESSION_REPLAY_MAX_TAG_KEYS,
  SESSION_REPLAY_MAX_TAG_KEY_LENGTH,
  SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
  SESSION_REPLAY_MAX_USER_REF_LENGTH,
} from "../../Types/Rum/SessionReplay";
import {
  SESSION_REPLAY_SORT_BY_VALUES,
  SessionReplaySortBy,
  parseSessionReplayListCursor,
} from "../../Types/Rum/SessionReplayApi";
import { SessionReplayRefusalCount } from "../../Types/Rum/SessionReplayHealth";

const router: ExpressRouter = Express.getRouter();

/*
 * Shared guards for every bespoke telemetry route in this file. These routes
 * don't go through BaseAnalyticsAPI, so nothing downstream re-checks
 * authorization: the tenantId comes straight from a caller-controlled header
 * and UserMiddleware lets tokenless requests through as Public. Every route
 * must therefore demand an authenticated principal that holds a
 * telemetry-read permission on that tenant before any data is queried.
 * Each guard's permission list mirrors the table-level read access control
 * declared on the corresponding analytics model, keeping these routes
 * exactly as permissive as the model-backed CRUD APIs for the same signal.
 *
 * Guards are declared before any route registration: route registration
 * executes at module load, and spreading a const declared further down the
 * file would throw at startup (temporal dead zone).
 */
type TelemetryReadAccessGuardFactory = (
  signalReadPermission: Permission,
) => Array<RequestHandler>;

const createTelemetryReadAccessGuard: TelemetryReadAccessGuardFactory = (
  signalReadPermission: Permission,
): Array<RequestHandler> => {
  return [
    UserMiddleware.getUserMiddleware,
    UserMiddleware.requireUserAuthentication,
    UserMiddleware.requirePermission({
      permissions: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.TelemetryAdmin,
        Permission.TelemetryMember,
        Permission.TelemetryViewer,
        signalReadPermission,
      ],
    }),
  ];
};

// Mirrors the read access control declared on the Log analytics model.
const requireLogReadAccess: Array<RequestHandler> =
  createTelemetryReadAccessGuard(Permission.ReadTelemetryServiceLog);

// Mirrors the read access control declared on the Span analytics model.
const requireTraceReadAccess: Array<RequestHandler> =
  createTelemetryReadAccessGuard(Permission.ReadTelemetryServiceTraces);

/*
 * Mirrors the read access control declared on the Metric analytics model,
 * whose table-level read list grants ReadTelemetryServiceTraces rather than
 * ReadTelemetryServiceMetrics. The guard follows the model declaration so
 * these routes stay in lockstep with the model-backed CRUD API; if the model
 * ever switches to ReadTelemetryServiceMetrics this must change with it.
 */
const requireMetricReadAccess: Array<RequestHandler> =
  createTelemetryReadAccessGuard(Permission.ReadTelemetryServiceTraces);

/*
 * Mirrors the read access control declared on the ExceptionInstance
 * analytics model.
 */
const requireExceptionReadAccess: Array<RequestHandler> =
  createTelemetryReadAccessGuard(Permission.ReadTelemetryException);

/*
 * Mirrors the read access control declared on the Profile / ProfileSample
 * analytics models.
 */
const requireProfileReadAccess: Array<RequestHandler> =
  createTelemetryReadAccessGuard(Permission.ReadTelemetryServiceProfiles);

/*
 * Mirrors the read access control declared on the SecurityEvent analytics
 * model - which, unlike every other signal above, is NOT the telemetry list.
 * Security events read through the Security tiers only, so this route cannot
 * be built from createTelemetryReadAccessGuard: doing so would leave the
 * attribute endpoints open to ProjectMember and the Telemetry tiers while the
 * model-backed CRUD API refused them, and the attribute keys and values of a
 * SIEM table are themselves the sensitive part - usernames, hostnames, source
 * IPs, and every value seen for them.
 */
const requireSecurityEventReadAccess: Array<RequestHandler> = [
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadSecurityEvent,
    ],
  }),
];

router.post(
  "/telemetry/metrics/get-attributes",
  ...requireMetricReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Metric);
  },
);

router.post(
  "/telemetry/metrics/get-attribute-values",
  ...requireMetricReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributeValues(req, res, next, TelemetryType.Metric);
  },
);

router.post(
  "/telemetry/logs/get-attributes",
  ...requireLogReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Log);
  },
);

router.post(
  "/telemetry/logs/get-attribute-values",
  ...requireLogReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributeValues(req, res, next, TelemetryType.Log);
  },
);

router.post(
  "/telemetry/traces/get-attributes",
  ...requireTraceReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Trace);
  },
);

router.post(
  "/telemetry/traces/get-attribute-values",
  ...requireTraceReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributeValues(req, res, next, TelemetryType.Trace);
  },
);

router.post(
  "/telemetry/exceptions/get-attributes",
  ...requireExceptionReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Exception);
  },
);

router.post(
  "/telemetry/exceptions/get-attribute-values",
  ...requireExceptionReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributeValues(req, res, next, TelemetryType.Exception);
  },
);

/*
 * Lazily resolves an exception's parsed stack frames against the source
 * maps uploaded for its (service, release) pair — see the TelemetrySourceMap
 * model. Guarded by exception read access, not source-map read access, on
 * purpose: anyone who may see the exception may see the few original source
 * lines around its crash site (the snippets in the response). Bulk access to
 * whole maps stays restricted by the model's own column ACL on `content`.
 * That is a deliberate trade-off, not an oversight: a caller with exception
 * read access could reconstruct larger stretches of sourcesContent by
 * probing many line/column pairs across requests, exactly as they could in
 * Sentry or Elastic. The content column ACL exists to prevent trivial bulk
 * export, not to be an information-flow boundary against a team member who
 * is already trusted to read the project's exceptions.
 *
 * Tenant safety: source maps are queried by (tenantId from the authorized
 * request, serviceId from the body). A serviceId belonging to a different
 * project simply matches no maps — nothing cross-tenant can be read.
 */
router.post(
  "/telemetry/exceptions/resolve-stack-trace",
  ...requireExceptionReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      if (!body["serviceId"] || typeof body["serviceId"] !== "string") {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("serviceId is required"),
        );
      }

      if (
        !body["serviceVersion"] ||
        typeof body["serviceVersion"] !== "string"
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("serviceVersion is required"),
        );
      }

      if (!Array.isArray(body["frames"])) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("frames must be an array of stack frames"),
        );
      }

      /*
       * Bound the array before sanitizing it. sanitizeMinifiedStackFrames
       * never throws and never truncates, so without this the only limit on
       * the work a caller can ask for is the body-size cap.
       */
      if (
        (body["frames"] as Array<unknown>).length >
        MAX_FRAMES_PER_RESOLVE_REQUEST
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            `frames must contain at most ${MAX_FRAMES_PER_RESOLVE_REQUEST} stack frames.`,
          ),
        );
      }

      const frames: Array<MinifiedStackFrame> =
        SourceMapResolver.sanitizeMinifiedStackFrames(body["frames"]);

      const result: ResolveStackTraceResult =
        await TelemetrySourceMapService.resolveFramesForService({
          projectId: databaseProps.tenantId,
          serviceId: new ObjectID(body["serviceId"] as string),
          serviceVersion: body["serviceVersion"] as string,
          frames: frames,
        });

      return Response.sendJsonObjectResponse(
        req,
        res,
        result as unknown as JSONObject,
      );
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Security events flatten their whole source payload into `attributes`, so
 * these are what backs the "add an attribute column" picker on the security
 * events table — the keys differ per event class and per source, so there is
 * no fixed list the UI could ship.
 */
router.post(
  "/telemetry/security-events/get-attributes",
  ...requireSecurityEventReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.SecurityEvent);
  },
);

router.post(
  "/telemetry/security-events/get-attribute-values",
  ...requireSecurityEventReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributeValues(req, res, next, TelemetryType.SecurityEvent);
  },
);

type GetAttributesFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
  telemetryType: TelemetryType,
) => Promise<void>;

const getAttributes: GetAttributesFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
  telemetryType: TelemetryType,
) => {
  try {
    const databaseProps: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!databaseProps) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User Sesssion"),
      );
    }

    if (!databaseProps.tenantId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project ID"),
      );
    }

    const metricName: string | undefined =
      req.body["metricName"] && typeof req.body["metricName"] === "string"
        ? (req.body["metricName"] as string)
        : undefined;

    const attributes: string[] =
      await TelemetryAttributeService.fetchAttributes({
        projectId: databaseProps.tenantId,
        telemetryType,
        metricName,
      });

    return Response.sendJsonObjectResponse(req, res, {
      attributes: attributes,
    });
  } catch (err: any) {
    next(err);
  }
};

type GetAttributeValuesFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
  telemetryType: TelemetryType,
) => Promise<void>;

const getAttributeValues: GetAttributeValuesFunction = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
  telemetryType: TelemetryType,
) => {
  try {
    const databaseProps: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    if (!databaseProps) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid User Session"),
      );
    }

    if (!databaseProps.tenantId) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Invalid Project ID"),
      );
    }

    const attributeKey: string | undefined =
      req.body["attributeKey"] && typeof req.body["attributeKey"] === "string"
        ? (req.body["attributeKey"] as string)
        : undefined;

    if (!attributeKey) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("attributeKey is required"),
      );
    }

    const metricName: string | undefined =
      req.body["metricName"] && typeof req.body["metricName"] === "string"
        ? (req.body["metricName"] as string)
        : undefined;

    const searchText: string | undefined =
      req.body["searchText"] && typeof req.body["searchText"] === "string"
        ? (req.body["searchText"] as string)
        : undefined;

    const values: string[] =
      await TelemetryAttributeService.fetchAttributeValues({
        projectId: databaseProps.tenantId,
        telemetryType,
        metricName,
        attributeKey,
        searchText,
      });

    return Response.sendJsonObjectResponse(req, res, {
      values: values,
    });
  } catch (err: any) {
    next(err);
  }
};

// --- Log Histogram Endpoint ---

router.post(
  "/telemetry/logs/histogram",
  ...requireLogReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const bucketSizeInMinutes: number =
        (body["bucketSizeInMinutes"] as number) ||
        computeDefaultBucketSize(startTime, endTime);

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const entityKeys: Array<string> | undefined = body["entityKeys"]
        ? (body["entityKeys"] as Array<string>)
        : undefined;

      const severityTexts: Array<string> | undefined = body["severityTexts"]
        ? (body["severityTexts"] as Array<string>)
        : undefined;

      const bodySearchText: string | undefined = body["bodySearchText"]
        ? (body["bodySearchText"] as string)
        : undefined;

      const traceIds: Array<string> | undefined = body["traceIds"]
        ? (body["traceIds"] as Array<string>)
        : undefined;

      const spanIds: Array<string> | undefined = body["spanIds"]
        ? (body["spanIds"] as Array<string>)
        : undefined;

      const sessionIds: Array<string> | undefined = body["sessionIds"]
        ? (body["sessionIds"] as Array<string>)
        : undefined;

      const attributes: LogAttributeFilters | undefined = body["attributes"]
        ? (body["attributes"] as LogAttributeFilters)
        : undefined;

      const resourceScopes: Array<ResourceEntityScope> | undefined =
        await resolveResourceScopesFromBody(body, databaseProps.tenantId);

      const request: HistogramRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        bucketSizeInMinutes,
        serviceIds,
        entityKeys,
        resourceScopes,
        severityTexts,
        bodySearchText,
        traceIds,
        spanIds,
        sessionIds,
        attributes,
      };

      const buckets: Array<HistogramBucket> =
        await LogAggregationService.getHistogram(request);

      return Response.sendJsonObjectResponse(req, res, {
        buckets: buckets as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Log Facets Endpoint ---

router.post(
  "/telemetry/logs/facets",
  ...requireLogReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const facetKeys: Array<string> = body["facetKeys"]
        ? (body["facetKeys"] as Array<string>)
        : ["severityText", "primaryEntityId"];

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const limit: number = (body["limit"] as number) || 500;

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const entityKeys: Array<string> | undefined = body["entityKeys"]
        ? (body["entityKeys"] as Array<string>)
        : undefined;

      const severityTexts: Array<string> | undefined = body["severityTexts"]
        ? (body["severityTexts"] as Array<string>)
        : undefined;

      const bodySearchText: string | undefined = body["bodySearchText"]
        ? (body["bodySearchText"] as string)
        : undefined;

      const traceIds: Array<string> | undefined = body["traceIds"]
        ? (body["traceIds"] as Array<string>)
        : undefined;

      const spanIds: Array<string> | undefined = body["spanIds"]
        ? (body["spanIds"] as Array<string>)
        : undefined;

      const sessionIds: Array<string> | undefined = body["sessionIds"]
        ? (body["sessionIds"] as Array<string>)
        : undefined;

      const attributes: LogAttributeFilters | undefined = body["attributes"]
        ? (body["attributes"] as LogAttributeFilters)
        : undefined;

      /*
       * Per-facet partial-match filter applied at the Postgres source-of-truth
       * lookup stage. Only consulted for resource facets (primaryEntityId /
       * hostId / dockerHostId / kubernetesClusterId) — other facets continue
       * to filter client-side over the loaded value list.
       */
      const facetSearchText: Record<string, string> | undefined = body[
        "facetSearchText"
      ]
        ? (body["facetSearchText"] as Record<string, string>)
        : undefined;

      /*
       * Capture tenantId locally so TypeScript narrowing survives the
       * async closure below (narrowing is lost across closure boundaries).
       */
      const projectId: ObjectID = databaseProps.tenantId;

      const resourceScopes: Array<ResourceEntityScope> | undefined =
        await resolveResourceScopesFromBody(body, projectId);

      /*
       * Run facet queries in parallel so a slow individual facet can't
       * starve the endpoint. Per-facet errors degrade gracefully to [].
       */
      const facetResults: Array<readonly [string, Array<FacetValue>]> =
        await Promise.all(
          facetKeys.map(
            async (
              facetKey: string,
            ): Promise<readonly [string, Array<FacetValue>]> => {
              try {
                const request: FacetRequest = {
                  projectId,
                  startTime,
                  endTime,
                  facetKey,
                  limit,
                  serviceIds,
                  entityKeys,
                  resourceScopes,
                  severityTexts,
                  bodySearchText,
                  traceIds,
                  spanIds,
                  sessionIds,
                  attributes,
                };
                const values: Array<FacetValue> =
                  await LogAggregationService.getFacetValues(request);
                return [facetKey, values] as const;
              } catch {
                return [facetKey, [] as Array<FacetValue>] as const;
              }
            },
          ),
        );

      const facets: Record<string, Array<FacetValue>> = Object.fromEntries(
        facetResults,
      );

      /*
       * Replace resource-facet results with the Postgres source-of-truth list
       * (filtered by facetSearchText and enriched with displayName). See the
       * trace facets handler above for the rationale — same pattern, same
       * benefit: low-volume resources stay visible and search can reach
       * resources outside the ClickHouse sample window.
       */
      const resourceSpecs: Array<ResourceFacetSpec> = facetKeys
        .filter((key: string): boolean => {
          return ResourceFacetResolver.isResourceFacet(key);
        })
        .map((key: string): ResourceFacetSpec => {
          const counts: Map<string, number> = new Map();
          for (const fv of facets[key] || []) {
            counts.set(fv.value, fv.count);
          }
          return {
            facetKey: key,
            counts,
            searchText: facetSearchText?.[key],
            limit,
          };
        });

      if (resourceSpecs.length > 0) {
        const resolved: Record<
          string,
          Array<ResolvedFacetValue>
        > = await ResourceFacetResolver.resolve(projectId, resourceSpecs);
        for (const key of Object.keys(resolved)) {
          facets[key] = resolved[key] as Array<FacetValue>;
        }
      }

      return Response.sendJsonObjectResponse(req, res, {
        facets: facets as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

/**
 * Resolve the `resourceFilters` field — the explorers' non-Service resource
 * facet selections (Kubernetes cluster / host / docker host / podman host),
 * sent as Postgres ids — into the scopes the aggregation services compile.
 *
 * Kept out of the sync body parsers because turning an id into an entity
 * key needs a Postgres round trip: the id names a row whose identifying
 * value (`clusterIdentifier` / `hostIdentifier`) is what ingest hashed into
 * `entityKeys`.
 *
 * Returns undefined when nothing was selected so the request field stays
 * absent rather than becoming an empty array.
 */
async function resolveResourceScopesFromBody(
  body: JSONObject,
  projectId: ObjectID,
): Promise<Array<ResourceEntityScope> | undefined> {
  const selections: ResourceEntityFacetSelections =
    ResourceEntityFilter.parseSelections(
      body["resourceFilters"] as JSONObject | undefined,
    );

  if (Object.keys(selections).length === 0) {
    return undefined;
  }

  const scopes: Array<ResourceEntityScope> =
    await ResourceEntityFilter.resolveScopes({
      projectId,
      selections,
    });

  return scopes.length > 0 ? scopes : undefined;
}

/*
 * The wire shape of an attribute filter map — the same for logs, traces and
 * metrics, so it is structurally assignable to each service's own filter
 * type.
 */
type ParsedAttributeFilters = Record<
  string,
  string | Array<string> | { _type: string; value?: unknown }
>;

/*
 * Parse the `attributes` body field.
 *
 * Three shapes are legal: a single value (`= v`), a list of values
 * (`IN (...)`, what a multi-select dashboard variable resolves to), and a
 * serialized QueryOperator (`{_type: "Wildcard", value: ["api-*"]}`) for
 * every other operator the search grammar can produce. Everything else is
 * dropped, and an array left empty by the string filtering is dropped too so
 * it cannot narrow to nothing.
 *
 * The operator shape used to be dropped here, which is worse than rejecting
 * it: a wildcard filter arrived as "no filter", so the chart showed the whole
 * project beside a list narrowed to a handful of spans. `_type` is only
 * checked for being a string — the compiler in AttributeFilterStatement
 * answers an unknown operator with a 400.
 */
function parseAttributeFilterRecord(
  raw: unknown,
): ParsedAttributeFilters | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const filters: ParsedAttributeFilters = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      filters[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      const values: Array<string> = (value as Array<unknown>).filter(
        (v: unknown): v is string => {
          return typeof v === "string";
        },
      );
      if (values.length > 0) {
        filters[key] = values;
      }
      continue;
    }

    if (
      value &&
      typeof value === "object" &&
      typeof (value as Record<string, unknown>)["_type"] === "string"
    ) {
      filters[key] = value as { _type: string; value?: unknown };
    }
  }

  if (Object.keys(filters).length === 0) {
    return undefined;
  }

  return filters;
}

/*
 * Shared body parsing for every trace aggregation endpoint (histogram,
 * facets, analytics). Defensive about shapes: arrays are validated and
 * filtered to strings, booleans/numbers use strict typeof checks (JSON null
 * or a stringly-typed value must mean "no filter", never an active
 * predicate).
 */
function parseTraceFilterBody(body: JSONObject): TraceFilters {
  const serviceIds: Array<ObjectID> | undefined = Array.isArray(
    body["serviceIds"],
  )
    ? (body["serviceIds"] as Array<unknown>)
        .filter((v: unknown): v is string => {
          return typeof v === "string";
        })
        .map((id: string) => {
          return new ObjectID(id);
        })
    : undefined;

  const stringArray: (key: string) => Array<string> | undefined = (
    key: string,
  ): Array<string> | undefined => {
    return Array.isArray(body[key])
      ? (body[key] as Array<unknown>).filter((v: unknown): v is string => {
          return typeof v === "string";
        })
      : undefined;
  };

  /*
   * Numeric strings are coerced (stringly-typed clients worked before the
   * parsing was centralized) — dropping them would silently widen the
   * filter to all statuses.
   */
  const statusCodes: Array<number> | undefined = Array.isArray(
    body["statusCodes"],
  )
    ? (body["statusCodes"] as Array<unknown>)
        .map((v: unknown): number => {
          return typeof v === "number" ? v : Number(v);
        })
        .filter((v: number): boolean => {
          return Number.isFinite(v);
        })
    : undefined;

  const stringRecord: (key: string) => Record<string, string> | undefined = (
    key: string,
  ): Record<string, string> | undefined => {
    const raw: unknown = body[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const entries: Array<[string, string]> = Object.entries(
      raw as Record<string, unknown>,
    ).filter((entry: [string, unknown]): entry is [string, string] => {
      return typeof entry[1] === "string";
    });
    if (entries.length === 0) {
      return undefined;
    }
    return Object.fromEntries(entries);
  };

  return {
    serviceIds,
    entityKeys: stringArray("entityKeys"),
    statusCodes,
    spanKinds: stringArray("spanKinds"),
    spanNames: stringArray("spanNames"),
    /*
     * spanNameSearches is the only multiplicative filter (one ILIKE
     * predicate per entry) — cap it. The dashboard sends at most one.
     */
    spanNameSearches: stringArray("spanNameSearches")?.slice(0, 10),
    spanIds: stringArray("spanIds"),
    traceIds: stringArray("traceIds"),
    nameSearchText:
      typeof body["nameSearchText"] === "string" && body["nameSearchText"]
        ? (body["nameSearchText"] as string)
        : undefined,
    statusMessageSearchText:
      typeof body["statusMessageSearchText"] === "string" &&
      body["statusMessageSearchText"]
        ? (body["statusMessageSearchText"] as string)
        : undefined,
    statusMessages: stringArray("statusMessages"),
    /*
     * Strict boolean check — unlike rootOnly, a coerced `false` is a
     * meaningful predicate here (JSON null must mean "no filter", not
     * "exclude exception spans").
     */
    hasException:
      typeof body["hasException"] === "boolean"
        ? (body["hasException"] as boolean)
        : undefined,
    minDurationNano:
      typeof body["minDurationNano"] === "number"
        ? (body["minDurationNano"] as number)
        : undefined,
    maxDurationNano:
      typeof body["maxDurationNano"] === "number"
        ? (body["maxDurationNano"] as number)
        : undefined,
    exactDurationNano:
      typeof body["exactDurationNano"] === "number"
        ? (body["exactDurationNano"] as number)
        : undefined,
    rootOnly:
      body["rootOnly"] === undefined ? undefined : Boolean(body["rootOnly"]),
    attributes: parseAttributeFilterRecord(body["attributes"]),
    attributeSearches: stringRecord("attributeSearches"),
  };
}

// --- Trace Histogram Endpoint ---

router.post(
  "/telemetry/traces/histogram",
  ...requireTraceReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const bucketSizeInMinutes: number =
        (body["bucketSizeInMinutes"] as number) ||
        computeDefaultBucketSize(startTime, endTime);

      const traceFilters: TraceFilters = {
        ...parseTraceFilterBody(body),
        resourceScopes: await resolveResourceScopesFromBody(
          body,
          databaseProps.tenantId,
        ),
      };

      const request: TraceHistogramRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        bucketSizeInMinutes,
        ...traceFilters,
      };

      const buckets: Array<TraceHistogramBucket> =
        await TraceAggregationService.getHistogram(request);

      return Response.sendJsonObjectResponse(req, res, {
        buckets: buckets as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Trace Facets Endpoint ---

router.post(
  "/telemetry/traces/facets",
  ...requireTraceReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const facetKeys: Array<string> = body["facetKeys"]
        ? (body["facetKeys"] as Array<string>)
        : ["primaryEntityId", "statusCode", "kind", "name"];

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const limit: number = (body["limit"] as number) || 500;

      const traceFilters: TraceFilters = {
        ...parseTraceFilterBody(body),
        resourceScopes: await resolveResourceScopesFromBody(
          body,
          databaseProps.tenantId,
        ),
      };

      /*
       * Per-facet partial-match filter applied at the Postgres source-of-truth
       * lookup stage. Only consulted for resource facets (primaryEntityId /
       * hostId / dockerHostId / kubernetesClusterId) — other facets continue
       * to filter client-side over the loaded value list.
       */
      const facetSearchText: Record<string, string> | undefined = body[
        "facetSearchText"
      ]
        ? (body["facetSearchText"] as Record<string, string>)
        : undefined;

      /*
       * Shared window + active filters for both facet-counting paths below:
       * the exact projection-backed GROUP BY (resource facets + statusCode)
       * and the recent-N sample (kind + attribute facets, which have no cheap
       * exact path).
       */
      const multiRequest: TraceMultiFacetRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        facetKeys,
        limit,
        ...traceFilters,
      };

      /*
       * Resource facets (primaryEntityId / hostId / dockerHostId / k8s
       * cluster ...) and statusCode are counted with an exact,
       * projection-backed GROUP BY
       * in getResourceFacetCounts(). The recent-N sample below saturates with
       * whichever service is chattiest right now and reports 0 for every other
       * service regardless of its true volume over the window — the "top 1000"
       * symptom. Facets with no projection (kind, attribute keys) have no cheap
       * exact path and stay on the sample.
       */
      const sampledKeys: Array<string> = facetKeys.filter(
        (key: string): boolean => {
          return (
            !ResourceFacetResolver.isResourceFacet(key) &&
            key !== "statusCode" &&
            // isRootSpan / hasException are counted exactly below, not sampled.
            key !== "isRootSpan" &&
            key !== "hasException"
          );
        },
      );

      const needsAccurateCounts: boolean =
        facetKeys.includes("statusCode") ||
        facetKeys.some((key: string): boolean => {
          return ResourceFacetResolver.isResourceFacet(key);
        });
      const wantsRootSpan: boolean = facetKeys.includes("isRootSpan");
      const wantsHasException: boolean = facetKeys.includes("hasException");

      const emptyAccurate: {
        serviceCounts: Map<string, number>;
        statusCounts: Map<string, number>;
      } = {
        serviceCounts: new Map<string, number>(),
        statusCounts: new Map<string, number>(),
      };

      /*
       * Run the independent count queries concurrently. They share no state and
       * were previously awaited one after another, so their latencies added up.
       * getHasExceptionCounts in particular is a base-table GROUP BY
       * (hasException is not a proj_hist_by_minute key), so overlapping it with
       * the projection-backed sample / resource / root-span queries keeps it
       * off the critical path. Each query keeps its own degrade-to-empty catch.
       */
      const [sampledFacets, accurate, rootSpanCounts, exceptionCounts]: [
        Record<string, Array<TraceFacetValue>>,
        {
          serviceCounts: Map<string, number>;
          statusCounts: Map<string, number>;
        },
        { rootCount: number; nonRootCount: number } | null,
        { withExceptionCount: number; withoutExceptionCount: number } | null,
      ] = await Promise.all([
        sampledKeys.length > 0
          ? TraceAggregationService.getFacetValuesFromSample({
              ...multiRequest,
              facetKeys: sampledKeys,
            }).catch((): Record<string, Array<TraceFacetValue>> => {
              return Object.fromEntries(
                sampledKeys.map(
                  (key: string): [string, Array<TraceFacetValue>] => {
                    return [key, []];
                  },
                ),
              );
            })
          : Promise.resolve({} as Record<string, Array<TraceFacetValue>>),
        needsAccurateCounts
          ? TraceAggregationService.getResourceFacetCounts(multiRequest).catch(
              () => {
                /*
                 * Degrade gracefully: resource facets still enumerate via
                 * Postgres (count 0), statusCode falls back to empty.
                 */
                return emptyAccurate;
              },
            )
          : Promise.resolve(emptyAccurate),
        wantsRootSpan
          ? TraceAggregationService.getRootSpanCounts(multiRequest).catch(
              () => {
                return null;
              },
            )
          : Promise.resolve(null),
        wantsHasException
          ? TraceAggregationService.getHasExceptionCounts(multiRequest).catch(
              () => {
                return null;
              },
            )
          : Promise.resolve(null),
      ]);

      const facets: Record<string, Array<TraceFacetValue>> = sampledFacets;
      const serviceCounts: Map<string, number> = accurate.serviceCounts;
      const statusCounts: Map<string, number> = accurate.statusCounts;

      if (facetKeys.includes("statusCode")) {
        facets["statusCode"] = Array.from(statusCounts.entries())
          .map(([value, count]: [string, number]): TraceFacetValue => {
            return { value, count };
          })
          .sort((a: TraceFacetValue, b: TraceFacetValue): number => {
            return b.count - a.count;
          })
          .slice(0, limit);
      }

      /*
       * Span-type facet: exact root vs non-root counts off the projection,
       * computed ignoring rootOnly so both buckets survive (see
       * getRootSpanCounts). Backs the "Span Type" sidebar choice.
       */
      if (wantsRootSpan) {
        facets["isRootSpan"] = rootSpanCounts
          ? [
              { value: "true", count: rootSpanCounts.rootCount },
              { value: "false", count: rootSpanCounts.nonRootCount },
            ]
          : [];
      }

      /*
       * Has-exception facet: exact counts (exception spans are rare and the
       * recent-N sample would under-report or miss them — see
       * getHasExceptionCounts).
       */
      if (wantsHasException) {
        facets["hasException"] = exceptionCounts
          ? [
              { value: "true", count: exceptionCounts.withExceptionCount },
              { value: "false", count: exceptionCounts.withoutExceptionCount },
            ]
          : [];
      }

      /*
       * Replace resource-facet results with the Postgres source-of-truth list
       * (filtered by facetSearchText and enriched with displayName). Every
       * resource facet shares the same exact primaryEntityId -> count map;
       * resource ids are globally unique, so each facet only ever resolves its own
       * entities. Entities with no telemetry in the window surface with count
       * 0 instead of being hidden, and the search box can find resources
       * beyond the loaded subset.
       */
      const resourceSpecs: Array<ResourceFacetSpec> = facetKeys
        .filter((key: string): boolean => {
          return ResourceFacetResolver.isResourceFacet(key);
        })
        .map((key: string): ResourceFacetSpec => {
          return {
            facetKey: key,
            counts: serviceCounts,
            searchText: facetSearchText?.[key],
            limit,
          };
        });

      if (resourceSpecs.length > 0) {
        const resolved: Record<
          string,
          Array<ResolvedFacetValue>
        > = await ResourceFacetResolver.resolve(
          databaseProps.tenantId,
          resourceSpecs,
        );
        for (const key of Object.keys(resolved)) {
          facets[key] = resolved[key] as Array<TraceFacetValue>;
        }
      }

      return Response.sendJsonObjectResponse(req, res, {
        facets: facets as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Trace Analytics Endpoint ---

router.post(
  "/telemetry/traces/analytics",
  ...requireTraceReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const chartType: TraceAnalyticsChartType =
        (body["chartType"] as TraceAnalyticsChartType) || "timeseries";

      if (!["timeseries", "toplist", "table"].includes(chartType)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid chartType"),
        );
      }

      const metric: string = (body["metric"] as string) || "count";

      if (!TraceAggregationService.isValidAnalyticsMetric(metric)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid metric"),
        );
      }

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const rawBucketSize: number = Number(body["bucketSizeInMinutes"]);
      const bucketSizeInMinutes: number =
        Number.isFinite(rawBucketSize) && rawBucketSize >= 1
          ? Math.trunc(rawBucketSize)
          : computeDefaultBucketSize(startTime, endTime);

      const groupBy: Array<string> | undefined = Array.isArray(body["groupBy"])
        ? (body["groupBy"] as Array<unknown>).filter(
            (v: unknown): v is string => {
              return typeof v === "string" && v.length > 0;
            },
          )
        : undefined;

      /*
       * Clamp to a sane integer range — `limit` flows into LIMIT and the
       * timeseries series cap, so negative/fractional values would 500 in
       * ClickHouse and huge values would explode the result set. Numeric
       * strings are accepted (dashboard widget arguments are stored as
       * strings).
       */
      const rawLimit: number = Number(body["limit"]);
      const limit: number | undefined = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.trunc(rawLimit), 1), 1000)
        : undefined;

      const traceFilters: TraceFilters = {
        ...parseTraceFilterBody(body),
        resourceScopes: await resolveResourceScopesFromBody(
          body,
          databaseProps.tenantId,
        ),
      };

      const request: TraceAnalyticsRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        bucketSizeInMinutes,
        chartType,
        metric,
        groupBy,
        limit,
        ...traceFilters,
      };

      if (chartType === "timeseries") {
        const data: Array<TraceAnalyticsTimeseriesRow> =
          await TraceAggregationService.getAnalyticsTimeseries(request);

        return Response.sendJsonObjectResponse(req, res, {
          data: data as unknown as JSONObject,
        });
      }

      if (chartType === "toplist") {
        const data: Array<TraceAnalyticsTopItem> =
          await TraceAggregationService.getAnalyticsTopList(request);

        return Response.sendJsonObjectResponse(req, res, {
          data: data as unknown as JSONObject,
        });
      }

      const data: Array<TraceAnalyticsTableRow> =
        await TraceAggregationService.getAnalyticsTable(request);

      return Response.sendJsonObjectResponse(req, res, {
        data: data as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Exception Histogram Endpoint ---

router.post(
  "/telemetry/exceptions/histogram",
  ...requireExceptionReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -24);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const bucketSizeInMinutes: number =
        (body["bucketSizeInMinutes"] as number) ||
        computeDefaultBucketSize(startTime, endTime);

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const exceptionTypes: Array<string> | undefined = body["exceptionTypes"]
        ? (body["exceptionTypes"] as Array<string>)
        : undefined;

      const environments: Array<string> | undefined = body["environments"]
        ? (body["environments"] as Array<string>)
        : undefined;

      const fingerprints: Array<string> | undefined = body["fingerprints"]
        ? (body["fingerprints"] as Array<string>)
        : undefined;

      const traceIds: Array<string> | undefined = body["traceIds"]
        ? (body["traceIds"] as Array<string>)
        : undefined;

      const escaped: boolean | undefined =
        body["escaped"] === undefined ? undefined : Boolean(body["escaped"]);

      const messageSearchText: string | undefined = body["messageSearchText"]
        ? (body["messageSearchText"] as string)
        : undefined;

      const request: ExceptionHistogramRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        bucketSizeInMinutes,
        serviceIds,
        exceptionTypes,
        environments,
        fingerprints,
        traceIds,
        escaped,
        messageSearchText,
      };

      const buckets: Array<ExceptionHistogramBucket> =
        await ExceptionAggregationService.getHistogram(request);

      return Response.sendJsonObjectResponse(req, res, {
        buckets: buckets as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Exception Facets Endpoint ---

router.post(
  "/telemetry/exceptions/facets",
  ...requireExceptionReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const facetKeys: Array<string> = body["facetKeys"]
        ? (body["facetKeys"] as Array<string>)
        : [
            "primaryEntityId",
            "hostId",
            "dockerHostId",
            "podmanHostId",
            "kubernetesClusterId",
            "exceptionType",
            "environment",
          ];

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -24);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const limit: number = (body["limit"] as number) || 500;

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const exceptionTypes: Array<string> | undefined = body["exceptionTypes"]
        ? (body["exceptionTypes"] as Array<string>)
        : undefined;

      const environments: Array<string> | undefined = body["environments"]
        ? (body["environments"] as Array<string>)
        : undefined;

      const fingerprints: Array<string> | undefined = body["fingerprints"]
        ? (body["fingerprints"] as Array<string>)
        : undefined;

      const traceIds: Array<string> | undefined = body["traceIds"]
        ? (body["traceIds"] as Array<string>)
        : undefined;

      const escaped: boolean | undefined =
        body["escaped"] === undefined ? undefined : Boolean(body["escaped"]);

      const messageSearchText: string | undefined = body["messageSearchText"]
        ? (body["messageSearchText"] as string)
        : undefined;

      /*
       * Per-facet partial-match filter applied at the Postgres source-of-truth
       * lookup stage. Only consulted for resource facets — other facets
       * continue to filter client-side over the loaded value list.
       */
      const facetSearchText: Record<string, string> | undefined = body[
        "facetSearchText"
      ]
        ? (body["facetSearchText"] as Record<string, string>)
        : undefined;

      const projectId: ObjectID = databaseProps.tenantId;

      /*
       * Per-facet ClickHouse query in parallel. Per-facet errors degrade
       * gracefully to [] so a slow / failing facet can't block the others.
       */
      const facetResults: Array<readonly [string, Array<ExceptionFacetValue>]> =
        await Promise.all(
          facetKeys.map(
            async (
              facetKey: string,
            ): Promise<readonly [string, Array<ExceptionFacetValue>]> => {
              try {
                const request: ExceptionFacetRequest = {
                  projectId,
                  startTime,
                  endTime,
                  facetKey,
                  limit,
                  serviceIds,
                  exceptionTypes,
                  environments,
                  fingerprints,
                  traceIds,
                  escaped,
                  messageSearchText,
                };
                const values: Array<ExceptionFacetValue> =
                  await ExceptionAggregationService.getFacetValues(request);
                return [facetKey, values] as const;
              } catch {
                return [facetKey, [] as Array<ExceptionFacetValue>] as const;
              }
            },
          ),
        );

      const facets: Record<
        string,
        Array<ExceptionFacetValue>
      > = Object.fromEntries(facetResults);

      /*
       * Replace resource-facet results with the Postgres source-of-truth list
       * (filtered by facetSearchText and enriched with displayName). Same
       * pattern as the trace/log facets endpoints.
       */
      const resourceSpecs: Array<ResourceFacetSpec> = facetKeys
        .filter((key: string): boolean => {
          return ResourceFacetResolver.isResourceFacet(key);
        })
        .map((key: string): ResourceFacetSpec => {
          const counts: Map<string, number> = new Map();
          for (const fv of facets[key] || []) {
            counts.set(fv.value, fv.count);
          }
          return {
            facetKey: key,
            counts,
            searchText: facetSearchText?.[key],
            limit,
          };
        });

      if (resourceSpecs.length > 0) {
        const resolved: Record<
          string,
          Array<ResolvedFacetValue>
        > = await ResourceFacetResolver.resolve(projectId, resourceSpecs);
        for (const key of Object.keys(resolved)) {
          facets[key] = resolved[key] as Array<ExceptionFacetValue>;
        }
      }

      return Response.sendJsonObjectResponse(req, res, {
        facets: facets as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Metric Facets Endpoint ---

router.post(
  "/telemetry/metrics/facets",
  ...requireMetricReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const facetKeys: Array<string> = body["facetKeys"]
        ? (body["facetKeys"] as Array<string>)
        : [
            "primaryEntityId",
            "hostId",
            "dockerHostId",
            "podmanHostId",
            "kubernetesClusterId",
          ];

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const limit: number = (body["limit"] as number) || 500;

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const metricNames: Array<string> | undefined = body["metricNames"]
        ? (body["metricNames"] as Array<string>)
        : undefined;

      const attributes: MetricAttributeFilters | undefined =
        parseAttributeFilterRecord(body["attributes"]);

      const facetSearchText: Record<string, string> | undefined = body[
        "facetSearchText"
      ]
        ? (body["facetSearchText"] as Record<string, string>)
        : undefined;

      const projectId: ObjectID = databaseProps.tenantId;

      /*
       * Per-facet ClickHouse GROUP BY in parallel. Per-facet errors degrade
       * to [] so a slow facet doesn't block the rest.
       */
      const facetResults: Array<readonly [string, Array<MetricFacetValue>]> =
        await Promise.all(
          facetKeys.map(
            async (
              facetKey: string,
            ): Promise<readonly [string, Array<MetricFacetValue>]> => {
              try {
                const request: MetricFacetRequest = {
                  projectId,
                  startTime,
                  endTime,
                  facetKey,
                  limit,
                  serviceIds,
                  metricNames,
                  attributes,
                };
                const values: Array<MetricFacetValue> =
                  await MetricAggregationService.getFacetValues(request);
                return [facetKey, values] as const;
              } catch {
                return [facetKey, [] as Array<MetricFacetValue>] as const;
              }
            },
          ),
        );

      const facets: Record<
        string,
        Array<MetricFacetValue>
      > = Object.fromEntries(facetResults);

      /*
       * Replace resource-facet results with the Postgres source-of-truth list
       * (filtered by facetSearchText and enriched with displayName). Same
       * pattern as the trace / log / exception facets endpoints.
       */
      const resourceSpecs: Array<ResourceFacetSpec> = facetKeys
        .filter((key: string): boolean => {
          return ResourceFacetResolver.isResourceFacet(key);
        })
        .map((key: string): ResourceFacetSpec => {
          const counts: Map<string, number> = new Map();
          for (const fv of facets[key] || []) {
            counts.set(fv.value, fv.count);
          }
          return {
            facetKey: key,
            counts,
            searchText: facetSearchText?.[key],
            limit,
          };
        });

      if (resourceSpecs.length > 0) {
        const resolved: Record<
          string,
          Array<ResolvedFacetValue>
        > = await ResourceFacetResolver.resolve(projectId, resourceSpecs);
        for (const key of Object.keys(resolved)) {
          facets[key] = resolved[key] as Array<MetricFacetValue>;
        }
      }

      return Response.sendJsonObjectResponse(req, res, {
        facets: facets as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Metrics For Trace (reverse exemplar lookup) Endpoint ---

router.post(
  "/telemetry/metrics/for-trace",
  ...requireMetricReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const traceId: string | undefined =
        body["traceId"] && typeof body["traceId"] === "string"
          ? (body["traceId"] as string)
          : undefined;

      if (!traceId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("traceId is required"),
        );
      }

      const spanIds: Array<string> | undefined = Array.isArray(body["spanIds"])
        ? (body["spanIds"] as Array<string>).filter(
            (s: unknown): s is string => {
              return typeof s === "string" && s.length > 0;
            },
          )
        : undefined;

      const limit: number | undefined =
        typeof body["limit"] === "number"
          ? (body["limit"] as number)
          : undefined;

      const items: Array<MetricForTraceItem> =
        await MetricAggregationService.getMetricsForTrace({
          projectId: databaseProps.tenantId,
          traceId,
          ...(spanIds !== undefined && spanIds.length > 0 && { spanIds }),
          ...(limit !== undefined && { limit }),
        });

      return Response.sendJsonObjectResponse(req, res, {
        items: items as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Log Analytics Endpoint ---

router.post(
  "/telemetry/logs/analytics",
  ...requireLogReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const chartType: AnalyticsChartType =
        (body["chartType"] as AnalyticsChartType) || "timeseries";

      if (!["timeseries", "toplist", "table"].includes(chartType)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid chartType"),
        );
      }

      const aggregation: AnalyticsAggregation =
        (body["aggregation"] as AnalyticsAggregation) || "count";

      if (!["count", "unique"].includes(aggregation)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid aggregation"),
        );
      }

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const bucketSizeInMinutes: number =
        (body["bucketSizeInMinutes"] as number) ||
        computeDefaultBucketSize(startTime, endTime);

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const severityTexts: Array<string> | undefined = body["severityTexts"]
        ? (body["severityTexts"] as Array<string>)
        : undefined;

      const bodySearchText: string | undefined = body["bodySearchText"]
        ? (body["bodySearchText"] as string)
        : undefined;

      const traceIds: Array<string> | undefined = body["traceIds"]
        ? (body["traceIds"] as Array<string>)
        : undefined;

      const spanIds: Array<string> | undefined = body["spanIds"]
        ? (body["spanIds"] as Array<string>)
        : undefined;

      const sessionIds: Array<string> | undefined = body["sessionIds"]
        ? (body["sessionIds"] as Array<string>)
        : undefined;

      const groupBy: Array<string> | undefined = body["groupBy"]
        ? (body["groupBy"] as Array<string>)
        : undefined;

      const aggregationField: string | undefined = body["aggregationField"]
        ? (body["aggregationField"] as string)
        : undefined;

      const limit: number | undefined = body["limit"]
        ? (body["limit"] as number)
        : undefined;

      const resourceScopes: Array<ResourceEntityScope> | undefined =
        await resolveResourceScopesFromBody(body, databaseProps.tenantId);

      const request: AnalyticsRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        bucketSizeInMinutes,
        chartType,
        groupBy,
        aggregation,
        aggregationField,
        serviceIds,
        resourceScopes,
        severityTexts,
        bodySearchText,
        traceIds,
        spanIds,
        sessionIds,
        limit,
      };

      if (chartType === "timeseries") {
        const data: Array<AnalyticsTimeseriesRow> =
          await LogAggregationService.getAnalyticsTimeseries(request);

        return Response.sendJsonObjectResponse(req, res, {
          data: data as unknown as JSONObject,
        });
      }

      if (chartType === "toplist") {
        const data: Array<AnalyticsTopItem> =
          await LogAggregationService.getAnalyticsTopList(request);

        return Response.sendJsonObjectResponse(req, res, {
          data: data as unknown as JSONObject,
        });
      }

      // table
      const data: Array<AnalyticsTableRow> =
        await LogAggregationService.getAnalyticsTable(request);

      return Response.sendJsonObjectResponse(req, res, {
        data: data as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Log Error Pattern Endpoints ---

/*
 * Shared body parsing for the two error-pattern endpoints. Both take the
 * same filter shape as the histogram/facet endpoints so the Insights page
 * can hand its one scope (time range, service selection, severities) to
 * every panel it draws; the detail endpoint adds the pattern itself.
 *
 * Defensive about shapes throughout: these bodies come from the browser,
 * and a stringly-typed or null field must mean "no filter" rather than
 * becoming an active predicate that silently narrows the result.
 */
function parseErrorPatternFilterBody(
  body: JSONObject,
  projectId: ObjectID,
): Omit<ErrorPatternFilters, "startTime" | "endTime"> {
  const stringArray: (value: unknown) => Array<string> | undefined = (
    value: unknown,
  ): Array<string> | undefined => {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const values: Array<string> = (value as Array<unknown>).filter(
      (item: unknown): item is string => {
        return typeof item === "string" && item.length > 0;
      },
    );

    return values.length > 0 ? values : undefined;
  };

  const serviceIdStrings: Array<string> | undefined = stringArray(
    body["serviceIds"],
  );

  return {
    projectId,
    serviceIds: serviceIdStrings
      ? serviceIdStrings.map((id: string): ObjectID => {
          return new ObjectID(id);
        })
      : undefined,
    entityKeys: stringArray(body["entityKeys"]),
    severityTexts: stringArray(body["severityTexts"]),
    bodySearchText:
      typeof body["bodySearchText"] === "string" &&
      body["bodySearchText"].trim().length > 0
        ? (body["bodySearchText"] as string)
        : undefined,
    traceIds: stringArray(body["traceIds"]),
    spanIds: stringArray(body["spanIds"]),
    sessionIds: stringArray(body["sessionIds"]),
    attributes: parseAttributeFilterRecord(body["attributes"]),
  };
}

/*
 * Default window for the error-pattern endpoints: 24 hours rather than the
 * one hour the histogram defaults to. "Top errors" is a question about a
 * period long enough for a pattern to establish itself; an hour of a quiet
 * service routinely has nothing in it.
 */
function parseErrorPatternWindow(body: JSONObject): {
  startTime: Date;
  endTime: Date;
} {
  const endTime: Date = body["endTime"]
    ? OneUptimeDate.fromString(body["endTime"] as string)
    : OneUptimeDate.getCurrentDate();

  const startTime: Date = body["startTime"]
    ? OneUptimeDate.fromString(body["startTime"] as string)
    : OneUptimeDate.addRemoveHours(endTime, -24);

  return { startTime, endTime };
}

router.post(
  "/telemetry/logs/error-patterns",
  ...requireLogReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;
      const window: { startTime: Date; endTime: Date } =
        parseErrorPatternWindow(body);

      const request: TopErrorPatternsRequest = {
        ...parseErrorPatternFilterBody(body, databaseProps.tenantId),
        ...window,
        resourceScopes: await resolveResourceScopesFromBody(
          body,
          databaseProps.tenantId,
        ),
        limit: typeof body["limit"] === "number" ? body["limit"] : undefined,
      };

      const patterns: Array<TopErrorPattern> =
        await LogAggregationService.getTopErrorPatterns(request);

      return Response.sendJsonObjectResponse(req, res, {
        patterns: patterns as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

/*
 * Everything the UI needs to explain ONE error pattern, in a single round
 * trip: when it fired, what else fired alongside it, what the occurrences
 * have in common, which resources and traces carry it, and a handful of
 * raw lines.
 *
 * The six aggregations run concurrently and each degrades to an empty
 * result on its own failure. A correlation panel is supplementary
 * information — one slow or unlucky sub-query should cost the user that
 * section, not the whole page.
 */
router.post(
  "/telemetry/logs/error-pattern-correlation",
  ...requireLogReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const pattern: string =
        typeof body["pattern"] === "string" ? (body["pattern"] as string) : "";

      if (pattern.trim().length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("pattern is required"),
        );
      }

      const window: { startTime: Date; endTime: Date } =
        parseErrorPatternWindow(body);

      const bucketSizeInMinutes: number =
        typeof body["bucketSizeInMinutes"] === "number" &&
        body["bucketSizeInMinutes"] > 0
          ? (body["bucketSizeInMinutes"] as number)
          : computeDefaultBucketSize(window.startTime, window.endTime);

      const detailRequest: ErrorPatternTimelineRequest = {
        ...parseErrorPatternFilterBody(body, databaseProps.tenantId),
        ...window,
        resourceScopes: await resolveResourceScopesFromBody(
          body,
          databaseProps.tenantId,
        ),
        pattern,
        bucketSizeInMinutes,
        limit: typeof body["limit"] === "number" ? body["limit"] : undefined,
      };

      const degradeToEmpty: <T>(
        promise: Promise<Array<T>>,
      ) => Promise<Array<T>> = async <T>(
        promise: Promise<Array<T>>,
      ): Promise<Array<T>> => {
        try {
          return await promise;
        } catch {
          return [];
        }
      };

      const [timeline, coOccurring, attributes, resources, traces, samples] =
        await Promise.all([
          degradeToEmpty(
            LogAggregationService.getErrorPatternTimeline(detailRequest),
          ),
          degradeToEmpty(
            LogAggregationService.getErrorPatternCoOccurrences(detailRequest),
          ),
          degradeToEmpty(
            LogAggregationService.getErrorPatternAttributes(detailRequest),
          ),
          degradeToEmpty(
            LogAggregationService.getErrorPatternResources(detailRequest),
          ),
          degradeToEmpty(
            LogAggregationService.getErrorPatternTraces(detailRequest),
          ),
          degradeToEmpty(
            LogAggregationService.getErrorPatternSamples(detailRequest),
          ),
        ]);

      return Response.sendJsonObjectResponse(req, res, {
        pattern,
        bucketSizeInMinutes,
        timeline: timeline as unknown as JSONObject,
        coOccurringPatterns: coOccurring as unknown as JSONObject,
        attributes: attributes as unknown as JSONObject,
        resources: resources as unknown as JSONObject,
        traces: traces as unknown as JSONObject,
        samples: samples as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Log Export Endpoint ---

router.post(
  "/telemetry/logs/export",
  ...requireLogReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const limit: number = Math.min((body["limit"] as number) || 10000, 10000);

      const format: string = (body["format"] as string) || "json";

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const severityTexts: Array<string> | undefined = body["severityTexts"]
        ? (body["severityTexts"] as Array<string>)
        : undefined;

      const bodySearchText: string | undefined = body["bodySearchText"]
        ? (body["bodySearchText"] as string)
        : undefined;

      const traceIds: Array<string> | undefined = body["traceIds"]
        ? (body["traceIds"] as Array<string>)
        : undefined;

      const spanIds: Array<string> | undefined = body["spanIds"]
        ? (body["spanIds"] as Array<string>)
        : undefined;

      const sessionIds: Array<string> | undefined = body["sessionIds"]
        ? (body["sessionIds"] as Array<string>)
        : undefined;

      const rows: Array<JSONObject> = await LogAggregationService.getExportLogs(
        {
          projectId: databaseProps.tenantId,
          startTime,
          endTime,
          limit,
          serviceIds,
          severityTexts,
          bodySearchText,
          traceIds,
          spanIds,
          sessionIds,
        },
      );

      if (format === "csv") {
        const header: string =
          "time,primaryEntityId,severityText,severityNumber,body,traceId,spanId,attributes";
        const csvRows: Array<string> = rows.map((row: JSONObject) => {
          const escapeCsv: (val: unknown) => string = (
            val: unknown,
          ): string => {
            const str: string =
              val === null || val === undefined ? "" : String(val);
            if (str.includes(",") || str.includes('"') || str.includes("\n")) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };

          return [
            escapeCsv(row["time"]),
            escapeCsv(row["primaryEntityId"]),
            escapeCsv(row["severityText"]),
            escapeCsv(row["severityNumber"]),
            escapeCsv(row["body"]),
            escapeCsv(row["traceId"]),
            escapeCsv(row["spanId"]),
            escapeCsv(JSON.stringify(row["attributes"] || {})),
          ].join(",");
        });

        const csv: string = [header, ...csvRows].join("\n");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=logs-export.csv",
        );
        res.status(200).send(csv);
        return;
      }

      // JSON format
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=logs-export.json",
      );
      res.status(200).send(JSON.stringify(rows, null, 2));
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Log Context Endpoint ---

router.post(
  "/telemetry/logs/context",
  ...requireLogReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const logId: string | undefined = body["logId"] as string | undefined;
      // `serviceId` is the pre-rename alias kept for stale clients.
      const primaryEntityId: string | undefined = (body["primaryEntityId"] ||
        body["serviceId"]) as string | undefined;
      const time: string | undefined = body["time"] as string | undefined;

      if (!logId || !primaryEntityId || !time) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("logId, primaryEntityId, and time are required"),
        );
      }

      const count: number = (body["count"] as number) || 5;

      const sessionIds: Array<string> | undefined = body["sessionIds"]
        ? (body["sessionIds"] as Array<string>)
        : undefined;

      const result: {
        before: Array<JSONObject>;
        after: Array<JSONObject>;
      } = await LogAggregationService.getLogContext({
        projectId: databaseProps.tenantId,
        primaryEntityId: new ObjectID(primaryEntityId),
        time: OneUptimeDate.fromString(time),
        logId,
        count,
        sessionIds,
      });

      return Response.sendJsonObjectResponse(req, res, {
        before: result.before as unknown as JSONObject,
        after: result.after as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Drop Filter Estimate Endpoint ---

router.post(
  "/telemetry/logs/drop-filter-estimate",
  ...requireLogReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const filterQuery: string | undefined = body["filterQuery"] as
        | string
        | undefined;

      if (!filterQuery) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("filterQuery is required"),
        );
      }

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -24);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const severityTexts: Array<string> | undefined = body["severityTexts"]
        ? (body["severityTexts"] as Array<string>)
        : undefined;

      const result: {
        totalLogs: number;
        matchingLogs: number;
        estimatedReductionPercent: number;
      } = await LogAggregationService.getDropFilterEstimate({
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        filterQuery,
        serviceIds,
        severityTexts,
      });

      return Response.sendJsonObjectResponse(req, res, {
        totalLogs: result.totalLogs,
        matchingLogs: result.matchingLogs,
        estimatedReductionPercent: result.estimatedReductionPercent,
      } as unknown as JSONObject);
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Helpers ---

function computeDefaultBucketSize(startTime: Date, endTime: Date): number {
  const diffMs: number = endTime.getTime() - startTime.getTime();
  const diffMinutes: number = diffMs / (1000 * 60);

  if (diffMinutes <= 60) {
    return 1;
  }

  if (diffMinutes <= 360) {
    return 5;
  }

  if (diffMinutes <= 1440) {
    return 15;
  }

  if (diffMinutes <= 10080) {
    return 60;
  }

  if (diffMinutes <= 43200) {
    return 360;
  }

  return 1440;
}

// --- Profile Get Attributes Endpoint ---

router.post(
  "/telemetry/profiles/get-attributes",
  ...requireProfileReadAccess,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Profile);
  },
);

// --- Profile Flamegraph Endpoint ---

router.post(
  "/telemetry/profiles/flamegraph",
  ...requireProfileReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const profileId: string | undefined = body["profileId"]
        ? (body["profileId"] as string)
        : undefined;

      const startTime: Date | undefined = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : undefined;

      const endTime: Date | undefined = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : undefined;

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const profileType: string | undefined = body["profileType"]
        ? (body["profileType"] as string)
        : undefined;

      const profileTypes: Array<string> | undefined = Array.isArray(
        body["profileTypes"],
      )
        ? (body["profileTypes"] as Array<string>).filter(
            (t: unknown): t is string => {
              return typeof t === "string" && t.length > 0;
            },
          )
        : undefined;

      const traceId: string | undefined =
        body["traceId"] && typeof body["traceId"] === "string"
          ? (body["traceId"] as string)
          : undefined;

      const spanIds: Array<string> | undefined = Array.isArray(body["spanIds"])
        ? (body["spanIds"] as Array<string>).filter(
            (s: unknown): s is string => {
              return typeof s === "string" && s.length > 0;
            },
          )
        : undefined;

      /*
       * A traceId bounds the read as tightly as a profileId (bloom-indexed
       * point lookup), so it also satisfies the scoping requirement.
       */
      if (!profileId && !startTime && !traceId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Either profileId, startTime, or traceId must be provided",
          ),
        );
      }

      const request: FlamegraphRequest = {
        projectId: databaseProps.tenantId,
        ...(profileId !== undefined && { profileId }),
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(serviceIds !== undefined && { serviceIds }),
        ...(profileType !== undefined && { profileType }),
        ...(profileTypes !== undefined &&
          profileTypes.length > 0 && { profileTypes }),
        ...(traceId !== undefined && { traceId }),
        ...(spanIds !== undefined && spanIds.length > 0 && { spanIds }),
      };

      const result: FlamegraphResult =
        await ProfileAggregationService.getFlamegraph(request);

      return Response.sendJsonObjectResponse(req, res, {
        flamegraph: result.flamegraph as unknown as JSONObject,
        truncated: result.truncated,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Profile Function List Endpoint ---

router.post(
  "/telemetry/profiles/function-list",
  ...requireProfileReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const profileId: string | undefined = body["profileId"]
        ? (body["profileId"] as string)
        : undefined;

      const traceId: string | undefined =
        body["traceId"] && typeof body["traceId"] === "string"
          ? (body["traceId"] as string)
          : undefined;

      const spanIds: Array<string> | undefined = Array.isArray(body["spanIds"])
        ? (body["spanIds"] as Array<string>).filter(
            (s: unknown): s is string => {
              return typeof s === "string" && s.length > 0;
            },
          )
        : undefined;

      /*
       * Only default the window when neither profileId nor traceId is
       * given: a profile's samples are bounded by the profile itself (and
       * a trace's by the trace), so a defaulted last-hour window would
       * silently exclude anything captured before the window started.
       */
      const startTime: Date | undefined = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : profileId || traceId
          ? undefined
          : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date | undefined = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : profileId || traceId
          ? undefined
          : OneUptimeDate.getCurrentDate();

      if (!profileId && !startTime && !traceId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Either profileId, startTime, or traceId must be provided",
          ),
        );
      }

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const profileType: string | undefined = body["profileType"]
        ? (body["profileType"] as string)
        : undefined;

      const profileTypes: Array<string> | undefined = Array.isArray(
        body["profileTypes"],
      )
        ? (body["profileTypes"] as Array<string>).filter(
            (t: unknown): t is string => {
              return typeof t === "string" && t.length > 0;
            },
          )
        : undefined;

      const limit: number | undefined = body["limit"]
        ? (body["limit"] as number)
        : undefined;

      const sortBy: "selfValue" | "totalValue" | "sampleCount" | undefined =
        body["sortBy"]
          ? (body["sortBy"] as "selfValue" | "totalValue" | "sampleCount")
          : undefined;

      const request: FunctionListRequest = {
        projectId: databaseProps.tenantId,
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(profileId !== undefined && { profileId }),
        ...(serviceIds !== undefined && { serviceIds }),
        ...(profileType !== undefined && { profileType }),
        ...(profileTypes !== undefined &&
          profileTypes.length > 0 && { profileTypes }),
        ...(traceId !== undefined && { traceId }),
        ...(spanIds !== undefined && spanIds.length > 0 && { spanIds }),
        ...(limit !== undefined && { limit }),
        ...(sortBy !== undefined && { sortBy }),
      };

      const result: FunctionListResult =
        await ProfileAggregationService.getFunctionList(request);

      return Response.sendJsonObjectResponse(req, res, {
        functions: result.functions as unknown as JSONObject,
        windowTotal: result.windowTotal,
        truncated: result.truncated,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Profile Service Activity Endpoint ---

router.post(
  "/telemetry/profiles/service-activity",
  ...requireProfileReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const profileType: string | undefined = body["profileType"]
        ? (body["profileType"] as string)
        : undefined;

      const profileTypes: Array<string> | undefined = Array.isArray(
        body["profileTypes"],
      )
        ? (body["profileTypes"] as Array<string>).filter(
            (t: unknown): t is string => {
              return typeof t === "string" && t.length > 0;
            },
          )
        : undefined;

      const request: ServiceActivityRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        ...(profileType !== undefined && { profileType }),
        ...(profileTypes !== undefined &&
          profileTypes.length > 0 && { profileTypes }),
      };

      const activity: Array<ServiceActivityItem> =
        await ProfileAggregationService.getServiceActivity(request);

      return Response.sendJsonObjectResponse(req, res, {
        activity: activity as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Profile pprof Export Endpoint ---

router.get(
  "/telemetry/profiles/:profileId/pprof",
  ...requireProfileReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const profileId: string | undefined = req.params["profileId"];

      if (!profileId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("profileId is required"),
        );
      }

      // Fetch profile metadata
      const profiles: Array<Profile> = await ProfileService.findBy({
        query: {
          projectId: databaseProps.tenantId,
          profileId: profileId,
        },
        select: {
          profileId: true,
          profileType: true,
          unit: true,
          periodType: true,
          period: true,
          startTime: true,
          endTime: true,
          durationNano: true,
        },
        limit: 1,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (!profiles[0]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Profile not found"),
        );
      }

      const profile: Profile = profiles[0];

      // Fetch profile samples
      const samplesResult: Array<ProfileSample> =
        await ProfileSampleService.findBy({
          query: {
            projectId: databaseProps.tenantId,
            profileId: profileId,
          },
          select: {
            stacktrace: true,
            value: true,
            labels: true,
          },
          limit: 50000,
          skip: 0,
          sort: {
            value: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        });

      const pprofSamples: Array<PprofSample> = samplesResult.map(
        (sample: ProfileSample): PprofSample => {
          return {
            stacktrace: sample.stacktrace || [],
            value: sample.value || 0,
            labels: sample.labels as JSONObject | undefined,
          };
        },
      );

      const pprofProfile: PprofProfile = {
        profileId: profile.profileId || profileId,
        profileType: profile.profileType || "cpu",
        unit: profile.unit || "nanoseconds",
        periodType: profile.periodType || "cpu",
        period: profile.period || 0,
        startTimeNanos: profile.startTime
          ? new Date(profile.startTime).getTime() * 1000000
          : 0,
        endTimeNanos: profile.endTime
          ? new Date(profile.endTime).getTime() * 1000000
          : 0,
        durationNanos: profile.durationNano || 0,
        samples: pprofSamples,
      };

      const compressed: Buffer =
        await PprofEncoder.encodeAndCompress(pprofProfile);

      res.setHeader("Content-Type", "application/x-protobuf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=profile-${profileId}.pb.gz`,
      );
      res.setHeader("Content-Length", compressed.length.toString());
      res.send(compressed);
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Profile Diff Flamegraph Endpoint ---

router.post(
  "/telemetry/profiles/diff-flamegraph",
  ...requireProfileReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const baselineStartTime: Date | undefined = body["baselineStartTime"]
        ? OneUptimeDate.fromString(body["baselineStartTime"] as string)
        : undefined;

      const baselineEndTime: Date | undefined = body["baselineEndTime"]
        ? OneUptimeDate.fromString(body["baselineEndTime"] as string)
        : undefined;

      const comparisonStartTime: Date | undefined = body["comparisonStartTime"]
        ? OneUptimeDate.fromString(body["comparisonStartTime"] as string)
        : undefined;

      const comparisonEndTime: Date | undefined = body["comparisonEndTime"]
        ? OneUptimeDate.fromString(body["comparisonEndTime"] as string)
        : undefined;

      if (
        !baselineStartTime ||
        !baselineEndTime ||
        !comparisonStartTime ||
        !comparisonEndTime
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "baselineStartTime, baselineEndTime, comparisonStartTime, and comparisonEndTime are all required",
          ),
        );
      }

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const profileType: string | undefined = body["profileType"]
        ? (body["profileType"] as string)
        : undefined;

      const profileTypes: Array<string> | undefined = Array.isArray(
        body["profileTypes"],
      )
        ? (body["profileTypes"] as Array<string>).filter(
            (t: unknown): t is string => {
              return typeof t === "string" && t.length > 0;
            },
          )
        : undefined;

      const request: DiffFlamegraphRequest = {
        projectId: databaseProps.tenantId,
        baselineStartTime,
        baselineEndTime,
        comparisonStartTime,
        comparisonEndTime,
        ...(serviceIds !== undefined && { serviceIds }),
        ...(profileType !== undefined && { profileType }),
        ...(profileTypes !== undefined &&
          profileTypes.length > 0 && { profileTypes }),
      };

      const result: { diffFlamegraph: DiffFlamegraphNode; truncated: boolean } =
        await ProfileAggregationService.getDiffFlamegraph(request);

      /*
       * `truncated` is surfaced so the UI can warn that the diff was built
       * from a capped sample set rather than the full window.
       */
      return Response.sendJsonObjectResponse(req, res, {
        diffFlamegraph: result.diffFlamegraph as unknown as JSONObject,
        truncated: result.truncated,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Profile Function Focus Endpoint ---

router.post(
  "/telemetry/profiles/function-focus",
  ...requireProfileReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const functionName: string | undefined =
        body["functionName"] && typeof body["functionName"] === "string"
          ? (body["functionName"] as string)
          : undefined;

      if (!functionName) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("functionName is required"),
        );
      }

      /*
       * fileName participates in frame identity (frames match on
       * functionName + fileName; line numbers are ignored so identity
       * survives deploys) but may legitimately be empty: folded uploads
       * produce bare frames with no file information.
       */
      const fileName: string =
        typeof body["fileName"] === "string"
          ? (body["fileName"] as string)
          : "";

      const profileId: string | undefined = body["profileId"]
        ? (body["profileId"] as string)
        : undefined;

      const startTime: Date | undefined = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : undefined;

      const endTime: Date | undefined = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : undefined;

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const profileType: string | undefined = body["profileType"]
        ? (body["profileType"] as string)
        : undefined;

      const profileTypes: Array<string> | undefined = Array.isArray(
        body["profileTypes"],
      )
        ? (body["profileTypes"] as Array<string>).filter(
            (t: unknown): t is string => {
              return typeof t === "string" && t.length > 0;
            },
          )
        : undefined;

      const traceId: string | undefined =
        body["traceId"] && typeof body["traceId"] === "string"
          ? (body["traceId"] as string)
          : undefined;

      const spanIds: Array<string> | undefined = Array.isArray(body["spanIds"])
        ? (body["spanIds"] as Array<string>).filter(
            (s: unknown): s is string => {
              return typeof s === "string" && s.length > 0;
            },
          )
        : undefined;

      /*
       * A traceId bounds the read as tightly as a profileId (bloom-indexed
       * point lookup), so it also satisfies the scoping requirement.
       */
      if (!profileId && !startTime && !traceId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Either profileId, startTime, or traceId must be provided",
          ),
        );
      }

      const request: FunctionFocusRequest = {
        projectId: databaseProps.tenantId,
        functionName,
        fileName,
        ...(profileId !== undefined && { profileId }),
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(serviceIds !== undefined && { serviceIds }),
        ...(profileType !== undefined && { profileType }),
        ...(profileTypes !== undefined &&
          profileTypes.length > 0 && { profileTypes }),
        ...(traceId !== undefined && { traceId }),
        ...(spanIds !== undefined && spanIds.length > 0 && { spanIds }),
      };

      const result: FunctionFocusResult =
        await ProfileAggregationService.getFunctionFocus(request);

      return Response.sendJsonObjectResponse(req, res, {
        functionName: result.functionName,
        fileName: result.fileName,
        totalValue: result.totalValue,
        selfValue: result.selfValue,
        sampleCount: result.sampleCount,
        windowTotal: result.windowTotal,
        callers: result.callers as unknown as JSONObject,
        callees: result.callees as unknown as JSONObject,
        truncated: result.truncated,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Profile Breakdown Endpoint ---

router.post(
  "/telemetry/profiles/breakdown",
  ...requireProfileReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const startTime: Date | undefined = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : undefined;

      const endTime: Date | undefined = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : undefined;

      /*
       * breakdownBy is either the reserved key 'service' (grouping by
       * primaryEntityId, resolved to display names by the UI) or a Profile
       * attribute key.
       */
      const breakdownBy: string | undefined =
        body["breakdownBy"] && typeof body["breakdownBy"] === "string"
          ? (body["breakdownBy"] as string)
          : undefined;

      if (!startTime || !endTime || !breakdownBy) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "startTime, endTime, and breakdownBy are all required",
          ),
        );
      }

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map((id: string) => {
            return new ObjectID(id);
          })
        : undefined;

      const profileType: string | undefined = body["profileType"]
        ? (body["profileType"] as string)
        : undefined;

      const profileTypes: Array<string> | undefined = Array.isArray(
        body["profileTypes"],
      )
        ? (body["profileTypes"] as Array<string>).filter(
            (t: unknown): t is string => {
              return typeof t === "string" && t.length > 0;
            },
          )
        : undefined;

      const limit: number | undefined = body["limit"]
        ? (body["limit"] as number)
        : undefined;

      const request: BreakdownRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        breakdownBy,
        ...(serviceIds !== undefined && { serviceIds }),
        ...(profileType !== undefined && { profileType }),
        ...(profileTypes !== undefined &&
          profileTypes.length > 0 && { profileTypes }),
        ...(limit !== undefined && { limit }),
      };

      const result: BreakdownResult =
        await ProfileAggregationService.getBreakdown(request);

      return Response.sendJsonObjectResponse(req, res, {
        items: result.items as unknown as JSONObject,
        totalSampleCount: result.totalSampleCount,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Profile Trace Presence Endpoint ---

router.post(
  "/telemetry/profiles/trace-presence",
  ...requireProfileReadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      const body: JSONObject = req.body as JSONObject;

      const traceId: string | undefined =
        body["traceId"] && typeof body["traceId"] === "string"
          ? (body["traceId"] as string)
          : undefined;

      if (!traceId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("traceId is required"),
        );
      }

      const spanIds: Array<string> | undefined = Array.isArray(body["spanIds"])
        ? (body["spanIds"] as Array<string>).filter(
            (s: unknown): s is string => {
              return typeof s === "string" && s.length > 0;
            },
          )
        : undefined;

      const result: TracePresenceResult =
        await ProfileAggregationService.getTracePresence({
          projectId: databaseProps.tenantId,
          traceId,
          ...(spanIds !== undefined && spanIds.length > 0 && { spanIds }),
        });

      return Response.sendJsonObjectResponse(req, res, {
        sampleCount: result.sampleCount,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

/*
 * ---------------------------------------------------------------------
 * Session replay playback
 * ---------------------------------------------------------------------
 *
 * These five routes are the ONLY reader of RumSessionV1 / RumSessionChunkV1:
 * both analytics models deliberately omit `crudApiPath`, so there is no
 * generic CRUD surface for them and ModelPermission is NEVER invoked on
 * this path.
 *
 * That has a consequence which is easy to get wrong and expensive to get
 * wrong: the `payload` column's own read ACL and the narrower ACL on
 * `identifiedUserLabel` are, on their own, decorative here. Nothing
 * enforces them unless this file does. Hence a dedicated guard rather
 * than createTelemetryReadAccessGuard above, whose OR-list already
 * contains ProjectMember, Viewer and TelemetryViewer - reusing it would
 * let every read-only member of a project watch recordings of that
 * project's real end users, which is precisely the outcome the design
 * rejected.
 *
 * Declared before the route registrations below for the same
 * temporal-dead-zone reason the guards at the top of this file are.
 */

/*
 * Listing sessions. Mirrors RumSession's table-level read ACL exactly:
 * knowing WHICH sessions errored is triage.
 *
 * Including the PAYLOAD permission, which that ACL also carries and this
 * guard used to omit. Watching implies listing: the payload routes authorize
 * on ReadRumSessionReplayPayload alone, so a role granted only "Watch
 * Session Replays" could play back any session whose id it was handed while
 * being 401'd on the list, the manifest and the exception page's replay card
 * - an incoherent grant rather than a safer one, and exactly what
 * RumSession's own comment says the ACL exists to prevent.
 */
const requireSessionReplayListAccess: Array<RequestHandler> = [
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.ReadRumSessionReplay,
      Permission.ReadRumSessionReplayPayload,
    ],
  }),
];

/*
 * Watching a session. Deliberately a strict subset of the list guard's
 * audience: reading a recording of a real person's screen is a further
 * disclosure over knowing that their session went wrong. Mirrors the
 * `payload` column ACL on RumSessionChunk.
 */
const requireSessionReplayPayloadAccess: Array<RequestHandler> = [
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.ReadRumSessionReplayPayload,
    ],
  }),
];

/* The permission list each guard above enforces, reused for label scope. */
const SESSION_REPLAY_LIST_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.ReadRumSessionReplay,
  /*
   * Watching implies listing.
   *
   * RumSession's own table read ACL contains this permission for a reason it
   * states outright: a role granted only the watch permission could fetch
   * payloads (the payload routes authorize on it alone) while being 401'd on
   * the manifest and the list - an incoherent grant rather than a safer one.
   * Leaving it out here meant a support-engineer role built from "Watch
   * Session Replays" + "Read RUM Application" - the natural pairing, and the
   * one the permission's own description suggests - got a permission error
   * on the session list and a silently missing "Watch what the user saw"
   * card on every exception page.
   */
  Permission.ReadRumSessionReplayPayload,
];

const SESSION_REPLAY_PAYLOAD_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.ReadRumSessionReplayPayload,
];

/*
 * The raw end-user identifier carries its own narrower ACL on the model
 * (no TelemetryAdmin): knowing that *a* user had a bad session is triage,
 * knowing *which named person* is a further disclosure again.
 */
const SESSION_REPLAY_IDENTITY_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadRumSessionReplayPayload,
];

/*
 * Label scope for a set of permissions, mirroring the private
 * AccessControlPermission.getAccessControlIdsByPermissions.
 *
 * Returned as a discriminated result rather than as an array whose
 * emptiness has to be interpreted. An empty array previously meant BOTH
 * "unrestricted" and "we could not work out a restriction", and every
 * caller read it as the former - which is a fail-OPEN default for the one
 * kind of answer that must fail closed.
 *
 * Reimplemented here rather than routed through RumApplicationService
 * with the caller's props on purpose: RumApplication's own read ACL
 * requires ReadRumApplication / ProjectMember / Viewer, none of which a
 * narrowly-scoped session-replay reviewer necessarily holds, so going
 * through it would deny legitimate callers.
 */
type SessionReplayScope =
  | { isUnrestricted: true }
  /*
   * At least one label the RUM application must carry. An EMPTY array
   * here means the caller reaches nothing at all, which is a real and
   * different answer from "unrestricted".
   */
  | { isUnrestricted: false; labelIds: Array<ObjectID> };

type SessionReplayLabelScopeFunction = (
  databaseProps: DatabaseCommonInteractionProps,
  permissions: Array<Permission>,
) => SessionReplayScope;

const getSessionReplayLabelScope: SessionReplayLabelScopeFunction = (
  databaseProps: DatabaseCommonInteractionProps,
  permissions: Array<Permission>,
): SessionReplayScope => {
  if (databaseProps.isRoot || databaseProps.isMasterAdmin) {
    return { isUnrestricted: true };
  }

  const userPermissions: Array<UserPermission> =
    DatabaseCommonInteractionPropsUtil.getUserPermissions(
      databaseProps,
      PermissionType.Allow,
    );

  const unscopedPermissions: Array<Permission> =
    PermissionHelper.getNonAccessControlPermissions(userPermissions);

  if (
    PermissionHelper.doesPermissionsIntersect(permissions, unscopedPermissions)
  ) {
    return { isUnrestricted: true };
  }

  const scopedPermissions: Array<UserPermission> =
    PermissionHelper.getAccessControlPermissions(userPermissions);

  const labelIds: Array<ObjectID> = [];

  for (const permission of permissions) {
    for (const scopedPermission of scopedPermissions) {
      if (
        scopedPermission.permission === permission &&
        scopedPermission.labelIds.length > 0
      ) {
        labelIds.push(...scopedPermission.labelIds);
      }
    }
  }

  if (labelIds.length > 0) {
    return { isUnrestricted: false, labelIds: labelIds };
  }

  /*
   * Neither an unscoped grant nor a label-scoped one, yet the route guard
   * let the caller in - so the grant they hold carries a scope this
   * bespoke path does not implement. PermissionScope.Owned is the real
   * case: both PermissionHelper filters exclude Owned rows on purpose
   * because the ORM enforces them through
   * OwnedScopePermission.addOwnedScopeToQuery, and there is no such step
   * here. Refusing is the only safe answer; returning "no labels" would
   * hand an administrator's deliberately narrowed reviewer the whole
   * project.
   */
  const hasOwnedScopedGrant: boolean = userPermissions.some(
    (userPermission: UserPermission): boolean => {
      return (
        userPermission.scope === PermissionScope.Owned &&
        permissions.includes(userPermission.permission)
      );
    },
  );

  if (hasOwnedScopedGrant) {
    throw new NotAuthorizedException(
      "Owned-scoped session replay permissions are not supported. Ask an administrator to scope this permission to labels instead.",
    );
  }

  /*
   * No applicable grant at all. This is reachable even behind the route
   * guard, because the guard matches on permission NAME across every
   * tenant permission row while getUserPermissions drops block rows. It
   * means the caller reaches no application, not every application.
   */
  return { isUnrestricted: false, labelIds: [] };
};

/*
 * Ceiling on the RUM applications scanned when resolving a label-scoped
 * caller's reachable set. RUM is keyed by application (service.name), not
 * by end-user device, so a project has tens of these, not millions.
 */
const MAX_RUM_APPLICATIONS_SCANNED: number = 1000;

/*
 * Plan gate for the replay reads.
 *
 * Both replay models declare tableBillingAccessControl.read =
 * PlanType.Growth, and that declaration is enforced by ModelPermission -
 * which is never invoked on this path, because neither model has a
 * crudApiPath. Exactly the same trap as the permission ACLs above, so it
 * gets the same treatment: the declaration is read off the model and
 * applied here rather than being left decorative.
 */
type AssertSessionReplayPlanFunction = (
  databaseProps: DatabaseCommonInteractionProps,
) => void;

const assertSessionReplayPlan: AssertSessionReplayPlanFunction = (
  databaseProps: DatabaseCommonInteractionProps,
): void => {
  if (!IsBillingEnabled || !databaseProps.currentPlan) {
    return;
  }

  const requiredPlan: PlanType | null = new RumSession().getReadBillingPlan();

  if (!requiredPlan) {
    return;
  }

  if (
    !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
      requiredPlan,
      databaseProps.currentPlan,
      getAllEnvVars(),
    )
  ) {
    throw new PaymentRequiredException(
      `Please upgrade your plan to ${requiredPlan} to access session replay.`,
    );
  }
};

/* Label ids carried by a RUM application, read as root. */
type GetRumApplicationLabelIdsFunction = (
  application: RumApplication,
) => Array<string>;

const getRumApplicationLabelIds: GetRumApplicationLabelIdsFunction = (
  application: RumApplication,
): Array<string> => {
  return (application.labels || [])
    .filter((label: Label): boolean => {
      return Boolean(label.id);
    })
    .map((label: Label): string => {
      return label.id!.toString();
    });
};

/*
 * Confirm the caller may reach this RUM application.
 *
 * `rumApplicationId` must always be the value resolved from the session
 * header server-side, never one taken from the request body - taking it
 * from the body would make the check circular and let anyone name an
 * application they do happen to have access to while reading a session
 * from one they do not.
 *
 * The application is loaded as root and the label intersection is done
 * here rather than pushed into the query, because the caller may
 * legitimately hold no RumApplication read permission at all (see the
 * note on getSessionReplayLabelScope) and because the many-to-many label
 * predicate has no typed form on the ORM query surface. Project scope is
 * already guaranteed: the header row was fetched with
 * `WHERE projectId = <tenantId>`, so the id cannot come from another
 * project.
 */
type IsApplicationInSessionReplayScopeFunction = (data: {
  scope: SessionReplayScope;
  application: RumApplication;
}) => boolean;

const isApplicationInSessionReplayScope: IsApplicationInSessionReplayScopeFunction =
  (data: {
    scope: SessionReplayScope;
    application: RumApplication;
  }): boolean => {
    if (data.scope.isUnrestricted) {
      return true;
    }

    const applicationLabelIds: Array<string> = getRumApplicationLabelIds(
      data.application,
    );

    return data.scope.labelIds.some((labelId: ObjectID): boolean => {
      return applicationLabelIds.includes(labelId.toString());
    });
  };

/*
 * Returns the application so callers that need its labels for a second,
 * narrower decision (the identity column) do not have to load it twice.
 */
/*
 * Process-local memory of what the two playback hot paths re-derive on
 * every call: which application a session belongs to (a ClickHouse GROUP
 * BY over the header table) and which labels that application carries (a
 * Postgres lookup). A 480-chunk session is 60 chunk pages, and a live
 * player heartbeats every 15s; without this every one of those paid both
 * lookups again for an answer that had not changed.
 *
 * What is cached is the DATA, never the decision: the label intersection
 * is recomputed against the caller's current permissions on every
 * request, so a revoked grant takes effect immediately. A label edit on
 * the application, or a header re-resolution, lags by at most the TTL -
 * the same lag the ingest gate's policy cache already accepts. The
 * manifest route always resolves fresh (a live session's header changes)
 * and refills the entries the chunk and heartbeat routes then read.
 */
const SESSION_REPLAY_AUTHORIZATION_CACHE_TTL_MS: number = 30 * 1000;
const MAX_SESSION_REPLAY_AUTHORIZATION_CACHE_ENTRIES: number = 2000;

interface CachedRumApplication {
  application: RumApplication;
  expiresAt: number;
}

interface CachedSessionHeader {
  header: SessionReplaySessionHeader;
  expiresAt: number;
}

const rumApplicationCache: Map<string, CachedRumApplication> = new Map<
  string,
  CachedRumApplication
>();
const sessionHeaderCache: Map<string, CachedSessionHeader> = new Map<
  string,
  CachedSessionHeader
>();

type BoundedCacheSetFunction = <TValue>(
  map: Map<string, TValue>,
  key: string,
  value: TValue,
) => void;

const boundedCacheSet: BoundedCacheSetFunction = <TValue>(
  map: Map<string, TValue>,
  key: string,
  value: TValue,
): void => {
  if (
    map.size >= MAX_SESSION_REPLAY_AUTHORIZATION_CACHE_ENTRIES &&
    !map.has(key)
  ) {
    const oldest: string | undefined = map.keys().next().value;

    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }

  map.delete(key);
  map.set(key, value);
};

type LoadRumApplicationForAccessFunction = (data: {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  allowCached: boolean;
}) => Promise<RumApplication | null>;

const loadRumApplicationForAccess: LoadRumApplicationForAccessFunction =
  async (data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    allowCached: boolean;
  }): Promise<RumApplication | null> => {
    const cacheKey: string = `${data.projectId.toString()}:${data.rumApplicationId.toString()}`;

    if (data.allowCached) {
      const cached: CachedRumApplication | undefined =
        rumApplicationCache.get(cacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        return cached.application;
      }
    }

    const application: RumApplication | null =
      await RumApplicationService.findOneBy({
        query: {
          _id: data.rumApplicationId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          labels: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (application) {
      boundedCacheSet(rumApplicationCache, cacheKey, {
        application: application,
        expiresAt: Date.now() + SESSION_REPLAY_AUTHORIZATION_CACHE_TTL_MS,
      });
    }

    return application;
  };

type AssertSessionReplayApplicationAccessFunction = (data: {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  databaseProps: DatabaseCommonInteractionProps;
  permissions: Array<Permission>;
  /* Serve the application's labels from the short-lived cache. */
  allowCached?: boolean | undefined;
}) => Promise<RumApplication>;

const assertSessionReplayApplicationAccess: AssertSessionReplayApplicationAccessFunction =
  async (data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    permissions: Array<Permission>;
    allowCached?: boolean | undefined;
  }): Promise<RumApplication> => {
    const scope: SessionReplayScope = getSessionReplayLabelScope(
      data.databaseProps,
      data.permissions,
    );

    const application: RumApplication | null =
      await loadRumApplicationForAccess({
        projectId: data.projectId,
        rumApplicationId: data.rumApplicationId,
        allowCached: data.allowCached === true,
      });

    /*
     * An application that does not exist in this project is refused the
     * same way an out-of-scope one is, so the endpoint cannot be used to
     * probe which application ids exist elsewhere.
     */
    if (!application) {
      throw new NotAuthorizedException(
        "You do not have access to session replays for this application.",
      );
    }

    if (
      !isApplicationInSessionReplayScope({
        scope: scope,
        application: application,
      })
    ) {
      throw new NotAuthorizedException(
        "You do not have access to session replays for this application.",
      );
    }

    return application;
  };

/*
 * May the caller see the RAW end-user identifier for THIS application?
 *
 * Holding the identity permission somewhere in the project is not enough.
 * identifiedUserLabel carries the narrowest ACL in the schema, and a
 * caller can legitimately hold ReadRumSessionReplay unscoped (so the list
 * route admits them for every application) while their
 * ReadRumSessionReplayPayload grant is scoped to a single label. Checking
 * only the permission name would hand them named end users for every
 * application in the project.
 */
type CanReadIdentifiedUserLabelFunction = (data: {
  databaseProps: DatabaseCommonInteractionProps;
  application: RumApplication;
}) => boolean;

const canReadIdentifiedUserLabel: CanReadIdentifiedUserLabelFunction = (data: {
  databaseProps: DatabaseCommonInteractionProps;
  application: RumApplication;
}): boolean => {
  let scope: SessionReplayScope;

  try {
    scope = getSessionReplayLabelScope(
      data.databaseProps,
      SESSION_REPLAY_IDENTITY_PERMISSIONS,
    );
  } catch {
    /*
     * getSessionReplayLabelScope refuses a scope it cannot enforce. For
     * an optional column the right answer is to omit the column, not to
     * fail the whole listing the caller is otherwise entitled to.
     */
    return false;
  }

  return isApplicationInSessionReplayScope({
    scope: scope,
    application: data.application,
  });
};

/*
 * The set of applications a label-scoped caller may reach, for the
 * project-wide exception lookup which has no single application to
 * resolve. null means unrestricted; an empty array means the caller can
 * reach none, which must return no rows rather than everything.
 */
interface AccessibleRumApplications {
  /* null means unrestricted; see getSessionsForException. */
  applicationIds: Array<ObjectID> | null;
  /*
   * True when the project holds more RUM applications than one scan can
   * cover, so the accessible set may be short. Surfaced rather than
   * swallowed: a quietly incomplete answer to "which sessions saw this
   * exception" is the same failure mode as timeout_overflow_mode =
   * 'break', which this whole read path refuses elsewhere.
   */
  isTruncated: boolean;
}

type ResolveAccessibleRumApplicationIdsFunction = (data: {
  projectId: ObjectID;
  databaseProps: DatabaseCommonInteractionProps;
  permissions: Array<Permission>;
}) => Promise<AccessibleRumApplications>;

const resolveAccessibleRumApplicationIds: ResolveAccessibleRumApplicationIdsFunction =
  async (data: {
    projectId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    permissions: Array<Permission>;
  }): Promise<AccessibleRumApplications> => {
    const scope: SessionReplayScope = getSessionReplayLabelScope(
      data.databaseProps,
      data.permissions,
    );

    if (scope.isUnrestricted) {
      return { applicationIds: null, isTruncated: false };
    }

    if (scope.labelIds.length === 0) {
      /* Reaches no application at all - not "reaches everything". */
      return { applicationIds: [], isTruncated: false };
    }

    const applications: Array<RumApplication> =
      await RumApplicationService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          labels: {
            _id: true,
          },
        },
        /*
         * A deterministic sort so the page that is scanned is at least
         * stable between calls, and one row past the ceiling so hitting
         * it is detectable rather than indistinguishable from a project
         * that happens to have exactly that many applications.
         */
        sort: {
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: MAX_RUM_APPLICATIONS_SCANNED + 1,
        props: {
          isRoot: true,
        },
      });

    const isTruncated: boolean =
      applications.length > MAX_RUM_APPLICATIONS_SCANNED;

    const accessibleIds: Array<ObjectID> = [];

    for (const application of applications.slice(
      0,
      MAX_RUM_APPLICATIONS_SCANNED,
    )) {
      if (
        isApplicationInSessionReplayScope({
          scope: scope,
          application: application,
        }) &&
        application.id
      ) {
        accessibleIds.push(application.id);
      }
    }

    return { applicationIds: accessibleIds, isTruncated: isTruncated };
  };

interface AuthorizedSession {
  header: SessionReplaySessionHeader;
  /*
   * The RumApplication the header was authorized against, with its
   * labels, so a caller that needs a second, narrower decision (the
   * identity columns) does not load it again.
   */
  application: RumApplication;
}

/*
 * Why a sessionId has no playable header. Each answer carries a
 * different code word in its message so a client can tell them apart
 * without parsing prose, and each is a 404: the id was well-formed, there
 * is simply nothing at it.
 */
const GENERIC_MISSING_SESSION_MESSAGE: string =
  "not-found: No session replay exists with this id in this project.";

/*
 * May this caller be told anything specific about a recording belonging to
 * the named application?
 *
 * Deliberately NOT assertSessionReplayApplicationAccess: this runs on the
 * path where the header row is already gone, so the application row may
 * legitimately be gone with it, and an unrestricted caller (a project
 * owner, or anyone holding an unscoped payload grant) must not lose the
 * "expired on <date>" answer because of a deleted application. Only a
 * label-scoped caller needs the row, and for them a row that cannot be
 * loaded is refused.
 */
type IsApplicationInSessionReplayScopeByIdFunction = (data: {
  projectId: ObjectID;
  rumApplicationId: string;
  databaseProps: DatabaseCommonInteractionProps;
}) => Promise<boolean>;

const isApplicationInSessionReplayScopeById: IsApplicationInSessionReplayScopeByIdFunction =
  async (data: {
    projectId: ObjectID;
    rumApplicationId: string;
    databaseProps: DatabaseCommonInteractionProps;
  }): Promise<boolean> => {
    let scope: SessionReplayScope;

    try {
      scope = getSessionReplayLabelScope(
        data.databaseProps,
        SESSION_REPLAY_PAYLOAD_PERMISSIONS,
      );
    } catch {
      /* A scope this path cannot enforce is refused, never widened. */
      return false;
    }

    if (scope.isUnrestricted) {
      return true;
    }

    if (!ObjectID.isValidUUID(data.rumApplicationId)) {
      return false;
    }

    const application: RumApplication | null =
      await loadRumApplicationForAccess({
        projectId: data.projectId,
        rumApplicationId: new ObjectID(data.rumApplicationId),
        allowCached: true,
      });

    if (!application) {
      return false;
    }

    return isApplicationInSessionReplayScope({
      scope: scope,
      application: application,
    });
  };

type ExplainMissingSessionFunction = (data: {
  projectId: ObjectID;
  sessionId: string;
  rumApplicationId: ObjectID | undefined;
  databaseProps: DatabaseCommonInteractionProps;
}) => Promise<NotFoundException>;

const explainMissingSession: ExplainMissingSessionFunction = async (data: {
  projectId: ObjectID;
  sessionId: string;
  rumApplicationId: ObjectID | undefined;
  databaseProps: DatabaseCommonInteractionProps;
}): Promise<NotFoundException> => {
  /*
   * The expired header is resolved FIRST, and not because it is the more
   * likely answer: it is the only lookup that names an application, and
   * nothing specific may be disclosed until that application has been
   * authorized.
   *
   * The expiry answer carries the recording's existence, when it started
   * and what retention the owning application runs. Answered before the
   * access check - which is where it used to sit, since this runs on the
   * path where getSessionHeader found nothing to authorize AGAINST - it let
   * a label-scoped reviewer probe session ids and learn all three for
   * applications outside their scope. That is precisely the existence
   * probing assertSessionReplayApplicationAccess refuses "the same way" for
   * a session that DOES exist.
   *
   * This read is deliberately retention-free (an expired row is the whole
   * point), so it is the one place a scope check has to be written out by
   * hand rather than inherited from resolveAuthorizedSession.
   */
  const expired: SessionReplayExpiredSessionInfo | null =
    await SessionReplayReadService.getExpiredSessionInfo({
      projectId: data.projectId,
      sessionId: data.sessionId,
      rumApplicationId: data.rumApplicationId,
    });

  if (expired && expired.rumApplicationId) {
    if (
      !(await isApplicationInSessionReplayScopeById({
        projectId: data.projectId,
        rumApplicationId: expired.rumApplicationId,
        databaseProps: data.databaseProps,
      }))
    ) {
      return new NotFoundException(GENERIC_MISSING_SESSION_MESSAGE);
    }
  }

  /*
   * Erasure is checked only once the caller is entitled to a specific
   * answer. An erased session may still have a header row until the
   * ClickHouse mutation lands, and "expired" would be the wrong story for
   * a recording that was deliberately destroyed - so it is reported ahead
   * of expiry. The tombstone throws when Redis cannot answer; that is a
   * "cannot tell", which falls through to the header-based answers.
   */
  let isErased: boolean = false;

  try {
    isErased = await isSessionErased({
      projectId: data.projectId.toString(),
      sessionId: data.sessionId,
    });
  } catch {
    isErased = false;
  }

  if (isErased) {
    return new NotFoundException(
      "erased: This recording was erased by a data subject request and cannot be played back.",
    );
  }

  if (expired) {
    const retentionDays: number = Math.max(
      1,
      Math.round(
        (expired.expiresAt.getTime() - expired.startTime.getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    );

    return new NotFoundException(
      `expired: This recording expired on ${expired.expiresAt.toISOString()} under the application's ${retentionDays}-day retention. Its session signals may still be available from logs, traces and exceptions.`,
    );
  }

  return new NotFoundException(GENERIC_MISSING_SESSION_MESSAGE);
};

/*
 * Resolve a caller-supplied sessionId to its header, scoped strictly to
 * the tenant, and authorize the owning application. Every payload-bearing
 * route funnels through this so the authorization decision exists in
 * exactly one place.
 */
type ResolveAuthorizedSessionFunction = (data: {
  projectId: ObjectID;
  sessionId: string;
  databaseProps: DatabaseCommonInteractionProps;
  /*
   * Disambiguator only (see getSessionHeader): which application's
   * recording to read when the same sessionId exists under several. The
   * application the resolved header names is what gets authorized, so a
   * caller cannot widen access by naming one.
   */
  rumApplicationId?: ObjectID | undefined;
  /*
   * Serve the header and the application's labels from the short-lived
   * caches. For the chunk and heartbeat hot paths; the manifest resolves
   * fresh so a live session's header is never stale for a poll.
   */
  allowCached?: boolean | undefined;
}) => Promise<AuthorizedSession>;

const resolveAuthorizedSession: ResolveAuthorizedSessionFunction =
  async (data: {
    projectId: ObjectID;
    sessionId: string;
    databaseProps: DatabaseCommonInteractionProps;
    rumApplicationId?: ObjectID | undefined;
    allowCached?: boolean | undefined;
  }): Promise<AuthorizedSession> => {
    const headerCacheKey: string = `${data.projectId.toString()}:${data.sessionId}:${
      data.rumApplicationId ? data.rumApplicationId.toString() : ""
    }`;

    let header: SessionReplaySessionHeader | null = null;

    if (data.allowCached) {
      const cached: CachedSessionHeader | undefined =
        sessionHeaderCache.get(headerCacheKey);

      if (cached && cached.expiresAt > Date.now()) {
        header = cached.header;
      }
    }

    if (!header) {
      header = await SessionReplayReadService.getSessionHeader({
        projectId: data.projectId,
        sessionId: data.sessionId,
        rumApplicationId: data.rumApplicationId,
      });

      if (header) {
        boundedCacheSet(sessionHeaderCache, headerCacheKey, {
          header: header,
          expiresAt: Date.now() + SESSION_REPLAY_AUTHORIZATION_CACHE_TTL_MS,
        });
      }
    }

    if (!header) {
      throw await explainMissingSession({
        projectId: data.projectId,
        sessionId: data.sessionId,
        rumApplicationId: data.rumApplicationId,
        databaseProps: data.databaseProps,
      });
    }

    const application: RumApplication =
      await assertSessionReplayApplicationAccess({
        projectId: data.projectId,
        rumApplicationId: new ObjectID(header.rumApplicationId),
        databaseProps: data.databaseProps,
        permissions: SESSION_REPLAY_PAYLOAD_PERMISSIONS,
        allowCached: data.allowCached,
      });

    return { header: header, application: application };
  };

/*
 * An optional application id off the body: absent or empty means "not
 * given", anything else must be a well-formed id.
 */
type ReadOptionalObjectIdFromBodyFunction = (
  body: JSONObject,
  key: string,
) => ObjectID | undefined;

const readOptionalObjectIdFromBody: ReadOptionalObjectIdFromBodyFunction = (
  body: JSONObject,
  key: string,
): ObjectID | undefined => {
  const value: unknown = body[key];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
    throw new BadDataException(`${key} is not a valid id`);
  }

  return new ObjectID(value);
};

/*
 * Optional ISO timestamps off the body. A value that is present but does
 * not parse is a bad request, not an Invalid Date bound into ClickHouse
 * (which surfaces as a driver error and a 500).
 */
type ReadOptionalDateFromBodyFunction = (
  body: JSONObject,
  key: string,
) => Date | undefined;

const readOptionalDateFromBody: ReadOptionalDateFromBodyFunction = (
  body: JSONObject,
  key: string,
): Date | undefined => {
  const value: unknown = body[key];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    throw new BadDataException(`${key} must be an ISO-8601 timestamp`);
  }

  const parsed: Date =
    typeof value === "number"
      ? new Date(value)
      : OneUptimeDate.fromString(value);

  if (!Number.isFinite(parsed.getTime())) {
    throw new BadDataException(`${key} must be an ISO-8601 timestamp`);
  }

  return parsed;
};

/*
 * A page size off the body: absent means the default; present means a
 * positive integer, because `LIMIT 2.5` is a driver error and a 500.
 */
type ReadLimitFromBodyFunction = (
  body: JSONObject,
  defaultLimit: number,
  maxLimit: number,
) => number;

const readLimitFromBody: ReadLimitFromBodyFunction = (
  body: JSONObject,
  defaultLimit: number,
  maxLimit: number,
): number => {
  const value: unknown = body["limit"];

  if (value === undefined || value === null) {
    return defaultLimit;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new BadDataException(
      `limit must be a whole number between 1 and ${maxLimit}`,
    );
  }

  return Math.min(value, maxLimit);
};

/*
 * Object ids arrive as untrusted strings. They are always bound as query
 * parameters rather than interpolated, so a bad value cannot inject SQL -
 * but an object or a number would silently stringify to something like
 * "[object Object]" and match nothing, turning a client bug into a
 * confusing empty result instead of an error.
 *
 * The shape is checked as well as the type. ObjectID's constructor
 * validates nothing, so an arbitrary string reaches Postgres as a uuid
 * literal and ClickHouse as a String bound against a UUID column - both
 * of which raise a driver error and surface as a 500. A malformed id is a
 * bad request, not a server fault.
 */
type ReadObjectIdFromBodyFunction = (body: JSONObject, key: string) => ObjectID;

const readObjectIdFromBody: ReadObjectIdFromBodyFunction = (
  body: JSONObject,
  key: string,
): ObjectID => {
  const value: unknown = body[key];

  if (typeof value !== "string" || value.length === 0) {
    throw new BadDataException(`${key} is required`);
  }

  if (!ObjectID.isValidUUID(value)) {
    throw new BadDataException(`${key} is not a valid id`);
  }

  return new ObjectID(value);
};

type ReadSessionIdFromBodyFunction = (body: JSONObject) => string;

/*
 * A session id is 32 hex characters minted in the browser. The cap is
 * generous rather than exact - older recorders and hand-written API
 * callers exist - but it is a cap: an unbounded caller-supplied string
 * reaches ClickHouse as a bound parameter on a hot path.
 */
const MAX_SESSION_REPLAY_SESSION_ID_LENGTH: number = 128;

const readSessionIdFromBody: ReadSessionIdFromBodyFunction = (
  body: JSONObject,
): string => {
  const sessionId: unknown = body["sessionId"];

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new BadDataException("sessionId is required");
  }

  if (sessionId.length > MAX_SESSION_REPLAY_SESSION_ID_LENGTH) {
    throw new BadDataException(
      `sessionId must be at most ${MAX_SESSION_REPLAY_SESSION_ID_LENGTH} characters.`,
    );
  }

  return sessionId;
};

/*
 * Caps on the list's filter inputs.
 *
 * Every array filter becomes an `IN (...)` inside a HAVING, which
 * ClickHouse evaluates per GROUP over the whole window - so the cost of a
 * request is the caller's array length times the number of sessions in
 * range. Uncapped, one request carrying tens of thousands of browser names
 * is a cheap denial of service against the list for any holder of the list
 * permission. The limits are far above any real UI: the filter panel
 * offers a couple of dozen browsers, and no session has more than a
 * handful of routes.
 *
 * Values are TRUNCATED and the array is SLICED rather than refused: an
 * over-long value simply cannot match anything a bounded column holds, so
 * a 400 would add nothing but a confusing error.
 */
const MAX_SESSION_REPLAY_FILTER_ARRAY_LENGTH: number = 50;
const MAX_SESSION_REPLAY_FILTER_VALUE_LENGTH: number = 256;

type ReadStringArrayFromBodyFunction = (
  body: JSONObject,
  key: string,
) => Array<string> | undefined;

const readStringArrayFromBody: ReadStringArrayFromBodyFunction = (
  body: JSONObject,
  key: string,
): Array<string> | undefined => {
  const value: unknown = body[key];

  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings: Array<string> = [];

  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      continue;
    }

    strings.push(item.substring(0, MAX_SESSION_REPLAY_FILTER_VALUE_LENGTH));

    if (strings.length >= MAX_SESSION_REPLAY_FILTER_ARRAY_LENGTH) {
      break;
    }
  }

  return strings.length > 0 ? strings : undefined;
};

/*
 * A single bounded string filter off the body. Same reasoning as the array
 * cap above: the value is compared per group, and nothing a column holds
 * is longer than this.
 */
type ReadBoundedStringFromBodyFunction = (
  body: JSONObject,
  key: string,
) => string | undefined;

const readBoundedStringFromBody: ReadBoundedStringFromBodyFunction = (
  body: JSONObject,
  key: string,
): string | undefined => {
  const value: unknown = body[key];

  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value.substring(0, MAX_SESSION_REPLAY_FILTER_VALUE_LENGTH);
};

/*
 * The tag filter: a plain object of string pairs, each side bounded by the
 * same caps the ingest applied when it stored the map, so a filter can
 * never be longer than a value that could match it. Anything else reads
 * as "no tag filter".
 */
type ReadTagFilterFromBodyFunction = (
  filters: JSONObject,
) => Record<string, string> | undefined;

const readTagFilterFromBody: ReadTagFilterFromBodyFunction = (
  filters: JSONObject,
): Record<string, string> | undefined => {
  const value: unknown = filters["tags"];

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const tags: Record<string, string> = {};
  let count: number = 0;

  for (const key of Object.keys(value as Record<string, unknown>)) {
    const entry: unknown = (value as Record<string, unknown>)[key];

    if (typeof entry !== "string" || key.length === 0) {
      continue;
    }

    if (count >= SESSION_REPLAY_MAX_TAG_KEYS) {
      break;
    }

    tags[key.substring(0, SESSION_REPLAY_MAX_TAG_KEY_LENGTH)] = entry.substring(
      0,
      SESSION_REPLAY_MAX_TAG_VALUE_LENGTH,
    );
    count++;
  }

  return count > 0 ? tags : undefined;
};

/*
 * Can this cursor's sortValue actually be bound into a query?
 *
 * parseSessionReplayListCursor only checks Number.isFinite, which admits
 * 1e300. For the startTime ordering that value becomes `new Date(1e300)` -
 * an Invalid Date, which renders as NaN text and is rejected by the
 * ClickHouse driver, so a crafted or corrupted cursor answered 500 instead
 * of the 400 the handler promises. For the aggregate orderings the value is
 * a count or a duration, and a negative one belongs to no page.
 */
type IsBindableCursorSortValueFunction = (
  cursor: SessionReplayListCursor,
  sortBy: SessionReplaySortBy,
) => boolean;

const isBindableCursorSortValue: IsBindableCursorSortValueFunction = (
  cursor: SessionReplayListCursor,
  sortBy: SessionReplaySortBy,
): boolean => {
  if (sortBy === "startTime") {
    return Number.isFinite(new Date(cursor.sortValue).getTime());
  }

  return cursor.sortValue >= 0;
};

// --- Session Replay List Endpoint ---

router.post(
  "/telemetry/rum/session-replay/list",
  ...requireSessionReplayListAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      assertSessionReplayPlan(databaseProps);

      const projectId: ObjectID = databaseProps.tenantId;
      const body: JSONObject = req.body as JSONObject;

      const rumApplicationId: ObjectID = readObjectIdFromBody(
        body,
        "rumApplicationId",
      );

      /*
       * The application id is caller-supplied here, which is safe only
       * because it is the thing being authorized rather than a lookup key
       * for something already authorized: a caller outside the label
       * scope is refused, and the query is tenant-pinned regardless.
       */
      const application: RumApplication =
        await assertSessionReplayApplicationAccess({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          databaseProps: databaseProps,
          permissions: SESSION_REPLAY_LIST_PERMISSIONS,
        });

      const startTime: Date =
        readOptionalDateFromBody(body, "startTime") ||
        OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -7);

      const endTime: Date =
        readOptionalDateFromBody(body, "endTime") ||
        OneUptimeDate.getCurrentDate();

      /*
       * An inverted window matches nothing, and an empty list with a 200
       * is exactly the answer a client cannot distinguish from "no
       * sessions" - so it is a 400 with the reason instead.
       */
      if (startTime.getTime() > endTime.getTime()) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("startTime must not be after endTime"),
        );
      }

      const limit: number = readLimitFromBody(
        body,
        DEFAULT_SESSION_REPLAY_LIST_LIMIT,
        MAX_SESSION_REPLAY_LIST_LIMIT,
      );

      const rawSortBy: unknown = body["sortBy"];

      if (
        rawSortBy !== undefined &&
        rawSortBy !== null &&
        (typeof rawSortBy !== "string" ||
          !(SESSION_REPLAY_SORT_BY_VALUES as ReadonlyArray<string>).includes(
            rawSortBy,
          ))
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            `sortBy must be one of ${SESSION_REPLAY_SORT_BY_VALUES.join(", ")}.`,
          ),
        );
      }

      const sortBy: SessionReplaySortBy =
        typeof rawSortBy === "string"
          ? (rawSortBy as SessionReplaySortBy)
          : "startTime";

      /*
       * The narrower identity ACL, resolved BEFORE the filters are built.
       *
       * It is enforced by simply not naming the column in the SELECT - there
       * is no ModelPermission on this path to strip it after the fact - and
       * it is decided against the application already loaded by the access
       * check, so a caller whose identity grant is label-scoped elsewhere
       * does not get named end users here.
       *
       * It gates the identity FILTER as well as the column. Without that,
       * a caller deliberately denied the label could still ask "does
       * jane@example.com have sessions here" and read every other field of
       * the answer - a dictionary attack that de-anonymises the list one
       * candidate at a time, and hands back identifiedUserKey as a stable
       * pseudonym to join against the route filter. The permission sets are
       * genuinely different: SESSION_REPLAY_IDENTITY_PERMISSIONS excludes
       * TelemetryAdmin and ReadRumSessionReplay, both of which can list.
       */
      const includeIdentifiedUserLabel: boolean = canReadIdentifiedUserLabel({
        databaseProps: databaseProps,
        application: application,
      });

      const rawFilters: JSONObject = (body["filters"] as JSONObject) || {};

      /*
       * A reference the server cannot hash must be a 400, never a filter
       * that quietly disappears. Dropping it would return the WHOLE
       * unfiltered list with a 200 - the caller sees every session in the
       * project and has no way to tell that the person they asked about was
       * not the one being answered about.
       */
      if (
        rawFilters["identifiedUserRef"] !== undefined &&
        !SessionReplayIdentity.isUsableUserRef(rawFilters["identifiedUserRef"])
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            `identifiedUserRef must be a non-empty string of at most ${SESSION_REPLAY_MAX_USER_REF_LENGTH} characters.`,
          ),
        );
      }

      /*
       * A filter the server understood but did not apply, named in the
       * response.
       *
       * The identity filter is gated on the narrower identity permission.
       * Dropping it silently is the dangerous half of that gate: the
       * request "show me jane@example.com's sessions" then answers 200 with
       * EVERY session in the application, and the caller has no way to tell
       * - least of all when the application has no sessions at all, where
       * even inspecting the rows cannot reveal it. A support engineer opens
       * the wrong recording, and each opening writes an audit row against a
       * real end user.
       *
       * Answered as data rather than as a 403 because the rest of the list
       * IS something the caller may read: the page renders the sessions and
       * says the filter was ignored, instead of failing outright.
       */
      const ignoredFilters: Array<string> = [];

      if (
        !includeIdentifiedUserLabel &&
        SessionReplayIdentity.isUsableUserRef(rawFilters["identifiedUserRef"])
      ) {
        ignoredFilters.push("identifiedUserRef");
      }

      const filters: SessionReplayListFilters = {
        ...(typeof rawFilters["hasError"] === "boolean" && {
          hasError: rawFilters["hasError"],
        }),
        ...(typeof rawFilters["hasFrustration"] === "boolean" && {
          hasFrustration: rawFilters["hasFrustration"],
        }),
        ...(typeof rawFilters["isFinalized"] === "boolean" && {
          isFinalized: rawFilters["isFinalized"],
        }),
        ...(readStringArrayFromBody(rawFilters, "triggerReasons") && {
          triggerReasons: readStringArrayFromBody(rawFilters, "triggerReasons"),
        }),
        ...(readStringArrayFromBody(rawFilters, "browserNames") && {
          browserNames: readStringArrayFromBody(rawFilters, "browserNames"),
        }),
        ...(readStringArrayFromBody(rawFilters, "osNames") && {
          osNames: readStringArrayFromBody(rawFilters, "osNames"),
        }),
        ...(readStringArrayFromBody(rawFilters, "deviceTypes") && {
          deviceTypes: readStringArrayFromBody(rawFilters, "deviceTypes"),
        }),
        ...(readStringArrayFromBody(rawFilters, "countryCodes") && {
          countryCodes: readStringArrayFromBody(rawFilters, "countryCodes"),
        }),
        /*
         * The caller sends the end-user reference their own page supplied -
         * the value the session list displays - and the server derives the
         * digest with the same per-project HMAC the ingest used. Hashing
         * here rather than in the browser is what keeps the derivation (and
         * the EncryptionSecret it is keyed on) server-side, and it is the
         * only reason this filter can match anything: the raw key is
         * displayed nowhere in the product, so a user had no way to obtain
         * the value the field used to demand.
         *
         * Gated on the identity permission, and validated above so an
         * unusable reference is a 400 rather than a silently unfiltered
         * list.
         */
        ...(includeIdentifiedUserLabel &&
          SessionReplayIdentity.isUsableUserRef(
            rawFilters["identifiedUserRef"],
          ) && {
            identifiedUserKey: SessionReplayIdentity.buildUserKey({
              projectId: projectId,
              userRef: rawFilters["identifiedUserRef"] as string,
            }),
          }),
        /*
         * Still accepted, for API callers that already hold a digest (an
         * erasure workflow, a saved view). Ignored when a reference was also
         * sent, since the reference is the one a human typed. The digest is
         * not guessable and is already returned to every list-capable
         * caller, so it needs no identity gate of its own.
         */
        ...(readBoundedStringFromBody(rawFilters, "identifiedUserKey") &&
          !SessionReplayIdentity.isUsableUserRef(
            rawFilters["identifiedUserRef"],
          ) && {
            identifiedUserKey: readBoundedStringFromBody(
              rawFilters,
              "identifiedUserKey",
            ),
          }),
        ...(readBoundedStringFromBody(rawFilters, "route") && {
          route: readBoundedStringFromBody(rawFilters, "route"),
        }),
        ...(typeof rawFilters["minDurationMs"] === "number" &&
          Number.isFinite(rawFilters["minDurationMs"]) && {
            minDurationMs: rawFilters["minDurationMs"],
          }),
        ...(typeof rawFilters["hasIdentifiedUser"] === "boolean" && {
          hasIdentifiedUser: rawFilters["hasIdentifiedUser"],
        }),
        ...(typeof rawFilters["isPlayable"] === "boolean" && {
          isPlayable: rawFilters["isPlayable"],
        }),
        ...(typeof rawFilters["hasTraces"] === "boolean" && {
          hasTraces: rawFilters["hasTraces"],
        }),
        ...(typeof rawFilters["urlPrefix"] === "string" &&
          rawFilters["urlPrefix"].length > 0 && {
            urlPrefix: rawFilters["urlPrefix"].substring(
              0,
              SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH,
            ),
          }),
        ...(readTagFilterFromBody(rawFilters) && {
          tags: readTagFilterFromBody(rawFilters),
        }),
      };

      /*
       * Free text is the one predicate that cannot use an index: it is a
       * substring scan of every header in the window. The string cap
       * keeps each comparison cheap; the window cap keeps the number of
       * comparisons bounded, and is answered with its own message so the
       * list can say "narrow the range" rather than "no sessions".
       */
      const rawSearch: unknown = rawFilters["search"];

      if (rawSearch !== undefined && rawSearch !== null && rawSearch !== "") {
        if (typeof rawSearch !== "string") {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("search must be a string"),
          );
        }

        if (rawSearch.length > SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              `search must be at most ${SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH} characters.`,
            ),
          );
        }

        const windowMs: number = endTime.getTime() - startTime.getTime();

        if (
          windowMs >
          SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000
        ) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              `Search covers at most ${SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS} days at a time. Narrow the range to search it.`,
            ),
          );
        }

        if (rawSearch.trim().length > 0) {
          filters.search = rawSearch.trim();
        }
      }

      /*
       * Both cursor shapes are accepted: the legacy {startTimeUnixMs,
       * sessionId} one an older Dashboard or a bookmark still sends (it
       * means "newest first"), and the sorted one. A cursor for a
       * different ordering than the one requested is refused by the
       * service rather than silently mis-paged.
       */
      const cursor: SessionReplayListCursor | null =
        body["cursor"] !== undefined && body["cursor"] !== null
          ? parseSessionReplayListCursor(body["cursor"])
          : null;

      if (
        body["cursor"] !== undefined &&
        body["cursor"] !== null &&
        (cursor === null || !isBindableCursorSortValue(cursor, sortBy))
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "cursor must be the nextCursor of a previous page.",
          ),
        );
      }

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          startTime: startTime,
          endTime: endTime,
          filters: filters,
          limit: limit,
          sortBy: sortBy,
          ...(cursor !== null && { cursor }),
          includeIdentifiedUserLabel: includeIdentifiedUserLabel,
        });

      /*
       * The legacy cursor shape is still EMITTED for the newest-first sort
       * so an older Dashboard keeps paging; every other sort emits the
       * generalised shape, which such a client never asks for.
       */
      const nextCursor: JSONObject | null = result.nextCursor
        ? sortBy === "startTime"
          ? {
              startTimeUnixMs: result.nextCursor.sortValue,
              sessionId: result.nextCursor.sessionId,
            }
          : {
              sortBy: result.nextCursor.sortBy,
              sortValue: result.nextCursor.sortValue,
              sessionId: result.nextCursor.sessionId,
            }
        : null;

      return Response.sendJsonObjectResponse(req, res, {
        sessions: result.sessions as unknown as JSONObject,
        nextCursor: nextCursor,
        /*
         * Always present, empty when everything asked for was applied, so a
         * client can read it without having to distinguish "no ignored
         * filters" from "an older server that never said".
         */
        ignoredFilters: ignoredFilters as unknown as JSONArray,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Session Replay Manifest Endpoint ---

router.post(
  "/telemetry/rum/session-replay/manifest",
  ...requireSessionReplayPayloadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      assertSessionReplayPlan(databaseProps);

      const projectId: ObjectID = databaseProps.tenantId;
      const body: JSONObject = req.body as JSONObject;
      const sessionId: string = readSessionIdFromBody(body);

      /*
       * Optional disambiguator, validated but NOT trusted: the header it
       * selects still names the application that gets authorized.
       */
      const requestedApplicationId: ObjectID | undefined =
        readOptionalObjectIdFromBody(body, "rumApplicationId");

      const authorized: AuthorizedSession = await resolveAuthorizedSession({
        projectId: projectId,
        sessionId: sessionId,
        databaseProps: databaseProps,
        rumApplicationId: requestedApplicationId,
      });

      const header: SessionReplaySessionHeader = authorized.header;

      /*
       * The authorized application, resolved server-side from the header.
       * Every chunk-table read below is pinned to it: that table's replace
       * key is (projectId, sessionId, tabId, chunkIndex) with
       * rumApplicationId a plain column, so (projectId, sessionId) alone
       * is not enough to keep two applications' recordings apart.
       */
      const authorizedApplicationId: ObjectID = new ObjectID(
        header.rumApplicationId,
      );

      /*
       * A live-session poll reuses the view row the first read created.
       *
       * The player re-fetches the manifest every 30s while a session is
       * still recording, and each of those is the same person continuing
       * the same viewing, not a new disclosure. Writing a row per poll
       * would turn one viewing into dozens of audit entries and bury the
       * signal the audit exists for. The row is reused ONLY when the
       * caller proves it is theirs (looked up by viewedByUserId) AND it
       * is for this session; anything else - somebody else's viewId, a
       * different session, an id that no longer exists - is a fresh
       * recordView, exactly as if isRefresh had not been sent.
       */
      let viewId: string | null = null;

      const isRefresh: boolean = body["isRefresh"] === true;
      const refreshViewId: ObjectID | undefined = isRefresh
        ? readOptionalObjectIdFromBody(body, "viewId")
        : undefined;

      if (refreshViewId && databaseProps.userId) {
        const ownView: RumSessionReplayView | null =
          await RumSessionReplayViewService.findOwnView({
            viewId: refreshViewId,
            projectId: projectId,
            viewedByUserId: databaseProps.userId,
            sessionId: sessionId,
          });

        if (
          ownView &&
          ownView.id &&
          ownView.rumApplicationId &&
          ownView.rumApplicationId.toString() ===
            authorizedApplicationId.toString()
        ) {
          viewId = ownView.id.toString();
        }
      }

      if (viewId === null) {
        /*
         * The audit row is written BEFORE the manifest is built, not
         * after. A read that fails halfway through still happened, and
         * an audit that only records successful reads is an audit an
         * attacker can evade by aborting the request.
         *
         * linkedIncidentId is validated rather than constructed blindly:
         * ObjectID's constructor checks nothing, and a malformed id would
         * fail the audit insert - and with it the playback it audits. A
         * bad link is dropped; the view is still recorded.
         */
        const rawLinkedIncidentId: unknown = body["linkedIncidentId"];

        const view: RumSessionReplayView =
          await RumSessionReplayViewService.recordView({
            projectId: projectId,
            rumApplicationId: authorizedApplicationId,
            sessionId: sessionId,
            viewedByUserId: databaseProps.userId,
            ipAddress: getClientIp(req),
            userAgent:
              typeof req.headers["user-agent"] === "string"
                ? req.headers["user-agent"]
                : undefined,
            accessReason:
              typeof body["accessReason"] === "string"
                ? (body["accessReason"] as string)
                : undefined,
            linkedIncidentId:
              typeof rawLinkedIncidentId === "string" &&
              ObjectID.isValidUUID(rawLinkedIncidentId)
                ? new ObjectID(rawLinkedIncidentId)
                : undefined,
            linkedExceptionFingerprint:
              typeof body["linkedExceptionFingerprint"] === "string" &&
              body["linkedExceptionFingerprint"].length > 0
                ? (body["linkedExceptionFingerprint"] as string)
                : undefined,
          });

        viewId = view.id ? view.id.toString() : null;
      }

      const manifest: SessionReplayManifest =
        await SessionReplayReadService.getManifest({
          header: header,
          projectId: projectId,
          rumApplicationId: authorizedApplicationId,
          sessionId: sessionId,
        });

      /*
       * The identity columns are read by a SEPARATE statement that runs
       * only after the narrower identity check passes for the application
       * the caller was just authorized against. Nothing above named them,
       * so a caller without the permission never causes a statement that
       * touches identifiedUserLabel or identifiedUserTraits to exist.
       */
      let identity: SessionReplaySessionIdentity | null = null;

      if (
        canReadIdentifiedUserLabel({
          databaseProps: databaseProps,
          application: authorized.application,
        })
      ) {
        identity = await SessionReplayReadService.getSessionIdentity({
          projectId: projectId,
          rumApplicationId: authorizedApplicationId,
          sessionId: sessionId,
        });
      }

      const responseHeader: SessionReplaySessionHeader = identity
        ? {
            ...manifest.header,
            identifiedUserLabel: identity.identifiedUserLabel,
            identifiedUserTraits: identity.identifiedUserTraits,
          }
        : manifest.header;

      return Response.sendJsonObjectResponse(req, res, {
        /*
         * viewId is echoed back so the player's heartbeat can advance the
         * very row this read created (or reused), instead of guessing at
         * one.
         */
        viewId: viewId,
        header: responseHeader as unknown as JSONObject,
        tabs: manifest.tabs as unknown as JSONObject,
        isChunkIndexTruncated: manifest.isChunkIndexTruncated,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Session Replay Chunk Endpoint ---

router.post(
  "/telemetry/rum/session-replay/chunks",
  ...requireSessionReplayPayloadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      assertSessionReplayPlan(databaseProps);

      const projectId: ObjectID = databaseProps.tenantId;
      const body: JSONObject = req.body as JSONObject;
      const sessionId: string = readSessionIdFromBody(body);

      const tabId: unknown = body["tabId"];

      if (typeof tabId !== "string" || tabId.length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("tabId is required"),
        );
      }

      const rawChunkIndexes: unknown = body["chunkIndexes"];

      if (!Array.isArray(rawChunkIndexes) || rawChunkIndexes.length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("chunkIndexes is required"),
        );
      }

      const chunkIndexes: Array<number> = rawChunkIndexes.filter(
        (index: unknown): index is number => {
          return (
            typeof index === "number" && Number.isInteger(index) && index >= 0
          );
        },
      );

      if (chunkIndexes.length !== rawChunkIndexes.length) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "chunkIndexes must contain only non-negative integers",
          ),
        );
      }

      /*
       * Checked here as well as inside the read service: the route should
       * refuse an abusive request before it authorizes and queries
       * anything, and the service must refuse it for any future caller
       * that does not come through this route.
       */
      if (chunkIndexes.length > MAX_SESSION_REPLAY_CHUNKS_PER_READ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            `A maximum of ${MAX_SESSION_REPLAY_CHUNKS_PER_READ} chunks may be requested at a time.`,
          ),
        );
      }

      /*
       * Served from the 30s authorization cache: a session is 60 chunk
       * pages at most, and re-aggregating its header plus re-loading the
       * application's labels for every one of them is what made seeks
       * stutter. The label decision itself is still made against the
       * caller's current permissions on every request.
       */
      const authorized: AuthorizedSession = await resolveAuthorizedSession({
        projectId: projectId,
        sessionId: sessionId,
        databaseProps: databaseProps,
        rumApplicationId: readOptionalObjectIdFromBody(
          body,
          "rumApplicationId",
        ),
        allowCached: true,
      });

      const header: SessionReplaySessionHeader = authorized.header;

      const read: SessionReplayChunkReadResult =
        await SessionReplayReadService.getChunks({
          projectId: projectId,
          /* Always the application the caller was authorized against. */
          rumApplicationId: new ObjectID(header.rumApplicationId),
          sessionId: sessionId,
          tabId: tabId,
          chunkIndexes: chunkIndexes,
        });

      /*
       * Concatenated binary frames: [u32 chunkIndex][u32 byteLength][bytes]
       * repeated, little-endian, application/octet-stream.
       *
       * Not JSON: the payload is already a JSON document, so a JSON
       * envelope would force the server to re-escape and the browser to
       * double-parse several megabytes per page. The length prefix lets
       * the player slice the response without scanning it.
       */
      const frames: Array<Buffer> = [];

      /*
       * The byte cap is re-checked here against the bytes actually being
       * framed, not only against what the read service believed. This is
       * the last place the size of the response is knowable, so it is the
       * one place a cap on the response can be absolute regardless of how
       * stored size was estimated upstream. Like the service, it answers
       * with the prefix that fits rather than refusing - and never with
       * nothing: a single chunk is bounded by the ingest cap, and a chunk
       * that could never be served would dead-end playback at it forever.
       */
      let responseBytes: number = 0;
      const omittedChunkIndexes: Array<number> = [...read.omittedChunkIndexes];

      for (const chunk of read.chunks) {
        const payloadBuffer: Buffer = Buffer.from(chunk.payload, "utf8");

        const framedBytes: number = payloadBuffer.length + 8;

        if (
          frames.length > 0 &&
          (responseBytes + framedBytes > MAX_SESSION_REPLAY_READ_BYTES ||
            omittedChunkIndexes.length > 0)
        ) {
          omittedChunkIndexes.push(chunk.chunkIndex);
          continue;
        }

        responseBytes += framedBytes;

        const headerBuffer: Buffer = Buffer.alloc(8);
        headerBuffer.writeUInt32LE(chunk.chunkIndex, 0);
        headerBuffer.writeUInt32LE(payloadBuffer.length, 4);
        frames.push(headerBuffer, payloadBuffer);
      }

      const responseBody: Buffer = Buffer.concat(frames);

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", responseBody.length.toString());

      /*
       * Which requested chunks exist but were left out for size, so a
       * client that cares can ask for them in a smaller page instead of
       * reading their absence as a gap in the recording.
       */
      if (omittedChunkIndexes.length > 0) {
        res.setHeader(
          "X-OneUptime-Replay-Omitted-Chunks",
          omittedChunkIndexes
            .sort((a: number, b: number): number => {
              return a - b;
            })
            .join(","),
        );
      }
      /*
       * A recording is personal data. Nothing about it may sit in a
       * shared cache, and the browser should not keep it on disk either.
       */
      res.setHeader("Cache-Control", "no-store");
      res.send(responseBody);
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Session Replay Heartbeat Endpoint ---

router.post(
  "/telemetry/rum/session-replay/heartbeat",
  ...requireSessionReplayPayloadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      assertSessionReplayPlan(databaseProps);

      const projectId: ObjectID = databaseProps.tenantId;
      const body: JSONObject = req.body as JSONObject;

      const viewId: ObjectID = readObjectIdFromBody(body, "viewId");

      const secondsWatched: unknown = body["secondsWatched"];

      if (
        typeof secondsWatched !== "number" ||
        !Number.isFinite(secondsWatched)
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("secondsWatched must be a number"),
        );
      }

      /*
       * SEMANTICS: secondsWatched is the cumulative seconds of footage the
       * player has PLAYED for this view (accumulated client-side while
       * playback runs, scaled by speed), not the furthest offset reached.
       * Floored to the 15s heartbeat cadence and clamped by the service,
       * which is monotonic and writes nothing when the value does not
       * advance, so a chatty client costs at most one UPDATE per 15
       * seconds watched without any server-side timer or cross-pod
       * throttle state.
       */
      const throttledSeconds: number = normalizeSecondsWatched(secondsWatched);

      /*
       * secondsWatched is a privacy control, not telemetry: it is shown on
       * the player as "who watched how much of this recording". Scoping
       * the write to the tenant alone would let any principal holding the
       * payload permission inflate somebody else's audit row for a session
       * they may not even read, which forges the very record the design
       * relies on.
       *
       * The row is therefore looked up as the CALLER'S own view row - a
       * viewId belonging to anyone else matches nothing and is refused
       * indistinguishably from one that does not exist - and the
       * application it points at is authorized exactly as a payload read
       * would be. That ONE lookup also carries the row's current figure,
       * so a heartbeat that does not advance it ends here with no write.
       */
      if (!databaseProps.userId) {
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException(
            "You do not have access to this session replay view.",
          ),
        );
      }

      const view: RumSessionReplayView | null =
        await RumSessionReplayViewService.findOwnView({
          viewId: viewId,
          projectId: projectId,
          viewedByUserId: databaseProps.userId,
        });

      if (!view || !view.rumApplicationId) {
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException(
            "You do not have access to this session replay view.",
          ),
        );
      }

      await assertSessionReplayApplicationAccess({
        projectId: projectId,
        rumApplicationId: view.rumApplicationId,
        databaseProps: databaseProps,
        permissions: SESSION_REPLAY_PAYLOAD_PERMISSIONS,
        allowCached: true,
      });

      const currentSecondsWatched: number = view.secondsWatched || 0;

      await RumSessionReplayViewService.recordSecondsWatched({
        viewId: viewId,
        projectId: projectId,
        secondsWatched: throttledSeconds,
        currentSecondsWatched: currentSecondsWatched,
      });

      return Response.sendJsonObjectResponse(req, res, {
        secondsWatched: Math.max(currentSecondsWatched, throttledSeconds),
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Session Replay Views Endpoint ---

/*
 * Who has watched this recording. The audit table has been written on
 * every manifest read since the feature shipped and nothing surfaced it;
 * the player header now can. Payload permission, because the list of
 * viewers is a fact about a recording of a real person and belongs to
 * the people who may watch it. Pinned to the application the session was
 * authorized under: sessionId is only unique within an application.
 */
const MAX_SESSION_REPLAY_VIEWS_LIMIT: number = 50;

router.post(
  "/telemetry/rum/session-replay/views",
  ...requireSessionReplayPayloadAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      assertSessionReplayPlan(databaseProps);

      const projectId: ObjectID = databaseProps.tenantId;
      const body: JSONObject = req.body as JSONObject;
      const sessionId: string = readSessionIdFromBody(body);

      const authorized: AuthorizedSession = await resolveAuthorizedSession({
        projectId: projectId,
        sessionId: sessionId,
        databaseProps: databaseProps,
        rumApplicationId: readOptionalObjectIdFromBody(
          body,
          "rumApplicationId",
        ),
        allowCached: true,
      });

      const views: Array<RumSessionReplayView> =
        await RumSessionReplayViewService.getViewsForSession({
          projectId: projectId,
          rumApplicationId: new ObjectID(authorized.header.rumApplicationId),
          sessionId: sessionId,
          limit: readLimitFromBody(
            body,
            MAX_SESSION_REPLAY_VIEWS_LIMIT,
            MAX_SESSION_REPLAY_VIEWS_LIMIT,
          ),
        });

      return Response.sendJsonObjectResponse(req, res, {
        views: views.map((view: RumSessionReplayView): JSONObject => {
          return {
            id: view.id ? view.id.toString() : null,
            viewedAt: view.viewedAt ? view.viewedAt.toISOString() : null,
            secondsWatched: view.secondsWatched ?? 0,
            accessReason: view.accessReason || "",
            viewedByUserId: view.viewedByUserId
              ? view.viewedByUserId.toString()
              : null,
            viewedByUser: view.viewedByUser
              ? {
                  id: view.viewedByUser.id
                    ? view.viewedByUser.id.toString()
                    : null,
                  name: view.viewedByUser.name
                    ? view.viewedByUser.name.toString()
                    : "",
                  email: view.viewedByUser.email
                    ? view.viewedByUser.email.toString()
                    : "",
                  profilePictureId: view.viewedByUser.profilePictureId
                    ? view.viewedByUser.profilePictureId.toString()
                    : null,
                }
              : null,
          };
        }) as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Session Replay For Exception Endpoint ---

router.post(
  "/telemetry/rum/session-replay/for-exception",
  ...requireSessionReplayListAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      assertSessionReplayPlan(databaseProps);

      const projectId: ObjectID = databaseProps.tenantId;
      const body: JSONObject = req.body as JSONObject;

      const fingerprint: unknown = body["fingerprint"];

      if (typeof fingerprint !== "string" || fingerprint.length === 0) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("fingerprint is required"),
        );
      }

      /*
       * An exception is not scoped to a RUM application, so there is no
       * single application to authorize against. Restrict the query to
       * the applications the caller's labels reach instead.
       */
      const accessibleApplications: AccessibleRumApplications =
        await resolveAccessibleRumApplicationIds({
          projectId: projectId,
          databaseProps: databaseProps,
          permissions: SESSION_REPLAY_LIST_PERMISSIONS,
        });

      let startTime: Date | undefined = readOptionalDateFromBody(
        body,
        "startTime",
      );
      let endTime: Date | undefined = readOptionalDateFromBody(body, "endTime");

      /*
       * The exception page knows WHEN the error happened. A session that
       * contains that moment started at most one maximum session length
       * before it (plus skew padding), so the window is derived from the
       * moment rather than left to the 30-day default - a fraction of
       * the partitions, and the card finds the session of THIS instance
       * rather than the newest session that ever hit the fingerprint.
       */
      const rawErrorTime: unknown = body["errorTimeUnixMs"];

      if (
        startTime === undefined &&
        endTime === undefined &&
        typeof rawErrorTime === "number" &&
        Number.isFinite(rawErrorTime) &&
        rawErrorTime > 0
      ) {
        startTime = new Date(
          rawErrorTime -
            SESSION_REPLAY_MAX_SESSION_MS -
            SESSION_REPLAY_EXCEPTION_WINDOW_PADDING_MS,
        );
        endTime = new Date(
          rawErrorTime + SESSION_REPLAY_EXCEPTION_WINDOW_PADDING_MS,
        );
      }

      if (startTime && endTime && startTime.getTime() > endTime.getTime()) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("startTime must not be after endTime"),
        );
      }

      /* Pin to the session the caller already knows threw, when it does. */
      const pinnedSessionId: unknown = body["sessionId"];

      const sessions: Array<SessionReplayExceptionSession> =
        await SessionReplayReadService.getSessionsForException({
          projectId: projectId,
          exceptionFingerprint: fingerprint,
          accessibleRumApplicationIds: accessibleApplications.applicationIds,
          ...(startTime !== undefined && { startTime }),
          ...(endTime !== undefined && { endTime }),
          ...(typeof pinnedSessionId === "string" &&
            pinnedSessionId.length > 0 && { sessionId: pinnedSessionId }),
          limit: readLimitFromBody(
            body,
            MAX_SESSION_REPLAY_FOR_EXCEPTION_LIMIT,
            MAX_SESSION_REPLAY_FOR_EXCEPTION_LIMIT,
          ),
        });

      return Response.sendJsonObjectResponse(req, res, {
        sessions: sessions as unknown as JSONObject,
        /*
         * Told, not hidden: the accessible-application scan has a ceiling,
         * and a caller who hits it is looking at a possibly short answer.
         */
        isApplicationScopeTruncated: accessibleApplications.isTruncated,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Session Replay Ingest Status Endpoint ---

/*
 * Recording health for one application: is replay switched on at every
 * level, when did the last chunk actually land, and how much of the byte
 * budgets is spent. This is what lets the Dashboard answer "why are there
 * no recordings?" and "am I about to hit my budget?" as states rather than
 * leaving the customer to infer them from silence — the ingest gate's
 * refusals are deliberately quiet toward end users' browsers, so this
 * endpoint is the loud side of that trade.
 *
 * Reads settings metadata and Redis counters only; never touches recording
 * payloads, so list-level access is the right bar.
 *
 * The application row is loaded with root props even though its columns
 * carry their own read ACLs. That is deliberate and bounded: every column
 * returned here (appIdentifier, the replay policy fields, the two health
 * timestamps) is readable by a plain project Viewer under its declared
 * ACL — the least-privileged read tier there is — while this route demands
 * the STRICTER session-replay list permission and pins tenancy and label
 * scope first. Nothing is disclosed that the caller's project peers cannot
 * already read through the generic CRUD API. If a column with a narrower
 * ACL (e.g. anything identity-adjacent) is ever added to this SELECT, it
 * must get an explicit permission check, not a wider isRoot ride-along.
 */
router.post(
  "/telemetry/rum/session-replay/ingest-status",
  ...requireSessionReplayListAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      assertSessionReplayPlan(databaseProps);

      const projectId: ObjectID = databaseProps.tenantId;
      const body: JSONObject = req.body as JSONObject;

      const rumApplicationId: ObjectID = readObjectIdFromBody(
        body,
        "rumApplicationId",
      );

      await assertSessionReplayApplicationAccess({
        projectId: projectId,
        rumApplicationId: rumApplicationId,
        databaseProps: databaseProps,
        permissions: SESSION_REPLAY_LIST_PERMISSIONS,
      });

      const application: RumApplication | null =
        await RumApplicationService.findOneBy({
          query: {
            _id: rumApplicationId.toString(),
            projectId: projectId,
          },
          select: {
            _id: true,
            appIdentifier: true,
            isSessionReplayEnabled: true,
            sessionReplayAllowedOrigins: true,
            sessionReplaySamplePercentage: true,
            sessionReplayCaptureTrigger: true,
            sessionReplayConsentMode: true,
            sessionReplayMaskingMode: true,
            sessionReplayRetentionInDays: true,
            sessionReplayMonthlyBudgetInGB: true,
            sessionReplayLastChunkReceivedAt: true,
            sessionReplayBudgetExceededAt: true,
            /*
             * Stamped by the /config route on every recorder load (through
             * the throttled updateLastSeen path), so this is "when did the
             * recorder last run on the customer's site" - the fact that
             * separates "never installed" from "installed but uploading
             * nothing".
             */
            lastSeenAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!application) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("RUM application not found."),
        );
      }

      const project: Project | null = await ProjectService.findOneBy({
        query: {
          _id: projectId.toString(),
        },
        select: {
          isSessionReplayAllowed: true,
        },
        props: {
          isRoot: true,
        },
      });

      const appIdentifier: string = String(
        (application as unknown as JSONObject)["appIdentifier"] || "",
      );

      /*
       * Every counter below is independent and every one answers null on
       * its own failure: the Redis-backed ones when Redis is down, the
       * ClickHouse-backed summary when the query fails. null is rendered
       * as "unknown", never as 0 - "nothing was refused" and "we could
       * not count" are different diagnoses.
       */
      const [
        projectBytesUsedToday,
        applicationBytesUsedThisMonth,
        refusalsLast24h,
        dropsLast24h,
        activity,
      ]: [
        number | null,
        number | null,
        Array<SessionReplayRefusalCount> | null,
        Array<SessionReplayDropCount> | null,
        SessionReplayApplicationActivitySummary,
      ] = await Promise.all([
        SessionReplayUsage.getProjectBytesUsedToday(projectId),
        SessionReplayUsage.getApplicationBytesUsedThisMonth({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
        }),
        appIdentifier
          ? SessionReplayHealthCounters.readRefusalsLast24h({
              projectId: projectId,
              appIdentifier: appIdentifier,
            })
          : Promise.resolve(null),
        appIdentifier
          ? SessionReplayHealthCounters.readDropsLast24h({
              projectId: projectId,
              appIdentifier: appIdentifier,
            })
          : Promise.resolve(null),
        SessionReplayReadService.getApplicationActivitySummary({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
        }),
      ]);

      /*
       * Same env var, same default, as the value the ingest gate enforces
       * (App Telemetry Config). The default is a shared constant so the
       * number shown here cannot drift from the number enforced there.
       */
      const dailyCapEnv: number = parseInt(
        process.env["SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY"] || "",
        10,
      );

      const dailyByteLimit: number =
        !isNaN(dailyCapEnv) && dailyCapEnv > 0
          ? dailyCapEnv
          : DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY;

      const applicationView: JSONObject = application as unknown as JSONObject;

      const toIsoOrNull: (value: unknown) => string | null = (
        value: unknown,
      ): string | null => {
        if (value instanceof Date) {
          return Number.isFinite(value.getTime()) ? value.toISOString() : null;
        }

        if (typeof value === "string" && value.length > 0) {
          const parsed: number = Date.parse(value);

          return Number.isFinite(parsed)
            ? new Date(parsed).toISOString()
            : null;
        }

        return null;
      };

      const retentionInDays: unknown =
        applicationView["sessionReplayRetentionInDays"];

      return Response.sendJsonObjectResponse(req, res, {
        isProjectAllowed: Boolean(
          (project as unknown as JSONObject | null)?.["isSessionReplayAllowed"],
        ),
        isApplicationEnabled: Boolean(
          applicationView["isSessionReplayEnabled"],
        ),
        appIdentifier: appIdentifier,
        allowedOrigins: (applicationView["sessionReplayAllowedOrigins"] ||
          []) as JSONArray,
        samplePercentage: Number(
          applicationView["sessionReplaySamplePercentage"] || 0,
        ),
        captureTrigger: String(
          applicationView["sessionReplayCaptureTrigger"] || "",
        ),
        lastChunkReceivedAt:
          (applicationView["sessionReplayLastChunkReceivedAt"] as string) ||
          null,
        budgetExceededAt:
          (applicationView["sessionReplayBudgetExceededAt"] as string) || null,
        /* null = counter unreachable; render as unknown, never as zero. */
        projectBytesUsedToday: projectBytesUsedToday,
        dailyByteLimit: dailyByteLimit,
        applicationBytesUsedThisMonth: applicationBytesUsedThisMonth,
        monthlyBudgetInGB:
          (applicationView["sessionReplayMonthlyBudgetInGB"] as number) ?? null,

        /*
         * ---- Additive: the rest of RecordingHealthStatus. ----
         * Every timestamp is ISO-8601 or null; every counter is a number
         * or null (unknown). The Dashboard parses this with
         * parseRecordingHealthStatus and diagnoses it with
         * diagnoseRecordingHealth.
         */
        consentMode: String(applicationView["sessionReplayConsentMode"] || ""),
        maskingMode: String(applicationView["sessionReplayMaskingMode"] || ""),
        retentionInDays:
          typeof retentionInDays === "number" &&
          Number.isFinite(retentionInDays)
            ? retentionInDays
            : null,
        publishedRecorderVersion:
          SessionReplayReadService.getPublishedRecorderVersion(),
        lastConfigFetchAt: toIsoOrNull(applicationView["lastSeenAt"]),
        lastSessionStartedAt: activity.lastSessionStartedAt
          ? activity.lastSessionStartedAt.toISOString()
          : null,
        sessionsLast24h: activity.sessionsLast24h,
        playableSessionsLast24h: activity.playableSessionsLast24h,
        /*
         * What the newest session's recorder said it could capture.
         *
         * This is the row the docs point operators at for spotting a stale
         * cached recorder artifact ("click labels: no"); without it the
         * health card and the installation test both said "not reported
         * yet" for every application forever, which reads as a bug rather
         * than as information. null (not []) when there is no session, when
         * the newest one predates the attribute, or when the query failed -
         * all three are "we cannot say", never "this recorder can do
         * nothing". It rides on the last-session query the summary already
         * runs, so the row costs no extra ClickHouse round trip.
         */
        recorderCapabilities:
          activity.recorderCapabilities as unknown as JSONArray | null,
        refusalsLast24h: refusalsLast24h as unknown as JSONArray | null,
        /*
         * Kept apart from refusals: a refusal was answered to the
         * recorder, a drop happened after a 202 inside the worker. "12
         * chunks dropped after acceptance: scrub-incomplete" is a
         * different sentence from "212 uploads refused".
         */
        dropsLast24h: dropsLast24h as unknown as JSONArray | null,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

/*
 * "Record the next session for this user."
 *
 * One route, three actions, because all three are the same tiny
 * conversation with one Redis key: set arms a 24h one-shot target for a
 * named end-user reference, clear disarms it, status reads it. The
 * response is always the resulting { isPending }.
 *
 * The guard requires EDIT on the application, not the session-replay READ
 * permission: arming this causes a recording of a named person to be
 * made, which is a capture-policy write - the same class of action as
 * flipping the enable flag - and a reviewer who may only WATCH recordings
 * must not be able to order new ones.
 */
const requireSessionReplayTargetAccess: Array<RequestHandler> = [
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.EditRumApplication,
    ],
  }),
];

router.post(
  "/telemetry/rum/session-replay/target",
  ...requireSessionReplayTargetAccess,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const databaseProps: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (!databaseProps?.tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid Project ID"),
        );
      }

      assertSessionReplayPlan(databaseProps);

      const projectId: ObjectID = databaseProps.tenantId;
      const body: JSONObject = req.body as JSONObject;

      const rumApplicationId: ObjectID = readObjectIdFromBody(
        body,
        "rumApplicationId",
      );

      const action: unknown = body["action"];

      if (action !== "set" && action !== "clear" && action !== "status") {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            'action must be one of "set", "clear" or "status".',
          ),
        );
      }

      const userRef: unknown = body["userRef"];

      if (!SessionReplayTargeting.isUsableUserRef(userRef)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "userRef must be a non-empty string of at most 512 characters.",
          ),
        );
      }

      await assertSessionReplayApplicationAccess({
        projectId: projectId,
        rumApplicationId: rumApplicationId,
        databaseProps: databaseProps,
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.TelemetryAdmin,
          Permission.EditRumApplication,
        ],
      });

      /*
       * The Redis key is scoped by the application's ingest identifier -
       * the name the recorder introduces itself with - not by the row id
       * the dashboard holds, so resolve one from the other here.
       */
      const application: RumApplication | null =
        await RumApplicationService.findOneBy({
          query: {
            _id: rumApplicationId.toString(),
            projectId: projectId,
          },
          select: {
            _id: true,
            appIdentifier: true,
          },
          props: {
            isRoot: true,
          },
        });

      const appIdentifier: string = String(
        (application as unknown as JSONObject | null)?.["appIdentifier"] || "",
      );

      if (!application || !appIdentifier) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("RUM application not found."),
        );
      }

      const target: {
        projectId: ObjectID;
        appIdentifier: string;
        userRef: string;
      } = {
        projectId: projectId,
        appIdentifier: appIdentifier,
        userRef: userRef,
      };

      let isPending: boolean = false;

      if (action === "set") {
        await SessionReplayTargeting.setTarget(target);
        isPending = true;
      } else if (action === "clear") {
        await SessionReplayTargeting.clearTarget(target);
        isPending = false;
      } else {
        isPending = await SessionReplayTargeting.isTargetPending(target);
      }

      return Response.sendJsonObjectResponse(req, res, {
        isPending: isPending,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

export default router;
