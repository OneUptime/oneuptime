import axios from 'axios';
const BASE_URL = `${process.env.BACKEND_PROTOCOL}://${process.env['ONEUPTIME_HOST']}`;

export default {
    create: function (config: $TSFixMe) {
        return {
            // init: function(opts) {
            //     //request = opts.request;
            //     return Promise.resolve(null);
            // },

            set: function (data: $TSFixMe) {
                const ch = data.challenge;

                // make api call to backend to store
                // keyAuthorization, challengeUrl, and token
                const url = `${BASE_URL}/api/ssl/challenge`;
                const dataConfig = {
                    token: ch.token,
                    keyAuthorization: ch.keyAuthorization,
                    challengeUrl: ch.challengeUrl,
                };
                return axios({
                    url,
                    method: 'post',
                    data: dataConfig,
                }).finally(() => null); // always return null
            },

            get: function (data: $TSFixMe) {
                const ch = data.challenge;

                const url = `${BASE_URL}/api/ssl/challenge/${ch.token}`;
                return axios.get(url).then((result: $TSFixMe) => result);
            },

            remove: function (data: $TSFixMe) {
                const ch = data.challenge;

                const url = `${BASE_URL}/api/ssl/challenge/${ch.token}`;
                return axios({ url, method: 'delete' }).finally(() => null); // always return null
            },

            options: config,
        };
    },
};
