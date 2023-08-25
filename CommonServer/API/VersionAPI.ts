import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from '../Utils/Express';
import { AppVersion, GitSha } from '../Config';
const router: ExpressRouter = Express.getRouter();

router.get('/version', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ version: AppVersion, gitSha: GitSha });
});

export default router;
