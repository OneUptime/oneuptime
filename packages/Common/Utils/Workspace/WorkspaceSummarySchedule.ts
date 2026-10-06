import OneUptimeDate, { CalendarUnit } from "../../Types/Date";
import EventInterval from "../../Types/Events/EventInterval";
import Recurring from "../../Types/Events/Recurring";
import { JSONObject } from "../../Types/JSON";
import PositiveNumber from "../../Types/PositiveNumber";
import Timezone from "../../Types/Timezone";
import TimezoneAlias from "../../Types/TimezoneAlias";
import StatusPageReportScheduleUtil from "../StatusPage/ReportSchedule";
import moment from "moment-timezone";

/*
 * When a workspace summary - the recurring incident, alert and episode
 * summaries posted to Slack or Microsoft Teams - goes out.
 *
 * A summary's schedule is three columns: how often it goes out
 * (recurringInterval), when the first one does (sendFirstReportAt), and the
 * time zone both are read in (timezone). The report worker sends a summary
 * once its next send (nextSendAt) has passed, then moves that on. How often
 * had no default, so a summary could not be saved until one was made up,
 * and a summary created through the API without a next send was never sent
 * at all. Now a summary that is created without them gets:
 *
 *   - every week - the summary's other defaults are a week's: it covers the
 *     last 7 days, and the form suggests a "Weekly ... Summary";
 *   - the time zone of the person creating it: the dashboard sends the one
 *     it shows, the API reads the creator's profile, and a summary no
 *     person creates (an API key, a workflow) is read in UTC;
 *   - the first one at 09:00 in that time zone at the start of the next
 *     period of how often it goes out: next Monday for a weekly summary,
 *     tomorrow for a daily one, the 1st for a monthly one - the rule the
 *     status page email reports follow (StatusPageReportScheduleUtil);
 *   - its next send worked out from those: the first send while it is
 *     ahead, else the first occurrence of the schedule after now - a first
 *     summary dated in the past never sends a burst of catch-up summaries.
 *
 * Every step counts whole calendar units on the summary's own clock, so a
 * summary goes out at the same time of day all year: one at 09:00 in Berlin
 * still goes out at 09:00 there after the clocks go back. Stepped in UTC, as
 * summaries were before they had a time zone, it went out at 08:00 there
 * all winter. A summary that names no time zone is read in UTC, as before.
 *
 * A schedule the caller sends is kept. On an update, the next send is
 * worked out again only when how often, the first summary's date or the
 * time zone really changes, or the summary is switched back on - editing a
 * summary's name leaves its schedule alone - and never for the worker's own
 * writes, which move nextSendAt alone. The worker moves it to the schedule's
 * first occurrence after now, counted from the first summary
 * (getNextSendAfterDue): a next send long past is sent once, not caught up
 * on with a summary a minute, and a monthly summary on the 31st stays on
 * each month's last day.
 *
 * Pure and synchronous, and in Common/Utils rather than Common/Server, so
 * the service that stores a summary and the form that shows the next one
 * work it out the same way.
 */

// A summary's schedule columns, as a write carries them or a summary holds them.
export interface WorkspaceSummaryScheduleColumns {
  recurringInterval?: Recurring | JSONObject | null | undefined;
  sendFirstReportAt?: Date | string | null | undefined;
  nextSendAt?: Date | string | null | undefined;
  isEnabled?: boolean | null | undefined;
  timezone?: Timezone | string | null | undefined;
}

// What a write to a summary has to carry as well.
export interface WorkspaceSummaryScheduleWrite {
  recurringInterval?: Recurring | undefined;
  sendFirstReportAt?: Date | undefined;
  nextSendAt?: Date | undefined;
  timezone?: Timezone | undefined;
}

export default class WorkspaceSummaryScheduleUtil {
  // Every week.
  public static readonly DEFAULT_INTERVAL_TYPE: EventInterval =
    EventInterval.Week;
  public static readonly DEFAULT_INTERVAL_COUNT: number = 1;
  // At 09:00, the hour status page reports go out at too.
  public static readonly DEFAULT_SEND_HOUR: number =
    StatusPageReportScheduleUtil.DEFAULT_SEND_HOUR;
  /*
   * What a summary that names no time zone is read in, and the time zone of
   * one no person creates: UTC, as every summary was read in before
   * summaries had one.
   */
  public static readonly DEFAULT_TIMEZONE: Timezone = Timezone.UTC;

  public static getDefaultRecurringInterval(): Recurring {
    const recurring: Recurring = new Recurring();
    recurring.intervalType = this.DEFAULT_INTERVAL_TYPE;
    recurring.intervalCount = new PositiveNumber(this.DEFAULT_INTERVAL_COUNT);
    return recurring;
  }

  /*
   * The time zone a value names, as the bundled tz database knows it, or
   * undefined. Legacy names are time zones too ("US/Eastern",
   * "Asia/Calcutta"): rows, API callers and Terraform configurations hold
   * them. One the database has since dropped ("US/Pacific-New") is read as
   * the zone it stands for, and so is a known name in another case or with
   * spaces around it (TimezoneAlias).
   */
  public static toTimezone(value: unknown): Timezone | undefined {
    if (typeof value !== "string" || !value.trim()) {
      return undefined;
    }

    for (const name of [
      value.trim(),
      TimezoneAlias.getCanonicalTimezone(value).toString(),
    ]) {
      const zone: moment.MomentZone | null = moment.tz.zone(name);

      if (zone) {
        return zone.name as Timezone;
      }
    }

    return undefined;
  }

  /*
   * The time zone a value names, under the name the dashboard offers for it
   * ("Asia/Kolkata" for "Asia/Calcutta"), or undefined: for a time zone
   * OneUptime fills in itself, such as the creator's. A name a caller sends
   * is stored as they sent it.
   */
  public static toCurrentTimezone(value: unknown): Timezone | undefined {
    const timezone: Timezone | undefined = this.toTimezone(value);

    if (!timezone) {
      return undefined;
    }

    const current: Timezone = TimezoneAlias.getCanonicalTimezone(timezone);

    return moment.tz.zone(current) ? current : timezone;
  }

  // The time zone a summary is read in: the one it names, else UTC.
  public static getTimezone(value: unknown): Timezone {
    return this.toTimezone(value) || this.DEFAULT_TIMEZONE;
  }

  /*
   * The default first summary: 09:00 in `timezone` (UTC when it names none
   * moment knows) at the start of the next period of the interval, strictly
   * after `after` (now, unless given) - next Monday for a weekly summary.
   */
  public static getDefaultFirstSendDate(data?: {
    timezone?: unknown;
    after?: Date | undefined;
    intervalType?: EventInterval | undefined;
  }): Date {
    return StatusPageReportScheduleUtil.getDefaultFirstReportDate({
      timezone: this.getTimezone(data?.timezone),
      after: data?.after,
      intervalType: data?.intervalType || this.DEFAULT_INTERVAL_TYPE,
    });
  }

  // A date column's value, or undefined when it holds nothing usable.
  public static toDate(value: unknown): Date | undefined {
    return StatusPageReportScheduleUtil.toDate(value);
  }

  /*
   * A recurring interval column's value, or undefined when it holds nothing
   * usable - an interval the calendar cannot step by included.
   */
  public static toRecurring(value: unknown): Recurring | undefined {
    return StatusPageReportScheduleUtil.toRecurring(value);
  }

  /*
   * Why a write's schedule cannot be stored, or null: a first summary date,
   * an interval or a time zone it carries that cannot be read. Without this
   * the API stored an unreadable interval, and the worker then failed on it
   * every minute. Sending the time zone as null clears it: the summary is
   * then read in UTC.
   */
  public static getWriteProblem(
    write: WorkspaceSummaryScheduleColumns,
  ): string | null {
    if (
      write.sendFirstReportAt !== undefined &&
      write.sendFirstReportAt !== null &&
      write.sendFirstReportAt !== "" &&
      !this.toDate(write.sendFirstReportAt)
    ) {
      return "sendFirstReportAt is not a date and time. Send it as an ISO 8601 string, such as 2026-10-12T09:00:00.000Z.";
    }

    if (
      write.recurringInterval !== undefined &&
      write.recurringInterval !== null &&
      !this.toRecurring(write.recurringInterval)
    ) {
      return 'recurringInterval is not a recurring interval. Send it as {"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}, with an interval type of Hour, Day, Week, Month or Year and a count of 1 or more.';
    }

    if (
      write.timezone !== undefined &&
      write.timezone !== null &&
      !this.toTimezone(write.timezone)
    ) {
      return 'timezone is not a time zone. Send an IANA time zone name, such as "Europe/Berlin", "America/New_York" or "UTC". The summary goes out at the same time of day there all year.';
    }

    return null;
  }

  /*
   * When a summary on this schedule goes out next, after `now`: its first
   * send while that is ahead, else the first occurrence of the schedule
   * strictly after now, stepping in whole calendar units on the clock of
   * `timezone` (UTC unless given): a monthly summary on the 1st stays on
   * the 1st, and one at 09:00 stays at 09:00 when the clocks change.
   * Undefined while either half is missing.
   */
  public static getNextSendDate(data: {
    sendFirstReportAt?: unknown;
    recurringInterval?: unknown;
    timezone?: unknown;
    now?: Date | undefined;
  }): Date | undefined {
    const startDate: Date | undefined = this.toDate(data.sendFirstReportAt);
    const recurring: Recurring | undefined = this.toRecurring(
      data.recurringInterval,
    );

    if (!startDate || !recurring) {
      return undefined;
    }

    try {
      return Recurring.getNextDateAfter({
        startDate: startDate,
        recurring: recurring,
        afterDate: data.now || OneUptimeDate.getCurrentDate(),
        timezone: this.getTimezone(data.timezone),
      });
    } catch {
      // Nothing to schedule on an interval the calendar cannot step through.
      return undefined;
    }
  }

  /*
   * The schedule columns a new summary has to carry as well: the time zone
   * when the write names none (`timezone` - the creator's - else UTC), the
   * default interval and first summary for what the caller left out (the
   * first at 09:00 in the summary's time zone), and the next send worked
   * out from them - unless the caller sent one of its own. A time zone the
   * write names is kept as it is: it is what the caller reads back.
   */
  public static getCreateWrite(data: {
    write: WorkspaceSummaryScheduleColumns;
    now?: Date | undefined;
    timezone?: unknown;
  }): WorkspaceSummaryScheduleWrite {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const result: WorkspaceSummaryScheduleWrite = {};

    let timezone: Timezone | undefined = this.toTimezone(data.write.timezone);

    if (!timezone) {
      timezone =
        this.toCurrentTimezone(data.timezone) || this.DEFAULT_TIMEZONE;
      result.timezone = timezone;
    }

    let recurring: Recurring | undefined = this.toRecurring(
      data.write.recurringInterval,
    );

    if (!recurring) {
      recurring = this.getDefaultRecurringInterval();
      result.recurringInterval = recurring;
    }

    let startDate: Date | undefined = this.toDate(data.write.sendFirstReportAt);

    if (!startDate) {
      startDate = this.getDefaultFirstSendDate({
        timezone: timezone,
        after: now,
        intervalType: recurring.intervalType,
      });
      result.sendFirstReportAt = startDate;
    }

    if (!this.toDate(data.write.nextSendAt)) {
      const nextSendAt: Date | undefined = this.getNextSendDate({
        sendFirstReportAt: startDate,
        recurringInterval: recurring,
        timezone: timezone,
        now: now,
      });

      if (nextSendAt) {
        result.nextSendAt = nextSendAt;
      }
    }

    return result;
  }

  /*
   * Whether a write touches the schedule: how often, the first summary, or
   * the time zone they are read in.
   */
  public static isScheduleWrite(
    write: WorkspaceSummaryScheduleColumns,
  ): boolean {
    return (
      write.recurringInterval !== undefined ||
      write.sendFirstReportAt !== undefined ||
      write.timezone !== undefined
    );
  }

  /*
   * Whether an update may move the next send: one that touches the
   * schedule, or switches the summary on (a summary switched back on must
   * not send at once for the time it was off).
   */
  public static isRescheduleWrite(
    write: WorkspaceSummaryScheduleColumns,
  ): boolean {
    return this.isScheduleWrite(write) || write.isEnabled === true;
  }

  /*
   * Where the report worker moves a summary's next send once it has sent
   * it: the schedule's first occurrence after now, on the clock of the
   * summary's time zone, counted from its first summary - one interval on,
   * normally. Counting from the first summary rather than from the send
   * that was due keeps the schedule where it was set: a monthly summary on
   * the 31st goes back to the 31st after February, a summary at 02:30
   * returns to 02:30 after the night the clocks skip it, and one that went
   * out an hour off while summaries were stepped in UTC goes back to its
   * time of day. A summary with no first summary date of its own is counted
   * from the send that was due.
   *
   * A next send long past (a worker that was down) is not caught up on with
   * a summary a minute: the worker sends once and moves on to the next
   * occurrence still ahead.
   */
  public static getNextSendAfterDue(data: {
    dueAt: Date;
    recurringInterval: Recurring | JSONObject;
    sendFirstReportAt?: Date | string | null | undefined;
    timezone?: unknown;
    now?: Date | undefined;
  }): Date {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const dueAt: Date = OneUptimeDate.fromString(data.dueAt);

    return Recurring.getNextDateAfter({
      startDate: this.toDate(data.sendFirstReportAt) || dueAt,
      recurring: Recurring.fromJSON(data.recurringInterval),
      // Strictly after the send that was due as well: never that send again.
      afterDate: dueAt.getTime() > now.getTime() ? dueAt : now,
      timezone: this.getTimezone(data.timezone),
    });
  }

  private static isSameRecurring(
    first: Recurring | undefined,
    second: Recurring | undefined,
  ): boolean {
    if (!first || !second) {
      return !first && !second;
    }

    return (
      first.intervalType === second.intervalType &&
      first.intervalCount.toNumber() === second.intervalCount.toNumber()
    );
  }

  private static isSameDate(
    first: Date | undefined,
    second: Date | undefined,
  ): boolean {
    if (!first || !second) {
      return !first && !second;
    }

    return first.getTime() === second.getTime();
  }

  /*
   * The first occurrence after `now` of a schedule that runs through
   * `anchor`, on the clock of `timezone`: forwards from it once it has
   * passed, and back towards now while it is still ahead - so a weekly
   * summary made daily goes out within a day, at the time of day it had,
   * rather than waiting for the weekly send it had coming.
   */
  private static getOccurrenceThrough(data: {
    anchor: Date;
    recurring: Recurring;
    now: Date;
    timezone: Timezone;
  }): Date | undefined {
    try {
      const unit: CalendarUnit = Recurring.toCalendarUnit(
        data.recurring.intervalType,
      );
      const intervalCount: number = Math.max(
        1,
        Math.floor(data.recurring.intervalCount.toNumber()),
      );

      let startDate: Date = data.anchor;

      if (data.anchor.getTime() > data.now.getTime()) {
        // Whole intervals back from the anchor to at or before now.
        const intervalsBack: number =
          Math.floor(
            OneUptimeDate.getCalendarUnitsBetween(
              data.now,
              data.anchor,
              unit,
              data.timezone,
            ) / intervalCount,
          ) + 1;

        startDate = OneUptimeDate.addRemoveCalendarUnits(
          data.anchor,
          unit,
          -intervalsBack * intervalCount,
          data.timezone,
        );
      }

      return Recurring.getNextDateAfter({
        startDate: startDate,
        recurring: data.recurring,
        afterDate: data.now,
        timezone: data.timezone,
      });
    } catch {
      return undefined;
    }
  }

  /*
   * The schedule columns an update of one summary has to carry as well:
   * `write` is what the caller sends, `stored` what the summary holds now.
   *
   * Only a write that really changes how often, the first summary's date or
   * the time zone, or switches the summary back on, gets a new next send:
   * the first summary while it is ahead, else the first occurrence of the
   * schedule after now, on the clock of the summary's time zone. A summary
   * with no first summary date of its own - most made before the dashboard
   * sent one - keeps the time of day of the send it has coming; one with
   * nothing coming at all starts at the default first summary. Nothing is
   * added to a write that carries a next send of its own (the report
   * worker's), or to one that leaves the schedule as it is and the summary
   * on or off as it was - editing a summary's name sends its schedule and
   * time zone back unchanged. No time zone and UTC are the same zone.
   */
  public static getUpdateWrite(data: {
    write: WorkspaceSummaryScheduleColumns;
    stored: WorkspaceSummaryScheduleColumns;
    now?: Date | undefined;
  }): WorkspaceSummaryScheduleWrite {
    const write: WorkspaceSummaryScheduleColumns = data.write;
    const stored: WorkspaceSummaryScheduleColumns = data.stored;
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    if (!this.isRescheduleWrite(write) || write.nextSendAt !== undefined) {
      return {};
    }

    const storedRecurring: Recurring | undefined = this.toRecurring(
      stored.recurringInterval,
    );
    const storedStartDate: Date | undefined = this.toDate(
      stored.sendFirstReportAt,
    );
    const storedTimezone: Timezone = this.getTimezone(stored.timezone);

    const recurring: Recurring | undefined =
      write.recurringInterval !== undefined
        ? this.toRecurring(write.recurringInterval)
        : storedRecurring;
    const startDate: Date | undefined =
      write.sendFirstReportAt !== undefined
        ? this.toDate(write.sendFirstReportAt)
        : storedStartDate;
    const timezone: Timezone =
      write.timezone !== undefined
        ? this.getTimezone(write.timezone)
        : storedTimezone;

    const isRescheduled: boolean =
      !this.isSameRecurring(recurring, storedRecurring) ||
      !this.isSameDate(startDate, storedStartDate) ||
      timezone !== storedTimezone;

    /*
     * Switched back on: the next send it had may be long past, and the
     * worker would send at once for the time it was off. It goes out at the
     * schedule's next occurrence instead.
     */
    const isTurningOn: boolean =
      write.isEnabled === true && stored.isEnabled === false;

    if ((!isRescheduled && !isTurningOn) || !recurring) {
      return {};
    }

    let nextSendAt: Date | undefined = undefined;
    const upcoming: Date | undefined = this.toDate(stored.nextSendAt);

    if (startDate) {
      nextSendAt = this.getNextSendDate({
        sendFirstReportAt: startDate,
        recurringInterval: recurring,
        timezone: timezone,
        now: now,
      });
    } else if (upcoming) {
      nextSendAt = this.getOccurrenceThrough({
        anchor: upcoming,
        recurring: recurring,
        now: now,
        timezone: timezone,
      });
    } else {
      nextSendAt = this.getNextSendDate({
        sendFirstReportAt: this.getDefaultFirstSendDate({
          timezone: timezone,
          after: now,
          intervalType: recurring.intervalType,
        }),
        recurringInterval: recurring,
        timezone: timezone,
        now: now,
      });
    }

    return nextSendAt ? { nextSendAt: nextSendAt } : {};
  }
}
