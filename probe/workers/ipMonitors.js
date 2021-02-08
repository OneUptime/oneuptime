/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch');
const sslCert = require('get-ssl-certificate');
const https = require('https');
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});
// it collects all monitors then ping them one by one to store their response
// checks if the IP Address of the IP monitor is up or down
// creates incident if a IP Address is down and resolves it when they come back up
module.exports = {
    ping: async monitor => {
        try {
            if (monitor && monitor.type) {
                if (monitor.data.IPAddress) {
                    let retry = true;
                    let retryCount = 0;
                    while (retry) {
                        const { res, resp, rawResp } = await pingfetch(
                            monitor.data.IPAddress
                        );

                        const response = await ApiService.ping(monitor._id, {
                            monitor,
                            res,
                            resp,
                            rawResp,
                            type: monitor.type,
                            retryCount,
                        });

                        if (response && !response.retry) {
                            retry = false;
                        } else {
                            retryCount++;
                        }
                    }
                }
            }
        } catch (error) {
            ErrorService.log('IPMonitors.ping', error);
            throw error;
        }
    },
};

const pingfetch = async IPAddress => {
    const now = new Date().getTime();
    let resp = null;
    let rawResp = null;
    let res = null;

    try {
        let sslCertificate, response, data;
        try {
            const abosluteURL = `https://${IPAddress}`;
            response = await fetch(abosluteURL, {
                timeout: 120000,
                ...(IPAddress.startsWith('https') && { agent: httpsAgent }),
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.113 Safari/537.36',
                },
            });
            res = new Date().getTime() - now;
            data = await response.text();
            const urlObject = new URL(abosluteURL);
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

        resp = {
            status: response.status,
            body: data,
            sslCertificate,
        };
        rawResp = {
            headers:
                response && response.headers && response.headers.raw()
                    ? response.headers.raw()
                    : null,
        };
    } catch (error) {
        res = new Date().getTime() - now;
        console.log('error body', error);
        resp = { status: 408, body: error };
    }

    return { res, resp, rawResp };
};
