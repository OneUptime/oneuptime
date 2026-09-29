/*
 * Number formatting for the telemetry overview pages. Pure and import-free,
 * so React-free helpers (and the node tests that exercise them) can share
 * the exact wording the tiles show. telemetryMetrics.ts re-exports these.
 */

export const formatCompact: (n: number | null) => string = (
  n: number | null,
): string => {
  if (n === null || !Number.isFinite(n)) {
    return "—";
  }
  if (n < 1000) {
    return String(Math.round(n));
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
};

export const formatPercent: (n: number | null) => string = (
  n: number | null,
): string => {
  if (n === null || !Number.isFinite(n)) {
    return "—";
  }
  return `${n.toFixed(1)}%`;
};

export const formatDurationMs: (ms: number | null) => string = (
  ms: number | null,
): string => {
  if (ms === null || !Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)} µs`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
};

export const formatBytes: (bytes: number | null) => string = (
  bytes: number | null,
): string => {
  if (bytes === null || !Number.isFinite(bytes)) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v: number = bytes;
  let i: number = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};
