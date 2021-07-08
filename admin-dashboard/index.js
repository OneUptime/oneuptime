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

app.use('/', (req, res, next) => {
    //eslint-disable-next-line
    console.log(req.method, ' ', req.originalUrl);
    return next();
});

app.get(['/env.js', '/admin/env.js'], function(req, res) {
    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        REACT_APP_LICENSE_URL: process.env.LICENSE_URL,
        REACT_APP_IS_THIRD_PARTY_BILLING: process.env.IS_THIRD_PARTY_BILLING,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
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
