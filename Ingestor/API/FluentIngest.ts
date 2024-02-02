import { ProductType } from "Model/Models/UsageBilling";
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import { TelemetryRequest } from "../Middleware/TelemetryIngest";
import Response from "CommonServer/Utils/Response";
import logger from "CommonServer/Utils/Logger";

// import { JSONArray, JSONObject } from "Common/Types/JSON";
// import Log from "Model/AnalyticsModels/Log";
// import OTelIngestService from "../Service/OTelIngest";
// import LogService from "CommonServer/Services/LogService";
// import OneUptimeDate from "Common/Types/Date";

export class FluentRequestMiddleware {
    public static async getProductType(
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        try {
            (req as TelemetryRequest).productType = ProductType.Logs;
        } catch (err) {
            return next(err);
        }
    }
}

const router: ExpressRouter = Express.getRouter();

router.post(
    '/fluentd/v1/logs',
    // FluentRequestMiddleware.getProductType,
    // TelemetryIngest.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            logger.info('Fluent Ingestor API called');

            logger.info('Request body: ');
            logger.info(req.body);

            // const resourceLogs: JSONArray = req.body[
            //     'resourceLogs'
            // ] as JSONArray;

            // const dbLogs: Array<Log> = [];

            // for (const resourceLog of resourceLogs) {
            //     const scopeLogs: JSONArray = resourceLog[
            //         'scopeLogs'
            //     ] as JSONArray;

            //     for (const scopeLog of scopeLogs) {
            //         const logRecords: JSONArray = scopeLog[
            //             'logRecords'
            //         ] as JSONArray;

            //         for (const log of logRecords) {
            //             const dbLog: Log = new Log();

            //             /*
            //             Example: 

            //             {
            //                 "timeUnixNano":"1698069643739368000",
            //                 "severityNumber":"SEVERITY_NUMBER_INFO",
            //                 "severityText":"Information",
            //                 "body":{
            //                     "stringValue":"Application is shutting down..."
            //                 },
            //                 "traceId":"",
            //                 "spanId":"",
            //                 "observedTimeUnixNano":"1698069643739368000"
            //             }
            //             */

            //             dbLog.projectId = (req as TelemetryRequest).projectId;
            //             dbLog.serviceId = (req as TelemetryRequest).serviceId;

            //             dbLog.timeUnixNano = log['timeUnixNano'] as number;
            //             dbLog.time = OneUptimeDate.fromUnixNano(
            //                 log['timeUnixNano'] as number
            //             );
            //             dbLog.severityNumber = log['severityNumber'] as string;
            //             dbLog.severityText = log['severityText'] as string;

            //             const logBody: JSONObject = log['body'] as JSONObject;

            //             dbLog.body = logBody['stringValue'] as string;

            //             dbLog.traceId = log['traceId'] as string;
            //             dbLog.spanId = log['spanId'] as string;

            //             // We need to convert this to date.
            //             dbLog.attributes = OTelIngestService.getKeyValues(
            //                 log['attributes'] as JSONArray
            //             );

            //             dbLogs.push(dbLog);
            //         }
            //     }
            // }

            // await LogService.createMany({
            //     items: dbLogs,
            //     props: {
            //         isRoot: true,
            //     },
            // });

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;