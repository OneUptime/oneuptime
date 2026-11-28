import OneUptimeDate from "../Date";
import DayOfWeek from "../Day/DayOfWeek";
import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "./RestrictionTimes";
import { refusedValue } from "../../Utils/RefusedValue";
import moment from "moment-timezone";

/*
 * THE DAYS OF A WEEKLY WINDOW ARE THE DAYS IT NAMES (#11455).
 *
 * A window of a layer's active hours is { startDay, startTime, endDay,
 * endTime }. The schedule engine (LayerUtil.getWeeklyRestrictionTimesForWeek)
 * reads its days from the weekday startTime and endTime fall on, in the
 * schedule's time zone, and never reads startDay or endDay. The Dashboard
 * dates every time it saves on the day its menu names, so the two agree; an
 * API or Terraform write did not have to. One that named Monday with a
 * Wednesday-dated startTime was stored without a word, and the layer was on
 * call on Wednesdays and on no Monday at all.
 *
 * The days a person names are the window's days. So:
 *
 *   - A write is held to them (checkWrittenWindows): each time must fall on
 *     the day its window names, in the schedule's time zone, or the write is
 *     refused with a 400 that names the window, the day its time falls on,
 *     and a date on the day it names to send instead. It is refused rather
 *     than re-dated because a re-dated time is not the one the client sent:
 *     Terraform compares what it sent with what it reads back, instant for
 *     instant, and would fail every apply. A day left out is the day its
 *     time falls on, as the engine always read it; a day that is not a day
 *     of the week is refused. A window the layer already holds, sent back as
 *     it is - the Dashboard's Save Layer sends every window, changed or
 *     not - is not judged again.
 *
 *   - A schedule with no time zone reads its times in the server's, while
 *     the Dashboard dates them in the zone of whoever edits them, so near
 *     midnight a window's days and its times can read a day apart there and
 *     both be right. A time is held, there, only to falling on its day in
 *     some time zone (canFallOnDayInSomeTimezone): a Monday dated on a
 *     Wednesday is refused, a Monday 00:30 written from Warsaw is not.
 *
 *   - A window stored before this is read the same way
 *     (getStoredWindowRepair, for the data migration and the Dashboard):
 *     a day left out is filled in from its time; a time that falls on
 *     another day than its window names, and on that day in no time zone,
 *     was dated wrong - an API placeholder date, or a Dashboard default
 *     whose day was kept and whose time was never touched - and is moved
 *     onto the day it names, at the same time of day; one that falls on its
 *     day in another time zone could be either, so it is left as it pages
 *     and shown to be checked.
 *
 *   - Changing a schedule's time zone keeps each time on the clock
 *     (moveWindowsToTimezone, moveMomentToTimezone): a window keeps its days
 *     and its hours in the new zone, as the Dashboard says it does, so it
 *     never comes to disagree with its days.
 *
 * Read by the server, the data migration and the Dashboard, so it imports
 * nothing that needs a server or React.
 */

// The days of the week, as a write names them.
export const DAY_NAMES: string =
  "Monday, Tuesday, Wednesday, Thursday, Friday, Saturday or Sunday";

const DAYS: ReadonlyArray<DayOfWeek> = [
  DayOfWeek.Sunday,
  DayOfWeek.Monday,
  DayOfWeek.Tuesday,
  DayOfWeek.Wednesday,
  DayOfWeek.Thursday,
  DayOfWeek.Friday,
  DayOfWeek.Saturday,
];

/*
 * How far a time zone's clock is from UTC, at most: UTC-12 to UTC+14, in
 * minutes. A time falls on its day in some zone when one of these offsets
 * puts it there.
 */
export const EARLIEST_ZONE_OFFSET_MINUTES: number = -12 * 60;
export const LATEST_ZONE_OFFSET_MINUTES: number = 14 * 60;

const MINUTES_IN_A_DAY: number = 24 * 60;

// One end of a window: where its day and its time are.
export enum WindowEnd {
  Start = "start",
  End = "end",
}

const DAY_KEY: Record<WindowEnd, "startDay" | "endDay"> = {
  [WindowEnd.Start]: "startDay",
  [WindowEnd.End]: "endDay",
};

const TIME_KEY: Record<WindowEnd, "startTime" | "endTime"> = {
  [WindowEnd.Start]: "startTime",
  [WindowEnd.End]: "endTime",
};

// One end of a window, read.
export interface WindowEndReading {
  end: WindowEnd;
  dayKey: "startDay" | "endDay";
  timeKey: "startTime" | "endTime";
  // The day as it is written, whatever it is.
  writtenDay: unknown;
  // Whether there is a day at all: neither left out nor null.
  hasDay: boolean;
  // The day it names, exactly as a day is written ("Monday"), else null.
  day: DayOfWeek | null;
  // The day it names, however it is cased or spaced (" monday"), else null.
  dayAsRead: DayOfWeek | null;
  // The time, or null when it is no date and time.
  moment: Date | null;
  // The day the time falls on in the zone it is read in, or null.
  fallsOn: DayOfWeek | null;
  // Whether the time falls on the day it names (as read), in that zone.
  agrees: boolean;
  /*
   * Whether the time falls on the day it names in some time zone - so it
   * could have been dated in another zone than the one it is read in.
   */
  couldBeDatedInAnotherZone: boolean;
}

// What a stored window comes to, read again (getStoredWindowRepair).
export enum StoredWindowState {
  /*
   * Its times fall on its days - or, in a schedule without a time zone, on
   * its days in some zone, as such a schedule's windows are dated: nothing
   * to do.
   */
  Agrees = "Agrees",
  /*
   * Its times fall on its days, but a day is left out or written another
   * way ("monday"): the day is filled in from its time. It pages as before.
   */
  DaysFilledIn = "DaysFilledIn",
  /*
   * A time falls on another day than its window names, and on that day in
   * no time zone: it is moved onto the day it names, at the same time of
   * day. It pages on the days it names from now on.
   */
  MovedOntoItsDays = "MovedOntoItsDays",
  /*
   * A time falls on another day than its window names here, but on that
   * day in another time zone: it could have been dated in another zone, or
   * dated wrong. It is left as it pages, and shown to be checked.
   */
  ToCheck = "ToCheck",
  // Its times are no dates and times: there is no day to read.
  Unreadable = "Unreadable",
}

export interface StoredWindowRepair {
  state: StoredWindowState;
  /*
   * The window as it is to be stored: the same object when nothing changes.
   * A window to check may still have a day filled in, which pages as before.
   */
  window: WeeklyResctriction;
  isChanged: boolean;
  start: WindowEndReading;
  end: WindowEndReading;
}

export interface StoredWindowsRepair {
  // The windows as they are to be stored.
  windows: Array<WeeklyResctriction>;
  repairs: Array<StoredWindowRepair>;
  // Whether a window is to be stored otherwise than it is.
  isChanged: boolean;
  // Whether a window pages on other days from now on.
  pagesOtherwise: boolean;
}

// A window to check, as the Dashboard shows it.
export interface WindowToCheck {
  index: number;
  // The days it names.
  startDay: DayOfWeek | null;
  endDay: DayOfWeek | null;
  // The days its times fall on, which it is on call from and to.
  startsOn: DayOfWeek;
  endsOn: DayOfWeek;
}

export interface WrittenWindowsCheck {
  // The schedule's time zone; none for a schedule without one.
  timezone?: string | null | undefined;
  /*
   * The windows the layer holds now, for an update: one sent back as it is
   * stored is not judged again.
   */
  storedWindows?: Array<unknown> | null | undefined;
  // How the value is named in a refusal: "restrictionTimes" unless given.
  fieldName?: string | undefined;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asZone(timezone: string | null | undefined): string | undefined {
  return timezone && timezone.trim() ? timezone.trim() : undefined;
}

// A moment on the clock of a zone, or the server's when there is none.
function onClockOf(date: Date, timezone: string | undefined): moment.Moment {
  return timezone ? moment.tz(date, timezone) : moment(date);
}

function getMillisecondOfDay(date: Date, timezone: string | undefined): number {
  const clock: moment.Moment = onClockOf(date, timezone);

  return (
    ((clock.hour() * 60 + clock.minute()) * 60 + clock.second()) * 1000 +
    clock.millisecond()
  );
}

export default class WeeklyWindowDays {
  // A day as a write names one: "Monday" exactly, else null.
  public static readDay(value: unknown): DayOfWeek | null {
    return typeof value === "string" && DAYS.includes(value as DayOfWeek)
      ? (value as DayOfWeek)
      : null;
  }

  // A day as it may be stored: " monday" or "MONDAY" too, else null.
  public static readStoredDay(value: unknown): DayOfWeek | null {
    if (typeof value !== "string") {
      return null;
    }

    const name: string = value.trim().toLowerCase();

    return (
      DAYS.find((day: DayOfWeek): boolean => {
        return day.toLowerCase() === name;
      }) || null
    );
  }

  /*
   * The day a time falls on in a zone - the schedule's, else the server's,
   * as the engine reads it (OneUptimeDate.getDayOfWeek).
   */
  public static getDayOf(
    date: Date,
    timezone?: string | null | undefined,
  ): DayOfWeek {
    return OneUptimeDate.getDayOfWeek(date, asZone(timezone));
  }

  /*
   * Whether a time falls on `day` in some time zone, from UTC-12 to UTC+14:
   * the day it falls on in UTC, the day before when it is early enough in
   * the UTC day, or the day after when it is late enough.
   */
  public static canFallOnDayInSomeTimezone(
    date: Date,
    day: DayOfWeek,
  ): boolean {
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    const minuteOfDay: number = date.getUTCHours() * 60 + date.getUTCMinutes();
    const utcDay: number = date.getUTCDay();
    const wanted: number = DAYS.indexOf(day);

    for (const offset of [
      EARLIEST_ZONE_OFFSET_MINUTES,
      0,
      LATEST_ZONE_OFFSET_MINUTES,
    ]) {
      const shift: number = Math.floor(
        (minuteOfDay + offset) / MINUTES_IN_A_DAY,
      );

      if ((((utcDay + shift) % 7) + 7) % 7 === wanted) {
        return true;
      }
    }

    return false;
  }

  /*
   * A time moved onto `day`, at the same time of day, in a zone (the
   * server's when none): within its own week, or - where that day's clock
   * skips the hour it is at, the night the clocks go forward - within a
   * week next to it, so its time of day is never moved with it.
   */
  public static moveOntoDay(
    date: Date,
    day: DayOfWeek,
    timezone?: string | null | undefined,
  ): Date {
    const zone: string | undefined = asZone(timezone);
    const timeOfDay: number = getMillisecondOfDay(date, zone);

    let first: Date | null = null;

    for (const weeks of [0, 1, -1, 2, -2]) {
      const base: Date =
        weeks === 0 ? date : OneUptimeDate.addRemoveDays(date, weeks * 7, zone);
      const candidate: Date = OneUptimeDate.moveDateToTheDayOfWeek(
        base,
        base,
        day,
        zone,
      );

      if (!first) {
        first = candidate;
      }

      if (
        WeeklyWindowDays.getDayOf(candidate, zone) === day &&
        getMillisecondOfDay(candidate, zone) === timeOfDay
      ) {
        return candidate;
      }
    }

    return first!;
  }

  // One end of a window, read in a zone (the server's when none).
  public static readEnd(
    window: unknown,
    end: WindowEnd,
    timezone?: string | null | undefined,
  ): WindowEndReading {
    const zone: string | undefined = asZone(timezone);
    const value: JSONObject = isObject(window) ? window : {};
    const writtenDay: unknown = value[DAY_KEY[end]];
    const day: DayOfWeek | null = WeeklyWindowDays.readDay(writtenDay);
    const dayAsRead: DayOfWeek | null =
      WeeklyWindowDays.readStoredDay(writtenDay);
    const time: Date | null = RestrictionTimes.readMoment(value[TIME_KEY[end]]);
    const fallsOn: DayOfWeek | null = time
      ? WeeklyWindowDays.getDayOf(time, zone)
      : null;

    return {
      end: end,
      dayKey: DAY_KEY[end],
      timeKey: TIME_KEY[end],
      writtenDay: writtenDay,
      hasDay: writtenDay !== undefined && writtenDay !== null,
      day: day,
      dayAsRead: dayAsRead,
      moment: time,
      fallsOn: fallsOn,
      agrees: Boolean(dayAsRead && fallsOn && dayAsRead === fallsOn),
      couldBeDatedInAnotherZone: Boolean(
        time &&
          dayAsRead &&
          WeeklyWindowDays.canFallOnDayInSomeTimezone(time, dayAsRead),
      ),
    };
  }

  // Both ends of a window.
  public static readEnds(
    window: unknown,
    timezone?: string | null | undefined,
  ): [WindowEndReading, WindowEndReading] {
    return [
      WeeklyWindowDays.readEnd(window, WindowEnd.Start, timezone),
      WeeklyWindowDays.readEnd(window, WindowEnd.End, timezone),
    ];
  }

  /*
   * Whether two windows are the same window as stored: the same days as
   * written, and times at the same instants.
   */
  public static isSameWindow(a: unknown, b: unknown): boolean {
    if (!isObject(a) || !isObject(b)) {
      return false;
    }

    for (const end of [WindowEnd.Start, WindowEnd.End]) {
      if (a[DAY_KEY[end]] !== b[DAY_KEY[end]]) {
        return false;
      }

      const first: Date | null = RestrictionTimes.readMoment(a[TIME_KEY[end]]);
      const second: Date | null = RestrictionTimes.readMoment(b[TIME_KEY[end]]);

      if (!first || !second || first.getTime() !== second.getTime()) {
        return false;
      }
    }

    return true;
  }

  /*
   * A WRITTEN RESTRICTION'S WEEKLY WINDOWS, HELD TO THEIR DAYS.
   *
   * The restriction as it is to be stored - each window with the days it
   * names, a day left out filled in from its time - or a refusal that names
   * the window. Only a Weekly restriction is read; any other is returned as
   * it is. The windows' times are checked by RestrictionTimes.fromWrittenJSON
   * first: one that is no date and time is refused there.
   */
  public static checkWrittenWindows(
    restrictionTimes: RestrictionTimes,
    options?: WrittenWindowsCheck | undefined,
  ): RestrictionTimes {
    if (restrictionTimes.restrictionType !== RestrictionType.Weekly) {
      return restrictionTimes;
    }

    const field: string = options?.fieldName || "restrictionTimes";
    const zone: string | undefined = asZone(options?.timezone);
    const stored: Array<unknown> = options?.storedWindows || [];

    const windows: Array<WeeklyResctriction> = (
      restrictionTimes.weeklyRestrictionTimes || []
    ).map((window: WeeklyResctriction, index: number): WeeklyResctriction => {
      // Sent back as it is stored: not judged again.
      if (
        stored.some((storedWindow: unknown): boolean => {
          return WeeklyWindowDays.isSameWindow(window, storedWindow);
        })
      ) {
        return window;
      }

      const name: string = `${field}.value.weeklyRestrictionTimes[${index}]`;
      const filled: WeeklyResctriction = { ...window };

      for (const reading of WeeklyWindowDays.readEnds(window, zone)) {
        if (!reading.moment || !reading.fallsOn) {
          // Refused by RestrictionTimes.fromWrittenJSON before this is read.
          continue;
        }

        if (!reading.hasDay) {
          // Left out: the day its time falls on, as the engine reads it.
          filled[reading.dayKey] = reading.fallsOn;
          continue;
        }

        if (!reading.day) {
          throw new BadDataException(
            `${name}.${reading.dayKey} is "${refusedValue(
              typeof reading.writtenDay === "object"
                ? JSON.stringify(reading.writtenDay)
                : reading.writtenDay,
            )}", which is not a day of the week. Write ${DAY_NAMES}.`,
          );
        }

        if (reading.day === reading.fallsOn) {
          continue;
        }

        // A schedule without a zone: on its day in some zone is enough.
        if (!zone && reading.couldBeDatedInAnotherZone) {
          continue;
        }

        throw new BadDataException(
          WeeklyWindowDays.getDayRefusal({
            name: name,
            reading: reading,
            timezone: zone,
          }),
        );
      }

      return filled;
    });

    const checked: RestrictionTimes = new RestrictionTimes();
    checked.restrictionType = restrictionTimes.restrictionType;
    checked.dayRestrictionTimes = restrictionTimes.dayRestrictionTimes;
    checked.weeklyRestrictionTimes = windows;

    return checked;
  }

  /*
   * Why a time is refused for its day: which day it falls on, and a time on
   * the day it names to send instead - or the day to name to keep it.
   */
  private static getDayRefusal(data: {
    name: string;
    reading: WindowEndReading;
    timezone: string | undefined;
  }): string {
    const reading: WindowEndReading = data.reading;
    const moment: Date = reading.moment!;
    const instead: Date = WeeklyWindowDays.moveOntoDay(
      moment,
      reading.day!,
      data.timezone,
    );

    const where: string = data.timezone
      ? `a ${reading.fallsOn} in ${data.timezone}, the schedule's time zone`
      : `a ${reading.fallsOn} on the server's clock (the schedule has no time zone), and a ${reading.day} in no time zone`;

    return `${data.name}.${reading.timeKey} is ${OneUptimeDate.toString(
      moment,
    )}, ${where}, but its ${reading.dayKey} is ${reading.day}. A window is on call on the days it names: date its ${reading.timeKey} on a ${reading.day}, such as ${OneUptimeDate.toString(
      instead,
    )}, or set its ${reading.dayKey} to ${reading.fallsOn}.`;
  }

  /*
   * A STORED WINDOW, READ AGAIN (#11455): what it comes to and how it is to
   * be stored - the data migration's rule, and the Dashboard's for which
   * windows to show to be checked. The zone is the schedule's, or none for
   * a schedule without one (read in the server's, as the engine reads it).
   */
  public static getStoredWindowRepair(
    window: WeeklyResctriction,
    timezone?: string | null | undefined,
  ): StoredWindowRepair {
    const zone: string | undefined = asZone(timezone);
    const [start, end]: [WindowEndReading, WindowEndReading] =
      WeeklyWindowDays.readEnds(window, zone);

    if (!start.moment || !end.moment) {
      return {
        state: StoredWindowState.Unreadable,
        window: window,
        isChanged: false,
        start: start,
        end: end,
      };
    }

    const readings: Array<WindowEndReading> = [start, end];

    const disagreeing: Array<WindowEndReading> = readings.filter(
      (reading: WindowEndReading): boolean => {
        return Boolean(reading.dayAsRead) && !reading.agrees;
      },
    );

    /*
     * A day that falls on its day in no zone was dated wrong: moved. A
     * window with such a day has the days it names, and every day of it
     * that disagrees is moved onto its day - in a schedule with a zone; in
     * one without, a day that could be read in another zone is left, as it
     * reads in that schedule's way.
     */
    const datedWrong: boolean = disagreeing.some(
      (reading: WindowEndReading): boolean => {
        return !reading.couldBeDatedInAnotherZone;
      },
    );

    const repaired: WeeklyResctriction = { ...window };
    let isChanged: boolean = false;

    for (const reading of readings) {
      if (!reading.dayAsRead) {
        // Left out, or no day at all: the day its time falls on.
        repaired[reading.dayKey] = reading.fallsOn!;
        isChanged = true;
        continue;
      }

      if (reading.agrees) {
        if (reading.day !== reading.dayAsRead) {
          // " monday": written as a day is written.
          repaired[reading.dayKey] = reading.dayAsRead;
          isChanged = true;
        }
        continue;
      }

      const isMoved: boolean =
        datedWrong && (Boolean(zone) || !reading.couldBeDatedInAnotherZone);

      if (isMoved) {
        repaired[reading.dayKey] = reading.dayAsRead;
        repaired[reading.timeKey] = WeeklyWindowDays.moveOntoDay(
          reading.moment!,
          reading.dayAsRead,
          zone,
        );
        isChanged = true;
      } else if (reading.day !== reading.dayAsRead) {
        repaired[reading.dayKey] = reading.dayAsRead;
        isChanged = true;
      }
    }

    let state: StoredWindowState = StoredWindowState.Agrees;

    if (datedWrong) {
      state = StoredWindowState.MovedOntoItsDays;
    } else if (disagreeing.length > 0 && zone) {
      state = StoredWindowState.ToCheck;
    } else if (isChanged) {
      state = StoredWindowState.DaysFilledIn;
    }

    return {
      state: state,
      window: isChanged ? repaired : window,
      isChanged: isChanged,
      start: start,
      end: end,
    };
  }

  // A stored restriction's windows read again (getStoredWindowRepair).
  public static getStoredWindowsRepair(
    restrictionTimes: RestrictionTimes,
    timezone?: string | null | undefined,
  ): StoredWindowsRepair {
    if (restrictionTimes.restrictionType !== RestrictionType.Weekly) {
      return {
        windows: restrictionTimes.weeklyRestrictionTimes || [],
        repairs: [],
        isChanged: false,
        pagesOtherwise: false,
      };
    }

    const repairs: Array<StoredWindowRepair> = (
      restrictionTimes.weeklyRestrictionTimes || []
    ).map((window: WeeklyResctriction): StoredWindowRepair => {
      return WeeklyWindowDays.getStoredWindowRepair(window, timezone);
    });

    return {
      windows: repairs.map((repair: StoredWindowRepair): WeeklyResctriction => {
        return repair.window;
      }),
      repairs: repairs,
      isChanged: repairs.some((repair: StoredWindowRepair): boolean => {
        return repair.isChanged;
      }),
      pagesOtherwise: repairs.some((repair: StoredWindowRepair): boolean => {
        return repair.state === StoredWindowState.MovedOntoItsDays;
      }),
    };
  }

  /*
   * The windows a person should look at: those whose times fall on other
   * days than they name - left as they page by the data migration, or not
   * read by it yet - with the days they name and the days they are on call.
   */
  public static getWindowsToCheck(
    restrictionTimes: RestrictionTimes | null | undefined,
    timezone?: string | null | undefined,
  ): Array<WindowToCheck> {
    if (
      !restrictionTimes ||
      restrictionTimes.restrictionType !== RestrictionType.Weekly
    ) {
      return [];
    }

    const toCheck: Array<WindowToCheck> = [];

    (restrictionTimes.weeklyRestrictionTimes || []).forEach(
      (window: WeeklyResctriction, index: number): void => {
        const repair: StoredWindowRepair =
          WeeklyWindowDays.getStoredWindowRepair(window, timezone);

        if (
          repair.state !== StoredWindowState.ToCheck &&
          repair.state !== StoredWindowState.MovedOntoItsDays
        ) {
          return;
        }

        toCheck.push({
          index: index,
          startDay: repair.start.dayAsRead,
          endDay: repair.end.dayAsRead,
          startsOn: repair.start.fallsOn!,
          endsOn: repair.end.fallsOn!,
        });
      },
    );

    return toCheck;
  }

  /*
   * A restriction with each window's days the days its times fall on, in
   * the zone they are shown in: what the Dashboard saves, so a window it
   * shows to be checked keeps paging as it does until a person picks other
   * days. A window that already agrees is the same object.
   */
  public static withDaysOfTheirTimes(
    restrictionTimes: RestrictionTimes,
    timezone?: string | null | undefined,
  ): RestrictionTimes {
    if (restrictionTimes.restrictionType !== RestrictionType.Weekly) {
      return restrictionTimes;
    }

    let isChanged: boolean = false;

    const windows: Array<WeeklyResctriction> = (
      restrictionTimes.weeklyRestrictionTimes || []
    ).map((window: WeeklyResctriction): WeeklyResctriction => {
      let stamped: WeeklyResctriction = window;

      for (const reading of WeeklyWindowDays.readEnds(window, timezone)) {
        if (reading.fallsOn && reading.day !== reading.fallsOn) {
          stamped = { ...stamped, [reading.dayKey]: reading.fallsOn };
          isChanged = true;
        }
      }

      return stamped;
    });

    if (!isChanged) {
      return restrictionTimes;
    }

    const stamped: RestrictionTimes = new RestrictionTimes();
    stamped.restrictionType = restrictionTimes.restrictionType;
    stamped.dayRestrictionTimes = restrictionTimes.dayRestrictionTimes;
    stamped.weeklyRestrictionTimes = windows;

    return stamped;
  }

  /*
   * A date and time on another zone's clock: the same date and time of day
   * in `toTimezone` as it reads in `fromTimezone` - a layer's rotation start
   * and first hand-off, when its schedule's zone changes. A time the new
   * zone's clock skips, the night it goes forward, is the first after it.
   */
  public static moveMomentToTimezone(
    date: Date,
    fromTimezone: string,
    toTimezone: string,
  ): Date {
    const from: moment.Moment = moment.tz(date, fromTimezone);

    return moment
      .tz(
        {
          year: from.year(),
          month: from.month(),
          date: from.date(),
          hour: from.hour(),
          minute: from.minute(),
          second: from.second(),
          millisecond: from.millisecond(),
        },
        toTimezone,
      )
      .toDate();
  }

  /*
   * A time of a window on another zone's clock: the same day of the week
   * and time of day in `toTimezone` as in `fromTimezone`. Only those count,
   * so where the new zone's clock skips that time on the window's date, a
   * date a week or two away is taken instead, and the time of day is kept.
   */
  public static moveWindowTimeToTimezone(
    date: Date,
    fromTimezone: string,
    toTimezone: string,
  ): Date {
    const day: DayOfWeek = WeeklyWindowDays.getDayOf(date, fromTimezone);
    const timeOfDay: number = getMillisecondOfDay(date, fromTimezone);

    let first: Date | null = null;

    for (const weeks of [0, 1, -1, 2, -2]) {
      const base: Date =
        weeks === 0
          ? date
          : OneUptimeDate.addRemoveDays(date, weeks * 7, fromTimezone);
      const candidate: Date = WeeklyWindowDays.moveMomentToTimezone(
        base,
        fromTimezone,
        toTimezone,
      );

      if (!first) {
        first = candidate;
      }

      if (
        WeeklyWindowDays.getDayOf(candidate, toTimezone) === day &&
        getMillisecondOfDay(candidate, toTimezone) === timeOfDay
      ) {
        return candidate;
      }
    }

    return first!;
  }

  /*
   * A layer's restriction on another zone's clock: every window keeps its
   * days and its hours (moveWindowTimeToTimezone). A time that is no date
   * and time is kept as it is.
   */
  public static moveWindowsToTimezone(
    restrictionTimes: RestrictionTimes,
    fromTimezone: string,
    toTimezone: string,
  ): RestrictionTimes {
    const move: (value: Date) => Date = (value: Date): Date => {
      const time: Date | null = RestrictionTimes.readMoment(value);

      return time
        ? WeeklyWindowDays.moveWindowTimeToTimezone(
            time,
            fromTimezone,
            toTimezone,
          )
        : value;
    };

    const moved: RestrictionTimes = new RestrictionTimes();
    moved.restrictionType = restrictionTimes.restrictionType;
    moved.dayRestrictionTimes = restrictionTimes.dayRestrictionTimes
      ? {
          startTime: move(restrictionTimes.dayRestrictionTimes.startTime),
          endTime: move(restrictionTimes.dayRestrictionTimes.endTime),
        }
      : null;
    moved.weeklyRestrictionTimes = (
      restrictionTimes.weeklyRestrictionTimes || []
    ).map((window: WeeklyResctriction): WeeklyResctriction => {
      return {
        ...window,
        startTime: move(window.startTime),
        endTime: move(window.endTime),
      };
    });

    return moved;
  }
}
