import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import Query from "Common/Types/BaseDatabase/Query";
import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import OneUptimeDate from "Common/Types/Date";
import MaintenanceCalendar from "Common/Types/ScheduledMaintenance/MaintenanceCalendar";
import { getNextFullHour } from "Common/Types/ScheduledMaintenance/MaintenanceWindow";
import StartAndEndTime from "Common/Types/Time/StartAndEndTime";

/*
 * The scheduled maintenance events as the Calendar view of Scheduled
 * Maintenance > Events draws them, worked out without React so it can be
 * tested on its own.
 *
 * react-big-calendar draws a Date at its BROWSER-local wall clock and knows
 * nothing of the reader's User Settings timezone, so - as the on-call
 * preview does (LayersPreview) - every instant is shifted into the reader's
 * zone before the grid sees it (getBrowserLocalDateFromWallClockInTimezone),
 * and every range the grid reports is shifted back into instants before it is
 * asked for (getInstantFromBrowserLocalWallClockInTimezone).
 */

// The most events one view asks for; the view says so when there are more.
export const MAINTENANCE_CALENDAR_VIEW_LIMIT: number = 500;

// The colour of an event whose state has none: gray-500.
export const MAINTENANCE_CALENDAR_FALLBACK_COLOR: string = "#6b7280";

export interface MaintenanceCalendarEvent extends CalendarEvent {
  // The event's id, for its page.
  maintenanceId: string;
  // Its state's name, for the tooltip and the screen reader.
  stateName: string;
}

/*
 * What the grid shows before it reports a range: react-big-calendar reports
 * none until the reader moves. The month of `displayDate` and the week
 * either side of it, which covers the days of the next and previous months
 * a month grid shows.
 */
export const getInitialMonthRange: (displayDate: Date) => StartAndEndTime = (
  displayDate: Date,
): StartAndEndTime => {
  const firstOfMonth: Date = new Date(
    displayDate.getFullYear(),
    displayDate.getMonth(),
    1,
  );
  const firstOfNextMonth: Date = new Date(
    displayDate.getFullYear(),
    displayDate.getMonth() + 1,
    1,
  );

  return {
    startTime: OneUptimeDate.addRemoveDays(firstOfMonth, -7),
    endTime: OneUptimeDate.addRemoveDays(firstOfNextMonth, 7),
  };
};

/*
 * The instants a range the grid reports covers: its display dates read as
 * wall clock in the reader's zone.
 */
export const toInstantRange: (data: {
  range: StartAndEndTime;
  timezone: string;
}) => StartAndEndTime = (data: {
  range: StartAndEndTime;
  timezone: string;
}): StartAndEndTime => {
  return {
    startTime: OneUptimeDate.getInstantFromBrowserLocalWallClockInTimezone(
      data.range.startTime,
      data.timezone,
    ),
    endTime: OneUptimeDate.getInstantFromBrowserLocalWallClockInTimezone(
      data.range.endTime,
      data.timezone,
    ),
  };
};

/*
 * The events whose window touches the range: they start before it ends and
 * end after it starts - an event that runs across the range's start is in
 * it too. Added to the page's own query (its project, the filter chips).
 */
export const getRangeQuery: (data: {
  baseQuery: Query<ScheduledMaintenance>;
  instants: StartAndEndTime;
}) => Query<ScheduledMaintenance> = (data: {
  baseQuery: Query<ScheduledMaintenance>;
  instants: StartAndEndTime;
}): Query<ScheduledMaintenance> => {
  return {
    ...data.baseQuery,
    startsAt: new LessThanOrEqual<Date>(data.instants.endTime),
    endsAt: new GreaterThanOrEqual<Date>(data.instants.startTime),
  } as Query<ScheduledMaintenance>;
};

/*
 * The events as the grid draws them: each in its state's colour, its window
 * in the reader's zone (an event that would end before it starts lasts the
 * form's default hour, as in the calendar feeds), and a tooltip with its
 * state and window. `describeWindow` writes the window in the reader's
 * words.
 */
export const toCalendarEvents: (data: {
  events: Array<ScheduledMaintenance>;
  timezone: string;
  describeWindow: (startsAt: Date, endsAt: Date) => string;
}) => Array<MaintenanceCalendarEvent> = (data: {
  events: Array<ScheduledMaintenance>;
  timezone: string;
  describeWindow: (startsAt: Date, endsAt: Date) => string;
}): Array<MaintenanceCalendarEvent> => {
  const calendarEvents: Array<MaintenanceCalendarEvent> = [];

  data.events.forEach((event: ScheduledMaintenance, index: number): void => {
    const maintenanceId: string | undefined =
      event.id?.toString() || event._id?.toString();

    if (!maintenanceId || !event.startsAt) {
      return;
    }

    const startsAt: Date = OneUptimeDate.fromString(event.startsAt);

    if (Number.isNaN(startsAt.getTime())) {
      return;
    }

    const endsAt: Date = MaintenanceCalendar.getEnd(
      startsAt,
      event.endsAt ? OneUptimeDate.fromString(event.endsAt) : null,
    );

    const title: string = MaintenanceCalendar.buildSummary({
      id: maintenanceId,
      title: event.title,
      startsAt: startsAt,
    });

    const stateName: string =
      event.currentScheduledMaintenanceState?.name?.toString() || "";

    const window: string = data.describeWindow(startsAt, endsAt);

    calendarEvents.push({
      id: index,
      maintenanceId: maintenanceId,
      stateName: stateName,
      title: title,
      start: OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
        startsAt,
        data.timezone,
      ),
      end: OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
        endsAt,
        data.timezone,
      ),
      color:
        event.currentScheduledMaintenanceState?.color?.toString() ||
        MAINTENANCE_CALENDAR_FALLBACK_COLOR,
      desc: [title, stateName ? `${stateName} · ${window}` : window].join("\n"),
    });
  });

  return calendarEvents;
};

/*
 * When a maintenance scheduled from a day of the month view starts: that day
 * at the hour the form would start a new event at (the next full hour of the
 * reader's clock), so it reads like scheduling one the usual way, on another
 * day. Null for a day already over: nothing is scheduled in the past from
 * here. `day` is the grid's date for the day (its browser-local midnight).
 */
export const getScheduleStartForDay: (data: {
  day: Date;
  timezone: string;
  now: Date;
}) => Date | null = (data: {
  day: Date;
  timezone: string;
  now: Date;
}): Date | null => {
  const nextFullHour: Date = getNextFullHour(data.now, data.timezone);

  // The next full hour as wall clock in the reader's zone, on the grid's terms.
  const nextFullHourOnGrid: Date =
    OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
      nextFullHour,
      data.timezone,
    );

  const onGrid: Date = new Date(
    data.day.getFullYear(),
    data.day.getMonth(),
    data.day.getDate(),
    nextFullHourOnGrid.getHours(),
    nextFullHourOnGrid.getMinutes(),
    0,
  );

  const startsAt: Date =
    OneUptimeDate.getInstantFromBrowserLocalWallClockInTimezone(
      onGrid,
      data.timezone,
    );

  if (startsAt.getTime() < nextFullHour.getTime()) {
    return null;
  }

  return startsAt;
};
