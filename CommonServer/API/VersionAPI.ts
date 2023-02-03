import type {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from '../Utils/Express';
import Express from '../Utils/Express';
import { Version } from '../Config';
const router: ExpressRouter = Express.getRouter();

router.get('/version', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ version: Version });
});

export default router;
