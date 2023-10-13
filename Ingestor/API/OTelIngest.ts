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
// Load proto file for OTel

// Create a root namespace
const LogsProto: protobuf.Root = protobuf.loadSync(
    '/usr/src/app/ProtoFiles/Otel/v1/logs.proto'
);
const TracesProto: protobuf.Root = protobuf.loadSync(
    '/usr/src/app/ProtoFiles/Otel/v1/traces.proto'
);
const MetricsProto: protobuf.Root = protobuf.loadSync(
    '/usr/src/app/ProtoFiles/Otel/v1/metrics.proto'
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
    '/otel/*',
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
