import BackendAPI from './api';

export default {
    ping: async function (monitorId: $TSFixMe, data: $TSFixMe) {
        return await BackendAPI.post(`script-runner/ping/${monitorId}`, data);
    },
    getScriptMonitors: async () => {
        return await BackendAPI.get('script-runner/monitors');
    },
};
