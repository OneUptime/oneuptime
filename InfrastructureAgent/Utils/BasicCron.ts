import logger from './Logger';
import cron from 'node-cron';

type BasicCronProps = {
    jobName: string;
    options: {
        schedule: string;
        runOnStartup: boolean;
    };
    runFunction: () => Promise<void>;
};

type BasicCronFunction = (props: BasicCronProps) => void;

const BasicCron: BasicCronFunction = async (
    props: BasicCronProps
): Promise<void> => {
    const { jobName, options, runFunction } = props;

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

    if (options.runOnStartup) {
        logger.info(`Job ${jobName} - Start on Startup`);
        await runFunction();
    }
};

export default BasicCron;
