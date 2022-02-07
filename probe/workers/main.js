const logger = require('../../common-server/utils/logger');
const getApi = require('../utils/api').getApi;
const ApiMonitors = require('./apiMonitors');
const UrlMonitors = require('./urlMonitors');
const IPMonitors = require('./ipMonitors');
const ServerMonitors = require('./serverMonitors');
const ErrorService = require('../utils/errorService');
const IncomingHttpRequestMonitors = require('./incomingHttpRequestMonitors');
const KubernetesMonitors = require('./kubernetesMonitors');
const limit = process.env.RESOURCES_LIMIT;
const asyncSleep = require('await-sleep');

const _this = {
    runJob: async function(monitorStore) {
        monitorStore = {};

        try {
            logger.info(`Getting a list of ${limit} monitors`);

            let monitors = await getApi('probe/monitors', limit);
            monitors = JSON.parse(monitors.data); // parse the stringified data

            logger.info(
                `Number of Monitors fetched - ${monitors.length} monitors`
            );

            if (monitors.length === 0) {
                // there are no monitors to monitor. Sleep for 30 seconds and then wake up.
                logger.info('No monitors to monitor. Sleeping for 30 seconds.');
                await asyncSleep(30 * 1000);
            }

            // add monitor to store
            monitors.forEach(monitor => {
                if (!monitorStore[monitor._id]) {
                    monitorStore[monitor._id] = monitor;
                }
            });

            // loop over the monitor
            for (const [key, monitor] of Object.entries(monitorStore)) {
                try {
                    logger.info(`Currently monitoring: Monitor ID ${key}`);
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

                    // delete the monitor from store
                    delete monitorStore[key];
                } catch (e) {
                    ErrorService.log('Main.runJob', e);
                    global.Sentry.captureException(e);
                }
            }
        } catch (error) {
            ErrorService.log('getApi', error);
            global.Sentry.captureException(error);
        }
    },
};

module.exports = _this;
