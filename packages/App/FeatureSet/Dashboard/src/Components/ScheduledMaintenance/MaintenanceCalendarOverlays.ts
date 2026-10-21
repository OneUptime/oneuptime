import ScheduledMaintenanceExternalCalendar from "Common/Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import ScheduledMaintenanceExternalCalendarEvent from "Common/Models/DatabaseModels/ScheduledMaintenanceExternalCalendarEvent";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import Query from "Common/Types/BaseDatabase/Query";
import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import OneUptimeDate from "Common/Types/Date";
import StartAndEndTime from "Common/Types/Time/StartAndEndTime";
import {
  EXTERNAL_CALENDAR_VIEW_LIMIT,
  ExternalCalendarReadError,
  isExternalCalendarReadError,
} from "Common/Types/ScheduledMaintenance/ExternalCalendar";

/*
 * The calendars from outside the project on the Maintenance Calendar, worked
 * out without React so it can be tested on its own (issue #5084).
 *
 * The page reads the project's enabled external calendars once, and for the
 * period the grid shows the events of those the reader has not hidden. Each
 * is drawn in its calendar's colour as an overlay block (CalendarEventTone):
 * nothing to open, just there to be seen beside the project's own events.
 *
 *   - A timed event is shifted into the reader's zone the way the project's
 *     own are (MaintenanceCalendarView), so a change freeze at 09:00 Berlin
 *     time sits at 03:00 for a reader in New York.
 *   - An all-day event - a public holiday - falls on the same dates for
 *     every reader: its dates are drawn as they are, never shifted.
 *   - Which calendars a reader has hidden is theirs, kept in their browser
 *     for the project. Browser storage can be missing or refuse access (a
 *     private window, blocked site data); then every calendar shows.
 */

// The most events from other calendars one period asks for.
export const MAINTENANCE_CALENDAR_OVERLAY_LIMIT: number =
  EXTERNAL_CALENDAR_VIEW_LIMIT;

// Overlay blocks' ids start here, clear of the project's own events' ids.
export const MAINTENANCE_CALENDAR_OVERLAY_ID_OFFSET: number = 1000000;

export const HIDDEN_EXTERNAL_CALENDARS_STORAGE_KEY_PREFIX: string =
  "oneuptime.maintenance-calendar.hidden-calendars.";

const MILLISECONDS_PER_DAY: number = 24 * 60 * 60 * 1000;

// The colour of a calendar that somehow has none: gray-500.
export const EXTERNAL_CALENDAR_FALLBACK_COLOR: string = "#6b7280";

// A calendar the page can show, as its reader sees it.
export interface OverlayCalendar {
  id: string;
  name: string;
  color: string;
  // Why its last read failed, when it did: its events are the last good ones.
  readError: ExternalCalendarReadError | null;
}

export interface MaintenanceCalendarOverlayEvent extends CalendarEvent {
  isOverlay: true;
  externalCalendarId: string;
  calendarName: string;
}

export function isOverlayEvent(
  event: CalendarEvent,
): event is MaintenanceCalendarOverlayEvent {
  return (event as MaintenanceCalendarOverlayEvent).isOverlay === true;
}

export function getHiddenCalendarsStorageKey(projectId: string): string {
  return `${HIDDEN_EXTERNAL_CALENDARS_STORAGE_KEY_PREFIX}${projectId}`;
}

type CalendarStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getStorage(
  storage: CalendarStorage | null | undefined,
): CalendarStorage | null {
  if (storage !== undefined) {
    return storage;
  }

  return typeof window !== "undefined" && window.localStorage
    ? window.localStorage
    : null;
}

// The calendars a reader has hidden in a project, by id.
export function readHiddenCalendarIds(
  projectId: string,
  storage?: CalendarStorage | null | undefined,
): Array<string> {
  try {
    const store: CalendarStorage | null = getStorage(storage);
    const stored: string | null = store
      ? store.getItem(getHiddenCalendarsStorageKey(projectId))
      : null;

    if (!stored) {
      return [];
    }

    const parsed: unknown = JSON.parse(stored);

    return Array.isArray(parsed)
      ? parsed.filter((id: unknown): id is string => {
          return typeof id === "string" && id.length > 0 && id.length <= 64;
        })
      : [];
  } catch {
    return [];
  }
}

export function writeHiddenCalendarIds(
  projectId: string,
  ids: Array<string>,
  storage?: CalendarStorage | null | undefined,
): void {
  try {
    const store: CalendarStorage | null = getStorage(storage);

    if (!store) {
      return;
    }

    const key: string = getHiddenCalendarsStorageKey(projectId);

    if (ids.length === 0) {
      store.removeItem(key);
      return;
    }

    store.setItem(key, JSON.stringify(Array.from(new Set(ids))));
  } catch {
    // Not remembered past this page; the choice still holds on it.
  }
}

// The hidden ids with one calendar shown or hidden.
export function toggleHiddenCalendar(
  hiddenIds: Array<string>,
  calendarId: string,
  isShown: boolean,
): Array<string> {
  const others: Array<string> = hiddenIds.filter((id: string) => {
    return id !== calendarId;
  });

  return isShown ? others : [...others, calendarId];
}

export function toOverlayCalendars(
  rows: Array<ScheduledMaintenanceExternalCalendar>,
): Array<OverlayCalendar> {
  const calendars: Array<OverlayCalendar> = [];

  for (const row of rows) {
    const id: string | undefined = row.id?.toString() || row._id?.toString();

    if (!id) {
      continue;
    }

    calendars.push({
      id: id,
      name: row.name?.toString() || "",
      color: row.color?.toString() || EXTERNAL_CALENDAR_FALLBACK_COLOR,
      readError: isExternalCalendarReadError(row.lastReadError)
        ? row.lastReadError
        : null,
    });
  }

  return calendars;
}

// The calendars to read events of: those the reader has not hidden.
export function getShownCalendarIds(
  calendars: Array<OverlayCalendar>,
  hiddenIds: Array<string>,
): Array<string> {
  return calendars
    .filter((calendar: OverlayCalendar) => {
      return !hiddenIds.includes(calendar.id);
    })
    .map((calendar: OverlayCalendar) => {
      return calendar.id;
    });
}

/*
 * The events of the shown calendars that touch the period: they start
 * before it ends and end after it starts. A day wider each side, for the
 * all-day events: those are drawn on their dates in every zone, a day either
 * side of where the period's instants fall.
 */
export function getOverlayRangeQuery(data: {
  calendarIds: Array<string>;
  instants: StartAndEndTime;
}): Query<ScheduledMaintenanceExternalCalendarEvent> {
  return {
    scheduledMaintenanceExternalCalendarId: new Includes(data.calendarIds),
    startsAt: new LessThanOrEqual<Date>(
      new Date(data.instants.endTime.getTime() + MILLISECONDS_PER_DAY),
    ),
    endsAt: new GreaterThanOrEqual<Date>(
      new Date(data.instants.startTime.getTime() - MILLISECONDS_PER_DAY),
    ),
  } as Query<ScheduledMaintenanceExternalCalendarEvent>;
}

// Midnight of a UTC date, as the same date on the reader's grid.
function toGridDate(date: Date): Date {
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/*
 * The events as the grid draws them: in their calendar's colour, an
 * all-day event on its dates, a timed one in the reader's zone, with a
 * tooltip of its title, its calendar and when it is. `describeWindow`,
 * `describeDays` and `untitled` are the reader's words.
 */
export function toOverlayEvents(data: {
  events: Array<ScheduledMaintenanceExternalCalendarEvent>;
  calendars: Array<OverlayCalendar>;
  timezone: string;
  describeWindow: (startsAt: Date, endsAt: Date) => string;
  // An all-day event's dates: its first day, and its last (the day before it ends).
  describeDays: (firstDay: Date, lastDay: Date) => string;
  // The title of an event with none, or one its calendar keeps private.
  untitled: string;
}): Array<MaintenanceCalendarOverlayEvent> {
  const calendarsById: Map<string, OverlayCalendar> = new Map();

  for (const calendar of data.calendars) {
    calendarsById.set(calendar.id, calendar);
  }

  const overlays: Array<MaintenanceCalendarOverlayEvent> = [];

  data.events.forEach(
    (event: ScheduledMaintenanceExternalCalendarEvent, index: number): void => {
      const calendarId: string | undefined =
        event.scheduledMaintenanceExternalCalendarId?.toString();
      const calendar: OverlayCalendar | undefined = calendarId
        ? calendarsById.get(calendarId)
        : undefined;

      if (!calendar || !event.startsAt || !event.endsAt) {
        return;
      }

      const startsAt: Date = OneUptimeDate.fromString(event.startsAt);
      let endsAt: Date = OneUptimeDate.fromString(event.endsAt);

      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        return;
      }

      if (endsAt.getTime() < startsAt.getTime()) {
        endsAt = startsAt;
      }

      const title: string = event.title?.toString().trim() || data.untitled;
      const isAllDay: boolean = event.isAllDay === true;

      let start: Date;
      let end: Date;
      let when: string;

      if (isAllDay) {
        start = toGridDate(startsAt);
        // An all-day event lasts whole days, at least one; its end is the day after.
        const lastDay: Date = toGridDate(
          new Date(
            Math.max(
              startsAt.getTime(),
              endsAt.getTime() - MILLISECONDS_PER_DAY,
            ),
          ),
        );
        end = new Date(
          lastDay.getFullYear(),
          lastDay.getMonth(),
          lastDay.getDate() + 1,
        );
        when = data.describeDays(start, lastDay);
      } else {
        start = OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
          startsAt,
          data.timezone,
        );
        end = OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
          endsAt,
          data.timezone,
        );
        when = data.describeWindow(startsAt, endsAt);
      }

      overlays.push({
        id: MAINTENANCE_CALENDAR_OVERLAY_ID_OFFSET + index,
        isOverlay: true,
        externalCalendarId: calendar.id,
        calendarName: calendar.name,
        title: title,
        start: start,
        end: end,
        allDay: isAllDay,
        color: calendar.color,
        appearance: "overlay",
        desc: [title, `${calendar.name} · ${when}`].join("\n"),
      });
    },
  );

  return overlays;
}
