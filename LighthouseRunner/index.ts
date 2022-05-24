import App from 'CommonServer/utils/StartServer';

import http from 'http';
http.createServer(app);

import Main from './workers/main';

import cron from 'node-cron';

export const APP_NAME: string = 'licensing';
const app = App(APP_NAME);


const cronMinuteStartTime: $TSFixMe = Math.floor(Math.random() * 50);
//App Version

// This cron runs every 30 minutes.
cron.schedule('*/30 * * * *', () => {
    setTimeout(() => {
        Main.runJob();
    }, cronMinuteStartTime * 1000);
});

export default app;
