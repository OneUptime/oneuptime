import RunCron from "../../Utils/Cron";
import {
  ConditionalMemberRemoval,
  SESSION_REPLAY_ACTIVE_PROJECTS_KEY,
  SESSION_REPLAY_ACTIVITY_ABANDON_MS,
  getActiveSessionsKey,
  getEndedSessionsKey,
  removeActivityMembersIfNotNewer,
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
 *      leak eventually refuses writes on the INGEST path. The per-project
 *      ended-session set (replay:ended:<projectId>) is reaped under the
 *      same cutoff for the same reason. Every removal is conditional on
 *      the score that was read, so an entry the ingest path refreshed in
 *      the meantime survives.
 *
 * The two jobs are deliberately split by cutoff so they cannot fight over
 * the same entries: the finalizer owns everything newer than the abandon
 * cutoff, this job only touches what is older than it.
 *
 * Nothing this job reaps is lost for good. A session whose activity entry
 * is gone still has its provisional header in ClickHouse, and the
 * finalizer's hourly sweep (sweepNeverFinalizedSessions) seals every
 * header that is still unfinalized past the abandon window — so the
 * honest description of a reaped entry is "finalized late by the sweep",
 * not "unrecoverable".
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

/*
 * The capped, oldest-first range of a sorted set at or below the cutoff,
 * each member paired with the score it was read at - which is the threshold
 * its conditional removal must not exceed.
 */
async function readMembersAtOrBefore(
  client: ClientType,
  key: string,
  cutoffUnixMs: number,
): Promise<Array<ConditionalMemberRemoval>> {
  const membersWithScores: Array<string> = await client.zrangebyscore(
    key,
    "-inf",
    cutoffUnixMs,
    "WITHSCORES",
    "LIMIT",
    0,
    MAX_ABANDONED_MEMBERS_PER_PROJECT,
  );

  const entries: Array<ConditionalMemberRemoval> = [];

  for (
    let index: number = 0;
    index + 1 < membersWithScores.length;
    index += 2
  ) {
    entries.push({
      member: membersWithScores[index]!,
      maxScore: Number(membersWithScores[index + 1]),
    });
  }

  return entries;
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
       * A project still in the index whose activity key is GONE is the
       * NORMAL end of a drain, not a failure: Redis deletes a sorted set
       * the moment its last member is ZREMed, and the finalizer removes
       * members one session at a time but only prunes the project from
       * the index on a LATER run, when a read of the set comes back
       * empty. Both jobs run every five minutes, so this job routinely
       * lands in that gap. The other way the key vanishes — no chunk
       * arrived for the ingest path's whole 6h TTL while members were
       * still queued — is indistinguishable from here and equally
       * recoverable: the finalizer's sweep seals whatever those members
       * pointed at. So the index entry is dropped quietly; the sweep's
       * own counters are where a stuck finalizer shows up.
       */
      const activeKeyExists: number = await client.exists(activeKey);

      if (activeKeyExists === 0) {
        logger.debug(
          `${JOB_NAME}: project ${projectId} has no activity key (drained or expired); dropping it from the index. Any session left unfinalized is sealed by the finalizer's sweep.`,
        );

        await client.srem(SESSION_REPLAY_ACTIVE_PROJECTS_KEY, projectId);
        continue;
      }

      /*
       * Read the range then remove it, rather than ZREMRANGEBYSCORE: the
       * removal has to be capped (a single project must not monopolise the
       * run) and the reaped count has to be reportable, because a
       * non-zero count here means recordings were lost and that should be
       * visible in the logs rather than silent.
       *
       * The removal is conditional on the score read here. Between the read
       * and the removal the ingest path can ZADD the same member again (the
       * tab of a long-silent session sent a chunk after all), and a plain
       * ZREM would delete that fresh entry: the session would then only be
       * finalized by the hourly sweep, hours later, instead of by the
       * finalizer's next run.
       */
      const abandoned: Array<ConditionalMemberRemoval> =
        await readMembersAtOrBefore(client, activeKey, cutoffUnixMs);

      if (abandoned.length > 0) {
        const reaped: number = await removeActivityMembersIfNotNewer(
          client,
          activeKey,
          abandoned,
        );

        removed += reaped;

        if (reaped > 0) {
          logger.warn(
            `${JOB_NAME}: reaped ${reaped} session activity entr(ies) older than ${Math.round(SESSION_REPLAY_ACTIVITY_ABANDON_MS / 60000)} minutes for project ${projectId}; the finalizer never got to them. Their headers are sealed by the finalizer's sweep; if this repeats every run, check whether Rum:FinalizeSessions is failing.`,
          );
        }
      }

      /*
       * The ended set (see the Redis contract in FinalizeSessions) gets the
       * same abandon cutoff. Rum:FinalizeEndedSessions removes a candidate
       * once its check has an answer, and keeps it only while the session is
       * settling inside its one-minute grace or was deferred to the next
       * run's budget. So one this old is a session whose check keeps
       * THROWING (or whose settling never ends, which takes a clock skew of
       * hours between the ingest and worker hosts), and would otherwise be
       * retried every minute for as long as ingest keeps refreshing the
       * key's TTL. Its activity entry went above
       * (or will, under the same cutoff), so the sweep still seals it.
       * Conditional for the same reason as above: a final chunk that lands
       * in between re-queues the tab with a newer score.
       */
      const endedKey: string = getEndedSessionsKey(projectId);

      const staleEnded: Array<ConditionalMemberRemoval> =
        await readMembersAtOrBefore(client, endedKey, cutoffUnixMs);

      if (staleEnded.length > 0) {
        const reapedEnded: number = await removeActivityMembersIfNotNewer(
          client,
          endedKey,
          staleEnded,
        );

        if (reapedEnded > 0) {
          logger.debug(
            `${JOB_NAME}: reaped ${reapedEnded} ended-session candidate(s) older than ${Math.round(SESSION_REPLAY_ACTIVITY_ABANDON_MS / 60000)} minutes for project ${projectId}.`,
          );
        }
      }

      const remaining: number = await client.zcard(activeKey);

      if (remaining === 0) {
        /*
         * Safe to drop from the index: the ingest path does not maintain
         * it, but the finalizer's periodic reconcile SCANs the keyspace
         * and re-adds any project whose activity key reappears, so the
         * worst case is a project waiting one reconcile interval (ten
         * minutes) for its next batch of ended sessions.
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
