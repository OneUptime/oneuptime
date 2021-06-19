const axios = require('axios');

module.exports = {
    headers: async (val, type) => {
        const header = {};
        if (type && type.length) {
            header['Content-Type'] = type;
        }
        if (val && val.length) {
            val.forEach(head => {
                header[head.key] = head.value;
            });
        }
        return header;
    },

    body: async (val, type) => {
        let bodyContent = {};
        if (type && type === 'formData' && val && val[0] && val[0].key) {
            val.forEach(bod => {
                bodyContent[bod.key] = bod.value;
            });
            bodyContent = JSON.stringify(bodyContent);
        } else if (type && type === 'text' && val && val.length) {
            bodyContent = val;
        }
        return bodyContent;
    },

    postApi: (url, data) => {
        return new Promise((resolve, reject) => {
            axios({
                method: 'POST',
                url,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    Accept: 'application/json',
                    'Content-Type': 'application/json;charset=UTF-8',
                },
                data,
            })
                .then(response => {
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
