const moment = require('moment');
const MonitorService = require('../services/monitorService'),
    IncidentService = require('../services/incidentService'),
    ZapierService = require('../services/zapierService'),
    ErrorService = require('../services/errorService');

module.exports = {
    checkAllDeviceMonitor: async () => {
        try {
            const newDate = new moment();
            const resDate = new Date();
            const monitors = await MonitorService.getDeviceMonitorsPing();
            if (monitors) {
                monitors.forEach(async monitor => {
                    const d = new moment(monitor.lastPingTime);

                    if (newDate.diff(d, 'minutes') > 3) {
                        await job(monitor);
                    } else {
                        const res = new Date().getTime() - resDate.getTime();
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
    },
};

const job = async (monitor, res) => {
    try {
        if (res) {
            await MonitorService.setMonitorTime(monitor._id, res, 'online');
            let incident = await IncidentService.findBy({
                monitorId: monitor._id,
                createdById: null,
                resolved: false,
                manuallyCreated: false,
            });
            if (incident.length) {
                incident = await IncidentService.resolve(
                    { incidentId: incident[0]._id },
                    null
                );
                await ZapierService.pushToZapier('incident_resolve', incident);
            }
        } else {
            await MonitorService.setMonitorTime(monitor._id, 0, 'offline');
            let incident1 = await IncidentService.findBy({
                monitorId: monitor._id,
                createdById: null,
                resolved: false,
                manuallyCreated: false,
            });
            if (!incident1.length) {
                incident1 = await IncidentService.createIncident(
                    { monitorId: monitor._id, projectId: monitor.projectId },
                    null
                );
                await ZapierService.pushToZapier('incident_created', incident1);
            }
        }
    } catch (error) {
        ErrorService.log('iotCron.job', error);
        throw error;
    }
};
