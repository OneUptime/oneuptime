import 'common-server/utils/env';
import 'common-server/utils/process';

import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/express';
import path from 'path';
const app = express.getExpressApp();

app.get(
    ['/env.js', '/admin/env.js'],
    (req: ExpressRequest, res: ExpressResponse) => {
        const env = {
            REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
            REACT_APP_LICENSE_URL: process.env.LICENSE_URL,
            REACT_APP_IS_THIRD_PARTY_BILLING:
                process.env.IS_THIRD_PARTY_BILLING,
            REACT_APP_VERSION:
                process.env.npm_package_version ||
                process.env.REACT_APP_VERSION,
        };

        res.contentType('application/javascript');
        res.send('window._env = ' + JSON.stringify(env));
    }
);

app.get(
    ['/admin/status', '/status'],
    (req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(
            JSON.stringify({
                status: 200,
                message: 'Service Status - OK',
                serviceType: 'oneuptime-admin-dashboard',
            })
        );
    }
);

app.use(express.static(path.join(__dirname, 'build')));
app.use('/admin', express.static(path.join(__dirname, 'build')));
app.use(
    '/admin/static/js',
    express.static(path.join(__dirname, 'build/static/js'))
);

app.get('/*', (req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(3100);
