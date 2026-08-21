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
} from "../Services/LogAggregationService";
import TraceAggregationService, {
  HistogramBucket as TraceHistogramBucket,
  HistogramRequest as TraceHistogramRequest,
  FacetValue as TraceFacetValue,
  MultiFacetRequest as TraceMultiFacetRequest,
  TraceFilters,
  TraceAttributeFilters,
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
import SessionReplayTargeting from "../Utils/SessionReplay/SessionReplayTargeting";
import SessionReplayUsage from "../Utils/SessionReplay/SessionReplayUsage";
import RumSessionReplayView from "../../Models/DatabaseModels/RumSessionReplayView";
import RumSessionReplayViewService from "../Services/RumSessionReplayViewService";
import SessionReplayReadService, {
  DEFAULT_SESSION_REPLAY_LIST_LIMIT,
  MAX_SESSION_REPLAY_FOR_EXCEPTION_LIMIT,
  SessionReplayChunkPayload,
  SessionReplayExceptionSession,
  SessionReplayListCursor,
  SessionReplayListFilters,
  SessionReplayListResult,
  SessionReplayManifest,
  SessionReplaySessionHeader,
} from "../Utils/SessionReplay/SessionReplayReadService";
import {
  DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY,
  MAX_SESSION_REPLAY_CHUNKS_PER_READ,
  MAX_SESSION_REPLAY_READ_BYTES,
} from "../../Types/Rum/SessionReplay";

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

  /*
   * Exact attribute predicates accept a single value or a list of values
   * (`IN (...)`) — a multi-select dashboard variable resolves to the latter.
   * Non-string array entries are dropped, and an array left empty by that
   * filtering is dropped entirely so it cannot narrow to nothing.
   */
  const attributeFilterRecord: () => TraceAttributeFilters | undefined = ():
    | TraceAttributeFilters
    | undefined => {
    const raw: unknown = body["attributes"];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const filters: TraceAttributeFilters = {};
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
      }
    }
    if (Object.keys(filters).length === 0) {
      return undefined;
    }
    return filters;
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
    attributes: attributeFilterRecord(),
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
type AssertSessionReplayApplicationAccessFunction = (data: {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
  databaseProps: DatabaseCommonInteractionProps;
  permissions: Array<Permission>;
}) => Promise<RumApplication>;

const assertSessionReplayApplicationAccess: AssertSessionReplayApplicationAccessFunction =
  async (data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    databaseProps: DatabaseCommonInteractionProps;
    permissions: Array<Permission>;
  }): Promise<RumApplication> => {
    const scope: SessionReplayScope = getSessionReplayLabelScope(
      data.databaseProps,
      data.permissions,
    );

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
}) => Promise<SessionReplaySessionHeader>;

const resolveAuthorizedSession: ResolveAuthorizedSessionFunction =
  async (data: {
    projectId: ObjectID;
    sessionId: string;
    databaseProps: DatabaseCommonInteractionProps;
  }): Promise<SessionReplaySessionHeader> => {
    const header: SessionReplaySessionHeader | null =
      await SessionReplayReadService.getSessionHeader({
        projectId: data.projectId,
        sessionId: data.sessionId,
      });

    if (!header) {
      throw new BadDataException("Session replay not found.");
    }

    await assertSessionReplayApplicationAccess({
      projectId: data.projectId,
      rumApplicationId: new ObjectID(header.rumApplicationId),
      databaseProps: data.databaseProps,
      permissions: SESSION_REPLAY_PAYLOAD_PERMISSIONS,
    });

    return header;
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

const readSessionIdFromBody: ReadSessionIdFromBodyFunction = (
  body: JSONObject,
): string => {
  const sessionId: unknown = body["sessionId"];

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new BadDataException("sessionId is required");
  }

  return sessionId;
};

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

  const strings: Array<string> = value.filter(
    (item: unknown): item is string => {
      return typeof item === "string" && item.length > 0;
    },
  );

  return strings.length > 0 ? strings : undefined;
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

      const startTime: Date = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -7);

      const endTime: Date = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : OneUptimeDate.getCurrentDate();

      const rawFilters: JSONObject = (body["filters"] as JSONObject) || {};

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
        ...(typeof rawFilters["identifiedUserKey"] === "string" && {
          identifiedUserKey: rawFilters["identifiedUserKey"],
        }),
        ...(typeof rawFilters["route"] === "string" && {
          route: rawFilters["route"],
        }),
        ...(typeof rawFilters["minDurationMs"] === "number" && {
          minDurationMs: rawFilters["minDurationMs"],
        }),
      };

      const rawCursor: JSONObject | undefined = body["cursor"]
        ? (body["cursor"] as JSONObject)
        : undefined;

      const cursor: SessionReplayListCursor | undefined =
        rawCursor &&
        typeof rawCursor["startTimeUnixMs"] === "number" &&
        typeof rawCursor["sessionId"] === "string"
          ? {
              startTimeUnixMs: rawCursor["startTimeUnixMs"],
              sessionId: rawCursor["sessionId"],
            }
          : undefined;

      /*
       * The narrower identity ACL is enforced by simply not naming the
       * column in the SELECT. There is no ModelPermission on this path to
       * strip it after the fact. Decided against the application already
       * loaded by the access check, so a caller whose identity grant is
       * label-scoped elsewhere does not get named end users here.
       */
      const includeIdentifiedUserLabel: boolean = canReadIdentifiedUserLabel({
        databaseProps: databaseProps,
        application: application,
      });

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          startTime: startTime,
          endTime: endTime,
          filters: filters,
          limit:
            typeof body["limit"] === "number"
              ? (body["limit"] as number)
              : DEFAULT_SESSION_REPLAY_LIST_LIMIT,
          ...(cursor !== undefined && { cursor }),
          includeIdentifiedUserLabel: includeIdentifiedUserLabel,
        });

      return Response.sendJsonObjectResponse(req, res, {
        sessions: result.sessions as unknown as JSONObject,
        nextCursor: result.nextCursor as unknown as JSONObject,
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

      const header: SessionReplaySessionHeader = await resolveAuthorizedSession(
        {
          projectId: projectId,
          sessionId: sessionId,
          databaseProps: databaseProps,
        },
      );

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
       * The audit row is written BEFORE the manifest is built, not after.
       * A read that fails halfway through still happened, and an audit
       * that only records successful reads is an audit an attacker can
       * evade by aborting the request.
       */
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
            typeof body["linkedIncidentId"] === "string" &&
            body["linkedIncidentId"].length > 0
              ? new ObjectID(body["linkedIncidentId"])
              : undefined,
          linkedExceptionFingerprint:
            typeof body["linkedExceptionFingerprint"] === "string"
              ? (body["linkedExceptionFingerprint"] as string)
              : undefined,
        });

      const manifest: SessionReplayManifest =
        await SessionReplayReadService.getManifest({
          header: header,
          projectId: projectId,
          rumApplicationId: authorizedApplicationId,
          sessionId: sessionId,
        });

      return Response.sendJsonObjectResponse(req, res, {
        /*
         * viewId is echoed back so the player's heartbeat can advance the
         * very row this read created, instead of guessing at one.
         */
        viewId: view.id ? view.id.toString() : null,
        header: manifest.header as unknown as JSONObject,
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

      const header: SessionReplaySessionHeader = await resolveAuthorizedSession(
        {
          projectId: projectId,
          sessionId: sessionId,
          databaseProps: databaseProps,
        },
      );

      const chunks: Array<SessionReplayChunkPayload> =
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
       * framed, not only against what the pre-check in the read service
       * believed. This is the last place the size of the response is
       * knowable, so it is the one place a cap on the response can be
       * absolute regardless of how stored size was estimated upstream.
       */
      let responseBytes: number = 0;

      for (const chunk of chunks) {
        const payloadBuffer: Buffer = Buffer.from(chunk.payload, "utf8");

        responseBytes += payloadBuffer.length + 8;

        if (responseBytes > MAX_SESSION_REPLAY_READ_BYTES) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              `The requested chunks exceed the ${MAX_SESSION_REPLAY_READ_BYTES} byte limit for a single read. Request fewer chunks.`,
            ),
          );
        }

        const headerBuffer: Buffer = Buffer.alloc(8);
        headerBuffer.writeUInt32LE(chunk.chunkIndex, 0);
        headerBuffer.writeUInt32LE(payloadBuffer.length, 4);
        frames.push(headerBuffer, payloadBuffer);
      }

      const responseBody: Buffer = Buffer.concat(frames);

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", responseBody.length.toString());
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
       * Floored to the 15s heartbeat cadence. recordSecondsWatched is
       * monotonic and returns without writing when the value does not
       * advance, so flooring here turns a chatty client into at most one
       * UPDATE per 15 seconds watched without any server-side timer or
       * cross-pod throttle state.
       */
      const throttledSeconds: number =
        Math.floor(Math.max(0, secondsWatched) / 15) * 15;

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
       * would be.
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
        await RumSessionReplayViewService.findOneBy({
          query: {
            _id: viewId.toString(),
            projectId: projectId,
            viewedByUserId: databaseProps.userId,
          },
          select: {
            _id: true,
            rumApplicationId: true,
          },
          props: {
            isRoot: true,
          },
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
      });

      await RumSessionReplayViewService.recordSecondsWatched({
        viewId: viewId,
        projectId: projectId,
        secondsWatched: throttledSeconds,
      });

      return Response.sendJsonObjectResponse(req, res, {
        secondsWatched: throttledSeconds,
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

      const startTime: Date | undefined = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : undefined;

      const endTime: Date | undefined = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : undefined;

      const sessions: Array<SessionReplayExceptionSession> =
        await SessionReplayReadService.getSessionsForException({
          projectId: projectId,
          exceptionFingerprint: fingerprint,
          accessibleRumApplicationIds: accessibleApplications.applicationIds,
          ...(startTime !== undefined && { startTime }),
          ...(endTime !== undefined && { endTime }),
          limit:
            typeof body["limit"] === "number"
              ? (body["limit"] as number)
              : MAX_SESSION_REPLAY_FOR_EXCEPTION_LIMIT,
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
            sessionReplayMonthlyBudgetInGB: true,
            sessionReplayLastChunkReceivedAt: true,
            sessionReplayBudgetExceededAt: true,
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

      const [projectBytesUsedToday, applicationBytesUsedThisMonth]: [
        number | null,
        number | null,
      ] = await Promise.all([
        SessionReplayUsage.getProjectBytesUsedToday(projectId),
        SessionReplayUsage.getApplicationBytesUsedThisMonth({
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

      return Response.sendJsonObjectResponse(req, res, {
        isProjectAllowed: Boolean(
          (project as unknown as JSONObject | null)?.["isSessionReplayAllowed"],
        ),
        isApplicationEnabled: Boolean(
          applicationView["isSessionReplayEnabled"],
        ),
        appIdentifier: String(applicationView["appIdentifier"] || ""),
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
