import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
import PositiveNumber from 'Common/Types/PositiveNumber';
import ResponseType from 'Common/Types/API/ResponseType';
import HTTPTestServerResponse from '../types/HttpTestServerResponse';
import { JSONObject, JSONObjectOrArray } from 'Common/Types/JSON';
import Headers from 'Common/Types/API/Headers';

const router: ExpressRouter = Express.getRouter();

router.get('/settings', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(200).render('settings.ejs', {
        data: HTTPTestServerResponse.toJSON(),
    });
});

router.post('/api/settings', (req: ExpressRequest, res: ExpressResponse) => {
    const { responseTime, statusCode, responseType, header, body }: JSONObject =
        req.body;

    HTTPTestServerResponse.responseTime = new PositiveNumber(
        responseTime as number
    );
    HTTPTestServerResponse.statusCode = new PositiveNumber(
        statusCode as number
    );
    HTTPTestServerResponse.responseType = responseType as ResponseType;
    HTTPTestServerResponse.headers = header as Headers;
    HTTPTestServerResponse.jsonBody = body as JSONObjectOrArray;

    res.redirect('/settings');
});

export default router;
