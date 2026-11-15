import { writeFigureInLanguage } from "../../../../Types/DateLanguage";

/*
 * A COUNT ON A CHART'S VALUE AXIS, IN THE READER'S DIGITS (#8349).
 *
 * The logs and traces histograms and the logs analytics chart wrote their
 * value axis with toFixed - "1.5K", "12K", "1.2M" in Latin digits and a
 * point on every page - beside a tooltip that wrote its counts in the
 * reader's digits and a time axis that always had. A count is written here
 * as it always was, a thousand and more shortened with a scale letter, in
 * the reader's digits and decimal sign with the letter kept ("1,5K",
 * "۱٫۵K"): short enough for a 48 px axis in every language, as the
 * database charts write their counts (writeFigureInLanguage). English, or
 * no language, reads exactly as before.
 */
export function formatChartCount(
  value: number,
  language?: string | undefined,
): string {
  if (value >= 1000000) {
    return writeFigureInLanguage(`${(value / 1000000).toFixed(1)}M`, language);
  }

  if (value >= 1000) {
    return writeFigureInLanguage(
      `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`,
      language,
    );
  }

  return writeFigureInLanguage(value.toString(), language);
}
