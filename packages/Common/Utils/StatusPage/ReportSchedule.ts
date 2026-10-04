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
 * needs nothing else. A caller that sends how often but not when gets its
 * first report at the start of the next period of that interval instead:
 * tomorrow at 09:00 for a daily schedule, not the 1st of next month.
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
   * The default first report: 09:00 in the timezone at the start of the next
   * period of the schedule's interval, strictly after `after` (now, unless
   * given). For a monthly schedule - the default - that is the next 1st of
   * the month; for a weekly one the next Monday, for a daily one the next
   * day, for a yearly one the next 1 January, so a report on the previous
   * calendar period covers exactly the period before it. An hourly schedule
   * starts at the next full hour.
   *
   * Built from the wall clock, so it is 09:00 there whatever the server's
   * clock or daylight saving says: on 1 Nov 2026 New York is back on
   * standard time and the report still goes out at 09:00 EST.
   */
  public static getDefaultFirstReportDate(data?: {
    timezone?: unknown;
    after?: Date | undefined;
    intervalType?: EventInterval | undefined;
  }): Date {
    const timezone: Timezone = this.getTimezone(data?.timezone);
    const after: Date = data?.after || OneUptimeDate.getCurrentDate();
    const intervalType: EventInterval =
      data?.intervalType || this.DEFAULT_INTERVAL_TYPE;

    const zoned: moment.Moment = moment.tz(after, timezone);

    if (intervalType === EventInterval.Hour) {
      // The next full hour on the clock there, strictly after `after`.
      return zoned.clone().startOf("hour").add(1, "hour").toDate();
    }

    const PERIODS: Record<
      Exclude<EventInterval, EventInterval.Hour>,
      {
        startOf: moment.unitOfTime.StartOf;
        step: moment.unitOfTime.DurationConstructor;
      }
    > = {
      [EventInterval.Day]: { startOf: "day", step: "day" },
      // ISO weeks, as a weekly report's calendar period: Monday to Sunday.
      [EventInterval.Week]: { startOf: "isoWeek", step: "week" },
      [EventInterval.Month]: { startOf: "month", step: "month" },
      [EventInterval.Year]: { startOf: "year", step: "year" },
    };

    const period: {
      startOf: moment.unitOfTime.StartOf;
      step: moment.unitOfTime.DurationConstructor;
    } =
      PERIODS[intervalType as Exclude<EventInterval, EventInterval.Hour>] ||
      PERIODS[EventInterval.Month];

    const atSendHour: (periodStart: moment.Moment) => moment.Moment = (
      periodStart: moment.Moment,
    ): moment.Moment => {
      return periodStart
        .clone()
        .hour(this.DEFAULT_SEND_HOUR)
        .minute(0)
        .second(0)
        .millisecond(0);
    };

    const thisPeriod: moment.Moment = zoned.clone().startOf(period.startOf);

    let candidate: moment.Moment = atSendHour(thisPeriod);

    if (candidate.valueOf() <= after.getTime()) {
      // Past this period's: the next one's, built again from its own start.
      candidate = atSendHour(thisPeriod.clone().add(1, period.step));
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

  /*
   * A recurring interval column's value, or undefined when it holds nothing
   * usable - an interval type the calendar cannot step by included, which
   * would otherwise only fail when the next report is worked out.
   */
  public static toRecurring(value: unknown): Recurring | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    try {
      const recurring: Recurring = Recurring.fromJSON(
        value as JSONObject | Recurring,
      );

      if (
        !Object.values(EventInterval).includes(recurring.intervalType) ||
        !(recurring.intervalCount?.toNumber() >= 1)
      ) {
        return undefined;
      }

      return recurring;
    } catch {
      return undefined;
    }
  }

  /*
   * Why a write's report schedule cannot be stored, or null: a first report
   * date or an interval it carries that cannot be read. Sending null is fine
   * (see getScheduleWrite for what it does while reports are on). The update
   * path used to refuse an interval it could not read only by accident
   * (Recurring.fromJSON threw "Invalid Rotation" while working out the next
   * send); this keeps refusing it, on a create as on an update, whether
   * reports are on or off. A create used to store it, and every later read
   * of the page that selected the column then failed on that same throw.
   */
  public static getWriteProblem(
    write: StatusPageReportScheduleColumns,
  ): string | null {
    if (
      write.reportStartDateTime !== undefined &&
      write.reportStartDateTime !== null &&
      !this.toDate(write.reportStartDateTime)
    ) {
      return "reportStartDateTime is not a date and time. Send it as an ISO 8601 string, such as 2026-11-01T09:00:00.000Z.";
    }

    if (
      write.reportRecurringInterval !== undefined &&
      write.reportRecurringInterval !== null &&
      !this.toRecurring(write.reportRecurringInterval)
    ) {
      return 'reportRecurringInterval is not a recurring interval. Send it as {"_type": "Recurring", "value": {"intervalType": "Month", "intervalCount": 1}}, with an interval type of Hour, Day, Week, Month or Year and a count of 1 or more.';
    }

    return null;
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

    try {
      return Recurring.getNextDateAfter({
        startDate: startDate,
        recurring: recurring,
        afterDate: data.after || OneUptimeDate.getCurrentDate(),
        timezone: this.getTimezone(data.reportTimezone),
      });
    } catch {
      // Nothing to show for a schedule the calendar cannot step through.
      return undefined;
    }
  }

  /*
   * When the report off a saved page goes out next, for the settings screen:
   * the time the server worked out, while it is still ahead, else - once it
   * has passed and the report worker is about to move it on - the
   * schedule's next occurrence, which is what the worker moves it to.
   *
   * Nothing while the server has worked out no time at all: the worker sends
   * only on that time, so a page without one sends nothing, whatever its
   * schedule says. Status pages created through the API with reports on
   * before the server worked the time out on create are like that; saving
   * the schedule, or switching reports off and on, schedules them.
   */
  public static getNextSend(
    page: StatusPageReportScheduleColumns,
    now?: Date | undefined,
  ): StatusPageReportNextSend {
    const timezone: Timezone = this.getTimezone(page.reportTimezone);
    const after: Date = now || OneUptimeDate.getCurrentDate();
    const stored: Date | undefined = this.toDate(page.sendNextReportBy);

    if (!stored) {
      return { sendAt: undefined, timezone: timezone };
    }

    if (stored.getTime() > after.getTime()) {
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
   *   schedule get the default parts that are missing: every month, and the
   *   first report at 09:00 in the report's timezone at the start of the
   *   next period of the interval (the next 1st for a monthly one). When the
   *   page had no schedule at all and the caller names no reporting period,
   *   each report covers the calendar month before it too. A schedule the
   *   page holds, or the caller sends, is kept as it is.
   * - The next send (sendNextReportBy) is worked out again from the schedule
   *   whenever the schedule changes, reports are switched on (a page switched
   *   back on after a month off must not send at once for the month it
   *   missed), or the report worker moves it on.
   * - Nothing else: switching reports off, or switching on a page that is
   *   already on, adds no column.
   *
   * A value the caller sends as null counts as sent: it clears the column -
   * and while reports are on, the default takes its place, since reports
   * that are on always have a whole schedule (one without would never be
   * sent, which is what switching on without a schedule used to do).
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
          intervalType: recurring.intervalType,
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
