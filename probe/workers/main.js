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
const ContainerSecurity = require('./containerSecurity');
const IncomingHttpRequestMonitors = require('./incomingHttpRequestMonitors');
const KubernetesMonitors = require('./kubernetesMonitors');

module.exports = {
    runJob: async function() {
        try {
            let monitors = await getApi('probe/monitors');
            monitors = JSON.parse(monitors.data); // parse the stringified data
            await Promise.all(
                monitors.map(monitor => {
                    if (monitor.type === 'api') {
                        return ApiMonitors.ping(monitor);
                    } else if (monitor.type === 'url') {
                        return UrlMonitors.ping(monitor);
                    } else if (monitor.type === 'ip') {
                        return IPMonitors.ping(monitor);
                    } else if (
                        monitor.type === 'server-monitor' &&
                        monitor.agentlessConfig
                    ) {
                        return ServerMonitors.run(monitor);
                    } else if (monitor.type === 'incomingHttpRequest') {
                        return IncomingHttpRequestMonitors.run(monitor);
                    } else if (monitor.type === 'kubernetes') {
                        return KubernetesMonitors.run(monitor);
                    }

                    return null;
                })
            );
        } catch (error) {
            ErrorService.log('getApi', error);
        }
    }
};
