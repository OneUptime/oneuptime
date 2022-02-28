/* eslint-disable no-console */
const { NODE_ENV } = process.env;

if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /data-ingestor/.env
    import customEnv from 'custom-env';
    customEnv.env();
}

// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'express' or its corresponding ... Remove this comment to see the full error message
import express from 'express';
const app = express();
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'createServer'.
import http from 'http';
http.createServer(app);
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'cors' or its corresponding typ... Remove this comment to see the full error message
import cors from 'cors';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/config"' has no exported member '... Remove this comment to see the full error message
import { mongoUrl } from './utils/config';

const MongoClient = require('mongodb').MongoClient;

process.on('exit', () => {
    console.log('Server Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    console.error('Unhandled rejection in server process occurred');
    console.error(err);
});

process.on('uncaughtException', err => {
    console.error('Uncaught exception in server process occurred');
    console.error(err);
});

// mongodb
function getMongoClient() {
    return new MongoClient(mongoUrl, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
}
// setup mongodb connection
const client = getMongoClient();
(async function() {
    try {
        console.log('connecting to db');
        await client.connect();
        console.log('connected to db');
    } catch (error) {
        console.log('connection error: ', error);
    }
})();

// attach the database to global object
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
global.db = client.db(process.env.DB_NAME);

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

// Add limit of 10 MB to avoid "Request Entity too large error"
// https://stackoverflow.com/questions/19917401/error-request-entity-too-large
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.json({ limit: '10mb' }));

// log request middleware
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'start' implicitly has an 'any' type.
const getActualRequestDurationInMilliseconds = start => {
    const NS_PER_SEC = 1e9; //  convert to nanoseconds
    const NS_TO_MS = 1e6; // convert to milliseconds
    const diff = process.hrtime(start);
    return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
};
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'req' implicitly has an 'any' type.
app.use(function(req, res, next) {
    const current_datetime = new Date();
    const formatted_date =
        current_datetime.getFullYear() +
        '-' +
        (current_datetime.getMonth() + 1) +
        '-' +
        current_datetime.getDate() +
        ' ' +
        current_datetime.getHours() +
        ':' +
        current_datetime.getMinutes() +
        ':' +
        current_datetime.getSeconds();
    const method = req.method;
    const url = req.url;
    const status = res.statusCode;
    const start = process.hrtime();
    const durationInMilliseconds = getActualRequestDurationInMilliseconds(
        start
    );
    const log = `[${formatted_date}] ${method}:${url} ${status} ${durationInMilliseconds.toLocaleString()} ms`;
    console.log(log);
    return next();
});

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'req' implicitly has an 'any' type.
app.get(['/probe-api/status', '/status'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-probe-api',
        })
    );
});

app.use(['/probe', '/api/probe'], require('./api/probe'));

app.set('port', process.env.PORT || 3400);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'listen' does not exist on type 'typeof i... Remove this comment to see the full error message
http.listen(app.get('port'), function() {
    // eslint-disable-next-line
    console.log('probe-api server started on port ' + app.get('port'));
});

export default app;
