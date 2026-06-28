import Redis, { ClientType } from "../../Infrastructure/Redis";
import { TelemetryMonitorReactiveFastPathEnabled } from "../../EnvironmentConfig";

/**
 * Phase 4 — reactive fresh-shape signal.
 *
 * The metric ingest path records, per project, which metric names just received
 * data (a Redis sorted set scored by arrival time). The telemetry-monitor
 * scheduler can then skip claiming monitors whose shape saw no new data this
 * tick — turning O(all monitors) into O(shapes-with-fresh-data) + O(silent
 * monitors). This is PURE UPSIDE: the scan-all floor and NoDataPolicy.Trigger
 * monitors remain the authoritative path, so a missed/empty signal can only
 * cost a little extra work, never a missed evaluation. Both sides no-op unless
 * TELEMETRY_MONITOR_REACTIVE_FASTPATH_ENABLED is set, and every Redis call is
 * best-effort (failures are swallowed) so the signal can never break ingest or
 * scheduling.
 */

const KEY_PREFIX: string = "telemetry-monitor-fresh-shape";

// Entries older than this are pruned; also the project-key TTL.
const RETENTION_SECONDS: number = 600;

function keyForProject(projectId: string): string {
  return `${KEY_PREFIX}:${projectId}`;
}

/**
 * Record that `metricName` in `projectId` received data at `atEpochMs`.
 * Called from the metric ingest path (flag-gated, best-effort).
 */
export async function recordFreshShapes(input: {
  projectId: string;
  metricNames: Array<string>;
  atEpochMs: number;
}): Promise<void> {
  if (!TelemetryMonitorReactiveFastPathEnabled) {
    return;
  }
  if (input.metricNames.length === 0) {
    return;
  }

  const client: ClientType | null = Redis.getClient();
  if (!client) {
    return;
  }

  const key: string = keyForProject(input.projectId);

  try {
    for (const metricName of input.metricNames) {
      await client.zadd(key, input.atEpochMs, metricName);
    }
    await client.expire(key, RETENTION_SECONDS);
    // Trim entries older than the retention window so the set stays bounded.
    await client.zremrangebyscore(
      key,
      "-inf",
      input.atEpochMs - RETENTION_SECONDS * 1000,
    );
  } catch {
    // Best-effort: a failed signal just means the scheduler scans more.
  }
}

/**
 * The set of metric names in `projectId` that received data at or after
 * `sinceEpochMs`, or `null` when the signal is UNAVAILABLE (fast-path disabled,
 * Redis down, or a read error). The null-vs-empty distinction is correctness-
 * critical for the scheduler skip: `null` means "unknown — scan everything"
 * (the scan-all floor), whereas an empty set means "the signal works and
 * genuinely nothing arrived" (eligible-safe monitors may be skipped). Returning
 * an empty set on failure would wrongly skip everything, so failures return
 * null.
 */
export async function getFreshMetricNamesSince(input: {
  projectId: string;
  sinceEpochMs: number;
}): Promise<Set<string> | null> {
  if (!TelemetryMonitorReactiveFastPathEnabled) {
    return null;
  }

  const client: ClientType | null = Redis.getClient();
  if (!client) {
    return null;
  }

  try {
    const members: Array<string> = await client.zrangebyscore(
      keyForProject(input.projectId),
      input.sinceEpochMs,
      "+inf",
    );
    const result: Set<string> = new Set<string>();
    for (const member of members) {
      result.add(member);
    }
    return result;
  } catch {
    // Unknown — fall back to scanning everything (scan-all floor).
    return null;
  }
}
