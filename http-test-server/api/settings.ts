import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
import PositiveNumber from 'common/types/PositiveNumber';

import HTTPTestServerResponse from '../types/HttpTestServerResponse';

const router = express.getRouter();

router.get('/settings', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(200).render('settings.ejs', {
        data: HTTPTestServerResponse.toJSON(),
    });
});

router.post('/api/settings', (req: ExpressRequest, res: ExpressResponse) => {
    const { responseTime, statusCode, responseType, header, body } = req.body;

    HTTPTestServerResponse.responseTime = new PositiveNumber(responseTime);
    HTTPTestServerResponse.statusCode = new PositiveNumber(statusCode);
    HTTPTestServerResponse.responseType = responseType;
    HTTPTestServerResponse.headers = header;
    HTTPTestServerResponse.jsonBody = body;

    res.redirect('/settings');
});

export default router;
