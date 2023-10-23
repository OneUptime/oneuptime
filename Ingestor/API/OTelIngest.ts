import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import logger from 'CommonServer/Utils/Logger';
import protobuf from 'protobufjs';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import Span from 'Model/AnalyticsModels/Span';
import Log from 'Model/AnalyticsModels/Log';
import OneUptimeDate from 'Common/Types/Date';
import KeyValueNestedModel from 'Model/AnalyticsModels/NestedModels/KeyValueNestedModel';
import SpanService from 'CommonServer/Services/SpanService';
import LogService from 'CommonServer/Services/LogService';
import ObjectID from 'Common/Types/ObjectID';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
// Load proto file for OTel

// Create a root namespace
const LogsProto: protobuf.Root = protobuf.loadSync(
    '/usr/src/app/ProtoFiles/OTel/v1/logs.proto'
);
const TracesProto: protobuf.Root = protobuf.loadSync(
    '/usr/src/app/ProtoFiles/OTel/v1/traces.proto'
);
const MetricsProto: protobuf.Root = protobuf.loadSync(
    '/usr/src/app/ProtoFiles/OTel/v1/metrics.proto'
);

// Lookup the message type
const LogsData: protobuf.Type = LogsProto.lookupType('LogsData');
const TracesData: protobuf.Type = TracesProto.lookupType('TracesData');
const MetricsData: protobuf.Type = MetricsProto.lookupType('MetricsData');

const router: ExpressRouter = Express.getRouter();

/**
 *
 *  Otel Middleware
 *
 */
router.use(
    '/otel/*',
    (req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
        try {
            if (req.baseUrl === '/otel/v1/traces') {
                req.body = TracesData.decode(req.body);
            } else if (req.baseUrl === '/otel/v1/logs') {
                req.body = LogsData.decode(req.body);
            } else if (req.baseUrl === '/otel/v1/metrics') {
                req.body = MetricsData.decode(req.body);
            } else {
                throw new BadRequestException('Invalid URL: ' + req.baseUrl);
            }

            next();
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/otel/v1/traces',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const traceData: JSONObject = req.body.toJSON();
            const resourceSpans: JSONArray = traceData[
                'resourceSpans'
            ] as JSONArray;

            const dbSpans: Array<Span> = [];

            for (const resourceSpan of resourceSpans) {
                const scopeSpans: JSONArray = resourceSpan[
                    'scopeSpans'
                ] as JSONArray;

                for (const scopeSpan of scopeSpans) {
                    const spans: JSONArray = scopeSpan['spans'] as JSONArray;

                    for (const span of spans) {
                        const dbSpan: Span = new Span();

                        dbSpan.projectId = ObjectID.getZeroObjectID();
                        dbSpan.serviceId = ObjectID.getZeroObjectID();

                        dbSpan.spanId = span['spanId'] as string;
                        dbSpan.traceId = span['traceId'] as string;
                        dbSpan.parentSpanId = span['parentSpanId'] as string;
                        dbSpan.startTimeUnixNano = span[
                            'startTimeUnixNano'
                        ] as number;
                        dbSpan.endTimeUnixNano = span[
                            'endTimeUnixNano'
                        ] as number;
                        dbSpan.startTime = OneUptimeDate.fromUnixNano(
                            span['startTimeUnixNano'] as number
                        );
                        dbSpan.endTime = OneUptimeDate.fromUnixNano(
                            span['endTimeUnixNano'] as number
                        );
                        dbSpan.name = span['name'] as string;
                        dbSpan.kind = span['kind'] as string;

                        // We need to convert this to date.
                        const attributes: JSONArray = span[
                            'attributes'
                        ] as JSONArray;

                        const dbattributes: Array<KeyValueNestedModel> = [];

                        for (const attribute of attributes) {
                            const dbattribute: KeyValueNestedModel =
                                new KeyValueNestedModel();
                            dbattribute.key = attribute['key'] as string;

                            const value: JSONObject = attribute[
                                'value'
                            ] as JSONObject;

                            if (value['stringValue']) {
                                dbattribute.stringValue = value[
                                    'stringValue'
                                ] as string;
                            }

                            if (value['intValue']) {
                                dbattribute.numberValue = value[
                                    'intValue'
                                ] as number;
                            }
                            dbattributes.push(dbattribute);
                        }

                        dbSpan.attributes = dbattributes;

                        dbSpans.push(dbSpan);
                    }
                }
            }

            await SpanService.createMany({
                items: dbSpans,
                props: {
                    isRoot: true,
                },
            });

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/otel/v1/metrics',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            logger.info('OTel Ingestor API called');

            logger.info(req.body);

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/otel/v1/logs',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            logger.info('OTel Ingestor API called');

            req.body = req.body.toJSON();

            const resourceLogs: JSONArray = req.body[
                'resourceLogs'
            ] as JSONArray;

            const dbLogs: Array<Log> = [];

            for (const resourceLog of resourceLogs) {
                const scopeLogs: JSONArray = resourceLog[
                    'scopeLogs'
                ] as JSONArray;

                for (const scopeLog of scopeLogs) {
                    const logRecords: JSONArray = scopeLog[
                        'logRecords'
                    ] as JSONArray;

                    for (const log of logRecords) {
                        const dbLog: Log = new Log();

                        /*
                        Example: 

                        {
                            "timeUnixNano":"1698069643739368000",
                            "severityNumber":"SEVERITY_NUMBER_INFO",
                            "severityText":"Information",
                            "body":{
                                "stringValue":"Application is shutting down..."
                            },
                            "traceId":"",
                            "spanId":"",
                            "observedTimeUnixNano":"1698069643739368000"
                        }
                        */

                        dbLog.projectId = ObjectID.getZeroObjectID();
                        dbLog.serviceId = ObjectID.getZeroObjectID();

                        dbLog.timeUnixNano = log['timeUnixNano'] as number;
                        dbLog.time = OneUptimeDate.fromUnixNano(
                            log['timeUnixNano'] as number
                        );
                        dbLog.severityNumber = log['severityNumber'] as string;
                        dbLog.severityText = log['severityText'] as string;

                        const logBody: JSONObject = log['body'] as JSONObject;

                        dbLog.body = logBody['stringValue'] as string;

                        dbLog.traceId = log['traceId'] as string;
                        dbLog.spanId = log['spanId'] as string;

                        // We need to convert this to date.
                        const attributes: JSONArray = log[
                            'attributes'
                        ] as JSONArray;

                        if (attributes) {
                            const dbattributes: Array<KeyValueNestedModel> = [];

                            for (const attribute of attributes) {
                                const dbattribute: KeyValueNestedModel =
                                    new KeyValueNestedModel();
                                dbattribute.key = attribute['key'] as string;

                                const value: JSONObject = attribute[
                                    'value'
                                ] as JSONObject;

                                if (value['stringValue']) {
                                    dbattribute.stringValue = value[
                                        'stringValue'
                                    ] as string;
                                }

                                if (value['intValue']) {
                                    dbattribute.numberValue = value[
                                        'intValue'
                                    ] as number;
                                }
                                dbattributes.push(dbattribute);
                            }

                            dbLog.attributes = dbattributes;
                        }

                        dbLogs.push(dbLog);
                    }
                }
            }

            await LogService.createMany({
                items: dbLogs,
                props: {
                    isRoot: true,
                },
            });

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
