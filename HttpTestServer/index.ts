import {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'CommonServer/utils/Express';

import App from 'CommonServer/utils/StartServer';

import path from 'path';

import HTTPTestServerResponse from './types/HttpTestServerResponse';
import ResponseType from 'Common/Types/api/ResponseType';
import Headers from 'Common/Types/API/Headers';


export const APP_NAME: string = 'home';
const app = App(APP_NAME);


app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(ExpressStatic('public'));

app.use(require('./api/settings'));
app.use(require('./api/webhooks'));

app.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(HTTPTestServerResponse.statusCode.toNumber());
    const header: Headers = HTTPTestServerResponse.headers;

    for (const key in header) {
        res.setHeader(key, header[key] as string);
    }

    setTimeout((): void => {
        if (HTTPTestServerResponse.responseType === ResponseType.HTML) {
            res.setHeader('Content-Type', 'text/html');
            res.send(HTTPTestServerResponse.htmlBody);
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.send(HTTPTestServerResponse.jsonBody);
        }
    }, HTTPTestServerResponse.responseTime.toNumber());
});

app.use('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).render('notFound.ejs', {});
});
