/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const getApi = require('../utils/api').getApi;
const ApiMonitors = require('./apiMonitors');
const UrlMonitors = require('./urlMonitors');
const DeviceMonitors = require('./deviceMonitors');
const ErrorService = require('../utils/errorService');

module.exports = {
    runJob: async function () {
        try {
            let monitors = await getApi('probe/monitors');
            monitors = monitors.data;
            await Promise.all(monitors.map(monitor => {
                if (monitor.type === 'api') {
                    ApiMonitors.ping(monitor);
                }
                else if (monitor.type === 'url') {
                    UrlMonitors.ping(monitor);
                }
                else if (monitor.type === 'device') {
                    DeviceMonitors.ping(monitor);
                }
            }));
        } catch (error) {
            ErrorService.log('getApi', error);
        }
    },
};