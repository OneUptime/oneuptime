import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from '../Utils/Express';
import LocalCache from '../Infrastructure/LocalCache';
import Response from '../Utils/Response';
import ServerException from 'Common/Types/Exception/ServerException';
import logger from '../Utils/Logger';
import Exception from 'Common/Types/Exception/Exception';

export interface StatusAPIOptions {
    readyCheck: () => Promise<void>;
    liveCheck: () => Promise<void>;
}

export default class StatusAPI {
    public static init(options: StatusAPIOptions): ExpressRouter {
        const router: ExpressRouter = Express.getRouter();

        router.get(
            '/app-name',
            (_req: ExpressRequest, res: ExpressResponse) => {
                res.send({ app: LocalCache.getString('app', 'name') });
            }
        );

        // General status
        router.get('/status', (req: ExpressRequest, res: ExpressResponse) => {
            Response.sendJsonObjectResponse(req, res, {
                status: 'ok',
            });
        });

        //Healthy probe
        router.get(
            '/status/ready',
            async (req: ExpressRequest, res: ExpressResponse) => {
                try {
                    logger.info('Ready check');
                    await options.readyCheck();
                    Response.sendJsonObjectResponse(req, res, {
                        status: 'ok',
                    });
                } catch (e) {
                    Response.sendErrorResponse(
                        req,
                        res,
                        e instanceof Exception
                            ? e
                            : new ServerException('Server is not ready')
                    );
                }
            }
        );

        //Liveness probe
        router.get(
            '/status/live',
            async (req: ExpressRequest, res: ExpressResponse) => {
                try {
                    logger.info('Live check');
                    await options.readyCheck();
                    Response.sendJsonObjectResponse(req, res, {
                        status: 'ok',
                    });
                } catch (e) {
                    Response.sendErrorResponse(
                        req,
                        res,
                        e instanceof Exception
                            ? e
                            : new ServerException('Server is not ready')
                    );
                }
            }
        );

        return router;
    }
}
