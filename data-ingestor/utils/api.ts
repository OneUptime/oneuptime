import axios from 'axios';

import { clusterKey, serverUrl, dataIngestorVersion } from './config';

const _this = {
    getHeaders: () => {
        return {
            'Access-Control-Allow-Origin': '*',
            Accept: 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
            clusterKey,
            dataIngestorVersion,
        };
    },
    postApi: (url: string, data: $TSFixMe, withBaseUrl = false) => {
        const headers = _this.getHeaders();

        return new Promise((resolve, reject) => {
            // Error [ERR_FR_MAX_BODY_LENGTH_EXCEEDED]: Request body larger than maxBodyLength limit
            // https://stackoverflow.com/questions/58655532/increasing-maxcontentlength-and-maxbodylength-in-axios
            axios({
                method: 'POST',
                url: withBaseUrl ? `${url}` : `${serverUrl}/${url}`,
                headers,
                data,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
                .then(response => {
                    resolve(response.data);
                })
                .then(error => {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    getApi: (url: string, withBaseUrl = false) => {
        const headers = _this.getHeaders();
        return new Promise((resolve, reject) => {
            axios({
                method: 'GET',
                url: withBaseUrl ? `${url}` : `${serverUrl}/${url}`,
                headers,
            })
                .then(response => {
                    resolve(response.data);
                })
                .then(error => {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    putApi: (url: string, data: $TSFixMe, withBaseUrl: string) => {
        const headers = _this.getHeaders();
        return new Promise((resolve, reject) => {
            // Error [ERR_FR_MAX_BODY_LENGTH_EXCEEDED]: Request body larger than maxBodyLength limit
            // https://stackoverflow.com/questions/58655532/increasing-maxcontentlength-and-maxbodylength-in-axios
            axios({
                method: 'PUT',
                url: withBaseUrl ? `${url}` : `${serverUrl}/${url}`,
                headers,
                data,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            })
                .then(response => {
                    resolve(response.data);
                })
                .then(error => {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    deleteApi: (url: string, data: $TSFixMe, withBaseUrl: string) => {
        const headers = _this.getHeaders();
        return new Promise((resolve, reject) => {
            axios({
                method: 'DELETE',
                url: withBaseUrl ? `${url}` : `${serverUrl}/${url}`,
                headers,
                data,
            })
                .then(response => {
                    resolve(response.data);
                })
                .then(error => {
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
