/*
 * Calendars from outside the project - public holidays, a change freeze kept
 * in Exchange, another project's maintenance calendar link - drawn on top of
 * the scheduled maintenance calendar (issue #5084). Each is an iCalendar
 * (.ics) link a project member adds on Scheduled Maintenance > Settings >
 * Calendar Settings, with a name and a colour.
 *
 * What both sides share lives here, free of server and React imports: the
 * Dashboard's forms and calendar, and the server that reads the links
 * (Server/Utils/ScheduledMaintenance/ExternalCalendar), use the same limits,
 * the same rules for a link and the same words for why a read failed.
 *
 *   - OneUptime reads each link itself, on a schedule, and keeps the events
 *     from EXTERNAL_CALENDAR_PAST_DAYS back to EXTERNAL_CALENDAR_FUTURE_DAYS
 *     ahead - the window the team's own calendar link serves - with repeating
 *     events (RRULE) and time zones (VTIMEZONE) worked out on the server.
 *   - The events are read-only, and never part of the project's own calendar
 *     links: two projects that show each other's link see each event once.
 *   - A link can be a secret (a calendar's private address), so it is stored
 *     encrypted and never read back: the page shows only the host it points
 *     at.
 */

// How many calendars one project may show on its maintenance calendar.
export const EXTERNAL_CALENDARS_PER_PROJECT: number = 20;

// The largest calendar file OneUptime reads: 5 MiB.
export const EXTERNAL_CALENDAR_MAX_BYTES: number = 5 * 1024 * 1024;

// How long one read of a link may take, from the first byte asked for to the last.
export const EXTERNAL_CALENDAR_FETCH_TIMEOUT_IN_MS: number = 20 * 1000;

/*
 * How many redirects a read follows. Each new address is checked the way the
 * first one was before anything is sent to it.
 */
export const EXTERNAL_CALENDAR_MAX_REDIRECTS: number = 3;

// The window of events OneUptime keeps, as the team's calendar link serves.
export const EXTERNAL_CALENDAR_PAST_DAYS: number = 90;
export const EXTERNAL_CALENDAR_FUTURE_DAYS: number = 365;

/*
 * The most events kept from one calendar: those nearest today, when a
 * calendar holds more in the window.
 */
export const EXTERNAL_CALENDAR_MAX_EVENTS: number = 2000;

// The most events from other calendars one view of the calendar asks for.
export const EXTERNAL_CALENDAR_VIEW_LIMIT: number = 500;

// The longest link OneUptime accepts.
export const EXTERNAL_CALENDAR_MAX_LINK_LENGTH: number = 2048;

// The longest event title kept; a longer one is cut.
export const EXTERNAL_CALENDAR_MAX_TITLE_LENGTH: number = 500;

// How often a link is read, in minutes: the choices the form offers.
export const EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES: ReadonlyArray<number> =
  [15, 30, 60, 360, 1440];

export const EXTERNAL_CALENDAR_DEFAULT_REFRESH_INTERVAL_IN_MINUTES: number = 60;

/*
 * After a read that failed, the next one waits at least this long: a link
 * that answers with something OneUptime cannot read rarely changes within
 * minutes, and is not asked again and again meanwhile.
 */
export const EXTERNAL_CALENDAR_RETRY_AFTER_FAILURE_IN_MINUTES: number = 60;

/*
 * Why the last read of a link failed. Stored on the calendar; the Dashboard
 * says each in the reader's language. None of them names the link itself.
 */
export enum ExternalCalendarReadError {
  // The address answered 404 or 410: there is no calendar there.
  NotFound = "NotFound",
  // It answered 401 or 403: the link needs a sign-in, or is no longer shared.
  AccessDenied = "AccessDenied",
  // It answered with another error (the status is kept beside it).
  ServerError = "ServerError",
  // It could not be reached: no such host, or nothing answered.
  Unreachable = "Unreachable",
  // The address is one OneUptime may not read (a private network, on OneUptime Cloud).
  NotAllowed = "NotAllowed",
  // It did not answer in time.
  Timeout = "Timeout",
  // The calendar is larger than EXTERNAL_CALENDAR_MAX_BYTES.
  TooLarge = "TooLarge",
  // It redirected more than EXTERNAL_CALENDAR_MAX_REDIRECTS times.
  TooManyRedirects = "TooManyRedirects",
  // It answered with something that is not an iCalendar file.
  NotACalendar = "NotACalendar",
  // The calendar took too long or too much memory to work out.
  TooComplex = "TooComplex",
}

export const EXTERNAL_CALENDAR_READ_ERRORS: ReadonlyArray<ExternalCalendarReadError> =
  Object.values(ExternalCalendarReadError);

export function isExternalCalendarReadError(
  value: unknown,
): value is ExternalCalendarReadError {
  return (
    typeof value === "string" &&
    (EXTERNAL_CALENDAR_READ_ERRORS as ReadonlyArray<string>).includes(value)
  );
}

// Why a link was refused before it was saved.
export enum ExternalCalendarLinkProblem {
  Empty = "Empty",
  TooLong = "TooLong",
  NotALink = "NotALink",
  NotHttp = "NotHttp",
}

export const EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES: Record<
  ExternalCalendarLinkProblem,
  string
> = {
  [ExternalCalendarLinkProblem.Empty]: "Enter the calendar's link.",
  [ExternalCalendarLinkProblem.TooLong]: `The link is longer than ${EXTERNAL_CALENDAR_MAX_LINK_LENGTH.toLocaleString("en-US")} characters.`,
  [ExternalCalendarLinkProblem.NotALink]:
    "This is not a link. Copy the calendar's iCalendar (.ics) address, starting with https:// or webcal://.",
  [ExternalCalendarLinkProblem.NotHttp]:
    "The link must start with https://, http:// or webcal://.",
};

export type ExternalCalendarLinkResult =
  | { url: string; host: string }
  | { problem: ExternalCalendarLinkProblem };

// The schemes a calendar app's subscribe link uses for an https:// address.
const WEBCAL_SCHEMES: ReadonlyArray<string> = ["webcal:", "webcals:"];

/*
 * The address OneUptime reads for a link someone pasted: trimmed, webcal://
 * (what "Subscribe to calendar" buttons hand out) read as https://, and only
 * http(s) to a named host accepted. Its fragment is dropped: it is never sent.
 */
export function normalizeExternalCalendarLink(
  value: string | null | undefined,
): ExternalCalendarLinkResult {
  const trimmed: string = (value || "").trim();

  if (!trimmed) {
    return { problem: ExternalCalendarLinkProblem.Empty };
  }

  if (trimmed.length > EXTERNAL_CALENDAR_MAX_LINK_LENGTH) {
    return { problem: ExternalCalendarLinkProblem.TooLong };
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return { problem: ExternalCalendarLinkProblem.NotALink };
  }

  if (WEBCAL_SCHEMES.includes(parsed.protocol.toLowerCase())) {
    try {
      parsed = new URL(`https:${trimmed.slice(trimmed.indexOf(":") + 1)}`);
    } catch {
      return { problem: ExternalCalendarLinkProblem.NotALink };
    }
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { problem: ExternalCalendarLinkProblem.NotHttp };
  }

  if (!parsed.hostname) {
    return { problem: ExternalCalendarLinkProblem.NotALink };
  }

  parsed.hash = "";

  return { url: parsed.toString(), host: parsed.host };
}

// When the next read of a calendar is due, after a read at `readAt`.
export function getNextExternalCalendarReadAt(data: {
  readAt: Date;
  refreshIntervalInMinutes: number | null | undefined;
  failed: boolean;
}): Date {
  const interval: number = getExternalCalendarRefreshInterval(
    data.refreshIntervalInMinutes,
  );

  const minutes: number = data.failed
    ? Math.max(interval, EXTERNAL_CALENDAR_RETRY_AFTER_FAILURE_IN_MINUTES)
    : interval;

  return new Date(data.readAt.getTime() + minutes * 60 * 1000);
}

/*
 * A calendar's refresh interval as one of the choices: a stored value that
 * is not one (written by hand through the API) reads as the nearest longer
 * choice, or the longest.
 */
export function getExternalCalendarRefreshInterval(
  value: number | null | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return EXTERNAL_CALENDAR_DEFAULT_REFRESH_INTERVAL_IN_MINUTES;
  }

  for (const choice of EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES) {
    if (value <= choice) {
      return choice;
    }
  }

  return EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES[
    EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES.length - 1
  ] as number;
}
