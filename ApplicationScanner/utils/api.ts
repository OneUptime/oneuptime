import axios from 'axios';
import config from './config';

const _this: $TSFixMe = {
    getHeaders: () => {
        return {
            'Access-Control-Allow-Origin': '*',
            Accept: 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
            applicationScannerName: config.applicationScannerName,
            applicationScannerKey: config.applicationScannerKey,
            clusterKey: config.clusterKey,
            applicationScannerVersion: config.applicationScannerVersion,
        };
    },
    post: (url: URL, data: $TSFixMe) => {
        const headers = this.getHeaders();

        return new Promise((resolve, reject) => {
            axios({
                method: 'POST',
                url: `${config.serverUrl}/${url}`,
                headers,
                data,
            })
                .then(response => {
                    resolve(response.data);
                })
                .then(error => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    get: (url: URL) => {
        const headers = this.getHeaders();
        return new Promise((resolve, reject) => {
            axios({
                method: 'GET',
                url: `${config.serverUrl}/${url}`,
                headers,
            })
                .then(response => {
                    resolve(response.data);
                })
                .then(error => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    put: (url: URL, data: $TSFixMe) => {
        const headers = this.getHeaders();
        return new Promise((resolve, reject) => {
            axios({
                method: 'PUT',
                url: `${config.serverUrl}/${url}`,
                headers,
                data,
            })
                .then(response => {
                    resolve(response.data);
                })
                .then(error => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    delete: (url: URL, data: $TSFixMe) => {
        const headers = this.getHeaders();
        return new Promise((resolve, reject) => {
            axios({
                method: 'DELETE',
                url: `${config.serverUrl}/${url}`,
                headers,
                data,
            })
                .then(response => {
                    resolve(response.data);
                })
                .then(error => {
                    if (error && error.response && error.response.data) {
                        error = error.response.data;
                    }
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },
};

export default _this;
