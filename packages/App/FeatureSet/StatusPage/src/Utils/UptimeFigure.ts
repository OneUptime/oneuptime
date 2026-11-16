import { formatReaderFigure } from "Common/Types/DateLanguage";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";

/*
 * AN UPTIME FIGURE, IN THE STATUS PAGE'S LANGUAGE (#8292).
 *
 * A group's uptime, a grid cell's average and the overall banner were
 * handed to the "overview.uptimePercent" sentence as the code wrote them -
 * String(99.95), avg.toFixed(2) - and the sentence put its own "%" after
 * them: a Persian status page read "99.95٪ زمان کارکرد" beside Persian
 * words, and a German one "99.95% Verfügbarkeit" where German writes
 * "99,95 %". The figure is written here with the language's digits, decimal
 * sign and percent sign, exactly as Intl writes a percentage in it -
 * "۹۹٫۹۵٪", "99,95 %", "99,95 %" in French, Latin digits in Arabic - and the
 * sentence places it whole ("{{percent}} uptime", "稼働率 {{percent}}").
 * English reads exactly as before: "99.95% uptime".
 *
 * `decimals` keeps the decimals toFixed wrote (the grid's average, 2);
 * left out, the figure is written as String() wrote it - its own decimals,
 * up to the three an uptime precision keeps, trailing zeros dropped.
 */
export const UPTIME_FIGURE_MAX_DECIMALS: number = 3;

export function formatUptimePercentFigure(
  percent: number,
  language: string | undefined,
  options?: { decimals?: number | undefined },
): string {
  if (!Number.isFinite(percent)) {
    return EMPTY_VALUE_MARK;
  }

  if (options?.decimals !== undefined) {
    return formatReaderFigure(percent, {
      decimals: options.decimals,
      isPercent: true,
      language: language || "en",
    });
  }

  return formatReaderFigure(percent, {
    decimals: UPTIME_FIGURE_MAX_DECIMALS,
    dropTrailingZeros: true,
    isPercent: true,
    language: language || "en",
  });
}
