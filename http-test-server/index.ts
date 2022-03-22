import logger from 'common-server/utils/logger';

import 'common-server/utils/env';
import 'common-server/utils/process';

import express, {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
    NextFunction,
} from 'common-server/utils/express';
const app = express.getExpressApp();
import path from 'path';

import bodyParser from 'body-parser';
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

app.use('*', function (req: Request, res: Response, next: NextFunction) {
    if (process.env && process.env.PRODUCTION) {
        res.set('Cache-Control', 'public, max-age=86400');
    } else res.set('Cache-Control', 'no-cache');
    return next();
});

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(ExpressStatic('public'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(require('./backend/api/settings'));

app.get('/status', (req: ExpressRequest, res: ExpressResponse) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-http-test-server',
        })
    );
});

app.get('/', (req: ExpressRequest, res: ExpressResponse) => {
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

const hook = {};

app.post('/api/webhooks/:id', (req: ExpressRequest, res: ExpressResponse) => {
    const { id } = req.params;

    hook[id] = req.body;
    return res.status(200).json(req.body);
});

app.get('/api/webhooks/:id', (req: ExpressRequest, res: ExpressResponse) => {
    const { id } = req.params;

    if (hook[id] === undefined) return res.status(404).json({});

    return res.status(200).json(hook[id]);
});

app.use('/*', (req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).render('notFound.ejs', {});
});

app.set('port', process.env['PORT'] || 3010);

app.listen(app.get('port'), function () {
    logger.info('Server running on port : ' + app.get('port'));
});
