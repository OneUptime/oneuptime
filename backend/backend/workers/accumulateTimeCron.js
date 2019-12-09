var MonitorService = require('../services/monitorService'),
    statusPageService = require('../services/statusPageService'),
    ErrorService = require('../services/errorService');

//accumulates all values of times pinged by every minute cron
// Then stores them as total uptime for whole past day
module.exports = {
    accumulateTime: async (yesterday) => {
        try {
            var monitors = await MonitorService.getAllMonitorsAccumulate(yesterday);
            if (monitors) {
                monitors.forEach(async (monitor) => {
                    var data = await statusPageService.calcTime(monitor._id, yesterday);
                    var monitor_id = await statusPageService.recordTime(data.uptime, data.downtime, data.monitorId, data.status,yesterday);
                    await MonitorService.deleteTime(monitor_id, yesterday);
                });
            }
            else { return; }
        } catch (error) {
            ErrorService.log('accumulateTimeCron.accumulateTime', error);
            throw error;
        }
    }
};
