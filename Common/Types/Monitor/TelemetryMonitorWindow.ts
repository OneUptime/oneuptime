/**
 * Rolling-window guard for telemetry monitor alert queries (Logs, Traces,
 * Exceptions, Profiles).
 *
 * Every telemetry monitor counts recent telemetry over a "last X seconds"
 * rolling window. Historically each monitor type applied that window only
 * behind a bare truthiness check (`if (lastXSecondsOfLogs) { ... }`) and its
 * fromJSON deserializer read the field as a raw cast with no re-default. A
 * persisted config carrying 0 / null / undefined / NaN therefore dropped the
 * time predicate entirely, turning the per-minute `count()` into an UNBOUNDED
 * scan over every retained partition — the root of the telemetry-monitor
 * full-scan storm.
 *
 * `clampTelemetryMonitorWindowSeconds` makes the bound non-defeatable: an
 * invalid / missing / non-positive value coalesces to a safe default, and an
 * absurdly large value is capped to a hard ceiling so a single monitor can
 * never ask ClickHouse to aggregate an unbounded range every minute. Callers
 * must ALWAYS apply the returned window (never gate it behind a truthiness
 * check) so the query is guaranteed to be time-bounded.
 */

// Default window applied when the configured value is missing or invalid.
export const DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS: number = 60;

/*
 * Hard safety ceiling. A telemetry monitor re-evaluates its rolling window
 * every minute; a window beyond a day counted that often is almost certainly
 * misconfiguration and is exactly the workload that scans tens of millions of
 * rows per tick. 24h is a generous upper bound for legitimate "errors in the
 * last N" alerting while still bounding the worst case. Adjust here if a real
 * use case needs a wider window.
 */
export const MAX_TELEMETRY_MONITOR_WINDOW_SECONDS: number = 86400;

export function clampTelemetryMonitorWindowSeconds(
  value: number | undefined | null,
): number {
  // Floor first so fractional values (e.g. 0.5) collapse before the <= 0 check.
  const seconds: number = Math.floor(Number(value));

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS;
  }

  if (seconds > MAX_TELEMETRY_MONITOR_WINDOW_SECONDS) {
    return MAX_TELEMETRY_MONITOR_WINDOW_SECONDS;
  }

  return seconds;
}
