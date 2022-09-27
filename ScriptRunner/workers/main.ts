import scriptMonitors from './scriptMonitors';
import ApiService from '../Utils/apiService';

export default {
    runScriptMonitorsJob: async () => {
        /*
         * Get all script monitors
         * Run scripts
         */

        let monitors: $TSFixMe = await ApiService.getScriptMonitors();
        monitors = JSON.parse(monitors.data); // Parse the stringified data
        await Promise.all(
            monitors.map((monitor: $TSFixMe) => {
                return scriptMonitors.run(monitor);
            })
        );
    },
};
