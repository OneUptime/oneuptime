import Express, { ExpressRequest, ExpressResponse } from '../Utils/Express';
import { Version } from '../Config';
const router: $TSFixMe = Express.getRouter();

router.get('/version', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ version: Version });
});

export default router;
