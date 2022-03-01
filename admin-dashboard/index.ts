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

import express from 'express';
import path from 'path';
const app = express();

app.get(['/env.js', '/admin/env.js'], function(req: Request, res: Response) {
    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        REACT_APP_LICENSE_URL: process.env.LICENSE_URL,
        REACT_APP_IS_THIRD_PARTY_BILLING: process.env.IS_THIRD_PARTY_BILLING,
        REACT_APP_VERSION:
            process.env.npm_package_version || process.env.REACT_APP_VERSION,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

app.get(['/admin/status', '/status'], function(req: Request, res: Response) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-admin-dashboard',
        })
    );
});

app.use(express.static(path.join(__dirname, 'build')));
app.use('/admin', express.static(path.join(__dirname, 'build')));
app.use(
    '/admin/static/js',
    express.static(path.join(__dirname, 'build/static/js'))
);

app.get('/*', function(req: Request, res: Response) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(3100);
