import Redis, { ClientType } from "../../Infrastructure/Redis";
import Dictionary from "../../../Types/Dictionary";

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

// Everything a single INFO call reports, with no history involved.
export interface RedisInfoSnapshot {
  usedMemoryInBytes: number;
  // 0 when Redis has no maxmemory ceiling configured.
  maxMemoryInBytes: number;
  maxMemoryPolicy: string;
  // null when maxmemory is unset, so there is no ratio to speak of.
  memoryUtilizationPercent: number | null;
  connectedClients: number;
  maxClients: number | null;
  clientUtilizationPercent: number | null;
  blockedClients: number;
  evictedKeys: number;
  rejectedConnections: number;
  rdbLastBgsaveStatus: string;
  isAofEnabled: boolean;
  aofLastWriteStatus: string;
  aofLastBgrewriteStatus: string;
  uptimeInSeconds: number;
}

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

/*
 * INFO is a flat `field:value` document split into `# Section` blocks. Section
 * headers and comment lines are dropped; field names are unique across sections
 * so a single flat map is unambiguous.
 */
export function parseRedisInfo(info: string): Dictionary<string> {
  const values: Dictionary<string> = {};

  for (const line of info.split(/\r?\n/)) {
    const trimmed: string = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex: number = trimmed.indexOf(":");

    if (separatorIndex <= 0) {
      continue;
    }

    values[trimmed.slice(0, separatorIndex)] = trimmed.slice(
      separatorIndex + 1,
    );
  }

  return values;
}

function toNumber(value: string | undefined): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }

  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildRedisInfoSnapshot(data: {
  info: Dictionary<string>;
  maxClients: number | null;
}): RedisInfoSnapshot {
  const maxMemoryInBytes: number = toNumber(data.info["maxmemory"]);
  const usedMemoryInBytes: number = toNumber(data.info["used_memory"]);
  const connectedClients: number = toNumber(data.info["connected_clients"]);

  return {
    usedMemoryInBytes,
    maxMemoryInBytes,
    maxMemoryPolicy: data.info["maxmemory_policy"] || "unknown",
    memoryUtilizationPercent:
      maxMemoryInBytes > 0
        ? (usedMemoryInBytes / maxMemoryInBytes) * 100
        : null,
    connectedClients,
    maxClients: data.maxClients,
    clientUtilizationPercent:
      data.maxClients !== null && data.maxClients > 0
        ? (connectedClients / data.maxClients) * 100
        : null,
    blockedClients: toNumber(data.info["blocked_clients"]),
    evictedKeys: toNumber(data.info["evicted_keys"]),
    rejectedConnections: toNumber(data.info["rejected_connections"]),
    rdbLastBgsaveStatus: data.info["rdb_last_bgsave_status"] || "unknown",
    isAofEnabled: data.info["aof_enabled"] === "1",
    aofLastWriteStatus: data.info["aof_last_write_status"] || "unknown",
    aofLastBgrewriteStatus: data.info["aof_last_bgrewrite_status"] || "unknown",
    uptimeInSeconds: toNumber(data.info["uptime_in_seconds"]),
  };
}

/*
 * maxclients moved into INFO clients in Redis 6.2. Older servers, and any
 * server whose INFO omits it, need the CONFIG round trip — which managed Redis
 * offerings sometimes disable, hence the null (and a skipped check) rather than
 * a thrown error.
 */
async function getMaxClients(
  client: ClientType,
  info: Dictionary<string>,
): Promise<number | null> {
  const fromInfo: number | null = toNumberOrNull(info["maxclients"]);

  if (fromInfo !== null) {
    return fromInfo;
  }

  try {
    const reply: unknown = await client.call("CONFIG", "GET", "maxclients");

    if (Array.isArray(reply) && reply.length >= 2) {
      return toNumberOrNull(String(reply[1]));
    }
  } catch {
    // CONFIG is unavailable on this server; the caller skips the check.
  }

  return null;
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

async function readInfoSnapshot(
  client: ClientType,
): Promise<RedisInfoSnapshot> {
  const info: Dictionary<string> = parseRedisInfo(await client.info());

  return buildRedisInfoSnapshot({
    info,
    maxClients: await getMaxClients(client, info),
  });
}

/*
 * Read-only view for the admin health API. It deliberately does NOT touch the
 * stored counter sample: advancing that baseline here would consume the delta
 * the worker needs, so a page refresh could hide an eviction burst from the
 * notification that exists to catch it.
 */
export async function getRedisInfoSnapshot(): Promise<RedisInfoSnapshot | null> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    return null;
  }

  return await readInfoSnapshot(client);
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
