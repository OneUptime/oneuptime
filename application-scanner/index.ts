const { NODE_ENV } = process.env;

if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /backend/.env
    import customEnv from 'custom-env';
    customEnv.env();
}

process.on('exit', () => {
    // eslint-disable-next-line no-console
    console.log('Application Scanner Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    // eslint-disable-next-line no-console
    console.error(
        'Unhandled rejection in application scanner process occurred'
    );
    // eslint-disable-next-line no-console
    console.error(err);
});

process.on('uncaughtException', err => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception in application scanner process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});


import express from 'express';
const app = express();

import http from 'http';
http.createServer(app);

import cors from 'cors';
import Main from './worker/main';

import cron from 'node-cron';
import config from './utils/config';

const cronApplicationSecurityStartTime = Math.floor(Math.random() * 50);

app.use(cors());
app.set('port', process.env.PORT || 3005);


app.get(['/application/status', '/status'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-application-scanner',
        })
    );
});

//App Version

app.get(['/application/version', '/version'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send({ applicationScannerVersion: process.env.npm_package_version });
});

// Run this cron every 5 minute.
cron.schedule('*/5 * * * *', () => {
    setTimeout(() => {
        Main.runApplicationScan();
    }, cronApplicationSecurityStartTime * 1000);
});


http.listen(app.get('port'), function() {
    // eslint-disable-next-line
    console.log(
        `Application Scanner Started on port ${app.get(
            'port'
        )}. OneUptime API URL: ${config.serverUrl}`
    );
});

export default app;
