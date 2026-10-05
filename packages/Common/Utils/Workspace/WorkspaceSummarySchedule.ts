import OneUptimeDate, { CalendarUnit } from "../../Types/Date";
import EventInterval from "../../Types/Events/EventInterval";
import Recurring from "../../Types/Events/Recurring";
import { JSONObject } from "../../Types/JSON";
import PositiveNumber from "../../Types/PositiveNumber";
import StatusPageReportScheduleUtil from "../StatusPage/ReportSchedule";

/*
 * When a workspace summary - the recurring incident, alert and episode
 * summaries posted to Slack or Microsoft Teams - goes out.
 *
 * A summary's schedule is two columns: how often it goes out
 * (recurringInterval) and when the first one does (sendFirstReportAt). The
 * report worker sends a summary once its next send (nextSendAt) has passed,
 * then moves that on by how often. How often had no default, so a summary
 * could not be saved until one was made up, and a summary created through
 * the API without a next send was never sent at all. Now a summary that is
 * created without them gets:
 *
 *   - every week - the summary's other defaults are a week's: it covers the
 *     last 7 days, and the form suggests a "Weekly ... Summary";
 *   - the first one at 09:00 at the start of the next period of how often it
 *     goes out: next Monday for a weekly summary, tomorrow for a daily one,
 *     the 1st for a monthly one - the rule the status page email reports
 *     follow (StatusPageReportScheduleUtil). The dashboard reads 09:00 in the
 *     time zone of the person creating the summary; the API, which knows no
 *     time zone, reads it in UTC;
 *   - its next send worked out from those two: the first send while it is
 *     ahead, else the first occurrence of the schedule after now - a first
 *     summary dated in the past never sends a burst of catch-up summaries.
 *
 * A schedule the caller sends is kept. On an update, the next send is
 * worked out again only when how often or the first summary's date really
 * changes - editing a summary's name leaves its schedule alone - and never
 * for the worker's own writes, which move nextSendAt alone.
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
}

// What a write to a summary has to carry as well.
export interface WorkspaceSummaryScheduleWrite {
  recurringInterval?: Recurring | undefined;
  sendFirstReportAt?: Date | undefined;
  nextSendAt?: Date | undefined;
}

export default class WorkspaceSummaryScheduleUtil {
  // Every week.
  public static readonly DEFAULT_INTERVAL_TYPE: EventInterval =
    EventInterval.Week;
  public static readonly DEFAULT_INTERVAL_COUNT: number = 1;
  // At 09:00, the hour status page reports go out at too.
  public static readonly DEFAULT_SEND_HOUR: number =
    StatusPageReportScheduleUtil.DEFAULT_SEND_HOUR;

  public static getDefaultRecurringInterval(): Recurring {
    const recurring: Recurring = new Recurring();
    recurring.intervalType = this.DEFAULT_INTERVAL_TYPE;
    recurring.intervalCount = new PositiveNumber(this.DEFAULT_INTERVAL_COUNT);
    return recurring;
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
      timezone: data?.timezone,
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
   * Why a write's schedule cannot be stored, or null: a first summary date
   * or an interval it carries that cannot be read. Without this the API
   * stored an unreadable interval, and the worker then failed on it every
   * minute.
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

    return null;
  }

  /*
   * When a summary on this schedule goes out next, after `now`: its first
   * send while that is ahead, else the first occurrence of the schedule
   * strictly after now, stepping in whole calendar units (a monthly summary
   * on the 1st stays on the 1st). Undefined while either half is missing.
   */
  public static getNextSendDate(data: {
    sendFirstReportAt?: unknown;
    recurringInterval?: unknown;
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
      });
    } catch {
      // Nothing to schedule on an interval the calendar cannot step through.
      return undefined;
    }
  }

  /*
   * The schedule columns a new summary has to carry as well: the default
   * interval and first summary for what the caller left out (the first in
   * `timezone`, UTC unless given), and the next send worked out from them -
   * unless the caller sent one of its own.
   */
  public static getCreateWrite(data: {
    write: WorkspaceSummaryScheduleColumns;
    now?: Date | undefined;
    timezone?: unknown;
  }): WorkspaceSummaryScheduleWrite {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const result: WorkspaceSummaryScheduleWrite = {};

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
        timezone: data.timezone,
        after: now,
        intervalType: recurring.intervalType,
      });
      result.sendFirstReportAt = startDate;
    }

    if (!this.toDate(data.write.nextSendAt)) {
      const nextSendAt: Date | undefined = this.getNextSendDate({
        sendFirstReportAt: startDate,
        recurringInterval: recurring,
        now: now,
      });

      if (nextSendAt) {
        result.nextSendAt = nextSendAt;
      }
    }

    return result;
  }

  // Whether a write touches the schedule: how often, or the first summary.
  public static isScheduleWrite(
    write: WorkspaceSummaryScheduleColumns,
  ): boolean {
    return (
      write.recurringInterval !== undefined ||
      write.sendFirstReportAt !== undefined
    );
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
   * `anchor`: forwards from it once it has passed, and back towards now
   * while it is still ahead - so a weekly summary made daily goes out within
   * a day, at the time of day it had, rather than waiting for the weekly
   * send it had coming.
   */
  private static getOccurrenceThrough(data: {
    anchor: Date;
    recurring: Recurring;
    now: Date;
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
            OneUptimeDate.getCalendarUnitsBetween(data.now, data.anchor, unit) /
              intervalCount,
          ) + 1;

        startDate = OneUptimeDate.addRemoveCalendarUnits(
          data.anchor,
          unit,
          -intervalsBack * intervalCount,
        );
      }

      return Recurring.getNextDateAfter({
        startDate: startDate,
        recurring: data.recurring,
        afterDate: data.now,
      });
    } catch {
      return undefined;
    }
  }

  /*
   * The schedule columns an update of one summary has to carry as well:
   * `write` is what the caller sends, `stored` what the summary holds now.
   *
   * Only a write that really changes how often or the first summary's date
   * gets a new next send: the first summary while it is ahead, else the
   * first occurrence of the new schedule after now. A summary with no first
   * summary date of its own - most made before the dashboard sent one -
   * keeps the time of day of the send it has coming; one with nothing
   * coming at all starts at the default first summary. Nothing is added to
   * a write that carries a next send of its own (the report worker's), or to
   * one that leaves the schedule as it is - editing a summary's name sends
   * its schedule back unchanged.
   */
  public static getUpdateWrite(data: {
    write: WorkspaceSummaryScheduleColumns;
    stored: WorkspaceSummaryScheduleColumns;
    now?: Date | undefined;
  }): WorkspaceSummaryScheduleWrite {
    const write: WorkspaceSummaryScheduleColumns = data.write;
    const stored: WorkspaceSummaryScheduleColumns = data.stored;
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    if (!this.isScheduleWrite(write) || write.nextSendAt !== undefined) {
      return {};
    }

    const storedRecurring: Recurring | undefined = this.toRecurring(
      stored.recurringInterval,
    );
    const storedStartDate: Date | undefined = this.toDate(
      stored.sendFirstReportAt,
    );

    const recurring: Recurring | undefined =
      write.recurringInterval !== undefined
        ? this.toRecurring(write.recurringInterval)
        : storedRecurring;
    const startDate: Date | undefined =
      write.sendFirstReportAt !== undefined
        ? this.toDate(write.sendFirstReportAt)
        : storedStartDate;

    const isRescheduled: boolean =
      !this.isSameRecurring(recurring, storedRecurring) ||
      !this.isSameDate(startDate, storedStartDate);

    if (!isRescheduled || !recurring) {
      return {};
    }

    let nextSendAt: Date | undefined = undefined;
    const upcoming: Date | undefined = this.toDate(stored.nextSendAt);

    if (startDate) {
      nextSendAt = this.getNextSendDate({
        sendFirstReportAt: startDate,
        recurringInterval: recurring,
        now: now,
      });
    } else if (upcoming) {
      nextSendAt = this.getOccurrenceThrough({
        anchor: upcoming,
        recurring: recurring,
        now: now,
      });
    } else {
      nextSendAt = this.getNextSendDate({
        sendFirstReportAt: this.getDefaultFirstSendDate({
          after: now,
          intervalType: recurring.intervalType,
        }),
        recurringInterval: recurring,
        now: now,
      });
    }

    return nextSendAt ? { nextSendAt: nextSendAt } : {};
  }
}
