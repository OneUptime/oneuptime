import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";

/*
 * The erasure tombstone.
 *
 * When a GDPR / CCPA erasure runs, the ClickHouse side is an
 * `ALTER ... DELETE` mutation that only ever rewrites the parts that
 * existed when it was submitted. Session chunks, meanwhile, are staged in
 * Redis for hours and drained by a retrying queue consumer, so a chunk that
 * was accepted BEFORE the erasure can be inserted into a brand new part
 * AFTER it. The mutation never sees that part, and the erased recording is
 * permanently resurrected.
 *
 * The tombstone is the only thing standing between a delayed redelivery and
 * an un-erased recording, so every writer of session-replay rows has to
 * consult it:
 *
 *   - the ingest path, before staging a chunk and again before inserting it
 *   - the finalizer, before writing the session header
 *
 * This module is deliberately NOT in a cron job module: the ingest path
 * runs in the API process, and importing a job module there would register
 * a cron in the wrong process.
 *
 * FAIL CLOSED. Every helper here treats "Redis is unreachable" as "assume
 * erased". Refusing to write one recording because Redis blipped is a
 * recoverable annoyance; writing back a recording the subject asked to have
 * destroyed is not.
 */

export function getErasedSessionsKey(projectId: string): string {
  return `replay:erased:${projectId}`;
}

/*
 * Tombstone lifetime. Must comfortably outlast the chunk staging TTL plus
 * the queue's maximum retry window, or a delayed redelivery could reinstate
 * an erased session. Refreshed on every write.
 */
export const ERASURE_TOMBSTONE_TTL_SECONDS: number = 7 * 24 * 60 * 60;

/*
 * Write the tombstone. Callers MUST do this before deleting anything:
 * deleting first and tombstoning afterwards leaves a window in which a
 * staged chunk can be inserted back into a recording that is already gone
 * from ClickHouse.
 *
 * Throws when Redis is unavailable, which aborts the erasure batch. An
 * erasure without a tombstone is worse than a deferred erasure.
 */
export async function writeErasureTombstones(data: {
  projectId: string;
  sessionIds: Array<string>;
}): Promise<void> {
  if (data.sessionIds.length === 0) {
    return;
  }

  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    throw new Error(
      "Redis is not connected; refusing to erase sessions without a tombstone the ingest path can check",
    );
  }

  const key: string = getErasedSessionsKey(data.projectId);

  await client.sadd(key, data.sessionIds);
  await client.expire(key, ERASURE_TOMBSTONE_TTL_SECONDS);
}

/*
 * Thrown when the tombstone cannot be consulted at all. Callers must NOT
 * write session-replay rows in this state; a distinct error type is used
 * so a "we could not check" is never mistaken for a "not erased".
 */
export class ErasureTombstoneUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ErasureTombstoneUnavailableError";
  }
}

/*
 * Is this session tombstoned?
 *
 * THROWS ErasureTombstoneUnavailableError when Redis cannot answer, rather
 * than returning either boolean. Returning false would resurrect erased
 * recordings; returning true would tell the caller "this is erased, stop
 * retrying" and permanently drop a perfectly good session on a transient
 * blip. A throw is the only answer that is both fail-closed and
 * retry-safe: every caller here is inside a retrying loop.
 */
export async function isSessionErased(data: {
  projectId: string;
  sessionId: string;
}): Promise<boolean> {
  if (!data.sessionId) {
    return false;
  }

  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    logger.warn(
      "SessionReplayErasureTombstone: Redis is unavailable; refusing to answer whether the session is erased.",
    );

    throw new ErasureTombstoneUnavailableError(
      "Redis is not connected; cannot check the session replay erasure tombstone",
    );
  }

  try {
    const isMember: number = await client.sismember(
      getErasedSessionsKey(data.projectId),
      data.sessionId,
    );

    return isMember === 1;
  } catch (error) {
    throw new ErasureTombstoneUnavailableError(
      `Session replay erasure tombstone lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
