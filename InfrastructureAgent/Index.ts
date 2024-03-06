import BasicCron from 'CommonServer/Utils/BasicCron';
import { BasicMetircs } from './Utils/BasicMetrics';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';

BasicCron({
    jobName: 'MonitorInfrastructure',
    options: {
        schedule: EVERY_MINUTE, // Every minute
        runOnStartup: true,
    },
    runFunction: async () => {
        console.log(await BasicMetircs.getBasicMetrics({
            diskPaths: ['/'],
        }));
    }
})