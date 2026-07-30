import RunCron from "../../Utils/Cron";
import {
  SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
  SESSION_REPLAY_ACTIVITY_ABANDON_MS,
  getActiveSessionsKey,
} from "./FinalizeSessions";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import logger from "Common/Server/Utils/Logger";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * ------------------------------------------------------------------
 * Rum:CleanupStaleResources
 *
 * Runs every 5 minutes. Two unrelated pieces of housekeeping that both
 * belong to the RUM application lifecycle:
 *
 *   1. Flip RUM applications to "disconnected" when telemetry has stopped
 *      arriving. RumApplicationService.markDisconnectedApplications() was
 *      written but never scheduled — verified: this cron is its only
 *      caller in the repo — so until now every RUM application's status
 *      pill read "Connected" forever, including applications whose script
 *      tag had been removed months earlier. The 15-minute threshold and
 *      the reason it must stay well above the 5-minute OTel ingest
 *      maintenance fence both live in that service, so this cron carries
 *      no duplicate policy. Every other pillar has the identical sweeper
 *      (Ceph / Proxmox / DockerSwarm / IoT / Host).
 *
 *   2. Reap abandoned session-replay activity entries. The finalizer
 *      removes a session's entry from the per-project sorted set once it
 *      has written a header, but two cases leave entries behind forever:
 *      a session whose chunks TTL-dropped before finalization ever
 *      succeeded, and a project whose sorted set drained through this
 *      path rather than through the finalizer. Left alone, the sorted set
 *      is an unbounded Redis leak on a Redis that runs with persistence
 *      off and (per the deployment docs) a noeviction policy — so the
 *      leak eventually refuses writes on the INGEST path.
 *
 * The two jobs are deliberately split by cutoff so they cannot fight over
 * the same entries: the finalizer owns everything newer than the abandon
 * cutoff, this job only touches what is older than it.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "Rum:CleanupStaleResources";

/*
 * Entries reaped per project per run. A cap keeps one pathological project
 * from monopolising the run; the next run continues where this left off
 * because the cutoff only moves forward.
 */
const MAX_ABANDONED_MEMBERS_PER_PROJECT: number = 5000;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function pruneAbandonedSessionActivity(): Promise<number> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    return 0;
  }

  const cutoffUnixMs: number = Date.now() - SESSION_REPLAY_ACTIVITY_ABANDON_MS;

  const projectIds: Array<string> = await client.smembers(
    SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
  );

  let removed: number = 0;

  for (const projectId of projectIds) {
    const activeKey: string = getActiveSessionsKey(projectId);

    try {
      /*
       * Read the range then remove it, rather than ZREMRANGEBYSCORE: the
       * removal has to be capped (a single project must not monopolise the
       * run) and the reaped count has to be reportable, because a
       * non-zero count here means recordings were lost and that should be
       * visible in the logs rather than silent.
       */
      const abandoned: Array<string> = await client.zrangebyscore(
        activeKey,
        "-inf",
        cutoffUnixMs,
        "LIMIT",
        0,
        MAX_ABANDONED_MEMBERS_PER_PROJECT,
      );

      if (abandoned.length > 0) {
        removed += await client.zrem(activeKey, abandoned);

        logger.warn(
          `${JOB_NAME}: reaped ${abandoned.length} abandoned session activity entr(ies) for project ${projectId}. Their chunks either never arrived or expired before finalization.`,
        );
      }

      const remaining: number = await client.zcard(activeKey);

      if (remaining === 0) {
        /*
         * Safe to drop from the index: the ingest path SADDs the project
         * back on every accepted chunk, so the worst case is one wasted
         * ZRANGEBYSCORE on the next finalizer run.
         */
        await client.srem(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId);
      }
    } catch (error) {
      logger.error(
        `${JOB_NAME}: activity prune failed for project ${projectId}: ${getErrorMessage(error)}`,
      );
    }
  }

  return removed;
}

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    /*
     * Step 1 and step 2 are independent, so a failure in one must not skip
     * the other — hence two separate try blocks rather than one.
     */
    try {
      await RumApplicationService.markDisconnectedApplications();
    } catch (error) {
      logger.error(
        `${JOB_NAME}: markDisconnectedApplications failed: ${getErrorMessage(error)}`,
      );
    }

    try {
      const removed: number = await pruneAbandonedSessionActivity();

      if (removed > 0) {
        logger.debug(
          `${JOB_NAME}: pruned ${removed} abandoned session activity entr(ies)`,
        );
      }
    } catch (error) {
      logger.error(
        `${JOB_NAME}: session activity prune failed: ${getErrorMessage(error)}`,
      );
    }
  },
);
