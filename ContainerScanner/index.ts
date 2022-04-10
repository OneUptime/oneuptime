import { ExpressRequest, ExpressResponse } from 'Common-server/Utils/Express';

import app from 'Common-server/utils/StartServer';

import http from 'http';
http.createServer(app);

import cors from 'cors';
import Main from './worker/main';

import cron from 'node-cron';
import config from './utils/config';

const cronContainerSecurityStartTime = Math.floor(Math.random() * 50);

app.use(cors());
app.set('port', process.env['PORT'] || 3055);

app.get(
    ['/container/status', '/status'],
    (req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(
            JSON.stringify({
                status: 200,
                message: 'Service Status - OK',
                serviceType: 'oneuptime-container-scanner',
            })
        );
    }
);

//App Version

app.get(
    ['/container/version', '/version'],
    (req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send({
            containerScannerVersion: process.env['npm_package_version'],
        });
    }
);

//Run this cron every 5 minute.
cron.schedule('*/5 * * * *', () => {
    setTimeout(() => {
        Main.runContainerScan();
    }, cronContainerSecurityStartTime * 1000);
});

http.listen(app.get('port'), function () {
    // eslint-disable-next-line
    logger.info(
        `Container Scanner Started on port ${app.get(
            'port'
        )}. OneUptime API URL: ${config.serverUrl}`
    );
});

export default app;
