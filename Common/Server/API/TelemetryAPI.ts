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
        ? (body["serviceIds"] as Array<string>).map(
            (id: string) => new ObjectID(id),
          )
        : undefined;

      const severityTexts: Array<string> | undefined = body["severityTexts"]
        ? (body["severityTexts"] as Array<string>)
        : undefined;

      const bodySearchText: string | undefined = body["bodySearchText"]
        ? (body["bodySearchText"] as string)
        : undefined;

      const request: HistogramRequest = {
        projectId: databaseProps.tenantId,
        startTime,
        endTime,
        bucketSizeInMinutes,
        serviceIds,
        severityTexts,
        bodySearchText,
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

      const limit: number = (body["limit"] as number) || 10;

      const serviceIds: Array<ObjectID> | undefined = body["serviceIds"]
        ? (body["serviceIds"] as Array<string>).map(
            (id: string) => new ObjectID(id),
          )
        : undefined;

      const severityTexts: Array<string> | undefined = body["severityTexts"]
        ? (body["severityTexts"] as Array<string>)
        : undefined;

      const bodySearchText: string | undefined = body["bodySearchText"]
        ? (body["bodySearchText"] as string)
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
