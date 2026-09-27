import OneUptimeDate from "../../../Types/Date";
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
 */
export default class SubscriberNotificationRunLimit {
  public static readonly MAX_CONCURRENT_RUNS_PER_JOB: number = 4;

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
