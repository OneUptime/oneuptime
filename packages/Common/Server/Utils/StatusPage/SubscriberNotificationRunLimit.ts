import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphorePermit,
} from "../../Infrastructure/Semaphore";
import logger from "../Logger";

/*
 * How many runs of one subscriber job may be sending at once, across every
 * worker.
 *
 * The incident and episode subscriber jobs run every minute on the shared
 * Worker queue, and each run awaits the notifications it claims - minutes,
 * for a big or slow send (SubscriberNotificationTiming). The runs overlap by
 * design, and nothing bounded how many: with a backlog of slow sends - a
 * tenant whose mail server answers slowly, a large outage with many notes and
 * state changes on big pages - every job could keep a run going every minute
 * for the length of its timeout, some 25-30 runs per job, nine jobs, all
 * holding slots of the one Worker consumer (WORKER_CONCURRENCY, 100 by
 * default) that on-call escalation, monitors and every other cron share.
 * Exactly during an outage, subscriber email could starve paging.
 *
 * So a run takes a permit first: at most MAX_CONCURRENT_RUNS_PER_JOB runs of
 * a job hold one at a time, nine jobs times that in all. A run that finds
 * them all taken returns at once, leaving its notifications Pending for the
 * runs that follow; a run's claim is atomic (SubscriberNotificationClaim), so
 * which run sends a notification never matters. A permit is refreshed while
 * its run lives and lapses PERMIT_TTL_IN_MS after a worker dies holding it,
 * so a crash frees its slot within minutes, not at the job timeout.
 *
 * If Redis cannot be reached for the permit, the run goes ahead without one:
 * the queue that started it runs on Redis too, so that is a blip, and sending
 * the notifications matters more than bounding them for its length.
 *
 * One project cannot take them all. The permits are shared by every project
 * on the server, and a run sends one notification at a time, so a tenant
 * whose own mail server hangs - each message waiting out its timeout - or who
 * posts a burst of notes on a large page would otherwise hold every run of
 * the job, and every other tenant's notifications of that kind would wait
 * behind it. So a run also takes one of the project's slots for the job
 * before it claims each notification (takeProjectSlot): at most
 * MAX_CONCURRENT_SENDS_PER_PROJECT of one project's notifications of a job
 * are being sent at once, and a run that finds the project's slots taken
 * leaves that notification Pending and goes on to the next project's.
 *
 * Both numbers can be raised for a larger fleet:
 * SUBSCRIBER_NOTIFICATION_MAX_CONCURRENT_RUNS_PER_JOB and
 * SUBSCRIBER_NOTIFICATION_MAX_CONCURRENT_SENDS_PER_PROJECT.
 */

// A slot one project holds while one of its notifications is being sent.
export interface SubscriberNotificationProjectSlot {
  release: () => Promise<void>;
}

const parsePositiveIntFromEnv: (envKey: string, fallback: number) => number = (
  envKey: string,
  fallback: number,
): number => {
  const rawValue: string | undefined = process.env[envKey];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue: number = parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
};

// Held when there is nothing to bound: no project, or no Redis.
const NO_SLOT: SubscriberNotificationProjectSlot = {
  release: async (): Promise<void> => {},
};

export default class SubscriberNotificationRunLimit {
  public static readonly MAX_CONCURRENT_RUNS_PER_JOB: number =
    parsePositiveIntFromEnv(
      "SUBSCRIBER_NOTIFICATION_MAX_CONCURRENT_RUNS_PER_JOB",
      4,
    );

  /*
   * Fewer than the runs of a job, so a project whose sends are slow always
   * leaves some of them to everyone else.
   */
  public static readonly MAX_CONCURRENT_SENDS_PER_PROJECT: number = Math.max(
    1,
    Math.min(
      parsePositiveIntFromEnv(
        "SUBSCRIBER_NOTIFICATION_MAX_CONCURRENT_SENDS_PER_PROJECT",
        2,
      ),
      SubscriberNotificationRunLimit.MAX_CONCURRENT_RUNS_PER_JOB - 1,
    ),
  );

  // The per-project slots' Redis namespace; the key is the job and the project.
  public static readonly PROJECT_NAMESPACE: string =
    "subscriber-notification-project";

  public static readonly PERMIT_TTL_IN_MS: number =
    OneUptimeDate.convertMinutesToMilliseconds(2);

  // The permits' Redis namespace; the key is the job's name.
  public static readonly NAMESPACE: string = "subscriber-notification-run";

  /*
   * The job's run, run only while it holds one of the job's permits. For
   * RunCron: RunCron("Job:Name", options, limit("Job:Name", async () => {})).
   */
  public static limit(
    jobName: string,
    run: () => Promise<void>,
  ): () => Promise<void> {
    return async (): Promise<void> => {
      await SubscriberNotificationRunLimit.runWithinLimit(jobName, run);
    };
  }

  /*
   * One of the project's slots for this job, taken before a run claims one
   * of the project's notifications; release it once that notification has
   * settled. Null when the project already has
   * MAX_CONCURRENT_SENDS_PER_PROJECT of this job's notifications being sent:
   * leave this one Pending for a later run, and go on to the next. Never
   * throws: without a project, or without Redis, the send goes ahead
   * unbounded, as a run does without its permit.
   */
  public static async takeProjectSlot(data: {
    jobName: string;
    projectId: ObjectID | string | undefined | null;
  }): Promise<SubscriberNotificationProjectSlot | null> {
    const projectId: string = data.projectId?.toString().trim() || "";

    if (!projectId) {
      return NO_SLOT;
    }

    let permit: SemaphorePermit;

    try {
      permit = await Semaphore.acquirePermit({
        key: `${data.jobName}:${projectId.toLowerCase()}`,
        namespace: SubscriberNotificationRunLimit.PROJECT_NAMESPACE,
        limit: SubscriberNotificationRunLimit.MAX_CONCURRENT_SENDS_PER_PROJECT,
        lockTimeout: SubscriberNotificationRunLimit.PERMIT_TTL_IN_MS,
        acquireAttemptsLimit: 1,
        acquireTimeout: 5000,
        retryInterval: 50,
        onLockLost: (err: Error): void => {
          logger.warn(
            `${data.jobName}: lost the slot of project ${projectId} while sending: ${err.message}`,
          );
        },
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        logger.debug(
          `${data.jobName}: project ${projectId} already has ${SubscriberNotificationRunLimit.MAX_CONCURRENT_SENDS_PER_PROJECT} notification(s) being sent; leaving this one Pending.`,
        );
        return null;
      }

      logger.warn(
        `${data.jobName}: could not take a slot for project ${projectId} (${err instanceof Error ? err.message : String(err)}); sending without one.`,
      );
      return NO_SLOT;
    }

    return {
      release: async (): Promise<void> => {
        try {
          await Semaphore.releasePermit(permit);
        } catch (err) {
          // It lapses on its own after PERMIT_TTL_IN_MS.
          logger.warn(
            `${data.jobName}: could not release the slot of project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    };
  }

  public static async runWithinLimit(
    jobName: string,
    run: () => Promise<void>,
  ): Promise<void> {
    let permit: SemaphorePermit | null = null;

    try {
      permit = await Semaphore.acquirePermit({
        key: jobName,
        namespace: SubscriberNotificationRunLimit.NAMESPACE,
        limit: SubscriberNotificationRunLimit.MAX_CONCURRENT_RUNS_PER_JOB,
        lockTimeout: SubscriberNotificationRunLimit.PERMIT_TTL_IN_MS,
        // One look: a full set of permits means other runs are sending.
        acquireAttemptsLimit: 1,
        acquireTimeout: 5000,
        retryInterval: 50,
        onLockLost: (err: Error): void => {
          /*
           * Redis lost the permit (it could not be refreshed). The run goes
           * on - its claims keep its notifications its own - and another
           * run may take the freed slot meanwhile.
           */
          logger.warn(
            `${jobName}: lost its run permit while sending: ${err.message}`,
          );
        },
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        logger.debug(
          `${jobName}: ${SubscriberNotificationRunLimit.MAX_CONCURRENT_RUNS_PER_JOB} runs are already sending; leaving the Pending notifications to the runs that follow.`,
        );
        return;
      }

      logger.warn(
        `${jobName}: could not take a run permit (${err instanceof Error ? err.message : String(err)}); running without one.`,
      );
      permit = null;
    }

    try {
      await run();
    } finally {
      if (permit) {
        try {
          await Semaphore.releasePermit(permit);
        } catch (err) {
          // It lapses on its own after PERMIT_TTL_IN_MS.
          logger.warn(
            `${jobName}: could not release its run permit: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
}
