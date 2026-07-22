import Redis from "../../Infrastructure/Redis";
import logger from "../Logger";

/*
 * Fleet-wide load-shed counter for the telemetry-writer tier, used as the
 * KEDA autoscaling signal: sustained 429 shedding while ClickHouse is
 * healthy is the one honest "the writer tier is too small" indicator
 * (queue depth is the WORKER fleet's signal and must never scale this
 * tier).
 *
 * Every shed increments a per-minute Redis bucket shared by all writer
 * pods; the metric endpoint sums the current and previous buckets, so any
 * single pod KEDA happens to poll reports the whole tier's shed count for
 * roughly the last one-to-two minutes. Buckets expire after five minutes.
 *
 * Metrics must never break serving: both functions swallow Redis errors
 * (recordShed silently, the reader by returning 0 — which biases KEDA
 * toward NOT scaling on missing data, the safe direction for a tier whose
 * ceiling is a ClickHouse capacity budget).
 */

const KEY_PREFIX: string = "telemetry-writer-shed-count";
const BUCKET_TTL_SECONDS: number = 300;

/** Minimal slice of the ioredis client the counter needs; injectable for tests. */
export interface ShedCounterClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

function getDefaultClient(): ShedCounterClient | null {
  return Redis.getClient();
}

export function shedBucketKey(epochMinute: number): string {
  return `${KEY_PREFIX}:${epochMinute}`;
}

function epochMinute(now: Date): number {
  return Math.floor(now.getTime() / 60_000);
}

export async function recordShed(data?: {
  now?: Date;
  client?: ShedCounterClient | null;
}): Promise<void> {
  try {
    const client: ShedCounterClient | null =
      data?.client !== undefined ? data.client : getDefaultClient();
    if (!client) {
      return;
    }
    const key: string = shedBucketKey(epochMinute(data?.now ?? new Date()));
    await client.incr(key);
    await client.expire(key, BUCKET_TTL_SECONDS);
  } catch (err) {
    logger.debug("TelemetryWriterShedMetrics: failed to record shed:");
    logger.debug(err as Error);
  }
}

/*
 * Sheds across the whole writer tier in the current + previous minute
 * buckets (~ the last one-to-two minutes). Returns 0 when Redis is
 * unavailable or the buckets are empty/garbled.
 */
export async function getRecentShedCount(data?: {
  now?: Date;
  client?: ShedCounterClient | null;
}): Promise<number> {
  try {
    const client: ShedCounterClient | null =
      data?.client !== undefined ? data.client : getDefaultClient();
    if (!client) {
      return 0;
    }
    const currentMinute: number = epochMinute(data?.now ?? new Date());
    let total: number = 0;
    for (const minute of [currentMinute, currentMinute - 1]) {
      const raw: string | null = await client.get(shedBucketKey(minute));
      const parsed: number = parseInt(raw ?? "", 10);
      if (!isNaN(parsed) && parsed > 0) {
        total += parsed;
      }
    }
    return total;
  } catch (err) {
    logger.debug("TelemetryWriterShedMetrics: failed to read shed count:");
    logger.debug(err as Error);
    return 0;
  }
}
