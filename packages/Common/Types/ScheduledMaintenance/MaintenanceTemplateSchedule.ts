import OneUptimeDate from "../Date";
import Recurring from "../Events/Recurring";
import { JSONObject } from "../JSON";
import Timezone from "../Timezone";
import TimezoneAlias from "../TimezoneAlias";
import { toMaintenanceDate } from "./MaintenanceWindow";
import moment from "moment-timezone";

/*
 * WHEN A RECURRING MAINTENANCE TEMPLATE CREATES ITS EVENTS, AND WHEN EACH
 * STARTS AND ENDS (#10037).
 *
 * A template's schedule is its first event - when OneUptime creates it
 * (firstEventScheduledAt), when it starts and when it ends - how often it
 * recurs (recurringInterval), and the time zone those times are read on
 * (timezone). Every later event is the first one moved on whole intervals
 * of that zone's calendar (Recurring.getOccurrence): each of its three
 * times keeps its time of day there, and a monthly event keeps its day of
 * the month.
 *
 * Until templates had a time zone, the next event was the one before plus a
 * fixed number of milliseconds (Recurring.getNextDate): a day was 24 hours,
 * a month 30.4375 days and a year 365.25 days, and each event started and
 * ended a fixed number of minutes after it was created. So a daily window
 * typed for 02:00 in Los Angeles ran at 01:00 there all winter, and a
 * monthly window on the 1st walked through the month: 31 January, 2 March,
 * 2 April.
 *
 * The rules, for every event worked out from the first one (never from the
 * event before it, so nothing drifts):
 *
 *   - days, weeks, months and years are calendar units on the template's
 *     clock: an event at 02:00 is at 02:00 there before and after the
 *     clocks change, a weekly one keeps its weekday;
 *   - a day of the month the month does not have is its last day: a monthly
 *     event on the 31st is on 30 April and on 28 or 29 February, and back on
 *     the 31st in March; a yearly one on 29 February is on 28 February in
 *     other years;
 *   - a time the clocks skip (02:30 on the night they go forward) is moved
 *     on by the jump, to 03:30; a time they pass twice (01:30 on the night
 *     they go back in New York) is the first of the two;
 *   - hours are hours of elapsed time: a template that recurs every 12
 *     hours creates its events 12 hours apart, whatever the clocks do;
 *   - an event whose times come out of order that way (a start moved past
 *     its end because the clocks skipped it) keeps the first event's
 *     lengths, counted from its start: it is created as long before it
 *     starts, and lasts as long, as the first event;
 *   - a zone that stopped changing its clocks (British Columbia, on UTC-7
 *     since 1 November 2026) keeps that offset: its events stay where they
 *     are.
 *
 * Templates made before they had a time zone are read in UTC, the clock
 * their events were stepped on until now: a UTC day is 24 hours, so their
 * hourly, daily and weekly events stay exactly where they were, and their
 * monthly and yearly events go back to the first event's day of the month.
 * A template's own time zone - the creator's, as the dashboard shows it, on
 * a new one - is picked on its form.
 *
 * Pure, and free of anything server-side: the template's service and the
 * job that creates the events (Workers, ScheduleRecurringEvents) work the
 * schedule out with it, and so can the dashboard.
 */

// The columns of a template that make its schedule, as stored or as written.
export interface MaintenanceTemplateScheduleColumns {
  firstEventScheduledAt?: unknown;
  firstEventStartsAt?: unknown;
  firstEventEndsAt?: unknown;
  recurringInterval?: unknown;
  timezone?: unknown;
}

// A template's schedule, read.
export interface MaintenanceTemplateScheduleData {
  firstEventScheduledAt: Date;
  firstEventStartsAt: Date;
  firstEventEndsAt: Date;
  recurringInterval: Recurring;
  timezone: Timezone;
}

// When an event is created (and its subscribers told it is scheduled), starts and ends.
export interface MaintenanceTemplateEventTimes {
  scheduledAt: Date;
  startsAt: Date;
  endsAt: Date;
}

// One event of a template's schedule: 0 is the first.
export interface MaintenanceTemplateEvent
  extends MaintenanceTemplateEventTimes {
  index: number;
}

/*
 * What the job does for a template whose next time has come: the event it
 * creates now - or none, when the schedule's own event for that time is
 * still to come - and when the template's next event is created after it.
 */
export interface MaintenanceTemplateDueEvent {
  event: MaintenanceTemplateEventTimes | null;
  nextEventAt: Date;
}

/*
 * How far a template's next time may be from one of its events and still be
 * that event: the time is worked out to the millisecond and stored as it
 * is, so this only has to cover a round trip through the database.
 */
const SAME_EVENT_TOLERANCE_IN_MS: number = 1000;

export default class MaintenanceTemplateSchedule {
  /*
   * What a template that names no time zone is read in: UTC, the clock every
   * template was stepped on before templates had one.
   */
  public static readonly DEFAULT_TIMEZONE: Timezone = Timezone.UTC;

  /*
   * The time zone a value names, as the bundled tz database spells it, or
   * undefined. Legacy names are time zones too ("US/Eastern",
   * "Asia/Calcutta"): API callers and Terraform configurations hold them,
   * and get back what they sent. A known name in another case or with
   * spaces around it is read as that name (TimezoneAlias).
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
   * The time zone a value names, under the name the dashboard's picker
   * offers for it ("Asia/Kolkata" for "Asia/Calcutta"), or undefined: for a
   * time zone OneUptime fills in itself, such as the creator's.
   */
  public static toCurrentTimezone(value: unknown): Timezone | undefined {
    const timezone: Timezone | undefined = this.toTimezone(value);

    if (!timezone) {
      return undefined;
    }

    const current: Timezone = TimezoneAlias.getCanonicalTimezone(timezone);

    return moment.tz.zone(current) ? current : timezone;
  }

  // The time zone a template is read in: the one it names, else UTC.
  public static getTimezone(value: unknown): Timezone {
    return this.toTimezone(value) || this.DEFAULT_TIMEZONE;
  }

  // Whether a write's time zone is one: nothing at all is (it reads as UTC).
  public static isTimezoneWritable(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      value === "" ||
      Boolean(this.toTimezone(value))
    );
  }

  /*
   * A recurring interval column's value, or undefined when it holds nothing
   * usable - an interval type the calendar cannot step by included.
   */
  public static toRecurring(value: unknown): Recurring | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    try {
      const recurring: Recurring = Recurring.fromJSON(
        value as JSONObject | Recurring,
      );

      Recurring.toCalendarUnit(recurring.intervalType);

      return recurring;
    } catch {
      return undefined;
    }
  }

  // A template's schedule, or null while any part of it is missing.
  public static read(
    columns: MaintenanceTemplateScheduleColumns,
  ): MaintenanceTemplateScheduleData | null {
    const firstEventScheduledAt: Date | null = toMaintenanceDate(
      columns.firstEventScheduledAt,
    );
    const firstEventStartsAt: Date | null = toMaintenanceDate(
      columns.firstEventStartsAt,
    );
    const firstEventEndsAt: Date | null = toMaintenanceDate(
      columns.firstEventEndsAt,
    );
    const recurringInterval: Recurring | undefined = this.toRecurring(
      columns.recurringInterval,
    );

    if (
      !firstEventScheduledAt ||
      !firstEventStartsAt ||
      !firstEventEndsAt ||
      !recurringInterval
    ) {
      return null;
    }

    return {
      firstEventScheduledAt: firstEventScheduledAt,
      firstEventStartsAt: firstEventStartsAt,
      firstEventEndsAt: firstEventEndsAt,
      recurringInterval: recurringInterval,
      timezone: this.getTimezone(columns.timezone),
    };
  }

  /*
   * The `index`th event of a schedule (0 is the first event, as saved): each
   * of the first event's times moved on `index` intervals of the template's
   * clock. An event whose times that leaves out of order - only ever by a
   * time the clocks skipped - keeps the first event's lengths from its start.
   */
  public static getEvent(
    schedule: MaintenanceTemplateScheduleData,
    index: number,
  ): MaintenanceTemplateEvent {
    const occurrence: (date: Date) => Date = (date: Date): Date => {
      return Recurring.getOccurrence({
        startDate: date,
        recurring: schedule.recurringInterval,
        index: index,
        timezone: schedule.timezone,
      });
    };

    const startsAt: Date = occurrence(schedule.firstEventStartsAt);
    let scheduledAt: Date = occurrence(schedule.firstEventScheduledAt);
    let endsAt: Date = occurrence(schedule.firstEventEndsAt);

    const lengthInMs: number =
      schedule.firstEventEndsAt.getTime() -
      schedule.firstEventStartsAt.getTime();
    const leadInMs: number =
      schedule.firstEventStartsAt.getTime() -
      schedule.firstEventScheduledAt.getTime();

    if (lengthInMs > 0 && endsAt.getTime() <= startsAt.getTime()) {
      endsAt = new Date(startsAt.getTime() + lengthInMs);
    }

    if (leadInMs > 0 && scheduledAt.getTime() >= startsAt.getTime()) {
      scheduledAt = new Date(startsAt.getTime() - leadInMs);
    }

    return {
      index: Math.max(0, Math.floor(index)),
      scheduledAt: scheduledAt,
      startsAt: startsAt,
      endsAt: endsAt,
    };
  }

  /*
   * Which event of a schedule is the first created strictly after `after`:
   * 0 while the first event is still to be created.
   */
  public static getEventIndexAfter(
    schedule: MaintenanceTemplateScheduleData,
    after: Date,
  ): number {
    const scheduledAt: (index: number) => number = (index: number): number => {
      return this.getEvent(schedule, index).scheduledAt.getTime();
    };

    // The creation times' own steps, then the few events a fix-up moved.
    let index: number = Recurring.getOccurrenceIndexAfter({
      startDate: schedule.firstEventScheduledAt,
      recurring: schedule.recurringInterval,
      afterDate: after,
      timezone: schedule.timezone,
    });

    while (index > 0 && scheduledAt(index - 1) > after.getTime()) {
      index--;
    }

    while (scheduledAt(index) <= after.getTime()) {
      index++;
    }

    return index;
  }

  /*
   * When a template on this schedule creates its next event, after `now`:
   * its first event while that is still ahead, else the first event of the
   * schedule after now - so a template whose first event is in the past
   * never creates a burst of events for the times that went by. Undefined
   * while any part of the schedule is missing.
   */
  public static getNextEventAt(
    columns: MaintenanceTemplateScheduleColumns,
    now?: Date | undefined,
  ): Date | undefined {
    const schedule: MaintenanceTemplateScheduleData | null = this.read(columns);

    if (!schedule) {
      return undefined;
    }

    const after: Date = now || OneUptimeDate.getCurrentDate();

    return this.getEvent(schedule, this.getEventIndexAfter(schedule, after))
      .scheduledAt;
  }

  /*
   * The `count` events a schedule creates strictly after `after`, in order:
   * what a template will do from here.
   */
  public static getEventsAfter(
    columns: MaintenanceTemplateScheduleColumns,
    data: { after: Date; count: number },
  ): Array<MaintenanceTemplateEvent> {
    const schedule: MaintenanceTemplateScheduleData | null = this.read(columns);

    if (!schedule) {
      return [];
    }

    const firstIndex: number = this.getEventIndexAfter(schedule, data.after);
    const events: Array<MaintenanceTemplateEvent> = [];

    for (let i: number = 0; i < Math.max(0, data.count); i++) {
      events.push(this.getEvent(schedule, firstIndex + i));
    }

    return events;
  }

  /*
   * What the job does for a template whose next time (`dueAt`) has come, as
   * of `now`. Undefined while any part of the schedule is missing.
   *
   * The time is one of the schedule's events whenever OneUptime worked it
   * out with this file, and that event is created: its times are the first
   * event's, moved on as many intervals.
   *
   * A template saved before it had a time zone may hold a time its old
   * steps worked out, a few hours (or, monthly, a day or two) away from its
   * event on the calendar. It is read as the event nearest to it:
   *
   *   - that event is still to come: nothing is created now, and the next
   *     time moves to that event's, which is created then;
   *   - it has passed already: the event is created at the time held, with
   *     the first event's distances from it, as before this change - the
   *     time the templates list promised.
   *
   * Either way the template then waits for the schedule's next event after
   * now, so a time the old steps held is never created twice, and the
   * template is on its calendar from then on.
   */
  public static getDueEvent(data: {
    columns: MaintenanceTemplateScheduleColumns;
    dueAt: Date;
    now?: Date | undefined;
  }): MaintenanceTemplateDueEvent | undefined {
    const schedule: MaintenanceTemplateScheduleData | null = this.read(
      data.columns,
    );

    if (!schedule) {
      return undefined;
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const dueAt: Date = OneUptimeDate.fromString(data.dueAt);

    const nearest: MaintenanceTemplateEvent = this.getEventNearest(
      schedule,
      dueAt,
    );

    const nextEventAt: Date = this.getEvent(
      schedule,
      this.getEventIndexAfter(schedule, now),
    ).scheduledAt;

    if (
      Math.abs(nearest.scheduledAt.getTime() - dueAt.getTime()) <=
      SAME_EVENT_TOLERANCE_IN_MS
    ) {
      return {
        event: {
          scheduledAt: nearest.scheduledAt,
          startsAt: nearest.startsAt,
          endsAt: nearest.endsAt,
        },
        nextEventAt: nextEventAt,
      };
    }

    if (nearest.scheduledAt.getTime() > now.getTime()) {
      return { event: null, nextEventAt: nextEventAt };
    }

    return {
      event: {
        scheduledAt: dueAt,
        startsAt: new Date(
          dueAt.getTime() +
            (schedule.firstEventStartsAt.getTime() -
              schedule.firstEventScheduledAt.getTime()),
        ),
        endsAt: new Date(
          dueAt.getTime() +
            (schedule.firstEventEndsAt.getTime() -
              schedule.firstEventScheduledAt.getTime()),
        ),
      },
      nextEventAt: nextEventAt,
    };
  }

  // The event of a schedule created nearest to `at`, the earlier on a tie.
  private static getEventNearest(
    schedule: MaintenanceTemplateScheduleData,
    at: Date,
  ): MaintenanceTemplateEvent {
    const after: number = this.getEventIndexAfter(schedule, at);
    const next: MaintenanceTemplateEvent = this.getEvent(schedule, after);

    if (after === 0) {
      return next;
    }

    const previous: MaintenanceTemplateEvent = this.getEvent(
      schedule,
      after - 1,
    );

    return at.getTime() - previous.scheduledAt.getTime() <=
      next.scheduledAt.getTime() - at.getTime()
      ? previous
      : next;
  }
}
