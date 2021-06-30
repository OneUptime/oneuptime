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
                    if(monitor.type === 'url' && monitor.pollTime && monitor.pollTime.length > 0){ 
                       const probe = monitor.pollTime.filter(probe => probe.probeId);
                       if(probe.length > 0){ // This checks that the probe server is working
                           return UrlMonitors.ping(monitor);
                       }else{
                           ErrorService.log('getApi',"Please Make Sure Probe Server is Online.")
                       }
                    }
                    return null;
                })
            );
        } catch (error) {
            ErrorService.log('getApi', error);
        }
    },
}