import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from '../Utils/Express';

const router: ExpressRouter = Express.getRouter();

// General status
router.get('/status', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ status: 'ok' });
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
