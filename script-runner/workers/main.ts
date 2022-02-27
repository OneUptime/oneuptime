import errorService from '../utils/errorService';
import scriptMonitors from './scriptMonitors';
import ApiService from '../utils/apiService';

export default {
    runScriptMonitorsJob: async () => {
        // get all script monitors
        // run scripts
        try {
            let monitors = await ApiService.getScriptMonitors();
            monitors = JSON.parse(monitors.data); // parse the stringified data
            await Promise.all(
                monitors.map((monitor: $TSFixMe) => scriptMonitors.run(monitor))
            );
        } catch (error) {
            errorService.log('getApi', error);
        }
    },
};
