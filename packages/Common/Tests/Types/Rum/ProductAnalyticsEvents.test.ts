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
} from "../../../Types/Rum/ProductAnalyticsEvents";

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
    expect(toProductAnalyticsPage(`/${"p".repeat(2000)}`)).toHaveLength(
      PRODUCT_ANALYTICS_MAX_PAGE_LENGTH,
    );
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
