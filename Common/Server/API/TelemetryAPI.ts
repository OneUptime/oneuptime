import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
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
} from "../Services/TraceAggregationService";
import ExceptionAggregationService, {
  HistogramBucket as ExceptionHistogramBucket,
  HistogramRequest as ExceptionHistogramRequest,
} from "../Services/ExceptionAggregationService";
import ProfileAggregationService, {
  FlamegraphRequest,
  FunctionListRequest,
  FunctionListItem,
  ProfileFlamegraphNode,
  DiffFlamegraphRequest,
  DiffFlamegraphNode,
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
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/telemetry/metrics/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Metric);
  },
);

router.post(
  "/telemetry/metrics/get-attribute-values",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributeValues(req, res, next, TelemetryType.Metric);
  },
);

router.post(
  "/telemetry/logs/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Log);
  },
);

router.post(
  "/telemetry/logs/get-attribute-values",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributeValues(req, res, next, TelemetryType.Log);
  },
);

router.post(
  "/telemetry/traces/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Trace);
  },
);

router.post(
  "/telemetry/traces/get-attribute-values",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributeValues(req, res, next, TelemetryType.Trace);
  },
);

router.post(
  "/telemetry/exceptions/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Exception);
  },
);

router.post(
  "/telemetry/exceptions/get-attribute-values",
  UserMiddleware.getUserMiddleware,
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

    const values: string[] =
      await TelemetryAttributeService.fetchAttributeValues({
        projectId: databaseProps.tenantId,
        telemetryType,
        metricName,
        attributeKey,
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
  UserMiddleware.getUserMiddleware,
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
  UserMiddleware.getUserMiddleware,
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
        : ["severityText", "serviceId"];

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

      return Response.sendJsonObjectResponse(req, res, {
        facets: facets as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Trace Histogram Endpoint ---

router.post(
  "/telemetry/traces/histogram",
  UserMiddleware.getUserMiddleware,
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

      const statusCodes: Array<number> | undefined = body["statusCodes"]
        ? (body["statusCodes"] as Array<number>)
        : undefined;

      const spanKinds: Array<string> | undefined = body["spanKinds"]
        ? (body["spanKinds"] as Array<string>)
        : undefined;

      const spanNames: Array<string> | undefined = body["spanNames"]
        ? (body["spanNames"] as Array<string>)
        : undefined;

      const traceIds: Array<string> | undefined = body["traceIds"]
        ? (body["traceIds"] as Array<string>)
        : undefined;

      const nameSearchText: string | undefined = body["nameSearchText"]
        ? (body["nameSearchText"] as string)
        : undefined;

      const rootOnly: boolean | undefined =
        body["rootOnly"] === undefined ? undefined : Boolean(body["rootOnly"]);

      const attributes: Record<string, string> | undefined = body["attributes"]
        ? (body["attributes"] as Record<string, string>)
        : undefined;

      const request: TraceHistogramRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        bucketSizeInMinutes,
        serviceIds,
        statusCodes,
        spanKinds,
        spanNames,
        traceIds,
        nameSearchText,
        rootOnly,
        attributes,
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
  UserMiddleware.getUserMiddleware,
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
        : ["serviceId", "statusCode", "kind", "name"];

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

      const statusCodes: Array<number> | undefined = body["statusCodes"]
        ? (body["statusCodes"] as Array<number>)
        : undefined;

      const spanKinds: Array<string> | undefined = body["spanKinds"]
        ? (body["spanKinds"] as Array<string>)
        : undefined;

      const spanNames: Array<string> | undefined = body["spanNames"]
        ? (body["spanNames"] as Array<string>)
        : undefined;

      const traceIds: Array<string> | undefined = body["traceIds"]
        ? (body["traceIds"] as Array<string>)
        : undefined;

      const nameSearchText: string | undefined = body["nameSearchText"]
        ? (body["nameSearchText"] as string)
        : undefined;

      const rootOnly: boolean | undefined =
        body["rootOnly"] === undefined ? undefined : Boolean(body["rootOnly"]);

      const attributes: Record<string, string> | undefined = body["attributes"]
        ? (body["attributes"] as Record<string, string>)
        : undefined;

      /*
       * Compute all facets from a single sort-key-aligned sample query
       * (ORDER BY startTime DESC LIMIT N) and count top-K in Node. This
       * avoids ClickHouse GROUP BY aggregations that can't return partial
       * results under max_execution_time 'break' mode, and returns in
       * <1s even over 14-day windows.
       */
      const multiRequest: TraceMultiFacetRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        facetKeys,
        limit,
        serviceIds,
        statusCodes,
        spanKinds,
        spanNames,
        traceIds,
        nameSearchText,
        rootOnly,
        attributes,
      };

      let facets: Record<string, Array<TraceFacetValue>>;
      try {
        facets =
          await TraceAggregationService.getFacetValuesFromSample(multiRequest);
      } catch {
        facets = Object.fromEntries(
          facetKeys.map((key: string): [string, Array<TraceFacetValue>] => {
            return [key, []];
          }),
        );
      }

      return Response.sendJsonObjectResponse(req, res, {
        facets: facets as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Exception Histogram Endpoint ---

router.post(
  "/telemetry/exceptions/histogram",
  UserMiddleware.getUserMiddleware,
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

// --- Log Analytics Endpoint ---

router.post(
  "/telemetry/logs/analytics",
  UserMiddleware.getUserMiddleware,
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
  UserMiddleware.getUserMiddleware,
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
          "time,serviceId,severityText,severityNumber,body,traceId,spanId,attributes";
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
            escapeCsv(row["serviceId"]),
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
  UserMiddleware.getUserMiddleware,
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
      const serviceId: string | undefined = body["serviceId"] as
        | string
        | undefined;
      const time: string | undefined = body["time"] as string | undefined;

      if (!logId || !serviceId || !time) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("logId, serviceId, and time are required"),
        );
      }

      const count: number = (body["count"] as number) || 5;

      const result: {
        before: Array<JSONObject>;
        after: Array<JSONObject>;
      } = await LogAggregationService.getLogContext({
        projectId: databaseProps.tenantId,
        serviceId: new ObjectID(serviceId),
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
  UserMiddleware.getUserMiddleware,
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
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Profile);
  },
);

// --- Profile Flamegraph Endpoint ---

router.post(
  "/telemetry/profiles/flamegraph",
  UserMiddleware.getUserMiddleware,
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

      const flamegraph: ProfileFlamegraphNode =
        await ProfileAggregationService.getFlamegraph(request);

      return Response.sendJsonObjectResponse(req, res, {
        flamegraph: flamegraph as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Profile Function List Endpoint ---

router.post(
  "/telemetry/profiles/function-list",
  UserMiddleware.getUserMiddleware,
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
        startTime,
        endTime,
        ...(serviceIds !== undefined && { serviceIds }),
        ...(profileType !== undefined && { profileType }),
        ...(profileTypes !== undefined &&
          profileTypes.length > 0 && { profileTypes }),
        ...(limit !== undefined && { limit }),
        ...(sortBy !== undefined && { sortBy }),
      };

      const functions: Array<FunctionListItem> =
        await ProfileAggregationService.getFunctionList(request);

      return Response.sendJsonObjectResponse(req, res, {
        functions: functions as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

// --- Profile pprof Export Endpoint ---

router.get(
  "/telemetry/profiles/:profileId/pprof",
  UserMiddleware.getUserMiddleware,
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
  UserMiddleware.getUserMiddleware,
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

      const diffFlamegraph: DiffFlamegraphNode =
        await ProfileAggregationService.getDiffFlamegraph(request);

      return Response.sendJsonObjectResponse(req, res, {
        diffFlamegraph: diffFlamegraph as unknown as JSONObject,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

export default router;
