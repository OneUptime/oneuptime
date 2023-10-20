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

            const traceData = req.body.toJSON();
            const resourceSpans = traceData.resourceSpans;

            const dbSpans: Array<Span> = [];

            for (const resourceSpan of resourceSpans) {

                const scopeSpans = resourceSpan.scopeSpans;

                for (const scopeSpan of scopeSpans) {

                    const spans = scopeSpan.spans;



                    for (const span of spans) {


                        const dbSpan = new Span();

                        dbSpan.projectId = ObjectID.getZeroObjectID();
                        dbSpan.serviceId = ObjectID.getZeroObjectID();

                        dbSpan.spanId = span.spanId;
                        dbSpan.traceId = span.traceId;
                        dbSpan.parentSpanId = span.parentSpanId;
                        dbSpan.startTimeUnixNano = span.startTimeUnixNano;
                        dbSpan.endTimeUnixNano = span.endTimeUnixNano;
                        dbSpan.startTime = OneUptimeDate.fromUnixNano(span.startTimeUnixNano);
                        dbSpan.endTime = OneUptimeDate.fromUnixNano(span.endTimeUnixNano);
                        dbSpan.name = span.name;
                        dbSpan.kind = span.kind;

                        // We need to convert this to date. 
                        const attributes = span.attributes;

                        const dbattributes: Array<KeyValueNestedModel> = [];

                        for (const attribute of attributes) {
                            const dbattribute = new KeyValueNestedModel();
                            dbattribute.key = attribute.key;
                            if (attribute.value.stringValue) {
                                dbattribute.stringValue = attribute.value.stringValue;
                            }
                            if (attribute.value.intValue) {
                                dbattribute.numberValue = attribute.value.intValue;
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
                    isRoot: true
                }
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
