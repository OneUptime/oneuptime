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
const path = require('path');
const app = express();

app.use(async function(req, res, next) {
    const host = req.hostname;

    try {
        if (host && host === 'oneuptime.com') {
            res.writeHead(301, {
                Location: `https://oneuptime.com${req.url}`,
            });
            return res.end();
        }
        if (host && host === 'staging.oneuptime.com') {
            res.writeHead(301, {
                Location: `https://staging.oneuptime.com${req.url}`,
            });
            return res.end();
        }

        return next();
    } catch (error) {
        // eslint-disable-next-line no-console
        console.log('Admin Dashboard: Error with fetch', error);
        return next();
    }
});

app.get(['/env.js', '/admin/env.js'], function(req, res) {
    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        REACT_APP_LICENSE_URL: process.env.LICENSE_URL,
        REACT_APP_IS_THIRD_PARTY_BILLING: process.env.IS_THIRD_PARTY_BILLING,
        REACT_APP_SENTRY_DSN:
            process.env.SENTRY_DSN || process.env.REACT_APP_SENTRY_DSN,
        REACT_APP_VERSION:
            process.env.npm_package_version || process.env.REACT_APP_VERSION,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

app.get(['/admin/status', '/status'], function(req, res) {
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

app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(3100);
