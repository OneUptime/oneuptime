import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from '../Utils/Express';
import LocalCache from '../Infrastructure/LocalCache';

const router: ExpressRouter = Express.getRouter();

router.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ app: LocalCache.getString('app', 'name') });
});

// General status
router.get('/status', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ status: 'status' });
});

//Healthy probe
router.get('/status/healthy', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ status: 'healthy' });
});

//Liveness probe
router.get('/status/live', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ status: 'live' });
});

export default router;
