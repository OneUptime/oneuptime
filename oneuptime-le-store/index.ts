'use strict';

// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'axios' or its corresponding ty... Remove this comment to see the full error message
import axios from 'axios'
const BASE_URL = `${process.env.BACKEND_PROTOCOL}://${process.env.ONEUPTIME_HOST}`;

// make api call to designated endpoints
// to make the necessary updates to the db
module.exports.create = function(config: $TSFixMe) {
    const store = {};
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'options' does not exist on type '{}'.
    store.options = config;

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'accounts' does not exist on type '{}'.
    store.accounts = {
        setKeypair: function(opts: $TSFixMe) {
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
                .then((res: $TSFixMe) => res.data)
                .finally(() => null);
        },
        checkKeypair: function(opts: $TSFixMe) {
            const id =
                (opts.account && opts.account.id) || opts.email || 'default';

            const url = `${BASE_URL}/api/account/store/${id}`;
            return axios({
                url,
                method: 'get',
            })
                .then((res: $TSFixMe) => res.data)
                .finally(() => null);
        },
        options: config,
    };

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'certificates' does not exist on type '{}... Remove this comment to see the full error message
    store.certificates = {
        setKeypair: function(opts: $TSFixMe) {
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
                .then((res: $TSFixMe) => res.data)
                .finally(() => null);
        },
        checkKeypair: function(opts: $TSFixMe) {
            const id =
                (opts.certificate &&
                    (opts.certificate.kid || opts.certificate.id)) ||
                opts.subject;

            const url = `${BASE_URL}/api/certificate/store/${id}`;
            return axios({
                url,
                method: 'get',
            })
                .then((res: $TSFixMe) => res.data)
                .finally(() => null);
        },
        set: function(opts: $TSFixMe) {
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
                .then((res: $TSFixMe) => res.data)
                .finally(() => null);
        },
        check: function(opts: $TSFixMe) {
            const id =
                (opts.certificate && opts.certificate.id) || opts.subject;

            const url = `${BASE_URL}/api/certificate/store/${id}`;
            return axios({
                url,
                method: 'get',
            })
                .then((res: $TSFixMe) => res.data)
                .finally(() => null);
        },
        options: config,
    };

    return store;
};
