import Express, { ExpressRequest, ExpressResponse } from '../utils/express';

const router = Express.getRouter();

router.get('/version', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ version: process.env['npm_package_version'] });
});

export default router;
