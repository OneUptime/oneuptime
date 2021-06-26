const { getApi } = require('../utils/api');
const errorService = require('../utils/errorService');
const scriptMonitors = require('./scriptMonitors');

module.exports = {
    runScriptMonitorsJob: async () => {
        // get all script monitors
        // run scripts
        try {
            let monitors = await getApi('script-runner/monitors');
            monitors = JSON.parse(monitors.data); // parse the stringified data
            await Promise.all(
                monitors.map(monitor => scriptMonitors.ping(monitor))
            );
        } catch (error) {
            errorService.log('getApi', error);
        }
    },
};
