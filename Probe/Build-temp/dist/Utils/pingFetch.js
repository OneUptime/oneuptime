"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Logger_1 = __importDefault(require("CommonServer/Utils/Logger"));
const node_fetch_commonjs_1 = __importDefault(require("node-fetch-commonjs"));
const get_ssl_certificate_1 = __importDefault(require("get-ssl-certificate"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const httpsAgent = new https_1.default.Agent({
    rejectUnauthorized: false,
});
const httpAgent = new http_1.default.Agent();
const pingfetch = (url, method, body, headers) => __awaiter(void 0, void 0, void 0, function* () {
    const now = new Date().getTime();
    let resp, res, response;
    if (!method) {
        method = 'GET';
    }
    try {
        Logger_1.default.info(`Ping Start: ${method} ${url}`);
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
            /*
             * Try with a normal http / https agent.
             * If this fails we'll try with an agent which has
             *  {
             *      rejectUnauthorized: false,
             *  }
             *
             *  to check for self-signed SSL certs.
             */
            response = yield (0, node_fetch_commonjs_1.default)(url, Object.assign({}, payload));
            Logger_1.default.info(`Response Recieved: ${method} ${url}`);
            res = new Date().getTime() - now;
            try {
                /*
                 * Try getting response json body
                 *  If this fails, body is either empty or not valid json
                 *  and data should return null
                 */
                data = yield response.json();
            }
            catch (e) {
                //
            }
            if (urlObject.protocol === 'https:') {
                const certificate = yield get_ssl_certificate_1.default.get(urlObject.hostname);
                if (certificate) {
                    sslCertificate = {
                        issuer: certificate.issuer,
                        expires: certificate.valid_to,
                        fingerprint: certificate.fingerprint,
                        selfSigned: false,
                    };
                }
            }
        }
        catch (e) {
            /*
             * Retry with an agent which has
             *
             *  {
             *      rejectUnauthorized: false,
             *  }
             *
             *  to check for self-signed SSL certs.
             */
            Logger_1.default.info(`Retrying: ${method} ${url}`);
            response = yield (0, node_fetch_commonjs_1.default)(url, Object.assign(Object.assign({}, payload), (url.startsWith('https')
                ? { agent: httpsAgent }
                : { agent: httpAgent })));
            res = new Date().getTime() - now;
            Logger_1.default.info(`Response Recieved: ${method} ${url}`);
            try {
                /*
                 * Try getting response json body
                 *  If this fails, body is either empty or not valid json
                 *  and data should return null
                 */
                data = yield response.json();
            }
            catch (e) {
                //
            }
            if (urlObject.protocol === 'https:') {
                const certificate = yield get_ssl_certificate_1.default.get(urlObject.hostname);
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
        Logger_1.default.info(`Ping End: ${method} ${url}`);
        resp = { status: response.status, body: data, sslCertificate };
    }
    catch (error) {
        res = new Date().getTime() - now;
        resp = { status: 408, body: error };
    }
    return {
        res,
        resp,
        rawResp: {
            ok: response && response.ok ? response.ok : null,
            status: response && response.status
                ? response.status
                : resp && resp.status
                    ? resp.status
                    : null,
            statusText: response && response.statusText ? response.statusText : null,
            headers: response && response.headers && response.headers.raw()
                ? response.headers.raw()
                : null,
            body: resp && resp.body ? resp.body : null,
        },
    };
});
exports.default = pingfetch;
