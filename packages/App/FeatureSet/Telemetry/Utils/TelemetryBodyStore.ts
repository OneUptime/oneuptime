import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";

/*
 * Out-of-band store for raw OTel ingest payloads.
 *
 * The legacy path put `buffer.toString("base64")` into the BullMQ
 * job data, which had three serious costs on the HTTP request
 * thread:
 *
 *   1. base64 encoding is synchronous CPU; a 50 MB payload
 *      burned ~150 ms of unbroken event-loop time per request.
 *   2. base64 inflates the body by ~33 %, so Redis (and BullMQ's
 *      JSON-serialized job state) stored ~67 MB for every 50 MB
 *      ingest.
 *   3. The worker had to base64-decode it back — another CPU
 *      pass on the worker side.
 *
 * This store keeps the body OUT of the BullMQ job payload. We
 * SET the raw `Buffer` against a UUID key directly via ioredis
 * (binary-safe — `client.set(key, Buffer)` keeps bytes as bytes,
 * no string coercion), put only the key into the job data, and
 * the worker reads it via `getBuffer` (readBody, no delete) and
 * reclaims it via `deleteBody` only AFTER the job succeeds — so a
 * transient-failure retry can re-read the same body. A 1-hour TTL
 * handles the edge cases where the job is dropped, exhausts its
 * retries, or is never picked up at all.
 *
 * Net effect: the HTTP path does a single binary `SET` per
 * request instead of a CPU-bound encode plus a larger `SET`.
 */

/*
 * Prefix every key with this namespace so cache audits / scans
 * can find orphans easily and so we don't collide with any other
 * Redis key (BullMQ uses `bull:`, GlobalCache uses its own
 * `<namespace>-<key>` shape).
 */
const KEY_PREFIX: string = "telemetry:body:";
/*
 * 1-hour expiry. The worker normally picks up the job in seconds;
 * the only reason this TTL exists is to reclaim orphans when the
 * job is dropped (BullMQ retry exhaustion, manual queue purge, or
 * a worker crash between dequeue and read). Long enough that even
 * a deep queue with a sustained backlog will not lose bodies, short
 * enough that orphaned blobs from a misconfigured cluster don't
 * pile up forever in Redis.
 */
const TTL_SECONDS: number = 60 * 60;

export default class TelemetryBodyStore {
  /*
   * Persist a raw payload buffer and return the lookup key that
   * should be carried in the BullMQ job data. Throws if Redis is
   * unavailable — callers (the HTTP enqueue path) propagate that
   * as a 5xx, which is correct: we can't ingest without storage.
   */
  public static async storeBody(buffer: Buffer): Promise<string> {
    const client: ClientType | null = Redis.getClient();
    if (!client || !Redis.isConnected()) {
      throw new Error("Redis not connected; cannot store telemetry body");
    }

    const key: string = `${KEY_PREFIX}${ObjectID.generate().toString()}`;

    /*
     * ioredis' `set` signature accepts a Buffer for `value` and
     * keeps it binary on the wire (no UTF-8 conversion). `"EX"`
     * sets the TTL atomically with the write so we never end up
     * with a body that has no expiry.
     */
    await client.set(key, buffer, "EX", TTL_SECONDS);

    return key;
  }

  /*
   * Fetch the raw payload buffer for a given key WITHOUT deleting it.
   * Returns `null` if the key is gone (the TTL elapsed before the worker
   * got to it, or it was never stored).
   *
   * The body is deliberately NOT deleted on read. A worker job can fail a
   * transient downstream error (e.g. "ClickHouse ingest client is not
   * connected" while a freshly-deployed pod warms up) AFTER the body has
   * been read; if we deleted here, every BullMQ retry would then decode an
   * empty payload and fail permanently with a misleading "Invalid
   * resourceSpans format", masking the real first-attempt error. Leaving
   * the body in place lets the retry re-read and succeed. The body is
   * reclaimed by deleteBody() once the job succeeds, with the TTL as the
   * backstop for jobs that are dropped or exhaust their retries.
   */
  public static async readBody(key: string): Promise<Buffer | null> {
    const client: ClientType | null = Redis.getClient();
    if (!client || !Redis.isConnected()) {
      throw new Error("Redis not connected; cannot read telemetry body");
    }

    const buffer: Buffer | null = await client.getBuffer(key);

    if (!buffer) {
      logger.warn(
        `TelemetryBodyStore: body key not found or expired (${key}). The job will be processed with an empty payload.`,
      );
      return null;
    }

    return buffer;
  }

  /*
   * Best-effort reclaim of a consumed body. Called only after the worker
   * job succeeds, so the blob does not linger for the full TTL. The DEL is
   * fire-and-forget — leaving an orphan until TTL_SECONDS is cheap, and a
   * delete must never block (or fail) an already-successful job. A missing
   * key or a disconnected Redis is a no-op (the TTL reclaims it).
   */
  public static async deleteBody(key: string): Promise<void> {
    const client: ClientType | null = Redis.getClient();
    if (!client || !Redis.isConnected()) {
      return;
    }

    client.del(key).catch((err: Error) => {
      logger.warn(`TelemetryBodyStore: DEL failed for ${key}`);
      logger.warn(err);
    });
  }
}
