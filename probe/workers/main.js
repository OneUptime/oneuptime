/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const getApi = require('../utils/api').getApi;
const ApiMonitors = require('./apiMonitors');
const UrlMonitors = require('./urlMonitors');
const IPMonitors = require('./ipMonitors');
const ServerMonitors = require('./serverMonitors');
const ErrorService = require('../utils/errorService');
const IncomingHttpRequestMonitors = require('./incomingHttpRequestMonitors');
const KubernetesMonitors = require('./kubernetesMonitors');
const ApiService = require('../utils/apiService');

/**
 *
 * Investigation:
 *   - Log every request and kubectl log the backend.
 *
 *  If backend is normal then optimize code.
 *
 *  - Queuing system on probes.
 *  - Sharing of monitors in probes. (We can run multiple deployment of a single probe)
 *  - if criteria is request body , then curl otherwise ICMP ping which is a LOT faster.
 */

module.exports = {
    runJob: async function() {
        try {
            let monitors = await getApi('probe/monitors');
            monitors = JSON.parse(monitors.data); // parse the stringified data

            console.log('** monitors **', JSON.stringify(monitors, null, 4));

            // update all monitors to have scanning set to true
            const monitorIds = monitors.map(monitor => monitor._id);
            // await ApiService.setScanStatus(monitorIds, true);
            await ApiService.addProbeScan(monitorIds);

            for (const monitor of monitors) {
                try {
                    if (monitor.type === 'api') {
                        await ApiMonitors.ping({ monitor });
                    } else if (monitor.type === 'url') {
                        await UrlMonitors.ping({ monitor });
                    } else if (monitor.type === 'ip') {
                        await IPMonitors.ping({ monitor });
                    } else if (
                        monitor.type === 'server-monitor' &&
                        monitor.agentlessConfig
                    ) {
                        await ServerMonitors.run({ monitor });
                    } else if (monitor.type === 'incomingHttpRequest') {
                        await IncomingHttpRequestMonitors.run({ monitor });
                    } else if (monitor.type === 'kubernetes') {
                        await KubernetesMonitors.run({ monitor });
                    }
                } catch (e) {
                    ErrorService.log('Main.runJob', e);
                }
            }

            // update all monitor scan status to false
            // await ApiService.setScanStatus(monitorIds, false);
            await ApiService.removeProbeScan(monitorIds);
        } catch (error) {
            ErrorService.log('getApi', error);
        }
    },
};
