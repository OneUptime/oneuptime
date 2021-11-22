process.on('exit', () => {
    // eslint-disable-next-line no-console
    console.log('Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection in process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

process.on('uncaughtException', err => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception in process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

const express = require('express');
const Sentry = require('@sentry/node');
const Tracing = require('@sentry/tracing');
const app = express();
const path = require('path');
const version = require('./api/version');
const cors = require('cors');

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
        // enable HTTP calls tracing
        new Sentry.Integrations.Http({ tracing: true }),
        // enable Express.js middleware tracing
        new Tracing.Integrations.Express({
            app,
        }),
        new Sentry.Integrations.OnUncaughtException({
            onFatalError() {
                // override default behaviour
                return;
            },
        }),
    ],
    environment: process.env.NODE_ENV,
    release: `oneuptime-api-docs@${process.env.npm_package_version}`,
    tracesSampleRate: 0.0,
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

app.use(cors());

process.on('exit', () => {
    // eslint-disable-next-line no-console
    console.log('Server Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection in server process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

process.on('uncaughtException', err => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception in server process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

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
    if (req.get('host').includes('cluster.local')) {
        return next();
    }
    return next();
});

// set the server port
app.set('port', process.env.PORT || 1445);

//version
app.get(['/docs/version', '/version'], version);

// set the view engine to ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// public static files
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 2592000 }));

app.use(
    '/docs',
    express.static(path.join(__dirname, 'public'), { maxAge: 2592000 })
);

// index page
app.get(['/', '/docs'], function(req, res) {
    res.render('pages/index');
});

app.use(Sentry.Handlers.errorHandler());

app.listen(app.get('port'), function() {
    // eslint-disable-next-line no-console
    console.log('API Reference started on PORT:' + app.get('port'));
});

module.exports = app;
