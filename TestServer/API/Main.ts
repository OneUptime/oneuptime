import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import Sleep from 'Common/Types/Sleep';
import Typeof from 'Common/Types/Typeof';
import { JSONValue } from 'Common/Types/JSON';
import logger from 'CommonServer/Utils/Logger';

const router: ExpressRouter = Express.getRouter();

router.get(
    '/',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {

            logger.info('Request Headers: ');
            logger.info(req.headers);
            logger.info('Request Body: ');
            logger.info(req.body);

            const responseCode: number | undefined =
                LocalCache.getNumber('TestServer', 'responseCode') || 200;
            const responseTime: number | undefined =
                LocalCache.getNumber('TestServer', 'responseTime') || 0;
            const responseBody: string | undefined =
                LocalCache.getString('TestServer', 'responseBody') || '';
            let responseHeaders: JSONValue | undefined =
                LocalCache.getJSON('TestServer', 'responseHeaders') || {};

            logger.info('Response Code: ' + responseCode);
            logger.info('Response Time: ' + responseTime);
            logger.info('Response Body: ');
            logger.info(responseBody);
            logger.info('Response Headers: ');
            logger.info(responseHeaders);

            if (responseHeaders && typeof responseHeaders === Typeof.String) {
                responseHeaders = JSON.parse(responseHeaders.toString());
            }

            if (responseTime > 0) {
                await Sleep.sleep(responseTime);
            }

            // middleware marks the probe as alive.
            // so we don't need to do anything here.
            return Response.sendCustomResponse(
                req,
                res,
                responseCode,
                responseBody,
                responseHeaders ? (responseHeaders as any) : {}
            );
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
