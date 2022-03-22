import express, {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
    NextFunction,
} from 'common-server/utils/express';
const app = express.getExpressApp();

import 'common-server/utils/env';
import 'common-server/utils/process';

import path from 'path';

import http from 'http';

http.createServer(app);

import bodyParser from 'body-parser';

import cors from 'cors';

app.use(cors());

app.use((req: Request, res: Response, next: NextFunction) => {
    if (typeof req.body === 'string') {
        req.body = JSON.parse(req.body);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header(
        'Access-Control-Allow-Headers',
        'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept,Authorization'
    );
    return next();
});

// Add limit of 10 MB to avoid "Request Entity too large error"
// https://stackoverflow.com/questions/19917401/error-request-entity-too-large
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(bodyParser.json({ limit: '10mb' }));

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(ExpressStatic(path.join(__dirname, 'views')));
app.use('/', ExpressStatic(path.join(__dirname, 'views', 'img')));

// Routes(API)
app.use('/license/validate', require('./src/api/license'));
app.set('port', process.env['PORT'] || 3004);

const server = http.listen(app.get('port'), function () {
    // eslint-disable-next-line
    logger.info('Server Started on port ' + app.get('port'));
});

app.get(['/', '/license'], (req: ExpressRequest, res: ExpressResponse) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-license-server',
        })
    );
});

app.use('/*', (req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).render('notFound.ejs', {});
});

export default app;
module.exports.close = function () {
    server.close();
};
