import TelemetryIngest, {
  TelemetryRequest,
} from "../Middleware/TelemetryIngest";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import LogService from "CommonServer/Services/LogService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "CommonServer/Utils/Express";
import logger from "CommonServer/Utils/Logger";
import Response from "CommonServer/Utils/Response";
import Log from "Model/AnalyticsModels/Log";
import LogSeverity from "Common/Types/Log/LogSeverity";
import OTelIngestService from "../Service/OTelIngest";
import ObjectID from "Common/Types/ObjectID";
import JSONFunctions from "Common/Types/JSONFunctions";

export class FluentRequestMiddleware {
  public static async getProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      (req as TelemetryRequest).productType = ProductType.Logs;
      return next();
    } catch (err) {
      return next(err);
    }
  }
}

const router: ExpressRouter = Express.getRouter();

router.post(
  "/fluentd/v1/logs",
  FluentRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      logger.debug("Fluent Ingestor API called");

      const dbLogs: Array<Log> = [];

      const logItems: Array<JSONObject | string> = req.body as Array<
        JSONObject | string
      >;

      let oneuptimeServiceName: string | string[] | undefined =
        req.headers["x-oneuptime-service-name"];

      if (!oneuptimeServiceName) {
        oneuptimeServiceName = "Unknown Service";
      }

      const telemetryService: {
        serviceId: ObjectID;
        dataRententionInDays: number;
      } = await OTelIngestService.telemetryServiceFromName({
        serviceName: oneuptimeServiceName as string,
        projectId: (req as TelemetryRequest).projectId,
      });

      for (let logItem of logItems) {
        const dbLog: Log = new Log();

        dbLog.projectId = (req as TelemetryRequest).projectId;
        dbLog.serviceId = telemetryService.serviceId;
        dbLog.severityNumber = 0;
        const currentTimeAndDate: Date = OneUptimeDate.getCurrentDate();
        dbLog.timeUnixNano = OneUptimeDate.toUnixNano(currentTimeAndDate);
        dbLog.time = currentTimeAndDate;

        dbLog.severityText = LogSeverity.Unspecified;

        if (typeof logItem !== "string") {
          logItem = JSON.stringify(logItem);
        }

        dbLog.body = logItem as string;

        dbLogs.push(dbLog);
      }

      await LogService.createMany({
        items: dbLogs,
        props: {
          isRoot: true,
        },
      });

      OTelIngestService.recordDataIngestedUsgaeBilling({
        services: {
          [oneuptimeServiceName as string]: {
            dataIngestedInGB: JSONFunctions.getSizeOfJSONinGB(req.body),
            dataRententionInDays: telemetryService.dataRententionInDays,
            serviceId: telemetryService.serviceId,
            serviceName: oneuptimeServiceName as string,
          },
        },
        projectId: (req as TelemetryRequest).projectId,
        productType: ProductType.Logs,
      }).catch((err: Error) => {
        logger.error(err);
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
