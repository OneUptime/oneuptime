import JobDictionary from "./JobDictionary";
import CronLock, { CronLockTake, CronLockTakeResult } from "./CronLock";
import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import logger from "Common/Server/Utils/Logger";
import Telemetry, {
  Span,
  SpanException,
  SpanStatusCode,
} from "Common/Server/Utils/Telemetry";

/*
 * What a scheduled job runs, handed its deadline: when its time limit runs
 * out, or it lost its lock (JobDeadline, CronLock). A job that loops checks
 * deadline.hasPassed() between pages and items and stops there. RunCron
 * always hands it one; optional so a job can still be run, and typed, as a
 * function of no arguments - give it a default (JobDeadline.none()).
 */
export type CronRunFunction = (deadline?: JobDeadline) => Promise<void>;

export interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
  timeoutInMS?: number | undefined;
  queueName?: QueueName | undefined;
  /*
   * Let a run start while another run of the job is still going. Every
   * scheduled job runs one at a time by default (CronLock); set this only
   * for a job whose runs must overlap, and say why where it is set.
   */
  allowOverlap?: boolean | undefined;
}

type RunCronFunction = (
  jobName: string,
  options: CronOptions,
  runFunction: CronRunFunction,
) => void;

/*
 * The function the Worker queue runs for a scheduled job: one run at a time
 * (CronLock), each handed its deadline.
 */
export function buildCronJobFunction(data: {
  jobName: string;
  options: Pick<CronOptions, "allowOverlap">;
  runFunction: CronRunFunction;
}): (job?: QueueJob, deadline?: JobDeadline) => Promise<void> {
  return async (_job?: QueueJob, deadline?: JobDeadline): Promise<void> => {
    /*
     * The run's own deadline: it passes with the queue job's time limit, and
     * also when the run loses its lock.
     */
    const timeoutInMs: number = JobDictionary.getTimeoutInMs(data.jobName);

    const runDeadline: JobDeadline = new JobDeadline({
      parent: deadline,
      endsAt: deadline ? undefined : new Date(Date.now() + timeoutInMs),
    });

    /*
     * Run outside the queue (no queue deadline), the job still runs out of
     * time at its time limit, so its lock can never outlast it.
     */
    let ownTimeLimit: ReturnType<typeof setTimeout> | null = null;

    if (!deadline) {
      ownTimeLimit = setTimeout(() => {
        runDeadline.end(
          new TimeoutException(
            `${data.jobName} ran out of its time limit and stopped. Its next run carries on with what is left.`,
          ),
        );
      }, timeoutInMs);
      ownTimeLimit.unref?.();
    }

    try {
      if (data.options.allowOverlap) {
        await data.runFunction(runDeadline);
        return;
      }

      const lock: CronLockTake = await CronLock.take({
        jobName: data.jobName,
        deadline: runDeadline,
      });

      if (lock.result === CronLockTakeResult.HeldByAnotherRun) {
        logger.debug(
          `${data.jobName}: skipping this run, the previous run is still going.`,
          { service: "workers" },
        );
        return;
      }

      try {
        await data.runFunction(runDeadline);
      } finally {
        await lock.release();
      }
    } finally {
      if (ownTimeLimit) {
        clearTimeout(ownTimeLimit);
      }
    }
  };
}

const RunCron: RunCronFunction = (
  jobName: string,
  options: CronOptions,
  runFunction: CronRunFunction,
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
        // Set the timeout if provided
        if (options.timeoutInMS) {
          JobDictionary.setTimeoutInMs(jobName, options.timeoutInMS);
        }

        // Set the job function in JobDictionary
        JobDictionary.setJobFunction(
          jobName,
          buildCronJobFunction({
            jobName: jobName,
            options: options,
            runFunction: runFunction,
          }),
        );

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

        // Run the job immediately on startup if specified
        if (options.runOnStartup) {
          Queue.addJob(queueName, jobName, jobName, {}, {}).catch(
            (err: Error) => {
              return logger.error(err, { service: "workers" });
            },
          );
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
