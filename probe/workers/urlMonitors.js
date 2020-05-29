/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch');
const sslCert = require('get-ssl-certificate');
const { fork } = require('child_process');
const moment = require('moment');

const minuteStartTime = Math.floor(Math.random() * 50);

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
                        (!monitor.lighthouseScannedAt ||
                            scanIntervalInDays > 0) &&
                        (!monitor.lighthouseScanStatus ||
                            monitor.lighthouseScanStatus !== 'scanning')
                    ) {
                        resp.lighthouseScanStatus = 'scanning';
                        setTimeout(() => {
                            lighthouseFetch(monitor);
                        }, minuteStartTime * 1000);
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

const lighthouseFetch = monitor => {
    const lighthouseWorker = fork('./utils/lighthouse');
    const handler = setTimeout(async () => {
        await processLighthouseScan('failed');
    }, 30000);

    lighthouseWorker.send(monitor.data.url);
    lighthouseWorker.on('message', async scores => {
        await processLighthouseScan('scanned', scores);
    });

    async function processLighthouseScan(status, scores) {
        clearTimeout(handler);
        lighthouseWorker.removeAllListeners();

        const resp = { lighthouseScanStatus: status, lighthouseScores: scores };
        await ApiService.ping(monitor._id, {
            monitor,
            resp,
        });
    }
};
