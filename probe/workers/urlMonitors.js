/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch');
const sslCert = require('get-ssl-certificate');
const { fork } = require('child_process');
const moment = require('moment');
const https = require('https');
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    ping: async monitor => {
        try {
            if (monitor && monitor.type) {
                if (monitor.data.url) {
                    let retry = true;
                    let retryCount = 0;
                    while (retry) {
                        const { res, resp } = await pingfetch(monitor.data.url);

                        const response = await ApiService.ping(monitor._id, {
                            monitor,
                            res,
                            resp,
                            type: monitor.type,
                            retryCount,
                        });

                        if (response && !response.retry) {
                            retry = false;
                        } else {
                            retryCount++;
                        }
                    }

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
                        await ApiService.ping(monitor._id, {
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
        let sslCertificate, response, data, headers;
        try {
            response = await fetch(url, {
                timeout: 120000,
                ...(url.startsWith('https') && { agent: httpsAgent }),
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.113 Safari/537.36',
                },
            });
            const tes = await response;
            console.log('****** output *****', tes);
            res = new Date().getTime() - now;
            data = await response.text();
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

        headers = response.headers;
        resp = {
            headers,
            status: response.status,
            body: data,
            sslCertificate,
        };
    } catch (error) {
        res = new Date().getTime() - now;
        resp = { status: 408, body: error };
    }
    console.log(resp);
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
