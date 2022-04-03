import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'common-server/utils/Express';

import app from 'common-server/utils/StartServer';

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

global.io = io;

io.sockets.on('connection', socket => {
    // join a particular project room

    socket.on('project_switch', projectId => {
        socket.join(projectId);
    });

    // join a particular scheduled event room

    socket.on('schedule_switch', scheduledEventId => {
        socket.join(scheduledEventId);
    });

    // join a particular component room

    socket.on('component_switch', componentId => {
        socket.join(componentId);
    });

    // join a particular application log room

    socket.on('application_log_switch', applicationLogId => {
        socket.join(applicationLogId);
    });

    // join a particular error tracker room

    socket.on('error_tracker_switch', errorTrackerId => {
        socket.join(errorTrackerId);
    });

    // join app id

    socket.on('app_id_switch', appId => {
        socket.join(appId);
    });

    // join a particular security room

    socket.on('security_switch', securityId => {
        socket.join(securityId);
    });
});

app.use(cors());

app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
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

app.get(
    ['/realtime/status', '/status'],
    (req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(
            JSON.stringify({
                status: 200,
                message: 'Service Status - OK',
                serviceType: 'oneuptime-realtime',
            })
        );
    }
);

app.use('/realtime', require('./api/realtime'));

export default app;
