import logger from 'CommonServer/Utils/Logger';
import cron from 'node-cron';

const RunCron: Function = (
    jobName: string,
    options: {
        schedule: string;
        runOnStartup: boolean;
    },
    runFunction: Function
): void => {
    
    cron.schedule(options.schedule, async () => {
        try {
            logger.info(`Job ${jobName} Start`);
            await runFunction();
            logger.info(`Job ${jobName} End`);
        } catch (e) {
            logger.info(`Job ${jobName} Error`);
            logger.error(e);
        }
    });

    if(options.runOnStartup) {
        runFunction();
    }
};

export default RunCron;
