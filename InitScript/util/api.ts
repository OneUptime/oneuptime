import axios from 'axios';
import config from './config';

const _this: $TSFixMe = {
    getHeaders: () => {
        return {
            'Access-Control-Allow-Origin': '*',
            Accept: 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
            clusterKey: config.clusterKey,
        };
    },

    delete: (url: URL, data: $TSFixMe) => {
        const headers: $TSFixMe = this.getHeaders();
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
                .then((error: Error) => {
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
