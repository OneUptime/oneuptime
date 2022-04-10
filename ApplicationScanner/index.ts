import { ExpressRequest, ExpressResponse } from 'Common-server/Utils/Express';

import app from 'Common-server/utils/StartServer';

import Main from './worker/main';

import cron from 'node-cron';

const cronApplicationSecurityStartTime = Math.floor(Math.random() * 50);

app.get(
    ['/application/status', '/status'],
    (req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(
            JSON.stringify({
                status: 200,
                message: 'Service Status - OK',
                serviceType: 'oneuptime-application-scanner',
            })
        );
    }
);

//App Version

app.get(
    ['/application/version', '/version'],
    (req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send({
            applicationScannerVersion: process.env['npm_package_version'],
        });
    }
);

// Run this cron every 5 minute.
cron.schedule('*/5 * * * *', () => {
    setTimeout(() => {
        Main.runApplicationScan();
    }, cronApplicationSecurityStartTime * 1000);
});

export default app;
