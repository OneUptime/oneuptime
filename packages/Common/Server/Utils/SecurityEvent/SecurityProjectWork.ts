import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Queue, { QueueJob, QueueName } from "../../Infrastructure/Queue";
import Semaphore, {
  SemaphoreMutex,
  SemaphorePermit,
} from "../../Infrastructure/Semaphore";
import logger from "../Logger";

/*
 * HOW THE SECURITY PIPELINE SPREADS ITS WORK.
 *
 * The detection rules, the threat-intel feeds (polled and matched), the
 * "Your logs" scan and the forwarding to SIEMs each run as two halves:
 *
 *  - Every minute a cron pages through every enabled item in the instance
 *    and queues one job per project that has work due. The job id carries
 *    the project and the minute, and the queue keeps at most one job per
 *    project waiting or running (deduplication), so two ticks or two worker
 *    processes never queue a project twice.
 *
 *  - A project's job holds the project's LEASE while it works: a Valkey
 *    lock that lasts SECURITY_PROJECT_WORK_LEASE_TIMEOUT_IN_MS from the last
 *    time it was kept, and is kept between items. A job BullMQ starts again
 *    after its worker stalled finds the lease held and stops; a lease nobody
 *    keeps runs out, so a worker that died never holds a project for long.
 *
 *  - The job also takes one PERMIT from a pool every worker shares, so at
 *    most `maxConcurrentProjects` projects do this work at once and the
 *    databases see a bounded load however many projects there are. A job
 *    that gets no permit in SECURITY_PROJECT_WORK_PERMIT_WAIT_IN_MS leaves
 *    the project to the next minute.
 *
 *  - A job starts new items for SECURITY_PROJECT_WORK_TIME_BUDGET_IN_MS.
 *    What is left waits for the next minute, where every engine goes on
 *    from its own cursor.
 */

export interface SecurityProjectWorkDefinition {
  // The queue job that does one project's turn.
  jobName: string;
  // Names the job ids, the deduplication key, the lease and the permit pool.
  key: string;
  // The most projects doing this work at once, across every worker.
  maxConcurrentProjects: number;
}

export interface SecurityProjectWorkLease {
  /*
   * Holds the project for another SECURITY_PROJECT_WORK_LEASE_TIMEOUT_IN_MS.
   * False when the lease was lost - another job may have the project now -
   * and the turn must stop.
   */
  keep(): Promise<boolean>;
  // Whether this turn may start another item.
  hasTimeLeft(): boolean;
}

/*
 * The lease of work done outside a project job (a test, a direct call): it
 * is never lost and never runs out of time.
 */
export const UNLIMITED_SECURITY_PROJECT_WORK_LEASE: SecurityProjectWorkLease = {
  keep: async (): Promise<boolean> => {
    return true;
  },
  hasTimeLeft: (): boolean => {
    return true;
  },
};

export type SecurityProjectWorkOutcome =
  // The turn ran.
  | "Done"
  // Another job holds this project's lease.
  | "Busy"
  // Every permit of the pool was taken for the whole wait.
  | "Throttled";

// How long a lease lasts after it was last kept.
export const SECURITY_PROJECT_WORK_LEASE_TIMEOUT_IN_MS: number = 10 * 60 * 1000;
// How long a turn goes on starting new items.
export const SECURITY_PROJECT_WORK_TIME_BUDGET_IN_MS: number = 4 * 60 * 1000;
// How long a turn waits for a permit before leaving the project to the next minute.
export const SECURITY_PROJECT_WORK_PERMIT_WAIT_IN_MS: number = 45 * 1000;
const SECURITY_PROJECT_WORK_PERMIT_RETRY_IN_MS: number = 1000;
/*
 * A project job's timeout: the time budget, plus the longest item started
 * just before it ran out, plus room to record what happened.
 */
export const SECURITY_PROJECT_WORK_JOB_TIMEOUT_IN_MS: number = 12 * 60 * 1000;

export default class SecurityProjectWork {
  // One job per project per minute; the minute keeps ids unique over time.
  public static jobIdOf(
    work: SecurityProjectWorkDefinition,
    projectId: ObjectID,
    now: Date,
  ): string {
    return `${work.key}-${projectId.toString()}-${Math.floor(
      now.getTime() / 60000,
    )}`;
  }

  // Each project once, in the order first seen.
  public static uniqueProjectIds(
    projectIds: Array<ObjectID | undefined>,
  ): Array<ObjectID> {
    const seen: Set<string> = new Set();
    const unique: Array<ObjectID> = [];

    for (const projectId of projectIds) {
      if (!projectId) {
        continue;
      }

      const key: string = projectId.toString();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(projectId);
    }

    return unique;
  }

  /*
   * Queue a turn for each project. A project whose turn is still waiting or
   * running is not queued again. Returns how many were handed to the queue.
   */
  public static async enqueueProjects(
    work: SecurityProjectWorkDefinition,
    projectIds: Array<ObjectID | undefined>,
    now: Date = new Date(),
  ): Promise<number> {
    let queued: number = 0;

    for (const projectId of this.uniqueProjectIds(projectIds)) {
      try {
        await Queue.addJob(
          QueueName.Worker,
          this.jobIdOf(work, projectId, now),
          work.jobName,
          { projectId: projectId.toString() },
          {
            attempts: 1,
            deduplication: { id: `${work.key}-${projectId.toString()}` },
          },
        );
        queued++;
      } catch (error) {
        logger.error(
          `${work.jobName}: project ${projectId.toString()} could not be queued: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return queued;
  }

  // The project a queued turn is for. Its payload is the id only.
  public static projectIdOfJob(job?: QueueJob): ObjectID {
    const projectId: unknown = job?.data?.["projectId"];

    if (typeof projectId !== "string" || !ObjectID.isValidUUID(projectId)) {
      throw new BadDataException("A valid project ID is required.");
    }

    return new ObjectID(projectId);
  }

  /*
   * One project's turn: take its lease, then a permit, then run `turn` with
   * a lease it keeps between items. Both are given back however the turn
   * ends.
   */
  public static async runForProject(
    work: SecurityProjectWorkDefinition,
    projectId: ObjectID,
    turn: (lease: SecurityProjectWorkLease) => Promise<void>,
    options: { timeBudgetInMs?: number | undefined } = {},
  ): Promise<SecurityProjectWorkOutcome> {
    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        namespace: `${work.key}-lease`,
        key: projectId.toString(),
        lockTimeout: SECURITY_PROJECT_WORK_LEASE_TIMEOUT_IN_MS,
        acquireAttemptsLimit: 1,
        // Held only while kept: a turn that stops keeping it lets go.
        refreshInterval: 0,
      });
    } catch {
      return "Busy";
    }

    let permit: SemaphorePermit | null = null;

    try {
      try {
        permit = await Semaphore.acquirePermit({
          namespace: `${work.key}-permit`,
          key: "projects",
          limit: work.maxConcurrentProjects,
          lockTimeout: SECURITY_PROJECT_WORK_LEASE_TIMEOUT_IN_MS,
          acquireTimeout: SECURITY_PROJECT_WORK_PERMIT_WAIT_IN_MS,
          retryInterval: SECURITY_PROJECT_WORK_PERMIT_RETRY_IN_MS,
          onLockLost: (): void => {
            logger.warn(
              `${work.jobName}: project ${projectId.toString()} lost its permit part way through its turn.`,
            );
          },
        });
      } catch {
        return "Throttled";
      }

      const deadline: number =
        Date.now() +
        (options.timeBudgetInMs ?? SECURITY_PROJECT_WORK_TIME_BUDGET_IN_MS);
      let lost: boolean = false;

      const lease: SecurityProjectWorkLease = {
        keep: async (): Promise<boolean> => {
          if (lost) {
            return false;
          }

          try {
            lost = !(await Semaphore.keepLock(mutex));
          } catch (error) {
            // Valkey cannot be reached: the lease cannot be vouched for.
            logger.error(
              `${work.jobName}: project ${projectId.toString()} could not keep its lease: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            lost = true;
          }

          return !lost;
        },
        hasTimeLeft: (): boolean => {
          return !lost && Date.now() < deadline;
        },
      };

      await turn(lease);

      return "Done";
    } finally {
      if (permit) {
        await Semaphore.releasePermit(permit).catch((): void => {
          // The permit runs out on its own.
        });
      }

      await Semaphore.release(mutex).catch((): void => {
        // The lease runs out on its own.
      });
    }
  }
}
