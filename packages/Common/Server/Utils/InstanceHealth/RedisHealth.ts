import Redis, { ClientType } from "../../Infrastructure/Redis";
import Dictionary from "../../../Types/Dictionary";

/*
 * What a single Redis/Valkey INFO call reports, for the admin health API
 * (packages/App/API/AdminHealth.ts).
 *
 * The counter history that turns INFO's cumulative totals into "did this
 * happen recently" belongs to the Enterprise instance-health worker and lives
 * next to it in ee/Server/Workers/InstanceHealth/RedisHealth.ts, which reads
 * INFO through readInfoSnapshot below.
 */

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

/*
 * One INFO read, plus the CONFIG fallback for maxclients. Exported so the
 * Enterprise worker's snapshot reads Redis exactly the way this file does.
 */
export async function readInfoSnapshot(
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
 * counter sample the Enterprise health worker keeps: advancing that baseline
 * here would consume the delta the worker needs, so a page refresh could hide
 * an eviction burst from the notification that exists to catch it.
 */
export async function getRedisInfoSnapshot(): Promise<RedisInfoSnapshot | null> {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    return null;
  }

  return await readInfoSnapshot(client);
}
