import BackendAPI from './api';
import Route from 'Common/Types/api/route';
export default {
    ping: async function (monitorId: $TSFixMe, data: $TSFixMe) {
        return await BackendAPI.post(`ScriptRunner/ping/${monitorId}`, data);
    },
    getScriptMonitors: async () => {
        return await BackendAPI.get(new Route('ScriptRunner/monitors'));
    },
};
