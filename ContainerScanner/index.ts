import App from 'CommonServer/utils/StartServer';

import Main from './worker/main';

import cron from 'node-cron';

export const APP_NAME: string = 'container';
const app = App(APP_NAME);


const cronContainerSecurityStartTime: $TSFixMe = Math.floor(Math.random() * 50);

//Run this cron every 5 minute.
cron.schedule('*/5 * * * *', () => {
    setTimeout(() => {
        Main.runContainerScan();
    }, cronContainerSecurityStartTime * 1000);
});

export default app;
