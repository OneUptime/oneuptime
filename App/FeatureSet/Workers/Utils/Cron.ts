import JobDictionary from "./JobDictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";

type RunCronFunction = (
  jobName: string,
  options: {
    schedule: string;
    runOnStartup: boolean;
  },
  runFunction: PromiseVoidFunction,
) => void;

const RunCron: RunCronFunction = (
  jobName: string,
  options: {
    schedule: string;
    runOnStartup: boolean;
  },
  runFunction: PromiseVoidFunction,
): void => {
  JobDictionary.setJobFunction(jobName, runFunction);

  logger.debug("Adding job to the queue: " + jobName);

  Queue.addJob(
    QueueName.Worker,
    jobName,
    jobName,
    {},
    {
      scheduleAt: options.schedule,
    },
  ).catch((err: Error) => {
    return logger.error(err);
  });

  if (options.runOnStartup) {
    Queue.addJob(QueueName.Worker, jobName, jobName, {}).catch((err: Error) => {
      return logger.error(err);
    });
  }
};

export default RunCron;
