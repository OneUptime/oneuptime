import { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';

import Main from './worker/main';

import cron from 'node-cron';

export const APP_NAME = 'container';
const app: ExpressApplication = App(APP_NAME);

const cronContainerSecurityStartTime: $TSFixMe = Math.floor(Math.random() * 50);

//Run this cron every 5 minute.
cron.schedule('*/5 * * * *', () => {
    setTimeout(() => {
        Main.runContainerScan();
    }, cronContainerSecurityStartTime * 1000);
});

export default app;
