const moment = require('moment');
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
// it collects all IOT device monitors then check the last time they where pinged
// If the difference is greater than 2 minutes
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    ping: async monitor => {
        try {
            const newDate = new moment();
            const resDate = new Date();
            if (monitor && monitor.type) {
                const d = new moment(monitor.lastPingTime);

                if (newDate.diff(d, 'minutes') > 3) {
                    const time = await ApiService.getMonitorTime(
                        monitor._id,
                        newDate
                    );

                    if (time.status === 'online') {
                        await ApiService.ping(monitor._id, {
                            monitor,
                            type: monitor.type,
                        });
                    }
                } else {
                    const res = new Date().getTime() - resDate.getTime();

                    const newTime = await ApiService.getMonitorTime(
                        monitor._id,
                        newDate
                    );

                    if (newTime.status === 'offline') {
                        await ApiService.ping(monitor._id, {
                            monitor,
                            res,
                            type: monitor.type,
                        });
                    }
                }
            }
        } catch (error) {
            ErrorService.log('ApiService.ping', error);
            throw error;
        }
    },
};
