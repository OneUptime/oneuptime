import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import OneUptimeDate, { Moment } from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import SliType from "../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import {
  SloEventSliResult,
  SloRequestCounts,
  computeEventSli,
  isRequestSliType,
} from "./SloRequestSli";
import SloUtil, { MonitorTimelineSet, TimeSliResult } from "./SloUtil";

/*
 * AN SLO'S MONTHLY REPORT: how the SLO did in each calendar month of a
 * period - the last few months, or one calendar year - and over the whole
 * period, the months in the SLO's own timezone (UTC when it has none).
 *
 *   GET /service-level-objective/:id/monthly-report?months=12
 *   GET /service-level-objective/:id/monthly-report?year=2025
 *
 * Nothing is stored for it. A Monitor Uptime SLO's months are worked out
 * from its monitors' status timelines, which OneUptime keeps for as long as
 * the monitors exist, exactly as the evaluation worker measures a window
 * (SloUtil.computeTimeSli): so a report reaches back before the SLO was
 * created, and a status timeline edited later is reflected the next time
 * the report is read. A request SLO's months are summed from the request
 * counts the worker keeps in SloHistory (400 days), from where the current
 * counting starts (firstAccumulatedBucketStartAt) - and so are a Metric
 * SLO's, from the good and total events of its metric that the worker keeps
 * the same way. Each month is measured
 * against the SLO's monitors, services, downtime statuses and target as
 * they are now.
 *
 * Each month says:
 *
 *   - its SLI, UNROUNDED (null when nothing was measured in it);
 *   - what it was measured over: seconds (`total`) and the seconds counted
 *     as downtime (`bad`) for monitors, requests and bad requests for a
 *     request SLO;
 *   - how much of its error budget it used;
 *   - its verdict: Met or Missed once the month is over. The month still
 *     running is On Track or Below Target - and Missed as soon as its
 *     downtime is more than the whole month allows, which no later uptime
 *     can undo.
 *
 * The total is the period measured as one: its seconds and bad seconds are
 * the months' sums (the months split the period, so this is the period's
 * own SLI), judged as the months are.
 *
 * Isomorphic (no server imports): the server builds the report
 * (Server/Utils/Slo/SloMonthlyReportMeasurement), the Dashboard reads it
 * back with parseSloMonthlyReport and downloads it with
 * buildSloMonthlyReportCsv, and a test can drive every rule here without a
 * database.
 */

export const SLO_MONTHLY_REPORT_ROUTE: string = "/monthly-report";

// The months the Dashboard offers, and the period it opens on.
export const SLO_MONTHLY_REPORT_MONTH_CHOICES: ReadonlyArray<number> = [
  3, 6, 9, 12,
];

export const SLO_MONTHLY_REPORT_DEFAULT_MONTHS: number = 12;

/*
 * The most months one "last months" report covers: two years. A request
 * SLO's counts are kept for 400 days, so its older months read as no data.
 */
export const SLO_MONTHLY_REPORT_MAX_MONTHS: number = 24;

// The earliest calendar year a report may be asked for.
export const SLO_MONTHLY_REPORT_EARLIEST_YEAR: number = 2000;

export const SLO_MONTHLY_REPORT_DEFAULT_TIMEZONE: string = "UTC";

export enum SloMonthlyReportPeriodKind {
  // The months ending with the current one: "months=6".
  LastMonths = "LastMonths",
  // One calendar year, January to December: "year=2025".
  Year = "Year",
}

export type SloMonthlyReportPeriod =
  | { kind: SloMonthlyReportPeriodKind.LastMonths; months: number }
  | { kind: SloMonthlyReportPeriodKind.Year; year: number };

// What a report's figures count.
export enum SloMonthlyReportUnit {
  // Monitor Uptime: seconds measured, and the seconds counted as downtime.
  Seconds = "Seconds",
  // Request Success and Request Latency: requests, and the bad ones.
  Requests = "Requests",
  // Metric: the events of its counter or histogram, and the bad ones.
  Events = "Events",
}

export enum SloMonthVerdict {
  // A month that is over, at or above the target.
  Met = "Met",
  // Below the target - or, while the month runs, already past what it allows.
  Missed = "Missed",
  // The month still running, at or above the target so far.
  OnTrack = "OnTrack",
  // The month still running, below the target so far.
  BelowTarget = "BelowTarget",
  // Nothing was measured: no monitor data, or no request counted.
  NoData = "NoData",
}

/*
 * Why a report holds no months: the SLO measures nothing OneUptime can
 * report on yet. The Dashboard says each in the reader's words; the API
 * carries the English sentence beside the code
 * (SLO_MONTHLY_REPORT_UNAVAILABLE_MESSAGES).
 */
export enum SloMonthlyReportUnavailableReason {
  NoMonitors = "NoMonitors",
  NoServices = "NoServices",
  NoServicesForMetric = "NoServicesForMetric",
  NoMetric = "NoMetric",
  NoLatencyThreshold = "NoLatencyThreshold",
  NotMeasured = "NotMeasured",
  TargetOutOfRange = "TargetOutOfRange",
}

export const SLO_MONTHLY_REPORT_UNAVAILABLE_MESSAGES: Record<
  SloMonthlyReportUnavailableReason,
  string
> = {
  [SloMonthlyReportUnavailableReason.NoMonitors]:
    "No monitors are attached to this SLO, so there is nothing to report. Attach monitors, or add a monitor rule, first.",
  [SloMonthlyReportUnavailableReason.NoServices]:
    "This SLO measures requests, but no services are chosen, so there is nothing to report. Choose the services whose requests it measures first.",
  [SloMonthlyReportUnavailableReason.NoServicesForMetric]:
    "This SLO measures a metric, but no services are chosen, so there is nothing to report. Choose the services whose metric it measures first.",
  [SloMonthlyReportUnavailableReason.NoMetric]:
    "This Metric SLO has no metric it can count, so there is nothing to report. Choose its metric, and how its good events are told apart, first.",
  [SloMonthlyReportUnavailableReason.NoLatencyThreshold]:
    "This Request Latency SLO has no latency threshold, so no request can be counted as fast enough. Set its latency threshold first.",
  [SloMonthlyReportUnavailableReason.NotMeasured]:
    "OneUptime does not measure this SLO's SLI type, so there is nothing to report. Choose Monitor Uptime, Request Success, Request Latency or Metric.",
  [SloMonthlyReportUnavailableReason.TargetOutOfRange]:
    "This SLO's target is outside the valid range - it must be greater than 0 and below 100 - so no month can be judged against it. Set a target such as 99.9 first.",
};

export const SLO_MONTHLY_REPORT_OPTION_ERRORS: {
  months: string;
  year: string;
  both: string;
} = {
  months: `The months option must be a whole number from 1 to ${SLO_MONTHLY_REPORT_MAX_MONTHS}: how many months the report covers, ending with the current month.`,
  year: `The year option must be a calendar year from ${SLO_MONTHLY_REPORT_EARLIEST_YEAR} to this year, such as 2025.`,
  both: "Ask for either months or year, not both: months covers the last few months, and year one calendar year.",
};

// One calendar month of a report, in the SLO's timezone.
export interface SloReportMonth {
  // The first instant of the month.
  startDate: Date;
  // EXCLUSIVE: the first instant of the next month.
  endDate: Date;
  // The month that is still running: it is measured up to now.
  isMonthToDate: boolean;
}

export interface SloMonthlyFigures {
  /*
   * What the month was measured over: seconds measured for a Monitor
   * Uptime SLO (time with monitoring off and before any monitor had data
   * is left out), requests counted for a request SLO, events for a Metric
   * SLO.
   */
  total: number;
  // Of those, the seconds counted as downtime, or the bad requests or events.
  bad: number;
  // UNROUNDED. Null when nothing was measured (total is 0).
  sliPercentage: number | null;
}

export interface SloJudgedFigures extends SloMonthlyFigures {
  /*
   * The share of the error budget used, UNROUNDED and uncapped (above 100
   * once the budget is spent). Null when nothing was measured. A month
   * still running, measured in seconds, is held to its WHOLE month's
   * budget, as a Calendar Month SLO's budget is: its downtime so far
   * against what the month allows.
   */
  errorBudgetUsedPercentage: number | null;
  verdict: SloMonthVerdict;
}

export interface SloMonthlyReportRow extends SloJudgedFigures {
  monthStart: Date;
  monthEnd: Date;
  isMonthToDate: boolean;
}

export interface SloMonthlyReportTotal extends SloJudgedFigures {
  // The period runs into the current month, so the total is "so far" too.
  includesMonthToDate: boolean;
}

// One monitor's own availability in each month, for the breakdown.
export interface SloMonthlyReportMonitor {
  monitorId: string;
  name: string;
  // Aligned with the report's months.
  months: Array<SloJudgedFigures>;
  total: SloJudgedFigures;
}

export interface SloMonthlyReport {
  sloId: string;
  // The SLO's name, for the file a report is downloaded as.
  sloName: string;
  sliType: SliType | null;
  unit: SloMonthlyReportUnit;
  // Null only when the report is unavailable because of it.
  targetPercentage: number | null;
  // The zone the months are cut in.
  timezone: string;
  period: SloMonthlyReportPeriod;
  generatedAt: Date;
  // Set when the SLO measures nothing to report: the months are then empty.
  unavailableReason: SloMonthlyReportUnavailableReason | null;
  // Oldest first.
  months: Array<SloMonthlyReportRow>;
  total: SloMonthlyReportTotal;
  /*
   * A Monitor Uptime SLO's monitors the reader may see, each on its own,
   * worst total first. Empty for a request SLO.
   */
  monitors: Array<SloMonthlyReportMonitor>;
}

// ---- The period ------------------------------------------------------------

// Named, because eslint's wrap-regex and prettier fight over a bare literal.
const WHOLE_NUMBER_PATTERN: RegExp = /^\s*\d+\s*$/;

type ReadWholeNumberFunction = (value: unknown) => number | null;

const readWholeNumber: ReadWholeNumberFunction = (
  value: unknown,
): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value !== "string" || !WHOLE_NUMBER_PATTERN.test(value)) {
    return null;
  }

  return parseInt(value.trim(), 10);
};

type IsGivenFunction = (value: unknown) => boolean;

const isGiven: IsGivenFunction = (value: unknown): boolean => {
  return value !== undefined && value !== null && value !== "";
};

/*
 * The period a request asks for: `months` (1 to 24, the current month
 * included) or `year` (a calendar year), from a query string or a JSON
 * body. Neither gives the Dashboard's default, the last 12 months. A value
 * that is not one of those is refused with what to send instead.
 */
export const parseSloMonthlyReportPeriod: (data: {
  months?: unknown;
  year?: unknown;
  now: Date;
}) => SloMonthlyReportPeriod = (data: {
  months?: unknown;
  year?: unknown;
  now: Date;
}): SloMonthlyReportPeriod => {
  const hasMonths: boolean = isGiven(data.months);
  const hasYear: boolean = isGiven(data.year);

  if (hasMonths && hasYear) {
    throw new BadDataException(SLO_MONTHLY_REPORT_OPTION_ERRORS.both);
  }

  if (hasYear) {
    const year: number | null = readWholeNumber(data.year);

    /*
     * One year past the current UTC year is allowed: in a timezone ahead of
     * UTC, the new year starts a few hours before it does in UTC.
     */
    if (
      year === null ||
      year < SLO_MONTHLY_REPORT_EARLIEST_YEAR ||
      year > data.now.getUTCFullYear() + 1
    ) {
      throw new BadDataException(SLO_MONTHLY_REPORT_OPTION_ERRORS.year);
    }

    return { kind: SloMonthlyReportPeriodKind.Year, year: year };
  }

  if (!hasMonths) {
    return {
      kind: SloMonthlyReportPeriodKind.LastMonths,
      months: SLO_MONTHLY_REPORT_DEFAULT_MONTHS,
    };
  }

  const months: number | null = readWholeNumber(data.months);

  if (months === null || months < 1 || months > SLO_MONTHLY_REPORT_MAX_MONTHS) {
    throw new BadDataException(SLO_MONTHLY_REPORT_OPTION_ERRORS.months);
  }

  return { kind: SloMonthlyReportPeriodKind.LastMonths, months: months };
};

/*
 * The period as a query string's values, as the API reads them back:
 * { months: "6" } or { year: "2025" }.
 */
export const getSloMonthlyReportPeriodQuery: (
  period: SloMonthlyReportPeriod,
) => Record<string, string> = (
  period: SloMonthlyReportPeriod,
): Record<string, string> => {
  if (period.kind === SloMonthlyReportPeriodKind.Year) {
    return { year: period.year.toString() };
  }

  return { months: period.months.toString() };
};

export const isSameSloMonthlyReportPeriod: (
  a: SloMonthlyReportPeriod,
  b: SloMonthlyReportPeriod,
) => boolean = (
  a: SloMonthlyReportPeriod,
  b: SloMonthlyReportPeriod,
): boolean => {
  if (a.kind === SloMonthlyReportPeriodKind.Year) {
    return b.kind === SloMonthlyReportPeriodKind.Year && a.year === b.year;
  }

  return (
    b.kind === SloMonthlyReportPeriodKind.LastMonths && a.months === b.months
  );
};

/*
 * The zone a report's months are cut in: the SLO's own (what its Calendar
 * Month window uses), or UTC when it has none - or names one this server
 * does not know, which would otherwise leave every month undefined.
 */
export const getSloMonthlyReportTimezone: (
  timezone: string | undefined | null,
) => string = (timezone: string | undefined | null): string => {
  const trimmed: string = (timezone || "").trim();

  if (trimmed && Moment.tz.zone(trimmed)) {
    return trimmed;
  }

  return SLO_MONTHLY_REPORT_DEFAULT_TIMEZONE;
};

/*
 * The calendar months of a period, oldest first, in the timezone: the last
 * `months` months ending with the one `now` is in, or January to December
 * of a year - without the months that have not started yet. The month `now`
 * is in is the month to date.
 */
export const getSloReportMonths: (data: {
  period: SloMonthlyReportPeriod;
  timezone?: string | undefined | null;
  now: Date;
}) => Array<SloReportMonth> = (data: {
  period: SloMonthlyReportPeriod;
  timezone?: string | undefined | null;
  now: Date;
}): Array<SloReportMonth> => {
  const timezone: string = getSloMonthlyReportTimezone(data.timezone);
  const nowTime: number = data.now.getTime();

  let firstMonth: ReturnType<typeof Moment.tz>;
  let count: number;

  if (data.period.kind === SloMonthlyReportPeriodKind.Year) {
    firstMonth = Moment.tz(
      { year: data.period.year, month: 0, date: 1 },
      timezone,
    ).startOf("month");
    count = 12;
  } else {
    count = Math.max(1, Math.floor(data.period.months));
    firstMonth = Moment.tz(data.now, timezone)
      .startOf("month")
      .subtract(count - 1, "months");
  }

  const months: Array<SloReportMonth> = [];

  for (let index: number = 0; index < count; index++) {
    const start: ReturnType<typeof Moment.tz> = firstMonth
      .clone()
      .add(index, "months");

    if (start.valueOf() > nowTime) {
      break;
    }

    const end: ReturnType<typeof Moment.tz> = start.clone().add(1, "month");

    months.push({
      startDate: start.toDate(),
      endDate: end.toDate(),
      isMonthToDate: end.valueOf() > nowTime,
    });
  }

  return months;
};

// ---- Measuring -------------------------------------------------------------

const NO_FIGURES: SloMonthlyFigures = {
  total: 0,
  bad: 0,
  sliPercentage: null,
};

type ToTimeFunction = (value: Date | string | undefined | null) => number;

const toTime: ToTimeFunction = (
  value: Date | string | undefined | null,
): number => {
  if (!value) {
    return NaN;
  }

  return OneUptimeDate.fromString(value).getTime();
};

/*
 * The rows of a monitor's status timeline that hold time inside the month:
 * started before it ends, and ended after it starts or still open. Strict
 * on both sides, so a row that only touches the month - one that starts the
 * instant the next month does - is no data for it: SloUtil reads a window
 * whose rows hold none of its time as up from start to end.
 */
export const getTimelinesInMonth: (
  timelines: Array<MonitorStatusTimeline>,
  month: { startDate: Date; endDate: Date },
) => Array<MonitorStatusTimeline> = (
  timelines: Array<MonitorStatusTimeline>,
  month: { startDate: Date; endDate: Date },
): Array<MonitorStatusTimeline> => {
  const start: number = month.startDate.getTime();
  const end: number = month.endDate.getTime();

  return timelines.filter((timeline: MonitorStatusTimeline): boolean => {
    const startsAt: number = toTime(timeline.startsAt);

    if (!Number.isFinite(startsAt) || startsAt >= end) {
      return false;
    }

    if (!timeline.endsAt) {
      return true;
    }

    return toTime(timeline.endsAt) > start;
  });
};

type ToTimeFiguresFunction = (result: TimeSliResult) => SloMonthlyFigures;

const toTimeFigures: ToTimeFiguresFunction = (
  result: TimeSliResult,
): SloMonthlyFigures => {
  if (result.totalSeconds <= 0) {
    return { ...NO_FIGURES };
  }

  return {
    total: result.totalSeconds,
    bad: result.badSeconds,
    sliPercentage: result.sliPercentage,
  };
};

/*
 * The figures of a set of counts: requests counted, the bad ones, and their
 * SLI - none when nothing was counted.
 */
export const getRequestMonthlyFigures: (
  counts: SloRequestCounts,
) => SloMonthlyFigures = (counts: SloRequestCounts): SloMonthlyFigures => {
  const sli: SloEventSliResult = computeEventSli(counts);

  if (sli.totalEventCount <= 0) {
    return { ...NO_FIGURES };
  }

  return {
    total: sli.totalEventCount,
    bad: sli.badEventCount,
    sliPercentage: sli.sliPercentage,
  };
};

/*
 * The figures of several months together: their sums, and the SLI of the
 * sums - the period's own, since the months split it.
 */
export const sumSloMonthlyFigures: (
  figures: Array<SloMonthlyFigures>,
) => SloMonthlyFigures = (
  figures: Array<SloMonthlyFigures>,
): SloMonthlyFigures => {
  let total: number = 0;
  let bad: number = 0;

  for (const month of figures) {
    if (month.sliPercentage === null || month.total <= 0) {
      continue;
    }

    total += month.total;
    bad += month.bad;
  }

  if (total <= 0) {
    return { ...NO_FIGURES };
  }

  return {
    total: total,
    bad: bad,
    sliPercentage: ((total - bad) / total) * 100,
  };
};

export interface SloMonitorUptimeMonthlyFigures {
  // The SLO's own figures, one per month.
  months: Array<SloMonthlyFigures>;
  // Each monitor alone, one per month, in the order the monitors came.
  monitors: Array<{ monitorId: ObjectID; months: Array<SloMonthlyFigures> }>;
}

/*
 * A Monitor Uptime SLO's months, measured as the evaluation worker measures
 * a window (SloUtil.computeTimeSli): the SLO's monitors combined by its
 * multi-monitor mode, and each monitor alone for the breakdown. The
 * timelines are those of the whole period; each month reads only its own
 * rows, so a month before a monitor had data is no data rather than up.
 */
export const computeMonitorUptimeMonthlyFigures: (data: {
  perMonitorTimelines: Array<MonitorTimelineSet>;
  downtimeStatuses: Array<MonitorStatus>;
  mode: SloMultiMonitorMode;
  months: Array<SloReportMonth>;
}) => SloMonitorUptimeMonthlyFigures = (data: {
  perMonitorTimelines: Array<MonitorTimelineSet>;
  downtimeStatuses: Array<MonitorStatus>;
  mode: SloMultiMonitorMode;
  months: Array<SloReportMonth>;
}): SloMonitorUptimeMonthlyFigures => {
  const sloMonths: Array<SloMonthlyFigures> = [];

  const monitors: Array<{
    monitorId: ObjectID;
    months: Array<SloMonthlyFigures>;
  }> = data.perMonitorTimelines.map(
    (
      monitor: MonitorTimelineSet,
    ): { monitorId: ObjectID; months: Array<SloMonthlyFigures> } => {
      return { monitorId: monitor.monitorId, months: [] };
    },
  );

  for (const month of data.months) {
    const window: { startDate: Date; endDate: Date } = {
      startDate: month.startDate,
      endDate: month.endDate,
    };

    const monthTimelines: Array<MonitorTimelineSet> =
      data.perMonitorTimelines.map(
        (monitor: MonitorTimelineSet): MonitorTimelineSet => {
          return {
            monitorId: monitor.monitorId,
            timelines: getTimelinesInMonth(monitor.timelines, window),
          };
        },
      );

    sloMonths.push(
      toTimeFigures(
        SloUtil.computeTimeSli({
          perMonitorTimelines: monthTimelines,
          downtimeStatuses: data.downtimeStatuses,
          window: window,
          mode: data.mode,
        }),
      ),
    );

    monthTimelines.forEach(
      (monitorTimelines: MonitorTimelineSet, index: number): void => {
        monitors[index]!.months.push(
          toTimeFigures(
            SloUtil.computeTimeSli({
              perMonitorTimelines: [monitorTimelines],
              downtimeStatuses: data.downtimeStatuses,
              window: window,
              mode: SloMultiMonitorMode.AnyDown,
            }),
          ),
        );
      },
    );
  }

  return { months: sloMonths, monitors: monitors };
};

// ---- Judging -----------------------------------------------------------------

export const isValidSloTargetPercentage: (
  targetPercentage: number | null | undefined,
) => boolean = (targetPercentage: number | null | undefined): boolean => {
  return (
    typeof targetPercentage === "number" &&
    Number.isFinite(targetPercentage) &&
    targetPercentage > 0 &&
    targetPercentage < 100
  );
};

/*
 * The share of the error budget a month used: its bad seconds or requests
 * against the bad ones the target allows over `budgetBase` - what it was
 * measured over, or, for a month still running measured in seconds, that
 * plus the seconds left in it.
 */
export const getSloErrorBudgetUsedPercentage: (data: {
  figures: SloMonthlyFigures;
  targetPercentage: number;
  budgetBase?: number | undefined;
}) => number | null = (data: {
  figures: SloMonthlyFigures;
  targetPercentage: number;
  budgetBase?: number | undefined;
}): number | null => {
  if (
    data.figures.sliPercentage === null ||
    data.figures.total <= 0 ||
    !isValidSloTargetPercentage(data.targetPercentage)
  ) {
    return null;
  }

  const base: number = Math.max(
    data.figures.total,
    data.budgetBase ?? data.figures.total,
  );

  const allowedBad: number = (1 - data.targetPercentage / 100) * base;

  return (data.figures.bad / allowedBad) * 100;
};

/*
 * A month's verdict, from UNROUNDED figures. Over: Met or Missed. Still
 * running: Missed once its error budget for the whole month is spent (only
 * a month measured in seconds knows its whole budget - requests still to
 * come can always lift a request SLO's month), else On Track or Below
 * Target by its SLI so far.
 */
export const getSloMonthVerdict: (data: {
  sliPercentage: number | null;
  targetPercentage: number;
  isMonthToDate: boolean;
  wholeMonthBudgetUsedPercentage?: number | null | undefined;
}) => SloMonthVerdict = (data: {
  sliPercentage: number | null;
  targetPercentage: number;
  isMonthToDate: boolean;
  wholeMonthBudgetUsedPercentage?: number | null | undefined;
}): SloMonthVerdict => {
  if (
    data.sliPercentage === null ||
    !isValidSloTargetPercentage(data.targetPercentage)
  ) {
    return SloMonthVerdict.NoData;
  }

  const isAtOrAboveTarget: boolean =
    data.sliPercentage >= data.targetPercentage;

  if (!data.isMonthToDate) {
    return isAtOrAboveTarget ? SloMonthVerdict.Met : SloMonthVerdict.Missed;
  }

  if (
    typeof data.wholeMonthBudgetUsedPercentage === "number" &&
    data.wholeMonthBudgetUsedPercentage > 100
  ) {
    return SloMonthVerdict.Missed;
  }

  return isAtOrAboveTarget
    ? SloMonthVerdict.OnTrack
    : SloMonthVerdict.BelowTarget;
};

// Seconds still to come in a month, or none once it is over.
const getSecondsLeft: (endDate: Date, now: Date) => number = (
  endDate: Date,
  now: Date,
): number => {
  return Math.max(0, (endDate.getTime() - now.getTime()) / 1000);
};

/*
 * Figures judged: their error budget used and their verdict. A period that
 * runs into the current month is judged as that month is, with the seconds
 * still to come in it added to its budget.
 */
export const judgeSloMonthlyFigures: (data: {
  figures: SloMonthlyFigures;
  targetPercentage: number;
  unit: SloMonthlyReportUnit;
  isMonthToDate: boolean;
  secondsLeft: number;
}) => SloJudgedFigures = (data: {
  figures: SloMonthlyFigures;
  targetPercentage: number;
  unit: SloMonthlyReportUnit;
  isMonthToDate: boolean;
  secondsLeft: number;
}): SloJudgedFigures => {
  const isSeconds: boolean = data.unit === SloMonthlyReportUnit.Seconds;

  const budgetBase: number | undefined =
    data.isMonthToDate && isSeconds
      ? data.figures.total + data.secondsLeft
      : undefined;

  const errorBudgetUsedPercentage: number | null =
    getSloErrorBudgetUsedPercentage({
      figures: data.figures,
      targetPercentage: data.targetPercentage,
      budgetBase: budgetBase,
    });

  return {
    ...data.figures,
    errorBudgetUsedPercentage: errorBudgetUsedPercentage,
    verdict: getSloMonthVerdict({
      sliPercentage: data.figures.sliPercentage,
      targetPercentage: data.targetPercentage,
      isMonthToDate: data.isMonthToDate,
      wholeMonthBudgetUsedPercentage: isSeconds
        ? errorBudgetUsedPercentage
        : null,
    }),
  };
};

export const getSloMonthlyReportUnit: (
  sliType: SliType | string | null | undefined,
) => SloMonthlyReportUnit = (
  sliType: SliType | string | null | undefined,
): SloMonthlyReportUnit => {
  if (isRequestSliType(sliType)) {
    return SloMonthlyReportUnit.Requests;
  }

  if (sliType === SliType.Metric) {
    return SloMonthlyReportUnit.Events;
  }

  return SloMonthlyReportUnit.Seconds;
};

/*
 * A report from its months' figures: each month and the total judged, and
 * each monitor's breakdown judged and sorted worst total first (by name
 * between equals), so the monitor that cost the SLO most heads the list.
 */
export const buildSloMonthlyReport: (data: {
  sloId: ObjectID | string;
  sloName?: string | undefined;
  sliType: SliType | null;
  targetPercentage: number;
  timezone: string;
  period: SloMonthlyReportPeriod;
  months: Array<SloReportMonth>;
  figures: Array<SloMonthlyFigures>;
  monitors?:
    | Array<{
        monitorId: ObjectID | string;
        name: string;
        months: Array<SloMonthlyFigures>;
      }>
    | undefined;
  now: Date;
}) => SloMonthlyReport = (data: {
  sloId: ObjectID | string;
  sloName?: string | undefined;
  sliType: SliType | null;
  targetPercentage: number;
  timezone: string;
  period: SloMonthlyReportPeriod;
  months: Array<SloReportMonth>;
  figures: Array<SloMonthlyFigures>;
  monitors?:
    | Array<{
        monitorId: ObjectID | string;
        name: string;
        months: Array<SloMonthlyFigures>;
      }>
    | undefined;
  now: Date;
}): SloMonthlyReport => {
  const unit: SloMonthlyReportUnit = getSloMonthlyReportUnit(data.sliType);

  const monthToDate: SloReportMonth | undefined = data.months.find(
    (month: SloReportMonth): boolean => {
      return month.isMonthToDate;
    },
  );

  const secondsLeftInPeriod: number = monthToDate
    ? getSecondsLeft(monthToDate.endDate, data.now)
    : 0;

  const judgeMonths: (
    figures: Array<SloMonthlyFigures>,
  ) => Array<SloJudgedFigures> = (
    figures: Array<SloMonthlyFigures>,
  ): Array<SloJudgedFigures> => {
    return data.months.map(
      (month: SloReportMonth, index: number): SloJudgedFigures => {
        return judgeSloMonthlyFigures({
          figures: figures[index] || { ...NO_FIGURES },
          targetPercentage: data.targetPercentage,
          unit: unit,
          isMonthToDate: month.isMonthToDate,
          secondsLeft: month.isMonthToDate
            ? getSecondsLeft(month.endDate, data.now)
            : 0,
        });
      },
    );
  };

  const judgeTotal: (figures: Array<SloMonthlyFigures>) => SloJudgedFigures = (
    figures: Array<SloMonthlyFigures>,
  ): SloJudgedFigures => {
    return judgeSloMonthlyFigures({
      figures: sumSloMonthlyFigures(
        data.months.map((_month: SloReportMonth, index: number) => {
          return figures[index] || { ...NO_FIGURES };
        }),
      ),
      targetPercentage: data.targetPercentage,
      unit: unit,
      isMonthToDate: Boolean(monthToDate),
      secondsLeft: secondsLeftInPeriod,
    });
  };

  const rows: Array<SloMonthlyReportRow> = judgeMonths(data.figures).map(
    (judged: SloJudgedFigures, index: number): SloMonthlyReportRow => {
      const month: SloReportMonth = data.months[index]!;

      return {
        monthStart: month.startDate,
        monthEnd: month.endDate,
        isMonthToDate: month.isMonthToDate,
        ...judged,
      };
    },
  );

  const monitors: Array<SloMonthlyReportMonitor> = (data.monitors || []).map(
    (monitor: {
      monitorId: ObjectID | string;
      name: string;
      months: Array<SloMonthlyFigures>;
    }): SloMonthlyReportMonitor => {
      return {
        monitorId: monitor.monitorId.toString(),
        name: monitor.name,
        months: judgeMonths(monitor.months),
        total: judgeTotal(monitor.months),
      };
    },
  );

  monitors.sort(
    (a: SloMonthlyReportMonitor, b: SloMonthlyReportMonitor): number => {
      const aSli: number = a.total.sliPercentage ?? Infinity;
      const bSli: number = b.total.sliPercentage ?? Infinity;

      if (aSli !== bSli) {
        return aSli < bSli ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    },
  );

  return {
    sloId: data.sloId.toString(),
    sloName: data.sloName || "",
    sliType: data.sliType,
    unit: unit,
    targetPercentage: data.targetPercentage,
    timezone: data.timezone,
    period: data.period,
    generatedAt: data.now,
    unavailableReason: null,
    months: rows,
    total: {
      ...judgeTotal(data.figures),
      includesMonthToDate: Boolean(monthToDate),
    },
    monitors: monitors,
  };
};

// A report of an SLO that measures nothing to report on, with why.
export const buildUnavailableSloMonthlyReport: (data: {
  sloId: ObjectID | string;
  sloName?: string | undefined;
  sliType: SliType | null;
  targetPercentage: number | null;
  timezone: string;
  period: SloMonthlyReportPeriod;
  reason: SloMonthlyReportUnavailableReason;
  now: Date;
}) => SloMonthlyReport = (data: {
  sloId: ObjectID | string;
  sloName?: string | undefined;
  sliType: SliType | null;
  targetPercentage: number | null;
  timezone: string;
  period: SloMonthlyReportPeriod;
  reason: SloMonthlyReportUnavailableReason;
  now: Date;
}): SloMonthlyReport => {
  return {
    sloId: data.sloId.toString(),
    sloName: data.sloName || "",
    sliType: data.sliType,
    unit: getSloMonthlyReportUnit(data.sliType),
    targetPercentage: isValidSloTargetPercentage(data.targetPercentage)
      ? data.targetPercentage
      : null,
    timezone: data.timezone,
    period: data.period,
    generatedAt: data.now,
    unavailableReason: data.reason,
    months: [],
    total: {
      ...NO_FIGURES,
      errorBudgetUsedPercentage: null,
      verdict: SloMonthVerdict.NoData,
      includesMonthToDate: false,
    },
    monitors: [],
  };
};

// ---- Reading a report --------------------------------------------------------

export interface SloMonthlyReportSummary {
  // Months that are over and were measured.
  completeMonthCount: number;
  // Of those, the ones at or above the target.
  metMonthCount: number;
  // The measured month with the lowest SLI (the earliest of equals), or null.
  worstMonth: SloMonthlyReportRow | null;
  /*
   * How many months at the start of the period hold no data: the time
   * before the SLO's monitors had any (or its requests were counted).
   */
  leadingMonthsWithoutData: number;
}

export const getSloMonthlyReportSummary: (
  report: SloMonthlyReport,
) => SloMonthlyReportSummary = (
  report: SloMonthlyReport,
): SloMonthlyReportSummary => {
  let completeMonthCount: number = 0;
  let metMonthCount: number = 0;
  let worstMonth: SloMonthlyReportRow | null = null;

  for (const row of report.months) {
    if (row.sliPercentage === null) {
      continue;
    }

    if (!row.isMonthToDate) {
      completeMonthCount++;

      if (row.verdict === SloMonthVerdict.Met) {
        metMonthCount++;
      }
    }

    if (
      worstMonth === null ||
      row.sliPercentage < (worstMonth.sliPercentage as number)
    ) {
      worstMonth = row;
    }
  }

  let leadingMonthsWithoutData: number = 0;

  for (const row of report.months) {
    if (row.sliPercentage !== null) {
      break;
    }

    leadingMonthsWithoutData++;
  }

  return {
    completeMonthCount: completeMonthCount,
    metMonthCount: metMonthCount,
    worstMonth: worstMonth,
    leadingMonthsWithoutData: leadingMonthsWithoutData,
  };
};

// ---- JSON ------------------------------------------------------------------

type FiguresToJsonFunction = (figures: SloJudgedFigures) => JSONObject;

const figuresToJson: FiguresToJsonFunction = (
  figures: SloJudgedFigures,
): JSONObject => {
  const json: JSONObject = {
    total: figures.total,
    bad: figures.bad,
    verdict: figures.verdict,
  };

  // A JSONObject holds no null: a figure that was not measured is left out.
  if (figures.sliPercentage !== null) {
    json["sliPercentage"] = figures.sliPercentage;
  }

  if (figures.errorBudgetUsedPercentage !== null) {
    json["errorBudgetUsedPercentage"] = figures.errorBudgetUsedPercentage;
  }

  return json;
};

/*
 * The report as the API answers it: dates as ISO strings, every figure
 * unrounded, and an unmeasured figure left out (it reads back as null).
 */
export const sloMonthlyReportToJSON: (
  report: SloMonthlyReport,
) => JSONObject = (report: SloMonthlyReport): JSONObject => {
  const json: JSONObject = {
    sloId: report.sloId,
    sloName: report.sloName,
    unit: report.unit,
    timezone: report.timezone,
    period:
      report.period.kind === SloMonthlyReportPeriodKind.Year
        ? { kind: report.period.kind, year: report.period.year }
        : { kind: report.period.kind, months: report.period.months },
    generatedAt: report.generatedAt.toISOString(),
    months: report.months.map((row: SloMonthlyReportRow): JSONObject => {
      return {
        monthStart: row.monthStart.toISOString(),
        monthEnd: row.monthEnd.toISOString(),
        isMonthToDate: row.isMonthToDate,
        ...figuresToJson(row),
      };
    }),
    total: {
      includesMonthToDate: report.total.includesMonthToDate,
      ...figuresToJson(report.total),
    },
    monitors: report.monitors.map(
      (monitor: SloMonthlyReportMonitor): JSONObject => {
        return {
          monitorId: monitor.monitorId,
          name: monitor.name,
          months: monitor.months.map(figuresToJson),
          total: figuresToJson(monitor.total),
        };
      },
    ),
  };

  if (report.sliType) {
    json["sliType"] = report.sliType;
  }

  if (report.targetPercentage !== null) {
    json["targetPercentage"] = report.targetPercentage;
  }

  if (report.unavailableReason) {
    json["unavailableReason"] = report.unavailableReason;
    json["unavailableMessage"] =
      SLO_MONTHLY_REPORT_UNAVAILABLE_MESSAGES[report.unavailableReason];
  }

  return json;
};

type AsObjectFunction = (value: unknown) => JSONObject | null;

const asObject: AsObjectFunction = (value: unknown): JSONObject | null => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
};

type AsArrayFunction = (value: unknown) => Array<unknown>;

const asArray: AsArrayFunction = (value: unknown): Array<unknown> => {
  return Array.isArray(value) ? value : [];
};

type AsFiniteFunction = (value: unknown) => number | null;

const asFinite: AsFiniteFunction = (value: unknown): number | null => {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) ? parsed : null;
};

type AsDateFunction = (value: unknown) => Date | null;

const asDate: AsDateFunction = (value: unknown): Date | null => {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }

  const date: Date = new Date(value as string);

  return Number.isFinite(date.getTime()) ? date : null;
};

type AsEnumFunction = <T extends string>(
  value: unknown,
  values: Record<string, T>,
) => T | null;

const asEnum: AsEnumFunction = <T extends string>(
  value: unknown,
  values: Record<string, T>,
): T | null => {
  return Object.values(values).includes(value as T) ? (value as T) : null;
};

type ParseFiguresFunction = (value: unknown) => SloJudgedFigures;

const parseFigures: ParseFiguresFunction = (
  value: unknown,
): SloJudgedFigures => {
  const json: JSONObject = asObject(value) || {};
  const sliPercentage: number | null = asFinite(json["sliPercentage"]);

  return {
    total: Math.max(0, asFinite(json["total"]) ?? 0),
    bad: Math.max(0, asFinite(json["bad"]) ?? 0),
    sliPercentage: sliPercentage,
    errorBudgetUsedPercentage: asFinite(json["errorBudgetUsedPercentage"]),
    // A verdict the page cannot read is not guessed at.
    verdict: asEnum(json["verdict"], SloMonthVerdict) || SloMonthVerdict.NoData,
  };
};

/*
 * A report read back from the API's answer, or null when the answer is not
 * one. Lenient with each figure - a month the page cannot read is a month
 * without data - so one bad value never hides the rest of the report.
 */
export const parseSloMonthlyReport: (
  value: JSONValue | unknown,
) => SloMonthlyReport | null = (
  value: JSONValue | unknown,
): SloMonthlyReport | null => {
  const json: JSONObject | null = asObject(value);

  if (!json || typeof json["sloId"] !== "string") {
    return null;
  }

  const periodJson: JSONObject = asObject(json["period"]) || {};
  const year: number | null = asFinite(periodJson["year"]);
  const months: number | null = asFinite(periodJson["months"]);

  const period: SloMonthlyReportPeriod =
    periodJson["kind"] === SloMonthlyReportPeriodKind.Year && year !== null
      ? { kind: SloMonthlyReportPeriodKind.Year, year: year }
      : {
          kind: SloMonthlyReportPeriodKind.LastMonths,
          months: months ?? SLO_MONTHLY_REPORT_DEFAULT_MONTHS,
        };

  const rows: Array<SloMonthlyReportRow> = [];

  for (const item of asArray(json["months"])) {
    const row: JSONObject | null = asObject(item);
    const monthStart: Date | null = asDate(row?.["monthStart"]);
    const monthEnd: Date | null = asDate(row?.["monthEnd"]);

    if (!row || !monthStart || !monthEnd) {
      continue;
    }

    rows.push({
      monthStart: monthStart,
      monthEnd: monthEnd,
      isMonthToDate: row["isMonthToDate"] === true,
      ...parseFigures(row),
    });
  }

  const totalJson: JSONObject = asObject(json["total"]) || {};

  const monitors: Array<SloMonthlyReportMonitor> = [];

  for (const item of asArray(json["monitors"])) {
    const monitor: JSONObject | null = asObject(item);

    if (!monitor || typeof monitor["monitorId"] !== "string") {
      continue;
    }

    const monitorMonths: Array<SloJudgedFigures> = asArray(
      monitor["months"],
    ).map(parseFigures);

    monitors.push({
      monitorId: monitor["monitorId"],
      name: typeof monitor["name"] === "string" ? monitor["name"] : "",
      // Exactly one per month of the report, whatever the answer held.
      months: rows.map((_row: SloMonthlyReportRow, index: number) => {
        return monitorMonths[index] || parseFigures(null);
      }),
      total: parseFigures(monitor["total"]),
    });
  }

  return {
    sloId: json["sloId"],
    sloName: typeof json["sloName"] === "string" ? json["sloName"] : "",
    sliType: asEnum(json["sliType"], SliType),
    unit:
      asEnum(json["unit"], SloMonthlyReportUnit) ||
      SloMonthlyReportUnit.Seconds,
    targetPercentage: asFinite(json["targetPercentage"]),
    timezone:
      typeof json["timezone"] === "string" && json["timezone"]
        ? json["timezone"]
        : SLO_MONTHLY_REPORT_DEFAULT_TIMEZONE,
    period: period,
    generatedAt: asDate(json["generatedAt"]) || new Date(),
    unavailableReason: asEnum(
      json["unavailableReason"],
      SloMonthlyReportUnavailableReason,
    ),
    months: rows,
    total: {
      includesMonthToDate: totalJson["includesMonthToDate"] === true,
      ...parseFigures(totalJson),
    },
    monitors: monitors,
  };
};

// ---- CSV ---------------------------------------------------------------------

// A field holding one of these is quoted (RFC 4180).
const CSV_QUOTED_FIELD_PATTERN: RegExp = /[",\r\n]/;

/*
 * A CSV field: quoted when it holds a comma, a quote or a line break (RFC
 * 4180), and a field a spreadsheet would run as a formula - a monitor named
 * "=HYPERLINK(...)" - is kept as text. The same rules as the tables' Export
 * CSV (Common/UI/Utils/TableColumnsToCsv), here so the server could write
 * the file too.
 */
export const toSloCsvField: (value: string) => string = (
  value: string,
): string => {
  let text: string = value;
  const first: string = text.charAt(0);

  if (
    first === "=" ||
    first === "+" ||
    first === "@" ||
    first === "\t" ||
    first === "\r"
  ) {
    text = `'${text}`;
  }

  if (CSV_QUOTED_FIELD_PATTERN.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

const VERDICT_CSV_WORDS: Record<SloMonthVerdict, string> = {
  [SloMonthVerdict.Met]: "Met",
  [SloMonthVerdict.Missed]: "Missed",
  [SloMonthVerdict.OnTrack]: "On track",
  [SloMonthVerdict.BelowTarget]: "Below target",
  [SloMonthVerdict.NoData]: "No data",
};

type FixedFunction = (value: number | null, decimals: number) => string;

// A figure as a spreadsheet reads it: a dot for decimals, nothing when unmeasured.
const fixed: FixedFunction = (
  value: number | null,
  decimals: number,
): string => {
  if (value === null || !Number.isFinite(value)) {
    return "";
  }

  return value.toFixed(decimals);
};

/*
 * The report as a CSV file, one row per month and the total last. Written
 * for a spreadsheet, not a page: English headers, months as YYYY-MM in the
 * report's timezone, figures with a dot and no unit, so a sum or a chart can
 * be made of them in any language. A Monitor Uptime SLO with several
 * monitors adds each monitor's SLI as a column.
 */
export const buildSloMonthlyReportCsv: (report: SloMonthlyReport) => string = (
  report: SloMonthlyReport,
): string => {
  const countedHeaders: Record<SloMonthlyReportUnit, [string, string]> = {
    [SloMonthlyReportUnit.Seconds]: [
      "Measured (seconds)",
      "Downtime (seconds)",
    ],
    [SloMonthlyReportUnit.Requests]: ["Requests", "Bad requests"],
    [SloMonthlyReportUnit.Events]: ["Events", "Bad events"],
  };

  const headers: Array<string> = [
    "Month",
    "Month to date",
    "SLI (%)",
    "Target (%)",
    ...countedHeaders[report.unit],
    "Error budget used (%)",
    "Result",
  ];

  const monitorColumns: Array<SloMonthlyReportMonitor> =
    report.monitors.length > 1 ? report.monitors : [];

  for (const monitor of monitorColumns) {
    headers.push(`${monitor.name || monitor.monitorId} SLI (%)`);
  }

  const target: string = fixed(report.targetPercentage, 4);

  const figureCells: (figures: SloJudgedFigures) => Array<string> = (
    figures: SloJudgedFigures,
  ): Array<string> => {
    return [
      fixed(figures.sliPercentage, 4),
      target,
      fixed(figures.total, 0),
      fixed(figures.bad, 0),
      fixed(figures.errorBudgetUsedPercentage, 2),
      VERDICT_CSV_WORDS[figures.verdict],
    ];
  };

  const lines: Array<Array<string>> = [headers];

  report.months.forEach((row: SloMonthlyReportRow, index: number): void => {
    lines.push([
      Moment.tz(row.monthStart, report.timezone).format("YYYY-MM"),
      row.isMonthToDate ? "Yes" : "No",
      ...figureCells(row),
      ...monitorColumns.map((monitor: SloMonthlyReportMonitor): string => {
        return fixed(monitor.months[index]?.sliPercentage ?? null, 4);
      }),
    ]);
  });

  lines.push([
    "Total",
    report.total.includesMonthToDate ? "Yes" : "No",
    ...figureCells(report.total),
    ...monitorColumns.map((monitor: SloMonthlyReportMonitor): string => {
      return fixed(monitor.total.sliPercentage, 4);
    }),
  ]);

  return lines
    .map((line: Array<string>): string => {
      return line.map(toSloCsvField).join(",");
    })
    .join("\r\n");
};

/*
 * The file's name: the SLO's name made safe for a file, and the period -
 * "checkout-api-monthly-report-2025.csv", "checkout-api-monthly-report-last-6-months.csv".
 */
export const getSloMonthlyReportFilename: (data: {
  sloName: string | undefined | null;
  period: SloMonthlyReportPeriod;
}) => string = (data: {
  sloName: string | undefined | null;
  period: SloMonthlyReportPeriod;
}): string => {
  const slug: string =
    (data.sloName || "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .substring(0, 60) || "slo";

  const period: string =
    data.period.kind === SloMonthlyReportPeriodKind.Year
      ? data.period.year.toString()
      : `last-${data.period.months}-months`;

  return `${slug}-monthly-report-${period}.csv`;
};
