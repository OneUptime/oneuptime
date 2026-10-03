import JobDictionary from "./JobDictionary";
import { randomUUID } from "crypto";
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
    queueName?: QueueName | undefined;
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
    queueName?: QueueName | undefined;
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

        logger.debug("Adding job to the queue: " + jobName, {
          service: "workers",
        });

        const queueName: QueueName = options.queueName || QueueName.Worker;

        // Add the job to the queue with the specified schedule
        Queue.addJob(
          queueName,
          jobName,
          jobName,
          {},
          {
            scheduleAt: options.schedule,
          },
        ).catch((err: Error) => {
          return logger.error(err, { service: "workers" });
        });

        /*
         * Each startup request needs a fresh ID: completed/failed jobs may
         * still be retained, and the best-effort startup sweep can race this
         * add. Coalesce concurrent startup requests while one is unfinished
         * using a separate simple-mode deduplication key, released by BullMQ
         * on completion/failure. Do not request another run while active.
         * This does not coalesce with scheduled iterations or legacy startup
         * jobs already queued before this identity scheme was introduced.
         */
        if (options.runOnStartup) {
          Queue.addJob(
            queueName,
            `startup-${jobName}-${randomUUID()}`,
            jobName,
            {},
            { deduplication: { id: `startup-${jobName}` } },
          ).catch((err: Error) => {
            return logger.error(err, { service: "workers" });
          });
        }
      } catch (err) {
        // log this error
        logger.error(err, { service: "workers" });

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
