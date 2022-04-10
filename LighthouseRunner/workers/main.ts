import BackendAPI from '../Utils/api';
import UrlMonitors from './urlMonitors';

import Route from 'common/Types/api/route';

export default {
    runJob: async function () {
        let monitors = await BackendAPI.get(new Route('lighthouse/monitors'));
        monitors = JSON.parse(monitors.data); // parse the stringified data
        await Promise.all(
            monitors.map((monitor: $TSFixMe) => {
                if (monitor.type === 'url') {
                    if (monitor.pollTime && monitor.pollTime.length > 0) {
                        // This checks that the ssl result has already been published i.e probe is runnning.
                        return UrlMonitors.ping(monitor);
                    }
                }
                return null;
            })
        );
    },
};
