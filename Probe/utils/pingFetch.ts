import logger from 'CommonServer/Utils/Logger';
import fetch from 'node-fetch-commonjs';

import sslCert from 'get-ssl-certificate';
import https from 'https';
import http from 'http';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

const httpAgent = new http.Agent();

const pingfetch = async (
    url: URL,
    method: $TSFixMe,
    body: $TSFixMe,
    headers: $TSFixMe
): void => {
    const now = new Date().getTime();
    let resp, res, response;

    if (!method) {
        method = 'GET';
    }

    try {
        logger.info(`Ping Start: ${method} ${url}`);
        let sslCertificate, data;
        const urlObject = new URL(url);
        const payload = {
            method: method,
            timeout: 30000,
        };
        if (headers && Object.keys(headers).length > 0) {
            payload.headers = headers;
        }
        if (body && Object.keys(body).length > 0) {
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
            logger.info(`Response Recieved: ${method} ${url}`);
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

            logger.info(`Retrying: ${method} ${url}`);
            response = await fetch(url, {
                ...payload,
                ...(url.startsWith('https')
                    ? { agent: httpsAgent }
                    : { agent: httpAgent }),
            });
            res = new Date().getTime() - now;
            logger.info(`Response Recieved: ${method} ${url}`);
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
        logger.info(`Ping End: ${method} ${url}`);
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

export default pingfetch;
