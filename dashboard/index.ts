import {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'common-server/utils/express';

import app from 'common-server/utils/start-server';

import path from 'path';

app.get(
    ['/env.js', '/dashboard/env.js'],
    (req: ExpressRequest, res: ExpressResponse) => {
        const isClustLocal = req.get('host').includes('cluster.local');
        if (!isClustLocal) {
            global.dashboardHost = 'https://' + req.host + '/dashboard';

            global.homeHost = 'https://' + req.host;

            global.accountsHost = 'https://' + req.host + '/accounts';

            global.backendHost = 'https://' + req.host + '/api';

            global.realtimeHost = 'https://' + req.host + '/realtime';
        }
        if (req.host.includes('localhost')) {
            if (req.get('host').includes('localhost:')) {
                global.dashboardHost =
                    'http://' + req.host + ':' + (process.env['PORT'] || 3002);

                global.accountsHost = 'http://' + req.host + ':' + 3003;

                global.homeHost = 'http://' + req.host + ':' + 1444;

                global.backendHost = 'http://' + req.host + ':' + 3002;

                global.realtimeHost = 'http://' + req.host + ':' + 3300;
            } else if (!isClustLocal) {
                global.dashboardHost = 'http://' + req.host + '/dashboard';

                global.accountsHost = 'http://' + req.host + '/accounts';

                global.homeHost = 'http://' + req.host;

                global.backendHost = 'http://' + req.host + '/api';

                global.realtimeHost = 'http://' + req.host + '/realtime';
            }
        }

        const env = {
            REACT_APP_IS_SAAS_SERVICE: process.env['IS_SAAS_SERVICE'],
            ...(!isClustLocal && {
                REACT_APP_HOST: global.dashboardHost,

                REACT_APP_ACCOUNTS_HOST: global.accountsHost,

                REACT_APP_BACKEND_HOST: global.backendHost,
            }),
            REACT_APP_DOMAIN: req.host,
            REACT_APP_STRIPE_PUBLIC_KEY: process.env['STRIPE_PUBLIC_KEY'],
            REACT_APP_PUSHNOTIFICATION_PUBLIC_KEY:
                process.env.PUSHNOTIFICATION_PUBLIC_KEY,
            REACT_APP_AMPLITUDE_PUBLIC_KEY: process.env['AMPLITUDE_PUBLIC_KEY'],
            REACT_APP_VERSION: process.env['REACT_APP_VERSION'],
            REACT_APP_STATUSPAGE_DOMAIN: process.env.STATUSPAGE_DOMAIN,
        };

        res.contentType('application/javascript');
        res.send('window._env = ' + JSON.stringify(env));
    }
);

//APP VERSION
app.use(
    ['/dashboard/api/version', '/dashboard/version'],
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.json({ dashboardVersion: process.env['npm_package_version'] });
    }
);

app.get(
    ['/dashboard/status', '/status'],
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(
            JSON.stringify({
                status: 200,
                message: 'Service Status - OK',
                serviceType: 'oneuptime-dashboard',
            })
        );
    }
);

app.use(ExpressStatic(path.join(__dirname, 'build')));

app.use(
    '/dashboard/static/js',
    ExpressStatic(path.join(__dirname, 'build', 'static', 'js'))
);

app.use('/dashboard', ExpressStatic(path.join(__dirname, 'build')));
// app.use(
//     /^\/dashboard\/static\/js\/([0-9]|[1-9][0-9]|[1-9][0-9][0-9])\.(.+)\.chunk\.js$/,
//     function(req:Request, res: Response, next: NextFunction) {
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

app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});
