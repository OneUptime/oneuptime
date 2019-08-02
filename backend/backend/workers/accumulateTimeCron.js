var MonitorService = require('../services/monitorService'),
    statusPageService = require('../services/statusPageService'),
    ErrorService = require('../services/errorService');

//accumulates all values of times pinged by every minute cron
// Then stores them as total uptime for whole past day
module.exports = {
    accumulateTime: async (yesterday) => {
        try{
            var monitors = await MonitorService.getAllMonitorsAccumulate(yesterday);
        }catch(error){
            ErrorService.log('MonitorService.getAllMonitorsAccumulate', error);
            throw error;
        }
        if (monitors) {
            monitors.forEach(async (monitor) => {
                try{
                    var data = await statusPageService.calcTime(monitor._id, yesterday);
                }catch(error){
                    ErrorService.log('statusPageService.calcTime', error);
                    throw error;
                }    
                try{
                    var monitor_id = await statusPageService.recordTime(data.uptime, data.downtime, data.monitorId, data.status,yesterday);
                }catch(error){
                    ErrorService.log('statusPageService.recordTime', error);
                    throw error;
                }    
                try{
                    await MonitorService.deleteTime(monitor_id, yesterday);
                }catch(error){
                    ErrorService.log('MonitorService.deleteTime', error);
                    throw error;
                }    
            });
        }
        else { return; }
    }
};