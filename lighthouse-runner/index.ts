const { NODE_ENV } = process.env;

if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /backend/.env
    import customEnv from 'custom-env';
    customEnv.env();
}

process.on('exit', () => {
    // eslint-disable-next-line no-console
    console.log('Lighthouse Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection in Lighthouse process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

process.on('uncaughtException', err => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception in Lighthouse process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});


import express from 'express';
const app = express();

import http from 'http';
http.createServer(app);

import cors from 'cors';
import Main from './workers/main';

import cron from 'node-cron';
import config from './utils/config';

const cronMinuteStartTime = Math.floor(Math.random() * 50);

app.use(cors());
app.set('port', process.env.PORT || 3015);


app.get(['/lighthouse/status', '/status'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-lighthouse',
        })
    );
});

//App Version

app.get(['/lighthouse/version', '/version'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send({ lighthouseVersion: process.env.npm_package_version });
});

// This cron runs every 30 minutes.
cron.schedule('*/30 * * * *', () => {
    setTimeout(() => {
        Main.runJob();
    }, cronMinuteStartTime * 1000);
});


http.listen(app.get('port'), function() {
    // eslint-disable-next-line
    console.log(
        `Lighthouse Started on port ${app.get('port')}. OneUptime API URL: ${
            config.serverUrl
        }`
    );
});

export default app;
