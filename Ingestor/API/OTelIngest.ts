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
import SpanService from 'CommonServer/Services/SpanService';
import MetricSumService from 'CommonServer/Services/MetricSumService';
import MetricHistogramService from 'CommonServer/Services/MetricHistogramService';
import MetricSum from 'Model/AnalyticsModels/MetricSum';
import MetricHistogram from 'Model/AnalyticsModels/MetricHistogram';
import LogService from 'CommonServer/Services/LogService';
import ObjectID from 'Common/Types/ObjectID';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import OTelIngestService from '../Service/OTelIngest';
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

                        dbSpan.attributes = OTelIngestService.getKeyValues(
                            span['attributes'] as JSONArray
                        );

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
            req.body = req.body.toJSON();

            const resourceMetrics: JSONArray = req.body[
                'resourceMetrics'
            ] as JSONArray;

            const dbMetricsSum: Array<MetricSum> = [];
            const dbMetricsHistogram: Array<MetricHistogram> = [];

            for (const resourceMetric of resourceMetrics) {
                const scopeMetrics: JSONArray = resourceMetric[
                    'scopeMetrics'
                ] as JSONArray;

                for (const scopeMetric of scopeMetrics) {
                    const metrics: JSONArray = scopeMetric[
                        'metrics'
                    ] as JSONArray;

                    for (const metric of metrics) {
                        const metricName: string = metric['name'] as string;
                        const metricDescription: string = metric[
                            'description'
                        ] as string;

                        if (
                            metric['sum'] &&
                            (metric['sum'] as JSONObject)['dataPoints'] &&
                            (
                                (metric['sum'] as JSONObject)[
                                    'dataPoints'
                                ] as JSONArray
                            ).length > 0
                        ) {
                            for (const datapoint of (
                                metric['sum'] as JSONObject
                            )['dataPoints'] as JSONArray) {
                                const dbMetricSum: MetricSum = new MetricSum();

                                dbMetricSum.projectId =
                                    ObjectID.getZeroObjectID();
                                dbMetricSum.serviceId =
                                    ObjectID.getZeroObjectID();

                                dbMetricSum.name = metricName;
                                dbMetricSum.description = metricDescription;

                                dbMetricSum.startTimeUnixNano = datapoint[
                                    'startTimeUnixNano'
                                ] as number;
                                dbMetricSum.startTime =
                                    OneUptimeDate.fromUnixNano(
                                        datapoint['startTimeUnixNano'] as number
                                    );

                                dbMetricSum.timeUnixNano = datapoint[
                                    'timeUnixNano'
                                ] as number;
                                dbMetricSum.time = OneUptimeDate.fromUnixNano(
                                    datapoint['timeUnixNano'] as number
                                );

                                dbMetricSum.value = datapoint[
                                    'asInt'
                                ] as number;

                                dbMetricSum.attributes =
                                    OTelIngestService.getKeyValues(
                                        metric['attributes'] as JSONArray
                                    );

                                dbMetricsSum.push(dbMetricSum);
                            }
                        }

                        if (
                            metric['histogram'] &&
                            (metric['histogram'] as JSONObject)['dataPoints'] &&
                            (
                                (metric['histogram'] as JSONObject)[
                                    'dataPoints'
                                ] as JSONArray
                            ).length > 0
                        ) {
                            for (const datapoint of (
                                metric['histogram'] as JSONObject
                            )['dataPoints'] as JSONArray) {
                                const dbMetricHistogram: MetricHistogram =
                                    new MetricHistogram();

                                dbMetricHistogram.projectId =
                                    ObjectID.getZeroObjectID();
                                dbMetricHistogram.serviceId =
                                    ObjectID.getZeroObjectID();

                                dbMetricHistogram.name = metricName;
                                dbMetricHistogram.description =
                                    metricDescription;

                                dbMetricHistogram.startTimeUnixNano = datapoint[
                                    'startTimeUnixNano'
                                ] as number;
                                dbMetricHistogram.startTime =
                                    OneUptimeDate.fromUnixNano(
                                        datapoint['startTimeUnixNano'] as number
                                    );

                                dbMetricHistogram.timeUnixNano = datapoint[
                                    'timeUnixNano'
                                ] as number;
                                dbMetricHistogram.time =
                                    OneUptimeDate.fromUnixNano(
                                        datapoint['timeUnixNano'] as number
                                    );

                                dbMetricHistogram.count = datapoint[
                                    'count'
                                ] as number;
                                dbMetricHistogram.sum = datapoint[
                                    'sum'
                                ] as number;

                                dbMetricHistogram.min = datapoint[
                                    'min'
                                ] as number;
                                dbMetricHistogram.max = datapoint[
                                    'max'
                                ] as number;

                                dbMetricHistogram.bucketCounts = datapoint[
                                    'bucketCounts'
                                ] as Array<number>;
                                dbMetricHistogram.explicitBounds = datapoint[
                                    'explicitBounds'
                                ] as Array<number>;

                                dbMetricHistogram.attributes =
                                    OTelIngestService.getKeyValues(
                                        metric['attributes'] as JSONArray
                                    );

                                dbMetricsHistogram.push(dbMetricHistogram);
                            }
                        }
                    }
                }
            }

            await MetricSumService.createMany({
                items: dbMetricsSum,
                props: {
                    isRoot: true,
                },
            });

            await MetricHistogramService.createMany({
                items: dbMetricsHistogram,
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
                        dbLog.attributes = OTelIngestService.getKeyValues(
                            log['attributes'] as JSONArray
                        );

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
