import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import ServerException from "../../../Types/Exception/ServerException";
import ObjectID from "../../../Types/ObjectID";
import logger, { LogAttributes } from "../Logger";

/*
 * THE LOCK A MONITOR'S EVALUATION HOLDS, KEPT AND NEVER LOST IN SILENCE
 * (issue #10108).
 *
 * MonitorResourceUtil.monitorResource holds a per-monitor mutex for the
 * whole of an evaluation, so two results of one monitor are judged one after
 * the other: two at once open the same alert twice and flap the status.
 * redis-semaphore keeps the mutex by re-asserting it on a timer. A grouped
 * monitor over 16,000 series held the event loop for 20 to 30 seconds, the
 * timer could not fire, the key ran out in Valkey, and when the timer fired
 * at last it threw LostLockError from inside itself - an unhandled
 * rejection - while the evaluation carried on, writing alerts and status
 * changes with no lock at all.
 *
 * Both halves are dealt with:
 *
 *   - Kept reliably. No step of an evaluation holds the event loop for long
 *     any more (the work is done in slices), and the lock is re-asserted
 *     every REFRESH_INTERVAL_MS of its LOCK_TIMEOUT_MS: a refresh can come
 *     four seconds late and still find the lock its holder's. A short
 *     evaluation - almost every one - is over before the first refresh, so
 *     this costs it nothing.
 *   - Never lost in silence. Should the lock be lost all the same - Valkey
 *     restarted or evicted the key, the process stalled past the timeout -
 *     the timer says so here (onLockLost) instead of throwing where nothing
 *     can catch it, and the evaluation stops at its next write: keep(),
 *     called before each, throws MONITOR_EVALUATION_LOCK_LOST_MESSAGE
 *     rather than write without the lock. keep() also re-asserts the lock
 *     itself when it has not been known held for a refresh interval, so a
 *     lock that ran out while the loop was stalled is found out before the
 *     write, not after it. The job that ran the evaluation fails and is run
 *     again (the Telemetry queue retries it), under the lock this time; what
 *     the stopped evaluation already wrote is read back as open and not
 *     written twice.
 */

export const MONITOR_EVALUATION_LOCK_NAMESPACE: string =
  "MonitorResourceUtil.monitorResource";

/*
 * How long the lock lasts in Valkey from its last refresh: as long as it
 * ever did, so a holder that dies holds its monitor for no longer than
 * before.
 */
export const MONITOR_EVALUATION_LOCK_TIMEOUT_MS: number = 5000;

// How often it is re-asserted: leaves four seconds for a late refresh.
export const MONITOR_EVALUATION_LOCK_REFRESH_INTERVAL_MS: number = 1000;

/*
 * How long after the lock was last known held keep() asks Valkey again: up
 * to then it cannot have run out (it lasts LOCK_TIMEOUT_MS from then), and
 * the second left is for the question itself.
 */
export const MONITOR_EVALUATION_LOCK_CHECK_AFTER_MS: number =
  MONITOR_EVALUATION_LOCK_TIMEOUT_MS -
  MONITOR_EVALUATION_LOCK_REFRESH_INTERVAL_MS;

export const MONITOR_EVALUATION_LOCK_LOST_MESSAGE: string =
  "This monitor's evaluation lost its lock part way through, so it was stopped before writing anything more. It is run again from the start.";

export interface MonitorEvaluationLockOptions {
  monitorId: ObjectID;
  // How long to wait for another holder, and how often to try meanwhile.
  acquireTimeout: number;
  retryInterval: number;
  acquireAttemptsLimit: number;
  logAttributes?: LogAttributes | undefined;
}

export default class MonitorEvaluationLock {
  private mutex: SemaphoreMutex | null;
  private readonly monitorId: ObjectID;
  private readonly logAttributes: LogAttributes;
  private lostBecause: Error | null = null;
  // When the lock was last known to be this holder's.
  private heldAt: number;

  private constructor(data: {
    mutex: SemaphoreMutex;
    monitorId: ObjectID;
    logAttributes: LogAttributes;
  }) {
    this.mutex = data.mutex;
    this.monitorId = data.monitorId;
    this.logAttributes = data.logAttributes;
    this.heldAt = Date.now();
  }

  /*
   * Takes the monitor's lock, or throws as Semaphore.lock does when another
   * holder keeps it past the acquire timeout.
   */
  public static async acquire(
    options: MonitorEvaluationLockOptions,
  ): Promise<MonitorEvaluationLock> {
    const logAttributes: LogAttributes = {
      ...(options.logAttributes || {}),
      monitorId: options.monitorId.toString(),
    } as LogAttributes;

    // Told of a loss by the refresh timer before the lock object exists.
    let lock: MonitorEvaluationLock | null = null;

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: options.monitorId.toString(),
      namespace: MONITOR_EVALUATION_LOCK_NAMESPACE,
      lockTimeout: MONITOR_EVALUATION_LOCK_TIMEOUT_MS,
      refreshInterval: MONITOR_EVALUATION_LOCK_REFRESH_INTERVAL_MS,
      acquireTimeout: options.acquireTimeout,
      retryInterval: options.retryInterval,
      acquireAttemptsLimit: options.acquireAttemptsLimit,
      onLockLost: (error: Error): void => {
        lock?.markLost(error);
      },
    });

    lock = new MonitorEvaluationLock({
      mutex: mutex,
      monitorId: options.monitorId,
      logAttributes: logAttributes,
    });

    return lock;
  }

  // Whether the lock is known lost.
  public isLost(): boolean {
    return this.lostBecause !== null;
  }

  /*
   * Before a write: throws MONITOR_EVALUATION_LOCK_LOST_MESSAGE when the
   * lock is no longer this holder's. When it has not been known held for
   * CHECK_AFTER_MS it is re-asserted first, so a lock that ran out while the
   * loop could not refresh it is found out now, before the write. Does
   * nothing once the lock was given back: what an evaluation writes after
   * release() is written without it on purpose.
   */
  public async keep(): Promise<void> {
    if (this.lostBecause) {
      throw new ServerException(MONITOR_EVALUATION_LOCK_LOST_MESSAGE);
    }

    if (!this.mutex) {
      return;
    }

    if (this.mutex.isAcquired === false) {
      this.markLost(new Error("The lock is no longer held."));
      throw new ServerException(MONITOR_EVALUATION_LOCK_LOST_MESSAGE);
    }

    if (Date.now() - this.heldAt < MONITOR_EVALUATION_LOCK_CHECK_AFTER_MS) {
      return;
    }

    let isKept: boolean = false;

    try {
      isKept = await Semaphore.keepLock(this.mutex);
    } catch (error) {
      // Valkey cannot be reached: the lock cannot be vouched for.
      this.markLost(error as Error);
      throw new ServerException(MONITOR_EVALUATION_LOCK_LOST_MESSAGE);
    }

    if (!isKept) {
      this.markLost(new Error("The lock ran out before it was refreshed."));
      throw new ServerException(MONITOR_EVALUATION_LOCK_LOST_MESSAGE);
    }

    this.heldAt = Date.now();
  }

  // Gives the lock back. Never throws: a lock not given back runs out.
  public async release(): Promise<void> {
    const mutex: SemaphoreMutex | null = this.mutex;

    if (!mutex) {
      return;
    }

    this.mutex = null;

    try {
      await Semaphore.release(mutex);
    } catch (error) {
      logger.error(error, this.logAttributes);
    }
  }

  private markLost(error: Error): void {
    if (this.lostBecause) {
      return;
    }

    this.lostBecause = error;

    logger.error(
      `${this.monitorId.toString()} - This monitor's evaluation lost its lock (${error.message}). It stops before its next write and runs again from the start.`,
      this.logAttributes,
    );
  }
}
