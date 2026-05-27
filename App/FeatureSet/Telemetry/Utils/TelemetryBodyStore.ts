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
 * the worker reads + best-effort deletes via `getBuffer`. A
 * 1-hour TTL handles the edge case where the worker crashes
 * between read and delete or never picks up the job at all.
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
   * Fetch the raw payload buffer for a given key and best-effort
   * delete the key. Returns `null` if the key is gone (TTL expired
   * or it was processed by another worker before us). The DEL is
   * fire-and-forget — leaving an orphan for TTL_SECONDS is cheap;
   * blocking ingest on a DEL ack is not.
   */
  public static async readAndDeleteBody(key: string): Promise<Buffer | null> {
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

    // Best-effort delete; TTL is the safety net.
    client.del(key).catch((err: Error) => {
      logger.warn(`TelemetryBodyStore: DEL failed for ${key}`);
      logger.warn(err);
    });

    return buffer;
  }
}
