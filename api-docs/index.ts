import 'common-server/utils/env';
import 'common-server/utils/process';
import logger from 'common-server/utils/logger';
import express, {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    ExpressStatic,
} from 'common-server/utils/express';
const app = express.getExpressApp();
import path from 'path';
import version from './api/version';

import cors from 'cors';

app.use(cors());

process.on('exit', () => {
    logger.info('Server Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    logger.error('Unhandled rejection in server process occurred');

    logger.error(err);
});

process.on('uncaughtException', err => {
    logger.error('Uncaught exception in server process occurred');

    logger.error(err);
});

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
    if (req.get('host').includes('cluster.local')) {
        return next();
    }
    return next();
});

// set the server port
app.set('port', process.env['PORT'] || 1445);

//version
app.get(['/docs/version', '/version'], version);

// set the view engine to ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// public static files
app.use(ExpressStatic(path.join(__dirname, 'public'), { maxAge: 2592000 }));

app.use(
    '/docs',
    ExpressStatic(path.join(__dirname, 'public'), { maxAge: 2592000 })
);

// index page
app.get(['/', '/docs'], (req: ExpressRequest, res: ExpressResponse) => {
    res.render('pages/index');
});

app.listen(app.get('port'), function () {
    logger.info('API Reference started on PORT:' + app.get('port'));
});

export default app;
