const axios = require('axios');
const config = require('./config');

var headers = {
    'Access-Control-Allow-Origin': '*',
    'Accept': 'application/json',
    'Content-Type': 'application/json;charset=UTF-8',
    'probeName': config.probeName,
    'probeKey': config.probeKey
};

module.exports = {
    postApi: (url, data) => {
        return new Promise((resolve, reject) => {
            axios({
                method: 'POST',
                url: `${config.serverUrl}/${url}`,
                headers,
                data
            })
                .then(function (response) {
                    resolve(response.data);
                })
                .catch(function (error) {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    getApi: (url) => {
        return new Promise((resolve, reject) => {
            axios({
                method: 'GET',
                url: `${config.serverUrl}/${url}`,
                headers
            })
                .then(function (response) {
                    resolve(response.data);
                })
                .catch(function (error) {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    putApi: (url, data) => {
        return new Promise((resolve, reject) => {
            axios({
                method: 'PUT',
                url: `${config.serverUrl}/${url}`,
                headers,
                data
            })
                .then(function (response) {
                    resolve(response.data);
                })
                .catch(function (error) {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    },

    deleteApi: (url, data) => {
        return new Promise((resolve, reject) => {
            axios({
                method: 'DELETE',
                url: `${config.serverUrl}/${url}`,
                headers,
                data
            })
                .then(function (response) {
                    resolve(response.data);
                })
                .catch(function (error) {
                    if (error && error.response && error.response.data)
                        error = error.response.data;
                    if (error && error.data) {
                        error = error.data;
                    }
                    reject(error);
                });
        });
    }
};
