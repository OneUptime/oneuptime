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
const root = protobuf.loadSync('CommonServer/ProtoFiles/otel.proto');

const router: ExpressRouter = Express.getRouter();

router.post(
    '/otel/*',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {

            logger.info('OTelIngest URL: ', req.url);

            if(req.url === '/otel/v1/traces') {

            }


            // middleware marks the probe as alive.
            // so we don't need to do anything here.
            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
