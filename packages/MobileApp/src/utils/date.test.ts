import { formatDateTime, formatRelativeTime } from "./date";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * These two functions are the only place a raw API timestamp turns into text,
 * and every card and detail screen in the app goes through one of them. They
 * are also handed whatever the server sent: `incident.declaredAt ||
 * incident.createdAt` is typed `string`, but a column the API omitted arrives
 * as undefined and a column it nulled arrives as null, and the type annotation
 * does nothing about either at runtime.
 *
 * The failure that matters here is not a crash. It is a responder reading
 * "NaNy ago" - or, worse, a confident "55y ago" - beside a live incident title,
 * with no way to tell that the app simply did not know when it started.
 */

/*
 * A frozen "now". formatRelativeTime reads Date.now(), so without this every
 * boundary below would be racing the wall clock: an input built to be exactly
 * 60 seconds old a millisecond before the call is 59 seconds old inside it, and
 * the test would fail roughly one run in a thousand on a loaded CI box for a
 * reason that has nothing to do with the code.
 */
const NOW_MS: number = Date.UTC(2024, 5, 15, 12, 0, 0);

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * What both functions fall back to when the timestamp is unusable. An em dash
 * is the conventional "no value here" mark: it cannot be misread as something
 * the server actually sent, unlike a number, and unlike an empty string it
 * leaves the clock icon beside it looking deliberate rather than broken.
 */
const NO_TIMESTAMP: string = "—";

/** An ISO string for the instant `millisAgo` before the frozen now. */
function isoAgo(millisAgo: number): string {
  return new Date(NOW_MS - millisAgo).toISOString();
}

/** An ISO string for the instant `millisAhead` after the frozen now. */
function isoAhead(millisAhead: number): string {
  return new Date(NOW_MS + millisAhead).toISOString();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW_MS);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("formatRelativeTime", () => {
  test("reads anything under a minute old as just now", () => {
    expect(formatRelativeTime(isoAgo(0))).toBe("just now");
    expect(formatRelativeTime(isoAgo(SECOND_MS))).toBe("just now");
    expect(formatRelativeTime(isoAgo(30 * SECOND_MS))).toBe("just now");
    expect(formatRelativeTime(isoAgo(59 * SECOND_MS))).toBe("just now");
    expect(formatRelativeTime(isoAgo(MINUTE_MS - 1))).toBe("just now");
  });

  test("crosses into minutes at exactly sixty seconds", () => {
    expect(formatRelativeTime(isoAgo(MINUTE_MS))).toBe("1m ago");
  });

  test("counts whole minutes, rounding down, to the last one before an hour", () => {
    expect(formatRelativeTime(isoAgo(90 * SECOND_MS))).toBe("1m ago");
    expect(formatRelativeTime(isoAgo(2 * MINUTE_MS))).toBe("2m ago");
    expect(formatRelativeTime(isoAgo(59 * MINUTE_MS))).toBe("59m ago");
    expect(formatRelativeTime(isoAgo(HOUR_MS - 1))).toBe("59m ago");
  });

  test("crosses into hours at exactly sixty minutes", () => {
    expect(formatRelativeTime(isoAgo(HOUR_MS))).toBe("1h ago");
  });

  test("counts whole hours to the last one before a day", () => {
    expect(formatRelativeTime(isoAgo(HOUR_MS + 59 * MINUTE_MS))).toBe("1h ago");
    expect(formatRelativeTime(isoAgo(23 * HOUR_MS))).toBe("23h ago");
    expect(formatRelativeTime(isoAgo(DAY_MS - 1))).toBe("23h ago");
  });

  test("crosses into days at exactly twenty-four hours", () => {
    expect(formatRelativeTime(isoAgo(DAY_MS))).toBe("1d ago");
  });

  test("counts whole days to the twenty-ninth", () => {
    expect(formatRelativeTime(isoAgo(DAY_MS + 23 * HOUR_MS))).toBe("1d ago");
    expect(formatRelativeTime(isoAgo(29 * DAY_MS))).toBe("29d ago");
    expect(formatRelativeTime(isoAgo(30 * DAY_MS - 1))).toBe("29d ago");
  });

  test("crosses into months at exactly thirty days", () => {
    expect(formatRelativeTime(isoAgo(30 * DAY_MS))).toBe("1mo ago");
  });

  test("treats a month as a flat thirty days, not a calendar month", () => {
    /*
     * Pinned rather than left implied. The eleventh month runs all the way to
     * 359 days and the year boundary lands on 360, not 365 - so anyone who
     * "corrects" this to calendar arithmetic moves both boundaries at once.
     * These assertions are what says that out loud.
     */
    expect(formatRelativeTime(isoAgo(11 * 30 * DAY_MS))).toBe("11mo ago");
    expect(formatRelativeTime(isoAgo(360 * DAY_MS - 1))).toBe("11mo ago");
  });

  test("crosses into years at twelve thirty-day months", () => {
    expect(formatRelativeTime(isoAgo(360 * DAY_MS))).toBe("1y ago");
    expect(formatRelativeTime(isoAgo(5 * 360 * DAY_MS))).toBe("5y ago");
  });

  test("reports a timestamp in the future as just now, deliberately", () => {
    /*
     * A future timestamp makes the elapsed time negative, which is still less
     * than 60, so it lands in the "just now" branch. That is the answer we
     * want, and it is a choice rather than an accident: every field fed to this
     * function - createdAt, declaredAt, startsAt - records something that has
     * already happened, so the only realistic way one lands in the future is
     * clock skew between the handset and the server. A few seconds of skew
     * should read as "just now". Counting forwards instead would put "in 3
     * hours" on an incident that is already paging someone, which is a far
     * worse thing to print than a slightly early "just now".
     */
    expect(formatRelativeTime(isoAhead(5 * SECOND_MS))).toBe("just now");
    expect(formatRelativeTime(isoAhead(10 * DAY_MS))).toBe("just now");
  });

  test.each([
    ["a string that is not a date at all", "not-a-date"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["an ISO string with out-of-range fields", "2024-13-45T99:99:99Z"],
    ["the word undefined, as a template literal would produce", "undefined"],
  ])(
    "renders %s as the placeholder rather than NaNy ago",
    (_label: string, input: string): void => {
      /*
       * Every comparison against NaN is false, so an unparseable date used to
       * fall through minutes, hours, days and months untouched and come out of
       * the years branch as the literal string "NaNy ago" - rendered straight
       * onto a card next to an incident title, where it reads like data.
       */
      expect(formatRelativeTime(input)).toBe(NO_TIMESTAMP);
    },
  );

  test.each([
    ["null", null],
    ["undefined", undefined],
  ])(
    "renders %s as the placeholder rather than an age measured from the epoch",
    (_label: string, input: string | null | undefined): void => {
      /*
       * null is the dangerous one, because it is not NaN. `new Date(null)` is
       * midnight on 1 January 1970, so the arithmetic runs to completion and
       * the card confidently reports a brand-new incident as being over half a
       * century old - a plausible-looking number that is entirely invented.
       */
      expect(formatRelativeTime(input as unknown as string)).toBe(NO_TIMESTAMP);
    },
  );

  test("never throws, whatever it is handed", () => {
    /*
     * The contract the cards depend on: this runs during render, so a throw
     * here is not a bad label, it is a blank screen where the on-call list
     * should be.
     */
    expect((): string => {
      return formatRelativeTime({} as unknown as string);
    }).not.toThrow();
  });
});

describe("formatDateTime", () => {
  test("renders a real timestamp as a dated, timed string", () => {
    const formatted: string = formatDateTime("2024-06-15T12:00:00.000Z");

    /*
     * Asserted this loosely on purpose. The exact text depends on the host's
     * locale AND its time zone - "Jun 15, 2024, 01:00 PM" in London, a
     * different calendar day entirely in Auckland - so pinning the literal
     * would fail the moment CI moved machines. For a midday-UTC instant the
     * year is the one component that is identical in every time zone on earth,
     * and it is enough to show real formatting happened.
     */
    expect(formatted).toContain("2024");
    expect(formatted).not.toBe("Invalid Date");
    expect(formatted).not.toBe(NO_TIMESTAMP);
  });

  test("formats the instant rather than the text, so two spellings of one moment agree", () => {
    /*
     * A locale-independent way to prove the offset is honoured: these are the
     * same instant written in two different time zones, so whatever the host
     * renders, it has to render both identically.
     */
    expect(formatDateTime("2024-06-15T12:00:00.000Z")).toBe(
      formatDateTime("2024-06-15T14:00:00.000+02:00"),
    );
  });

  test("includes the time of day, so two instants an hour apart do not collide", () => {
    expect(formatDateTime("2024-06-15T12:00:00.000Z")).not.toBe(
      formatDateTime("2024-06-15T13:00:00.000Z"),
    );
  });

  test.each([
    ["a string that is not a date at all", "not-a-date"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["an ISO string with out-of-range fields", "2024-13-45T99:99:99Z"],
  ])(
    "renders %s as the placeholder rather than the literal Invalid Date",
    (_label: string, input: string): void => {
      /*
       * toLocaleDateString on an invalid Date returns the string "Invalid
       * Date", which the detail screens print verbatim under a "Created"
       * heading. It looks like a value, and it tells the responder nothing.
       */
      expect(formatDateTime(input)).toBe(NO_TIMESTAMP);
    },
  );

  test.each([
    ["null", null],
    ["undefined", undefined],
  ])(
    "renders %s as the placeholder rather than a date in 1970",
    (_label: string, input: string | null | undefined): void => {
      expect(formatDateTime(input as unknown as string)).toBe(NO_TIMESTAMP);
      expect(formatDateTime(input as unknown as string)).not.toContain("1970");
    },
  );

  test("never throws, whatever it is handed", () => {
    expect((): string => {
      return formatDateTime({} as unknown as string);
    }).not.toThrow();
  });
});
