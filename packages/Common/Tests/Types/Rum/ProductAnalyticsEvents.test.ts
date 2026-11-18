import { describe, expect, test } from "@jest/globals";
import {
  PRODUCT_ANALYTICS_DERIVED_METRICS,
  PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS,
  PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH,
  PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH,
  PRODUCT_ANALYTICS_MAX_PAGE_LENGTH,
  PRODUCT_ANALYTICS_PROPERTY_LIMITS,
  PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS,
  PRODUCT_ANALYTICS_WIRE_VERSION,
  ProductAnalyticsBatchParseResult,
  ProductAnalyticsDerivedMetric,
  ProductAnalyticsEventKind,
  ProductAnalyticsParsedBatch,
  ProductAnalyticsParsedEvent,
  getProductAnalyticsDerivedMetricDescription,
  isProductAnalyticsDerivedMetricName,
  isProductAnalyticsMetricName,
  normalizeProductAnalyticsUserPropertyKeys,
  parseProductAnalyticsBatch,
  pickProductAnalyticsUserProperties,
  readProductAnalyticsRecorderConfig,
  toProductAnalyticsContext,
  toProductAnalyticsEventName,
  toProductAnalyticsPage,
  toProductAnalyticsProperties,
  toProductAnalyticsPropertyValue,
  PRODUCT_ANALYTICS_MAX_CONTEXT_VALUE_LENGTH,
} from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  SESSION_REPLAY_MAX_APP_VERSION_LENGTH,
  toSessionReplayAppVersion,
} from "../../../Types/Rum/SessionReplay";
import {
  CAFE_PAGE,
  CAFE_SPELLINGS,
  PAGES_WITH_PERSONAL_DATA,
  PAGES_WITH_SECRETS,
  PAGE_SPELLINGS,
  PageSpellingCase,
  addressOf,
} from "../../Helpers/PageSpellings";
import UrlScrubber from "../../../Utils/Rum/UrlScrubber";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * The server's reading of a product analytics batch (issue #6444, part
 * two). Everything in a batch comes from a page anyone can open, so it is
 * read as untrusted: a batch whose ids or size are wrong is refused whole;
 * an event or a metric point that is wrong is left out alone and counted;
 * times move by the recorder's clock skew and never into the future; a
 * user's properties are kept only for a signed-in user, and only the keys
 * the application chose.
 */

const RECEIVED_AT: number = Date.UTC(2026, 10, 10, 12, 0, 0);
const BATCH_ID: string = "a".repeat(32);
const SESSION_ID: string = "b".repeat(32);
const VISITOR_ID: string = "c".repeat(32);

function batch(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    v: PRODUCT_ANALYTICS_WIRE_VERSION,
    batchId: BATCH_ID,
    sessionId: SESSION_ID,
    visitorId: VISITOR_ID,
    consentState: "NotRequired",
    sentAt: RECEIVED_AT,
    context: {
      deviceType: "desktop",
      browserName: "Firefox",
      osName: "Linux",
      appVersion: "",
    },
    events: [],
    metrics: [],
    ...overrides,
  };
}

function parse(
  input: unknown,
  allowedUserPropertyKeys?: Array<string>,
): ProductAnalyticsBatchParseResult {
  return parseProductAnalyticsBatch(input, {
    receivedAtUnixMs: RECEIVED_AT,
    allowedUserPropertyKeys: allowedUserPropertyKeys || [],
  });
}

function parsed(
  input: unknown,
  allowedUserPropertyKeys?: Array<string>,
): ProductAnalyticsParsedBatch {
  const result: ProductAnalyticsBatchParseResult = parse(
    input,
    allowedUserPropertyKeys,
  );

  if (!result.isValid) {
    throw new Error(`Expected a valid batch, got ${result.error}`);
  }

  return result.batch;
}

describe("a batch refused whole", () => {
  test.each([
    ["null", null, "not-an-object"],
    ["a string", "batch", "not-an-object"],
    ["an array", [], "not-an-object"],
    ["version 2", batch({ v: 2 }), "unsupported-version"],
    ["a version as text", batch({ v: "1" }), "unsupported-version"],
    [
      "an upper-case batch id",
      batch({ batchId: "A".repeat(32) }),
      "invalid-batch-id",
    ],
    ["no batch id", batch({ batchId: undefined }), "invalid-batch-id"],
    [
      "a short session id",
      batch({ sessionId: "b".repeat(31) }),
      "invalid-session-id",
    ],
    [
      "a visitor id of another shape",
      batch({ visitorId: "not-a-visitor" }),
      "invalid-visitor-id",
    ],
    ["a visitor id as a number", batch({ visitorId: 7 }), "invalid-visitor-id"],
    [
      "one event too many",
      batch({
        events: new Array(PRODUCT_ANALYTICS_MAX_EVENTS_PER_BATCH + 1).fill({
          kind: "session",
          at: RECEIVED_AT,
        }),
      }),
      "too-many-events",
    ],
    [
      "one point too many",
      batch({
        metrics: new Array(PRODUCT_ANALYTICS_MAX_METRICS_PER_BATCH + 1).fill({
          name: "cart.value",
          value: 1,
          at: RECEIVED_AT,
        }),
      }),
      "too-many-metrics",
    ],
  ])(
    "%s: the batch is refused whole",
    (_what: string, input: unknown, error: string) => {
      expect(parse(input)).toEqual({ isValid: false, error: error });
    },
  );

  test("a batch with no visitor id, or an empty one, is kept", () => {
    expect(parsed(batch({ visitorId: undefined })).visitorId).toBe("");
    expect(parsed(batch({ visitorId: "" })).visitorId).toBe("");
  });

  test("a batch without events or metrics is kept, and holds none", () => {
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({ events: "nope", metrics: { 0: 1 } }),
    );

    expect(kept.events).toEqual([]);
    expect(kept.metrics).toEqual([]);
  });
});

describe("events", () => {
  test("a session's start, a page view and an event of the application's, each as stored", () => {
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        events: [
          {
            kind: "session",
            name: "ignored",
            at: RECEIVED_AT - 3000,
            page: "/",
          },
          {
            kind: "page",
            name: "https://shop.example.com/pricing?plan=pro#top",
            at: RECEIVED_AT - 2000,
          },
          {
            kind: "custom",
            name: "  Signed up  ",
            at: RECEIVED_AT - 1000,
            page: "/signup?step=2",
            properties: { plan: "pro", seats: 5, nothing: null },
          },
        ],
      }),
    );

    expect(kept.events).toEqual([
      {
        kind: ProductAnalyticsEventKind.Session,
        name: "",
        time: RECEIVED_AT - 3000,
        page: "/",
        properties: {},
      },
      {
        kind: ProductAnalyticsEventKind.Page,
        name: "/pricing",
        time: RECEIVED_AT - 2000,
        page: "/pricing",
        properties: {},
      },
      {
        kind: ProductAnalyticsEventKind.Custom,
        name: "Signed up",
        time: RECEIVED_AT - 1000,
        page: "/signup",
        properties: { plan: "pro", seats: "5" },
      },
    ]);
  });

  test("a page view with no name of its own is named by its page", () => {
    expect(
      parsed(
        batch({
          events: [{ kind: "page", page: "/docs", at: RECEIVED_AT }],
        }),
      ).events[0]!.name,
    ).toBe("/docs");
  });

  test("an event that cannot be read is left out alone, and counted", () => {
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        events: [
          null,
          "Signed up",
          [],
          { kind: "screen", name: "Home", at: RECEIVED_AT },
          { kind: "custom", name: "   ", at: RECEIVED_AT },
          { kind: "custom", name: 42, at: RECEIVED_AT },
          { kind: "page", at: RECEIVED_AT },
          { kind: "custom", name: "Kept", at: RECEIVED_AT },
        ],
      }),
    );

    expect(kept.events).toHaveLength(1);
    expect(kept.events[0]!.name).toBe("Kept");
    expect(kept.droppedEvents).toBe(7);
  });

  test("names lose their control characters and are held to the cap; pages to theirs", () => {
    const longName: string = `Name\u0000\u0007${"x".repeat(200)}`;

    expect(toProductAnalyticsEventName(longName)).toBe(
      `Name${"x".repeat(PRODUCT_ANALYTICS_MAX_EVENT_NAME_LENGTH - 4)}`,
    );
    expect(toProductAnalyticsEventName("\u0001\u0002")).toBeNull();
    expect(toProductAnalyticsPage(`/${"page/".repeat(400)}`)).toHaveLength(
      PRODUCT_ANALYTICS_MAX_PAGE_LENGTH,
    );
    /* One segment that long is a token, and is redacted before the cap. */
    expect(toProductAnalyticsPage(`/${"p".repeat(2000)}`)).toBe("/[redacted]");
    /* A mobile screen is a path too. */
    expect(toProductAnalyticsPage("Checkout")).toBe("/Checkout");
    expect(toProductAnalyticsPage("https://shop.example.com")).toBe("/");
    expect(toProductAnalyticsPage(undefined)).toBe("");
  });

  test("properties keep the caps track() has, and only on the application's own events", () => {
    const many: Record<string, string> = {};

    for (let index: number = 0; index < 40; index++) {
      many[`key${index}`] = "v".repeat(1000);
    }

    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        events: [
          { kind: "custom", name: "Big", at: RECEIVED_AT, properties: many },
          {
            kind: "page",
            name: "/",
            at: RECEIVED_AT,
            properties: { plan: "pro" },
          },
        ],
      }),
    );
    const properties: Record<string, string> = kept.events[0]!.properties;

    expect(Object.keys(properties)).toHaveLength(
      PRODUCT_ANALYTICS_PROPERTY_LIMITS.maxKeys,
    );
    expect(properties["key0"]).toHaveLength(
      PRODUCT_ANALYTICS_PROPERTY_LIMITS.maxValueLength,
    );
    expect(kept.events[1]!.properties).toEqual({});
  });
});

/*
 * #8017: one page can be written several ways - "/caf%c3%a9" (lower-case
 * hex), "/caf%C3%A9", "/cafe%CC%81" (its accent decomposed) - and an older
 * or cached recorder sends whichever the browser had. The server keeps the
 * page in its one spelling, the one Session Replay stores and User Flows
 * keys by, or product analytics counts one page as two or three. The
 * recorder's suite reads the same table (Tests/Helpers/PageSpellings).
 */
describe("a page in its one spelling", () => {
  test.each(
    PAGE_SPELLINGS.map((row: PageSpellingCase): [string, PageSpellingCase] => {
      return [row.name, row];
    }),
  )(
    "keeps what a recorder sent in the page's one spelling: %s",
    (_name: string, row: PageSpellingCase) => {
      const kept: ProductAnalyticsParsedBatch = parsed(
        batch({
          events: [
            { kind: "page", name: row.sent, at: RECEIVED_AT },
            { kind: "page", page: row.sent, at: RECEIVED_AT },
            {
              kind: "custom",
              name: "Signed up",
              page: row.sent,
              at: RECEIVED_AT,
            },
          ],
        }),
      );

      expect(
        kept.events.map((event: ProductAnalyticsParsedEvent) => {
          return [event.name, event.page];
        }),
      ).toEqual([
        [row.page, row.page],
        [row.page, row.page],
        ["Signed up", row.page],
      ]);

      // What the recorder sends now is kept as it is.
      expect(toProductAnalyticsPage(row.page)).toBe(row.page);
    },
  );

  test("the batch parser stores one spelling for the three", () => {
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        events: [
          { kind: "page", name: "/caf%c3%a9", at: RECEIVED_AT },
          { kind: "page", name: "/caf%C3%A9", at: RECEIVED_AT },
          { kind: "page", name: "/cafe%CC%81", at: RECEIVED_AT },
          {
            kind: "page",
            name: "https://shop.example.com/cafe%cc%81?ref=mail#top",
            at: RECEIVED_AT,
          },
        ],
      }),
    );

    expect(
      Array.from(
        new Set(
          kept.events.map((event: ProductAnalyticsParsedEvent): string => {
            return event.name;
          }),
        ),
      ),
    ).toEqual([CAFE_PAGE]);
    expect(CAFE_SPELLINGS.length).toBeGreaterThanOrEqual(5);

    for (const spelling of CAFE_SPELLINGS) {
      expect([spelling, toProductAnalyticsPage(spelling)]).toEqual([
        spelling,
        CAFE_PAGE,
      ]);
    }
  });

  test("keeps apart what names another page", () => {
    expect(toProductAnalyticsPage("/a%2fb")).toBe("/a%2Fb");
    expect(toProductAnalyticsPage("/a/b")).toBe("/a/b");
    expect(toProductAnalyticsPage("/Cart")).toBe("/Cart");
    expect(toProductAnalyticsPage("/cart")).toBe("/cart");
    expect(toProductAnalyticsPage("/100%25")).toBe("/100%25");
    // A lone "%" is not an escape, and nothing is made of it.
    expect(toProductAnalyticsPage("/100%")).toBe("/100%");
  });

  test("a mobile app's screen is written in the same spelling", () => {
    expect(toProductAnalyticsPage("Café")).toBe("/Caf%C3%A9");
    expect(toProductAnalyticsPage("Checkout")).toBe("/Checkout");
  });

  test("holds the page to its cap once it is spelled, and running it again changes nothing", () => {
    /* A page beyond ASCII grows when it is escaped: "é" is "%C3%A9". */
    const long: string = toProductAnalyticsPage(`/${"é".repeat(400)}`);

    expect(long).toHaveLength(PRODUCT_ANALYTICS_MAX_PAGE_LENGTH);
    expect(long.startsWith("/%C3%A9%C3%A9")).toBe(true);
    expect(toProductAnalyticsPage(long)).toBe(long);

    for (const row of PAGE_SPELLINGS) {
      const once: string = toProductAnalyticsPage(row.sent);

      expect([row.sent, toProductAnalyticsPage(once)]).toEqual([
        row.sent,
        once,
      ]);
    }
  });
});

/*
 * #8197: a page that names a person or a secret. The recorder scrubs a page
 * before it sends it, as Session Replay scrubs every address it keeps, but
 * the server takes no client's word for it: a recorder from before, or the
 * application's own code posting with its ingestion key, sends what it
 * likes, and the page is kept for months and shown to everyone who reads the
 * application's analytics. So the server scrubs every page, page name and
 * property that is an address again, with the scrubber Session Replay's
 * ingest runs (UrlScrubber). The recorder's suite reads the same table
 * (Tests/Helpers/PageSpellings).
 */
describe("personal data in a page", () => {
  const EMAIL_PAGE: string = "/users/someone@example.com/orders";
  const UUID_PAGE: string = "/reset/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f";

  function pagesOf(
    events: Array<Record<string, unknown>>,
  ): Array<[string, string, string]> {
    return parsed(batch({ events: events })).events.map(
      (event: ProductAnalyticsParsedEvent): [string, string, string] => {
        return [event.kind, event.name, event.page];
      },
    );
  }

  test("a page view a client sent unscrubbed is stored scrubbed, as the issue reported it", () => {
    /* The batch of the report: a page view named by a path with an email. */
    const kept: ProductAnalyticsParsedBatch = parsed({
      v: 1,
      batchId: "a".repeat(32),
      sessionId: "b".repeat(32),
      visitorId: "",
      consentState: "NotRequired",
      sentAt: RECEIVED_AT,
      context: {},
      events: [
        { kind: "page", name: "/users/someone@example.com", at: RECEIVED_AT },
      ],
      metrics: [],
    });

    expect(kept.events).toHaveLength(1);
    expect(kept.events[0]!.name).toBe("/users/[redacted]");
    expect(kept.events[0]!.page).toBe("/users/[redacted]");
  });

  test("every kind of event keeps its page scrubbed: a page view's name and page, a session's start, the application's own", () => {
    expect(
      pagesOf([
        { kind: "page", name: EMAIL_PAGE, at: RECEIVED_AT },
        { kind: "page", page: UUID_PAGE, at: RECEIVED_AT },
        { kind: "page", name: UUID_PAGE, page: EMAIL_PAGE, at: RECEIVED_AT },
        { kind: "session", page: EMAIL_PAGE, at: RECEIVED_AT },
        { kind: "custom", name: "Ordered", page: UUID_PAGE, at: RECEIVED_AT },
      ]),
    ).toEqual([
      ["page", "/users/[redacted]/orders", "/users/[redacted]/orders"],
      ["page", "/reset/[redacted]", "/reset/[redacted]"],
      /* A page view is filed on the page it names. */
      ["page", "/reset/[redacted]", "/reset/[redacted]"],
      ["session", "", "/users/[redacted]/orders"],
      ["custom", "Ordered", "/reset/[redacted]"],
    ]);
  });

  test.each(
    PAGES_WITH_PERSONAL_DATA.map(
      (row: PageSpellingCase): [string, PageSpellingCase] => {
        return [row.name, row];
      },
    ),
  )(
    "stores what a client that does not scrub sent as the recorder names it: %s",
    (_name: string, row: PageSpellingCase) => {
      const address: string = addressOf(row);

      expect(
        pagesOf([
          { kind: "page", name: row.sent, at: RECEIVED_AT },
          { kind: "page", page: row.sent, at: RECEIVED_AT },
          { kind: "custom", name: "Ordered", page: row.sent, at: RECEIVED_AT },
          { kind: "page", name: address, at: RECEIVED_AT },
          { kind: "custom", name: "Ordered", page: address, at: RECEIVED_AT },
        ]),
      ).toEqual([
        ["page", row.page, row.page],
        ["page", row.page, row.page],
        ["custom", "Ordered", row.page],
        ["page", row.page, row.page],
        ["custom", "Ordered", row.page],
      ]);

      // What is stored is scrubbed already: the scrubber keeps it as it is.
      expect(UrlScrubber.scrubPath(row.page)).toBe(row.page);
      expect(toProductAnalyticsPage(row.page)).toBe(row.page);
      // The page of the address Session Replay keeps is the same page.
      expect(toProductAnalyticsPage(UrlScrubber.scrub(address, []))).toBe(
        row.page,
      );
    },
  );

  /*
   * #8385: a JSON Web Token, and an address escaped twice, which the
   * scrubber kept until then: a client that sends one, or the location's
   * whole address, has it stored scrubbed, and what is kept that names no
   * one stays as it is.
   */
  test.each(
    PAGES_WITH_SECRETS.map(
      (row: PageSpellingCase): [string, PageSpellingCase] => {
        return [row.name, row];
      },
    ),
  )(
    "stores a token or an address escaped twice scrubbed: %s",
    (_name: string, row: PageSpellingCase) => {
      const address: string = addressOf(row);

      expect(
        pagesOf([
          { kind: "page", name: row.sent, at: RECEIVED_AT },
          { kind: "session", page: row.sent, at: RECEIVED_AT },
          { kind: "page", name: address, at: RECEIVED_AT },
          { kind: "custom", name: "Signed in", page: address, at: RECEIVED_AT },
        ]),
      ).toEqual([
        ["page", row.page, row.page],
        ["session", "", row.page],
        ["page", row.page, row.page],
        ["custom", "Signed in", row.page],
      ]);

      expect(toProductAnalyticsPage(row.page)).toBe(row.page);
      expect(toProductAnalyticsPage(UrlScrubber.scrub(address, []))).toBe(
        row.page,
      );
      expect(row.page).not.toContain("eyJhbGci");
      expect(row.page).not.toContain("%2540");
    },
  );

  test.each(
    PAGE_SPELLINGS.map((row: PageSpellingCase): [string, PageSpellingCase] => {
      return [row.name, row];
    }),
  )(
    "files the location's whole address on the page the recorder names: %s",
    (_name: string, row: PageSpellingCase) => {
      expect(toProductAnalyticsPage(addressOf(row))).toBe(row.page);
    },
  );

  test.each([
    ["an email", "/u/someone@example.com", "/u/[redacted]"],
    ["an escaped email", "/u/someone%40example.com", "/u/[redacted]"],
    [
      "an email with its dot escaped too, in either case of hex",
      "/u/someone%40example%2ecom/x/someone%40example%2Ecom",
      "/u/[redacted]/x/[redacted]",
    ],
    ["a uuid", "/u/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f", "/u/[redacted]"],
    [
      "a uuid with a digit escaped",
      "/u/%33f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
      "/u/[redacted]",
    ],
    ["an object id", "/p/5F8D0D55B54764421B7156C9", "/p/[redacted]"],
    ["nine digits", "/phone/491701234", "/phone/[redacted]"],
    ["eight digits, an ordinary id", "/orders/12345678", "/orders/12345678"],
    ["a token of 32", `/t/${"aB3_".repeat(8)}`, "/t/[redacted]"],
    [
      "31 letters, an ordinary slug",
      `/t/${"a".repeat(31)}`,
      `/t/${"a".repeat(31)}`,
    ],
    [
      "a token in the query",
      "/reset?token=Zx8kQ2vT9mL4pR7sW1yB6nC3dF5gH0jK",
      "/reset",
    ],
    [
      "an email in the query of a whole address",
      "https://shop.example.com/?email=someone%40example.com",
      "/",
    ],
    [
      "a hash route with an email",
      "/#/users/someone@example.com",
      "/users/[redacted]",
    ],
    [
      "a hashbang route with a uuid and a query",
      "/app/#!/i/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f?token=abc",
      "/app/i/[redacted]",
    ],
    [
      "a hash route after a page with no last slash",
      "https://shop.example.com/app#/orders/123456789012",
      "/app/orders/[redacted]",
    ],
    [
      "a hash route straight after the host",
      "https://shop.example.com#/users/someone@example.com",
      "/users/[redacted]",
    ],
    [
      "a query straight after the host",
      "https://shop.example.com?next=/users/someone@example.com",
      "/",
    ],
    [
      "a fragment straight after the host that is no route",
      "https://shop.example.com#token=abc/def",
      "/",
    ],
    ["a hash route with no path at all", "#/orders/42", "/orders/42"],
    [
      "a fragment inside a route, which is no route of its own",
      "/#/orders/42#/users/someone@example.com",
      "/orders/42",
    ],
    [
      "an access token in a fragment that is no route",
      "/callback#access_token=Zx8kQ2vT9mL4pR7sW1yB6nC3dF5gH0jK",
      "/callback",
    ],
    [
      "a mobile app's address",
      "app://com.example.shop/Profile/someone@example.com",
      "/Profile/[redacted]",
    ],
    [
      "an address inside a path, which is part of the path",
      "/redirect/https://example.com/u/someone@example.com",
      "/redirect/https://example.com/u/[redacted]",
    ],
  ])("scrubs %s", (_name: string, sent: string, page: string) => {
    expect(toProductAnalyticsPage(sent)).toBe(page);
    expect(pagesOf([{ kind: "page", name: sent, at: RECEIVED_AT }])).toEqual([
      ["page", page, page],
    ]);
  });

  test.each([
    ["Checkout", "/Checkout"],
    ["ProductDetails", "/ProductDetails"],
    ["Orders/42", "/Orders/42"],
    ["Settings/Notifications", "/Settings/Notifications"],
    ["Café", "/Caf%C3%A9"],
    ["/blog/how-to-ship-on-friday", "/blog/how-to-ship-on-friday"],
  ])("keeps a page that names no one: %p", (sent: string, page: string) => {
    expect(toProductAnalyticsPage(sent)).toBe(page);
  });

  test("a screen name of 32 letters or more is taken for a token, as the mobile recorder takes it in its routes", () => {
    /*
     * The mobile recorder redacts such a segment in every route it records
     * (sanitizeRoute), so the replay and the events of a session name the
     * screen alike; a screen named so long is renamed shorter, or kept
     * apart by a "/" ("ProductDetails/ScreenWithLongName").
     */
    expect(toProductAnalyticsPage("ProductDetailsScreenWithLongName")).toBe(
      "/[redacted]",
    );
    expect(toProductAnalyticsPage("ProductDetails/ScreenWithLongName")).toBe(
      "/ProductDetails/ScreenWithLongName",
    );
  });

  test("the cap does not cut an email into a shape the rule misses", () => {
    // The email starts 499 characters in, so the cap would cut it in two.
    const prefix: string = `/${"ab/".repeat(166)}`;
    const page: string = toProductAnalyticsPage(`${prefix}someone@example.com`);

    expect(prefix).toHaveLength(499);
    expect(page).toBe(`${prefix}[redacted]`);
    expect(page).not.toContain("someone");
  });

  test("the cap does not leave a segment in an identifier's shape", () => {
    const prefix: string = `/${"ab/".repeat(166)}`;
    // Kept whole (the "x" makes it no digit run); cut, it is thirteen digits.
    const page: string = toProductAnalyticsPage(`${prefix}1234567890123456x`);

    expect(page).toBe(`${prefix}[redacted]`);
    expect(toProductAnalyticsPage(page)).toBe(page);

    // A short email redacted past the cap keeps what fits of the redaction.
    const tight: string = `/${"ab/".repeat(168)}`;
    const cut: string = toProductAnalyticsPage(`${tight}a@b.co`);

    expect(tight).toHaveLength(505);
    expect(cut).toBe(`${tight}[redact`);
    expect(cut).toHaveLength(PRODUCT_ANALYTICS_MAX_PAGE_LENGTH);
    expect(toProductAnalyticsPage(cut)).toBe(cut);
  });

  test("running it over its own result changes nothing, for every page in the tables and thousands drawn at random", () => {
    const random: SeededRandom = seededRandom(8197);
    const segments: Array<string> = [
      "orders",
      "42",
      "someone@example.com",
      "someone%40example.com",
      "3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
      "5f8d0d55b54764421b7156c9",
      "1234567890",
      "12345678",
      "Zx8_kQ2-vT9mL4pR7sW1yB6nC3dF5gH0jK",
      "caf%c3%a9",
      "café",
      "a%2fb",
      "[redacted]",
      "",
      "x".repeat(40),
      "é".repeat(60),
      "#/",
      "#!/",
      "?token=abc",
      "#plans",
      "https://",
    ];
    const pages: Array<string> = [];

    for (const row of [
      ...PAGE_SPELLINGS,
      ...PAGES_WITH_PERSONAL_DATA,
      ...PAGES_WITH_SECRETS,
    ]) {
      pages.push(row.sent, addressOf(row), row.page);
    }

    for (let index: number = 0; index < 3000; index++) {
      let page: string = random(4) === 0 ? "https://shop.example.com" : "";
      const count: number = 1 + random(index % 10 === 0 ? 120 : 8);

      for (let part: number = 0; part < count; part++) {
        page += `/${segments[random(segments.length)]}`;
      }

      pages.push(page);
    }

    for (const page of pages) {
      const once: string = toProductAnalyticsPage(page);

      expect([page, toProductAnalyticsPage(once)]).toEqual([page, once]);
      expect(once.length).toBeLessThanOrEqual(
        PRODUCT_ANALYTICS_MAX_PAGE_LENGTH,
      );
      expect(once).not.toMatch(/[?#]/);
      expect(once).not.toContain("someone@");
      expect(once).not.toContain("3f1a9c7e-5b2d");
    }
  });
});

/*
 * #8197: a track() property, a metric() attribute or a user property whose
 * value is an address - the page's location.href, a link, a referrer - is
 * scrubbed as Session Replay scrubs the addresses it keeps: no query, no
 * fragment but a hash router's route, every identifier-shaped segment
 * "[redacted]". Any other value is the application's own words, kept as
 * written. The recorder sends them so, and the server reads them so again.
 */
describe("a property that is an address", () => {
  const LIMIT: number = PRODUCT_ANALYTICS_PROPERTY_LIMITS.maxValueLength;

  test.each([
    [
      "a page's own address, with a token in its query",
      "https://shop.example.com/reset-password?token=Zx8kQ2vT9mL4pR7sW1yB6nC3dF5gH0jK",
      "https://shop.example.com/reset-password",
    ],
    [
      "an email in the path and the query",
      "https://shop.example.com/users/someone@example.com?email=someone%40example.com",
      "https://shop.example.com/users/[redacted]",
    ],
    [
      "a hash router's route, scrubbed, its query dropped",
      "https://shop.example.com/#/invite/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f?token=abc",
      "https://shop.example.com/#/invite/[redacted]",
    ],
    [
      "a hashbang route",
      "https://shop.example.com/app/#!/users/someone%40example.com",
      "https://shop.example.com/app/#!/users/[redacted]",
    ],
    [
      "a JSON Web Token in the path (#8385)",
      "https://shop.example.com/auth/callback/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl?state=abc",
      "https://shop.example.com/auth/callback/[redacted]",
    ],
    [
      "an email escaped twice, in a route (#8385)",
      "https://shop.example.com/#/u/someone%2540example.com",
      "https://shop.example.com/#/u/[redacted]",
    ],
    [
      "a fragment that is no route",
      "https://shop.example.com/callback#access_token=abc",
      "https://shop.example.com/callback",
    ],
    [
      "a scheme in capitals",
      "HTTPS://Shop.Example.com/Orders/123456789012",
      "https://shop.example.com/Orders/[redacted]",
    ],
    [
      "plain http",
      "http://shop.example.com/u/5f8d0d55b54764421b7156c9",
      "http://shop.example.com/u/[redacted]",
    ],
    [
      "an address without its scheme",
      "//cdn.example.com/files/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f?sig=abc",
      "https://cdn.example.com/files/[redacted]",
    ],
    [
      "a path from the root",
      "/users/someone@example.com/orders?coupon=SAVE10",
      "/users/[redacted]/orders",
    ],
    [
      "an address with spaces around it",
      "  https://shop.example.com/reset?token=abc  ",
      "https://shop.example.com/reset",
    ],
    ["the root", "/", "/"],
  ])("scrubs %s", (_name: string, value: string, kept: string) => {
    expect(toProductAnalyticsPropertyValue(value, LIMIT)).toBe(kept);
    expect(toProductAnalyticsPropertyValue(kept, LIMIT)).toBe(kept);
    // Session Replay keeps the same address of it.
    expect(UrlScrubber.scrub(value.trim(), [])).toBe(kept);
  });

  test.each([
    ["a word", "pro"],
    ["a number", "42"],
    ["an email the application chose to send", "someone@example.com"],
    ["a sentence with an address in it", "see https://example.com/a?token=b"],
    ["a path with a space in it", "/ month"],
    ["a fraction", "1/2"],
    ["a mail address link", "mailto:someone@example.com"],
    ["another scheme", "ftp://files.example.com/a?b=c"],
    ["the mask a masked value is", "••••••••••••••••"],
    ["nothing", ""],
  ])("keeps %s as written", (_name: string, value: string) => {
    expect(toProductAnalyticsPropertyValue(value, LIMIT)).toBe(value);
  });

  test("reads a path from the root as a path: its words stay, and no segment turns it into another site's address", () => {
    /* A route template keeps its braces, which the URL parser escapes. */
    expect(
      toProductAnalyticsPropertyValue("/users/{id}/orders?tab=1", LIMIT),
    ).toBe("/users/{id}/orders");
    /*
     * The URL parser resolves "/./" and leaves "//cdn.example.com/a", which
     * read again is the address of another site.
     */
    expect(
      toProductAnalyticsPropertyValue("/.//cdn.example.com/a?x=1", LIMIT),
    ).toBe("/.//cdn.example.com/a");
    expect(
      toProductAnalyticsPropertyValue(
        "/caf%c3%a9/someone%40example.com",
        LIMIT,
      ),
    ).toBe("/caf%C3%A9/[redacted]");
    expect(
      toProductAnalyticsPropertyValue("/#/orders/someone@example.com?x", LIMIT),
    ).toBe("/#/orders/[redacted]");
  });

  test("is held to the cap, scrubbed before it is cut and once more after", () => {
    const prefix: string = `https://shop.example.com/${"ab/".repeat(57)}`;
    const value: string = toProductAnalyticsPropertyValue(
      `${prefix}someone@example.com?token=abc`,
      LIMIT,
    );

    expect(prefix).toHaveLength(196);
    expect(value).toBe(`${prefix}[red`);
    expect(value).toHaveLength(LIMIT);
    expect(toProductAnalyticsPropertyValue(value, LIMIT)).toBe(value);

    const long: string = toProductAnalyticsPropertyValue(
      `https://shop.example.com/${"orders/".repeat(100)}`,
      LIMIT,
    );

    expect(long).toHaveLength(LIMIT);
    expect(toProductAnalyticsPropertyValue(long, LIMIT)).toBe(long);
  });

  test("running it over its own result changes nothing, for thousands of addresses drawn at random", () => {
    const random: SeededRandom = seededRandom(1977);
    const parts: Array<string> = [
      "https://shop.example.com",
      "HTTP://Shop.Example.com",
      "//cdn.example.com",
      "",
      "/orders",
      "/42",
      "/someone@example.com",
      "/someone%40example.com",
      "/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
      "/1234567890",
      "/Zx8_kQ2-vT9mL4pR7sW1yB6nC3dF5gH0jK",
      "/caf%c3%a9",
      "/café",
      "/..",
      "/.",
      "/x".repeat(30),
      "?token=abc",
      "#/route/someone@example.com",
      "#!/r?x=1",
      "#plain",
      "/{id}",
    ];

    for (let index: number = 0; index < 3000; index++) {
      let value: string = "";
      const count: number = 1 + random(index % 10 === 0 ? 40 : 6);

      for (let part: number = 0; part < count; part++) {
        value += parts[random(parts.length)];
      }

      const once: string = toProductAnalyticsPropertyValue(value, LIMIT);

      expect([value, toProductAnalyticsPropertyValue(once, LIMIT)]).toEqual([
        value,
        once,
      ]);
      expect(once.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  test("a track() call's properties, a metric() point's attributes and a user's properties are all read so, at the server", () => {
    const href: string =
      "https://shop.example.com/users/someone@example.com?token=abc";
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        userRef: "user-1",
        userProperties: { plan: "pro", avatar: href, company: "Acme" },
        events: [
          {
            kind: "custom",
            name: "Shared",
            at: RECEIVED_AT,
            properties: {
              url: href,
              referrer: "/reset?token=abc",
              plan: "pro",
            },
          },
        ],
        metrics: [
          {
            name: "page.load",
            value: 1.5,
            at: RECEIVED_AT,
            attributes: { page: href, region: "eu" },
          },
        ],
      }),
      ["plan", "avatar"],
    );

    expect(kept.events[0]!.properties).toEqual({
      url: "https://shop.example.com/users/[redacted]",
      referrer: "/reset",
      plan: "pro",
    });
    expect(kept.metrics[0]!.attributes).toEqual({
      page: "https://shop.example.com/users/[redacted]",
      region: "eu",
    });
    expect(kept.userProperties).toEqual({
      plan: "pro",
      avatar: "https://shop.example.com/users/[redacted]",
    });
  });

  test("an address longer than the cap is scrubbed before the cap cuts it", () => {
    // The email sits past the 200 characters the cap keeps.
    const value: string = `https://shop.example.com/${"a/".repeat(80)}someone@example.com/${"b".repeat(800)}`;
    const properties: Record<string, string> = toProductAnalyticsProperties({
      url: value,
    });

    expect(properties["url"]!.length).toBeLessThanOrEqual(LIMIT);
    expect(properties["url"]).not.toContain("someone");
    expect(properties["url"]).toContain("[redacted]");
  });

  test("the caps are the ones track() has, and a value that is no string is still dropped", () => {
    const many: Record<string, unknown> = { flag: true, count: 3, list: [1] };

    for (let index: number = 0; index < 40; index++) {
      many[`key${index}`] = `https://shop.example.com/${index}?t=x`;
    }

    const properties: Record<string, string> =
      toProductAnalyticsProperties(many);

    expect(Object.keys(properties)).toHaveLength(
      PRODUCT_ANALYTICS_PROPERTY_LIMITS.maxKeys,
    );
    expect(properties["flag"]).toBe("true");
    expect(properties["count"]).toBe("3");
    expect(properties["list"]).toBeUndefined();
    expect(properties["key0"]).toBe("https://shop.example.com/0");
    expect(toProductAnalyticsProperties(properties)).toEqual(properties);
    expect(toProductAnalyticsProperties(null)).toEqual({});
    expect(toProductAnalyticsProperties(["a"])).toEqual({});
  });

  test("a user property is picked as written, and scrubbed when it is an address", () => {
    expect(
      pickProductAnalyticsUserProperties(
        {
          site: "https://acme.example.com/?ref=someone%40example.com",
          plan: "pro",
        },
        ["site"],
      ),
    ).toEqual({ site: "https://acme.example.com/" });
  });
});

describe("times", () => {
  test("move by the recorder's clock skew", () => {
    /* The phone's clock is a day behind. */
    const day: number = 24 * 60 * 60 * 1000;
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        sentAt: RECEIVED_AT - day,
        events: [{ kind: "session", at: RECEIVED_AT - day - 5000 }],
        metrics: [
          { name: "cart.value", value: 1, at: RECEIVED_AT - day - 4000 },
        ],
      }),
    );

    expect(kept.events[0]!.time).toBe(RECEIVED_AT - 5000);
    expect(kept.metrics[0]!.time).toBe(RECEIVED_AT - 4000);
  });

  test("never land in the future, and a missing time is the arrival", () => {
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        events: [
          { kind: "session", at: RECEIVED_AT + 60 * 60 * 1000 },
          { kind: "custom", name: "No time" },
        ],
      }),
    );

    expect(kept.events[0]!.time).toBe(RECEIVED_AT);
    expect(kept.events[1]!.time).toBe(RECEIVED_AT);
  });

  test("an event or a point older than the cap is dropped and counted apart", () => {
    const old: number = RECEIVED_AT - PRODUCT_ANALYTICS_MAX_EVENT_AGE_MS - 1;
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        events: [
          { kind: "session", at: old },
          { kind: "custom", name: "Fresh", at: RECEIVED_AT },
        ],
        metrics: [{ name: "cart.value", value: 3, at: old }],
      }),
    );

    expect(kept.events).toHaveLength(1);
    expect(kept.metrics).toHaveLength(0);
    expect(kept.droppedTooOld).toBe(2);
    expect(kept.droppedEvents).toBe(0);
    expect(kept.droppedMetrics).toBe(0);
  });

  test("a sentAt that is not a number moves nothing", () => {
    expect(
      parsed(
        batch({
          sentAt: "yesterday",
          events: [{ kind: "session", at: RECEIVED_AT - 1000 }],
        }),
      ).events[0]!.time,
    ).toBe(RECEIVED_AT - 1000);
  });
});

describe("metric points", () => {
  test("a point with a usable name and a finite value is kept with its attributes", () => {
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        metrics: [
          {
            name: "cart.value",
            value: 42.5,
            at: RECEIVED_AT,
            attributes: { currency: "EUR", items: 3 },
          },
        ],
      }),
    );

    expect(kept.metrics).toEqual([
      {
        name: "cart.value",
        value: 42.5,
        time: RECEIVED_AT,
        attributes: { currency: "EUR", items: "3" },
      },
    ]);
  });

  test.each([
    [{ name: "oneuptime.rum.product.events", value: 1 }],
    [{ name: "OneUptime.anything", value: 1 }],
    [{ name: "9lives", value: 1 }],
    [{ name: "has space", value: 1 }],
    [{ name: "x".repeat(101), value: 1 }],
    [{ name: "cart.value", value: "42" }],
    [{ name: "cart.value", value: Number.NaN }],
    [{ name: "cart.value", value: Number.POSITIVE_INFINITY }],
    [{ name: "cart.value" }],
    ["cart.value"],
  ])("%p is left out and counted", (metric: unknown) => {
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({ metrics: [metric] }),
    );

    expect(kept.metrics).toEqual([]);
    expect(kept.droppedMetrics).toBe(1);
  });

  test("a name is OpenTelemetry's instrument name, outside OneUptime's own namespace", () => {
    expect(isProductAnalyticsMetricName("checkout.duration_ms")).toBe(true);
    expect(isProductAnalyticsMetricName("a/b-c.d_e")).toBe(true);
    expect(isProductAnalyticsMetricName("x".repeat(100))).toBe(true);
    expect(isProductAnalyticsMetricName("x".repeat(101))).toBe(false);
    expect(isProductAnalyticsMetricName("oneuptime.cpu")).toBe(false);
    expect(isProductAnalyticsMetricName(undefined)).toBe(false);
  });
});

describe("who sent it", () => {
  test("a signed-in user's reference is kept, with only the traits the application chose", () => {
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({
        userRef: "  user-42  ",
        userProperties: {
          plan: "pro",
          email: "jane@example.com",
          role: "admin",
        },
      }),
      ["plan", "role", "team"],
    );

    expect(kept.userRef).toBe("user-42");
    expect(kept.userProperties).toEqual({ plan: "pro", role: "admin" });
  });

  test("with nobody signed in there are no user properties at all", () => {
    const kept: ProductAnalyticsParsedBatch = parsed(
      batch({ userProperties: { plan: "pro" } }),
      ["plan"],
    );

    expect(kept.userRef).toBe("");
    expect(kept.userProperties).toEqual({});
  });

  test("the context keeps a known device type and short strings, nothing else", () => {
    expect(
      toProductAnalyticsContext({
        deviceType: "smart-fridge",
        browserName: "x".repeat(100),
        osName: 7,
        appVersion: " 2.1.0 ",
        extra: "dropped",
      }),
    ).toEqual({
      deviceType: "",
      browserName: "x".repeat(64),
      osName: "",
      appVersion: "2.1.0",
    });
    expect(toProductAnalyticsContext(null)).toEqual({
      deviceType: "",
      browserName: "",
      osName: "",
      appVersion: "",
    });
  });

  /*
   * A web page's own app version (issue #6625) is kept as the browser
   * recorder keeps it: cut to 64 characters, and dropped whole when it
   * holds a control character, so an event never names a version nobody
   * typed.
   */
  test("the context's app version is cut to 64 characters, and dropped when it holds a control character", () => {
    expect(
      toProductAnalyticsContext({ appVersion: "8".repeat(70) }).appVersion,
    ).toBe("8".repeat(64));
    expect(
      toProductAnalyticsContext({ appVersion: "2026.11.18-rc1+build.5" })
        .appVersion,
    ).toBe("2026.11.18-rc1+build.5");

    for (const appVersion of ["2.3.1\n<script>", "1\u0000", "\u009b2", 2.3]) {
      expect(toProductAnalyticsContext({ appVersion: appVersion })).toEqual({
        deviceType: "",
        browserName: "",
        osName: "",
        appVersion: "",
      });
    }
  });
});

describe("toSessionReplayAppVersion", () => {
  test("keeps a version as written, trimmed, in any script", () => {
    expect(toSessionReplayAppVersion("2.3.1")).toBe("2.3.1");
    expect(toSessionReplayAppVersion("  v2.3.1 (beta) ")).toBe("v2.3.1 (beta)");
    expect(toSessionReplayAppVersion("1.0.0-β")).toBe("1.0.0-β");
  });

  test("cuts it to SESSION_REPLAY_MAX_APP_VERSION_LENGTH, the events' cap on a context value", () => {
    expect(SESSION_REPLAY_MAX_APP_VERSION_LENGTH).toBe(64);
    expect(SESSION_REPLAY_MAX_APP_VERSION_LENGTH).toBe(
      PRODUCT_ANALYTICS_MAX_CONTEXT_VALUE_LENGTH,
    );
    expect(toSessionReplayAppVersion("a".repeat(65))).toBe("a".repeat(64));
    // A cut that leaves a trailing space does not keep it.
    expect(toSessionReplayAppVersion(`${"a".repeat(63)} b`)).toBe(
      "a".repeat(63),
    );
  });

  test("drops anything holding a control character, empty or not a string", () => {
    // Whitespace around it is trimmed first, a line break included.
    expect(toSessionReplayAppVersion("2.3.1\n")).toBe("2.3.1");

    for (const value of [
      "2.3.1\n<b>",
      "2.3\r.1",
      "2\t3",
      "\u0000",
      "\u007f",
      "\u0085",
      "",
      "   ",
      undefined,
      null,
      231,
      true,
      ["2.3.1"],
      { version: "2.3.1" },
    ]) {
      expect(toSessionReplayAppVersion(value)).toBe("");
    }
  });
});

describe("the application's list of traits to keep", () => {
  test("trimmed, once each whatever the case, without empty or dangerous keys, at most the cap", () => {
    expect(
      normalizeProductAnalyticsUserPropertyKeys([
        " plan ",
        "PLAN",
        "",
        "__proto__",
        5,
        "role",
      ]),
    ).toEqual(["plan", "role"]);
    expect(normalizeProductAnalyticsUserPropertyKeys("plan")).toEqual([]);

    const many: Array<string> = Array.from(
      { length: 50 },
      (_value: unknown, index: number): string => {
        return `trait${index}`;
      },
    );

    expect(normalizeProductAnalyticsUserPropertyKeys(many)).toHaveLength(
      PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeys,
    );
    expect(
      normalizeProductAnalyticsUserPropertyKeys(["k".repeat(100)])[0],
    ).toHaveLength(PRODUCT_ANALYTICS_USER_PROPERTY_LIMITS.maxKeyLength);
  });

  test("a trait is picked as written: another case is another trait", () => {
    expect(
      pickProductAnalyticsUserProperties({ Plan: "pro", plan: "free" }, [
        "plan",
      ]),
    ).toEqual({ plan: "free" });
    expect(pickProductAnalyticsUserProperties("nope", ["plan"])).toEqual({});
  });

  test("the recorders read the config as off unless it says on", () => {
    expect(readProductAnalyticsRecorderConfig(undefined)).toEqual({
      enabled: false,
      userPropertyKeys: [],
    });
    expect(readProductAnalyticsRecorderConfig({ enabled: "true" })).toEqual({
      enabled: false,
      userPropertyKeys: [],
    });
    expect(
      readProductAnalyticsRecorderConfig({
        enabled: true,
        userPropertyKeys: ["plan", "plan"],
      }),
    ).toEqual({ enabled: true, userPropertyKeys: ["plan"] });
  });
});

describe("the series the pipeline writes itself", () => {
  test("live under OneUptime's prefix, which any case of it names", () => {
    for (const metric of PRODUCT_ANALYTICS_DERIVED_METRICS) {
      expect(isProductAnalyticsDerivedMetricName(metric)).toBe(true);
      expect(getProductAnalyticsDerivedMetricDescription(metric)).toBeTruthy();
      /* A recorder can never send one of them as its own. */
      expect(isProductAnalyticsMetricName(metric)).toBe(false);
    }

    expect(
      isProductAnalyticsDerivedMetricName(" OneUptime.RUM.Product.Events "),
    ).toBe(true);
    expect(isProductAnalyticsDerivedMetricName("cart.value")).toBe(false);
    expect(isProductAnalyticsDerivedMetricName(null)).toBe(false);
    expect(ProductAnalyticsDerivedMetric.Events).toBe(
      "oneuptime.rum.product.events",
    );
  });
});
