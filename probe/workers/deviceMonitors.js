const moment = require('moment');
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
// it collects all IOT device monitors then check the last time they where pinged
// If the difference is greater than 2 minutes
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    ping: async (monitor) => {
        var newDate = new moment();
        var resDate = new Date();
        if (monitor && monitor.type) {
            var d = new moment(monitor.lastPingTime);

            if (newDate.diff(d, 'minutes') > 3) {
                try {
                    var time = await ApiService.getMonitorTime(monitor._id, newDate);
                } catch (error) {
                    ErrorService.log('ApiService.getMonitorTime', error);
                    throw error;
                }
                if (time.status === 'online') {
                    try {
                        await pingService(monitor);
                    } catch (error) {
                        ErrorService.log('ping.pingService', error);
                        throw error;
                    }
                }
            } else {
                var res = (new Date()).getTime() - resDate.getTime();
                try {
                    var newTime = await ApiService.getMonitorTime(monitor._id, newDate);
                } catch (error) {
                    ErrorService.log('ApiService.getMonitorTime', error);
                    throw error;
                }
                if (newTime.status === 'offline') {
                    try {
                        await pingService(monitor, res);
                    } catch (error) {
                        ErrorService.log('ping.pingService', error);
                        throw error;
                    }
                }
            }
        } else {
            return;
        }
    }
};

var pingService = async (monitor, res) => {
    if (res) {
        try {
            await ApiService.setMonitorTime(monitor._id, res, null, 'online');
        } catch (error) {
            ErrorService.log('ApiService.setMonitorTime', error);
            throw error;
        }
    } else {
        try {
            await ApiService.setMonitorTime(monitor._id, 0, null, 'offline');
        } catch (error) {
            ErrorService.log('ApiService.setMonitorTime', error);
            throw error;
        }
    }
};
