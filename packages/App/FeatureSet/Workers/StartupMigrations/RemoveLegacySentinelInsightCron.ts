import StartupMigrationBase from "./StartupMigrationBase";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";

/*
 * The cron that scans for AI insights was renamed from
 * "SentinelInsight:ScanForInsights" to "AIInsight:ScanForInsights" when the
 * Sentinel codename was retired from code identifiers (see
 * Jobs/AIInsight/ScanForInsights.ts). This removes the old name's leftover
 * repeatable from Redis.
 *
 * WHY THE RENAME NEEDS A CLEANUP AT ALL:
 * RunCron -> Queue.addJob registers a BullMQ REPEATABLE keyed by job name, and
 * addJob only clears a pre-existing repeatable whose name matches the NEW name.
 * Nothing ever clears the OLD one, so the "SentinelInsight:ScanForInsights"
 * repeatable definition survives in Redis and keeps firing every 15 minutes
 * forever. Each fire enqueues a job by that old name, which is no longer in
 * JobDictionary, so the worker's JobDictionary.getJobFunction() throws
 * BadDataException("No job found with name: ...") -> ~96 failed jobs a day,
 * forever, inflating the Failed count on the admin Health page. It never
 * self-heals.
 *
 * WHY THIS RUNS ON EVERY BOOT RATHER THAN ONCE:
 * during a rolling deploy an OLD worker pod is still alive and still holds the
 * old name in its in-memory Queue.repeatableJobs dict. That pod RE-ADDS every
 * repeatable it holds on any Redis "ready" event (the reconnect listener in
 * Common/Server/Infrastructure/Queue.ts). So a Redis blip while the old pod is
 * draining can re-create the orphan AFTER a one-shot cleanup has already run,
 * and the one-shot would never fire again. Sweeping on every boot means the
 * next worker start — the next replica in the same rollout, or any later
 * restart — removes a late re-add.
 *
 * SAFE TO DELETE once every environment has cycled onto a build that no longer
 * knows the old name (so no pod anywhere can re-add it). Until then it costs
 * one getRepeatableJobs() read per worker boot, and is a no-op after the first
 * successful sweep.
 */

const LEGACY_JOB_NAME: string = "SentinelInsight:ScanForInsights";
const CURRENT_JOB_NAME: string = "AIInsight:ScanForInsights";

export default class RemoveLegacySentinelInsightCron extends StartupMigrationBase {
  public constructor() {
    super("RemoveLegacySentinelInsightCron");
  }

  public override async migrate(): Promise<void> {
    /*
     * Must match on the job NAME. Queue.removeJob() cannot do this: BullMQ keys
     * a repeatable by an opaque md5 (the member of the bull:<queue>:repeat
     * zset), and removeRepeatableByKey() ZREMs that exact member — handing it a
     * job name matches nothing and silently no-ops. removeRepeatableByName()
     * enumerates getRepeatableJobs() and removes by .key, which also drops the
     * already-materialized next delayed iteration.
     */
    const removedCount: number = await Queue.removeRepeatableByName(
      QueueName.Worker,
      LEGACY_JOB_NAME,
    );

    if (removedCount > 0) {
      logger.info(
        `Removed ${removedCount} orphaned repeatable job definition(s) named "${LEGACY_JOB_NAME}" from the ${QueueName.Worker} queue. The job was renamed to "${CURRENT_JOB_NAME}"; the old definition would otherwise have kept firing every 15 minutes and failing, because no job is registered under the old name.`,
      );
    }
  }
}
