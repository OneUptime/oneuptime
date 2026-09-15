import StartupMigrationBase from "./StartupMigrationBase";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";

/*
 * Google SecOps moved into the Security Event Connections framework, and its
 * own cron "SecurityEvents:PollGoogleSecOpsConnections" was deleted with the
 * rest of its stack. Its connections are polled by
 * "SecurityEvents:PollSecurityEventConnections" now. This removes the old
 * name's leftover repeatable from Redis.
 *
 * WHY THE REMOVAL NEEDS A CLEANUP AT ALL:
 * RunCron -> Queue.addJob registers a BullMQ REPEATABLE keyed by job name, and
 * addJob only clears a pre-existing repeatable whose name matches the name
 * being registered. A name that is never registered again is never cleared, so
 * the definition survives in Redis and keeps firing every minute forever. Each
 * fire enqueues a job by a name that is no longer in JobDictionary, so the
 * worker's JobDictionary.getJobFunction() throws BadDataException("No job found
 * with name: ...") -> ~1440 failed jobs a day, forever, pinning the Failed
 * count on the admin Health page at its removeOnFail cap. It never self-heals.
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
 * WHY THE QUEUED "SecurityEvents:RunGoogleSecOpsConnection" JOBS ARE LEFT ALONE:
 * those are one-off jobs, not repeatables, and the Queue wrapper has no way to
 * remove queued jobs by name: removeJob() takes a job id, and
 * removeRepeatableByName() only touches repeatable definitions. Removing them
 * would not be safe anyway: during the rollout an old worker still consumes
 * them correctly, and a new pod's boot would cancel that work. Once no pod
 * knows the name, each leftover fails its three attempts with "No job found"
 * and stops — bounded, unlike a repeatable — and ages out of the failed set.
 * Their runs, if queued before the data migration
 * MoveGoogleSecOpsConnectionsToSecurityEventConnections ran, were copied into
 * run history as failed with an explanation.
 *
 * SAFE TO DELETE once every environment has cycled onto a build that no longer
 * knows the old name (so no pod anywhere can re-add it). Until then it costs
 * one getRepeatableJobs() read per worker boot, and is a no-op after the first
 * successful sweep.
 */

const LEGACY_JOB_NAME: string = "SecurityEvents:PollGoogleSecOpsConnections";
const CURRENT_JOB_NAME: string = "SecurityEvents:PollSecurityEventConnections";

export default class RemoveLegacyGoogleSecOpsCrons extends StartupMigrationBase {
  public constructor() {
    super("RemoveLegacyGoogleSecOpsCrons");
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
        `Removed ${removedCount} orphaned repeatable job definition(s) named "${LEGACY_JOB_NAME}" from the ${QueueName.Worker} queue. Google SecOps connections are polled by "${CURRENT_JOB_NAME}" now; the old definition would otherwise have kept firing every minute and failing, because no job is registered under the old name.`,
      );
    }
  }
}
