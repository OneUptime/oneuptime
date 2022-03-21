import 'common-server/utils/env';
import 'common-server/utils/process';

import express, {
    Request,
    Response,
    NextFunction,
} from 'common-server/utils/express';
const app = express.getExpressApp();

import http from 'http';
http.createServer(app);

import cors from 'cors';

import bodyParser from 'body-parser';

import cron from 'node-cron';
import main from './workers/main';

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

app.set('port', process.env['PORT'] || 3009);

app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(bodyParser.json({ limit: '10mb' }));

app.get(['/script/status', '/status'], (req: ExpressRequest, res: ExpressResponse) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-script-runner',
        })
    );
});

app.use('/script', require('./api/script'));

http.listen(app.get('port'), function () {
    // eslint-disable-next-line
    logger.info('Script runner started on port ' + app.get('port'));
});
const cronMinuteStartTime = Math.floor(Math.random() * 50);

// script monitor cron job
cron.schedule('* * * * *', () => {
    setTimeout(() => main.runScriptMonitorsJob(), cronMinuteStartTime * 1000);
});
