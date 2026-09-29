import BadDataException from "../Exception/BadDataException";

/*
 * Zero-dependency RFC 5545 (iCalendar) serializer for subscription feeds.
 *
 * Deliberate choices, recorded here because every one of them was a
 * decision, not an omission:
 *
 * - No METHOD. RFC 5546 (iTIP) would require ORGANIZER on a PUBLISH, and
 *   subscription feeds are not iTIP messages; Google, Apple and Outlook all
 *   treat a METHOD-less VCALENDAR as a plain calendar, which is what we are.
 * - DTSTAMP = the feed input's last-modified instant, not "now". Without
 *   METHOD, RFC 5545 §3.8.7.2 reads DTSTAMP as the last revision, and using
 *   it makes an unchanged schedule serialize to a byte-identical body so ETags
 *   and body caches work.
 * - No VTIMEZONE and no TZID. Every DTSTART/DTEND is an absolute UTC instant
 *   ("...Z"). The engine already resolves wall-clock rules into instants, the
 *   client converts to the viewer's zone, and shipping a VTIMEZONE database
 *   would lag IANA. Wall-clock renderings go in DESCRIPTION instead.
 * - No VALARM (reminders are delivered by OneUptime's own notification path so
 *   they honour the user's notification settings), no RRULE (shifts are
 *   materialised individually so overrides and rotations never desynchronise),
 *   no CLASS (Outlook maps CLASS:PRIVATE to Private sensitivity and Google to
 *   private visibility, which blanks a shared team calendar for everyone but
 *   its owner), no ORGANIZER/ATTENDEE.
 * - Both REFRESH-INTERVAL;VALUE=DURATION (RFC 7986) and X-PUBLISHED-TTL are
 *   emitted from the same duration: classic Outlook honours X-PUBLISHED-TTL
 *   when "Update Limit" is on and never refreshes a feed without it.
 * - Property order inside VCALENDAR and VEVENT is fixed so equal inputs give
 *   equal bytes.
 *
 * Wire format: CRLF line breaks, content lines folded at 75 octets on UTF-8
 * character boundaries (RFC 5545 §3.1), TEXT values escaped per §3.3.11.
 */

export const ICALENDAR_LINE_BREAK: string = "\r\n";

// RFC 5545 §3.1: lines SHOULD NOT be longer than 75 octets, excluding CRLF.
export const ICALENDAR_MAX_LINE_OCTETS: number = 75;

export const ICALENDAR_VERSION: string = "2.0";

export enum ICalendarEventStatus {
  Confirmed = "CONFIRMED",
  Tentative = "TENTATIVE",
  Cancelled = "CANCELLED",
}

export enum ICalendarTransparency {
  Transparent = "TRANSPARENT",
  Opaque = "OPAQUE",
}

export interface ICalendarCalendar {
  // PRODID, e.g. "-//OneUptime//On-Call Calendar Feed//EN".
  productId: string;
  // NAME (RFC 7986) — the full calendar name.
  name?: string | undefined;
  // X-WR-CALNAME — what most clients actually display; defaults to `name`.
  displayName?: string | undefined;
  // X-WR-CALDESC.
  description?: string | undefined;
  // X-WR-TIMEZONE, an IANA zone name.
  timezone?: string | undefined;
  // ISO 8601 duration ("PT1H") for REFRESH-INTERVAL and X-PUBLISHED-TTL.
  refreshInterval?: string | undefined;
  // Calendar-level LAST-MODIFIED (RFC 7986).
  lastModified?: Date | undefined;
}

export interface ICalendarEvent {
  uid: string;
  dtStamp: Date;
  start: Date;
  // Exclusive, like DTEND.
  end: Date;
  summary: string;
  description?: string | undefined;
  location?: string | undefined;
  url?: string | undefined;
  lastModified?: Date | undefined;
  // Non-negative integer; bumps tell clients the event was revised.
  sequence?: number | undefined;
  status?: ICalendarEventStatus | undefined;
  transparency?: ICalendarTransparency | undefined;
  categories?: Array<string> | undefined;
}

export interface ICalendarDocument {
  calendar: ICalendarCalendar;
  events: Array<ICalendarEvent>;
}

const ISO_8601_DURATION_REGEX: RegExp =
  /^P(?:\d+W|(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?)$/;

// RFC 5545 §3.2: a parameter value holding any of these must be quoted.
const RESERVED_PARAMETER_CHARACTERS: RegExp = /[;:,]/;

export default class ICalendar {
  public static serialize(document: ICalendarDocument): string {
    const lines: Array<string> = [];

    lines.push("BEGIN:VCALENDAR");
    lines.push(`VERSION:${ICALENDAR_VERSION}`);
    lines.push(ICalendar.contentLine("PRODID", document.calendar.productId));
    lines.push("CALSCALE:GREGORIAN");

    const calendar: ICalendarCalendar = document.calendar;

    if (calendar.name !== undefined && calendar.name !== "") {
      lines.push(ICalendar.textLine("NAME", calendar.name));
    }

    const displayName: string | undefined =
      calendar.displayName !== undefined && calendar.displayName !== ""
        ? calendar.displayName
        : calendar.name;

    if (displayName !== undefined && displayName !== "") {
      lines.push(ICalendar.textLine("X-WR-CALNAME", displayName));
    }

    if (calendar.description !== undefined && calendar.description !== "") {
      lines.push(ICalendar.textLine("X-WR-CALDESC", calendar.description));
    }

    if (calendar.timezone !== undefined && calendar.timezone !== "") {
      lines.push(ICalendar.textLine("X-WR-TIMEZONE", calendar.timezone));
    }

    if (calendar.refreshInterval !== undefined) {
      const duration: string = ICalendar.validateDuration(
        calendar.refreshInterval,
      );
      lines.push(
        ICalendar.contentLine("REFRESH-INTERVAL", duration, {
          VALUE: "DURATION",
        }),
      );
      lines.push(ICalendar.contentLine("X-PUBLISHED-TTL", duration));
    }

    if (calendar.lastModified !== undefined) {
      lines.push(
        ICalendar.contentLine(
          "LAST-MODIFIED",
          ICalendar.formatUtcDateTime(calendar.lastModified),
        ),
      );
    }

    for (const event of document.events) {
      lines.push(...ICalendar.serializeEvent(event));
    }

    lines.push("END:VCALENDAR");

    return (
      lines
        .map((line: string) => {
          return ICalendar.foldLine(line);
        })
        .join(ICALENDAR_LINE_BREAK) + ICALENDAR_LINE_BREAK
    );
  }

  /*
   * The unfolded content lines of one VEVENT, in the fixed order. Exposed so
   * tests and callers can inspect a single event without a whole document.
   */
  public static serializeEvent(event: ICalendarEvent): Array<string> {
    if (!event.uid || event.uid.trim() === "") {
      throw new BadDataException("iCalendar event UID must not be empty");
    }

    if (event.end.getTime() <= event.start.getTime()) {
      throw new BadDataException(
        `iCalendar event ${event.uid} must end after it starts`,
      );
    }

    const lines: Array<string> = [];

    lines.push("BEGIN:VEVENT");
    lines.push(ICalendar.textLine("UID", event.uid));
    lines.push(
      ICalendar.contentLine(
        "DTSTAMP",
        ICalendar.formatUtcDateTime(event.dtStamp),
      ),
    );

    if (event.lastModified !== undefined) {
      lines.push(
        ICalendar.contentLine(
          "LAST-MODIFIED",
          ICalendar.formatUtcDateTime(event.lastModified),
        ),
      );
    }

    if (event.sequence !== undefined) {
      lines.push(
        ICalendar.contentLine(
          "SEQUENCE",
          String(ICalendar.validateSequence(event.sequence)),
        ),
      );
    }

    lines.push(
      ICalendar.contentLine(
        "DTSTART",
        ICalendar.formatUtcDateTime(event.start),
      ),
    );
    lines.push(
      ICalendar.contentLine("DTEND", ICalendar.formatUtcDateTime(event.end)),
    );
    lines.push(ICalendar.textLine("SUMMARY", event.summary));

    if (event.description !== undefined && event.description !== "") {
      lines.push(ICalendar.textLine("DESCRIPTION", event.description));
    }

    if (event.location !== undefined && event.location !== "") {
      lines.push(ICalendar.textLine("LOCATION", event.location));
    }

    if (event.url !== undefined && event.url !== "") {
      // URI value type: not TEXT-escaped, but never allowed to break the line.
      lines.push(
        ICalendar.contentLine("URL", ICalendar.stripLineBreaks(event.url)),
      );
    }

    if (event.status !== undefined) {
      lines.push(ICalendar.contentLine("STATUS", event.status));
    }

    if (event.transparency !== undefined) {
      lines.push(ICalendar.contentLine("TRANSP", event.transparency));
    }

    if (event.categories !== undefined && event.categories.length > 0) {
      lines.push(
        ICalendar.contentLine(
          "CATEGORIES",
          event.categories
            .map((category: string) => {
              return ICalendar.escapeText(category);
            })
            .join(","),
        ),
      );
    }

    lines.push("END:VEVENT");

    return lines;
  }

  /*
   * RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon and comma are
   * escaped; a newline becomes the two characters "\n"; carriage returns and
   * other control characters (which TEXT may not contain) are dropped.
   */
  public static escapeText(text: string): string {
    let result: string = "";

    for (const char of text) {
      if (char === "\\") {
        result += "\\\\";
      } else if (char === ";") {
        result += "\\;";
      } else if (char === ",") {
        result += "\\,";
      } else if (char === "\n") {
        result += "\\n";
      } else if (char === "\t") {
        result += char;
      } else if (ICalendar.isControlCharacter(char)) {
        continue;
      } else {
        result += char;
      }
    }

    return result;
  }

  // "YYYYMMDDTHHMMSSZ" — RFC 5545 §3.3.5 form #2, UTC.
  public static formatUtcDateTime(date: Date): string {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new BadDataException("iCalendar date is not a valid Date");
    }

    const pad: (value: number) => string = (value: number): string => {
      return value < 10 ? `0${value}` : String(value);
    };

    return (
      `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
      `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
    );
  }

  /*
   * Fold one logical content line at 75 octets (RFC 5545 §3.1). The
   * continuation lines start with a single space that counts toward their
   * own 75-octet budget. Never splits inside a UTF-8 multi-byte sequence:
   * the walk is per code point and each code point's octet length is known.
   */
  public static foldLine(line: string): string {
    if (ICalendar.getUtf8OctetLength(line) <= ICALENDAR_MAX_LINE_OCTETS) {
      return line;
    }

    const pieces: Array<string> = [];
    let current: string = "";
    let currentOctets: number = 0;
    // The first physical line has the full budget; continuations lose one to the leading space.
    let budget: number = ICALENDAR_MAX_LINE_OCTETS;

    for (const char of line) {
      const octets: number = ICalendar.getUtf8OctetLength(char);

      if (currentOctets + octets > budget) {
        pieces.push(current);
        current = "";
        currentOctets = 0;
        budget = ICALENDAR_MAX_LINE_OCTETS - 1;
      }

      current += char;
      currentOctets += octets;
    }

    if (current !== "") {
      pieces.push(current);
    }

    return pieces.join(`${ICALENDAR_LINE_BREAK} `);
  }

  // Reverse of foldLine, for tests and readers: joins continuation lines.
  public static unfold(body: string): string {
    return body.replace(/\r\n[ \t]/g, "");
  }

  public static getUtf8OctetLength(text: string): number {
    let octets: number = 0;

    for (const char of text) {
      const codePoint: number = char.codePointAt(0) ?? 0;

      if (codePoint < 0x80) {
        octets += 1;
      } else if (codePoint < 0x800) {
        octets += 2;
      } else if (codePoint < 0x10000) {
        octets += 3;
      } else {
        octets += 4;
      }
    }

    return octets;
  }

  /*
   * "NAME;PARAM=value:value" with the value used verbatim (callers escape
   * TEXT values themselves or use textLine). Parameter values that contain
   * characters RFC 5545 §3.2 reserves are quoted; double quotes inside them
   * are dropped because there is no way to escape them.
   */
  public static contentLine(
    name: string,
    value: string,
    parameters?: Record<string, string> | undefined,
  ): string {
    let line: string = name.toUpperCase();

    if (parameters) {
      for (const parameterName of Object.keys(parameters)) {
        const rawValue: string = (parameters[parameterName] ?? "").replace(
          /"/g,
          "",
        );
        const needsQuotes: boolean =
          RESERVED_PARAMETER_CHARACTERS.test(rawValue);
        line += `;${parameterName.toUpperCase()}=${
          needsQuotes ? `"${rawValue}"` : rawValue
        }`;
      }
    }

    return `${line}:${ICalendar.stripLineBreaks(value)}`;
  }

  // A TEXT property: the value is escaped per §3.3.11.
  public static textLine(name: string, value: string): string {
    return ICalendar.contentLine(name, ICalendar.escapeText(value));
  }

  private static validateDuration(duration: string): string {
    const trimmed: string = duration.trim().toUpperCase();

    if (
      !ISO_8601_DURATION_REGEX.test(trimmed) ||
      trimmed === "P" ||
      trimmed === "PT"
    ) {
      throw new BadDataException(
        `iCalendar refresh interval must be an ISO 8601 duration, got "${duration}"`,
      );
    }

    return trimmed;
  }

  private static validateSequence(sequence: number): number {
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new BadDataException(
        `iCalendar SEQUENCE must be a non-negative integer, got ${sequence}`,
      );
    }

    return sequence;
  }

  private static isControlCharacter(char: string): boolean {
    const codePoint: number = char.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  }

  // Line breaks can never appear inside a content line, whatever the value type.
  private static stripLineBreaks(value: string): string {
    return value.replace(/[\r\n]+/g, "");
  }
}
