import axios from 'axios'
import config from './config'

const _this = {
    getHeaders: () => {
        return {
            'Access-Control-Allow-Origin': '*',
            Accept: 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
            probeName: config.probeName,
            probeKey: config.probeKey,
            clusterKey: config.clusterKey,
            probeVersion: config.probeVersion,
        };
    },

    postApi: (url: $TSFixMe, data: $TSFixMe) => {
        const headers = _this.getHeaders();

        return new Promise((resolve, reject) => {
            // Error [ERR_FR_MAX_BODY_LENGTH_EXCEEDED]: Request body larger than maxBodyLength limit
            // https://stackoverflow.com/questions/58655532/increasing-maxcontentlength-and-maxbodylength-in-axios
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
            axios({
                method: 'POST',
                url: `${config.dataIngestorUrl}/${url}`,
                headers,
                data,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
                .then(function(response) {
                    resolve(response.data);
                })
                .catch(function(error) {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    getApi: (url: $TSFixMe, limit = 10) => {
        const headers = _this.getHeaders();
        return new Promise((resolve, reject) => {
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
            axios({
                method: 'GET',
                url: `${config.probeApiUrl}/${url}?limit=${limit}`,
                headers,
            })
                .then(function(response) {
                    resolve(response.data);
                })
                .catch(function(error) {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    putApi: (url: $TSFixMe, data: $TSFixMe) => {
        const headers = _this.getHeaders();
        return new Promise((resolve, reject) => {
            // Error [ERR_FR_MAX_BODY_LENGTH_EXCEEDED]: Request body larger than maxBodyLength limit
            // https://stackoverflow.com/questions/58655532/increasing-maxcontentlength-and-maxbodylength-in-axios
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
            axios({
                method: 'PUT',
                url: `${config.dataIngestorUrl}/${url}`,
                headers,
                data,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
                .then(function(response) {
                    resolve(response.data);
                })
                .catch(function(error) {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    deleteApi: (url: $TSFixMe, data: $TSFixMe) => {
        const headers = _this.getHeaders();
        return new Promise((resolve, reject) => {
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
            axios({
                method: 'DELETE',
                url: `${config.dataIngestorUrl}/${url}`,
                headers,
                data,
            })
                .then(function(response) {
                    resolve(response.data);
                })
                .catch(function(error) {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },
};

export default _this;
