import StartupMigrationBase from "./StartupMigrationBase";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";

/*
 * The legacy AIAgentTask sweeper jobs "AIAgent:TimeoutStuckTasks" and
 * "AIAgent:FailOrphanedScheduledTasks" were removed when the AIAgentTask
 * tables were dropped (2026-07-13). The CodeFix orphan sweeper was
 * replaced by "AIAgent:FailOrphanedQueuedCodeFixRuns" and heartbeat-stale
 * runs are now swept by "AIChat:TimeoutStuckRuns".
 *
 * This removes the old names' leftover repeatables from Redis.
 *
 * WHY THIS RUNS ON EVERY BOOT RATHER THAN ONCE:
 * during a rolling deploy an OLD worker pod is still alive and still holds
 * the old names in its in-memory Queue.repeatableJobs dict. That pod
 * RE-ADDS every repeatable it holds on any Redis "ready" event (the
 * reconnect listener in Common/Server/Infrastructure/Queue.ts). So a
 * Redis blip while the old pod is draining can re-create an orphan AFTER
 * a one-shot cleanup has already run, and the one-shot would never fire
 * again. Sweeping on every boot means the next worker start — the next
 * replica in the same rollout, or any later restart — removes a late
 * re-add.
 *
 * SAFE TO DELETE once every environment has cycled onto a build that no
 * longer knows the old names (so no pod anywhere can re-add them). Until
 * then it costs a couple of getRepeatableJobs() reads per worker boot,
 * and is a no-op after the first successful sweep.
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
    for (const jobName of LEGACY_JOB_NAMES) {
      const removedCount: number = await Queue.removeRepeatableByName(
        QueueName.Worker,
        jobName,
      );

      if (removedCount > 0) {
        logger.info(
          `Removed ${removedCount} orphaned repeatable job definition(s) named "${jobName}" from the ${QueueName.Worker} queue. These legacy AIAgentTask sweepers were removed with the AIAgentTask table drop; the old definitions would otherwise have kept firing and failing, because no job is registered under these names.`,
        );
      }
    }
  }
}