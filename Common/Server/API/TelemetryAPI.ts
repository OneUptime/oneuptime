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
  "/telemetry/logs/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Log);
  },
);

router.post(
  "/telemetry/traces/get-attributes",
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    return getAttributes(req, res, next, TelemetryType.Trace);
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

    const attributes: string[] =
      await TelemetryAttributeService.fetchAttributes({
        projectId: databaseProps.tenantId,
        telemetryType,
      });

    return Response.sendJsonObjectResponse(req, res, {
      attributes: attributes,
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

      const facets: Record<string, Array<FacetValue>> = {};

      for (const facetKey of facetKeys) {
        const request: FacetRequest = {
          projectId: databaseProps.tenantId,
          startTime,
          endTime,
          facetKey,
          limit,
          serviceIds,
          severityTexts,
          bodySearchText,
          traceIds,
          spanIds,
        };

        facets[facetKey] = await LogAggregationService.getFacetValues(request);
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

export default router;
