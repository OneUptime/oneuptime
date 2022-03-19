const postApi = require('./api').postApi;

export default {
    headers: async (val: $TSFixMe, type: $TSFixMe) => {
        const header = {};
        if (type && type.length) {
            header['Content-Type'] = type;
        }
        if (val && val.length) {
            val.forEach((head: $TSFixMe) => {
                header[head.key] = head.value;
            });
        }
        return header;
    },

    body: async (val: $TSFixMe, type: $TSFixMe) => {
        let bodyContent = {};
        if (type && type === 'formData' && val && val[0] && val[0].key) {
            val.forEach((bod: $TSFixMe) => {
                bodyContent[bod.key] = bod.value;
            });
            bodyContent = JSON.stringify(bodyContent);
        } else if (type && type === 'text' && val && val.length) {
            bodyContent = val;
        }
        return bodyContent;
    },

    setMonitorTime: async function (
        monitorId: $TSFixMe,
        responseTime: $TSFixMe,
        responseStatus: $TSFixMe,
        status: $TSFixMe
    ) {
        return await postApi(`probe/setTime/${monitorId}`, {
            responseTime,
            responseStatus,
            status,
        });
    },
    getMonitorTime: async function (monitorId: $TSFixMe, date: $TSFixMe) {
        return await postApi(`probe/getTime/${monitorId}`, { date });
    },
    ping: async function (monitorId: $TSFixMe, data: $TSFixMe) {
        return await postApi(`probe/ping/${monitorId}`, data);
    },
    setScanStatus: async function (monitorIds: $TSFixMe, status: $TSFixMe) {
        return await postApi('probe/set-scan-status', {
            scanning: status,
            monitorIds,
        });
    },
    addProbeScan: async function (monitorIds: $TSFixMe) {
        return await postApi('probe/add-probe-scan', { monitorIds });
    },
    removeProbeScan: async function (monitorIds: $TSFixMe) {
        return await postApi('probe/remove-probe-scan', { monitorIds });
    },
};
