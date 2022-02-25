/* eslint-disable no-console */
const { NODE_ENV } = process.env;
if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /data-ingestor/.env
    require('custom-env').env();
}

import express from 'express'
const app = express();
import http from 'http').createServer(app
import cors from 'cors'
import { mongoUrl, databaseName } from './utils/config'
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
global.db = client.db(databaseName);

app.use(cors());

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
const getActualRequestDurationInMilliseconds = start => {
    const NS_PER_SEC = 1e9; //  convert to nanoseconds
    const NS_TO_MS = 1e6; // convert to milliseconds
    const diff = process.hrtime(start);
    return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
};
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

app.get(['/data-ingestor/status', '/status'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-data-ingestor',
        })
    );
});

app.use(['/probe', '/api/probe'], require('./api/probe'));

app.set('port', process.env.PORT || 3200);

http.listen(app.get('port'), function() {
    // eslint-disable-next-line
    console.log('data-ingestor server started on port ' + app.get('port'));
});

export default app;
