import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import { getErrorMessage } from "./InstanceHealthNotification";

/*
 * Instance-health evaluation is a read-modify-write over one durable log stream
 * per event type, so two app replicas ticking at the same time could both see
 * "no active notification" and both email every master admin. This lease makes
 * the whole evaluation single-writer across the cluster; a replica that cannot
 * take it simply skips this tick, because the holder is already doing the same
 * work.
 *
 * WHY NOT A POSTGRES ADVISORY LOCK (this used to be one).
 *
 * The previous implementation opened a Postgres transaction, took
 * `pg_try_advisory_xact_lock`, and then ran the ENTIRE evaluation inside that
 * transaction. A transaction-scoped advisory lock is released only by COMMIT,
 * so the transaction had to stay open for the whole job — minutes of ClickHouse
 * `ON CLUSTER` DDL, disk scans and sequential SMTP sends. Two things follow,
 * and the second is a correctness bug:
 *
 *   - The lock-holder connection issues exactly one statement and then sits
 *     `idle in transaction` for the duration, pinning a pooled backend. That is
 *     how a 19-minute idle-in-transaction session showed up in production, and
 *     it is why nothing in this codebase takes a Postgres advisory lock any
 *     more — cross-process critical sections use a Redis mutex
 *     (`Common/Server/Infrastructure/Semaphore.ts`) or, as here, a Redis lease.
 *
 *   - `idle_in_transaction_session_timeout` (60s by default — see
 *     PostgresIdleInTransactionTimeoutMs) is aimed at exactly that session. If
 *     it fires, Postgres aborts the transaction and RELEASES THE ADVISORY LOCK
 *     while the job is still running. A second replica then acquires it and
 *     runs the same evaluation concurrently — double notifications, double
 *     partition drops — and the original job's final commit throws. The
 *     mutual exclusion silently expired 60 seconds in, and nothing said so.
 *
 * A Redis lease has neither problem: it holds no database connection and no
 * transaction, and its TTL is chosen to outlive the job rather than to expire
 * underneath it. This introduces no new dependency — RunCron dispatches these
 * jobs through BullMQ, which is itself Redis-backed, so a job that cannot reach
 * Redis was never going to be scheduled in the first place.
 */
const LEASE_CACHE_NAMESPACE: string = "instance-health-job-lease";

/*
 * Wall-clock budget the cron gives each instance-health job before it abandons
 * the run, and the lease TTL that has to outlive it. These belong together: the
 * whole failure mode this module exists to prevent is a lease that expires
 * while its holder is still working, so the ordering
 * INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS > job timeout is the load-bearing
 * invariant. Keeping both here (rather than one per job file) means the three
 * jobs cannot drift apart and quietly break it.
 *
 * The 5-minute margin covers the gap between the cron abandoning a job and the
 * job's own in-flight awaits actually unwinding — `timeoutInMS` stops waiting
 * for the promise, it does not kill the work.
 */
export const INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES: number = 15;
export const INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS: number = 20 * 60;

export async function runWithInstanceHealthLease(data: {
  jobName: string;
  lockLabel: string;
  /*
   * Crash-recovery bound, NOT a job budget. A holder that dies without running
   * its release (SIGKILL, node eviction, OOM) blocks the lease until this
   * elapses, so it must exceed the job's cron `timeoutInMS` — a lease that
   * expires while the holder is still working re-creates the concurrent-run bug
   * this exists to prevent.
   */
  leaseTtlInSeconds: number;
  run: () => Promise<void>;
}): Promise<void> {
  /*
   * Identifies THIS attempt, so the release can tell "my lease" from "a lease
   * someone else acquired after mine expired". See GlobalCache.deleteKeyIfValue.
   */
  const holderToken: string = ObjectID.generate().toString();

  let acquired: boolean = false;

  try {
    acquired = await GlobalCache.setStringIfNotExists(
      LEASE_CACHE_NAMESPACE,
      data.lockLabel,
      holderToken,
      { expiresInSeconds: data.leaseTtlInSeconds },
    );
  } catch (error) {
    /*
     * Cache unreachable. Skip the tick rather than run unserialized: these jobs
     * email every master admin and drop ClickHouse partitions, so running twice
     * is materially worse than not running until the next tick.
     */
    logger.error(
      `${data.jobName}: Skipping evaluation because the lease could not be acquired: ${getErrorMessage(
        error,
      )}`,
    );
    return;
  }

  if (!acquired) {
    logger.debug(
      `${data.jobName}: Skipping evaluation because another replica holds the lease.`,
    );
    return;
  }

  try {
    await data.run();
  } finally {
    /*
     * Release so the next tick is not blocked for the whole TTL. Best-effort
     * and non-masking: an error here must not replace the outcome of `run()`,
     * and if the release is lost the lease still expires on its own.
     */
    try {
      await GlobalCache.deleteKeyIfValue(
        LEASE_CACHE_NAMESPACE,
        data.lockLabel,
        holderToken,
      );
    } catch (releaseError) {
      logger.error(
        `${data.jobName}: Failed to release the instance-health lease: ${getErrorMessage(
          releaseError,
        )}`,
      );
    }
  }
}
