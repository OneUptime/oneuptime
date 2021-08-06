/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const getApi = require('../utils/api').getApi;
// const ApiMonitors = require('./apiMonitors');
// const UrlMonitors = require('./urlMonitors');
const IPMonitors = require('./ipMonitors');
const ServerMonitors = require('./serverMonitors');
const ErrorService = require('../utils/errorService');
const IncomingHttpRequestMonitors = require('./incomingHttpRequestMonitors');
const KubernetesMonitors = require('./kubernetesMonitors');

module.exports = {
    runJob: async function() {
        try {
            let monitors = await getApi('probe/monitors');
            monitors = JSON.parse(monitors.data); // parse the stringified data

            for (const monitor of monitors) {
                try {
                    if (monitor.type === 'api') {
                        // await ApiMonitors.ping(monitor);
                    } else if (monitor.type === 'url') {
                        // await UrlMonitors.ping(monitor);
                    } else if (monitor.type === 'ip') {
                        await IPMonitors.ping(monitor);
                    } else if (
                        monitor.type === 'server-monitor' &&
                        monitor.agentlessConfig
                    ) {
                        await ServerMonitors.run(monitor);
                    } else if (monitor.type === 'incomingHttpRequest') {
                        await IncomingHttpRequestMonitors.run(monitor);
                    } else if (monitor.type === 'kubernetes') {
                        await KubernetesMonitors.run(monitor);
                    }
                } catch (e) {
                    ErrorService.log('Main.runJob', e);
                }
            }
        } catch (error) {
            ErrorService.log('getApi', error);
        }
    },
};
