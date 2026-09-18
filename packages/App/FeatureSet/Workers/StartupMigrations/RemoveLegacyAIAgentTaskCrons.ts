import StartupMigrationBase from "./StartupMigrationBase";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";

/*
 * The legacy AIAgentTask sweepers "AIAgent:TimeoutStuckTasks" and
 * "AIAgent:FailOrphanedScheduledTasks" were deleted along with the AIAgentTask
 * tables (#2675). Their work is now done by
 * "AIAgent:FailOrphanedQueuedCodeFixRuns" (Jobs/AIAgent) and
 * "AIChat:TimeoutStuckRuns" (Jobs/AIChat). This removes the old names'
 * leftover repeatables from Redis.
 *
 * WHY THE REMOVAL NEEDS A CLEANUP AT ALL:
 * RunCron -> Queue.addJob registers a BullMQ REPEATABLE keyed by job name, and
 * addJob only clears a pre-existing repeatable whose name matches the name
 * being registered. A name that is never registered again is never cleared, so
 * both definitions survive in Redis and keep firing every minute forever. Each
 * fire enqueues a job by a name that is no longer in JobDictionary, so the
 * worker's JobDictionary.getJobFunction() throws BadDataException("No job found
 * with name: ...") -> ~1440 failed jobs a day, forever, pinning the Failed
 * count on the admin Health page at its removeOnFail cap. It never self-heals.
 *
 * WHY THIS RUNS ON EVERY BOOT RATHER THAN ONCE:
 * during a rolling deploy an OLD worker pod is still alive and still holds the
 * old names in its in-memory Queue.repeatableJobs dict. That pod RE-ADDS every
 * repeatable it holds on any Redis "ready" event (the reconnect listener in
 * Common/Server/Infrastructure/Queue.ts). So a Redis blip while the old pod is
 * draining can re-create an orphan AFTER a one-shot cleanup has already run,
 * and the one-shot would never fire again. Sweeping on every boot means the
 * next worker start — the next replica in the same rollout, or any later
 * restart — removes a late re-add.
 *
 * SAFE TO DELETE once every environment has cycled onto a build that no longer
 * knows the old names (so no pod anywhere can re-add them). Until then it costs
 * one getRepeatableJobs() read per name per worker boot, and is a no-op after
 * the first successful sweep.
 */

const LEGACY_JOB_NAMES: Array<string> = [
  "AIAgent:TimeoutStuckTasks",
  "AIAgent:FailOrphanedScheduledTasks",
];

export default class RemoveLegacyAIAgentTaskCrons extends StartupMigrationBase {
  public constructor() {
    super("RemoveLegacyAIAgentTaskCrons");
  }

  public override async migrate(): Promise<void> {
    for (const legacyJobName of LEGACY_JOB_NAMES) {
      /*
       * Must match on the job NAME. Queue.removeJob() cannot do this: BullMQ
       * keys a repeatable by an opaque md5 (the member of the
       * bull:<queue>:repeat zset), and removeRepeatableByKey() ZREMs that exact
       * member — handing it a job name matches nothing and silently no-ops.
       * removeRepeatableByName() enumerates getRepeatableJobs() and removes by
       * .key, which also drops the already-materialized next delayed iteration.
       */
      const removedCount: number = await Queue.removeRepeatableByName(
        QueueName.Worker,
        legacyJobName,
      );

      if (removedCount > 0) {
        logger.info(
          `Removed ${removedCount} orphaned repeatable job definition(s) named "${legacyJobName}" from the ${QueueName.Worker} queue. These legacy AIAgentTask sweepers were deleted with the AIAgentTask tables; the old definitions would otherwise have kept firing every minute and failing, because no job is registered under these names.`,
        );
      }
    }
  }
}
