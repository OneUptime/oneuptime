import moment from 'moment';
const MonitorService: $TSFixMe = require('../Services/monitorService'),
    MonitorLogService: $TSFixMe = require('../Services/monitorLogService'),
    MonitorStatusService: $TSFixMe = require('../Services/monitorStatusService'),
    ProbeService: $TSFixMe = require('../Services/probeService');

export default {
    checkAllServerMonitors: async () => {
        const newDate: $TSFixMe = new moment();
        const monitors: $TSFixMe = await MonitorService.findBy({
            query: { type: 'server-monitor' },
            select: 'lastPingTime _id criteria',
        });

        if (monitors) {
            monitors.forEach(async (monitor: $TSFixMe) => {
                const d: $TSFixMe = new moment(monitor.lastPingTime);
                const log: $TSFixMe = await MonitorLogService.findOneBy({
                    query: { monitorId: monitor._id },
                    select: '_id',
                });
                const monitorStatus: $TSFixMe =
                    await MonitorStatusService.findOneBy({
                        query: { monitorId: monitor._id },
                        select: 'status',
                    });

                if (
                    newDate.diff(d, 'minutes') > 3 &&
                    (!log ||
                        (monitorStatus && monitorStatus.status !== 'offline'))
                ) {
                    await job(monitor);
                }
            });
        } else {
            return;
        }
    },
};

const job: Function = async (monitor: $TSFixMe): void => {
    const { stat: validUp, successReasons } =
        monitor && monitor.criteria && monitor.criteria.up
            ? ProbeService.conditions(monitor.type, monitor.criteria.up)
            : { stat: false, successReasons: [] };
    const { stat: validDown } =
        monitor && monitor.criteria && monitor.criteria.down
            ? ProbeService.conditions(monitor.type, monitor.criteria.down)
            : { stat: false };
    if (!validUp || validDown) {
        await ProbeService.saveMonitorLog({
            monitorId: monitor._id,
            status: 'offline',
            reason: await successReasons.filter(
                (item: $TSFixMe, pos: $TSFixMe, self: $TSFixMe) => {
                    return self.indexOf(item) === pos;
                }
            ),
        });
    }
};
