import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from '../Utils/Express';
import LocalCache from '../Infrastructure/LocalCache';

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
        router.get('/status', (_req: ExpressRequest, res: ExpressResponse) => {
            res.send({ status: 'ok' });
        });

        //Healthy probe
        router.get(
            '/status/ready',
            async (
                _req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    await options.readyCheck();

                    res.send({ status: 'ready' });
                } catch (e) {
                    next(e);
                }
            }
        );

        //Liveness probe
        router.get(
            '/status/live',
            async (
                _req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    await options.liveCheck();
                    res.send({ status: 'live' });
                } catch (e) {
                    next(e);
                }
            }
        );

        return router;
    }
}
