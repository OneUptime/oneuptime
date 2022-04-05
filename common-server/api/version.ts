import Express, { ExpressRequest, ExpressResponse } from '../utils/Express';
import { version } from '../Config';
const router = Express.getRouter();

router.get('/version', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ version: version });
});

export default router;
