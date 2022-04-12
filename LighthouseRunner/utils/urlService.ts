import BackendAPI from './api';

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

    ping: async function (monitorId: $TSFixMe, data: $TSFixMe): void {
        return await BackendAPI.post(`lighthouse/ping/${monitorId}`, data);
    },
};
