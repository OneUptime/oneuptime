import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from '../Utils/Express';

const router: ExpressRouter = Express.getRouter();


router.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ status: 'identity' });
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
