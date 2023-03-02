import JobDictonary from './JobDictionary';
import Queue, { QueueName } from 'CommonServer/Infrastructure/Queue';

const RunCron: Function = (
    jobName: string,
    options: { 
        schedule: string, 
        runOnStartup: boolean 
    },
    runFunction: Function
): void => {

    JobDictonary.setJobFunction(jobName, runFunction);

    Queue.addJob(QueueName.Worker, jobName, jobName, {}, {
        scheduleAt: options.schedule, 
    });
    
    if(options.runOnStartup){
        Queue.addJob(QueueName.Worker, jobName, jobName, {});
    }
};

export default RunCron;
