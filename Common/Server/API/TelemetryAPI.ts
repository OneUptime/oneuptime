import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
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
import Permission from "../../Types/Permission";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ResourceFacetResolver, {
  ResolvedFacetValue,
  ResourceFacetSpec,
} from "../Utils/Telemetry/ResourceFacetResolver";

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

      const attributes: Record<string, string> | undefined = body["attributes"]
        ? (body["attributes"] as Record<string, string>)
        : undefined;

      const request: HistogramRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        bucketSizeInMinutes,
        serviceIds,
        entityKeys,
        severityTexts,
        bodySearchText,
        traceIds,
        spanIds,
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

      const attributes: Record<string, string> | undefined = body["attributes"]
        ? (body["attributes"] as Record<string, string>)
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
                  severityTexts,
                  bodySearchText,
                  traceIds,
                  spanIds,
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

  const statusCodes: Array<number> | undefined = Array.isArray(
    body["statusCodes"],
  )
    ? (body["statusCodes"] as Array<unknown>).filter(
        (v: unknown): v is number => {
          return typeof v === "number";
        },
      )
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
    attributes: stringRecord("attributes"),
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

      const traceFilters: TraceFilters = parseTraceFilterBody(body);

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

      const traceFilters: TraceFilters = parseTraceFilterBody(body);

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
            !ResourceFacetResolver.isResourceFacet(key) && key !== "statusCode"
          );
        },
      );

      let facets: Record<string, Array<TraceFacetValue>> = {};
      if (sampledKeys.length > 0) {
        try {
          facets = await TraceAggregationService.getFacetValuesFromSample({
            ...multiRequest,
            facetKeys: sampledKeys,
          });
        } catch {
          facets = Object.fromEntries(
            sampledKeys.map((key: string): [string, Array<TraceFacetValue>] => {
              return [key, []];
            }),
          );
        }
      }

      const needsAccurateCounts: boolean =
        facetKeys.includes("statusCode") ||
        facetKeys.some((key: string): boolean => {
          return ResourceFacetResolver.isResourceFacet(key);
        });

      let serviceCounts: Map<string, number> = new Map<string, number>();
      let statusCounts: Map<string, number> = new Map<string, number>();
      if (needsAccurateCounts) {
        try {
          const accurate: {
            serviceCounts: Map<string, number>;
            statusCounts: Map<string, number>;
          } =
            await TraceAggregationService.getResourceFacetCounts(multiRequest);
          serviceCounts = accurate.serviceCounts;
          statusCounts = accurate.statusCounts;
        } catch {
          /*
           * Degrade gracefully: resource facets still enumerate via Postgres
           * (count 0), statusCode falls back to empty.
           */
        }
      }

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

      const bucketSizeInMinutes: number =
        (body["bucketSizeInMinutes"] as number) ||
        computeDefaultBucketSize(startTime, endTime);

      const groupBy: Array<string> | undefined = Array.isArray(body["groupBy"])
        ? (body["groupBy"] as Array<unknown>).filter(
            (v: unknown): v is string => {
              return typeof v === "string" && v.length > 0;
            },
          )
        : undefined;

      const limit: number | undefined =
        typeof body["limit"] === "number" ? (body["limit"] as number) : undefined;

      const traceFilters: TraceFilters = parseTraceFilterBody(body);

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
        : ["primaryEntityId", "hostId", "dockerHostId", "kubernetesClusterId"];

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

      const groupBy: Array<string> | undefined = body["groupBy"]
        ? (body["groupBy"] as Array<string>)
        : undefined;

      const aggregationField: string | undefined = body["aggregationField"]
        ? (body["aggregationField"] as string)
        : undefined;

      const limit: number | undefined = body["limit"]
        ? (body["limit"] as number)
        : undefined;

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
        severityTexts,
        bodySearchText,
        traceIds,
        spanIds,
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

      const result: {
        before: Array<JSONObject>;
        after: Array<JSONObject>;
      } = await LogAggregationService.getLogContext({
        projectId: databaseProps.tenantId,
        primaryEntityId: new ObjectID(primaryEntityId),
        time: OneUptimeDate.fromString(time),
        logId,
        count,
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

      if (!profileId && !startTime) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Either profileId or startTime must be provided",
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

      /*
       * Only default the window when no profileId is given: a profile's
       * samples are bounded by the profile itself, and a defaulted
       * last-hour window would silently exclude any profile captured
       * before the window started.
       */
      const startTime: Date | undefined = body["startTime"]
        ? OneUptimeDate.fromString(body["startTime"] as string)
        : profileId
          ? undefined
          : OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);

      const endTime: Date | undefined = body["endTime"]
        ? OneUptimeDate.fromString(body["endTime"] as string)
        : profileId
          ? undefined
          : OneUptimeDate.getCurrentDate();

      if (!profileId && !startTime) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Either profileId or startTime must be provided",
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

      if (!profileId && !startTime) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Either profileId or startTime must be provided",
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

export default router;
