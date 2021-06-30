const getApi = require('../utils/api').getApi;
const UrlMonitors = require('./urlMonitors');
const ErrorService = require('../utils/errorService');

module.exports = {
    runJob: async function() {
        try {
            let monitors = await getApi('lighthouse/monitors');
            monitors = JSON.parse(monitors.data); // parse the stringified data
            await Promise.all(
                monitors.map(monitor => {
                    if(monitor.type === 'url'){
                        return UrlMonitors.ping(monitor);
                    }
                    return null;
                })
            );
        } catch (error) {
            ErrorService.log('getApi', error);
        }
    },
}