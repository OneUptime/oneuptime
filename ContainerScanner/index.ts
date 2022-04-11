import app from 'CommonServer/utils/StartServer';

import Main from './worker/main';

import cron from 'node-cron';

const cronContainerSecurityStartTime = Math.floor(Math.random() * 50);

//Run this cron every 5 minute.
cron.schedule('*/5 * * * *', () => {
    setTimeout(() => {
        Main.runContainerScan();
    }, cronContainerSecurityStartTime * 1000);
});

export default app;
