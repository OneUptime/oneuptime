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

/*
 * A MEASURE ON A CHART'S VALUE AXIS THAT IS NO COUNT (#7716): the average,
 * a percentile, the minimum or the maximum of a log attribute - 0.25, 182,
 * -7, 1.5K. A thousand and more is shortened with its scale letter as a
 * count is; below that it keeps three significant figures ("182", "12.5",
 * "0.025"), so a tick between whole numbers says where it is, and a
 * negative minimum keeps its sign. In the reader's digits, decimal sign and
 * minus, the letter kept ("0,025", "۱٫۵K"); English, or no language, as
 * written here.
 */
export function formatChartValue(
  value: number,
  language?: string | undefined,
): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  const sign: string = value < 0 ? "-" : "";
  const magnitude: number = Math.abs(value);
  // Rounded first, so 999.7 is shortened as the 1.0K it reads as.
  const rounded: number = Number(magnitude.toPrecision(3));

  let english: string;

  if (rounded >= 1000000) {
    english = `${(magnitude / 1000000).toFixed(1)}M`;
  } else if (rounded >= 1000) {
    english = `${(magnitude / 1000).toFixed(magnitude >= 10000 ? 0 : 1)}K`;
  } else {
    english = rounded.toString();
  }

  return writeFigureInLanguage(`${sign}${english}`, language);
}
