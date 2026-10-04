import OneUptimeDate from "../../Types/Date";
import EventInterval from "../../Types/Events/EventInterval";
import Recurring from "../../Types/Events/Recurring";
import { JSONObject } from "../../Types/JSON";
import PositiveNumber from "../../Types/PositiveNumber";
import StatusPageReportPeriodType from "../../Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "../../Types/Timezone";
import StatusPageReportPeriodUtil from "./ReportPeriod";
import moment from "moment-timezone";

/*
 * When a status page's email reports go out.
 *
 * A schedule is two columns: the date the first report goes out
 * (reportStartDateTime) and how often a report follows it
 * (reportRecurringInterval), both read in the report's timezone. Neither has
 * a column default, so switching reports on used to mean making a schedule
 * up first, and the settings dialog asked for both even to switch reports
 * off. Now a page whose reports are switched on without a schedule gets one:
 *
 *   - every month,
 *   - the first report on the next 1st of the month at 09:00 in the report's
 *     timezone,
 *   - each report covering the whole calendar month before it (a monthly
 *     report on the 1st that covered "the last 30 days" would read 2 Oct -
 *     1 Nov rather than October).
 *
 * A schedule a page already has, or one the caller sends, is never replaced:
 * only what is missing is filled in, and only while reports are being
 * switched on or rescheduled - never by an unrelated write, never by the
 * report worker, and never while reports are off. Switching reports off
 * needs nothing else.
 *
 * Pure and synchronous, and in Common/Utils rather than Common/Server, so the
 * service that stores a schedule and the settings screen that shows it work
 * the next report out the same way.
 */

// A status page's report columns, as a write carries them or a page holds them.
export interface StatusPageReportScheduleColumns {
  isReportEnabled?: boolean | null | undefined;
  reportStartDateTime?: Date | string | null | undefined;
  reportRecurringInterval?: Recurring | JSONObject | null | undefined;
  reportTimezone?: Timezone | string | null | undefined;
  reportPeriodType?: StatusPageReportPeriodType | string | null | undefined;
  sendNextReportBy?: Date | string | null | undefined;
}

// What a write to a status page's report columns has to carry as well.
export interface StatusPageReportScheduleWrite {
  reportStartDateTime?: Date | undefined;
  reportRecurringInterval?: Recurring | undefined;
  reportPeriodType?: StatusPageReportPeriodType | undefined;
  sendNextReportBy?: Date | undefined;
}

export interface StatusPageReportNextSend {
  // When the next report goes out, or undefined while there is no schedule.
  sendAt: Date | undefined;
  // The timezone its time and the period it covers are read in.
  timezone: Timezone;
}

export default class StatusPageReportScheduleUtil {
  // The default first report goes out at 09:00, in the report's timezone.
  public static readonly DEFAULT_SEND_HOUR: number = 9;
  // On the 1st of the month.
  public static readonly DEFAULT_SEND_DAY_OF_MONTH: number = 1;
  // Every month.
  public static readonly DEFAULT_INTERVAL_TYPE: EventInterval =
    EventInterval.Month;
  public static readonly DEFAULT_INTERVAL_COUNT: number = 1;
  // Each one covering the whole calendar month before it.
  public static readonly DEFAULT_PERIOD_TYPE: StatusPageReportPeriodType =
    StatusPageReportPeriodType.PreviousCalendarPeriod;

  public static getDefaultRecurringInterval(): Recurring {
    const recurring: Recurring = new Recurring();
    recurring.intervalType = this.DEFAULT_INTERVAL_TYPE;
    recurring.intervalCount = new PositiveNumber(this.DEFAULT_INTERVAL_COUNT);
    return recurring;
  }

  /*
   * The timezone a schedule is read in: the page's, when it names one moment
   * knows, else the column's default (UTC).
   */
  public static getTimezone(value: unknown): Timezone {
    if (typeof value === "string" && value && moment.tz.zone(value)) {
      return value as Timezone;
    }

    return StatusPageReportPeriodUtil.DEFAULT_TIMEZONE;
  }

  /*
   * The default first report: the next 1st of the month at 09:00 in the
   * timezone, strictly after `after` (now, unless given). Built from the
   * wall clock, so it is 09:00 there whatever the server's clock or daylight
   * saving says: on 1 Nov 2026 New York is back on standard time and the
   * report still goes out at 09:00 EST.
   */
  public static getDefaultFirstReportDate(data?: {
    timezone?: unknown;
    after?: Date | undefined;
  }): Date {
    const timezone: Timezone = this.getTimezone(data?.timezone);
    const after: Date = data?.after || OneUptimeDate.getCurrentDate();

    const atNine: (month: moment.Moment) => moment.Moment = (
      month: moment.Moment,
    ): moment.Moment => {
      return month
        .clone()
        .date(this.DEFAULT_SEND_DAY_OF_MONTH)
        .hour(this.DEFAULT_SEND_HOUR)
        .minute(0)
        .second(0)
        .millisecond(0);
    };

    const thisMonth: moment.Moment = moment.tz(after, timezone).startOf("month");

    let candidate: moment.Moment = atNine(thisMonth);

    if (candidate.valueOf() <= after.getTime()) {
      // Past this month's: next month's, built again from its own 1st.
      candidate = atNine(thisMonth.clone().add(1, "month"));
    }

    return candidate.toDate();
  }

  // A date column's value, or undefined when it holds nothing usable.
  public static toDate(value: unknown): Date | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    // Not a date at all: no need to have moment guess at it (and warn).
    if (typeof value === "string" && Number.isNaN(Date.parse(value))) {
      return undefined;
    }

    try {
      const date: Date = OneUptimeDate.fromString(value as string | Date);
      return Number.isNaN(date.getTime()) ? undefined : date;
    } catch {
      return undefined;
    }
  }

  // A recurring interval column's value, or undefined when it holds nothing usable.
  public static toRecurring(value: unknown): Recurring | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    try {
      return Recurring.fromJSON(value as JSONObject | Recurring);
    } catch {
      return undefined;
    }
  }

  /*
   * When the next report goes out after `after` (now, unless given): the
   * first occurrence of the schedule strictly after it, stepping in whole
   * calendar units in the report's timezone (Recurring.getNextDateAfter), so
   * a monthly schedule on the 1st stays on the 1st. Undefined while either
   * half of the schedule is missing.
   */
  public static getNextReportDate(data: {
    reportStartDateTime?: unknown;
    reportRecurringInterval?: unknown;
    reportTimezone?: unknown;
    after?: Date | undefined;
  }): Date | undefined {
    const startDate: Date | undefined = this.toDate(data.reportStartDateTime);
    const recurring: Recurring | undefined = this.toRecurring(
      data.reportRecurringInterval,
    );

    if (!startDate || !recurring) {
      return undefined;
    }

    return Recurring.getNextDateAfter({
      startDate: startDate,
      recurring: recurring,
      afterDate: data.after || OneUptimeDate.getCurrentDate(),
      timezone: this.getTimezone(data.reportTimezone),
    });
  }

  /*
   * When the report off a saved page goes out next, for the settings screen:
   * the time the server worked out, while it is still ahead, else the
   * schedule's next occurrence - which is what the server works out when the
   * schedule is saved, so the two never disagree.
   */
  public static getNextSend(
    page: StatusPageReportScheduleColumns,
    now?: Date | undefined,
  ): StatusPageReportNextSend {
    const timezone: Timezone = this.getTimezone(page.reportTimezone);
    const after: Date = now || OneUptimeDate.getCurrentDate();
    const stored: Date | undefined = this.toDate(page.sendNextReportBy);

    if (stored && stored.getTime() > after.getTime()) {
      return { sendAt: stored, timezone: timezone };
    }

    return {
      sendAt: this.getNextReportDate({
        reportStartDateTime: page.reportStartDateTime,
        reportRecurringInterval: page.reportRecurringInterval,
        reportTimezone: page.reportTimezone,
        after: after,
      }),
      timezone: timezone,
    };
  }

  /*
   * Whether a write touches what reports are sent on: the switch, the
   * schedule, or the next send. Any other write needs no report column.
   */
  public static isReportWrite(write: StatusPageReportScheduleColumns): boolean {
    return (
      write.isReportEnabled !== undefined ||
      write.reportStartDateTime !== undefined ||
      write.reportRecurringInterval !== undefined ||
      write.reportTimezone !== undefined ||
      write.sendNextReportBy !== undefined
    );
  }

  // Whether a page holds a whole schedule: a first report date and how often.
  public static hasSchedule(page: StatusPageReportScheduleColumns): boolean {
    return Boolean(
      this.toDate(page.reportStartDateTime) &&
        this.toRecurring(page.reportRecurringInterval),
    );
  }

  /*
   * The report columns a write to a status page has to carry as well, for
   * one page: `write` is what the caller sends (a create's data, or an
   * update's), `stored` what the page holds now (nothing, on a create).
   *
   * - Reports switched on - or rescheduled while on - without a whole
   *   schedule get the default parts that are missing: every month, the next
   *   1st at 09:00 in the report's timezone. When the page had no schedule
   *   at all and the caller names no reporting period, each report covers
   *   the calendar month before it too. A schedule the page holds, or the
   *   caller sends, is kept as it is.
   * - The next send (sendNextReportBy) is worked out again from the schedule
   *   whenever the schedule changes, reports are switched on (a page switched
   *   back on after a month off must not send at once for the month it
   *   missed), or the report worker moves it on.
   * - Nothing else: switching reports off, or switching on a page that is
   *   already on, adds no column.
   *
   * A value the caller sends as null counts as sent: it clears the column.
   */
  public static getScheduleWrite(data: {
    write: StatusPageReportScheduleColumns;
    stored?: StatusPageReportScheduleColumns | undefined;
    now?: Date | undefined;
  }): StatusPageReportScheduleWrite {
    const write: StatusPageReportScheduleColumns = data.write;
    const stored: StatusPageReportScheduleColumns = data.stored || {};
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    if (!this.isReportWrite(write)) {
      return {};
    }

    const writes: (column: keyof StatusPageReportScheduleColumns) => boolean = (
      column: keyof StatusPageReportScheduleColumns,
    ): boolean => {
      return write[column] !== undefined;
    };

    const writesSchedule: boolean =
      writes("reportStartDateTime") ||
      writes("reportRecurringInterval") ||
      writes("reportTimezone");
    const writesSwitch: boolean = writes("isReportEnabled");
    const writesNextSend: boolean = writes("sendNextReportBy");

    const isEnabled: boolean = writesSwitch
      ? write.isReportEnabled === true
      : stored.isReportEnabled === true;

    const isTurningOn: boolean =
      write.isReportEnabled === true && stored.isReportEnabled !== true;

    const timezone: unknown = writes("reportTimezone")
      ? write.reportTimezone
      : stored.reportTimezone;

    let startDate: Date | undefined = this.toDate(
      writes("reportStartDateTime")
        ? write.reportStartDateTime
        : stored.reportStartDateTime,
    );

    let recurring: Recurring | undefined = this.toRecurring(
      writes("reportRecurringInterval")
        ? write.reportRecurringInterval
        : stored.reportRecurringInterval,
    );

    const result: StatusPageReportScheduleWrite = {};

    if (isEnabled && (writesSchedule || writesSwitch)) {
      if (!startDate && !recurring && !writes("reportPeriodType")) {
        result.reportPeriodType = this.DEFAULT_PERIOD_TYPE;
      }

      if (!recurring) {
        recurring = this.getDefaultRecurringInterval();
        result.reportRecurringInterval = recurring;
      }

      if (!startDate) {
        startDate = this.getDefaultFirstReportDate({
          timezone: timezone,
          after: now,
        });
        result.reportStartDateTime = startDate;
      }
    }

    const isRescheduled: boolean =
      writesSchedule ||
      result.reportStartDateTime !== undefined ||
      result.reportRecurringInterval !== undefined;

    if (
      startDate &&
      recurring &&
      (isRescheduled || isTurningOn || writesNextSend)
    ) {
      result.sendNextReportBy = Recurring.getNextDateAfter({
        startDate: startDate,
        recurring: recurring,
        afterDate: now,
        timezone: this.getTimezone(timezone),
      });
    }

    return result;
  }
}
