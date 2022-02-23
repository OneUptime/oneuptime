const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch-commonjs');
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
    ping: async ({ monitor }) => {
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
                    while (retry || retryCount > 2) {
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
    let resp, res, response;

    try {
        let sslCertificate, data;
        const urlObject = new URL(url);
        const payload = {
            method: method,
            timeout: 30000,
        };
        if (headers && Object.keys(headers).length) {
            payload.headers = headers;
        }
        if (body && Object.keys(body).length) {
            payload.body = body;
        }
        try {
            /* Try with a normal http / https agent. 
               If this fails we'll try with an agent which has 
                {
                    rejectUnauthorized: false,
                }

                to check for self-signed SSL certs. 
            */
            response = await fetch(url, { ...payload });
            res = new Date().getTime() - now;
            try {
                /* Try getting response json body
                    If this fails, body is either empty or not valid json
                    and data should return null
                 */
                data = await response.json();
            } catch (e) {
                //
            }
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
            /* Retry with an agent which has 

                {
                    rejectUnauthorized: false,
                }

                to check for self-signed SSL certs. 
            */

            response = await fetch(url, {
                ...payload,
                ...(url.startsWith('https')
                    ? { agent: httpsAgent }
                    : { agent: httpAgent }),
            });
            res = new Date().getTime() - now;
            try {
                /* Try getting response json body
                    If this fails, body is either empty or not valid json
                    and data should return null
                 */
                data = await response.json();
            } catch (e) {
                //
            }
            if (urlObject.protocol === 'https:') {
                const certificate = await sslCert.get(urlObject.hostname);
                if (certificate) {
                    sslCertificate = {
                        issuer: certificate.issuer,
                        expires: certificate.valid_to,
                        fingerprint: certificate.fingerprint,
                        selfSigned: e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT',
                    };
                }
            }
        }

        resp = { status: response.status, body: data, sslCertificate };
    } catch (error) {
        res = new Date().getTime() - now;
        resp = { status: 408, body: error };
    }

    // this hard coded value will be removed soon
    // res = res / 250;

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
