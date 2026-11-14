import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import { ProbeIngestJobData } from "../Services/Queue/TelemetryQueueService";

/*
 * THE SNMP TRAPS FROM ONE SENDER THAT NO WORKER HAS PROCESSED YET - one list
 * per (probe, source address), oldest first, in Redis.
 *
 * Every trap used to be a telemetry job of its own. A device in trouble can
 * send hundreds a second - a flapping port, an authentication failure on
 * every poll of a misconfigured manager, an environmental alarm repeated
 * every second - and each job looked up the sender's devices and monitors on
 * its own, so one noisy sender could fill the queue ahead of everything
 * else.
 *
 * So a backlog holds at most one pending trap job per sender: traps are
 * queued with BullMQ deduplication keyed by (probe, source address),
 * keepLastIfActive, and each trap is pushed here first. The sender's job,
 * whichever trap created it, works through the list in order: a trap is
 * events, not state, so unlike a poll none is skipped for a newer one - a
 * linkDown is processed before the linkUp that followed it.
 *
 * Bounded: a sender with more than MAX_PENDING_TRAPS_PER_SENDER traps
 * waiting loses its oldest (logged), so one runaway device cannot grow Redis
 * without limit. Every push re-arms the list's expiry.
 *
 * A trap is removed only after it was processed (or given up on after
 * MAX_ATTEMPTS_PER_TRAP failures), so a worker that dies while processing
 * one leaves it for the next job. One that fails stays at the head of its
 * sender's list for the job's retry, counted, so a trap that can never be
 * processed is given up on instead of holding up its sender for good.
 */

export interface PendingSnmpTrap {
  // The list entry as stored, to remove exactly it.
  raw: string;
  // The trap's job data, as a job would have carried it.
  payload: ProbeIngestJobData;
  // How many times processing it has failed already.
  attempts: number;
}

interface StoredTrap {
  payload: ProbeIngestJobData;
  attempts?: number | undefined;
}

const KEY_PREFIX: string = "snmp-trap:pending:";

export const MAX_PENDING_TRAPS_PER_SENDER: number = 10_000;

export const MAX_ATTEMPTS_PER_TRAP: number = 3;

const TTL_SECONDS: number = OneUptimeDate.getSecondsInDays(1);

/*
 * Push a trap, drop the oldest past the limit, re-arm the expiry. Returns
 * how many were dropped.
 */
const PUSH_SCRIPT: string =
  "local length = redis.call('RPUSH', KEYS[1], ARGV[1]) " +
  "local max = tonumber(ARGV[2]) " +
  "local dropped = 0 " +
  "if length > max then " +
  "dropped = length - max " +
  "redis.call('LTRIM', KEYS[1], dropped, -1) " +
  "end " +
  "redis.call('EXPIRE', KEYS[1], ARGV[3]) " +
  "return dropped";

// Remove the head only while it is still the entry the caller processed.
const REMOVE_HEAD_IF_SCRIPT: string =
  "if redis.call('LINDEX', KEYS[1], 0) == ARGV[1] then " +
  "redis.call('LPOP', KEYS[1]) return 1 end " +
  "return 0";

// Replace the head only while it is still the entry the caller read.
const REPLACE_HEAD_IF_SCRIPT: string =
  "if redis.call('LINDEX', KEYS[1], 0) == ARGV[1] then " +
  "redis.call('LSET', KEYS[1], 0, ARGV[2]) return 1 end " +
  "return 0";

export default class SnmpTrapPendingStore {
  public static readonly TTL_SECONDS: number = TTL_SECONDS;

  public static getKey(probeId: string, sourceIpAddress: string): string {
    return `${KEY_PREFIX}${probeId}:${sourceIpAddress}`;
  }

  /*
   * Queue a trap behind its sender's others. Throws when Redis is
   * unavailable: the caller must not add a job for a trap that is not
   * stored.
   */
  public static async push(data: {
    probeId: string;
    sourceIpAddress: string;
    payload: ProbeIngestJobData;
  }): Promise<void> {
    const stored: StoredTrap = { payload: data.payload };

    const dropped: unknown =
      await SnmpTrapPendingStore.getConnectedClient().eval(
        PUSH_SCRIPT,
        1,
        SnmpTrapPendingStore.getKey(data.probeId, data.sourceIpAddress),
        JSON.stringify(stored),
        String(MAX_PENDING_TRAPS_PER_SENDER),
        String(TTL_SECONDS),
      );

    if (typeof dropped === "number" && dropped > 0) {
      logger.warn(
        `SNMP traps from ${data.sourceIpAddress} via probe ${data.probeId}: more than ${MAX_PENDING_TRAPS_PER_SENDER} are waiting to be processed, so the oldest ${dropped} was dropped.`,
      );
    }
  }

  /*
   * The sender's oldest trap, or null when none is waiting. An entry that
   * cannot be read is removed and the next one returned.
   */
  public static async peekOldest(
    probeId: string,
    sourceIpAddress: string,
  ): Promise<PendingSnmpTrap | null> {
    const client: ClientType = SnmpTrapPendingStore.getConnectedClient();
    const key: string = SnmpTrapPendingStore.getKey(probeId, sourceIpAddress);

    for (;;) {
      const raw: string | null = await client.lindex(key, 0);

      if (raw === null) {
        return null;
      }

      try {
        const stored: StoredTrap = JSON.parse(raw) as StoredTrap;

        if (
          !stored ||
          typeof stored !== "object" ||
          !stored.payload ||
          typeof stored.payload !== "object"
        ) {
          throw new Error("The stored trap is not an object");
        }

        return {
          raw: raw,
          payload: stored.payload,
          attempts:
            typeof stored.attempts === "number" && stored.attempts > 0
              ? stored.attempts
              : 0,
        };
      } catch (err) {
        logger.error(
          `SnmpTrapPendingStore: could not read a stored trap from ${sourceIpAddress}. It is skipped.`,
        );
        logger.error(err);
        await SnmpTrapPendingStore.removeOldest(probeId, sourceIpAddress, raw);
      }
    }
  }

  // Remove the sender's oldest trap, if it is still `raw`.
  public static async removeOldest(
    probeId: string,
    sourceIpAddress: string,
    raw: string,
  ): Promise<boolean> {
    const removed: unknown =
      await SnmpTrapPendingStore.getConnectedClient().eval(
        REMOVE_HEAD_IF_SCRIPT,
        1,
        SnmpTrapPendingStore.getKey(probeId, sourceIpAddress),
        raw,
      );

    return removed === 1;
  }

  /*
   * Count one more failure against the sender's oldest trap, if it is still
   * `trap`. Best effort: a count not written only means one more attempt.
   */
  public static async countFailure(
    probeId: string,
    sourceIpAddress: string,
    trap: PendingSnmpTrap,
  ): Promise<void> {
    const stored: StoredTrap = {
      payload: trap.payload,
      attempts: trap.attempts + 1,
    };

    try {
      await SnmpTrapPendingStore.getConnectedClient().eval(
        REPLACE_HEAD_IF_SCRIPT,
        1,
        SnmpTrapPendingStore.getKey(probeId, sourceIpAddress),
        trap.raw,
        JSON.stringify(stored),
      );
    } catch (err) {
      logger.warn(
        `SnmpTrapPendingStore: could not count a failed trap from ${sourceIpAddress}.`,
      );
      logger.warn(err);
    }
  }

  public static async hasPending(
    probeId: string,
    sourceIpAddress: string,
  ): Promise<boolean> {
    const length: number = await SnmpTrapPendingStore.getConnectedClient().llen(
      SnmpTrapPendingStore.getKey(probeId, sourceIpAddress),
    );

    return length > 0;
  }

  private static getConnectedClient(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new Error(
        "Redis is not connected, so waiting SNMP traps cannot be stored or read.",
      );
    }

    return client;
  }
}
