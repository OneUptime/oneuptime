/*
 * A DURATION IN MILLISECONDS, IN THE READER'S LANGUAGE.
 *
 * The helper lives in Common (Common/Utils/Milliseconds), so a shared
 * helper that writes a page's words with the reader's Translator - the
 * monitor overview's hero (MonitorOverviewPresentationUtil) - writes a
 * duration exactly as the Dashboard's views do. This module hands the
 * Dashboard the same functions, so every view keeps importing it from
 * here: one helper, never two copies.
 *
 * formatMilliseconds(translator, ms, { maximumFractionDigits }) writes the
 * "{{value}} ms" key with the figure as the reader's language writes a
 * number ("411 ms", "1.234 ms", "۴۱۱ میلی‌ثانیه", "411 ملي ث");
 * roundMilliseconds rounds as Math.round did; minimumFractionDigits keeps
 * the decimals toFixed wrote ("5.0 ms"); unit writes the duration in
 * another unit, through that unit's key ({ unit: "s" }: "1.25 s", "۱٫۲۵
 * ثانیه"; "ns", "µs", "min" and "h" too, issue #8348).
 * formatMillisecondsInEnglish is for the text that stays English on
 * purpose: a chart's value axis and tooltip, and the PDF export. A guard
 * (Common Tests/UI/MillisecondsInReadersLanguageGuard) refuses a duration
 * built as `x + " ms"` anywhere in the Dashboard, and any "ms", "s", "µs",
 * "ns" or "min" written beside a figure in any of its files (issues #7418,
 * #8348).
 */
export {
  formatMilliseconds,
  formatMillisecondsInEnglish,
  MILLISECONDS_TEMPLATE,
  roundMilliseconds,
} from "Common/Utils/Milliseconds";
export type {
  DurationUnit,
  MillisecondsOptions,
} from "Common/Utils/Milliseconds";
