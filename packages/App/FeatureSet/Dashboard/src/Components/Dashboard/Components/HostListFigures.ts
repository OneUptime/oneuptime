import OneUptimeDate from "Common/Types/Date";
import {
  formatReaderFigure,
  formatRelativeAmount,
  isEnglishDateLanguage,
} from "Common/Types/DateLanguage";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * A HOST LIST'S FIGURES, IN THE READER'S LANGUAGE (#7519).
 *
 * The Host list widget wrote two cells of its own English shorthand on every
 * board: Last Seen as "12s ago", "5m ago", "4h ago", "2d ago", and CPU /
 * Memory as "8c / 32.0 GB" - English words, Latin digits and an English
 * decimal point on a German or a Persian board. And the Docker and Podman
 * host lists' tiles read "3 running / 1 stopped".
 *
 * Each is the reader's now. Last Seen is counted as it always was (whole
 * seconds under a minute, then minutes, hours and days) and written by
 * Intl in the reader's language, its unit shortened as the language
 * shortens it so it fits the column: "vor 5 Min.", "il y a 5 min", "۵
 * دقیقه پیش". The cores and the memory are one sentence in the reader's
 * plural forms, the memory in their digits: "8 Kerne / 32,0 GB", "۸ هسته /
 * ۳۲٫۰ GB". English reads exactly as it did.
 */

// What a cell shows for a figure the host has not reported.
export const NO_HOST_FIGURE: string = "—";

export type HostLastSeenUnit = "second" | "minute" | "hour" | "day";

export interface HostLastSeenAmount {
  count: number;
  unit: HostLastSeenUnit;
}

// The letter English writes after the count: "12s ago".
const ENGLISH_UNIT_LETTER: Record<HostLastSeenUnit, string> = {
  second: "s",
  minute: "m",
  hour: "h",
  day: "d",
};

/*
 * How long before `now` a host was last seen, as the column counts it:
 * whole seconds under a minute, whole minutes under an hour, whole hours
 * under a day, then whole days. A time ahead of now is "0 seconds".
 */
export function getHostLastSeenAmount(
  date: Date,
  now: Date,
): HostLastSeenAmount {
  const diffSeconds: number = Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / 1000),
  );

  if (diffSeconds < 60) {
    return { count: diffSeconds, unit: "second" };
  }

  const diffMinutes: number = Math.floor(diffSeconds / 60);

  if (diffMinutes < 60) {
    return { count: diffMinutes, unit: "minute" };
  }

  const diffHours: number = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return { count: diffHours, unit: "hour" };
  }

  return { count: Math.floor(diffHours / 24), unit: "day" };
}

/*
 * When a host was last seen, in the reader's language: "12s ago" in
 * English as it always read, "vor 12 Sek." in German, "۱۲ ثانیه پیش" in
 * Persian. A host never seen, or a date that is not one, is the dash.
 */
export function formatHostLastSeen(
  date: Date | undefined | null,
  translator: Translator = getGlobalTranslator(),
  now: Date = OneUptimeDate.getCurrentDate(),
): string {
  if (!date || Number.isNaN(new Date(date).getTime())) {
    return NO_HOST_FIGURE;
  }

  const amount: HostLastSeenAmount = getHostLastSeenAmount(new Date(date), now);

  if (!isEnglishDateLanguage(translator.language)) {
    const written: string | null = formatRelativeAmount({
      count: amount.count,
      unit: amount.unit,
      isFuture: false,
      locale: translator.language,
      style: "short",
    });

    if (written) {
      return written;
    }
  }

  return `${amount.count}${ENGLISH_UNIT_LETTER[amount.unit]} ago`;
}

/*
 * A host's memory, in the reader's digits and decimal sign: "32.0 GB" in
 * English as it always read, "32,0 GB" in German, "۳۲٫۰ GB" in Persian.
 * Counted in 1024s, as the agent reports it; plain bytes are whole.
 */
export function formatHostListBytes(
  bytes: number | null | undefined,
  translator: Translator = getGlobalTranslator(),
): string {
  if (!bytes || bytes <= 0) {
    return NO_HOST_FIGURE;
  }

  const units: Array<string> = ["B", "KB", "MB", "GB", "TB"];
  let i: number = 0;
  let value: number = bytes;

  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }

  return `${formatReaderFigure(value, {
    decimals: value >= 100 || i === 0 ? 0 : 1,
    language: translator.language,
  })}\u00A0${units[i]}`;
}

/*
 * The CPU / Memory cell: the cores and the memory as one sentence, in the
 * reader's plural forms - "8c / 32.0 GB" in English as it always read, "8
 * Kerne / 32,0 GB" in German. A host that reported neither is the dash; one
 * that reported only its memory, a dash for its cores.
 */
export function formatHostCpuMemory(
  cpuCores: number | null | undefined,
  totalMemoryBytes: number | null | undefined,
  translator: Translator = getGlobalTranslator(),
): string {
  if (!cpuCores && !totalMemoryBytes) {
    return NO_HOST_FIGURE;
  }

  const memory: string = formatHostListBytes(totalMemoryBytes, translator);

  if (!cpuCores) {
    return `${NO_HOST_FIGURE} / ${memory}`;
  }

  return translator.translatePlural(
    { one: "{{count}}c / {{memory}}", other: "{{count}}c / {{memory}}" },
    cpuCores,
    { memory: memory },
  );
}

/*
 * A container host's tile: how many of its containers run and how many
 * are stopped, as one sentence in the reader's digits - "3 running / 1
 * stopped" in English as it always read.
 */
export function formatHostContainerCounts(
  running: number,
  stopped: number,
  translator: Translator = getGlobalTranslator(),
): string {
  return translator.translateTemplate(
    "{{running}} running / {{stopped}} stopped",
    {
      running: translator.formatNumber(running),
      stopped: translator.formatNumber(stopped),
    },
  );
}
