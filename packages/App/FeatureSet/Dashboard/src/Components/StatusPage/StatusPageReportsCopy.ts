import OneUptimeDate from "Common/Types/Date";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import StatusPageReportPeriodType from "Common/Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "Common/Types/Timezone";
import StatusPageReportPeriodUtil, {
  StatusPageReportPeriod,
} from "Common/Utils/StatusPage/ReportPeriod";
import StatusPageReportScheduleUtil, {
  StatusPageReportScheduleColumns,
  StatusPageReportScheduleWrite,
} from "Common/Utils/StatusPage/ReportSchedule";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * A status page's email reports, on Advanced -> Reports.
 *
 * It used to be one "Email Reports" card with an Edit dialog of three steps:
 * Reports (the switch and the timezone), Schedule (the first report's date
 * and how often) and Reporting Period. Neither half of the schedule had a
 * default and both were required, so switching reports on meant making a
 * schedule up - and so did switching them off.
 *
 * Now the card is a switch, "Send email reports", that saves the moment it
 * is flipped. Switched on for the first time, the server gives the page the
 * default schedule (Common/Utils/StatusPage/ReportSchedule): every month,
 * on the 1st at 09:00 in the report timezone, each report covering the
 * calendar month before it. While reports are on, the card says in plain
 * words when the next one goes out, what it covers, how often and in which
 * timezone, and "Edit Schedule" opens one short page to change that, with
 * the timezone and the reporting period folded under More fields. While
 * they are off there is nothing more to see, and nothing to fill in.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

// The status page column the switch writes.
export type ReportSwitchColumn = "isReportEnabled";

export const REPORT_SWITCH_COLUMN: ReportSwitchColumn = "isReportEnabled";

// The columns the card reads, and the schedule dialog writes.
export const REPORT_SCHEDULE_COLUMNS: ReadonlyArray<string> = [
  "reportRecurringInterval",
  "reportStartDateTime",
  "reportTimezone",
  "reportPeriodType",
  "reportDataInDays",
];

export const StatusPageReportsCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  // Under the switch while reports are sent.
  switchOnDescription: string;
  // Under it while they are not, for a page that never had a schedule.
  switchOffDescription: string;
  // Under it while they are not, for a page that keeps one from before.
  switchOffWithScheduleDescription: string;
  editScheduleButton: string;
  editScheduleTitle: string;
  editScheduleDescription: string;
  // The read-only lines under the switch.
  nextReportTitle: string;
  howOftenTitle: string;
  coversTitle: string;
  timezoneTitle: string;
  notScheduled: string;
  covering: string;
  previousCalendarPeriod: string;
  // The preview under the first report's date.
  previewNextReport: string;
  previewNoSchedule: string;
  previewTimezone: string;
} = {
  cardTitle: translationKey("Email Reports"),
  cardDescription: translationKey(
    "A regular email to this page's email subscribers with each resource's uptime, downtime and incidents.",
  ),
  switchTitle: translationKey("Send email reports"),
  switchOnDescription: translationKey(
    "Email subscribers get a report on the schedule below.",
  ),
  switchOffDescription: translationKey(
    "Turn this on to email subscribers a report on the 1st of every month at 09:00, covering the month before. You can change the schedule once it is on.",
  ),
  switchOffWithScheduleDescription: translationKey(
    "Turn this on to email subscribers a report again, on the same schedule as before.",
  ),
  editScheduleButton: translationKey("Edit Schedule"),
  editScheduleTitle: translationKey("Report Schedule"),
  editScheduleDescription: translationKey(
    "When reports go out, and the stretch of time each one covers.",
  ),
  nextReportTitle: translationKey("Next report"),
  howOftenTitle: translationKey("How often"),
  coversTitle: translationKey("Each report covers"),
  timezoneTitle: translationKey("Time zone"),
  notScheduled: translationKey(
    "Not scheduled yet. Edit the schedule to set when reports go out.",
  ),
  covering: translationKey("Covering {{dates}}"),
  previousCalendarPeriod: translationKey("The previous whole calendar period"),
  previewNextReport: translationKey("Next report: {{date}}"),
  previewNoSchedule: translationKey("Set a first report date to schedule one."),
  previewTimezone: translationKey(
    "Times and period boundaries are resolved in {{timezone}}.",
  ),
};

// "A rolling 30 days": what a rolling report covers.
export const ROLLING_DAYS_TEMPLATE: PluralTemplate = {
  one: "A rolling {{count}} day",
  other: "A rolling {{count}} days",
};

/*
 * How often a report goes out, in words: "Every month" for one of a unit,
 * "Every 2 weeks" for more. The single unit is a sentence of its own rather
 * than the plural template's "one" form, which some languages use for 21 or
 * 31 too, where "Every month" would be wrong.
 */
export const REPORT_FREQUENCY_COPY: Record<
  EventInterval,
  { single: string; several: PluralTemplate }
> = {
  [EventInterval.Hour]: {
    single: translationKey("Every hour"),
    several: { one: "Every {{count}} hour", other: "Every {{count}} hours" },
  },
  [EventInterval.Day]: {
    single: translationKey("Every day"),
    several: { one: "Every {{count}} day", other: "Every {{count}} days" },
  },
  [EventInterval.Week]: {
    single: translationKey("Every week"),
    several: { one: "Every {{count}} week", other: "Every {{count}} weeks" },
  },
  [EventInterval.Month]: {
    single: translationKey("Every month"),
    several: { one: "Every {{count}} month", other: "Every {{count}} months" },
  },
  [EventInterval.Year]: {
    single: translationKey("Every year"),
    several: { one: "Every {{count}} year", other: "Every {{count}} years" },
  },
};

// The test ids the card's parts are found by.
export const STATUS_PAGE_REPORTS_CARD_TEST_ID: string = "status-page-reports";
export const STATUS_PAGE_REPORTS_SWITCH_TEST_ID: string =
  "status-page-reports-switch";
export const STATUS_PAGE_REPORT_SCHEDULE_TEST_ID: string =
  "status-page-report-schedule";
export const STATUS_PAGE_REPORT_SCHEDULE_DETAILS_ID: string =
  "status-page-report-schedule-details";
export const REPORT_SCHEDULE_PREVIEW_TEST_ID: string =
  "report-schedule-preview";
export const REPORT_SCHEDULE_FORM_ID: string = "status-page-report-schedule";
export const REPORT_SCHEDULE_FORM_NAME: string =
  "Status Page > Report Schedule";

/*
 * Everything the card and the dialog's preview say about a schedule, from
 * a saved page or the dialog's half-filled values.
 */
export interface ReportScheduleFacts {
  // When the next report goes out; undefined while there is no schedule.
  nextSendAt: Date | undefined;
  // The timezone that time and the period are read in.
  timezone: Timezone;
  // How often one goes out; undefined while it is not set.
  recurring: Recurring | undefined;
  periodType: StatusPageReportPeriodType;
  // The days a rolling report covers.
  rollingDays: number;
  // What the next report covers; undefined while there is no next report.
  period: StatusPageReportPeriod | undefined;
}

// The report columns a page, or a form, holds.
export type ReportScheduleColumns = StatusPageReportScheduleColumns & {
  reportDataInDays?: number | string | null | undefined;
};

const toPeriodType: (value: unknown) => StatusPageReportPeriodType = (
  value: unknown,
): StatusPageReportPeriodType => {
  return value === StatusPageReportPeriodType.PreviousCalendarPeriod
    ? StatusPageReportPeriodType.PreviousCalendarPeriod
    : StatusPageReportPeriodType.Rolling;
};

const toRollingDays: (value: unknown) => number = (value: unknown): number => {
  const days: number = Number(value);

  return Number.isFinite(days) && days >= 1
    ? Math.floor(days)
    : StatusPageReportPeriodUtil.DEFAULT_REPORT_DATA_IN_DAYS;
};

/*
 * When the next report goes out and what it covers. With `isDraft`, from a
 * form being filled in: there is no send time the server worked out yet,
 * so it is worked out from the schedule the way the server will on save.
 */
export const getReportScheduleFacts: (data: {
  columns: ReportScheduleColumns;
  isDraft?: boolean | undefined;
  now?: Date | undefined;
}) => ReportScheduleFacts = (data: {
  columns: ReportScheduleColumns;
  isDraft?: boolean | undefined;
  now?: Date | undefined;
}): ReportScheduleFacts => {
  const columns: ReportScheduleColumns = data.columns;
  const now: Date = data.now || OneUptimeDate.getCurrentDate();
  const timezone: Timezone = StatusPageReportScheduleUtil.getTimezone(
    columns.reportTimezone,
  );
  const recurring: Recurring | undefined =
    StatusPageReportScheduleUtil.toRecurring(columns.reportRecurringInterval);
  const periodType: StatusPageReportPeriodType = toPeriodType(
    columns.reportPeriodType,
  );
  const rollingDays: number = toRollingDays(columns.reportDataInDays);

  const nextSendAt: Date | undefined = data.isDraft
    ? StatusPageReportScheduleUtil.getNextReportDate({
        reportStartDateTime: columns.reportStartDateTime,
        reportRecurringInterval: columns.reportRecurringInterval,
        reportTimezone: columns.reportTimezone,
        after: now,
      })
    : StatusPageReportScheduleUtil.getNextSend(columns, now).sendAt;

  return {
    nextSendAt: nextSendAt,
    timezone: timezone,
    recurring: recurring,
    periodType: periodType,
    rollingDays: rollingDays,
    period: nextSendAt
      ? StatusPageReportPeriodUtil.getReportPeriod({
          periodType: periodType,
          reportRecurringInterval: recurring,
          reportDataInDays: rollingDays,
          timezone: timezone,
          // A calendar report's window depends on when it is sent.
          sentAt: nextSendAt,
        })
      : undefined,
  };
};

/*
 * The dates a period runs over, as the card shows them: "Oct 1, 2026 -
 * Oct 31, 2026", in the report's timezone.
 */
export const getReportPeriodDates: (period: StatusPageReportPeriod) => string = (
  period: StatusPageReportPeriod,
): string => {
  const day: (date: Date) => string = (date: Date): string => {
    return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date: date,
      format: "MMM D, YYYY",
      timezone: period.timezone,
    });
  };

  return `${day(period.startDate)} - ${day(period.endDate)}`;
};

/*
 * What a page shows while its switch is on. The switch moves before the
 * server has answered, and the server gives a page switched on without a
 * schedule the default one: until the page is read again it is shown with
 * the very columns the server is adding (the same rules), so the card
 * never says "Not scheduled" for the moment in between.
 */
export const getShownReportColumns: (data: {
  page: ReportScheduleColumns;
  isOn: boolean;
  now?: Date | undefined;
}) => ReportScheduleColumns = (data: {
  page: ReportScheduleColumns;
  isOn: boolean;
  now?: Date | undefined;
}): ReportScheduleColumns => {
  if (!data.isOn || data.page.isReportEnabled === true) {
    return data.page;
  }

  const write: StatusPageReportScheduleWrite =
    StatusPageReportScheduleUtil.getScheduleWrite({
      write: { isReportEnabled: true },
      stored: data.page,
      now: data.now,
    });

  return {
    ...data.page,
    isReportEnabled: true,
    ...Object.fromEntries(
      Object.entries(write).filter(([, value]: [string, unknown]): boolean => {
        return value !== undefined;
      }),
    ),
  };
};

/*
 * What the schedule dialog starts with for a page whose reports are on but
 * that holds no whole schedule - one switched on through the API before
 * the server filled one in: the default parts it is missing. Nothing for a
 * page that has a schedule.
 */
export const getReportScheduleDraft: (
  page: ReportScheduleColumns,
  now?: Date | undefined,
) => StatusPageReportScheduleWrite = (
  page: ReportScheduleColumns,
  now?: Date | undefined,
): StatusPageReportScheduleWrite => {
  const write: StatusPageReportScheduleWrite =
    StatusPageReportScheduleUtil.getScheduleWrite({
      write: { isReportEnabled: true },
      stored: { ...page, isReportEnabled: true },
      now: now,
    });

  const draft: StatusPageReportScheduleWrite = {};

  if (write.reportStartDateTime) {
    draft.reportStartDateTime = write.reportStartDateTime;
  }

  if (write.reportRecurringInterval) {
    draft.reportRecurringInterval = write.reportRecurringInterval;
  }

  if (write.reportPeriodType) {
    draft.reportPeriodType = write.reportPeriodType;
  }

  return draft;
};

// The period choices of the schedule dialog, in English.
export const REPORT_PERIOD_TYPE_OPTIONS: ReadonlyArray<{
  value: StatusPageReportPeriodType;
  label: string;
}> = [
  {
    value: StatusPageReportPeriodType.PreviousCalendarPeriod,
    label: translationKey("The previous whole calendar period"),
  },
  {
    value: StatusPageReportPeriodType.Rolling,
    label: translationKey("A rolling number of days"),
  },
];
