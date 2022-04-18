import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
import PositiveNumber from 'Common/Types/PositiveNumber';

import HTTPTestServerResponse from '../types/HttpTestServerResponse';

const router: ExpressRouter = Express.getRouter();

router.get('/settings', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(200).render('settings.ejs', {
        data: HTTPTestServerResponse.toJSON(),
    });
});

router.post('/api/settings', (req: ExpressRequest, res: ExpressResponse) => {
    const { responseTime, statusCode, responseType, header, body }: $TSFixMe =
        req.body;

    HTTPTestServerResponse.responseTime = new PositiveNumber(responseTime);
    HTTPTestServerResponse.statusCode = new PositiveNumber(statusCode);
    HTTPTestServerResponse.responseType = responseType;
    HTTPTestServerResponse.headers = header;
    HTTPTestServerResponse.jsonBody = body;

    res.redirect('/settings');
});

export default router;
