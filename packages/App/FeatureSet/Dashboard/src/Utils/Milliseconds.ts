import { translationKey, Translator } from "Common/Types/Translator";

/*
 * A DURATION IN MILLISECONDS, IN THE READER'S LANGUAGE.
 *
 * Every monitor type's summary - the monitor's Summary card, Test Monitor's
 * result, Monitoring Logs' View Summary, the incident and alert pages'
 * evaluation - built its Response Time (and a ping's jitter and round
 * trips, a port's and a request's phases, a script's execution time) as
 * `responseTimeInMs + " ms"`. On an Arabic or Persian page the browser
 * lays that English text out from the right, so it read "ms 411", and in
 * Persian its digits stayed Latin (411, not ۴۱۱) beside the card's own
 * Persian date.
 *
 * Each is now one key, "{{value}} ms", which every language words with its
 * own unit, in its own order ("411 ms", "411 мс", "411 毫秒", "۴۱۱
 * میلی‌ثانیه", "411 ملي ث": Intl's short unit, as Locales/ARABIC.md says a
 * duration is written), with the figure as the reader's language writes a
 * number (translator.formatNumber: "1,234" / "1.234" / "۱٬۲۳۴", Latin
 * digits in Arabic). English reads "411 ms" as before; a figure of a
 * thousand or more takes its thousands separator ("1,234 ms"), as the
 * Retry Attempts lines under it already wrote it.
 *
 * A guard (Common Tests/UI/MillisecondsInReadersLanguageGuard) refuses a
 * duration built as `x + " ms"` anywhere in the Dashboard, and any "ms"
 * written beside a figure in the monitor summaries.
 */
export const MILLISECONDS_TEMPLATE: string = translationKey("{{value}} ms");

export interface MillisecondsOptions {
  /*
   * At most this many decimals, rounded as Math.round rounds: 0 for whole
   * milliseconds, 2 for a phase of a request ("31.27 ms"). Left out, the
   * figure is written as translator.formatNumber writes it (up to three).
   */
  maximumFractionDigits?: number | undefined;
}

// A duration's figure, rounded to the decimals asked for.
export const roundMilliseconds: (
  milliseconds: number,
  maximumFractionDigits?: number | undefined,
) => number = (
  milliseconds: number,
  maximumFractionDigits?: number | undefined,
): number => {
  if (maximumFractionDigits === undefined) {
    return milliseconds;
  }

  const scale: number = Math.pow(
    10,
    Math.max(0, Math.min(3, Math.floor(maximumFractionDigits))),
  );

  return Math.round(milliseconds * scale) / scale;
};

/*
 * "411 ms" in the reader's language. A value that is not a number (a
 * reading the probe did not make) reads "-", as every missing fact does.
 */
export const formatMilliseconds: (
  translator: Translator,
  milliseconds: number,
  options?: MillisecondsOptions,
) => string = (
  translator: Translator,
  milliseconds: number,
  options?: MillisecondsOptions,
): string => {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds)) {
    return "-";
  }

  return translator.translateTemplate(MILLISECONDS_TEMPLATE, {
    value: translator.formatNumber(
      roundMilliseconds(milliseconds, options?.maximumFractionDigits),
    ),
  });
};
