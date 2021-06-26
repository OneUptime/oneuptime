const { getApi, postApi } = require('./api');

module.exports = {
    ping: async function(monitorId, data) {
        return await postApi(`script-runner/ping/${monitorId}`, data);
    },
    getScriptMonitors: async () => {
        return await getApi('script-runner/monitors');
    },
};
