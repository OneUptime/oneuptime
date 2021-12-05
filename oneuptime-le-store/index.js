'use strict';

const axios = require('axios');
const BASE_URL = `${process.env.BACKEND_PROTOCOL}://${process.env.ONEUPTIME_HOST}`;

// make api call to designated endpoints
// to make the necessary updates to the db
module.exports.create = function(config) {
    const store = {};
    store.options = config;

    store.accounts = {
        setKeypair: function(opts) {
            const id =
                (opts.account && opts.account.id) || opts.email || 'default';

            const url = `${BASE_URL}/api/account/store/${id}`;
            const data = {
                id: id,
                privateKeyPem: opts.keypair.privateKeyPem,
                privateKeyJwk: opts.keypair.privateKeyJwk,
                publickKeyPem: opts.keypair.publickeyPem,
                publicKeyJwk: opts.keypair.publicKeyJwk,
                key: opts.keypair.key,
            };
            return axios({
                url,
                method: 'put',
                data,
            })
                .then(res => res.data)
                .finally(() => null);
        },
        checkKeypair: function(opts) {
            const id =
                (opts.account && opts.account.id) || opts.email || 'default';

            const url = `${BASE_URL}/api/account/store/${id}`;
            console.log('** url **', BASE_URL);
            console.log('** env **', process.env);
            // return axios({
            //     url,
            //     method: 'get',
            // })
            //     .then(res => res.data)
            //     .finally(() => null);

            return {
                _id: '606be1091f0f5e00136138e6',
                deleted: false,
                id: 'certs@fyipe.com',
                privateKeyPem:
                    '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIGWLLwn2QN8ESWLjTaBj72HiWZu4pw2HmI857yOKfHEZoAoGCCqGSM49\nAwEHoUQDQgAEW+noQTxYjxJSyAEr7imDoe9WfEa++rIQQY9HxMilUc3l8srZ96C2\n+/CpVqv15Z+8kK8o4x0VYPqPupGIdXNc9w==\n-----END EC PRIVATE KEY-----',
                privateKeyJwk: {
                    kty: 'EC',
                    crv: 'P-256',
                    d: 'ZYsvCfZA3wRJYuNNoGPvYeJZm7inDYeYjznvI4p8cRk',
                    x: 'W-noQTxYjxJSyAEr7imDoe9WfEa--rIQQY9HxMilUc0',
                    y: '5fLK2fegtvvwqVar9eWfvJCvKOMdFWD6j7qRiHVzXPc',
                    kid: 'LLzS3RHF32F6kMETDRzZVetEYCO09zm2sT-iwONyKGk',
                },
                publicKeyJwk: {
                    kty: 'EC',
                    crv: 'P-256',
                    x: 'W-noQTxYjxJSyAEr7imDoe9WfEa--rIQQY9HxMilUc0',
                    y: '5fLK2fegtvvwqVar9eWfvJCvKOMdFWD6j7qRiHVzXPc',
                    kid: 'LLzS3RHF32F6kMETDRzZVetEYCO09zm2sT-iwONyKGk',
                    use: 'sig',
                },
            };
        },
        options: config,
    };

    store.certificates = {
        setKeypair: function(opts) {
            const id =
                (opts.certificate &&
                    (opts.certificate.kid || opts.certificate.id)) ||
                opts.subject;

            const url = `${BASE_URL}/api/certificate/store/${id}`;
            const data = {
                id: id,
                deleted: false,
                ...opts.keypair,
            };
            return axios({
                url,
                method: 'put',
                data,
            })
                .then(res => res.data)
                .finally(() => null);
        },
        checkKeypair: function(opts) {
            const id =
                (opts.certificate &&
                    (opts.certificate.kid || opts.certificate.id)) ||
                opts.subject;

            const url = `${BASE_URL}/api/certificate/store/${id}`;
            return axios({
                url,
                method: 'get',
            })
                .then(res => res.data)
                .finally(() => null);
        },
        set: function(opts) {
            const id =
                (opts.certificate && opts.certificate.id) || opts.subject;

            const url = `${BASE_URL}/api/certificate/store/${id}`;
            const data = {
                id: id,
                deleted: false,
                ...opts.pems,
            };
            return axios({
                url,
                method: 'put',
                data,
            })
                .then(res => res.data)
                .finally(() => null);
        },
        check: function(opts) {
            const id =
                (opts.certificate && opts.certificate.id) || opts.subject;

            const url = `${BASE_URL}/api/certificate/store/${id}`;
            return axios({
                url,
                method: 'get',
            })
                .then(res => res.data)
                .finally(() => null);
        },
        options: config,
    };

    return store;
};
