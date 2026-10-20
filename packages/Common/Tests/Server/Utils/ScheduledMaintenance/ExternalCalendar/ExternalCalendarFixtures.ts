/*
 * Calendars as the servers people overlay write them, for the external
 * calendar suites: Exchange (a Windows time zone with its VTIMEZONE, weekly
 * meetings with an EXDATE and a moved occurrence), Google Calendar (all-day
 * holidays, X-WR-TIMEZONE), Apple (floating times), and plain builders for
 * everything else. Lines are joined with CRLF, as RFC 5545 says.
 */

export function calendar(
  lines: Array<string>,
  header: Array<string> = [],
): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OneUptime Tests//EN",
    ...header,
    ...lines,
    "END:VCALENDAR",
  ].join("\r\n");
}

export interface FixtureEvent {
  uid?: string | undefined;
  summary?: string | undefined;
  start: string;
  end?: string | undefined;
  extra?: Array<string> | undefined;
}

// One VEVENT; `start` and `end` are written after DTSTART / DTEND as they are.
export function event(data: FixtureEvent): Array<string> {
  return [
    "BEGIN:VEVENT",
    `UID:${data.uid || "event-1@tests.oneuptime.com"}`,
    ...(data.summary !== undefined ? [`SUMMARY:${data.summary}`] : []),
    `DTSTART${data.start}`,
    ...(data.end !== undefined ? [`DTEND${data.end}`] : []),
    ...(data.extra || []),
    "END:VEVENT",
  ];
}

/*
 * Central European Time as Exchange writes it: standard time from the last
 * Sunday of October at 03:00, summer time from the last Sunday of March at
 * 02:00. In 2026 summer time ends on 25 October.
 */
export const W_EUROPE_VTIMEZONE: Array<string> = [
  "BEGIN:VTIMEZONE",
  "TZID:W. Europe Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

/*
 * An Exchange change-freeze calendar: a weekly review on Mondays at 09:00
 * Berlin time, six times from 5 October 2026, the one of 12 October
 * cancelled (EXDATE), the one of 19 October moved to Tuesday 20 October at
 * 14:00 (RECURRENCE-ID), and a description, an attendee list and an inline
 * attachment no calendar overlay reads.
 */
export const EXCHANGE_CALENDAR: string = calendar([
  ...W_EUROPE_VTIMEZONE,
  ...event({
    uid: "040000008200E00074C5B7101A82E008000000004A3F",
    summary: "Change freeze review",
    start: ";TZID=W. Europe Standard Time:20261005T090000",
    end: ";TZID=W. Europe Standard Time:20261005T100000",
    extra: [
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6",
      "EXDATE;TZID=W. Europe Standard Time:20261012T090000",
      "DESCRIPTION:Review what may change this week.\\nBring the list.",
      "X-ALT-DESC;FMTTYPE=text/html:<html><body><p>Review</p></body></html>",
      "ATTENDEE;ROLE=REQ-PARTICIPANT;CN=Ops:mailto:ops@example.com",
      "ATTACH;FMTTYPE=application/pdf;ENCODING=BASE64;VALUE=BINARY:" +
        "QUJD".repeat(6000),
      "CLASS:PUBLIC",
      "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
    ],
  }),
  ...event({
    uid: "040000008200E00074C5B7101A82E008000000004A3F",
    summary: "Change freeze review (moved)",
    start: ";TZID=W. Europe Standard Time:20261020T140000",
    end: ";TZID=W. Europe Standard Time:20261020T150000",
    extra: ["RECURRENCE-ID;TZID=W. Europe Standard Time:20261019T090000"],
  }),
]);

// Google Calendar's public holidays: all-day dates, the calendar's own zone.
export const GOOGLE_HOLIDAYS_CALENDAR: string = calendar(
  [
    ...event({
      uid: "20261225_christmas@google.com",
      summary: "Christmas Day",
      start: ";VALUE=DATE:20261225",
      end: ";VALUE=DATE:20261226",
      extra: ["TRANSP:TRANSPARENT", "CLASS:PUBLIC"],
    }),
    ...event({
      uid: "20261226_boxing@google.com",
      summary: "Boxing Day",
      start: ";VALUE=DATE:20261226",
      end: ";VALUE=DATE:20261227",
      extra: ["TRANSP:TRANSPARENT"],
    }),
    ...event({
      uid: "20261231_nye@google.com",
      summary: "Company shutdown",
      start: ";VALUE=DATE:20261228",
      end: ";VALUE=DATE:20270102",
    }),
  ],
  [
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Holidays in United Kingdom",
    "X-WR-TIMEZONE:Europe/London",
  ],
);

// The clock every expansion test runs at: Thursday 15 October 2026, 10:20 UTC.
export const NOW: Date = new Date("2026-10-15T10:20:00.000Z");
