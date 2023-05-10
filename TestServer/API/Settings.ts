import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import { JSONObject } from 'Common/Types/JSON';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/settings',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body;

            const responseType: string | undefined = data['responseType'] as
                | string
                | undefined;
            const responseCode: number | undefined = data['responseCode'] as
                | number
                | undefined;
            const responseTime: number | undefined = data['responseTime'] as
                | number
                | undefined;
            const responseBody: string | undefined = data['responseBody'] as
                | string
                | undefined;

            LocalCache.setString(
                'TestServer',
                'responseType',
                responseType || 'JSON'
            );
            LocalCache.setNumber(
                'TestServer',
                'responseCode',
                responseCode || 200
            );
            LocalCache.setNumber(
                'TestServer',
                'responseTime',
                responseTime || 0
            );
            LocalCache.setString(
                'TestServer',
                'responseBody',
                responseBody || ''
            );

            // middleware marks the probe as alive.
            // so we dont need to do anything here.
            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
