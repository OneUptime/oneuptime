var moment = require('moment');
var MonitorService = require('../services/monitorService'),
    IncidentService = require('../services/incidentService'),
    ZapierService = require('../services/zapierService'),
    ErrorService = require('../services/errorService');

module.exports = {

    checkAllDeviceMonitor: async () => {
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

var job = async (monitor, res) => {
    try {
        if (res) {
            await MonitorService.setMonitorTime(monitor._id, res, 'online');
            var incident = await IncidentService.findBy({ monitorId: monitor._id, createdById: null, resolved: false,manuallyCreated:false });
            if (incident.length) {
                incident = await IncidentService.resolve({ incidentId: incident[0]._id }, null);
                await ZapierService.pushToZapier('incident_resolve', incident);
            }
        } else {
            await MonitorService.setMonitorTime(monitor._id, 0, 'offline');
            var incident1 = await IncidentService.findBy({ monitorId: monitor._id, createdById: null, resolved: false,manuallyCreated:false });
            if (!incident1.length) {
                incident1 = await IncidentService.createIncident({ monitorId: monitor._id, projectId: monitor.projectId }, null);
                await ZapierService.pushToZapier('incident_created', incident1);
            }
        }
    } catch (error) {
        ErrorService.log('iotCron.job', error);
        throw error;
    }
};
