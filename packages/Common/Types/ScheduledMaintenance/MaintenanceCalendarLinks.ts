import CalendarSubscriptionLinks, {
  CalendarSubscriptionLinkSet,
} from "../Calendar/CalendarSubscriptionLinks";
import ICalendar from "../Calendar/ICalendar";
import MaintenanceCalendar, {
  MAINTENANCE_CALENDAR_FILE_NAME,
} from "./MaintenanceCalendar";

/*
 * The addresses a status page hands out for its scheduled maintenance, as
 * the page itself builds them in the reader's browser:
 *
 *   - its calendar: <page>/maintenance.ics - "/maintenance.ics" on the page's
 *     own domain, "/status-page/<id>/maintenance.ics" on its address under
 *     OneUptime - which Subscribe to calendar turns into the Google Calendar
 *     and webcal:// links (CalendarSubscriptionLinks: Google's cid takes the
 *     webcal:// form, and the scheme is never webcals://);
 *   - one event as a file: the same address with ?event=<id>, which the
 *     server answers as a download of that event alone;
 *   - one event in Google Calendar: Google's "add event" page, filled in.
 *     Google Calendar on the web cannot open a downloaded .ics file, so its
 *     readers get the event this way instead.
 *
 * Pure: the page and the tests build the same addresses from one place, and
 * the server serves the paths named here (Frontend/Index.ts).
 */

// ?event=<id>: the one event, as a file to open in a calendar app.
export const MAINTENANCE_CALENDAR_EVENT_QUERY_PARAM: string = "event";

export const STATUS_PAGE_PREVIEW_PATH_PREFIX: string = "/status-page";

export const GOOGLE_CALENDAR_ADD_EVENT_URL: string =
  "https://calendar.google.com/calendar/render";

/*
 * Google reads the whole event from its address, and browsers and Google
 * itself cut addresses of several thousand characters short, so the details
 * are kept to a short paragraph.
 */
export const GOOGLE_CALENDAR_MAX_DETAILS_LENGTH: number = 1000;

export interface StatusPageCalendarAddress {
  /*
   * The page's own origin as the reader's browser has it, e.g.
   * "https://status.example.com" (no path).
   */
  origin: string;
  // Set when the page is read at /status-page/<id>, its address under OneUptime.
  statusPageId?: string | null | undefined;
  isPreview: boolean;
}

export interface GoogleCalendarEventInput {
  title?: string | null | undefined;
  startsAt: Date;
  endsAt?: Date | null | undefined;
  details?: string | null | undefined;
}

export default class MaintenanceCalendarLinks {
  /*
   * The calendar's path on the page: "/maintenance.ics" on the page's own
   * domain, "/status-page/<id>/maintenance.ics" on its address under
   * OneUptime.
   */
  public static getStatusPageCalendarPath(data: {
    statusPageId?: string | null | undefined;
    isPreview: boolean;
  }): string {
    const statusPageId: string = (data.statusPageId || "").trim();

    if (data.isPreview && statusPageId) {
      return `${STATUS_PAGE_PREVIEW_PATH_PREFIX}/${encodeURIComponent(
        statusPageId,
      )}/${MAINTENANCE_CALENDAR_FILE_NAME}`;
    }

    return `/${MAINTENANCE_CALENDAR_FILE_NAME}`;
  }

  // The calendar's address: the page's origin and the path above.
  public static getStatusPageCalendarUrl(
    address: StatusPageCalendarAddress,
  ): string {
    return `${MaintenanceCalendarLinks.trimOrigin(
      address.origin,
    )}${MaintenanceCalendarLinks.getStatusPageCalendarPath(address)}`;
  }

  // Every way to subscribe to the page's calendar (CalendarSubscriptionLinks).
  public static getStatusPageSubscriptionLinks(
    address: StatusPageCalendarAddress,
  ): CalendarSubscriptionLinkSet {
    return CalendarSubscriptionLinks.build(
      MaintenanceCalendarLinks.getStatusPageCalendarUrl(address),
    );
  }

  // One event of the page as a file: the calendar's address with ?event=<id>.
  public static getStatusPageEventFileUrl(
    address: StatusPageCalendarAddress & { eventId: string },
  ): string {
    return `${MaintenanceCalendarLinks.getStatusPageCalendarUrl(
      address,
    )}?${MAINTENANCE_CALENDAR_EVENT_QUERY_PARAM}=${encodeURIComponent(
      address.eventId.trim(),
    )}`;
  }

  /*
   * Google Calendar's "add event" page for one event, filled in: the title,
   * the window in UTC (Google shows it in its reader's zone) and a short
   * paragraph of details.
   */
  public static getGoogleCalendarEventUrl(
    event: GoogleCalendarEventInput,
  ): string {
    const end: Date = MaintenanceCalendar.getEnd(event.startsAt, event.endsAt);

    const parameters: Array<[string, string]> = [
      ["action", "TEMPLATE"],
      [
        "text",
        MaintenanceCalendar.buildSummary({
          id: "",
          title: event.title,
          startsAt: event.startsAt,
        }),
      ],
      [
        "dates",
        `${ICalendar.formatUtcDateTime(event.startsAt)}/${ICalendar.formatUtcDateTime(end)}`,
      ],
    ];

    const details: string = MaintenanceCalendar.cut(
      MaintenanceCalendar.cleanParagraphs(event.details),
      GOOGLE_CALENDAR_MAX_DETAILS_LENGTH,
    );

    if (details) {
      parameters.push(["details", details]);
    }

    return `${GOOGLE_CALENDAR_ADD_EVENT_URL}?${parameters
      .map(([name, value]: [string, string]): string => {
        return `${name}=${encodeURIComponent(value)}`;
      })
      .join("&")}`;
  }

  // The origin without the slashes a caller may end it with.
  private static trimOrigin(origin: string): string {
    let value: string = (origin || "").trim();

    while (value.endsWith("/")) {
      value = value.slice(0, -1);
    }

    return value;
  }
}
