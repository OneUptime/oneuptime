const { NODE_ENV } = process.env;
import customEnv from 'custom-env'; 
if (!NODE_ENV || NODE_ENV === 'development') {
    
customEnv.env();
}

import express from 'express'
import logger from 'common-server/utils/logger'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'expr... Remove this comment to see the full error message
import expressRequestId from 'express-request-id')(

// @ts-expect-error ts-migrate(2300) FIXME: Duplicate identifier 'app'.
const app = express();

// @ts-expect-error ts-migrate(2300) FIXME: Duplicate identifier 'app'.
app.use(expressRequestId);

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

import path from 'path'
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'createServer'.
import http from 'http';
http.createServer(app);
const io = require('socket.io')(http, {
    path: '/api/socket.io',
    transports: ['websocket', 'polling'], // using websocket does not require sticky session
    perMessageDeflate: {
        threshold: 1024, // defaults to 1024
        zlibDeflateOptions: {
            chunkSize: 1024, // defaults to 16 * 1024
        },
        zlibInflateOptions: {
            windowBits: 15, // defaults to 15
            memLevel: 8, // defaults to 8
        },
    },
});
// import redisAdapter from 'socket.io-redis'
import bodyParser from 'body-parser'
import cors from 'cors'
// import redis from 'redis'
import mongoose from './backend/config/db'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'gree... Remove this comment to see the full error message
import Gl from 'greenlock'
import ErrorService from 'common-server/utils/error'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./backend/middlewares/user"' has no expor... Remove this comment to see the full error message
import { getUser } from './backend/middlewares/user'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./backend/middlewares/api"' has no export... Remove this comment to see the full error message
import { getProjectId } from './backend/middlewares/api'

// try {
//     io.adapter(
//         redisAdapter({
//             host: process.env.REDIS_HOST,
//             port: process.env.REDIS_PORT,
//         })
//     );

//     const redisClient = redis.createClient({
//         host: process.env.REDIS_HOST,
//         port: process.env.REDIS_PORT,
//     });
//     global.redisClient = redisClient;
// } catch (err) {
//     // eslint-disable-next-line no-console
//     console.log('redis error: ', err);
// }

// @ts-expect-error ts-migrate(2339) FIXME: Property 'io' does not exist on type 'Global & typ... Remove this comment to see the full error message
global.io = io;

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(cors());

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(async function(req, res, next) {
    const method = req.method;
    const url = req.url;
    const requestStartedAt = Date.now();
    req.requestStartedAt = requestStartedAt;

    // log all data to logger
    const logdata = {
        requestId: req.id,
        requestStartedAt: requestStartedAt,
    };

    req = (await getUser(req)) || req;
    req = (await getProjectId(req)) || req;

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type '{ reques... Remove this comment to see the full error message
    logdata.userId = req.user?.id;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type '{ req... Remove this comment to see the full error message
    logdata.projectId = req.projectId;

    req.logdata = logdata;

    logger.info(
        `INCOMING REQUEST ID: ${req.id} -- POD NAME: ${
            process.env.POD_NAME
        } -- RECEIVED AT: ${new Date()} -- METHOD: ${method} -- URL: ${url}`
    );
    logger.info(
        `INCOMING REQUEST ID: ${req.id} -- REQUEST BODY: ${
            req.body ? JSON.stringify(req.body, null, 2) : 'EMPTY'
        }`
    );

    next();
});

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
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
    // Add this to global object, and this can be used anywhere where you need backend host.
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'apiHost' does not exist on type 'Global ... Remove this comment to see the full error message
    global.apiHost = 'https://' + req.hostname + '/api';
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountsHost' does not exist on type 'Gl... Remove this comment to see the full error message
    global.accountsHost = 'https://' + req.hostname + '/accounts';
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'homeHost' does not exist on type 'Global... Remove this comment to see the full error message
    global.homeHost = 'https://' + req.hostname;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
    global.dashboardHost = 'https://' + req.hostname + '/dashboard';
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusHost' does not exist on type 'Glob... Remove this comment to see the full error message
    global.statusHost = global.homeHost;

    if (
        req.hostname.includes('localhost') ||
        req.hostname.includes('127.0.0.1')
    ) {
        if (
            req.get('host').includes('localhost:') ||
            req.get('host').includes('127.0.0.1:')
        ) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'apiHost' does not exist on type 'Global ... Remove this comment to see the full error message
            global.apiHost =
                'http://' +
                req.hostname +
                ':' +
                (process.env.PORT || 3002) +
                '/api';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountsHost' does not exist on type 'Gl... Remove this comment to see the full error message
            global.accountsHost =
                'http://' + req.hostname + ':' + 3003 + '/accounts';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'homeHost' does not exist on type 'Global... Remove this comment to see the full error message
            global.homeHost = 'http://' + req.hostname + ':' + 1444;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
            global.dashboardHost =
                'http://' + req.hostname + ':' + 3000 + '/dashboard';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusHost' does not exist on type 'Glob... Remove this comment to see the full error message
            global.statusHost = 'http://' + req.hostname + ':' + 3006;
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'apiHost' does not exist on type 'Global ... Remove this comment to see the full error message
            global.apiHost = 'http://' + req.hostname + '/api';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountsHost' does not exist on type 'Gl... Remove this comment to see the full error message
            global.accountsHost = 'http://' + req.hostname + '/accounts';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'homeHost' does not exist on type 'Global... Remove this comment to see the full error message
            global.homeHost = 'http://' + req.hostname;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
            global.dashboardHost = 'http://' + req.hostname + '/dashboard';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'statusHost' does not exist on type 'Glob... Remove this comment to see the full error message
            global.statusHost = global.homeHost;
        }
    }

    return next();
});

// Add limit of 10 MB to avoid "Request Entity too large error"
// https://stackoverflow.com/questions/19917401/error-request-entity-too-large
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(bodyParser.json({ limit: '10mb' }));

const { RATE_LIMITTER_ENABLED } = process.env;
if (RATE_LIMITTER_ENABLED === 'true') {
    // import rateLimiter from './backend/middlewares/rateLimit'
    // app.use(rateLimiter);
}
//View engine setup
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.set('views', path.join(__dirname, 'views'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.set('view engine', 'ejs');

// enable trust proxy
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.set('trust proxy', true);

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(express.static(path.join(__dirname, 'views')));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use('/api', express.static(path.join(__dirname, 'views')));

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(require('./backend/middlewares/auditLogs').log);

// Routes(API)
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/incomingHttpRequest', '/api/incomingHttpRequest'],
    require('./backend/api/incomingHttpRequest')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/alert', '/api/alert'], require('./backend/api/alert'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/user', '/api/user'], require('./backend/api/user'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/history', '/api/history'], require('./backend/api/loginHistory'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/token', '/api/token'], require('./backend/api/token'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/team', '/api/team'], require('./backend/api/team'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/project', '/api/project'], require('./backend/api/project'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/invoice', '/api/invoice'], require('./backend/api/invoice'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/schedule', '/api/schedule'], require('./backend/api/schedule'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/monitor', '/api/monitor'], require('./backend/api/monitor'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/status-page', '/api/status-page'],
    require('./backend/api/statusPage')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/file', '/api/file'], require('./backend/api/file'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/incident', '/api/incident'], require('./backend/api/incident'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/incidentPriorities', '/api/incidentPriorities'],
    require('./backend/api/incidentPriorities')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/incidentSettings', '/api/incidentSettings'],
    require('./backend/api/incidentSettings')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/reports', '/api/reports'], require('./backend/api/report'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/lead', '/api/lead'], require('./backend/api/lead'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/feedback', '/api/feedback'], require('./backend/api/feedback'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/twilio', '/api/twilio'], require('./backend/api/twilio'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/sso', '/api/sso'], require('./backend/api/sso'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/ssoDefaultRoles', '/api/ssoDefaultRoles'],
    require('./backend/api/ssoDefaultRoles')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/zapier', '/api/zapier'], require('./backend/api/zapier'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/slack', '/api/slack'], require('./backend/api/slack'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/webhook', '/api/webhook'], require('./backend/api/webHook'));

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/server', '/api/server'], require('./backend/api/server'));

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/notification', '/api/notification'],
    require('./backend/api/notification')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/stripe', '/api/stripe'], require('./backend/api/stripe'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/subscriber', '/api/subscriber'],
    require('./backend/api/subscriber')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/subscriberAlert', '/api/subscriberAlert'],
    require('./backend/api/subscriberAlert')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/emailTemplate', '/api/emailTemplate'],
    require('./backend/api/emailTemplate')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/emailSmtp', '/api/emailSmtp'], require('./backend/api/emailSmtp'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/smsTemplate', '/api/smsTemplate'],
    require('./backend/api/smsTemplate')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/smsSmtp', '/api/smsSmtp'], require('./backend/api/smsSmtp'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/resourceCategory', '/api/resourceCategory'],
    require('./backend/api/resourceCategory')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/statusPageCategory', '/api/statusPageCategory'],
    require('./backend/api/statusPageCategory')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/monitorCriteria', '/api/monitorCriteria'],
    require('./backend/api/monitorCriteria')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/scheduledEvent', '/api/scheduledEvent'],
    require('./backend/api/scheduledEvent')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/probe', '/api/probe'], require('./backend/api/probe'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/application', '/api/application'],
    require('./backend/api/applicationScanner')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/container', '/api/container'],
    require('./backend/api/containerScanner')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/lighthouse', '/api/lighthouse'],
    require('./backend/api/lighthouse')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/version', '/api/version'], require('./backend/api/version'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/tutorial', '/api/tutorial'], require('./backend/api/tutorial'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/audit-logs', '/api/audit-logs'], require('./backend/api/auditLogs'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/email-logs', '/api/email-logs'], require('./backend/api/emailLogs'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/call-logs', '/api/call-logs'], require('./backend/api/callLogs'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/automated-scripts', '/api/automated-scripts'],
    require('./backend/api/automatedScript')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/sms-logs', '/api/sms-logs'], require('./backend/api/smsLogs'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/component', '/api/component'], require('./backend/api/component'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/application-log', '/api/application-log'],
    require('./backend/api/applicationLog')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/globalConfig', '/api/globalConfig'],
    require('./backend/api/globalConfig')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/domainVerificationToken', '/api/domainVerificationToken'],
    require('./backend/api/domainVerificationToken')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/security', '/api/security'],
    require('./backend/api/containerSecurity')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/security', '/api/security'],
    require('./backend/api/applicationSecurity')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/credential', '/api/credential'],
    require('./backend/api/gitCredential')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/credential', '/api/credential'],
    require('./backend/api/dockerCredential')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/securityLog', '/api/securityLog'],
    require('./backend/api/applicationSecurityLog')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/securityLog', '/api/securityLog'],
    require('./backend/api/containerSecurityLog')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/error-tracker', '/api/error-tracker'],
    require('./backend/api/errorTracker')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/incidentSla', '/api/incidentSla'],
    require('./backend/api/incidentCommunicationSla')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/monitorSla', '/api/monitorSla'],
    require('./backend/api/monitorSla')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/incoming-request', '/api/incoming-request'],
    require('./backend/api/incomingRequest')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/script-runner', '/api/script-runner'],
    require('./backend/api/scriptRunner')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/customField', '/api/customField'],
    require('./backend/api/customField')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/search', '/api/search'], require('./backend/api/search'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/monitorCustomField', '/api/monitorCustomField'],
    require('./backend/api/monitorCustomField')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/callRouting', '/api/callRouting'],
    require('./backend/api/callRouting')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/group', '/api/group'], require('./backend/api/groups'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/ssl', '/api/ssl'], require('./backend/api/ssl'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/account', '/api/account'], require('./backend/api/accountStore'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/certificate', '/api/certificate'],
    require('./backend/api/certificateStore')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/manager', '/api/manager'], require('./backend/api/siteManager'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/manager', '/api/manager'], require('./backend/api/defaultManager'));
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/performanceTracker', '/api/performanceTracker'],
    require('./backend/api/performanceTracker')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/performanceMetric', '/api/performanceMetric'],
    require('./backend/api/performanceTrackerMetric')
);
// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(
    ['/incidentNoteTemplate', '/api/incidentNoteTemplate'],
    require('./backend/api/incidentNoteTemplate')
);

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use(['/api'], require('./backend/api/apiStatus'));

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.use('/*', function(req, res) {
    res.status(404).send('Endpoint not found.');
});

//attach cron jobs
require('./backend/workers/main');

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
app.set('port', process.env.PORT || 3002);
// @ts-expect-error ts-migrate(2339) FIXME: Property 'listen' does not exist on type 'typeof i... Remove this comment to see the full error message
const server = http.listen(app.get('port'), function() {
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
    logger.info('Server Started on port ' + app.get('port'));
});

mongoose.connection.on('connected', async () => {
    try {
        if (!process.env.IS_TESTING) {
            const greenlock = Gl.create({
                manager: 'oneuptime-gl-manager',
                packageRoot: process.cwd(),
                maintainerEmail: 'certs@oneuptime.com',
                staging: false,
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'event' implicitly has an 'any' type.
                notify: function(event, details) {
                    if ('error' === event) {
                        // `details` is an error object in this case
                        // eslint-disable-next-line no-console
                        console.error('Greenlock Notify: ', details);
                    }
                },
                challenges: {
                    'http-01': {
                        module: 'oneuptime-acme-http-01',
                    },
                },
                store: {
                    module: 'oneuptime-le-store',
                },
            });
            await greenlock.manager.defaults({
                agreeToTerms: true,
                subscriberEmail: 'certs@oneuptime.com',
            });
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'greenlock' does not exist on type 'Globa... Remove this comment to see the full error message
            global.greenlock = greenlock;
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        ErrorService.log('GREENLOCK INIT ERROR: ', error);
    }
});

// @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'app'.
export default app;
module.exports.close = function() {
    server.close();
};
