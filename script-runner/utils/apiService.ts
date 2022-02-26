// @ts-expect-error ts-migrate(2614) FIXME: Module '"./api"' has no exported member 'getApi'. ... Remove this comment to see the full error message
import { getApi, postApi } from './api'

export default {
    ping: async function(monitorId: $TSFixMe, data: $TSFixMe) {
        return await postApi(`script-runner/ping/${monitorId}`, data);
    },
    getScriptMonitors: async () => {
        return await getApi('script-runner/monitors');
    },
};
