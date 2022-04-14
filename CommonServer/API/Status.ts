import Express, { ExpressRequest, ExpressResponse } from '../Utils/Express';

const router: $TSFixMe = Express.getRouter();

// general status
router.get('/status', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ status: 'ok' });
});

//healthy probe
router.get('/status/healthy', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ status: 'healthy' });
});

//liveness probe
router.get('/status/live', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ status: 'live' });
});

export default router;
