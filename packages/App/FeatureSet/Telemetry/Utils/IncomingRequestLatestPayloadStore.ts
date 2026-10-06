import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { createHash } from "crypto";
import { IncomingRequestIngestJobData } from "../Services/Queue/TelemetryQueueService";

/*
 * The newest request an Incoming Request monitor received that no worker has
 * evaluated yet - one slot per monitor, in Redis.
 *
 * Why this exists: same-monitor ingest jobs are coalesced with BullMQ
 * deduplication (keepLastIfActive), which keeps at most one active and one
 * waiting job per monitor. BullMQ only keeps the LATEST payload when the
 * monitor's job is ACTIVE: it stores the new job and queues it once the
 * active one finishes. When the existing job is still WAITING (or delayed
 * for a retry) it discards the new job outright, so the OLDER waiting payload
 * is the one evaluated. Under a Telemetry backlog that is nearly every
 * request, and for a payload-driven monitor it is data loss: an Alertmanager
 * "resolved" notification queued behind a waiting "firing" one was never
 * evaluated, and the incident stayed open.
 *
 * So the payload no longer travels only with the job:
 *
 *   - the endpoint writes each request here BEFORE it adds the job, replacing
 *     whatever the slot held (last write wins),
 *   - a coalesced job, whichever request created it, evaluates what the slot
 *     holds when it runs - the newest request - and then clears the slot,
 *     but only if it still holds the request that was evaluated.
 *
 * Every write is followed by an add, and that add resolves to a job that
 * starts after the write: a new job, the waiting job the add was discarded
 * into, or the job BullMQ queues after the active one. So the newest request
 * is always evaluated. A job that finds the slot empty knows a request at
 * least as new as its own was already evaluated - the clear only succeeds
 * when no write came in after that job read the slot - so it has nothing to
 * do, and an older request is never evaluated after a newer one.
 *
 * The slot is keyed exactly like the job's deduplication id (the secret key
 * as sent, hashed), not by the case-insensitive monitor identity: one
 * coalescing group, one slot. That keeps the slot evaluated by one job at a
 * time, which is what makes "clear only if unchanged" sufficient.
 */

export interface LatestIncomingRequestPayload {
  payloadId: string;
  payload: IncomingRequestIngestJobData;
}

/*
 * A distinct prefix so a cache audit or SCAN can find these, apart from the
 * telemetry body store and BullMQ's own keys.
 */
const KEY_PREFIX: string = "incoming-request:latest-payload:";

/*
 * Every request re-arms the expiry, and an evaluated slot is deleted, so this
 * only has to outlive the time a monitor's job can wait in the queue after
 * its last request - a Telemetry backlog. A day is far beyond that. A slot
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
 * Delete the slot only while it still holds the request the caller
 * evaluated. A plain DEL would also delete a newer request written while
 * that one was being evaluated, and nothing would evaluate it.
 */
const CLEAR_IF_UNCHANGED_SCRIPT: string =
  "if redis.call('HGET', KEYS[1], 'id') == ARGV[1] then " +
  "return redis.call('DEL', KEYS[1]) end " +
  "return 0";

export default class IncomingRequestLatestPayloadStore {
  public static readonly TTL_SECONDS: number = TTL_SECONDS;

  /*
   * The secret key travels in the URL, so it is hashed rather than spelled
   * out in the Redis key name.
   */
  public static getKey(secretKey: string): string {
    return `${KEY_PREFIX}${createHash("sha256").update(secretKey).digest("hex")}`;
  }

  /*
   * Make this request the newest one for its monitor. Throws when Redis is
   * unavailable: the caller must not add a job whose request is not stored.
   */
  public static async store(data: {
    secretKey: string;
    payloadId: string;
    payload: IncomingRequestIngestJobData;
  }): Promise<void> {
    const client: ClientType = this.getConnectedClient();

    await client.eval(
      STORE_SCRIPT,
      1,
      this.getKey(data.secretKey),
      data.payloadId,
      JSON.stringify(data.payload),
      String(TTL_SECONDS),
    );
  }

  /*
   * The newest request for this monitor that has not been evaluated, or null
   * when there is none. Throws when Redis is unavailable, so the job is
   * retried instead of completing without evaluating anything.
   */
  public static async getLatest(
    secretKey: string,
  ): Promise<LatestIncomingRequestPayload | null> {
    const client: ClientType = this.getConnectedClient();

    const [payloadId, payloadJson]: Array<string | null> = await client.hmget(
      this.getKey(secretKey),
      "id",
      "payload",
    );

    if (!payloadId || !payloadJson) {
      return null;
    }

    try {
      const payload: unknown = JSON.parse(payloadJson);

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("The stored payload is not an object");
      }

      return {
        payloadId: payloadId,
        payload: payload as IncomingRequestIngestJobData,
      };
    } catch (err) {
      /*
       * Unreadable, so it can never be evaluated; retrying would not change
       * that. The monitor's next request replaces it.
       */
      logger.error(
        "IncomingRequestLatestPayloadStore: could not read the stored incoming request. It is skipped.",
      );
      logger.error(err);
      return null;
    }
  }

  /*
   * Clear the slot after its request was evaluated, unless a newer request
   * replaced it meanwhile. Returns whether it was cleared. Best effort: a
   * slot left behind is harmless - the monitor's next request replaces it,
   * and the expiry reclaims it - so this never fails an evaluated job.
   */
  public static async clearIfUnchanged(data: {
    secretKey: string;
    payloadId: string;
  }): Promise<boolean> {
    try {
      const client: ClientType = this.getConnectedClient();

      const result: unknown = await client.eval(
        CLEAR_IF_UNCHANGED_SCRIPT,
        1,
        this.getKey(data.secretKey),
        data.payloadId,
      );

      return result === 1;
    } catch (err) {
      logger.warn(
        "IncomingRequestLatestPayloadStore: could not clear an evaluated incoming request. It expires on its own.",
      );
      logger.warn(err);
      return false;
    }
  }

  private static getConnectedClient(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new Error(
        "Redis not connected; cannot reach the incoming request store",
      );
    }

    return client;
  }
}
