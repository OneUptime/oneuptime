import CronLock, { CronLockTake, CronLockTakeResult } from "./CronLock";
import JobDeadline from "Common/Server/Utils/JobDeadline";

/*
 * WORK THAT MUST NOT RUN BESIDE A SESSION REPLAY ERASURE.
 *
 * Rum:ProcessSessionErasureRequests tombstones a subject's sessions and
 * queues ALTER ... DELETE mutations, which rewrite only the parts that exist
 * when they are queued. Anything else that writes rows derived from the
 * recordings - the product analytics backfill of issue #6624 - must not
 * write them while a run of that job is going: a part written after the
 * job queued its deletes, from sessions read before those deletes landed,
 * would bring an erased session back.
 *
 * So such work holds the erasure job's own run lock (CronLock, the lock
 * named after the job, which every run of it takes). While it is held,
 * the job's runs skip, and the next one after it carries on. The job's
 * name lives here, not in its module, because importing a job module
 * registers its cron - in a migration process, the wrong one.
 *
 * Fail closed: without Valkey there is no lock to hold, and the work does
 * not run.
 */

export const SESSION_REPLAY_ERASURE_JOB_NAME: string =
  "Rum:ProcessSessionErasureRequests";

// How often a holder that found the job running tries again.
export const SESSION_REPLAY_ERASURE_LOCK_RETRY_MS: number = 5000;

export class SessionReplayErasureLockError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SessionReplayErasureLockError";
  }
}

/*
 * Runs `work` while the erasure job's run lock is held, waiting up to
 * `waitMs` for a run that holds it to finish. Throws, without running
 * `work`, when the lock cannot be taken in time or at all; throws after
 * `work` when the lock was lost while it ran (Valkey restarted), so the
 * caller does not count that work as done.
 */
export async function withSessionReplayErasureLock<T>(data: {
  // Who holds it, for the errors.
  holder: string;
  waitMs: number;
  work: () => Promise<T>;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}): Promise<T> {
  const sleep: (ms: number) => Promise<void> =
    data.sleep ||
    ((ms: number): Promise<void> => {
      return new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, ms);
      });
    });

  const giveUpAt: number = Date.now() + data.waitMs;

  for (;;) {
    /*
     * No time limit of its own: the lock is kept until the work is done and
     * given back, and lapses within a lease if this process dies.
     */
    const deadline: JobDeadline = new JobDeadline();

    const lock: CronLockTake = await CronLock.take({
      jobName: SESSION_REPLAY_ERASURE_JOB_NAME,
      deadline: deadline,
    });

    if (lock.result === CronLockTakeResult.Taken) {
      let result: T;

      try {
        result = await data.work();
      } finally {
        await lock.release();
      }

      if (deadline.hasPassed()) {
        throw new SessionReplayErasureLockError(
          `${data.holder}: lost the lock of ${SESSION_REPLAY_ERASURE_JOB_NAME} while it worked, so an erasure may have run beside it; that work is not counted as done.`,
        );
      }

      return result;
    }

    if (lock.result === CronLockTakeResult.Unavailable) {
      throw new SessionReplayErasureLockError(
        `${data.holder}: cannot take the lock of ${SESSION_REPLAY_ERASURE_JOB_NAME} (Valkey is not reachable), and does not run beside an erasure it cannot keep out.`,
      );
    }

    if (Date.now() >= giveUpAt) {
      throw new SessionReplayErasureLockError(
        `${data.holder}: ${SESSION_REPLAY_ERASURE_JOB_NAME} held its lock for longer than ${Math.round(data.waitMs / 60000)} minute(s); trying again on the next run.`,
      );
    }

    await sleep(SESSION_REPLAY_ERASURE_LOCK_RETRY_MS);
  }
}
