import { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';

export const APP_NAME = 'application';
const app: ExpressApplication = App(APP_NAME);

import Main from './worker/main';

import cron from 'node-cron';

const cronApplicationSecurityStartTime: $TSFixMe = Math.floor(
    Math.random() * 50
);

// Run this cron every 5 minute.
cron.schedule('*/5 * * * *', () => {
    setTimeout(() => {
        Main.runApplicationScan();
    }, cronApplicationSecurityStartTime * 1000);
});

export default app;
