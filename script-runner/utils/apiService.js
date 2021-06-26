const postApi = require('./api').postApi;

module.exports = {
    ping: async function(monitorId, data) {
        return await postApi(`script-runner/ping/${monitorId}`, data);
    },
};
