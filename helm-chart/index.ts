import 'common-server/utils/env';
import 'common-server/utils/process';
import logger from 'common-server/utils/logger';
import express, {
    Request,
    Response,
    NextFunction,
} from 'common-server/utils/express';
const app = express.getExpressApp();
import path from 'path';
import version from './api/version';

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
    if (req.get('host').includes('cluster.local')) {
        return next();
    }

    return next();
});

// set the server port
app.set('port', process.env['PORT'] || 3423);

// set the view engine to ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//serve files in public directory
app.use(
    ['/chart', '/'],
    express.static(path.join(__dirname, 'public'), { maxAge: 2592000 })
);

//Application version
app.get(['/chart/version', '/version'], version);

app.listen(app.get('port'), function () {
    logger.info('API Reference started on PORT:' + app.get('port'));
});

export default app;
