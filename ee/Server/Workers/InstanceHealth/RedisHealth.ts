import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import {
  readInfoSnapshot,
  RedisInfoSnapshot,
} from "Common/Server/Utils/InstanceHealth/RedisHealth";

/*
 * The counter history behind the Enterprise instance-health job
 * (EvaluateRedisHealth.ts). Redis/Valkey reports evicted keys and rejected
 * connections as cumulative totals, so the job keeps two samples in Redis
 * itself and measures deltas against them. Only that job reads this, so it
 * lives in ee/ next to it. The INFO read it builds on (readInfoSnapshot) stays
 * in core, because the admin health API shows the same numbers.
 */

/*
 * Where the previous counter sample is kept so a later run can turn Redis'
 * monotonic counters into "did this happen since we last looked".
 *
 * Redis stores its own history here on purpose: the counters and the sample
 * then share a lifetime, so a Redis restart clears both together and cannot
 * leave a stale baseline that fabricates an enormous delta. The uptime guard
 * below covers the case where the sample somehow outlives a restart anyway.
 *
 * Under memory pressure with an eviction policy this key can itself be evicted,
 * which costs one interval of eviction detection: the next run finds no sample,
 * re-seeds it, and reports deltas again from there.
 */
const COUNTER_SAMPLE_KEY: string = "oneuptime-instance-health-redis-sample";
const COUNTER_SAMPLE_TTL_IN_SECONDS: number = 60 * 60;

/*
 * The minimum age of the baseline the counter deltas are measured against, so
 * every evaluation answers "did this happen in at least the last half hour"
 * rather than "did it happen in the last five minutes".
 *
 * That span is what keeps an edge-triggered signal from flapping. Evictions
 * arriving in bursts would otherwise clear on the first quiet tick and fire
 * again on the next, emailing every other cycle.
 *
 * Two samples are kept rather than one because a single rolling baseline is a
 * TUMBLING window, not a sliding one: the tick immediately after a roll would
 * compare against a five-minute-old sample and a lone quiet tick there would
 * resolve the notification, re-notifying on the next burst of the same ongoing
 * incident. Measuring against the OLDER of two samples makes the lookback
 * always at least this long (and at most twice it).
 */
export const COUNTER_WINDOW_IN_SECONDS: number = 30 * 60;

export interface RedisHealthSnapshot extends RedisInfoSnapshot {
  /*
   * Increase over the baseline. null when this run has no baseline it can trust
   * — no stored sample, or Redis restarted and reset the counters.
   */
  evictedKeysDelta: number | null;
  rejectedConnectionsDelta: number | null;
  /*
   * How far back the deltas above actually reach, so messages can state the
   * real span instead of quoting a nominal constant. null alongside null deltas.
   */
  counterWindowInSeconds: number | null;
}

export interface RedisCounterSample {
  evictedKeys: number;
  rejectedConnections: number;
  uptimeInSeconds: number;
}

/*
 * The two retained samples. Deltas are measured against `older`, which keeps
 * the lookback at least COUNTER_WINDOW_IN_SECONDS at every tick; `newer` is the
 * one promoted to `older` at the next roll.
 */
export interface RedisCounterSamples {
  older: RedisCounterSample;
  newer: RedisCounterSample;
}

function parseCounterSample(value: unknown): RedisCounterSample | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const sample: Record<string, unknown> = value as Record<string, unknown>;
  const evictedKeys: number = Number(sample["evictedKeys"]);
  const rejectedConnections: number = Number(sample["rejectedConnections"]);
  const uptimeInSeconds: number = Number(sample["uptimeInSeconds"]);

  if (
    !Number.isFinite(evictedKeys) ||
    !Number.isFinite(rejectedConnections) ||
    !Number.isFinite(uptimeInSeconds)
  ) {
    return null;
  }

  return { evictedKeys, rejectedConnections, uptimeInSeconds };
}

async function readCounterSamples(
  client: ClientType,
): Promise<RedisCounterSamples | null> {
  try {
    const raw: string | null = await client.get(COUNTER_SAMPLE_KEY);

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const stored: Record<string, unknown> = parsed as Record<string, unknown>;
    const older: RedisCounterSample | null = parseCounterSample(
      stored["older"],
    );
    const newer: RedisCounterSample | null = parseCounterSample(
      stored["newer"],
    );

    if (older && newer) {
      return { older, newer };
    }

    /*
     * A single-sample payload is what the previous release wrote. Treat it as
     * both ends of the pair so an upgrade keeps its baseline instead of going
     * blind for a window.
     */
    const legacy: RedisCounterSample | null = parseCounterSample(parsed);

    return legacy ? { older: legacy, newer: legacy } : null;
  } catch {
    // A missing or unreadable sample simply means no delta this run.
    return null;
  }
}

/*
 * Returns whether the baseline was actually stored. The caller needs to know,
 * because a write can fail for a reason that does not stop the key from being
 * kept alive by other means — see getRedisHealthSnapshot.
 */
async function writeCounterSamples(
  client: ClientType,
  samples: RedisCounterSamples,
): Promise<boolean> {
  try {
    await client.set(
      COUNTER_SAMPLE_KEY,
      JSON.stringify(samples),
      "EX",
      COUNTER_SAMPLE_TTL_IN_SECONDS,
    );
    return true;
  } catch {
    /*
     * Losing the baseline must never fail the health evaluation that produced
     * this snapshot, so the error is swallowed and reported through the return.
     */
    return false;
  }
}

// Keep a baseline alive across the runs that do not rewrite it.
async function refreshCounterSampleTtl(client: ClientType): Promise<void> {
  try {
    await client.expire(COUNTER_SAMPLE_KEY, COUNTER_SAMPLE_TTL_IN_SECONDS);
  } catch {
    // Same reasoning as writeCounterSamples: never fail the evaluation over this.
  }
}

/*
 * The pair rolls only once the NEWER sample has aged past the window, which
 * promotes it to `older` and starts a fresh one. Deltas are always measured
 * against `older`, so the lookback never drops below the window. Redis' own
 * uptime measures that age, which avoids trusting either machine's clock.
 */
export function shouldRollCounterSamples(data: {
  previous: RedisCounterSamples | null;
  currentUptimeInSeconds: number;
  didRestart: boolean;
}): boolean {
  if (!data.previous || data.didRestart) {
    return true;
  }

  return (
    data.currentUptimeInSeconds - data.previous.newer.uptimeInSeconds >=
    COUNTER_WINDOW_IN_SECONDS
  );
}

/*
 * Compare a monotonic counter against its previous value. A decrease, or a
 * shorter uptime than the sample was taken at, means Redis restarted and the
 * counter began again from zero — the difference is meaningless, so report no
 * delta rather than a fabricated spike.
 */
export function getCounterDelta(data: {
  current: number;
  previous: number;
  didRestart: boolean;
}): number | null {
  if (data.didRestart || data.current < data.previous) {
    return null;
  }

  return data.current - data.previous;
}

/*
 * The evaluating worker's view: the same INFO read, plus the counter deltas
 * that turn cumulative totals into "did this happen in roughly the last
 * COUNTER_WINDOW_IN_SECONDS". Returns null when Redis is unreachable, which the
 * caller treats as "cannot evaluate" rather than "healthy".
 */
export async function getRedisHealthSnapshot(): Promise<RedisHealthSnapshot | null> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    return null;
  }

  const snapshot: RedisInfoSnapshot = await readInfoSnapshot(client);

  const previousSamples: RedisCounterSamples | null =
    await readCounterSamples(client);
  const didRestart: boolean = Boolean(
    previousSamples &&
      previousSamples.older.uptimeInSeconds > snapshot.uptimeInSeconds,
  );
  // Deltas always measure against the older half, never the freshly rolled one.
  const baseline: RedisCounterSample | null = previousSamples
    ? previousSamples.older
    : null;

  const current: RedisCounterSample = {
    evictedKeys: snapshot.evictedKeys,
    rejectedConnections: snapshot.rejectedConnections,
    uptimeInSeconds: snapshot.uptimeInSeconds,
  };
  const wantsRoll: boolean = shouldRollCounterSamples({
    previous: previousSamples,
    currentUptimeInSeconds: snapshot.uptimeInSeconds,
    didRestart,
  });
  const didRoll: boolean = wantsRoll
    ? await writeCounterSamples(client, {
        older: previousSamples && !didRestart ? previousSamples.newer : current,
        newer: current,
      })
    : false;

  /*
   * Keep the existing samples alive whenever they were not rolled — including
   * when the roll FAILED, which is the case that matters most. Under the
   * noeviction policy Redis rejects SET once it is out of memory but still
   * serves EXPIRE, so letting a failed write skip the refresh would expire the
   * baseline precisely when memory is full: eviction detection would then go
   * permanently blind at the moment it is needed, because every later write
   * fails the same way and the key never returns.
   */
  if (!didRoll) {
    await refreshCounterSampleTtl(client);
  }

  return {
    ...snapshot,
    counterWindowInSeconds: baseline
      ? snapshot.uptimeInSeconds - baseline.uptimeInSeconds
      : null,
    evictedKeysDelta: baseline
      ? getCounterDelta({
          current: snapshot.evictedKeys,
          previous: baseline.evictedKeys,
          didRestart,
        })
      : null,
    rejectedConnectionsDelta: baseline
      ? getCounterDelta({
          current: snapshot.rejectedConnections,
          previous: baseline.rejectedConnections,
          didRestart,
        })
      : null,
  };
}
