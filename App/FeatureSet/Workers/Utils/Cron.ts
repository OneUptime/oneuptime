import JobDictionary from "./JobDictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";
import Telemetry, {
  Span,
  SpanException,
  SpanStatusCode,
} from "Common/Server/Utils/Telemetry";

// Define the function type RunCronFunction
type RunCronFunction = (
  jobName: string,
  options: {
    schedule: string;
    runOnStartup: boolean;
    timeoutInMS?: number | undefined;
  },
  runFunction: PromiseVoidFunction,
) => void;

// Implement the RunCron function
const RunCron: RunCronFunction = (
  jobName: string,
  options: {
    schedule: string;
    runOnStartup: boolean;
    timeoutInMS?: number | undefined;
  },
  runFunction: PromiseVoidFunction,
): void => {
  // Start a telemetry span for the RunCron operation
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
        // Set the job function in JobDictionary
        JobDictionary.setJobFunction(jobName, runFunction);

        // Set the timeout if provided
        if (options.timeoutInMS) {
          JobDictionary.setTimeoutInMs(jobName, options.timeoutInMS);
        }

        logger.debug("Adding job to the queue: " + jobName);

        // Add the job to the queue with the specified schedule
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

        // Run the job immediately on startup if specified
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
