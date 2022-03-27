import BackendAPI from './api';
import Route from 'common/types/api/route';
export default {
    ping: async function (monitorId: $TSFixMe, data: $TSFixMe) {
        return await BackendAPI.post(`script-runner/ping/${monitorId}`, data);
    },
    getScriptMonitors: async () => {
        return await BackendAPI.get(new Route('script-runner/monitors'));
    },
};
