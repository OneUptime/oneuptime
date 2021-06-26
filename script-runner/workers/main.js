const errorService = require('../utils/errorService');
const scriptMonitors = require('./scriptMonitors');
const ApiService = require('../utils/apiService');

module.exports = {
    runScriptMonitorsJob: async () => {
        // get all script monitors
        // run scripts
        try {
            let monitors = await ApiService.getScriptMonitors();
            monitors = JSON.parse(monitors.data); // parse the stringified data
            await Promise.all(
                monitors.map(monitor => scriptMonitors.run(monitor))
            );
        } catch (error) {
            errorService.log('getApi', error);
        }
    },
};
