import { Translator } from "Common/Types/Translator";
import OneUptimeDate from "Common/Types/Date";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import { writeFigureInLanguage } from "Common/Types/DateLanguage";
import {
  formatDurationInUnit,
  formatMilliseconds,
} from "../../Utils/Milliseconds";
/*
 * Number formatting for the telemetry overview pages. Pure and import-free,
 * so React-free helpers (and the node tests that exercise them) can share
 * the exact wording the tiles show. telemetryMetrics.ts re-exports these.
 *
 * Each figure is written as English writes it - "1.2k", "2.5%", "1.5 GiB",
 * exactly as every test pins it - and, handed the reader's translator, in
 * their digits, decimal sign and percent sign with its scale letter and
 * unit kept: "1,2k", "2,5 %", "1,5 GiB" in German, "۱٫۲k", "۲٫۵٪" in
 * Persian, Latin digits in Arabic. The Requests, Error rate and Memory
 * tiles of a service's, a function's, a site's and a cloud app's Overview
 * read in Latin digits beside a p95 tile and charts in the reader's
 * (#8481, Docs/ux/README.md#numbers-dates-and-plurals).
 */
const inLanguage: (english: string, translator?: Translator) => string = (
  english: string,
  translator?: Translator,
): string => {
  return translator
    ? writeFigureInLanguage(english, translator.language)
    : english;
};

export const formatCompact: (
  n: number | null,
  translator?: Translator,
) => string = (n: number | null, translator?: Translator): string => {
  if (n === null || !Number.isFinite(n)) {
    return EMPTY_VALUE_MARK;
  }
  if (n < 1000) {
    return inLanguage(String(Math.round(n)), translator);
  }
  if (n < 1_000_000) {
    return inLanguage(
      `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`,
      translator,
    );
  }
  return inLanguage(
    `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`,
    translator,
  );
};

export const formatPercent: (
  n: number | null,
  translator?: Translator,
) => string = (n: number | null, translator?: Translator): string => {
  if (n === null || !Number.isFinite(n)) {
    return EMPTY_VALUE_MARK;
  }
  return inLanguage(`${n.toFixed(1)}%`, translator);
};

/*
 * A span's duration in the unit that reads best ("850 µs", "12 ms", "1.25
 * s"), in the reader's language: "۱۲ میلی‌ثانیه", "12 ملي ث", "1,25 Sek."
 * (issue #7418). On a tile, in a row, in a sentence, and on a chart's value
 * axis and in its tooltip alike, which write their figures as the tiles
 * beside them do (#8349): there is no English-only variant to reach for.
 * English reads exactly as it always did.
 */
export const formatDurationMsInLanguage: (
  ms: number | null,
  translator: Translator,
) => string = (ms: number | null, translator: Translator): string => {
  if (ms === null || !Number.isFinite(ms)) {
    return EMPTY_VALUE_MARK;
  }
  if (ms < 1) {
    return formatDurationInUnit(translator, ms * 1000, "microsecond", {
      decimals: 0,
    });
  }
  if (ms < 1000) {
    // One decimal under ten ("5.0 ms"), none from ten up ("42 ms").
    const decimals: number = ms < 10 ? 1 : 0;

    return formatMilliseconds(translator, ms, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return formatDurationInUnit(translator, ms / 1000, "second", {
    decimals: 2,
  });
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

export const formatBytes: (
  bytes: number | null,
  translator?: Translator,
) => string = (bytes: number | null, translator?: Translator): string => {
  if (bytes === null || !Number.isFinite(bytes)) {
    return EMPTY_VALUE_MARK;
  }
  const reading: BytesReading = getBytesReading(bytes);
  return inLanguage(
    `${reading.value.toFixed(reading.decimals)}\u00A0${reading.unit}`,
    translator,
  );
};

/*
 * When a histogram or analytics bucket starts, as epoch milliseconds, or
 * null for a time that is none. The telemetry endpoints hand a bucket's
 * time over as ClickHouse writes it ("2026-09-24 10:00:00"), in UTC with no
 * zone, and `new Date` reads that form as the BROWSER's local time: an
 * overview's Exceptions and Logs charts were drawn hours away from its span
 * charts and their own time axis everywhere but UTC (4 hours early in New
 * York). OneUptimeDate.fromString reads it as UTC, and an ISO time with its
 * zone as written.
 */
export const parseBucketTimeMs: (time: unknown) => number | null = (
  time: unknown,
): number | null => {
  if (typeof time !== "string" || time.trim().length === 0) {
    return null;
  }

  let ms: number = NaN;

  try {
    ms = OneUptimeDate.fromString(time).getTime();
  } catch {
    return null;
  }

  return Number.isNaN(ms) ? null : ms;
};
