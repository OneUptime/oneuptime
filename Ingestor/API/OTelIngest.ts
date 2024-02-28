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
import Span, { SpanKind } from 'Model/AnalyticsModels/Span';
import Log, { LogSeverity } from 'Model/AnalyticsModels/Log';
import OneUptimeDate from 'Common/Types/Date';
import SpanService from 'CommonServer/Services/SpanService';
import MetricSumService from 'CommonServer/Services/MetricSumService';
import MetricHistogramService from 'CommonServer/Services/MetricHistogramService';
import MetricGaugeService from 'CommonServer/Services/MetricGaugeService';
import MetricSum from 'Model/AnalyticsModels/MetricSum';
import MetricGauge from 'Model/AnalyticsModels/MetricGauge';
import MetricHistogram from 'Model/AnalyticsModels/MetricHistogram';
import LogService from 'CommonServer/Services/LogService';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import OTelIngestService from '../Service/OTelIngest';
import { ProductType } from 'Model/Models/UsageBilling';
import TelemetryIngest, {
    TelemetryRequest,
} from '../Middleware/TelemetryIngest';
import Text from 'Common/Types/Text';

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

class OpenTelemetryRequestMiddleware {
    public static async getProductType(
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        try {
            let productType: ProductType;

            const isProtobuf: boolean = req.body instanceof Uint8Array;

            if (req.url.includes('/otlp/v1/traces')) {
                if (isProtobuf) {
                    req.body = TracesData.decode(req.body);
                }
                productType = ProductType.Traces;
            } else if (req.url.includes('/otlp/v1/logs')) {
                if (isProtobuf) {
                    req.body = LogsData.decode(req.body);
                }
                productType = ProductType.Logs;
            } else if (req.url.includes('/otlp/v1/metrics')) {
                if (isProtobuf) {
                    req.body = MetricsData.decode(req.body);
                }
                productType = ProductType.Metrics;
            } else {
                throw new BadRequestException('Invalid URL: ' + req.baseUrl);
            }

            (req as TelemetryRequest).productType = productType;
            next();
        } catch (err) {
            return next(err);
        }
    }
}

router.post(
    '/otlp/v1/traces',
    OpenTelemetryRequestMiddleware.getProductType,
    TelemetryIngest.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (
                !(req as TelemetryRequest).projectId ||
                !(req as TelemetryRequest).serviceId
            ) {
                throw new BadRequestException(
                    'Invalid request - projectId or serviceId not found in request.'
                );
            }

            const traceData: JSONObject = req.body.toJSON
                ? req.body.toJSON()
                : req.body;
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

                        dbSpan.projectId = (req as TelemetryRequest).projectId;
                        dbSpan.serviceId = (req as TelemetryRequest).serviceId;

                        dbSpan.spanId = Text.convertBase64ToHex(
                            span['spanId'] as string
                        );
                        dbSpan.traceId = Text.convertBase64ToHex(
                            span['traceId'] as string
                        );
                        dbSpan.parentSpanId = Text.convertBase64ToHex(
                            span['parentSpanId'] as string
                        );
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

                        dbSpan.durationUnixNano =
                            (span['endTimeUnixNano'] as number) -
                            (span['startTimeUnixNano'] as number);

                        dbSpan.name = span['name'] as string;
                        dbSpan.kind =
                            (span['kind'] as SpanKind) || SpanKind.Internal;

                        dbSpan.attributes = OTelIngestService.getAttributes(
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
    '/otlp/v1/metrics',
    OpenTelemetryRequestMiddleware.getProductType,
    TelemetryIngest.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (
                !(req as TelemetryRequest).projectId ||
                !(req as TelemetryRequest).serviceId
            ) {
                throw new BadRequestException(
                    'Invalid request - projectId or serviceId not found in request.'
                );
            }

            req.body = req.body.toJSON ? req.body.toJSON() : req.body;

            const resourceMetrics: JSONArray = req.body[
                'resourceMetrics'
            ] as JSONArray;

            const dbMetricsSum: Array<MetricSum> = [];
            const dbMetricsHistogram: Array<MetricHistogram> = [];
            const dbMetricsGauge: Array<MetricGauge> = [];

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

                                dbMetricSum.projectId = (
                                    req as TelemetryRequest
                                ).projectId;
                                dbMetricSum.serviceId = (
                                    req as TelemetryRequest
                                ).serviceId;

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

                                // dbMetricSum.attributes =
                                //     OTelIngestService.getAttributes(
                                //         metric['attributes'] as JSONArray
                                //     );

                                dbMetricsSum.push(dbMetricSum);
                            }
                        } else if (
                            metric['gauge'] &&
                            (metric['gauge'] as JSONObject)['dataPoints'] &&
                            (
                                (metric['gauge'] as JSONObject)[
                                    'dataPoints'
                                ] as JSONArray
                            ).length > 0
                        ) {
                            for (const datapoint of (
                                metric['gauge'] as JSONObject
                            )['dataPoints'] as JSONArray) {
                                const dbMetricGauge: MetricGauge =
                                    new MetricGauge();

                                dbMetricGauge.projectId = (
                                    req as TelemetryRequest
                                ).projectId;
                                dbMetricGauge.serviceId = (
                                    req as TelemetryRequest
                                ).serviceId;

                                dbMetricGauge.name = metricName;
                                dbMetricGauge.description = metricDescription;

                                dbMetricGauge.startTimeUnixNano = datapoint[
                                    'startTimeUnixNano'
                                ] as number;
                                dbMetricGauge.startTime =
                                    OneUptimeDate.fromUnixNano(
                                        datapoint['startTimeUnixNano'] as number
                                    );

                                dbMetricGauge.timeUnixNano = datapoint[
                                    'timeUnixNano'
                                ] as number;
                                dbMetricGauge.time = OneUptimeDate.fromUnixNano(
                                    datapoint['timeUnixNano'] as number
                                );

                                dbMetricGauge.value = datapoint[
                                    'asInt'
                                ] as number;

                                // dbMetricGauge.attributes =
                                //     OTelIngestService.getKeyValues(
                                //         metric['attributes'] as JSONArray
                                //     );

                                dbMetricsGauge.push(dbMetricGauge);
                            }
                        } else if (
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

                                dbMetricHistogram.projectId = (
                                    req as TelemetryRequest
                                ).projectId;
                                dbMetricHistogram.serviceId = (
                                    req as TelemetryRequest
                                ).serviceId;

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

                                // dbMetricHistogram.attributes =
                                //     OTelIngestService.getKeyValues(
                                //         metric['attributes'] as JSONArray
                                //     );

                                dbMetricsHistogram.push(dbMetricHistogram);
                            }
                        } else {
                            logger.warn('Unknown metric type');
                            logger.warn(metric);
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

            await MetricGaugeService.createMany({
                items: dbMetricsGauge,
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
    '/otlp/v1/logs',
    OpenTelemetryRequestMiddleware.getProductType,
    TelemetryIngest.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (
                !(req as TelemetryRequest).projectId ||
                !(req as TelemetryRequest).serviceId
            ) {
                throw new BadRequestException(
                    'Invalid request - projectId or serviceId not found in request.'
                );
            }

            req.body = req.body.toJSON ? req.body.toJSON() : req.body;

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

                        dbLog.projectId = (req as TelemetryRequest).projectId;
                        dbLog.serviceId = (req as TelemetryRequest).serviceId;

                        dbLog.timeUnixNano = log['timeUnixNano'] as number;
                        dbLog.time = OneUptimeDate.fromUnixNano(
                            log['timeUnixNano'] as number
                        );

                        let logSeverityNumber: number =
                            (log['severityNumber'] as number) || 0; // 0 is Unspecified by default.

                        if (typeof logSeverityNumber === 'string') {
                            if (logSeverityNumber === 'SEVERITY_NUMBER_TRACE') {
                                logSeverityNumber = 1;
                            } else if (
                                logSeverityNumber === 'SEVERITY_NUMBER_DEBUG'
                            ) {
                                logSeverityNumber = 5;
                            } else if (
                                logSeverityNumber === 'SEVERITY_NUMBER_INFO'
                            ) {
                                logSeverityNumber = 9;
                            } else if (
                                logSeverityNumber === 'SEVERITY_NUMBER_WARN'
                            ) {
                                logSeverityNumber = 13;
                            } else if (
                                logSeverityNumber === 'SEVERITY_NUMBER_ERROR'
                            ) {
                                logSeverityNumber = 17;
                            } else if (
                                logSeverityNumber === 'SEVERITY_NUMBER_FATAL'
                            ) {
                                logSeverityNumber = 21;
                            } else {
                                logSeverityNumber = parseInt(logSeverityNumber);
                            }
                        }

                        dbLog.severityNumber = logSeverityNumber;

                        let logSeverity: LogSeverity = LogSeverity.Unspecified;

                        // these numbers are from the opentelemetry/api-logs package
                        if (logSeverityNumber < 0 || logSeverityNumber > 24) {
                            logSeverity = LogSeverity.Unspecified;
                            logSeverityNumber = 0;
                        } else if (
                            logSeverityNumber >= 1 &&
                            logSeverityNumber <= 4
                        ) {
                            logSeverity = LogSeverity.Trace;
                        } else if (
                            logSeverityNumber >= 5 &&
                            logSeverityNumber <= 8
                        ) {
                            logSeverity = LogSeverity.Debug;
                        } else if (
                            logSeverityNumber >= 9 &&
                            logSeverityNumber <= 12
                        ) {
                            logSeverity = LogSeverity.Information;
                        } else if (
                            logSeverityNumber >= 13 &&
                            logSeverityNumber <= 16
                        ) {
                            logSeverity = LogSeverity.Warning;
                        } else if (
                            logSeverityNumber >= 17 &&
                            logSeverityNumber <= 20
                        ) {
                            logSeverity = LogSeverity.Error;
                        } else if (
                            logSeverityNumber >= 21 &&
                            logSeverityNumber <= 24
                        ) {
                            logSeverity = LogSeverity.Fatal;
                        }

                        dbLog.severityText = logSeverity;

                        const logBody: JSONObject = log['body'] as JSONObject;

                        dbLog.body = logBody['stringValue'] as string;

                        dbLog.traceId = Text.convertBase64ToHex(
                            log['traceId'] as string
                        );
                        dbLog.spanId = Text.convertBase64ToHex(
                            log['spanId'] as string
                        );

                        // We need to convert this to date.
                        dbLog.attributes = OTelIngestService.getAttributes(
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
