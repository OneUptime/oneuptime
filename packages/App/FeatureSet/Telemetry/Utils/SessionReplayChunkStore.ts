import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";

/*
 * Out-of-band staging for session-replay chunk bodies that are too large to
 * ride inline in the BullMQ job.
 *
 * Deliberately a separate store from TelemetryBodyStore rather than a shared
 * one, for three reasons that all matter operationally:
 *
 *   1. A distinct key prefix means a cache audit, a SCAN, or an incident
 *      response can see replay staging separately from OTLP staging. They
 *      have very different sizes and very different sensitivity.
 *   2. A 6-hour TTL rather than 1 hour. A replay chunk can be posted by a
 *      recorder that has been offline and is catching up, and BullMQ retry
 *      exhaustion on a deep queue must not lose a recording that cannot be
 *      re-derived from anywhere.
 *   3. Only chunks over the inline threshold land here at all. A typical
 *      chunk is a few KB and rides base64 inside the job, so in steady
 *      state this store holds tens of MB, not gigabytes. That is
 *      load-bearing: compose runs Redis with `--save "" --appendonly no`
 *      and no configured maxmemory, and Helm gives it an emptyDir.
 *
 * Read-without-delete is preserved from TelemetryBodyStore for the same
 * reason it exists there: a job can fail a transient downstream error AFTER
 * reading the body, and a delete-on-read would make every retry decode an
 * empty payload and fail permanently with a misleading error.
 */

const KEY_PREFIX: string = "replay:chunk:";

const TTL_SECONDS: number = 6 * 60 * 60;

export default class SessionReplayChunkStore {
  /*
   * Persist a staged chunk body and return the key to carry in the job.
   *
   * Throws when Redis is unavailable. Callers must turn that into a 503 and
   * never a 202: telling a recorder its chunk was accepted when it was not
   * staged loses the recording permanently, because the recorder drops its
   * buffer on a success response.
   */
  public static async storeBody(buffer: Buffer): Promise<string> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new Error(
        "Redis not connected; cannot stage session replay chunk body",
      );
    }

    const key: string = `${KEY_PREFIX}${ObjectID.generate().toString()}`;

    /*
     * ioredis keeps a Buffer value binary on the wire, and "EX" sets the
     * expiry atomically with the write so a staged body can never end up
     * without a TTL.
     */
    await client.set(key, buffer, "EX", TTL_SECONDS);

    return key;
  }

  public static async readBody(key: string): Promise<Buffer | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new Error(
        "Redis not connected; cannot read staged session replay chunk body",
      );
    }

    const buffer: Buffer | null = await client.getBuffer(key);

    if (!buffer) {
      logger.warn(
        `SessionReplayChunkStore: staged chunk not found or expired (${key}). The chunk is lost.`,
      );
      return null;
    }

    return buffer;
  }

  /*
   * Best-effort reclaim once the job has succeeded. Fire-and-forget: an
   * orphan costs at most the TTL, whereas a failing DEL must never turn an
   * already-successful job into a retry that re-inserts rows.
   */
  public static async deleteBody(key: string): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    client.del(key).catch((err: Error) => {
      logger.warn(`SessionReplayChunkStore: DEL failed for ${key}`);
      logger.warn(err);
    });
  }
}
