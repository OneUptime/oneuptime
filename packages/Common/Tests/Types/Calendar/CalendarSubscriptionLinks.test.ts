import CalendarSubscriptionLinks, {
  CalendarSubscriptionLinkSet,
  GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX,
  WEBCAL_SCHEME,
} from "../../../Types/Calendar/CalendarSubscriptionLinks";
import { describe, expect, test } from "@jest/globals";

/*
 * The subscribe links every calendar-feed surface hands out (the server's
 * FeedStatus, the Dashboard's buttons, the schedule-filtered personal link).
 *
 * The regression these pin: "Add to Google Calendar" opened
 * calendar.google.com/calendar/r?cid=https%3A%2F%2F... and Google answered
 * "Unable to add calendar. Check the URL." Google's add-by-URL link takes the
 * address in its webcal:// form; the https:// form only works when pasted
 * into "Other calendars > From URL". And the "Apple / other apps" link was
 * webcals://..., a scheme iOS does not open ("the address is invalid").
 */

const FEED: string =
  "https://oneuptime.example.com/api/on-call-calendar/user/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/shifts.ics";

const FILTERED_FEED: string = `${FEED}?schedule=33333333-3333-4333-8333-333333333333`;

describe("CalendarSubscriptionLinks.toWebcalUrl", () => {
  test.each([
    [FEED, FEED.replace("https://", "webcal://")],
    [
      "http://oneuptime.internal:3002/api/on-call-calendar/schedule/t/schedule.ics",
      "webcal://oneuptime.internal:3002/api/on-call-calendar/schedule/t/schedule.ics",
    ],
    [
      "webcals://oneuptime.example.com/a.ics",
      "webcal://oneuptime.example.com/a.ics",
    ],
    ["webcal://oneuptime.example.com/a.ics", "webcal://oneuptime.example.com/a.ics"],
    ["HTTPS://OneUptime.Example.com/A.ics", "webcal://OneUptime.Example.com/A.ics"],
  ])("%s -> %s", (input: string, expected: string) => {
    expect(CalendarSubscriptionLinks.toWebcalUrl(input)).toBe(expected);
  });

  test("never produces webcals://, the scheme iOS refuses to open", () => {
    for (const input of [
      FEED,
      FILTERED_FEED,
      "http://x.example/a.ics",
      "webcals://x.example/a.ics",
    ]) {
      const webcal: string = CalendarSubscriptionLinks.toWebcalUrl(input);

      expect(webcal.startsWith(WEBCAL_SCHEME)).toBe(true);
      expect(webcal.startsWith("webcals:")).toBe(false);
    }
  });

  test("keeps the query string, the port and the path exactly", () => {
    expect(
      CalendarSubscriptionLinks.toWebcalUrl(
        "https://oneuptime.example.com:8443/api/x/shifts.ics?schedule=abc&nocache=1",
      ),
    ).toBe(
      "webcal://oneuptime.example.com:8443/api/x/shifts.ics?schedule=abc&nocache=1",
    );
  });

  test("is a string rewrite: the WHATWG URL protocol setter would have left https:// in place", () => {
    /*
     * Why this module does not use URL: assigning a non-special scheme to a
     * URL with a special one is a silent no-op.
     */
    const url: URL = new URL(FEED);
    url.protocol = "webcal:";

    expect(url.toString().startsWith("https://")).toBe(true);
    expect(CalendarSubscriptionLinks.toWebcalUrl(FEED).startsWith("webcal://")).toBe(true);
  });

  test("anything that is not an http(s) or webcal(s) address is returned as it is", () => {
    for (const input of ["", "/api/on-call-calendar/x.ics", "ftp://x/a.ics", "mailto:a@b"]) {
      expect(CalendarSubscriptionLinks.toWebcalUrl(input)).toBe(input);
    }
  });

  test("surrounding whitespace is dropped", () => {
    expect(CalendarSubscriptionLinks.toWebcalUrl(`  ${FEED}\n`)).toBe(
      FEED.replace("https://", "webcal://"),
    );
  });
});

describe("CalendarSubscriptionLinks.buildGoogleCalendarUrl", () => {
  test("is Google's add-by-URL entry point", () => {
    expect(GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX).toBe(
      "https://calendar.google.com/calendar/r?cid=",
    );
    expect(
      CalendarSubscriptionLinks.buildGoogleCalendarUrl(FEED).startsWith(
        GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX,
      ),
    ).toBe(true);
  });

  test("cid carries the webcal:// form of the feed, never https:// (Google rejects that with 'Unable to add calendar')", () => {
    const link: string = CalendarSubscriptionLinks.buildGoogleCalendarUrl(FEED);
    const cid: string | null = new URL(link).searchParams.get("cid");

    expect(cid).toBe(FEED.replace("https://", "webcal://"));
    expect(cid!.startsWith("https:")).toBe(false);
    expect(cid!.startsWith("webcals:")).toBe(false);
  });

  test("the address is percent-encoded whole: Google's own URL has exactly one parameter", () => {
    const link: string =
      CalendarSubscriptionLinks.buildGoogleCalendarUrl(FILTERED_FEED);
    const parsed: URL = new URL(link);

    expect(Array.from(parsed.searchParams.keys())).toEqual(["cid"]);
    expect(parsed.origin).toBe("https://calendar.google.com");
    expect(parsed.pathname).toBe("/calendar/r");

    // The encoded value holds no raw separator Google could split on.
    const encoded: string = link.slice(GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX.length);

    for (const separator of ["/", ":", "?", "&", "=", "#"]) {
      expect(encoded).not.toContain(separator);
    }

    expect(encoded.startsWith("webcal%3A%2F%2F")).toBe(true);
  });

  test("the feed's query string survives the round trip intact (?schedule= on a personal link)", () => {
    const link: string =
      CalendarSubscriptionLinks.buildGoogleCalendarUrl(FILTERED_FEED);

    expect(new URL(link).searchParams.get("cid")).toBe(
      FILTERED_FEED.replace("https://", "webcal://"),
    );
    expect(CalendarSubscriptionLinks.readGoogleCalendarAddress(link)).toBe(
      FILTERED_FEED.replace("https://", "webcal://"),
    );
  });

  test("a token's URL-safe characters (- and _) come through unchanged", () => {
    const feed: string =
      "https://oneuptime.example.com/api/on-call-calendar/project/Ab-_cD0123456789abcdefghijklmnopqrstuvwxyzA/project.ics";

    expect(
      CalendarSubscriptionLinks.readGoogleCalendarAddress(
        CalendarSubscriptionLinks.buildGoogleCalendarUrl(feed),
      ),
    ).toBe(feed.replace("https://", "webcal://"));
  });

  test("a plain-http install still gets a webcal:// cid", () => {
    expect(
      CalendarSubscriptionLinks.readGoogleCalendarAddress(
        CalendarSubscriptionLinks.buildGoogleCalendarUrl(
          "http://oneuptime.internal/api/on-call-calendar/user/t/shifts.ics",
        ),
      ),
    ).toBe("webcal://oneuptime.internal/api/on-call-calendar/user/t/shifts.ics");
  });
});

describe("CalendarSubscriptionLinks.readGoogleCalendarAddress", () => {
  test("refuses links it did not build", () => {
    expect(
      CalendarSubscriptionLinks.readGoogleCalendarAddress(
        "https://example.com/?cid=webcal%3A%2F%2Fx",
      ),
    ).toBeNull();
    expect(
      CalendarSubscriptionLinks.readGoogleCalendarAddress(
        `${GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX}`,
      ),
    ).toBeNull();
    expect(
      CalendarSubscriptionLinks.readGoogleCalendarAddress(
        `${GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX}webcal%3A%2F%2Fx&ctz=UTC`,
      ),
    ).toBeNull();
    expect(
      CalendarSubscriptionLinks.readGoogleCalendarAddress(
        `${GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX}%E0%A4%A`,
      ),
    ).toBeNull();
  });
});

describe("CalendarSubscriptionLinks.build", () => {
  test("the three links of one feed, all from the same address", () => {
    const links: CalendarSubscriptionLinkSet =
      CalendarSubscriptionLinks.build(FILTERED_FEED);

    expect(links).toEqual({
      https: FILTERED_FEED,
      webcal: FILTERED_FEED.replace("https://", "webcal://"),
      googleAdd: `${GOOGLE_CALENDAR_SUBSCRIBE_URL_PREFIX}${encodeURIComponent(
        FILTERED_FEED.replace("https://", "webcal://"),
      )}`,
    });
  });

  test("the webcal and Google links differ from the https link only in how they carry it", () => {
    const links: CalendarSubscriptionLinkSet = CalendarSubscriptionLinks.build(FEED);

    expect(links.webcal.replace(WEBCAL_SCHEME, "https://")).toBe(links.https);
    expect(
      CalendarSubscriptionLinks.readGoogleCalendarAddress(links.googleAdd)!.replace(
        WEBCAL_SCHEME,
        "https://",
      ),
    ).toBe(links.https);
  });
});
