import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import OneUptimeDate from 'Common/Types/Date';
import MonitorMetricsByMinuteService from 'CommonServer/Services/MonitorMetricsByMinuteService';
import LessThan from 'Common/Types/BaseDatabase/LessThan';

RunCron(
    'MonitorMetrics:HardDeleteMonitorMetricsByMinute',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const oneHourAgo: Date = OneUptimeDate.getSomeMinutesAgo(60);

        // Delete all monitor metrics older than one hour

        await MonitorMetricsByMinuteService.deleteBy({
            query: {
                createdAt: new LessThan(oneHourAgo)
            },
            props: {
                isRoot: true,
            }
        });
    }
);