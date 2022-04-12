import axios from 'axios';
const BASE_URL = `${process.env.BACKEND_PROTOCOL}://${process.env['ONEUPTIME_HOST']}`;

// make api call to designated endpoints
// to make the necessary updates to the db
module.exports.create = function (config: $TSFixMe): void {
    const store = {};

    store.options = config;

    store.accounts = {
        setKeypair: function (opts: $TSFixMe): void {
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
        checkKeypair: function (opts: $TSFixMe): void {
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

    store.certificates = {
        setKeypair: function (opts: $TSFixMe): void {
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
        checkKeypair: function (opts: $TSFixMe): void {
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
        set: function (opts: $TSFixMe): void {
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
        check: function (opts: $TSFixMe): void {
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
