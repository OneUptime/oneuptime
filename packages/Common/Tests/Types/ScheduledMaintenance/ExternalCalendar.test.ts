import {
  EXTERNAL_CALENDAR_DEFAULT_REFRESH_INTERVAL_IN_MINUTES,
  EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES,
  EXTERNAL_CALENDAR_MAX_LINK_LENGTH,
  EXTERNAL_CALENDAR_READ_ERRORS,
  EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES,
  EXTERNAL_CALENDAR_RETRY_AFTER_FAILURE_IN_MINUTES,
  ExternalCalendarLinkProblem,
  ExternalCalendarLinkResult,
  ExternalCalendarReadError,
  getExternalCalendarRefreshInterval,
  getNextExternalCalendarReadAt,
  isExternalCalendarReadError,
  normalizeExternalCalendarLink,
} from "../../../Types/ScheduledMaintenance/ExternalCalendar";
import { describe, expect, test } from "@jest/globals";

/*
 * What the Dashboard and the server share about calendars from outside the
 * project (issue #5084): what a link may be and how it is stored, how often
 * a calendar is read, and the reasons a read fails.
 */

describe("a calendar link", () => {
  test.each([
    [
      "an https link as it is",
      "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-0123/basic.ics",
      "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-0123/basic.ics",
      "calendar.google.com",
    ],
    [
      "an http link as it is",
      "http://exchange.corp.example/owa/calendar/abc/calendar.ics",
      "http://exchange.corp.example/owa/calendar/abc/calendar.ics",
      "exchange.corp.example",
    ],
    [
      "webcal:// as https://",
      "webcal://p52-caldav.icloud.com/published/2/MTIzNDU2",
      "https://p52-caldav.icloud.com/published/2/MTIzNDU2",
      "p52-caldav.icloud.com",
    ],
    [
      "WEBCALS:// as https://",
      "WEBCALS://calendar.example.com/holidays.ics",
      "https://calendar.example.com/holidays.ics",
      "calendar.example.com",
    ],
    [
      "trimmed, its fragment dropped",
      "  https://calendar.example.com/a.ics?token=xyz#top  ",
      "https://calendar.example.com/a.ics?token=xyz",
      "calendar.example.com",
    ],
    [
      "a port kept in the host",
      "https://calendar.example.com:8443/a.ics",
      "https://calendar.example.com:8443/a.ics",
      "calendar.example.com:8443",
    ],
    [
      "another OneUptime project's calendar link",
      "https://oneuptime.example.com/api/scheduled-maintenance-calendar/project/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd0/maintenance.ics",
      "https://oneuptime.example.com/api/scheduled-maintenance-calendar/project/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd0/maintenance.ics",
      "oneuptime.example.com",
    ],
  ])(
    "reads %s",
    (_name: string, input: string, url: string, host: string) => {
      expect(normalizeExternalCalendarLink(input)).toEqual({
        url: url,
        host: host,
      });
    },
  );

  test.each([
    ["nothing", "", ExternalCalendarLinkProblem.Empty],
    ["spaces", "   ", ExternalCalendarLinkProblem.Empty],
    ["undefined", undefined, ExternalCalendarLinkProblem.Empty],
    ["a word", "holidays", ExternalCalendarLinkProblem.NotALink],
    ["a path", "/calendar.ics", ExternalCalendarLinkProblem.NotALink],
    ["ftp", "ftp://example.com/a.ics", ExternalCalendarLinkProblem.NotHttp],
    ["a file", "file:///etc/passwd", ExternalCalendarLinkProblem.NotHttp],
    ["javascript", "javascript:alert(1)", ExternalCalendarLinkProblem.NotHttp],
    ["a data link", "data:text/calendar,BEGIN:VCALENDAR", ExternalCalendarLinkProblem.NotHttp],
    [
      "a link too long",
      `https://example.com/${"a".repeat(EXTERNAL_CALENDAR_MAX_LINK_LENGTH)}`,
      ExternalCalendarLinkProblem.TooLong,
    ],
  ])(
    "refuses %s, saying why",
    (
      _name: string,
      input: string | undefined,
      problem: ExternalCalendarLinkProblem,
    ) => {
      const result: ExternalCalendarLinkResult =
        normalizeExternalCalendarLink(input);

      expect(result).toEqual({ problem: problem });
      expect(EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES[problem]).toBeTruthy();
    },
  );

  test("every refusal has a sentence, and the length one names the limit", () => {
    for (const problem of Object.values(ExternalCalendarLinkProblem)) {
      expect(EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES[problem]).toMatch(/\.$/);
    }

    expect(
      EXTERNAL_CALENDAR_LINK_PROBLEM_MESSAGES[ExternalCalendarLinkProblem.TooLong],
    ).toContain("2,048");
  });
});

describe("how often a calendar is read", () => {
  test("the choices are 15 minutes to a day, an hour by default", () => {
    expect(EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES).toEqual([
      15, 30, 60, 360, 1440,
    ]);
    expect(EXTERNAL_CALENDAR_DEFAULT_REFRESH_INTERVAL_IN_MINUTES).toBe(60);
  });

  test.each([
    [15, 15],
    [60, 60],
    [1, 15],
    [16, 30],
    [61, 360],
    [1440, 1440],
    [99999, 1440],
    [-5, 15],
  ])("%s minutes reads as %s", (value: number, expected: number) => {
    expect(getExternalCalendarRefreshInterval(value)).toBe(expected);
  });

  test("a value that is not a number reads as an hour", () => {
    expect(getExternalCalendarRefreshInterval(undefined)).toBe(60);
    expect(getExternalCalendarRefreshInterval(null)).toBe(60);
    expect(getExternalCalendarRefreshInterval(Number.NaN)).toBe(60);
  });

  test("after a read that worked, the next one is one interval on", () => {
    const readAt: Date = new Date("2026-10-15T10:00:00.000Z");

    expect(
      getNextExternalCalendarReadAt({
        readAt: readAt,
        refreshIntervalInMinutes: 15,
        failed: false,
      }).toISOString(),
    ).toBe("2026-10-15T10:15:00.000Z");
  });

  test("after a read that failed, at least an hour on", () => {
    const readAt: Date = new Date("2026-10-15T10:00:00.000Z");

    expect(EXTERNAL_CALENDAR_RETRY_AFTER_FAILURE_IN_MINUTES).toBe(60);
    expect(
      getNextExternalCalendarReadAt({
        readAt: readAt,
        refreshIntervalInMinutes: 15,
        failed: true,
      }).toISOString(),
    ).toBe("2026-10-15T11:00:00.000Z");
    expect(
      getNextExternalCalendarReadAt({
        readAt: readAt,
        refreshIntervalInMinutes: 1440,
        failed: true,
      }).toISOString(),
    ).toBe("2026-10-16T10:00:00.000Z");
  });
});

describe("why a read failed", () => {
  test("is one of ten reasons, none of which is the link", () => {
    expect(EXTERNAL_CALENDAR_READ_ERRORS).toEqual([
      "NotFound",
      "AccessDenied",
      "ServerError",
      "Unreachable",
      "NotAllowed",
      "Timeout",
      "TooLarge",
      "TooManyRedirects",
      "NotACalendar",
      "TooComplex",
    ]);
  });

  test("isExternalCalendarReadError tells a stored reason from anything else", () => {
    expect(isExternalCalendarReadError(ExternalCalendarReadError.Timeout)).toBe(
      true,
    );
    expect(isExternalCalendarReadError("timeout")).toBe(false);
    expect(isExternalCalendarReadError(null)).toBe(false);
    expect(isExternalCalendarReadError(404)).toBe(false);
  });
});
