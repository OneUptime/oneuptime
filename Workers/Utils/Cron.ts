import JobDictonary from './JobDictionary';
import Queue, { QueueName } from 'CommonServer/Infrastructure/Queue';
import logger from 'CommonServer/Utils/Logger';

const RunCron: Function = (
    jobName: string,
    options: {
        schedule: string;
        runOnStartup: boolean;
    },
    runFunction: Function
): void => {
    JobDictonary.setJobFunction(jobName, runFunction);

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
