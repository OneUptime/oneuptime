/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch');
const sslCert = require('get-ssl-certificate');
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
                    const headers = await ApiService.headers(
                        monitor.headers,
                        monitor.bodyType
                    );
                    const body = await ApiService.body(
                        monitor && monitor.text && monitor.text.length
                            ? monitor.text
                            : monitor.formData,
                        monitor && monitor.text && monitor.text.length
                            ? 'text'
                            : 'formData'
                    );

                    let retry = true;
                    let retryCount = 0;
                    while (retry) {
                        const { res, resp, rawResp } = await pingfetch(
                            monitor.data.url,
                            monitor.method,
                            body,
                            headers
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
            ErrorService.log('apiMonitors.ping', error);
            throw error;
        }
    },
};

const pingfetch = async (url, method, body, headers) => {
    const now = new Date().getTime();
    let resp = null;
    let res = null;
    let sslCertificate, response, data;
    try {
        try {
            const urlObject = new URL(url);
            const payload = {
                method: method,
                timeout: 120000,
                agent: urlObject.protocol === 'https' ? httpsAgent : httpAgent,
            };
            if (headers && Object.keys(headers).length) {
                payload.headers = headers;
            }
            if (body && Object.keys(body).length) {
                payload.body = body;
            }
            response = await fetch(url, payload);
            res = new Date().getTime() - now;
            data = await response.json();
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
    return {
        res,
        resp,
        rawResp: {
            ok: response && response.ok ? response.ok : null,
            status:
                response && response.status
                    ? response.status
                    : resp && resp.status
                    ? resp.status
                    : null,
            statusText:
                response && response.statusText ? response.statusText : null,
            headers:
                response && response.headers && response.headers.raw()
                    ? response.headers.raw()
                    : null,
            body: resp && resp.body ? resp.body : null,
        },
    };
};
