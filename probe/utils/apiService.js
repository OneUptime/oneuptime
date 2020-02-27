const postApi = require('./api').postApi;

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

    setMonitorTime: async function(
        monitorId,
        responseTime,
        responseStatus,
        status
    ) {
        return await postApi(`probe/setTime/${monitorId}`, {
            responseTime,
            responseStatus,
            status,
        });
    },
    getMonitorTime: async function(monitorId, date) {
        return await postApi(`probe/getTime/${monitorId}`, { date });
    },
    ping: async function(monitorId, data) {
        return await postApi(`probe/ping/${monitorId}`, data);
    },
};
