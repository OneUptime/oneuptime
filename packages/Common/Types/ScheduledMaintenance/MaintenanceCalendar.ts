import ICalendar, {
  ICalendarCalendar,
  ICalendarDocument,
  ICalendarEvent,
  ICalendarEventStatus,
  ICalendarTransparency,
} from "../Calendar/ICalendar";
import ScheduledMaintenanceStartUtil, {
  ScheduledMaintenancePhaseOfState,
  ScheduledMaintenanceTimelineRow,
} from "../../Utils/ScheduledMaintenanceStart";

/*
 * Scheduled maintenance events in a calendar app: the one place that decides
 * how an event looks there, whichever way it got there.
 *
 *   - The team's calendar link (Scheduled Maintenance > Events > Subscribe):
 *     every event of the project, each linked back to its Dashboard page.
 *   - A status page's calendar (Subscribe to calendar on its Scheduled
 *     Maintenance page): only the events that page shows, the resources by
 *     the names that page gives them, each linked back to the event on the
 *     page.
 *   - One event added from a status page (Add to calendar): the same event,
 *     the same UID, so a calendar that already holds it updates it rather than
 *     adding a second copy.
 *
 * Pure and deterministic: the same events always serialize to the same bytes
 * (no clock reads, a fixed order), which is what lets a feed's ETag and its
 * body cache work. The server decides WHICH events go in; this decides how
 * they read.
 *
 * Rules, each of them a decision:
 *
 *   - UID: scheduled-maintenance-<event id>@oneuptime. Stable for the life of
 *     the event, whatever is edited, so a moved or renamed event is updated in
 *     place in every calendar that holds it.
 *   - DTSTART / DTEND: the planned window, in UTC. The calendar app shows it
 *     in its reader's own zone. An event whose end is not after its start (an
 *     API write the form would refuse) lasts the form's default hour, so it
 *     still shows rather than being dropped by a strict client.
 *   - DTSTAMP and LAST-MODIFIED: when the event was last written; SEQUENCE:
 *     how many times it has been written since it was created (its row
 *     version). An unchanged event renders byte-identically; a moved or
 *     retitled one carries a higher SEQUENCE, which is what tells Outlook to
 *     replace its copy.
 *   - STATUS:CANCELLED for an event that was called off: it is over (Ended,
 *     Completed or a state of the project's own after them) without ever
 *     having been in progress. That is how a team cancels planned work in
 *     OneUptime, by closing it before it starts; the planned window then no
 *     longer stands, and the calendar says so instead of keeping a window
 *     nobody will work in. A deleted event, or one a status page stops
 *     showing, simply leaves the feed, which a subscribed calendar mirrors.
 *   - TRANSP:TRANSPARENT: a maintenance window never makes anyone look busy.
 *   - No VALARM (reminders are OneUptime's to send, to the people who asked
 *     for them), no RRULE (a recurring template creates real events, each its
 *     own), no CLASS, no ORGANIZER / ATTENDEE - as for the on-call feeds
 *     (Types/Calendar/ICalendar).
 *   - DESCRIPTION is plain text: what the event says (its Markdown read as
 *     text by the server, and cut at MAINTENANCE_CALENDAR_MAX_DESCRIPTION_
 *     LENGTH), then its status, what it affects and the link back. These few
 *     words are English, as the status page's RSS feed, emails and SMS are;
 *     the event's own words are as written.
 */

export enum MaintenanceCalendarAudience {
  // The project's team link: every event, linked to the Dashboard.
  Team = "team",
  // A status page's calendar: the events that page shows, linked to it.
  StatusPage = "status-page",
}

// The file name every maintenance calendar is served and downloaded as.
export const MAINTENANCE_CALENDAR_FILE_NAME: string = "maintenance.ics";

export const MAINTENANCE_CALENDAR_UID_DOMAIN: string = "oneuptime";

/*
 * How often a calendar app is asked to look again (REFRESH-INTERVAL and
 * X-PUBLISHED-TTL). Apps decide for themselves - Google Calendar every 12 to
 * 24 hours whatever this says - but Apple Calendar and Outlook honour it.
 */
export const MAINTENANCE_CALENDAR_REFRESH_INTERVAL: string = "PT1H";

// An event's own text is cut here, with an ellipsis: a calendar shows a paragraph, not a runbook.
export const MAINTENANCE_CALENDAR_MAX_DESCRIPTION_LENGTH: number = 2000;

// A title longer than this is cut, with an ellipsis.
export const MAINTENANCE_CALENDAR_MAX_SUMMARY_LENGTH: number = 200;

// Resources named in the "Affects" line before the rest are counted instead.
export const MAINTENANCE_CALENDAR_MAX_LISTED_NAMES: number = 20;

// How long an event without a later end is shown, as the form's default.
export const MAINTENANCE_CALENDAR_FALLBACK_DURATION_MS: number = 60 * 60 * 1000;

export const MAINTENANCE_CALENDAR_FALLBACK_TITLE: string =
  "Scheduled maintenance";

export const MAINTENANCE_CALENDAR_REFRESH_CAVEAT: string =
  "Calendar apps refresh subscribed calendars on their own schedule (Google Calendar every 12 to 24 hours), so a change can take a while to appear.";

export const MAINTENANCE_CALENDAR_CALLED_OFF_LINE: string =
  "This maintenance was called off.";

const ELLIPSIS: string = "…";

const WHITESPACE_RUN: RegExp = /\s+/g;

const BLANK_LINE_RUN: RegExp = /\n{3,}/g;

// "//" separates PRODID's fields, so a name cannot hold one.
const SLASH_RUN: RegExp = /\/{2,}/g;

export interface MaintenanceCalendarEventInput {
  id: string;
  title?: string | null | undefined;
  // Plain text: the server reads the event's Markdown as text first.
  description?: string | null | undefined;
  startsAt: Date;
  endsAt?: Date | null | undefined;
  // The event's state, by the name its reader knows it by.
  stateName?: string | null | undefined;
  // Over without ever having been in progress (isCalledOff).
  isCalledOff?: boolean | undefined;
  createdAt?: Date | null | undefined;
  updatedAt?: Date | null | undefined;
  // The row's version: 1 when created, one more on every write.
  version?: number | null | undefined;
  // What it affects, by the names its reader knows them by.
  affects?: Array<string> | undefined;
  // The status pages it is shown on (the team's calendar only).
  statusPages?: Array<string> | undefined;
  labels?: Array<string> | undefined;
  // Where the reader opens the event: the Dashboard, or the status page.
  url?: string | null | undefined;
}

export interface MaintenanceCalendarInput {
  audience: MaintenanceCalendarAudience;
  // The project's name (team) or the status page's (status page).
  name?: string | null | undefined;
  // PRODID, for example "-//OneUptime//Scheduled Maintenance//EN".
  productId: string;
  events: Array<MaintenanceCalendarEventInput>;
  /*
   * Why the calendar is empty on purpose (a link turned off, a status page
   * that is private): said in the calendar's description, and no event is
   * written whatever `events` holds.
   */
  emptyReason?: string | undefined;
  // More events fell in the window than a calendar takes; the oldest were left out.
  isTruncated?: boolean | undefined;
}

export const MAINTENANCE_CALENDAR_TRUNCATED_NOTE: string =
  "There are more events than one calendar can hold, so only the latest ones are listed.";

export default class MaintenanceCalendar {
  // scheduled-maintenance-<id>@oneuptime, the same in every calendar.
  public static getUid(eventId: string): string {
    return `scheduled-maintenance-${eventId.trim().toLowerCase()}@${MAINTENANCE_CALENDAR_UID_DOMAIN}`;
  }

  /*
   * PRODID for a product name: "-//<name>//Scheduled Maintenance//EN". The
   * server passes the name the installation goes by.
   */
  public static getProductId(productName: string): string {
    const name: string =
      MaintenanceCalendar.cleanLine(productName).replace(SLASH_RUN, "/") ||
      "OneUptime";

    return `-//${name}//Scheduled Maintenance//EN`;
  }

  // "<name> · Maintenance": what the calendar is called in the reader's app.
  public static getCalendarName(name: string | null | undefined): string {
    const cleaned: string = MaintenanceCalendar.cleanLine(name);

    return cleaned ? `${cleaned} · Maintenance` : "Scheduled maintenance";
  }

  public static getCalendarDescription(data: {
    audience: MaintenanceCalendarAudience;
    name?: string | null | undefined;
    notes?: Array<string> | undefined;
  }): string {
    const name: string = MaintenanceCalendar.cleanLine(data.name);

    const intro: string =
      data.audience === MaintenanceCalendarAudience.Team
        ? `Every scheduled maintenance event in ${name || "this project"}.`
        : `Scheduled maintenance on ${name || "this status page"}.`;

    const notes: Array<string> = (data.notes || [])
      .map((note: string): string => {
        return MaintenanceCalendar.cleanLine(note);
      })
      .filter((note: string): boolean => {
        return note !== "";
      });

    return [intro, MAINTENANCE_CALENDAR_REFRESH_CAVEAT, ...notes].join(" ");
  }

  // The event's title on one line, cut at MAINTENANCE_CALENDAR_MAX_SUMMARY_LENGTH.
  public static buildSummary(event: MaintenanceCalendarEventInput): string {
    const title: string = MaintenanceCalendar.cleanLine(event.title);

    if (!title) {
      return MAINTENANCE_CALENDAR_FALLBACK_TITLE;
    }

    return MaintenanceCalendar.cut(
      title,
      MAINTENANCE_CALENDAR_MAX_SUMMARY_LENGTH,
    );
  }

  /*
   * The event's text, then what a reader of this calendar needs beside it:
   *
   *   <the event's own text>
   *
   *   Status: Ongoing
   *   Affects: API, Website
   *   Status pages: Public status            (the team's calendar only)
   *   Details: https://...
   */
  public static buildDescription(
    event: MaintenanceCalendarEventInput,
    audience: MaintenanceCalendarAudience,
  ): string {
    const sections: Array<string> = [];

    if (event.isCalledOff) {
      sections.push(MAINTENANCE_CALENDAR_CALLED_OFF_LINE);
    }

    const text: string = MaintenanceCalendar.cleanParagraphs(event.description);

    if (text) {
      sections.push(
        MaintenanceCalendar.cut(
          text,
          MAINTENANCE_CALENDAR_MAX_DESCRIPTION_LENGTH,
        ),
      );
    }

    const facts: Array<string> = [];

    const stateName: string = MaintenanceCalendar.cleanLine(event.stateName);

    if (stateName) {
      facts.push(`Status: ${stateName}`);
    }

    const affects: string = MaintenanceCalendar.listNames(event.affects);

    if (affects) {
      facts.push(`Affects: ${affects}`);
    }

    if (audience === MaintenanceCalendarAudience.Team) {
      const statusPages: string = MaintenanceCalendar.listNames(
        event.statusPages,
      );

      if (statusPages) {
        facts.push(`Status pages: ${statusPages}`);
      }
    }

    const url: string = MaintenanceCalendar.cleanLine(event.url);

    if (url) {
      facts.push(`Details: ${url}`);
    }

    if (facts.length > 0) {
      sections.push(facts.join("\n"));
    }

    return sections.join("\n\n");
  }

  /*
   * The end a calendar is given: the event's own when it is after the start,
   * else the start plus the form's default hour.
   */
  public static getEnd(startsAt: Date, endsAt: Date | null | undefined): Date {
    if (
      endsAt instanceof Date &&
      !Number.isNaN(endsAt.getTime()) &&
      endsAt.getTime() > startsAt.getTime()
    ) {
      return endsAt;
    }

    return new Date(
      startsAt.getTime() + MAINTENANCE_CALENDAR_FALLBACK_DURATION_MS,
    );
  }

  // SEQUENCE: writes since the event was created (its version, less the create).
  public static getSequence(version: number | null | undefined): number {
    if (typeof version !== "number" || !Number.isFinite(version)) {
      return 0;
    }

    return Math.max(0, Math.floor(version) - 1);
  }

  public static toEvent(
    event: MaintenanceCalendarEventInput,
    audience: MaintenanceCalendarAudience,
  ): ICalendarEvent {
    const lastWrittenAt: Date =
      MaintenanceCalendar.toValidDate(event.updatedAt) ||
      MaintenanceCalendar.toValidDate(event.createdAt) ||
      event.startsAt;

    const calendarEvent: ICalendarEvent = {
      uid: MaintenanceCalendar.getUid(event.id),
      dtStamp: lastWrittenAt,
      lastModified: lastWrittenAt,
      sequence: MaintenanceCalendar.getSequence(event.version),
      start: event.startsAt,
      end: MaintenanceCalendar.getEnd(event.startsAt, event.endsAt),
      summary: MaintenanceCalendar.buildSummary(event),
      description: MaintenanceCalendar.buildDescription(event, audience),
      status: event.isCalledOff
        ? ICalendarEventStatus.Cancelled
        : ICalendarEventStatus.Confirmed,
      transparency: ICalendarTransparency.Transparent,
    };

    const url: string = MaintenanceCalendar.cleanLine(event.url);

    if (url) {
      calendarEvent.url = url;
    }

    const labels: Array<string> = MaintenanceCalendar.cleanNames(event.labels);

    if (labels.length > 0) {
      calendarEvent.categories = labels;
    }

    return calendarEvent;
  }

  public static buildDocument(
    input: MaintenanceCalendarInput,
  ): ICalendarDocument {
    const notes: Array<string> = [];

    if (input.emptyReason) {
      notes.push(input.emptyReason);
    } else if (input.isTruncated) {
      notes.push(MAINTENANCE_CALENDAR_TRUNCATED_NOTE);
    }

    const events: Array<MaintenanceCalendarEventInput> = input.emptyReason
      ? []
      : MaintenanceCalendar.sortEvents(
          input.events.filter(
            (event: MaintenanceCalendarEventInput): boolean => {
              return Boolean(
                event.id && MaintenanceCalendar.toValidDate(event.startsAt),
              );
            },
          ),
        );

    const calendar: ICalendarCalendar = {
      productId: input.productId,
      name: MaintenanceCalendar.getCalendarName(input.name),
      description: MaintenanceCalendar.getCalendarDescription({
        audience: input.audience,
        name: input.name,
        notes: notes,
      }),
      timezone: "UTC",
      refreshInterval: MAINTENANCE_CALENDAR_REFRESH_INTERVAL,
    };

    const lastModified: Date | null =
      MaintenanceCalendar.getLastModified(events);

    if (lastModified) {
      calendar.lastModified = lastModified;
    }

    return {
      calendar: calendar,
      events: events.map(
        (event: MaintenanceCalendarEventInput): ICalendarEvent => {
          return MaintenanceCalendar.toEvent(event, input.audience);
        },
      ),
    };
  }

  // The whole calendar as an iCalendar body.
  public static render(input: MaintenanceCalendarInput): string {
    return ICalendar.serialize(MaintenanceCalendar.buildDocument(input));
  }

  /*
   * Whether an event was called off: it is over - Ended, Completed, or a
   * state of the project's own after Ended - and no row of its state
   * timeline ever put it in progress. `timeline` is the event's own rows
   * (any order), `states` the project's states with their flags.
   */
  public static isCalledOff(data: {
    states: Array<unknown>;
    state: unknown;
    timeline: Array<ScheduledMaintenanceTimelineRow>;
  }): boolean {
    const phase: ScheduledMaintenancePhaseOfState | null =
      ScheduledMaintenanceStartUtil.getPhase({
        states: data.states,
        state: data.state,
      });

    if (phase !== ScheduledMaintenancePhaseOfState.Over) {
      return false;
    }

    return (
      ScheduledMaintenanceStartUtil.getStartRows({
        states: data.states,
        timeline: data.timeline,
      }).length === 0
    );
  }

  /*
   * Oldest first by start, then by UID: one order for equal inputs, so equal
   * inputs are equal bytes.
   */
  public static sortEvents(
    events: Array<MaintenanceCalendarEventInput>,
  ): Array<MaintenanceCalendarEventInput> {
    return [...events].sort(
      (
        a: MaintenanceCalendarEventInput,
        b: MaintenanceCalendarEventInput,
      ): number => {
        const byStart: number = a.startsAt.getTime() - b.startsAt.getTime();

        if (byStart !== 0) {
          return byStart;
        }

        const aUid: string = MaintenanceCalendar.getUid(a.id);
        const bUid: string = MaintenanceCalendar.getUid(b.id);

        if (aUid === bUid) {
          return 0;
        }

        return aUid < bUid ? -1 : 1;
      },
    );
  }

  // The latest write of any event, for the calendar's LAST-MODIFIED.
  public static getLastModified(
    events: Array<MaintenanceCalendarEventInput>,
  ): Date | null {
    let latest: Date | null = null;

    for (const event of events) {
      const written: Date | null =
        MaintenanceCalendar.toValidDate(event.updatedAt) ||
        MaintenanceCalendar.toValidDate(event.createdAt);

      if (written && (!latest || written.getTime() > latest.getTime())) {
        latest = written;
      }
    }

    return latest;
  }

  /*
   * Names for one line: trimmed, each once, in the order given, the ones past
   * MAINTENANCE_CALENDAR_MAX_LISTED_NAMES counted ("and 3 more").
   */
  public static listNames(names: Array<string> | undefined): string {
    const cleaned: Array<string> = MaintenanceCalendar.cleanNames(names);

    if (cleaned.length <= MAINTENANCE_CALENDAR_MAX_LISTED_NAMES) {
      return cleaned.join(", ");
    }

    const shown: Array<string> = cleaned.slice(
      0,
      MAINTENANCE_CALENDAR_MAX_LISTED_NAMES,
    );

    return `${shown.join(", ")} and ${cleaned.length - shown.length} more`;
  }

  // Each name on one line, empty ones dropped, each once.
  public static cleanNames(names: Array<string> | undefined): Array<string> {
    const seen: Set<string> = new Set<string>();
    const cleaned: Array<string> = [];

    for (const name of names || []) {
      const value: string = MaintenanceCalendar.cleanLine(name);

      if (!value || seen.has(value)) {
        continue;
      }

      seen.add(value);
      cleaned.push(value);
    }

    return cleaned;
  }

  // One line: every run of whitespace, line breaks included, one space.
  public static cleanLine(value: string | null | undefined): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.replace(WHITESPACE_RUN, " ").trim();
  }

  /*
   * Paragraphs kept, trailing spaces and runs of blank lines dropped. Line
   * endings are already "\n" for text the server read out of Markdown; a
   * stray "\r" is dropped too.
   */
  public static cleanParagraphs(value: string | null | undefined): string {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .split("\r")
      .join("")
      .split("\n")
      .map((line: string): string => {
        return line.trimEnd();
      })
      .join("\n")
      .replace(BLANK_LINE_RUN, "\n\n")
      .trim();
  }

  // Cut at `max` characters (whole code points), with an ellipsis.
  public static cut(value: string, max: number): string {
    const characters: Array<string> = Array.from(value);

    if (characters.length <= max) {
      return value;
    }

    return `${characters
      .slice(0, Math.max(0, max - 1))
      .join("")
      .trimEnd()}${ELLIPSIS}`;
  }

  private static toValidDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === "string" && value) {
      const parsed: Date = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  }
}
