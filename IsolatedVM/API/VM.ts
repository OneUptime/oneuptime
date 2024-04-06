import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import ClusterKeyAuthorization from 'CommonServer/Middleware/ClusterKeyAuthorization';
import VMUtil from '../Utils/VM';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ReturnResult from 'Common/Types/IsolatedVM/ReturnResult';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/run-code',
    ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (!req.body.code) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('Code is missing')
                );
            }

            const result: ReturnResult = await VMUtil.runCodeInSandbox({
                code: req.body.code,
                options: {
                    timeout: 5000,
                    args: req.body.args || {},
                },
            });

            return Response.sendJsonObjectResponse(req, res, {
                returnValue: result.returnValue,
                logMessages: result.logMessages,
            });
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
