/* eslint-disable no-console */
const UrlService = require('../utils/urlService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch');
const sslCert = require('get-ssl-certificate');
const { fork } = require('child_process');
const moment = require('moment');
const https = require('https');
const http = require('http');
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});
const httpAgent = new http.Agent();

// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up

module.exports = {
    ping: async monitor => {
        try {
            if (monitor && monitor.type) {
                if (monitor.data.url) {

                    const now = new Date().getTime();
                    const scanIntervalInDays = monitor.lighthouseScannedAt
                        ? moment(now).diff(
                              moment(monitor.lighthouseScannedAt),
                              'days'
                          )
                        : -1;
                    if (
                        (monitor.lighthouseScanStatus &&
                            monitor.lighthouseScanStatus === 'scan') ||
                        (monitor.lighthouseScanStatus &&
                            monitor.lighthouseScanStatus === 'failed') ||
                        ((!monitor.lighthouseScannedAt ||
                            scanIntervalInDays > 0) &&
                            (!monitor.lighthouseScanStatus ||
                                monitor.lighthouseScanStatus !== 'scanning'))
                    ) {
                        await UrlService.ping(monitor._id, {
                            monitor,
                            resp: { lighthouseScanStatus: 'scanning' },
                        });

                        const sites = monitor.siteUrls;
                        let failedCount = 0;
                        for (const url of sites) {
                            try {
                                const resp = await lighthouseFetch(
                                    monitor,
                                    url
                                );
                                console.log("Scanned Lighthouse :", resp);
                                await UrlService.ping(monitor._id, {
                                    monitor,
                                    resp,
                                });
                            } catch (error) {
                                failedCount++;
                                ErrorService.log(
                                    'lighthouseFetch',
                                    error.error
                                );
                            }
                        }

                        await UrlService.ping(monitor._id, {
                            monitor,
                            resp: {
                                lighthouseScanStatus:
                                    failedCount === sites.length
                                        ? 'failed'
                                        : 'scanned',
                            },
                        });
                    }
                }
            }
        } catch (error) {
            ErrorService.log('UrlMonitors.ping', error);
            throw error;
        }
    },
};

const lighthouseFetch = (monitor, url) => {
    return new Promise((resolve, reject) => {
        const lighthouseWorker = fork('./utils/lighthouse');
        const timeoutHandler = setTimeout(async () => {
            await processLighthouseScan({
                data: { url },
                error: { message: 'TIMEOUT' },
            });
        }, 300000);

        lighthouseWorker.send(url);
        lighthouseWorker.on('message', async result => {
            await processLighthouseScan(result);
        });

        async function processLighthouseScan(result) {
            clearTimeout(timeoutHandler);
            lighthouseWorker.removeAllListeners();
            if (result.error) {
                reject({ status: 'failed', ...result });
            } else {
                resolve({ status: 'scanned', ...result });
            }
        }
    });
};
