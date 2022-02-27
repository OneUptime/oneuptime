const getApi = require('../utils/api').getApi;
import UrlMonitors from './urlMonitors';
import ErrorService from '../utils/errorService';

export default {
    runJob: async function() {
        try {
            let monitors = await getApi('lighthouse/monitors');
            monitors = JSON.parse(monitors.data); // parse the stringified data
            await Promise.all(
                monitors.map((monitor: $TSFixMe) => {
                    if (monitor.type === 'url') {
                        if (monitor.pollTime && monitor.pollTime.length > 0) {
                            // This checks that the ssl result has already been published i.e probe is runnning.
                            return UrlMonitors.ping(monitor);
                        } else {
                            ErrorService.log(
                                'getApi',
                                'Please Make Sure Probe Server is Online.'
                            );
                        }
                    }
                    return null;
                })
            );
        } catch (error) {
            ErrorService.log('getApi', error);
        }
    },
};
