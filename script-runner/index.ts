const { NODE_ENV } = process.env;

if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /backend/.env
    require('custom-env').env();
}

process.on('exit', () => {
    // eslint-disable-next-line no-console
    console.log('Script runner Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection in Script runner process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

process.on('uncaughtException', err => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception in Script runner process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'expr... Remove this comment to see the full error message
import express from 'express'
const app = express();
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'createServer'.
import http from 'http').createServer(app
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'cors' or its corresponding typ... Remove this comment to see the full error message
import cors from 'cors'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'body... Remove this comment to see the full error message
import bodyParser from 'body-parser'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'node... Remove this comment to see the full error message
import cron from 'node-cron'
import main from './workers/main'

app.use(cors());

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'req' implicitly has an 'any' type.
app.use(function(req, res, next) {
    if (typeof req.body === 'string') {
        req.body = JSON.parse(req.body);
    }
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header(
        'Access-Control-Allow-Headers',
        'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept,Authorization'
    );

    return next();
});

app.set('port', process.env.PORT || 3009);

app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(bodyParser.json({ limit: '10mb' }));

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'req' implicitly has an 'any' type.
app.get(['/script/status', '/status'], function(req, res) {
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

// @ts-expect-error ts-migrate(2339) FIXME: Property 'listen' does not exist on type 'typeof i... Remove this comment to see the full error message
http.listen(app.get('port'), function() {
    // eslint-disable-next-line
    console.log('Script runner started on port ' + app.get('port'));
});
const cronMinuteStartTime = Math.floor(Math.random() * 50);

// script monitor cron job
cron.schedule('* * * * *', () => {
    setTimeout(() => main.runScriptMonitorsJob(), cronMinuteStartTime * 1000);
});
