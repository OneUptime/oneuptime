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

/*
 * A size as formatBytes writes it, in its pieces: the number in the unit it
 * is written in (B, KiB, MiB, GiB, TiB) and how many decimals it keeps, one
 * under ten and none from ten up. A page that writes its sizes in the
 * reader's digits (OpenStack's, issue #7191) writes the same figure in the
 * same unit from it.
 */
export interface BytesReading {
  value: number;
  unit: string;
  decimals: number;
}

export const getBytesReading: (bytes: number) => BytesReading = (
  bytes: number,
): BytesReading => {
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v: number = bytes;
  let i: number = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return { value: v, unit: units[i] || "B", decimals: v < 10 ? 1 : 0 };
};

export const formatBytes: (bytes: number | null) => string = (
  bytes: number | null,
): string => {
  if (bytes === null || !Number.isFinite(bytes)) {
    return "—";
  }
  const reading: BytesReading = getBytesReading(bytes);
  return `${reading.value.toFixed(reading.decimals)} ${reading.unit}`;
};
