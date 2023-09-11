import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from '../Utils/Express';
import { AppVersion, GitSha } from '../EnvironmentConfig';
const router: ExpressRouter = Express.getRouter();

router.get('/version', (_req: ExpressRequest, res: ExpressResponse) => {
    res.send({ version: AppVersion, commit: GitSha });
});

export default router;
