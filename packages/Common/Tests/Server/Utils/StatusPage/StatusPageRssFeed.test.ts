import StatusPageRssFeed, {
  StatusPageRssItem,
  StatusPageRssShownLists,
} from "../../../../Server/Utils/StatusPage/StatusPageRssFeed";
import { resolveClientIp } from "../../../../Server/Utils/ClientIp";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Dictionary from "../../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import API, { APIRequestOptions } from "../../../../Utils/API";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A status page's RSS feed: what it lists, how it dates each item, and who
 * the page's API takes its reader to be.
 *
 * The feed is written by a server, which reads the page's lists from the
 * status page API on the reader's behalf. Those reads used to go out as the
 * server itself: the page's IP allowlist judged the server's address - an
 * allowlist without it gave every reader an empty feed, one with it gave
 * every reader the page - and a signed-in reader of a private page got
 * nothing. Now each read carries the reader: their address where the API's
 * client IP reading looks for it, and their cookies.
 *
 * Each item is dated as the page dates it: an incident by when it was
 * declared, an announcement by when it went up on the page, a scheduled
 * maintenance event by when it starts - its description opening with its
 * window. Dated by when each was written, maintenance announced a week ahead
 * read as news of something happening now.
 */

const BASE_URL: string = "https://status.example.com";

function reader(data: {
  forwardedFor?: string | undefined;
  remoteAddress?: string | undefined;
  cookie?: string | undefined;
}): ExpressRequest {
  const headers: Dictionary<string> = {};

  if (data.forwardedFor !== undefined) {
    headers["x-forwarded-for"] = data.forwardedFor;
  }

  if (data.cookie !== undefined) {
    headers["cookie"] = data.cookie;
  }

  return {
    headers: headers,
    socket: { remoteAddress: data.remoteAddress },
    ip: data.remoteAddress,
  } as unknown as ExpressRequest;
}

/*
 * The internal read as the status page API receives it: the headers the
 * feed sent, over a connection from the feed's own server.
 */
function asTheApiSeesIt(headers: Dictionary<string>): ExpressRequest {
  return {
    headers: { ...headers },
    socket: { remoteAddress: "10.42.0.17" },
    ip: "10.42.0.17",
  } as unknown as ExpressRequest;
}

function lists(
  overrides: Partial<StatusPageRssShownLists> = {},
): StatusPageRssShownLists {
  return {
    incidents: [],
    announcements: [],
    scheduledMaintenanceEvents: [],
    ...overrides,
  };
}

function titles(items: Array<StatusPageRssItem>): Array<string> {
  return items.map((item: StatusPageRssItem): string => {
    return item.title;
  });
}

describe("StatusPageRssFeed.getReadHeaders", () => {
  test.each([
    [
      "behind one proxy",
      { forwardedFor: "198.51.100.7", remoteAddress: "10.0.0.2" },
    ],
    [
      "with an address the reader made up in front",
      { forwardedFor: "1.2.3.4, 198.51.100.7", remoteAddress: "10.0.0.2" },
    ],
    ["with no proxy in front", { remoteAddress: "198.51.100.8" }],
    ["over IPv6", { forwardedFor: "2001:db8::7", remoteAddress: "10.0.0.2" }],
  ])(
    "the API takes the reader to be who this server took them to be: %s",
    (
      _name: string,
      data: { forwardedFor?: string; remoteAddress?: string },
    ) => {
      const req: ExpressRequest = reader(data);
      const headers: Dictionary<string> = StatusPageRssFeed.getReadHeaders({
        req: req,
        statusPageId: "page",
      });

      expect(resolveClientIp(req)).toBeDefined();
      expect(resolveClientIp(asTheApiSeesIt(headers))).toBe(
        resolveClientIp(req),
      );
      // Never the server the feed is written on.
      expect(resolveClientIp(asTheApiSeesIt(headers))).not.toBe("10.42.0.17");
    },
  );

  test("names the page, and passes on the reader's cookies", () => {
    expect(
      StatusPageRssFeed.getReadHeaders({
        req: reader({
          forwardedFor: "198.51.100.7",
          cookie: "status-page-session=abc; other=1",
        }),
        statusPageId: "page-id",
      }),
    ).toEqual({
      "status-page-id": "page-id",
      "x-forwarded-for": "198.51.100.7",
      cookie: "status-page-session=abc; other=1",
    });
  });

  test("sends no address it could not establish, and no empty cookie", () => {
    expect(
      StatusPageRssFeed.getReadHeaders({
        req: reader({ forwardedFor: "not-an-address", cookie: "  " }),
        statusPageId: "page-id",
      }),
    ).toEqual({ "status-page-id": "page-id" });
  });

  test.each([2, 3])(
    "behind %s proxies, the reader's address is where the API reads it",
    (hops: number) => {
      jest.isolateModules((): void => {
        jest.doMock("../../../../Server/EnvironmentConfig", (): unknown => {
          return {
            ...(jest.requireActual(
              "../../../../Server/EnvironmentConfig",
            ) as Record<string, unknown>),
            TrustedProxyHops: hops,
          };
        });

        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const isolatedFeed: typeof StatusPageRssFeed =
          require("../../../../Server/Utils/StatusPage/StatusPageRssFeed").default;
        const isolatedResolve: typeof resolveClientIp =
          require("../../../../Server/Utils/ClientIp").resolveClientIp;
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

        /*
         * What the reader sent, the reader's address the first proxy
         * appended, and one entry for each proxy after it.
         */
        const chain: Array<string> = [
          "1.2.3.4",
          "198.51.100.7",
          "203.0.113.1",
          "203.0.113.2",
        ].slice(0, hops + 1);
        const req: ExpressRequest = reader({
          forwardedFor: chain.join(", "),
          remoteAddress: "10.0.0.2",
        });
        const headers: Dictionary<string> = isolatedFeed.getReadHeaders({
          req: req,
          statusPageId: "page",
        });

        expect(isolatedResolve(req)).toBe("198.51.100.7");
        expect(isolatedResolve(asTheApiSeesIt(headers))).toBe("198.51.100.7");
      });
    },
  );
});

describe("StatusPageRssFeed.readShownLists", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the page's three lists as the reader, and keeps what each answers", async () => {
    const calls: Array<APIRequestOptions> = [];

    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: APIRequestOptions,
        ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          calls.push(options);
          const url: string = options.url.toString();

          if (url.endsWith("/incidents/page-id")) {
            return new HTTPResponse<JSONObject>(
              200,
              { incidents: [{ _id: "i1" }] },
              {},
            );
          }

          if (url.endsWith("/announcements/page-id")) {
            // Announcements are switched off on this page.
            return new HTTPErrorResponse(
              400,
              {
                message: "Announcements are not enabled for this status page.",
              },
              {},
            );
          }

          return new HTTPResponse<JSONObject>(
            200,
            { scheduledMaintenanceEvents: [{ _id: "s1" }] },
            {},
          );
        },
      );

    const read: StatusPageRssShownLists =
      await StatusPageRssFeed.readShownLists({
        req: reader({
          forwardedFor: "198.51.100.7",
          cookie: "session=1",
        }),
        statusPageId: "page-id",
      });

    expect(read).toEqual({
      incidents: [{ _id: "i1" }],
      announcements: [],
      scheduledMaintenanceEvents: [{ _id: "s1" }],
    });

    expect(
      calls
        .map((call: APIRequestOptions): string => {
          const path: string = new URL(call.url.toString()).pathname;
          return path.slice(path.lastIndexOf("/status-page/"));
        })
        .sort(),
    ).toEqual([
      "/status-page/announcements/page-id",
      "/status-page/incidents/page-id",
      "/status-page/scheduled-maintenance-events/page-id",
    ]);

    for (const call of calls) {
      expect(call.headers).toEqual({
        "status-page-id": "page-id",
        "x-forwarded-for": "198.51.100.7",
        cookie: "session=1",
      });
    }
  });

  test("a private page the reader cannot read gives an empty feed, not an error", async () => {
    jest.spyOn(API, "post").mockResolvedValue(
      new HTTPErrorResponse(
        401,
        {
          message:
            "You do not have access to this status page. Please login to view the status page.",
        },
        {},
      ) as never,
    );

    expect(
      await StatusPageRssFeed.readShownLists({
        req: reader({ forwardedFor: "198.51.100.7" }),
        statusPageId: "page-id",
      }),
    ).toEqual(lists());
  });
});

describe("StatusPageRssFeed.buildItems: each item dated as the page dates it", () => {
  test("an incident by when it was declared, not when its record was written", () => {
    const [item] = StatusPageRssFeed.buildItems({
      lists: lists({
        incidents: [
          {
            _id: "i1",
            title: "Slow checkouts",
            description: "Payments take long.",
            createdAt: new Date("2026-10-23T10:05:00.000Z"),
            declaredAt: new Date("2026-10-23T09:40:00.000Z"),
          },
        ] as unknown as JSONArray,
      }),
      baseUrl: BASE_URL,
    });

    expect(item).toEqual({
      title: "Incident: Slow checkouts",
      description: "Payments take long.",
      link: `${BASE_URL}/incidents/i1`,
      date: new Date("2026-10-23T09:40:00.000Z"),
    });
  });

  test("an announcement by when it went up on the page, not when it was written", () => {
    const [item] = StatusPageRssFeed.buildItems({
      lists: lists({
        announcements: [
          {
            _id: "a1",
            title: "New region",
            description: "Frankfurt is live.",
            createdAt: new Date("2026-10-01T08:00:00.000Z"),
            showAnnouncementAt: new Date("2026-10-20T08:00:00.000Z"),
          },
        ] as unknown as JSONArray,
      }),
      baseUrl: BASE_URL,
    });

    expect(item!.date).toEqual(new Date("2026-10-20T08:00:00.000Z"));
    expect(item!.link).toBe(`${BASE_URL}/announcements/a1`);
  });

  test("a scheduled maintenance event by when it starts, with its window first in its description", () => {
    const [item] = StatusPageRssFeed.buildItems({
      lists: lists({
        scheduledMaintenanceEvents: [
          {
            _id: "s1",
            title: "Database upgrade",
            description: "Writes pause for a few minutes.",
            // Announced a week ahead.
            createdAt: new Date("2026-10-18T09:00:00.000Z"),
            startsAt: new Date("2026-10-25T02:00:00.000Z"),
            endsAt: new Date("2026-10-25T04:30:00.000Z"),
          },
        ] as unknown as JSONArray,
      }),
      baseUrl: BASE_URL,
    });

    expect(item).toEqual({
      title: "Scheduled Maintenance: Database upgrade",
      description:
        "Scheduled from Sun, 25 Oct 2026 02:00 to 04:30 UTC.\n\nWrites pause for a few minutes.",
      link: `${BASE_URL}/scheduled-events/s1`,
      date: new Date("2026-10-25T02:00:00.000Z"),
    });
  });

  test("an event with no end says when it starts; one with no description is just its window", () => {
    const [item] = StatusPageRssFeed.buildItems({
      lists: lists({
        scheduledMaintenanceEvents: [
          {
            _id: "s2",
            title: "Open-ended work",
            startsAt: "2026-11-01T22:15:00.000Z",
          },
        ] as unknown as JSONArray,
      }),
      baseUrl: BASE_URL,
    });

    expect(item!.description).toBe("Scheduled for Sun, 01 Nov 2026 22:15 UTC.");
  });

  test("falls back to when the record was written, and leaves out a date it cannot read", () => {
    const items: Array<StatusPageRssItem> = StatusPageRssFeed.buildItems({
      lists: lists({
        incidents: [
          {
            _id: "i2",
            title: "Old incident",
            createdAt: "2026-10-01T00:00:00.000Z",
          },
          { _id: "i3", title: "No date at all" },
          { _id: "i4", title: "Unreadable", declaredAt: "not a date" },
        ] as unknown as JSONArray,
        scheduledMaintenanceEvents: [
          {
            _id: "s3",
            title: "No start yet",
            description: "To be planned.",
            createdAt: { _type: "DateTime", value: "2026-10-02T00:00:00.000Z" },
          },
        ] as unknown as JSONArray,
      }),
      baseUrl: BASE_URL,
    });

    expect(
      items.map((item: StatusPageRssItem) => {
        return [item.title, item.date?.toISOString() || null, item.description];
      }),
    ).toEqual([
      [
        "Scheduled Maintenance: No start yet",
        "2026-10-02T00:00:00.000Z",
        "To be planned.",
      ],
      ["Incident: Old incident", "2026-10-01T00:00:00.000Z", ""],
      ["Incident: No date at all", null, ""],
      ["Incident: Unreadable", null, ""],
    ]);
  });

  test("lists newest first: upcoming maintenance above today's news, an item without a date last", () => {
    const items: Array<StatusPageRssItem> = StatusPageRssFeed.buildItems({
      lists: lists({
        incidents: [
          { _id: "i5", title: "Today", declaredAt: "2026-10-23T08:00:00.000Z" },
          { _id: "i6", title: "Undated" },
        ] as unknown as JSONArray,
        announcements: [
          {
            _id: "a2",
            title: "Yesterday",
            showAnnouncementAt: "2026-10-22T08:00:00.000Z",
          },
        ] as unknown as JSONArray,
        scheduledMaintenanceEvents: [
          {
            _id: "s4",
            title: "Next week",
            createdAt: "2026-10-01T00:00:00.000Z",
            startsAt: "2026-10-30T02:00:00.000Z",
          },
          {
            _id: "s5",
            title: "Under way",
            createdAt: "2026-09-01T00:00:00.000Z",
            startsAt: "2026-10-23T11:00:00.000Z",
          },
        ] as unknown as JSONArray,
      }),
      baseUrl: BASE_URL,
    });

    expect(titles(items)).toEqual([
      "Scheduled Maintenance: Next week",
      "Scheduled Maintenance: Under way",
      "Incident: Today",
      "Announcement: Yesterday",
      "Incident: Undated",
    ]);
  });
});

describe("StatusPageRssFeed.render", () => {
  test("writes each item's date as RSS dates it, and no pubDate for an item without one", () => {
    const xml: string = StatusPageRssFeed.render({
      title: "Acme",
      description: "Acme's status",
      baseUrl: BASE_URL,
      feedUrl: `${BASE_URL}/rss`,
      items: [
        {
          title: "Incident: Dated",
          description: "",
          link: `${BASE_URL}/incidents/i1`,
          date: new Date("2026-10-23T09:40:00.000Z"),
        },
        {
          title: "Incident: Undated",
          description: "",
          link: `${BASE_URL}/incidents/i2`,
          date: null,
        },
      ],
    });

    expect(xml).toContain("<pubDate>Fri, 23 Oct 2026 09:40:00 GMT</pubDate>");
    expect(xml.split("<pubDate>").length - 1).toBe(1);
    expect(xml).not.toContain("Invalid Date");
    expect(xml).toContain("<title>Acme Updates</title>");
    expect(xml).toContain(
      `<atom:link href="${BASE_URL}/rss" rel="self" type="application/rss+xml" />`,
    );
  });

  test("escapes every value it writes", () => {
    const xml: string = StatusPageRssFeed.render({
      title: "R&D <core>",
      description: "\"quoted\" & 'single'",
      baseUrl: `${BASE_URL}/a&b`,
      feedUrl: `${BASE_URL}/a&b/rss`,
      items: [
        {
          title: "Scheduled Maintenance: ]]> & <script>",
          description: "Scheduled from x to y.\n\n<b>bold</b>",
          link: `${BASE_URL}/a&b/scheduled-events/s1`,
          date: new Date("2026-10-25T02:00:00.000Z"),
        },
      ],
    });

    expect(xml).toContain("<title>R&amp;D &lt;core&gt; Updates</title>");
    expect(xml).toContain(
      "<title>Scheduled Maintenance: ]]&gt; &amp; &lt;script&gt;</title>",
    );
    expect(xml).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(xml).not.toContain("<script>");
  });
});

describe("StatusPageRssFeed's dates and words", () => {
  test.each([
    ["2026-10-25T02:00:00.000Z", "Sun, 25 Oct 2026 02:00 UTC"],
    ["2026-01-05T23:59:59.999Z", "Mon, 05 Jan 2026 23:59 UTC"],
    ["2027-02-28T00:07:00.000Z", "Sun, 28 Feb 2027 00:07 UTC"],
  ])("formats %s as %s", (iso: string, expected: string) => {
    expect(StatusPageRssFeed.formatUtc(new Date(iso))).toBe(expected);
  });

  test("describes a window, or nothing without a start", () => {
    expect(StatusPageRssFeed.describeWindow(null, null)).toBe("");
    expect(
      StatusPageRssFeed.describeWindow(
        null,
        new Date("2026-10-25T04:00:00.000Z"),
      ),
    ).toBe("");
  });

  /*
   * A window within one day names its day once; one that crosses midnight
   * in UTC names both days, so neither reads as a window of minus hours.
   */
  test.each([
    [
      "2026-10-25T02:00:00.000Z",
      "2026-10-25T04:30:00.000Z",
      "Scheduled from Sun, 25 Oct 2026 02:00 to 04:30 UTC.",
    ],
    [
      "2026-10-25T00:00:00.000Z",
      "2026-10-25T23:59:00.000Z",
      "Scheduled from Sun, 25 Oct 2026 00:00 to 23:59 UTC.",
    ],
    [
      "2026-10-24T22:00:00.000Z",
      "2026-10-25T02:00:00.000Z",
      "Scheduled from Sat, 24 Oct 2026 22:00 UTC to Sun, 25 Oct 2026 02:00 UTC.",
    ],
    [
      "2026-10-25T02:00:00.000Z",
      "2026-11-01T02:00:00.000Z",
      "Scheduled from Sun, 25 Oct 2026 02:00 UTC to Sun, 01 Nov 2026 02:00 UTC.",
    ],
    [
      "2026-10-25T02:00:00.000Z",
      "2027-10-25T02:00:00.000Z",
      "Scheduled from Sun, 25 Oct 2026 02:00 UTC to Mon, 25 Oct 2027 02:00 UTC.",
    ],
  ])(
    "describes the window from %s to %s",
    (starts: string, ends: string, expected: string) => {
      expect(
        StatusPageRssFeed.describeWindow(new Date(starts), new Date(ends)),
      ).toBe(expected);
    },
  );

  test.each([
    [new Date("2026-10-25T02:00:00.000Z"), "2026-10-25T02:00:00.000Z"],
    ["2026-10-25T02:00:00.000Z", "2026-10-25T02:00:00.000Z"],
    [
      { _type: "DateTime", value: "2026-10-25T02:00:00.000Z" },
      "2026-10-25T02:00:00.000Z",
    ],
    ["not a date", null],
    ["", null],
    [new Date("invalid"), null],
    [42, null],
    [null, null],
    [undefined, null],
    [{}, null],
  ])("reads %p as %p", (value: unknown, expected: string | null) => {
    expect(StatusPageRssFeed.toDate(value)?.toISOString() || null).toBe(
      expected,
    );
  });
});
