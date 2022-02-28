/* eslint-disable no-console */
const { NODE_ENV } = process.env;
if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /data-ingestor/.env
    import customEnv from 'custom-env';
    customEnv.env();
}

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

// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'express' or its corresponding ... Remove this comment to see the full error message
import express from 'express';
const app = express();
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'createServer'.
import http from 'http';
http.createServer(app);
import cors from 'cors';
const io = require('socket.io')(http, {
    path: '/realtime/socket.io',
    transports: ['websocket', 'polling'], // using websocket does not require sticky session
    perMessageDeflate: {
        threshold: 1024, // defaults to 1024
        zlibDeflateOptions: {
            chunkSize: 16 * 1024, // defaults to 16 * 1024
        },
        zlibInflateOptions: {
            windowBits: 15, // defaults to 15
            memLevel: 8, // defaults to 8
        },
    },
});
// attach socket to global object
// @ts-expect-error ts-migrate(2339) FIXME: Property 'io' does not exist on type 'Global & typ... Remove this comment to see the full error message
global.io = io;
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'socket' implicitly has an 'any' type.
io.sockets.on('connection', socket => {
    // join a particular project room
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'projectId' implicitly has an 'any' type... Remove this comment to see the full error message
    socket.on('project_switch', projectId => {
        socket.join(projectId);
    });

    // join a particular scheduled event room
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'scheduledEventId' implicitly has an 'an... Remove this comment to see the full error message
    socket.on('schedule_switch', scheduledEventId => {
        socket.join(scheduledEventId);
    });

    // join a particular component room
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'componentId' implicitly has an 'any' ty... Remove this comment to see the full error message
    socket.on('component_switch', componentId => {
        socket.join(componentId);
    });

    // join a particular application log room
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'applicationLogId' implicitly has an 'an... Remove this comment to see the full error message
    socket.on('application_log_switch', applicationLogId => {
        socket.join(applicationLogId);
    });

    // join a particular error tracker room
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'errorTrackerId' implicitly has an 'any'... Remove this comment to see the full error message
    socket.on('error_tracker_switch', errorTrackerId => {
        socket.join(errorTrackerId);
    });

    // join app id
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'appId' implicitly has an 'any' type.
    socket.on('app_id_switch', appId => {
        socket.join(appId);
    });

    // join a particular security room
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'securityId' implicitly has an 'any' typ... Remove this comment to see the full error message
    socket.on('security_switch', securityId => {
        socket.join(securityId);
    });
});

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
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.json({ limit: '50mb' }));

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'req' implicitly has an 'any' type.
app.get(['/realtime/status', '/status'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-realtime',
        })
    );
});

app.use('/realtime', require('./api/realtime'));

app.set('port', process.env.PORT || 3300);

// @ts-expect-error ts-migrate(2339) FIXME: Property 'listen' does not exist on type 'typeof i... Remove this comment to see the full error message
http.listen(app.get('port'), function() {
    // eslint-disable-next-line
    console.log('realtime server started on port ' + app.get('port'));
});

export default app;
