import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";

/*
 * ONE RUN OF A SCHEDULED JOB AT A TIME.
 *
 * BullMQ queues a cron's next run as soon as one starts, whatever it is
 * still doing, and the worker takes up to WORKER_CONCURRENCY jobs at once.
 * On a slow database an every-minute job that takes longer than a minute
 * used to start a second copy beside the first, then a third: each holding
 * database connections, each slowing the others, the queue growing behind
 * them. So every run of a cron takes a lock named after the job (RunCron),
 * and a run that finds it held skips: the run already going does the work,
 * and the next tick finds whatever it left.
 *
 * The lock can never strand the job:
 *
 *   - It is a lease of LEASE_MS, kept every KEEP_EVERY_MS while its run
 *     goes on. A worker that dies mid-run (an OOM kill, a node lost) stops
 *     keeping it, and it lapses within LEASE_MS.
 *   - It is kept only until GRACE_MS after the run's time limit. The run's
 *     deadline passes at the limit and its loops stop at their next check
 *     (JobDeadline); a run whose work goes on anyway - one that checks no
 *     deadline, a query that never returns - gives the lock back GRACE_MS
 *     after the limit all the same.
 *   - A run that finds its lease gone (Valkey restarted, the process stood
 *     still past LEASE_MS) has its deadline ended: another run may hold the
 *     lock now, so this one stops at its next check.
 *
 * Valkey that cannot be reached when the run starts leaves it without a
 * lock rather than without a run: the queue that delivered the run reached
 * Valkey a moment before, and a missed run of an on-call or a heartbeat job
 * costs more than a rare overlapping one.
 */

export const CRON_LOCK_NAMESPACE: string = "cron-run";

// How long a lease lasts each time it is taken or kept.
export const CRON_LOCK_LEASE_MS: number = 60 * 1000;

// How often a run keeps its lease: three tries inside one lease.
export const CRON_LOCK_KEEP_EVERY_MS: number = 15 * 1000;

/*
 * How long past its time limit a run keeps the lock, for the work in flight
 * when its deadline passed - the page being written - to finish.
 */
export const CRON_LOCK_GRACE_MS: number = 30 * 1000;

export enum CronLockTakeResult {
  // This run holds the lock.
  Taken = "Taken",
  // Another run holds it: this one skips.
  HeldByAnotherRun = "HeldByAnotherRun",
  // Valkey could not be reached: this run goes on without a lock.
  Unavailable = "Unavailable",
}

export interface CronLockTake {
  result: CronLockTakeResult;
  // Gives the lock back. Never throws; does nothing without a lock.
  release: () => Promise<void>;
}

export default class CronLock {
  /*
   * Takes the lock of `jobName` for one run whose deadline is `deadline`.
   * The run's deadline is ended if its lease is lost.
   */
  public static async take(data: {
    jobName: string;
    deadline: JobDeadline;
  }): Promise<CronLockTake> {
    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        key: data.jobName,
        namespace: CRON_LOCK_NAMESPACE,
        lockTimeout: CRON_LOCK_LEASE_MS,
        // One try: a run that finds the lock held skips, it never queues.
        acquireAttemptsLimit: 1,
        retryInterval: 1,
        /*
         * Kept by this class, not by redis-semaphore's timer, which would
         * keep it for as long as the process lives - however long the run's
         * work hangs.
         */
        refreshInterval: 0,
      });
    } catch (err) {
      if (err instanceof SemaphoreLockTimeoutError) {
        return { result: CronLockTakeResult.HeldByAnotherRun, release: noop };
      }

      logger.error(
        `${data.jobName}: could not take the lock that keeps two runs of a scheduled job apart; running without it.`,
      );
      logger.error(err);

      return { result: CronLockTakeResult.Unavailable, release: noop };
    }

    return {
      result: CronLockTakeResult.Taken,
      release: CronLock.hold({
        jobName: data.jobName,
        mutex: mutex,
        deadline: data.deadline,
      }),
    };
  }

  /*
   * Keeps a taken lock for its run (see the class comment), and returns the
   * function that gives it back.
   */
  private static hold(data: {
    jobName: string;
    mutex: SemaphoreMutex;
    deadline: JobDeadline;
  }): () => Promise<void> {
    let isReleased: boolean = false;
    let isKeeping: boolean = false;
    let keepTimer: ReturnType<typeof setInterval> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let stopListening: (() => void) | null = null;

    const stopKeeping: () => void = (): void => {
      if (keepTimer) {
        clearInterval(keepTimer);
        keepTimer = null;
      }

      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = null;
      }

      stopListening?.();
      stopListening = null;
    };

    const release: () => Promise<void> = async (): Promise<void> => {
      if (isReleased) {
        return;
      }

      isReleased = true;
      stopKeeping();

      try {
        await Semaphore.release(data.mutex);
      } catch (err) {
        // It lapses within a lease anyway.
        logger.error(`${data.jobName}: could not give back the run's lock.`);
        logger.error(err);
      }
    };

    const keep: () => Promise<void> = async (): Promise<void> => {
      if (isReleased || isKeeping) {
        return;
      }

      isKeeping = true;

      try {
        const isKept: boolean = await Semaphore.keepLock(data.mutex);

        if (!isKept && !isReleased) {
          stopKeeping();

          logger.warn(
            `${data.jobName}: the run's lock lapsed before it finished; stopping the run, as another may have started.`,
          );

          data.deadline.end(
            new Error(
              `${data.jobName} stopped: its lock lapsed, so another run may have started.`,
            ),
          );
        }
      } catch (err) {
        // Valkey could not be reached: nobody else can take the lock either.
        logger.error(`${data.jobName}: could not keep the run's lock.`);
        logger.error(err);
      } finally {
        isKeeping = false;
      }
    };

    keepTimer = setInterval(() => {
      void keep();
    }, CRON_LOCK_KEEP_EVERY_MS);
    keepTimer.unref?.();

    stopListening = data.deadline.onPassed(() => {
      if (isReleased || graceTimer) {
        return;
      }

      graceTimer = setTimeout(() => {
        void release();
      }, CRON_LOCK_GRACE_MS);
      graceTimer.unref?.();
    });

    return release;
  }
}

const noop: () => Promise<void> = async (): Promise<void> => {
  // No lock was taken: nothing to give back.
};
