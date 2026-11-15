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
 * the decimals toFixed wrote ("5.0 ms"). formatDurationInUnit writes a span
 * in microseconds, seconds, minutes, hours or days the same way ("1,50
 * Sek.", "۱٫۵۰ ثانیه"; English exactly as toFixed wrote it). A chart's value
 * axis and its tooltip take them too, as the tiles beside them do (#8349).
 * formatMillisecondsInEnglish is for the AI chat's PDF export alone, whose
 * Latin-1 font holds no Persian digit. A guard (Common
 * Tests/UI/MillisecondsInReadersLanguageGuard) refuses a duration built as
 * `x + " ms"` anywhere in the Dashboard, and any "ms" written beside a
 * figure in any of its files (issue #7418);
 * ChartValueAxesInReadersLanguageGuard keeps formatMillisecondsInEnglish in
 * the PDF export.
 */
export {
  formatDurationInUnit,
  formatMilliseconds,
  formatMillisecondsInEnglish,
  MILLISECONDS_TEMPLATE,
  roundMilliseconds,
} from "Common/Utils/Milliseconds";
export type {
  DurationInUnit,
  DurationInUnitOptions,
  MillisecondsOptions,
} from "Common/Utils/Milliseconds";
