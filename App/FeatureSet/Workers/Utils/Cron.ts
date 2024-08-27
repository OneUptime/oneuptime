import JobDictionary from "./JobDictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";
import Telemetry, {
  Span,
  SpanException,
  SpanStatusCode,
} from "Common/Server/Utils/Telemetry";

type RunCronFunction = (
  jobName: string,
  options: {
    schedule: string;
    runOnStartup: boolean;
    timeoutInMS?: number | undefined;
  },
  runFunction: PromiseVoidFunction,
) => void;

const RunCron: RunCronFunction = (
  jobName: string,
  options: {
    schedule: string;
    runOnStartup: boolean;
    timeoutInMS?: number | undefined;
  },
  runFunction: PromiseVoidFunction,
): void => {
  return Telemetry.startActiveSpan<void>({
    name: "RunCron",
    options: {
      attributes: {
        jobName: jobName,
        "options.schedule": options.schedule,
        "options.runOnStartup": options.runOnStartup,
      },
    },
    fn: (span: Span): void => {
      try {
        JobDictionary.setJobFunction(jobName, runFunction);

        if (options.timeoutInMS) {
          JobDictionary.setTimeoutInMs(jobName, options.timeoutInMS);
        }

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
          Queue.addJob(QueueName.Worker, jobName, jobName, {}, {}).catch(
            (err: Error) => {
              return logger.error(err);
            },
          );
        }
      } catch (err) {
        // log this error
        logger.error(err);

        // record exception
        span.recordException(err as SpanException);

        // set span status
        span.setStatus({
          code: SpanStatusCode.ERROR,
        });
      } finally {
        span.end();
      }
    },
  });
};

export default RunCron;
