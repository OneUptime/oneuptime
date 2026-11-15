import { Translator } from "Common/Types/Translator";
import {
  formatMilliseconds,
  formatMillisecondsInEnglish,
  MillisecondsOptions,
} from "../../Utils/Milliseconds";
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

/*
 * A span's duration in the unit that reads best ("850 µs", "12 ms", "1.25
 * s"). It is written by `writeMilliseconds`, in every unit: the reader's
 * words on a tile (formatDurationMsInLanguage), English on a chart's value
 * axis (formatDurationMs).
 */
const writeDurationMs: (
  ms: number | null,
  writeMilliseconds: (
    milliseconds: number,
    options: MillisecondsOptions,
  ) => string,
) => string = (
  ms: number | null,
  writeMilliseconds: (
    milliseconds: number,
    options: MillisecondsOptions,
  ) => string,
): string => {
  if (ms === null || !Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 1) {
    return writeMilliseconds(ms, { unit: "µs", maximumFractionDigits: 0 });
  }
  if (ms < 1000) {
    // One decimal under ten ("5.0 ms"), none from ten up ("42 ms").
    const decimals: number = ms < 10 ? 1 : 0;

    return writeMilliseconds(ms, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return writeMilliseconds(ms, {
    unit: "s",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

/*
 * A duration on a chart's value axis and in its tooltip: Latin digits and
 * the short "ms", as every chart's value axis writes its figures.
 */
export const formatDurationMs: (ms: number | null) => string = (
  ms: number | null,
): string => {
  return writeDurationMs(ms, formatMillisecondsInEnglish);
};

/*
 * A duration on a tile, in a row or in a sentence: its milliseconds in the
 * reader's language ("12 ms", "۱۲ میلی‌ثانیه", "12 ملي ث"; issue #7418).
 */
export const formatDurationMsInLanguage: (
  ms: number | null,
  translator: Translator,
) => string = (ms: number | null, translator: Translator): string => {
  return writeDurationMs(
    ms,
    (milliseconds: number, options: MillisecondsOptions): string => {
      return formatMilliseconds(translator, milliseconds, options);
    },
  );
};

/*
 * A size as formatBytes writes it, in its pieces: the number in the unit it
 * is written in (B, KiB, MiB, GiB, TiB) and how many decimals it keeps. A
 * count of bytes is a whole number, so plain bytes keep none: an empty
 * volume is "0 B" and a 5-byte object "5 B", never "0.0 B" (issue #7417).
 * From KiB up a size keeps one decimal under ten and none from ten up
 * ("1.5 KiB", "12 GiB"). A page that writes its sizes in the reader's
 * digits (OpenStack's, issue #7191) writes the same figure in the same
 * unit from it.
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
  return {
    value: v,
    unit: units[i] || "B",
    decimals: i > 0 && v < 10 ? 1 : 0,
  };
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
