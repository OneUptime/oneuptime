import axios from 'axios';
const BASE_URL: string = `${process.env.BACKEND_PROTOCOL}://${process.env.ONEUPTIME_HOST}`;

export default {
    create: function (config: $TSFixMe): void {
        return {
            /*
             * Init: function(opts) {
             *     //request = opts.request;
             *     Return Promise.resolve(null);
             * },
             */

            set: function (data: $TSFixMe): void {
                const ch: $TSFixMe = data.challenge;

                /*
                 * Make api call to backend to store
                 * KeyAuthorization, challengeUrl, and token
                 */
                const url: string = `${BASE_URL}/api/ssl/challenge`;
                const dataConfig: $TSFixMe = {
                    token: ch.token,
                    keyAuthorization: ch.keyAuthorization,
                    challengeUrl: ch.challengeUrl,
                };
                return axios({
                    url,
                    method: 'post',
                    data: dataConfig,
                }).finally(() => {
                    return null;
                }); // Always return null
            },

            get: function (data: $TSFixMe): void {
                const ch: $TSFixMe = data.challenge;

                const url: string = `${BASE_URL}/api/ssl/challenge/${ch.token}`;
                return axios.get(url).then((result: $TSFixMe) => {
                    return result;
                });
            },

            remove: function (data: $TSFixMe): void {
                const ch: $TSFixMe = data.challenge;

                const url: string = `${BASE_URL}/api/ssl/challenge/${ch.token}`;
                return axios({ url, method: 'delete' }).finally(() => {
                    return null;
                }); // Always return null
            },

            options: config,
        };
    },
};
