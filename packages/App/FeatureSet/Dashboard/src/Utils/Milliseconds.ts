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
 * roundMilliseconds rounds as Math.round did. A guard (Common
 * Tests/UI/MillisecondsInReadersLanguageGuard) refuses a duration built as
 * `x + " ms"` anywhere in the Dashboard, and any "ms" written beside a
 * figure in the monitor summaries and the monitor overview.
 */
export {
  formatMilliseconds,
  MILLISECONDS_TEMPLATE,
  roundMilliseconds,
} from "Common/Utils/Milliseconds";
export type { MillisecondsOptions } from "Common/Utils/Milliseconds";
