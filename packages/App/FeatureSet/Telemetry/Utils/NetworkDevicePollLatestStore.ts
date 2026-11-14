import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { ProbeIngestJobData } from "../Services/Queue/TelemetryQueueService";

/*
 * THE NEWEST POLL OF A NETWORK DEVICE THAT NO WORKER HAS PROCESSED YET - one
 * slot per (probe, device), in Redis.
 *
 * Why this exists: every device's probe reports a poll every few minutes,
 * and each one used to be a telemetry job of its own, queued with a random
 * id. At 100,000 devices polled every five minutes that is 20,000 jobs a
 * minute; when Postgres slowed, the queue grew without bound (16,000 to
 * 30,000 jobs in a minute on one install), and the workers spent the
 * backlog processing polls that newer polls of the same devices had already
 * made stale.
 *
 * So a backlog holds at most one pending poll per device: polls are queued
 * with BullMQ deduplication keyed by (probe, device), keepLastIfActive. That
 * keeps at most one waiting and one active job per device, but on its own
 * it keeps the OLDEST: a poll that arrives while the device's job is still
 * WAITING is discarded (only one that arrives while the job is ACTIVE is
 * queued after it, with its data). So the poll does not travel with the
 * job:
 *
 *   - the ingest API writes each poll here BEFORE it adds the job,
 *     replacing whatever the slot held (last write wins),
 *   - the device's job, whichever poll created it, processes what the slot
 *     holds when it runs - the newest poll - and then clears the slot, but
 *     only if it still holds the poll that was processed.
 *
 * Every write is followed by an add, and that add resolves to a job that
 * starts after the write: a new job, the waiting job it was discarded into,
 * or the job BullMQ queues after the active one. So the newest poll is
 * always processed. A job that finds the slot empty knows a poll at least as
 * new was processed already, and does nothing.
 *
 * WHAT A POLL THAT IS SKIPPED LOSES. A poll is skipped only when a newer
 * poll of the same device arrived before a worker got to it, so under a
 * backlog longer than the device's polling interval:
 *
 *   - its metric points (ping, interface traffic and errors, OIDs): the
 *     device's charts have no point for that poll;
 *   - its own evaluation by the device's monitors: a state only that poll
 *     saw - a blip that was over by the next poll - is never evaluated;
 *   - its inventory, tables and optics, which the newer poll replaces as it
 *     would have anyway.
 *
 * It does NOT lose counter deltas or rates: rates are worked out against the
 * device's rate baseline (lastWalkLog), which only a processed poll moves,
 * so the newer poll's rate covers the skipped poll's interval too, over the
 * longer window - the same total traffic, averaged over both intervals
 * (NetworkDevicePollCoalescing.test.ts pins it). A counter that went
 * backwards within that window (a wrap, a reboot) gives no rate for it, as a
 * counter that goes backwards between two polls always has.
 *
 * Keyed by probe as well as device: the ingest API does not check that the
 * reporting probe polls the device (the worker does), so a probe reporting a
 * device it does not poll must not be able to replace the polls of the
 * probe that does.
 */

export interface LatestNetworkDevicePoll {
  pollId: string;
  // The poll's job data, as a job would have carried it.
  payload: ProbeIngestJobData;
}

const KEY_PREFIX: string = "network-device-poll:latest:";

/*
 * Every poll re-arms the expiry, and a processed slot is deleted, so this
 * only has to outlive the time a device's job can wait in a backlog. A slot
 * whose job never runs (retries exhausted, queue purged) still ages out.
 */
const TTL_SECONDS: number = OneUptimeDate.getSecondsInDays(1);

/*
 * Replace the slot, id and payload together, and arm its expiry in the same
 * evaluation so the slot can never be left without one.
 */
const STORE_SCRIPT: string =
  "redis.call('HSET', KEYS[1], 'id', ARGV[1], 'payload', ARGV[2]) " +
  "redis.call('EXPIRE', KEYS[1], ARGV[3]) " +
  "return 1";

/*
 * Delete the slot only while it still holds the poll the caller processed.
 * A plain DEL would also delete a newer poll written meanwhile, and nothing
 * would process it.
 */
const CLEAR_IF_UNCHANGED_SCRIPT: string =
  "if redis.call('HGET', KEYS[1], 'id') == ARGV[1] then " +
  "return redis.call('DEL', KEYS[1]) end " +
  "return 0";

export default class NetworkDevicePollLatestStore {
  public static readonly TTL_SECONDS: number = TTL_SECONDS;

  public static getKey(probeId: string, networkDeviceId: string): string {
    return `${KEY_PREFIX}${probeId}:${networkDeviceId}`;
  }

  /*
   * Make this poll the device's newest. Throws when Redis is unavailable:
   * the caller must not add a job whose poll is not stored.
   */
  public static async store(data: {
    probeId: string;
    networkDeviceId: string;
    pollId: string;
    payload: ProbeIngestJobData;
  }): Promise<void> {
    await NetworkDevicePollLatestStore.getConnectedClient().eval(
      STORE_SCRIPT,
      1,
      NetworkDevicePollLatestStore.getKey(data.probeId, data.networkDeviceId),
      data.pollId,
      JSON.stringify(data.payload),
      String(TTL_SECONDS),
    );
  }

  /*
   * The device's newest poll no worker has processed, or null when there is
   * none. Throws when Redis is unavailable, so the job is retried instead of
   * completing without processing anything.
   */
  public static async getLatest(
    probeId: string,
    networkDeviceId: string,
  ): Promise<LatestNetworkDevicePoll | null> {
    const [pollId, payloadJson]: Array<string | null> =
      await NetworkDevicePollLatestStore.getConnectedClient().hmget(
        NetworkDevicePollLatestStore.getKey(probeId, networkDeviceId),
        "id",
        "payload",
      );

    if (!pollId || !payloadJson) {
      return null;
    }

    try {
      const payload: unknown = JSON.parse(payloadJson);

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("The stored poll is not an object");
      }

      return {
        pollId: pollId,
        payload: payload as ProbeIngestJobData,
      };
    } catch (err) {
      /*
       * Unreadable, so it can never be processed; retrying would not change
       * that. The device's next poll replaces it.
       */
      logger.error(
        "NetworkDevicePollLatestStore: could not read a stored network device poll. It is skipped.",
      );
      logger.error(err);
      return null;
    }
  }

  /*
   * Clear the slot after its poll was processed, unless a newer poll
   * replaced it meanwhile. Returns whether it was cleared. Best effort: a
   * slot left behind is harmless - the device's next poll replaces it, and
   * the expiry reclaims it - so this never fails a processed job.
   */
  public static async clearIfUnchanged(data: {
    probeId: string;
    networkDeviceId: string;
    pollId: string;
  }): Promise<boolean> {
    try {
      const result: unknown =
        await NetworkDevicePollLatestStore.getConnectedClient().eval(
          CLEAR_IF_UNCHANGED_SCRIPT,
          1,
          NetworkDevicePollLatestStore.getKey(
            data.probeId,
            data.networkDeviceId,
          ),
          data.pollId,
        );

      return result === 1;
    } catch (err) {
      logger.warn(
        "NetworkDevicePollLatestStore: could not clear a processed network device poll. It expires on its own.",
      );
      logger.warn(err);
      return false;
    }
  }

  private static getConnectedClient(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new Error(
        "Redis is not connected, so the newest network device poll cannot be stored or read.",
      );
    }

    return client;
  }
}
