import axios from 'axios';
const BASE_URL: string = `${process.env.BACKEND_PROTOCOL}://${process.env.ONEUPTIME_HOST}`;

/*
 * Make api call to designated endpoints
 * To make the necessary updates to the db
 */
module.exports.create = function (config: $TSFixMe): void {
    const store: $TSFixMe = {};

    store.options = config;

    store.accounts = {
        setKeypair: function (opts: $TSFixMe): void {
            const id: $TSFixMe =
                (opts.account && opts.account.id) || opts.email || 'default';

            const url: string = `${BASE_URL}/api/account/store/${id}`;
            const data: $TSFixMe = {
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
                .then((res: $TSFixMe) => {
                    return res.data;
                })
                .finally(() => {
                    return null;
                });
        },
        checkKeypair: function (opts: $TSFixMe): void {
            const id: $TSFixMe =
                (opts.account && opts.account.id) || opts.email || 'default';

            const url: string = `${BASE_URL}/api/account/store/${id}`;
            return axios({
                url,
                method: 'get',
            })
                .then((res: $TSFixMe) => {
                    return res.data;
                })
                .finally(() => {
                    return null;
                });
        },
        options: config,
    };

    store.certificates = {
        setKeypair: function (opts: $TSFixMe): void {
            const id: $TSFixMe =
                (opts.certificate &&
                    (opts.certificate.kid || opts.certificate.id)) ||
                opts.subject;

            const url: string = `${BASE_URL}/api/certificate/store/${id}`;
            const data: $TSFixMe = {
                id: id,
                deleted: false,
                ...opts.keypair,
            };
            return axios({
                url,
                method: 'put',
                data,
            })
                .then((res: $TSFixMe) => {
                    return res.data;
                })
                .finally(() => {
                    return null;
                });
        },
        checkKeypair: function (opts: $TSFixMe): void {
            const id: $TSFixMe =
                (opts.certificate &&
                    (opts.certificate.kid || opts.certificate.id)) ||
                opts.subject;

            const url: string = `${BASE_URL}/api/certificate/store/${id}`;
            return axios({
                url,
                method: 'get',
            })
                .then((res: $TSFixMe) => {
                    return res.data;
                })
                .finally(() => {
                    return null;
                });
        },
        set: function (opts: $TSFixMe): void {
            const id: $TSFixMe =
                (opts.certificate && opts.certificate.id) || opts.subject;

            const url: string = `${BASE_URL}/api/certificate/store/${id}`;
            const data: $TSFixMe = {
                id: id,
                deleted: false,
                ...opts.pems,
            };
            return axios({
                url,
                method: 'put',
                data,
            })
                .then((res: $TSFixMe) => {
                    return res.data;
                })
                .finally(() => {
                    return null;
                });
        },
        check: function (opts: $TSFixMe): void {
            const id: $TSFixMe =
                (opts.certificate && opts.certificate.id) || opts.subject;

            const url: string = `${BASE_URL}/api/certificate/store/${id}`;
            return axios({
                url,
                method: 'get',
            })
                .then((res: $TSFixMe) => {
                    return res.data;
                })
                .finally(() => {
                    return null;
                });
        },
        options: config,
    };

    return store;
};
