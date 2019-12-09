var MonitorService = require('../services/monitorService'),
    IncidentService = require('../services/incidentService');


// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    manualPingCron: async () => {
        var date = new Date(new Date().getTime() - (60 * 1000));
        var monitors = await MonitorService.getManualMonitorsPing(date);
        if (monitors) {
            monitors.forEach((monitor) => {
                IncidentService.findBy({ monitorId: monitor._id, resolved: false })
                    .then(incidents => {
                        if (incidents && incidents.length) {
                            MonitorService.setMonitorTime(monitor._id, 0, 'offline');
                        }
                        else {
                            MonitorService.setMonitorTime(monitor._id, 0, 'online');
                        }
                    });
            });
        } else {
            return;
        }
    }
};
