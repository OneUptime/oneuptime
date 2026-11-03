import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * How Data Observability writes its numbers: row counts with the reader's
 * separators, sizes in the largest unit that keeps a whole number in front,
 * and a table's usual update interval the way a person says it ("about every
 * 5 minutes"). Each sentence is looked up whole, so a language words it its
 * own way.
 */

const BYTE_UNITS: ReadonlyArray<string> = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatRowCount(
  translator: Translator,
  rows: number | null | undefined,
): string {
  if (rows === null || rows === undefined || !Number.isFinite(rows)) {
    return "-";
  }

  return translator.formatNumber(rows);
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "-";
  }

  let value: number = Math.max(0, bytes);
  let unit: number = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value = value / 1024;
    unit++;
  }

  const digits: number = value >= 100 || unit === 0 ? 0 : 1;

  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

// "about every 5 minutes", from a learned interval in seconds.
export function formatUpdateInterval(
  translator: Translator,
  seconds: number | null | undefined,
): string {
  if (!seconds || seconds <= 0) {
    return translator.translateText("Still learning") || "Still learning";
  }

  if (seconds < 90) {
    return translator.translatePlural(
      {
        one: "About every {{count}} second",
        other: "About every {{count}} seconds",
      },
      Math.round(seconds),
    );
  }

  if (seconds < 90 * 60) {
    return translator.translatePlural(
      {
        one: "About every {{count}} minute",
        other: "About every {{count}} minutes",
      },
      Math.round(seconds / 60),
    );
  }

  if (seconds < 36 * 3600) {
    return translator.translatePlural(
      {
        one: "About every {{count}} hour",
        other: "About every {{count}} hours",
      },
      Math.round(seconds / 3600),
    );
  }

  return translator.translatePlural(
    {
      one: "About every {{count}} day",
      other: "About every {{count}} days",
    },
    Math.round(seconds / 86400),
  );
}

// "Late by 2 hours", from seconds overdue.
export function formatOverdue(translator: Translator, seconds: number): string {
  if (seconds < 3600) {
    return translator.translatePlural(
      { one: "Late by {{count}} minute", other: "Late by {{count}} minutes" },
      Math.max(1, Math.round(seconds / 60)),
    );
  }

  if (seconds < 48 * 3600) {
    return translator.translatePlural(
      { one: "Late by {{count}} hour", other: "Late by {{count}} hours" },
      Math.round(seconds / 3600),
    );
  }

  return translator.translatePlural(
    { one: "Late by {{count}} day", other: "Late by {{count}} days" },
    Math.round(seconds / 86400),
  );
}
