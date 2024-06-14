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
import Log, { LogSeverity } from "Model/AnalyticsModels/Log";

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

      for (let logItem of logItems) {
        const dbLog: Log = new Log();

        dbLog.projectId = (req as TelemetryRequest).projectId;
        dbLog.serviceId = (req as TelemetryRequest).serviceId;
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

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
