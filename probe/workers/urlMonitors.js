/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch');
const sslCert = require('get-ssl-certificate');
const { fork } = require('child_process');
const moment = require('moment');

// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    ping: async monitor => {
        try {
            if (monitor && monitor.type) {
                if (monitor.data.url) {
                    const { res, resp } = await pingfetch(monitor.data.url);

                    const now = new Date().getTime();
                    const scanIntervalInDays = monitor.lighthouseScannedAt
                        ? moment(now).diff(
                              moment(monitor.lighthouseScannedAt),
                              'days'
                          )
                        : -1;
                    if (
                        (monitor.lighthouseScanStatus &&
                            monitor.lighthouseScanStatus === 'failed') ||
                        ((!monitor.lighthouseScannedAt ||
                            scanIntervalInDays > 0) &&
                            (!monitor.lighthouseScanStatus ||
                                monitor.lighthouseScanStatus !== 'scanning'))
                    ) {
                        await ApiService.ping(monitor._id, {
                            monitor,
                            resp: { lighthouseScanStatus: 'scanning' },
                        });

                        const sites = [monitor.data.url, ...monitor.sitePages];
                        let failedCount = 0;
                        for (const url of sites) {
                            try {
                                const resp = await lighthouseFetch(
                                    monitor,
                                    url
                                );

                                await ApiService.ping(monitor._id, {
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

                        await ApiService.ping(monitor._id, {
                            monitor,
                            resp: {
                                lighthouseScanStatus:
                                    failedCount === sites.length
                                        ? 'failed'
                                        : 'scanned',
                            },
                        });
                    }

                    await ApiService.ping(monitor._id, {
                        monitor,
                        res,
                        resp,
                        type: monitor.type,
                    });
                }
            }
        } catch (error) {
            ErrorService.log('UrlMonitors.ping', error);
            throw error;
        }
    },
};

const pingfetch = async url => {
    const now = new Date().getTime();
    let resp = null;
    let res = null;
    try {
        let sslCertificate, response, data;
        try {
            response = await fetch(url, { timeout: 30000 });
            data = await response.text();
            res = new Date().getTime() - now;
            const urlObject = new URL(url);
            if (urlObject.protocol === 'https:') {
                const certificate = await sslCert.get(urlObject.hostname);
                if (certificate) {
                    sslCertificate = {
                        issuer: certificate.issuer,
                        expires: certificate.valid_to,
                        fingerprint: certificate.fingerprint,
                        selfSigned: false,
                    };
                }
            }
        } catch (e) {
            if (e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
                response = { status: 200 };
                sslCertificate = {
                    selfSigned: true,
                };
            } else {
                throw e;
            }
        }
        resp = { status: response.status, body: data, sslCertificate };
    } catch (error) {
        res = new Date().getTime() - now;
        resp = { status: 408, body: error };
    }
    return { res, resp };
};

const lighthouseFetch = (monitor, url) => {
    return new Promise((resolve, reject) => {
        const lighthouseWorker = fork('./utils/lighthouse');
        const timeoutHandler = setTimeout(async () => {
            await processLighthouseScan({
                data: { url },
                error: { message: 'TIMEOUT' },
            });
        }, 60000);

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
