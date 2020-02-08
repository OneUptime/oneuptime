var moment = require('moment');
var MonitorService = require('../services/monitorService'),
    IncidentService = require('../services/incidentService'),
    ZapierService = require('../services/zapierService'),
    ErrorService = require('../services/errorService');

module.exports = {

    checkActiveEscalationPolicyAndSendAlerts: async () => {
        try {
            var newDate = new moment();
            var resDate = new Date();
            var monitors = await MonitorService.getDeviceMonitorsPing();
            if (monitors) {
                monitors.forEach(async (monitor) => {
                    var d = new moment(monitor.lastPingTime);
    
                    if (newDate.diff(d, 'minutes') > 3) {
                        await job(monitor);
                    } else {
                        var res = (new Date()).getTime() - resDate.getTime();
                        await job(monitor, res);
                    }
                });
            } else {
                return;
            }
        } catch (error) {
            ErrorService.log('iotCron.checkAllDeviceMonitor', error);
            throw error;
        }
    }
};

