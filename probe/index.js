// if new relic license key exists. Then load the key.
if (process.env.NEW_RELIC_LICENSE_KEY) {
    require('newrelic');
}

const { NODE_ENV } = process.env;

if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /backend/.env
    require('custom-env').env();
}

process.on('exit', () => {
    // eslint-disable-next-line no-console
    console.log('Probe Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection in probe process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

process.on('uncaughtException', err => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception in probe process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

const express = require('express');
const Sentry = require('@sentry/node');
const app = express();
const http = require('http').createServer(app);
const cors = require('cors');
const Main = require('./workers/main');
const config = require('./utils/config');

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: `probe@${process.env.npm_package_version}`,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.0,
    integrations: [
        new Sentry.Integrations.OnUncaughtException({
            onFatalError() {
                // override default behaviour
                return;
            },
        }),
    ],
});

// Sentry: The request handler must be the first middleware on the app
app.use(Sentry.Handlers.requestHandler());

const cronMinuteStartTime = Math.floor(Math.random() * 50);

app.use(cors());
app.set('port', process.env.PORT || 3008);

const monitorStore = {};

// handle probe1 status
app.get(['/probe1/status', '/status'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-probe',
        })
    );
});

// handle probe2 status
app.get(['/probe2/status', '/status'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-probe',
        })
    );
});

app.get(['/probe1/monitorCount', '/monitorCount'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            monitorCount: Object.keys(monitorStore).length,
            monitors: monitorStore,
        })
    );
});

app.get(['/probe2/monitorCount', '/monitorCount'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            monitorCount: Object.keys(monitorStore).length,
            monitors: monitorStore,
        })
    );
});

//App Version
app.get(['/probe/version', '/version'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send({ probeVersion: process.env.npm_package_version });
});

app.use(Sentry.Handlers.errorHandler());
global.Sentry = Sentry;

setTimeout(async () => {
    // keep monitoring in an infinate loop.

    //eslint-disable-next-line
    while (true) {
        await Main.runJob(monitorStore);
    }
}, cronMinuteStartTime * 1000);

http.listen(app.get('port'), function() {
    // eslint-disable-next-line
    console.log(
        `Probe with Probe Name ${config.probeName} and Probe Key ${
            config.probeKey
        } Started on port ${app.get('port')}. OneUptime API URL: ${
            config.serverUrl
        }`
    );
});

module.exports = app;
