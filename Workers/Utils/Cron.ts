import logger from 'CommonServer/Utils/Logger';
import cron from 'node-cron';

const RunCron: Function = (
    jobName: string,
    schedule: string,
    runFunction: Function
): void => {
    cron.schedule(schedule, async () => {
        try {
            logger.info(`Job ${jobName} Start`);
            await runFunction();
            logger.info(`Job ${jobName} End`);
        } catch (e) {
            logger.info(`Job ${jobName} Error`);
            logger.error(e);
        }
    });
};

export default RunCron;
