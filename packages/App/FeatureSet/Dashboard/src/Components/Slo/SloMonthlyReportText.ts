import OneUptimeDate from "Common/Types/Date";
import { translationKey, Translator } from "Common/Types/Translator";
import { StatusBadgeType } from "Common/UI/Components/StatusBadge/StatusBadge";
import {
  SLO_MONTHLY_REPORT_DEFAULT_MONTHS,
  SLO_MONTHLY_REPORT_EARLIEST_YEAR,
  SLO_MONTHLY_REPORT_MAX_MONTHS,
  SloMonthVerdict,
  SloMonthlyReportPeriod,
  SloMonthlyReportPeriodKind,
  SloMonthlyReportUnavailableReason,
} from "Common/Utils/Slo/SloMonthlyReport";
import { formatSloPercent } from "Common/Utils/Slo/SloWidgetFormat";

/*
 * THE WORDS AND FIGURES OF AN SLO'S MONTHLY REPORT PAGE, in the reader's
 * language. React-free, so a test can hand any locale to each of them.
 *
 *   - the periods the page offers: the last 3, 6, 9 or 12 months, this year
 *     and last year - each a value the address keeps ("?months=6",
 *     "?year=2025"), so a report can be shared as a link;
 *   - each verdict's words and colour, as the incident SLA page says Met and
 *     Missed;
 *   - a month named as the reader's language names it, in the zone the
 *     report cut it in ("März 2026");
 *   - an SLI written FLOORED to three decimals: a month at 99.8996% against
 *     a 99.9% target missed it, and must not read "99.9%".
 */

export const SLO_MONTHLY_REPORT_MONTHS_QUERY_PARAM: string = "months";
export const SLO_MONTHLY_REPORT_YEAR_QUERY_PARAM: string = "year";

// The value of a period choice: "months-6", "year-2025".
const MONTHS_VALUE_PREFIX: string = "months-";
const YEAR_VALUE_PREFIX: string = "year-";

/*
 * The four "last months" choices. Each is a key of its own, so a language
 * writes its own digits and noun ("۶ ماه", "6 Monate").
 */
const MONTH_CHOICE_LABELS: Record<number, string> = {
  3: translationKey("3 months"),
  6: translationKey("6 months"),
  9: translationKey("9 months"),
  12: translationKey("12 months"),
};

export interface SloMonthlyReportPeriodChoice {
  value: string;
  // In English for the four month choices (the picker looks them up), a year as the reader writes it.
  label: string;
  period: SloMonthlyReportPeriod;
}

export const getSloMonthlyReportPeriodValue: (
  period: SloMonthlyReportPeriod,
) => string = (period: SloMonthlyReportPeriod): string => {
  if (period.kind === SloMonthlyReportPeriodKind.Year) {
    return `${YEAR_VALUE_PREFIX}${period.year}`;
  }

  return `${MONTHS_VALUE_PREFIX}${period.months}`;
};

/*
 * The periods the page offers, in the order they are drawn: the last 3, 6,
 * 9 and 12 months, then this year and last year. A year is named as the
 * reader's language writes one ("2026", "۲۰۲۶", "2026年"), from the middle
 * of it so no timezone moves it into the year beside it.
 */
export const getSloMonthlyReportPeriodChoices: (
  now: Date,
) => Array<SloMonthlyReportPeriodChoice> = (
  now: Date,
): Array<SloMonthlyReportPeriodChoice> => {
  const choices: Array<SloMonthlyReportPeriodChoice> = Object.keys(
    MONTH_CHOICE_LABELS,
  ).map((monthsText: string): SloMonthlyReportPeriodChoice => {
    const months: number = Number(monthsText);
    const period: SloMonthlyReportPeriod = {
      kind: SloMonthlyReportPeriodKind.LastMonths,
      months: months,
    };

    return {
      value: getSloMonthlyReportPeriodValue(period),
      label: MONTH_CHOICE_LABELS[months]!,
      period: period,
    };
  });

  const thisYear: number = now.getUTCFullYear();

  for (const year of [thisYear, thisYear - 1]) {
    const period: SloMonthlyReportPeriod = {
      kind: SloMonthlyReportPeriodKind.Year,
      year: year,
    };

    choices.push({
      value: getSloMonthlyReportPeriodValue(period),
      label: OneUptimeDate.getDateAsLocalYearString(
        new Date(Date.UTC(year, 6, 1, 12)),
      ),
      period: period,
    });
  }

  return choices;
};

export const DEFAULT_SLO_MONTHLY_REPORT_PERIOD: SloMonthlyReportPeriod = {
  kind: SloMonthlyReportPeriodKind.LastMonths,
  months: SLO_MONTHLY_REPORT_DEFAULT_MONTHS,
};

// Named, because eslint's wrap-regex and prettier fight over a bare literal.
const WHOLE_NUMBER_PATTERN: RegExp = /^\d+$/;

type ReadWholeNumberFunction = (value: string | null) => number | null;

const readWholeNumber: ReadWholeNumberFunction = (
  value: string | null,
): number | null => {
  if (!value || !WHOLE_NUMBER_PATTERN.test(value)) {
    return null;
  }

  return parseInt(value, 10);
};

/*
 * The period the address asks for ("?months=6", "?year=2025"), or the
 * default - the last 12 months - for anything else, so a link that was
 * edited by hand still opens a report.
 */
export const readSloMonthlyReportPeriod: (data: {
  months: string | null;
  year: string | null;
  now: Date;
}) => SloMonthlyReportPeriod = (data: {
  months: string | null;
  year: string | null;
  now: Date;
}): SloMonthlyReportPeriod => {
  const year: number | null = readWholeNumber(data.year);

  if (
    year !== null &&
    year >= SLO_MONTHLY_REPORT_EARLIEST_YEAR &&
    year <= data.now.getUTCFullYear()
  ) {
    return { kind: SloMonthlyReportPeriodKind.Year, year: year };
  }

  const months: number | null = readWholeNumber(data.months);

  if (
    months !== null &&
    months >= 1 &&
    months <= SLO_MONTHLY_REPORT_MAX_MONTHS
  ) {
    return { kind: SloMonthlyReportPeriodKind.LastMonths, months: months };
  }

  return DEFAULT_SLO_MONTHLY_REPORT_PERIOD;
};

// The address's values for a period: the other one is taken away.
export const getSloMonthlyReportPeriodSearch: (
  period: SloMonthlyReportPeriod,
) => Record<string, string | null> = (
  period: SloMonthlyReportPeriod,
): Record<string, string | null> => {
  if (period.kind === SloMonthlyReportPeriodKind.Year) {
    return {
      [SLO_MONTHLY_REPORT_MONTHS_QUERY_PARAM]: null,
      [SLO_MONTHLY_REPORT_YEAR_QUERY_PARAM]: period.year.toString(),
    };
  }

  return {
    [SLO_MONTHLY_REPORT_MONTHS_QUERY_PARAM]:
      period.months === SLO_MONTHLY_REPORT_DEFAULT_MONTHS
        ? null
        : period.months.toString(),
    [SLO_MONTHLY_REPORT_YEAR_QUERY_PARAM]: null,
  };
};

// ---- Verdicts ----------------------------------------------------------------

export const SLO_MONTH_VERDICT_TEXT: Record<SloMonthVerdict, string> = {
  // "Met", as the incident SLA page says it of a deadline.
  [SloMonthVerdict.Met]: translationKey("Met"),
  // "Missed" in English; a target missed, never a deadline, in every language.
  [SloMonthVerdict.Missed]: translationKey("Missed (target)"),
  [SloMonthVerdict.OnTrack]: translationKey("On track"),
  [SloMonthVerdict.BelowTarget]: translationKey("Below target"),
  [SloMonthVerdict.NoData]: translationKey("No data"),
};

export const SLO_MONTH_VERDICT_BADGE_TYPE: Record<
  SloMonthVerdict,
  StatusBadgeType
> = {
  [SloMonthVerdict.Met]: StatusBadgeType.Success,
  [SloMonthVerdict.Missed]: StatusBadgeType.Danger,
  [SloMonthVerdict.OnTrack]: StatusBadgeType.Success,
  [SloMonthVerdict.BelowTarget]: StatusBadgeType.Warning,
  [SloMonthVerdict.NoData]: StatusBadgeType.Neutral,
};

// An SLI's colour where it is drawn as a figure (the monitors' grid).
export const SLO_MONTH_VERDICT_TEXT_CLASS: Record<SloMonthVerdict, string> = {
  [SloMonthVerdict.Met]: "text-emerald-700",
  [SloMonthVerdict.Missed]: "text-red-700",
  [SloMonthVerdict.OnTrack]: "text-emerald-700",
  [SloMonthVerdict.BelowTarget]: "text-amber-700",
  [SloMonthVerdict.NoData]: "text-gray-400",
};

// The error budget bar's colour: green, amber from 75%, red once spent.
export const getSloBudgetUsedBarClassName: (
  usedPercentage: number,
) => string = (usedPercentage: number): string => {
  if (usedPercentage > 100) {
    return "bg-red-500";
  }

  if (usedPercentage >= 75) {
    return "bg-amber-500";
  }

  return "bg-emerald-500";
};

// ---- Why there is no report ----------------------------------------------

export const SLO_MONTHLY_REPORT_UNAVAILABLE_TEXT: Record<
  SloMonthlyReportUnavailableReason,
  string
> = {
  [SloMonthlyReportUnavailableReason.NoMonitors]: translationKey(
    "No monitors are attached to this SLO, so there is nothing to report yet. Add the monitors it measures, or a monitor rule that attaches them.",
  ),
  [SloMonthlyReportUnavailableReason.NoServices]: translationKey(
    "This SLO measures requests, but no services are chosen, so there is nothing to report yet. Choose its services in Settings.",
  ),
  [SloMonthlyReportUnavailableReason.NoLatencyThreshold]: translationKey(
    "This SLO has no latency threshold, so no request can be counted as fast enough. Set its latency threshold in Settings.",
  ),
  [SloMonthlyReportUnavailableReason.NotMeasured]: translationKey(
    "OneUptime does not measure this SLO's SLI type, so there is nothing to report. Choose what it measures in Settings.",
  ),
  [SloMonthlyReportUnavailableReason.TargetOutOfRange]: translationKey(
    "This SLO's target is out of range, so no month can be judged against it. Set a target such as 99.9% in Settings.",
  ),
};

// ---- Figures ------------------------------------------------------------------

export const SLO_MONTHLY_REPORT_SLI_DECIMALS: number = 3;

/*
 * An SLI as the report writes it: floored to three decimals, so a figure
 * never reads as meeting a target it missed, in the reader's digits.
 */
export const formatSloMonthlyReportSli: (
  value: number | null,
  translator: Translator,
) => string | null = (
  value: number | null,
  translator: Translator,
): string | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  const factor: number = Math.pow(10, SLO_MONTHLY_REPORT_SLI_DECIMALS);
  // A hair under the next thousandth is still under it: 99.89999999 is not 99.9.
  const floored: number = Math.floor(value * factor + 1e-9) / factor;

  return formatSloPercent(floored, SLO_MONTHLY_REPORT_SLI_DECIMALS, translator);
};

// The share of the error budget used: one decimal, uncapped ("240%").
export const formatSloBudgetUsed: (
  value: number | null,
  translator: Translator,
) => string | null = (
  value: number | null,
  translator: Translator,
): string | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return formatSloPercent(Math.max(0, value), 1, translator);
};

/*
 * A month's name as the reader's language writes it, in the zone the
 * report cut it in: "March 2026", "März 2026", "2026年3月". Short, for the
 * monitors' grid: "Mar 2026".
 */
export const getSloReportMonthName: (data: {
  monthStart: Date;
  timezone: string;
  isShort?: boolean | undefined;
}) => string = (data: {
  monthStart: Date;
  timezone: string;
  isShort?: boolean | undefined;
}): string => {
  return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
    date: data.monthStart,
    format: data.isShort ? "MMM YYYY" : "MMMM YYYY",
    timezone: data.timezone,
  });
};
