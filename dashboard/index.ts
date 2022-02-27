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

// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'expr... Remove this comment to see the full error message
import express from 'express';
import path from 'path';
const app = express();
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'cors... Remove this comment to see the full error message
import cors from 'cors';

app.use(cors());

app.use(function(req: $TSFixMe, res: $TSFixMe, next: $TSFixMe) {
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

app.get(['/env.js', '/dashboard/env.js'], function(
    req: $TSFixMe,
    res: $TSFixMe
) {
    const isClustLocal = req.get('host').includes('cluster.local');
    if (!isClustLocal) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
        global.dashboardHost = 'https://' + req.host + '/dashboard';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'homeHost' does not exist on type 'Global... Remove this comment to see the full error message
        global.homeHost = 'https://' + req.host;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountsHost' does not exist on type 'Gl... Remove this comment to see the full error message
        global.accountsHost = 'https://' + req.host + '/accounts';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'backendHost' does not exist on type 'Glo... Remove this comment to see the full error message
        global.backendHost = 'https://' + req.host + '/api';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'realtimeHost' does not exist on type 'Gl... Remove this comment to see the full error message
        global.realtimeHost = 'https://' + req.host + '/realtime';
    }
    if (req.host.includes('localhost')) {
        if (req.get('host').includes('localhost:')) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
            global.dashboardHost =
                'http://' + req.host + ':' + (process.env.PORT || 3002);
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountsHost' does not exist on type 'Gl... Remove this comment to see the full error message
            global.accountsHost = 'http://' + req.host + ':' + 3003;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'homeHost' does not exist on type 'Global... Remove this comment to see the full error message
            global.homeHost = 'http://' + req.host + ':' + 1444;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'backendHost' does not exist on type 'Glo... Remove this comment to see the full error message
            global.backendHost = 'http://' + req.host + ':' + 3002;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'realtimeHost' does not exist on type 'Gl... Remove this comment to see the full error message
            global.realtimeHost = 'http://' + req.host + ':' + 3300;
        } else if (!isClustLocal) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
            global.dashboardHost = 'http://' + req.host + '/dashboard';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountsHost' does not exist on type 'Gl... Remove this comment to see the full error message
            global.accountsHost = 'http://' + req.host + '/accounts';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'homeHost' does not exist on type 'Global... Remove this comment to see the full error message
            global.homeHost = 'http://' + req.host;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'backendHost' does not exist on type 'Glo... Remove this comment to see the full error message
            global.backendHost = 'http://' + req.host + '/api';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'realtimeHost' does not exist on type 'Gl... Remove this comment to see the full error message
            global.realtimeHost = 'http://' + req.host + '/realtime';
        }
    }

    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        ...(!isClustLocal && {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
            REACT_APP_HOST: global.dashboardHost,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountsHost' does not exist on type 'Gl... Remove this comment to see the full error message
            REACT_APP_ACCOUNTS_HOST: global.accountsHost,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'backendHost' does not exist on type 'Glo... Remove this comment to see the full error message
            REACT_APP_BACKEND_HOST: global.backendHost,
        }),
        REACT_APP_DOMAIN: req.host,
        REACT_APP_STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
        REACT_APP_PUSHNOTIFICATION_PUBLIC_KEY:
            process.env.PUSHNOTIFICATION_PUBLIC_KEY,
        REACT_APP_AMPLITUDE_PUBLIC_KEY: process.env.AMPLITUDE_PUBLIC_KEY,
        REACT_APP_VERSION: process.env.REACT_APP_VERSION,
        REACT_APP_STATUSPAGE_DOMAIN: process.env.STATUSPAGE_DOMAIN,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

//APP VERSION
app.use(['/dashboard/api/version', '/dashboard/version'], function(
    req: $TSFixMe,
    res: $TSFixMe
) {
    res.setHeader('Content-Type', 'application/json');
    res.json({ dashboardVersion: process.env.npm_package_version });
});

app.get(['/dashboard/status', '/status'], function(
    req: $TSFixMe,
    res: $TSFixMe
) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-dashboard',
        })
    );
});

app.use(express.static(path.join(__dirname, 'build')));

app.use(
    '/dashboard/static/js',
    express.static(path.join(__dirname, 'build', 'static', 'js'))
);

app.use('/dashboard', express.static(path.join(__dirname, 'build')));
// app.use(
//     /^\/dashboard\/static\/js\/([0-9]|[1-9][0-9]|[1-9][0-9][0-9])\.(.+)\.chunk\.js$/,
//     function(req, res, next) {
//         let baseUrls = req.baseUrl;
//         baseUrls = baseUrls.split('/');

//         const fileName = baseUrls[baseUrls.length - 1];
//         if (fileName) {
//             res.sendFile(
//                 path.join(__dirname, 'build', 'static', 'js', fileName)
//             );
//         } else {
//             return next();
//         }
//     }
// );
// app.use(/^\/dashboard\/static\/js\/main\.(.+)\.chunk\.js$/, function(
//     req,
//     res,
//     next
// ) {
//     let baseUrls = req.baseUrl;
//     baseUrls = baseUrls.split('/');

//     const fileName = baseUrls[baseUrls.length - 1];
//     if (fileName) {
//         res.sendFile(path.join(__dirname, 'build', 'static', 'js', fileName));
//     } else {
//         return next();
//     }
// });

app.get('/*', function(req: $TSFixMe, res: $TSFixMe) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = 3000;
// eslint-disable-next-line no-console
console.log(`This project is running on port ${PORT}`);
app.listen(PORT);
