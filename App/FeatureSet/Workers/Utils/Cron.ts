import JobDictionary from './JobDictionary';
import Queue, { QueueName } from 'CommonServer/Infrastructure/Queue';
import logger from 'CommonServer/Utils/Logger';

const RunCron: (
    jobName: string,
    options: {
        schedule: string;
        runOnStartup: boolean;
    },
    runFunction: Function
) => void = (
    jobName: string,
    options: {
        schedule: string;
        runOnStartup: boolean;
    },
    runFunction: Function
): void => {
    JobDictionary.setJobFunction(jobName, runFunction);

    logger.info('Adding job to the queue: ' + jobName);

    Queue.addJob(
        QueueName.Worker,
        jobName,
        jobName,
        {},
        {
            scheduleAt: options.schedule,
        }
    ).catch((err: Error) => {
        return logger.error(err);
    });

    if (options.runOnStartup) {
        Queue.addJob(QueueName.Worker, jobName, jobName, {}).catch(
            (err: Error) => {
                return logger.error(err);
            }
        );
    }
};

export default RunCron;
