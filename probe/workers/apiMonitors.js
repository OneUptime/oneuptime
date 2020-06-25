/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch');
const sslCert = require('get-ssl-certificate');

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
                    const { res, resp } = await pingfetch(
                        monitor.data.url,
                        monitor.method,
                        body,
                        headers
                    );

                    await ApiService.ping(monitor._id, {
                        monitor,
                        res,
                        resp,
                        type: monitor.type,
                    });
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
    try {
        let sslCertificate, response, data;
        try {
            response = await fetch(url, {
                method: method,
                body: body,
                headers: headers,
                timeout: 120000,
            });
            data = await response.json();
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
        resp = { status: 408, body: error };
    }
    res = new Date().getTime() - now;
    return { res, resp };
};
