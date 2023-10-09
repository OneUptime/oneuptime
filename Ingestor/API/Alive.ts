import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import ProbeAuthorization from '../Middleware/ProbeAuthorization';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/alive',
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            // middleware marks the probe as alive.
            // so we don't need to do anything here.
            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
