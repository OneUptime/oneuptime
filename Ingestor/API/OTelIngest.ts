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
import OneUptimeDate from 'Common/Types/Date';
import KeyValueNestedModel from 'Model/AnalyticsModels/NestedModels/KeyValueNestedModel';
import SpanService from 'CommonServer/Services/SpanService';
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

            logger.info(req.body);

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
