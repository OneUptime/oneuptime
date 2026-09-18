import { describe, expect, test } from "@jest/globals";
import {
  buildFeedLinks,
  describeFetchStatus,
  looksUnreachable,
  parseAbsoluteUrl,
  toGoogleAddUrl,
  toWebcalUrl,
  type FeedLinks,
} from "./calendarFeedLinks";
import type { OnCallCalendarFeedStatus } from "../api/types";

/*
 * The link the phone shows is rebuilt around the address the app reaches the
 * server on. Get that wrong in either direction and the user subscribes to a
 * URL that resolves nowhere: keep the server's localhost link on an install
 * with HOST unset, or replace a perfectly good public link with a VPN-only
 * one without saying so.
 */

const NOW: number = new Date("2026-03-03T12:00:00.000Z").getTime();

const SERVER_HTTPS: string =
  "https://oneuptime.example.com/api/on-call-calendar/user/abcDEF123_-xyz/shifts.ics";

function status(
  overrides: Partial<OnCallCalendarFeedStatus> = {},
): OnCallCalendarFeedStatus {
  return {
    exists: true,
    feedId: "feed-1",
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "k3Qx",
    rotatedAt: "2026-03-01T10:00:00.000Z",
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: { pastDays: 2, futureDays: 90 },
    urls: {
      https: SERVER_HTTPS,
      webcal: SERVER_HTTPS.replace("https://", "webcals://"),
      googleAdd: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
        SERVER_HTTPS,
      )}`,
    },
    hostWarning: null,
    protocolWarning: null,
    ...overrides,
  };
}

describe("parseAbsoluteUrl", () => {
  test("splits scheme, host and the path with its query", () => {
    expect(
      parseAbsoluteUrl("https://Host.Example.com:8443/a/b.ics?schedule=1"),
    ).toEqual({
      scheme: "https",
      host: "Host.Example.com:8443",
      pathAndQuery: "/a/b.ics?schedule=1",
    });
  });

  test("reads a bare origin as the root path", () => {
    expect(parseAbsoluteUrl("http://localhost:3000")).toEqual({
      scheme: "http",
      host: "localhost:3000",
      pathAndQuery: "/",
    });
  });

  test("understands webcal schemes", () => {
    expect(parseAbsoluteUrl("webcals://h/x.ics")?.scheme).toBe("webcals");
  });

  test("rejects anything that is not an absolute URL", () => {
    expect(parseAbsoluteUrl("/relative/path")).toBeNull();
    expect(parseAbsoluteUrl("not a url")).toBeNull();
    expect(parseAbsoluteUrl("")).toBeNull();
  });
});

describe("toWebcalUrl / toGoogleAddUrl", () => {
  test("https becomes webcals, http becomes webcal", () => {
    expect(toWebcalUrl("https://h/x.ics")).toBe("webcals://h/x.ics");
    expect(toWebcalUrl("http://h/x.ics")).toBe("webcal://h/x.ics");
  });

  test("the Google link carries the https URL, encoded", () => {
    expect(toGoogleAddUrl("https://h/x.ics?a=1")).toBe(
      "https://calendar.google.com/calendar/r?cid=https%3A%2F%2Fh%2Fx.ics%3Fa%3D1",
    );
  });
});

describe("buildFeedLinks", () => {
  test("returns null when the feed has no links", () => {
    expect(
      buildFeedLinks("https://oneuptime.example.com", status({ urls: null })),
    ).toBeNull();
  });

  test("keeps the server's link verbatim when the app uses the same host", () => {
    const links: FeedLinks | null = buildFeedLinks(
      "https://oneuptime.example.com",
      status(),
    );

    expect(links).not.toBeNull();
    expect(links!.https).toBe(SERVER_HTTPS);
    expect(links!.webcal).toBe(SERVER_HTTPS.replace("https://", "webcals://"));
    expect(links!.differsFromServer).toBe(false);
    expect(links!.serverHost).toBe("oneuptime.example.com");
  });

  test("host comparison is case-insensitive", () => {
    const links: FeedLinks | null = buildFeedLinks(
      "https://ONEUPTIME.example.com",
      status(),
    );

    expect(links!.differsFromServer).toBe(false);
  });

  test("rebuilds the link around the app's server address when it differs", () => {
    /*
     * The VPN / split-DNS case: the server's HOST is a public name the phone
     * cannot resolve from inside the office network, or vice versa.
     */
    const links: FeedLinks | null = buildFeedLinks(
      "https://oncall.internal:8443/",
      status(),
    );

    expect(links!.https).toBe(
      "https://oncall.internal:8443/api/on-call-calendar/user/abcDEF123_-xyz/shifts.ics",
    );
    expect(links!.webcal).toBe(
      "webcals://oncall.internal:8443/api/on-call-calendar/user/abcDEF123_-xyz/shifts.ics",
    );
    expect(links!.googleAdd).toBe(
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
        links!.https,
      )}`,
    );
    expect(links!.serverHttps).toBe(SERVER_HTTPS);
    expect(links!.differsFromServer).toBe(true);
    expect(links!.serverHost).toBe("oneuptime.example.com");
  });

  test("a plain-http app server yields webcal://, not webcals://", () => {
    const links: FeedLinks | null = buildFeedLinks(
      "http://10.0.0.5:3002",
      status(),
    );

    expect(links!.https).toBe(
      "http://10.0.0.5:3002/api/on-call-calendar/user/abcDEF123_-xyz/shifts.ics",
    );
    expect(links!.webcal.startsWith("webcal://10.0.0.5:3002/")).toBe(true);
  });

  test("the server's localhost link is replaced by the address the phone uses", () => {
    /*
     * HOST unset: the server built "https://localhost/...". The phone has an
     * address that demonstrably works - it is signed in through it.
     */
    const links: FeedLinks | null = buildFeedLinks(
      "https://oneuptime.example.com",
      status({
        urls: {
          https: "http://localhost/api/on-call-calendar/user/t/shifts.ics",
          webcal: "webcal://localhost/api/on-call-calendar/user/t/shifts.ics",
          googleAdd: "",
        },
        hostWarning: "Set HOST to your public hostname",
      }),
    );

    expect(links!.https).toBe(
      "https://oneuptime.example.com/api/on-call-calendar/user/t/shifts.ics",
    );
    expect(links!.differsFromServer).toBe(true);
    expect(links!.serverHost).toBe("localhost");
  });

  test("keeps the query string (a ?schedule= filter) on the rebuilt link", () => {
    const links: FeedLinks | null = buildFeedLinks(
      "https://other.example.com",
      status({
        urls: {
          https: `${SERVER_HTTPS}?schedule=abc`,
          webcal: "",
          googleAdd: "",
        },
      }),
    );

    expect(links!.https).toBe(
      "https://other.example.com/api/on-call-calendar/user/abcDEF123_-xyz/shifts.ics?schedule=abc",
    );
  });

  test("keeps the base path of the app's stored server URL", () => {
    /*
     * A proxy that mounts OneUptime under /oneuptime. HOST is a bare hostname
     * on a stock install, so the server's own link carries no prefix - and
     * dropping the app's would produce https://other.example.com/api/... ,
     * which 404s on the only address this handset can reach. The app's stored
     * URL is what every other request is built on (`${serverUrl}/api/status`),
     * so it is the authority here too.
     */
    const links: FeedLinks | null = buildFeedLinks(
      "https://other.example.com/oneuptime",
      status(),
    );

    expect(links!.https).toBe(
      "https://other.example.com/oneuptime/api/on-call-calendar/user/abcDEF123_-xyz/shifts.ics",
    );
    expect(links!.webcal).toBe(
      "webcals://other.example.com/oneuptime/api/on-call-calendar/user/abcDEF123_-xyz/shifts.ics",
    );
  });

  test("a trailing slash on the stored server URL does not double up", () => {
    const links: FeedLinks | null = buildFeedLinks(
      "https://other.example.com/oneuptime/",
      status(),
    );

    expect(links!.https).toBe(
      "https://other.example.com/oneuptime/api/on-call-calendar/user/abcDEF123_-xyz/shifts.ics",
    );
  });

  test("does not double a prefix the server's own link already carries", () => {
    /*
     * The symmetric install: HOST itself is "example.com/oneuptime", so the
     * server builds the prefix into its link. Everything from the route
     * marker on is taken from the server, everything in front of it from the
     * app - so the prefix appears exactly once.
     */
    const links: FeedLinks | null = buildFeedLinks(
      "https://other.example.com/oneuptime",
      status({
        urls: {
          https:
            "https://oneuptime.example.com/oneuptime/api/on-call-calendar/user/t/shifts.ics",
          webcal: "",
          googleAdd: "",
        },
      }),
    );

    expect(links!.https).toBe(
      "https://other.example.com/oneuptime/api/on-call-calendar/user/t/shifts.ics",
    );
  });

  test("drops the server's prefix when this handset reaches the API at the root", () => {
    /*
     * The app is signed in through https://other.example.com with no base
     * path, which means /api is mounted at the root on that address. The
     * server's own prefix belongs to a different address, not to this one.
     */
    const links: FeedLinks | null = buildFeedLinks(
      "https://other.example.com",
      status({
        urls: {
          https:
            "https://oneuptime.example.com/oneuptime/api/on-call-calendar/user/t/shifts.ics",
          webcal: "",
          googleAdd: "",
        },
      }),
    );

    expect(links!.https).toBe(
      "https://other.example.com/api/on-call-calendar/user/t/shifts.ics",
    );
  });

  test("keeps the query string behind a base path", () => {
    const links: FeedLinks | null = buildFeedLinks(
      "https://other.example.com/oneuptime",
      status({
        urls: {
          https: `${SERVER_HTTPS}?schedule=abc`,
          webcal: "",
          googleAdd: "",
        },
      }),
    );

    expect(links!.https).toBe(
      "https://other.example.com/oneuptime/api/on-call-calendar/user/abcDEF123_-xyz/shifts.ics?schedule=abc",
    );
  });

  test("falls back to the origin when the server's link has no feed route in it", () => {
    /*
     * An unrecognised shape (a server that moved the route, a proxy that
     * rewrote it). Nothing can be said about which half is the mount prefix,
     * so the path is taken from the server as-is.
     */
    const links: FeedLinks | null = buildFeedLinks(
      "https://other.example.com/oneuptime",
      status({
        urls: {
          https: "https://oneuptime.example.com/calendars/user/t/shifts.ics",
          webcal: "",
          googleAdd: "",
        },
      }),
    );

    expect(links!.https).toBe(
      "https://other.example.com/calendars/user/t/shifts.ics",
    );
  });

  test("falls back to the server's links untouched when they cannot be parsed", () => {
    const links: FeedLinks | null = buildFeedLinks(
      "https://oneuptime.example.com",
      status({
        urls: { https: "garbage", webcal: "webcal-garbage", googleAdd: "g" },
      }),
    );

    expect(links).toEqual({
      https: "garbage",
      webcal: "webcal-garbage",
      googleAdd: "g",
      serverHttps: "garbage",
      differsFromServer: false,
      serverHost: null,
    });
  });

  test("falls back to the server's links when the app URL cannot be parsed", () => {
    const links: FeedLinks | null = buildFeedLinks("", status());

    expect(links!.https).toBe(SERVER_HTTPS);
    expect(links!.differsFromServer).toBe(false);
  });
});

describe("describeFetchStatus", () => {
  test("says 'Not fetched yet' outright", () => {
    expect(describeFetchStatus(status(), NOW)).toBe(
      "Not fetched yet · link ending in …k3Qx",
    );
  });

  test("names the client, the age and the count", () => {
    expect(
      describeFetchStatus(
        status({
          lastFetchedAt: "2026-03-03T10:00:00.000Z",
          lastFetchedClient: "Google Calendar",
          fetchCount: 143,
        }),
        NOW,
      ),
    ).toBe(
      "Last fetched 2h ago by Google Calendar · 143 fetches · link ending in …k3Qx",
    );
  });

  test("copes with a fetch inside the last minute and a missing client", () => {
    expect(
      describeFetchStatus(
        status({
          lastFetchedAt: new Date(NOW - 10 * 1000).toISOString(),
          fetchCount: 1,
          tokenHint: null,
        }),
        NOW,
      ),
    ).toBe("Last fetched just now · 1 fetch");
  });
});

describe("looksUnreachable", () => {
  test("is true two days after generation with zero fetches", () => {
    expect(
      looksUnreachable(
        status({
          rotatedAt: new Date(NOW - 49 * 60 * 60 * 1000).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  test("is false for a fresh link, a fetched link, or no link", () => {
    expect(
      looksUnreachable(
        status({ rotatedAt: new Date(NOW - 60 * 60 * 1000).toISOString() }),
        NOW,
      ),
    ).toBe(false);
    expect(
      looksUnreachable(
        status({
          rotatedAt: new Date(NOW - 49 * 60 * 60 * 1000).toISOString(),
          fetchCount: 3,
        }),
        NOW,
      ),
    ).toBe(false);
    expect(looksUnreachable(status({ exists: false }), NOW)).toBe(false);
    expect(looksUnreachable(status({ rotatedAt: null }), NOW)).toBe(false);
  });
});
