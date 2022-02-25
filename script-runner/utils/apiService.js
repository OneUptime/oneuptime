import { getApi, postApi } from './api'

export default {
    ping: async function(monitorId, data) {
        return await postApi(`script-runner/ping/${monitorId}`, data);
    },
    getScriptMonitors: async () => {
        return await getApi('script-runner/monitors');
    },
};
