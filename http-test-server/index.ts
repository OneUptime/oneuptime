import {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
    NextFunction,
} from 'common-server/utils/express';

import app from 'common-server/utils/start-server';

import path from 'path';

import http from 'http';

const { NODE_ENV } = process.env;

if (NODE_ENV === 'local' || NODE_ENV === 'development')
    require('custom-env').env(process.env['NODE_ENV']);

global.httpServerResponse = {
    statusCode: 200,
    responseType: { values: ['json', 'html'], currentType: 'json' },
    responseTime: 0,
    header: {},
    body: { status: 'ok' },
};

app.use(
    '*',
    function (_req: ExpressRequest, res: ExpressResponse, next: NextFunction) {
        if (process.env && process.env['NODE_ENV'] === 'production') {
            res.set('Cache-Control', 'public, max-age=86400');
        } else res.set('Cache-Control', 'no-cache');
        return next();
    }
);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(ExpressStatic('public'));

app.use(require('./api/settings'));
app.use(require('./api/webhooks'));

app.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
    if (http.STATUS_CODES[global.httpServerResponse.statusCode]) {
        res.status(global.httpServerResponse.statusCode);
    } else {
        res.status(422);
    }
    setTimeout(function () {
        if (global.httpServerResponse.responseType.currentType === 'html') {
            res.setHeader('Content-Type', 'text/html');
            try {
                const header = JSON.parse(global.httpServerResponse.header);
                if (typeof header === 'object') {
                    for (const key in header) {
                        res.setHeader(String(key), String(header[key]));
                    }
                }
            } catch (e) {
                //
            }

            return res.send(global.httpServerResponse.body);
        } else {
            res.setHeader('Content-Type', 'application/json');

            return res.send(global.httpServerResponse.body);
        }
    }, global.httpServerResponse.responseTime);
});

app.use('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).render('notFound.ejs', {});
});
