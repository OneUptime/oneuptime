import moment from 'moment';
import ApiService from '../Utils/apiService';

// it collects all IOT device monitors then check the last time they where pinged
// If the difference is greater than 2 minutes
// creates incident if a website is down and resolves it when they come back up
export default {
    ping: async (monitor: $TSFixMe) => {
        const newDate: $TSFixMe = new moment();
        const resDate: $TSFixMe = new Date();
        if (monitor && monitor.type) {
            const d: $TSFixMe = new moment(monitor.lastPingTime);

            if (newDate.diff(d, 'minutes') > 3) {
                const time: $TSFixMe = await ApiService.getMonitorTime(
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
                const res: $TSFixMe = new Date().getTime() - resDate.getTime();

                const newTime: $TSFixMe = await ApiService.getMonitorTime(
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
    },
};
