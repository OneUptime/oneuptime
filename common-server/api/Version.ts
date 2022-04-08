import Express, { ExpressRequest, ExpressResponse } from '../utils/Express';
import { Version } from '../Config';
const router = Express.getRouter();

router.get('/version', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ version: Version });
});

export default router;
