import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { createHash } from "crypto";
import { IncomingRequestIngestJobData } from "../Services/Queue/TelemetryQueueService";

/*
 * EVERY REQUEST AN INCOMING REQUEST MONITOR RECEIVED THAT NO WORKER HAS
 * EVALUATED YET - one list per monitor, oldest first, in Redis (#10582).
 *
 * A monitor's requests are queued with BullMQ deduplication keyed by the
 * monitor (keepLastIfActive), so a sender, however fast, has at most one job
 * running and one waiting for its monitor, and its evaluations never contend
 * for the monitor's lock. BullMQ keeps no request of its own: each one is
 * pushed here first, and the monitor's job, whichever request created it,
 * works through this list (ProcessIncomingRequestIngest).
 *
 * The list used to be one slot holding the newest request
 * (IncomingRequestLatestPayloadStore), and a job evaluated only that one.
 * Right for a heartbeat or a status-style sender, where only the newest
 * request matters. Lossy for a monitor whose criteria group by a payload
 * field: there every request is about another value, so a burst of
 * SolarWinds Orion alerts, or a trigger and its reset close together, left
 * some values' alerts unopened or unresolved. So every request is kept here,
 * and the job decides from the monitor's criteria whether to evaluate each in
 * turn or only the newest.
 *
 * Two keys per monitor, both named by the hash of its secret key (it travels
 * in the URL, so it is not spelled out in a key name), the coalescing group
 * the job's deduplication id names too:
 *
 *   incoming-request:pending:<hash>           a list of request ids, oldest
 *                                              first;
 *   incoming-request:pending-requests:<hash>  a hash: each id's request as
 *                                              the job would have carried it,
 *                                              how often evaluating it failed
 *                                              ("failures:<id>"), the bytes
 *                                              the requests take ("bytes"),
 *                                              and the requests skipped and
 *                                              not yet said so in the
 *                                              monitor's log.
 *
 * Bounded: a monitor keeps at most MAX_PENDING_REQUESTS_PER_MONITOR waiting
 * requests and MAX_PENDING_BYTES_PER_MONITOR of them. Past either, the
 * oldest waiting are skipped - never the newest, which is always evaluated,
 * and never the oldest of all, which a job may be evaluating - and counted,
 * so the monitor's log says how many were skipped (skippedOverLimit). Every
 * push re-arms both keys' expiry.
 *
 * A request is removed only once it was evaluated, superseded by a newer one
 * (a monitor that evaluates only its newest), or skipped, so a worker that
 * dies part-way through a list leaves the rest - and the request it was
 * evaluating - for the next job. Removal is by id, so it removes exactly the
 * request evaluated, wherever the list holds it, and nothing when a limit
 * already skipped it.
 */

export interface PendingIncomingRequest {
  requestId: string;
  // The request, as a job of its own would have carried it.
  payload: IncomingRequestIngestJobData;
  // How many times evaluating it has failed already.
  failures: number;
  // How many requests are waiting, this one included.
  waiting: number;
  // Requests skipped that the monitor's log has not said yet.
  skipped: SkippedIncomingRequests;
}

export interface SkippedIncomingRequests {
  // Skipped because more were waiting than a monitor keeps.
  overLimit: number;
  // Skipped after evaluating them failed MAX_ATTEMPTS times.
  afterFailures: number;
}

export interface PushedIncomingRequest {
  // How many requests are waiting, this one included.
  waiting: number;
  // How many older ones this push skipped to stay within the limits.
  skipped: number;
}

const LIST_KEY_PREFIX: string = "incoming-request:pending:";
const REQUESTS_KEY_PREFIX: string = "incoming-request:pending-requests:";

/*
 * A burst far beyond what a monitor is sent at once - a switch down that
 * fires an alert per port, Alertmanager after a network partition heals - and
 * still bounded: at ~100 ms an evaluation, a full list is evaluated in under
 * two minutes. The bytes bound a sender of large requests: 16 MB is a few
 * thousand typical webhooks, and one request larger than that is still kept
 * whole - it is the newest when it arrives.
 */
export const MAX_PENDING_REQUESTS_PER_MONITOR: number = 1000;
export const MAX_PENDING_BYTES_PER_MONITOR: number = 16 * 1024 * 1024;

/*
 * Every push re-arms it, and an empty list is deleted, so this only has to
 * outlive the time a monitor's job can wait in a Telemetry backlog after its
 * last request. A day is far beyond that, and a list whose job never runs
 * still ages out.
 */
const TTL_SECONDS: number = OneUptimeDate.getSecondsInDays(1);

/*
 * Deletes the requests hash once the list is empty and nothing skipped is
 * left to report: a monitor that is not sent anything holds no keys. Shared by
 * every script that removes requests. KEYS[1] the list, KEYS[2] the hash.
 */
const DELETE_WHEN_DONE: string =
  "local function deleteWhenDone() " +
  "if redis.call('LLEN', KEYS[1]) == 0 then " +
  "local notes = redis.call('HMGET', KEYS[2], 'skippedOverLimit', 'skippedAfterFailures') " +
  "if not notes[1] and not notes[2] then redis.call('DEL', KEYS[2]) end " +
  "end " +
  "end ";

// Forget one request's payload and failure count. KEYS[2] the hash.
const FORGET_REQUEST: string =
  "local function forgetRequest(id) " +
  "local size = redis.call('HSTRLEN', KEYS[2], id) " +
  "if size > 0 then redis.call('HINCRBY', KEYS[2], 'bytes', -size) end " +
  "redis.call('HDEL', KEYS[2], id, 'failures:' .. id) " +
  "end ";

/*
 * Push a request behind the monitor's others, skip the oldest waiting past
 * either limit - keeping the oldest of all, which a job may be evaluating,
 * and this one, the newest - count what was skipped, and re-arm both keys'
 * expiry. ARGV: id, payload, max requests, max bytes, ttl. Returns how many
 * are waiting and how many were skipped.
 */
const PUSH_SCRIPT: string =
  FORGET_REQUEST +
  "redis.call('RPUSH', KEYS[1], ARGV[1]) " +
  "redis.call('HSET', KEYS[2], ARGV[1], ARGV[2]) " +
  "local bytes = redis.call('HINCRBY', KEYS[2], 'bytes', string.len(ARGV[2])) " +
  "local waiting = redis.call('LLEN', KEYS[1]) " +
  "local maxRequests = tonumber(ARGV[3]) " +
  "local maxBytes = tonumber(ARGV[4]) " +
  "local skipped = 0 " +
  "while waiting > 2 and (waiting > maxRequests or bytes > maxBytes) do " +
  "local oldest = redis.call('LPOP', KEYS[1]) " +
  "local skippedId = redis.call('LPOP', KEYS[1]) " +
  "redis.call('LPUSH', KEYS[1], oldest) " +
  "forgetRequest(skippedId) " +
  "bytes = tonumber(redis.call('HGET', KEYS[2], 'bytes') or '0') " +
  "waiting = waiting - 1 " +
  "skipped = skipped + 1 " +
  "end " +
  "if skipped > 0 then redis.call('HINCRBY', KEYS[2], 'skippedOverLimit', skipped) end " +
  "redis.call('EXPIRE', KEYS[1], ARGV[5]) " +
  "redis.call('EXPIRE', KEYS[2], ARGV[5]) " +
  "return {waiting, skipped}";

/*
 * The request at ARGV[1] (0 the oldest, -1 the newest), with its failures,
 * how many are waiting and what was skipped, read in one go. A listed id
 * whose request is gone - its hash evicted or expired apart from the list -
 * can never be evaluated: it is removed, counted as lost, and the next one
 * read. Returns {id, payload, failures, waiting, skippedOverLimit,
 * skippedAfterFailures, lost}, or {false, ..., lost} when none is waiting.
 */
const PEEK_SCRIPT: string =
  DELETE_WHEN_DONE +
  "local lost = 0 " +
  "while true do " +
  "local id = redis.call('LINDEX', KEYS[1], tonumber(ARGV[1])) " +
  "local notes = redis.call('HMGET', KEYS[2], 'skippedOverLimit', 'skippedAfterFailures') " +
  "if not id then " +
  "deleteWhenDone() " +
  "return {false, false, false, 0, notes[1], notes[2], lost} " +
  "end " +
  "local values = redis.call('HMGET', KEYS[2], id, 'failures:' .. id) " +
  "if values[1] then " +
  "return {id, values[1], values[2], redis.call('LLEN', KEYS[1]), notes[1], notes[2], lost} " +
  "end " +
  "redis.call('LREM', KEYS[1], 1, id) " +
  "redis.call('HDEL', KEYS[2], 'failures:' .. id) " +
  "lost = lost + 1 " +
  "end";

/*
 * Remove one request, wherever the list holds it; ARGV[2] "1" also counts
 * it as skipped after failing. Returns 1 if it was still waiting.
 */
const REMOVE_SCRIPT: string =
  DELETE_WHEN_DONE +
  FORGET_REQUEST +
  "local removed = redis.call('LREM', KEYS[1], 1, ARGV[1]) " +
  "forgetRequest(ARGV[1]) " +
  "if removed > 0 and ARGV[2] == '1' then " +
  "redis.call('HINCRBY', KEYS[2], 'skippedAfterFailures', 1) " +
  "end " +
  "deleteWhenDone() " +
  "return removed";

/*
 * Remove every request from the oldest through ARGV[1]: a monitor that
 * evaluates only its newest request evaluated ARGV[1], and every request
 * before it is superseded. Nothing when ARGV[1] is no longer waiting.
 * Returns how many were removed.
 */
const REMOVE_THROUGH_SCRIPT: string =
  DELETE_WHEN_DONE +
  FORGET_REQUEST +
  "local ids = redis.call('LRANGE', KEYS[1], 0, -1) " +
  "local through = 0 " +
  "for index, id in ipairs(ids) do " +
  "if id == ARGV[1] then through = index break end " +
  "end " +
  "for index = 1, through do " +
  "forgetRequest(redis.call('LPOP', KEYS[1])) " +
  "end " +
  "deleteWhenDone() " +
  "return through";

/*
 * Count one more failed evaluation of a request that is still waiting.
 * Returns how many times it has failed, or 0 when it is no longer waiting.
 */
const COUNT_FAILURE_SCRIPT: string =
  "if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then return 0 end " +
  "return redis.call('HINCRBY', KEYS[2], 'failures:' .. ARGV[1], 1)";

/*
 * The monitor's log has said ARGV[1] requests were skipped over the limit
 * and ARGV[2] after failing: take them off what is left to say.
 */
const ACKNOWLEDGE_SKIPPED_SCRIPT: string =
  DELETE_WHEN_DONE +
  "local fields = {'skippedOverLimit', 'skippedAfterFailures'} " +
  "for index, field in ipairs(fields) do " +
  "local said = tonumber(ARGV[index]) " +
  "if said and said > 0 then " +
  "local left = redis.call('HINCRBY', KEYS[2], field, -said) " +
  "if left <= 0 then redis.call('HDEL', KEYS[2], field) end " +
  "end " +
  "end " +
  "deleteWhenDone() " +
  "return 1";

type PeekReply = [
  string | null,
  string | null,
  string | null,
  number,
  string | null,
  string | null,
  number,
];

export default class IncomingRequestPendingStore {
  public static readonly TTL_SECONDS: number = TTL_SECONDS;

  /*
   * Names a monitor's waiting requests and its job's deduplication id: the
   * secret key as sent, hashed. One coalescing group, one list, so one job
   * at a time works through it.
   */
  public static getSecretKeyHash(secretKey: string): string {
    return createHash("sha256").update(secretKey).digest("hex");
  }

  public static getListKey(secretKeyHash: string): string {
    return `${LIST_KEY_PREFIX}${secretKeyHash}`;
  }

  public static getRequestsKey(secretKeyHash: string): string {
    return `${REQUESTS_KEY_PREFIX}${secretKeyHash}`;
  }

  /*
   * Keep a request behind the monitor's others. Throws when Redis is
   * unavailable: the endpoint then answers 503, and the sender sends it
   * again.
   */
  public static async push(data: {
    secretKey: string;
    requestId: string;
    payload: IncomingRequestIngestJobData;
  }): Promise<PushedIncomingRequest> {
    const secretKeyHash: string = this.getSecretKeyHash(data.secretKey);

    const reply: unknown = await this.getConnectedClient().eval(
      PUSH_SCRIPT,
      2,
      this.getListKey(secretKeyHash),
      this.getRequestsKey(secretKeyHash),
      data.requestId,
      JSON.stringify(data.payload),
      String(MAX_PENDING_REQUESTS_PER_MONITOR),
      String(MAX_PENDING_BYTES_PER_MONITOR),
      String(TTL_SECONDS),
    );

    const [waiting, skipped]: Array<unknown> = Array.isArray(reply)
      ? reply
      : [];

    return {
      waiting: Number(waiting) || 0,
      skipped: Number(skipped) || 0,
    };
  }

  // The oldest waiting request, or null when none is waiting.
  public static async peekOldest(
    secretKeyHash: string,
  ): Promise<PendingIncomingRequest | null> {
    return this.peek(secretKeyHash, 0);
  }

  // The newest waiting request, or null when none is waiting.
  public static async peekNewest(
    secretKeyHash: string,
  ): Promise<PendingIncomingRequest | null> {
    return this.peek(secretKeyHash, -1);
  }

  // What was skipped and not yet said, whether or not anything is waiting.
  public static async getSkipped(
    secretKeyHash: string,
  ): Promise<SkippedIncomingRequests> {
    const [overLimit, afterFailures]: Array<string | null> =
      await this.getConnectedClient().hmget(
        this.getRequestsKey(secretKeyHash),
        "skippedOverLimit",
        "skippedAfterFailures",
      );

    return {
      overLimit: this.toCount(overLimit),
      afterFailures: this.toCount(afterFailures),
    };
  }

  // Remove a request once it was evaluated. Returns whether it was waiting.
  public static async remove(
    secretKeyHash: string,
    requestId: string,
  ): Promise<boolean> {
    return (await this.runRemove(secretKeyHash, requestId, false)) === 1;
  }

  /*
   * Give up on a request whose evaluation failed MAX_ATTEMPTS times: removed,
   * and counted for the monitor's log to say so.
   */
  public static async skipAfterFailures(
    secretKeyHash: string,
    requestId: string,
  ): Promise<boolean> {
    return (await this.runRemove(secretKeyHash, requestId, true)) === 1;
  }

  /*
   * Remove every request from the oldest through `requestId`, the newest one
   * a monitor that evaluates only its newest has just evaluated. Returns how
   * many were removed.
   */
  public static async removeThrough(
    secretKeyHash: string,
    requestId: string,
  ): Promise<number> {
    const removed: unknown = await this.getConnectedClient().eval(
      REMOVE_THROUGH_SCRIPT,
      2,
      this.getListKey(secretKeyHash),
      this.getRequestsKey(secretKeyHash),
      requestId,
    );

    return Number(removed) || 0;
  }

  /*
   * Count one more failed evaluation of a waiting request. Returns how many
   * times it has failed, or 0 when it is no longer waiting.
   */
  public static async countFailure(
    secretKeyHash: string,
    requestId: string,
  ): Promise<number> {
    const failures: unknown = await this.getConnectedClient().eval(
      COUNT_FAILURE_SCRIPT,
      2,
      this.getListKey(secretKeyHash),
      this.getRequestsKey(secretKeyHash),
      requestId,
    );

    return Number(failures) || 0;
  }

  /*
   * The monitor's log said these were skipped (or, for a monitor that
   * evaluates only its newest request, they need no saying): take them off
   * what is left to say. Best effort: a count left behind is said again by
   * the next evaluation, never lost.
   */
  public static async acknowledgeSkipped(
    secretKeyHash: string,
    skipped: SkippedIncomingRequests,
  ): Promise<void> {
    if (skipped.overLimit <= 0 && skipped.afterFailures <= 0) {
      return;
    }

    try {
      await this.getConnectedClient().eval(
        ACKNOWLEDGE_SKIPPED_SCRIPT,
        2,
        this.getListKey(secretKeyHash),
        this.getRequestsKey(secretKeyHash),
        String(Math.max(0, skipped.overLimit)),
        String(Math.max(0, skipped.afterFailures)),
      );
    } catch (err) {
      logger.warn(
        "IncomingRequestPendingStore: could not mark skipped incoming requests as reported. They are reported again.",
      );
      logger.warn(err);
    }
  }

  public static async hasPending(secretKeyHash: string): Promise<boolean> {
    const waiting: number = await this.getConnectedClient().llen(
      this.getListKey(secretKeyHash),
    );

    return waiting > 0;
  }

  private static async runRemove(
    secretKeyHash: string,
    requestId: string,
    countAsSkipped: boolean,
  ): Promise<number> {
    const removed: unknown = await this.getConnectedClient().eval(
      REMOVE_SCRIPT,
      2,
      this.getListKey(secretKeyHash),
      this.getRequestsKey(secretKeyHash),
      requestId,
      countAsSkipped ? "1" : "0",
    );

    return Number(removed) || 0;
  }

  private static async peek(
    secretKeyHash: string,
    index: 0 | -1,
  ): Promise<PendingIncomingRequest | null> {
    for (;;) {
      const reply: PeekReply = (await this.getConnectedClient().eval(
        PEEK_SCRIPT,
        2,
        this.getListKey(secretKeyHash),
        this.getRequestsKey(secretKeyHash),
        String(index),
      )) as PeekReply;

      const [
        requestId,
        payloadJson,
        failures,
        waiting,
        overLimit,
        afterFailures,
        lost,
      ]: PeekReply = reply;

      if (Number(lost) > 0) {
        logger.error(
          `IncomingRequestPendingStore: ${Number(lost)} waiting incoming request(s) of a monitor were lost from Redis before they were evaluated.`,
        );
      }

      if (!requestId || !payloadJson) {
        return null;
      }

      const skipped: SkippedIncomingRequests = {
        overLimit: this.toCount(overLimit),
        afterFailures: this.toCount(afterFailures),
      };

      try {
        const payload: unknown = JSON.parse(payloadJson);

        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("The stored request is not an object");
        }

        return {
          requestId: requestId,
          payload: payload as IncomingRequestIngestJobData,
          failures: this.toCount(failures),
          waiting: Number(waiting) || 0,
          skipped: skipped,
        };
      } catch (err) {
        /*
         * Unreadable, so it can never be evaluated; retrying would not change
         * that. Skipped, and said so, like a request that keeps failing.
         */
        logger.error(
          "IncomingRequestPendingStore: could not read a waiting incoming request. It is skipped.",
        );
        logger.error(err);
        await this.skipAfterFailures(secretKeyHash, requestId);
      }
    }
  }

  private static toCount(value: unknown): number {
    const count: number = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  private static getConnectedClient(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new Error(
        "Redis is not connected, so waiting incoming requests cannot be kept or read.",
      );
    }

    return client;
  }
}
