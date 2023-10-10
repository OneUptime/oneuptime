import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import logger from 'CommonServer/Utils/Logger';
import protobuf from 'protobufjs';

// Load proto file for OTel

// Create a root namespace
const LogsProto = protobuf.loadSync('/usr/src/app/ProtoFiles/Otel/v1/logs.proto');
const TracesProto = protobuf.loadSync('/usr/src/app/ProtoFiles/Otel/v1/traces.proto');
const MetricsProto = protobuf.loadSync('/usr/src/app/ProtoFiles/Otel/v1/metrics.proto');


// Lookup the message type
const LogsData = LogsProto.lookupType('LogsData');
const TracesData = TracesProto.lookupType('TracesData');
const MetricsData = MetricsProto.lookupType('MetricsData');

const router: ExpressRouter = Express.getRouter();

/** 
 *  
 *  Otel Middleware
 * 
 */
router.use('/otel/*', (req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
    try {

        if (req.baseUrl === '/otel/v1/traces') {
            req.body = TracesData.decode(req.body);
        }

        if (req.baseUrl === '/otel/v1/logs') {
            req.body = LogsData.decode(req.body);
        }

        if (req.baseUrl === '/otel/v1/metrics') {
            req.body = MetricsData.decode(req.body);
        }

        next();

    } catch (err) {
        return next(err);
    }
});

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
