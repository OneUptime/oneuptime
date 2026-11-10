import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "../../../Types/Translator";
import { ProductAnalyticsEventKind } from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
  PRODUCT_ANALYTICS_EVENT_FIELDS,
  PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS,
  PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS,
  PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS,
  PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS,
  PRODUCT_ANALYTICS_RETENTION_PERIODS,
  ProductAnalyticsEventField,
  ProductAnalyticsEventNameDto,
  ProductAnalyticsEventRef,
  ProductAnalyticsRetentionPeriod,
  ProductAnalyticsSegmentFilter,
} from "../../../Types/Rum/ProductAnalyticsEventReads";
import {
  DEFAULT_PRODUCT_ANALYTICS_EVENT_BREAKDOWN,
  DEFAULT_PRODUCT_ANALYTICS_RETENTION_PERIOD,
  PAGE_VIEW_TEMPLATE,
  PRODUCT_ANALYTICS_EVENTS_URL_KEYS,
  PRODUCT_ANALYTICS_EVENT_FIELD_LABELS,
  PRODUCT_ANALYTICS_EVENT_GROUP_LABELS,
  PRODUCT_ANALYTICS_FUNNEL_WINDOW_LABELS,
  PRODUCT_ANALYTICS_PLAIN_FIELDS,
  PRODUCT_ANALYTICS_RETENTION_PERIOD_LABELS,
  PROPERTY_FIELD_TEMPLATE,
  ProductAnalyticsEventsUrlState,
  SESSION_STARTED,
  SESSION_START_EVENT,
  USER_PROPERTY_FIELD_TEMPLATE,
  addProductAnalyticsFilter,
  countProductAnalyticsRetentionPeriods,
  decodeProductAnalyticsEvent,
  decodeProductAnalyticsField,
  describeProductAnalyticsEvent,
  describeProductAnalyticsField,
  describeProductAnalyticsFieldValue,
  describeProductAnalyticsRetentionColumn,
  encodeProductAnalyticsEvent,
  encodeProductAnalyticsField,
  fitProductAnalyticsRetentionPeriod,
  getProductAnalyticsRetentionShade,
  isProductAnalyticsEventListed,
  isSameProductAnalyticsFilter,
  pickDefaultProductAnalyticsEvent,
  readProductAnalyticsEventsUrlState,
  readProductAnalyticsSegment,
  toProductAnalyticsFilterValue,
  writeProductAnalyticsEventsUrlState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsEventsFormat";
import {
  DEFAULT_PRODUCT_ANALYTICS_RANGE,
  buildProductAnalyticsUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsUrlState";
import { NOT_REPORTED } from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsFormat";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The words and addresses of the Events, Funnels and Retention pages
 * (issue #6444, part two), without React: every event, field, window and
 * period has a name a reader reads in their language; an event and a field
 * travel as one dropdown or address value and back; a segment holds one
 * value per field, at most five; and an address - untrusted - opens the
 * page it names or the default, never a broken one.
 */

const english: Translator = createTranslator(undefined, "en");

const GERMAN_WORDS: Record<string, string> = {
  [SESSION_STARTED]: "Sitzung gestartet",
  [PAGE_VIEW_TEMPLATE]: "{{page}} aufgerufen",
  [PROPERTY_FIELD_TEMPLATE]: "Ereigniseigenschaft: {{key}}",
  [USER_PROPERTY_FIELD_TEMPLATE]: "Benutzereigenschaft: {{key}}",
  "Device type": "Gerätetyp",
  Desktop: "Desktop-PC",
  [NOT_REPORTED]: "Nicht gemeldet",
  "Week {{number}}": "Woche {{number}}",
};

const german: Translator = createTranslator((key: string) => {
  return GERMAN_WORDS[key];
}, "de");

function name(
  kind: ProductAnalyticsEventKind,
  eventName: string,
  events: number,
): ProductAnalyticsEventNameDto {
  return {
    kind: kind,
    name: eventName,
    events: events,
    users: Math.ceil(events / 2),
    lastSeenAt: 1,
  };
}

const HREF: string =
  "https://oneuptime.example/dashboard/p/rum/a/product-analytics-events";

describe("events", () => {
  test("a session's start, a page and an event of the application's read as a reader reads them", () => {
    expect(describeProductAnalyticsEvent(SESSION_START_EVENT, english)).toBe(
      "Session started",
    );
    expect(describeProductAnalyticsEvent(SESSION_START_EVENT, german)).toBe(
      "Sitzung gestartet",
    );
    expect(
      describeProductAnalyticsEvent(
        { kind: ProductAnalyticsEventKind.Page, name: "/pricing" },
        english,
      ),
    ).toBe("Viewed /pricing");
    expect(
      describeProductAnalyticsEvent(
        { kind: ProductAnalyticsEventKind.Page, name: "/pricing" },
        german,
      ),
    ).toBe("/pricing aufgerufen");
    /* The application's own name, never looked up as a key: "Desktop" stays "Desktop". */
    expect(
      describeProductAnalyticsEvent(
        { kind: ProductAnalyticsEventKind.Custom, name: "Desktop" },
        german,
      ),
    ).toBe("Desktop");
  });

  test("every kind has a group name", () => {
    for (const kind of [
      ProductAnalyticsEventKind.Session,
      ProductAnalyticsEventKind.Page,
      ProductAnalyticsEventKind.Custom,
    ]) {
      expect(PRODUCT_ANALYTICS_EVENT_GROUP_LABELS[kind]).toBeTruthy();
    }
  });

  test.each([
    [{ kind: ProductAnalyticsEventKind.Session, name: "" }, "session:"],
    [{ kind: ProductAnalyticsEventKind.Page, name: "/pricing" }, "page:/pricing"],
    [
      { kind: ProductAnalyticsEventKind.Custom, name: "Signed up: pro plan" },
      "custom:Signed up: pro plan",
    ],
  ])(
    "%p travels as %p and back",
    (event: ProductAnalyticsEventRef, encoded: string) => {
      expect(encodeProductAnalyticsEvent(event)).toBe(encoded);
      expect(decodeProductAnalyticsEvent(encoded)).toEqual(event);
    },
  );

  test.each([
    null,
    undefined,
    "",
    "session",
    ":Signed up",
    "screen:Home",
    "custom:",
    "custom:   ",
    "page:",
  ])("%p decodes to no event", (value: string | null | undefined) => {
    expect(decodeProductAnalyticsEvent(value)).toBeNull();
  });

  test("a session's start decodes as one whatever name it was given", () => {
    expect(decodeProductAnalyticsEvent("session:anything")).toEqual(
      SESSION_START_EVENT,
    );
  });

  test("the default event is the most frequent of the application's own, else its most viewed page, else a session's start", () => {
    expect(
      pickDefaultProductAnalyticsEvent([
        name(ProductAnalyticsEventKind.Session, "", 900),
        name(ProductAnalyticsEventKind.Page, "/", 800),
        name(ProductAnalyticsEventKind.Custom, "Search", 300),
        name(ProductAnalyticsEventKind.Custom, "Signed up", 100),
      ]),
    ).toEqual({ kind: ProductAnalyticsEventKind.Custom, name: "Search" });
    expect(
      pickDefaultProductAnalyticsEvent([
        name(ProductAnalyticsEventKind.Session, "", 900),
        name(ProductAnalyticsEventKind.Page, "/docs", 800),
      ]),
    ).toEqual({ kind: ProductAnalyticsEventKind.Page, name: "/docs" });
    expect(
      pickDefaultProductAnalyticsEvent([
        name(ProductAnalyticsEventKind.Session, "", 900),
      ]),
    ).toEqual(SESSION_START_EVENT);
    expect(pickDefaultProductAnalyticsEvent([])).toEqual(SESSION_START_EVENT);
  });

  test("an event is listed when kind and name both match", () => {
    const events: Array<ProductAnalyticsEventNameDto> = [
      name(ProductAnalyticsEventKind.Custom, "Search", 3),
    ];

    expect(
      isProductAnalyticsEventListed(
        { kind: ProductAnalyticsEventKind.Custom, name: "Search" },
        events,
      ),
    ).toBe(true);
    expect(
      isProductAnalyticsEventListed(
        { kind: ProductAnalyticsEventKind.Page, name: "Search" },
        events,
      ),
    ).toBe(false);
  });
});

describe("fields", () => {
  test("every field has a name, and the plain ones are the ones with no key", () => {
    for (const field of PRODUCT_ANALYTICS_EVENT_FIELDS) {
      expect(PRODUCT_ANALYTICS_EVENT_FIELD_LABELS[field]).toBeTruthy();
    }

    expect(PRODUCT_ANALYTICS_PLAIN_FIELDS).toEqual([
      ProductAnalyticsEventField.DeviceType,
      ProductAnalyticsEventField.Browser,
      ProductAnalyticsEventField.OperatingSystem,
      ProductAnalyticsEventField.Country,
      ProductAnalyticsEventField.AppVersion,
      ProductAnalyticsEventField.Page,
    ]);
  });

  test("a property is named by its key, in the reader's language", () => {
    expect(
      describeProductAnalyticsField(
        { field: ProductAnalyticsEventField.Property, key: "plan" },
        english,
      ),
    ).toBe("Event property: plan");
    expect(
      describeProductAnalyticsField(
        { field: ProductAnalyticsEventField.UserProperty, key: "role" },
        german,
      ),
    ).toBe("Benutzereigenschaft: role");
    expect(
      describeProductAnalyticsField(
        { field: ProductAnalyticsEventField.DeviceType, key: "" },
        german,
      ),
    ).toBe("Gerätetyp");
  });

  test.each([
    [{ field: ProductAnalyticsEventField.DeviceType, key: "" }, "deviceType"],
    [{ field: ProductAnalyticsEventField.Property, key: "plan" }, "property:plan"],
    [
      { field: ProductAnalyticsEventField.UserProperty, key: "team:name" },
      "userProperty:team:name",
    ],
  ])("%p travels as %p and back", (ref: unknown, encoded: string) => {
    expect(
      encodeProductAnalyticsField(
        ref as { field: ProductAnalyticsEventField; key: string },
      ),
    ).toBe(encoded);
    expect(decodeProductAnalyticsField(encoded)).toEqual(ref);
  });

  test.each([null, "", "identifiedUserLabel", "property", "property:", "userProperty:  "])(
    "%p decodes to no field",
    (value: string | null) => {
      expect(decodeProductAnalyticsField(value)).toBeNull();
    },
  );

  test("a value reads as the reader reads it: a device in their words, a country by its name, nothing as Not reported", () => {
    expect(
      describeProductAnalyticsFieldValue({
        field: ProductAnalyticsEventField.DeviceType,
        value: "desktop",
        translator: german,
      }),
    ).toBe("Desktop-PC");
    expect(
      describeProductAnalyticsFieldValue({
        field: ProductAnalyticsEventField.Country,
        value: "DE",
        translator: english,
      }),
    ).toBe("Germany");
    expect(
      describeProductAnalyticsFieldValue({
        field: ProductAnalyticsEventField.Property,
        value: "",
        translator: german,
      }),
    ).toBe("Nicht gemeldet");
    /* A property's value is the application's, never looked up. */
    expect(
      describeProductAnalyticsFieldValue({
        field: ProductAnalyticsEventField.Property,
        value: "Desktop",
        translator: german,
      }),
    ).toBe("Desktop");
  });
});

describe("segments", () => {
  test.each([
    [ProductAnalyticsEventField.DeviceType, "Desktop", "desktop", english],
    [ProductAnalyticsEventField.DeviceType, " MOBILE ", "mobile", english],
    /* Its name in the reader's language. */
    [ProductAnalyticsEventField.DeviceType, "desktop-pc", "desktop", german],
    [ProductAnalyticsEventField.DeviceType, "Smart TV", "Smart TV", english],
    [ProductAnalyticsEventField.Country, "de", "DE", english],
    /* A code that was replaced, as the one in use now. */
    [ProductAnalyticsEventField.Country, "uk", "GB", english],
    [ProductAnalyticsEventField.Country, "Germany", "DE", english],
    [ProductAnalyticsEventField.Country, "deutschland", "DE", german],
    /* English names work whatever the reader's language. */
    [ProductAnalyticsEventField.Country, "France", "FR", german],
    [ProductAnalyticsEventField.Country, "Atlantis", "Atlantis", english],
    [ProductAnalyticsEventField.Country, "ß", "ß", english],
    /* Anything else as typed, without the spaces around it. */
    [ProductAnalyticsEventField.Browser, " Chrome ", "Chrome", english],
    [ProductAnalyticsEventField.Property, "Desktop", "Desktop", english],
  ])(
    "a typed %s of %p is kept as %p",
    (
      field: ProductAnalyticsEventField,
      value: string,
      stored: string,
      translator: Translator,
    ) => {
      expect(
        toProductAnalyticsFilterValue({
          field: field,
          value: value,
          translator: translator,
        }),
      ).toBe(stored);
    },
  );

  const DE: ProductAnalyticsSegmentFilter = {
    field: ProductAnalyticsEventField.Country,
    key: "",
    value: "DE",
  };

  test("a field holds one value: a new one replaces the old", () => {
    const filters: Array<ProductAnalyticsSegmentFilter> =
      addProductAnalyticsFilter([DE], { ...DE, value: "FR" });

    expect(filters).toEqual([{ ...DE, value: "FR" }]);
  });

  test("a property is its own field per key", () => {
    const plan: ProductAnalyticsSegmentFilter = {
      field: ProductAnalyticsEventField.Property,
      key: "plan",
      value: "pro",
    };
    const role: ProductAnalyticsSegmentFilter = {
      field: ProductAnalyticsEventField.Property,
      key: "role",
      value: "admin",
    };

    expect(addProductAnalyticsFilter([plan], role)).toEqual([plan, role]);
    expect(isSameProductAnalyticsFilter(plan, { ...plan })).toBe(true);
    expect(isSameProductAnalyticsFilter(plan, role)).toBe(false);
  });

  test("past the cap, the segment stays as it was", () => {
    let filters: Array<ProductAnalyticsSegmentFilter> = [];

    for (
      let index: number = 0;
      index < PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS + 2;
      index++
    ) {
      filters = addProductAnalyticsFilter(filters, {
        field: ProductAnalyticsEventField.Property,
        key: `key${index}`,
        value: "x",
      });
    }

    expect(filters).toHaveLength(PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS);
    /* A full segment still takes a new value for a field it holds. */
    expect(
      addProductAnalyticsFilter(filters, {
        field: ProductAnalyticsEventField.Property,
        key: "key0",
        value: "y",
      }),
    ).toContainEqual({
      field: ProductAnalyticsEventField.Property,
      key: "key0",
      value: "y",
    });
  });

  test.each([
    null,
    "",
    "not json",
    "{}",
    '{"field":"country","value":"DE"}',
    "[1, 2]",
    '[{"field":"identifiedUserLabel","value":"ada"}]',
  ])("an address segment %p reads as everyone", (value: string | null) => {
    expect(readProductAnalyticsSegment(value)).toEqual([]);
  });

  test("an address segment keeps the filters it can read, one per field, at most five", () => {
    const entries: Array<unknown> = [
      { field: "country", value: "DE" },
      { field: "country", value: "FR" },
      { field: "nonsense", value: "x" },
      { field: "property", key: "plan", value: "pro" },
    ];

    for (let index: number = 0; index < 10; index++) {
      entries.push({ field: "property", key: `k${index}`, value: "v" });
    }

    const filters: Array<ProductAnalyticsSegmentFilter> =
      readProductAnalyticsSegment(JSON.stringify(entries));

    expect(filters).toHaveLength(PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS);
    expect(filters[0]).toEqual({
      field: ProductAnalyticsEventField.Country,
      key: "",
      value: "FR",
    });
  });
});

describe("funnels and retention words", () => {
  test("every window the server takes has a name, and only those", () => {
    expect(
      Object.keys(PRODUCT_ANALYTICS_FUNNEL_WINDOW_LABELS).map(Number).sort(),
    ).toEqual([...PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS].sort());
  });

  test("every period has a name, and a column is named by its number", () => {
    for (const period of PRODUCT_ANALYTICS_RETENTION_PERIODS) {
      expect(PRODUCT_ANALYTICS_RETENTION_PERIOD_LABELS[period]).toBeTruthy();
    }

    expect(
      describeProductAnalyticsRetentionColumn({
        period: ProductAnalyticsRetentionPeriod.Day,
        index: 0,
        translator: english,
      }),
    ).toBe("Day 0");
    expect(
      describeProductAnalyticsRetentionColumn({
        period: ProductAnalyticsRetentionPeriod.Week,
        index: 3,
        translator: german,
      }),
    ).toBe("Woche 3");
    expect(
      describeProductAnalyticsRetentionColumn({
        period: ProductAnalyticsRetentionPeriod.Month,
        index: 12,
        translator: english,
      }),
    ).toBe("Month 12");
  });

  test("a range spans the periods from the one it starts in to the one it ends in, weeks from Monday", () => {
    const count: (
      period: ProductAnalyticsRetentionPeriod,
      start: string,
      end: string,
      timeZone?: string,
    ) => number = (
      period: ProductAnalyticsRetentionPeriod,
      start: string,
      end: string,
      timeZone?: string,
    ): number => {
      return countProductAnalyticsRetentionPeriods({
        period: period,
        startTime: new Date(start),
        endTime: new Date(end),
        timeZone: timeZone || "UTC",
      });
    };

    /* A month from mid-day to mid-day: 32 days, both ends counted. */
    expect(
      count(
        ProductAnalyticsRetentionPeriod.Day,
        "2026-10-10T14:00:00Z",
        "2026-11-10T14:00:00Z",
      ),
    ).toBe(32);
    /* Sunday 8 November is in the week of Monday 2 November; Monday 9 starts the next. */
    expect(
      count(
        ProductAnalyticsRetentionPeriod.Week,
        "2026-11-08T12:00:00Z",
        "2026-11-09T12:00:00Z",
      ),
    ).toBe(2);
    expect(
      count(
        ProductAnalyticsRetentionPeriod.Week,
        "2026-11-09T00:00:00Z",
        "2026-11-15T23:59:59Z",
      ),
    ).toBe(1);
    expect(
      count(
        ProductAnalyticsRetentionPeriod.Month,
        "2026-01-31T12:00:00Z",
        "2026-03-01T12:00:00Z",
      ),
    ).toBe(3);
    expect(
      count(
        ProductAnalyticsRetentionPeriod.Month,
        "2025-12-15T00:00:00Z",
        "2026-01-15T00:00:00Z",
      ),
    ).toBe(2);
    /* The reader's zone decides the day: 23:30 UTC is already the next morning in Tokyo. */
    expect(
      count(
        ProductAnalyticsRetentionPeriod.Day,
        "2026-03-01T23:30:00Z",
        "2026-03-02T01:00:00Z",
      ),
    ).toBe(2);
    expect(
      count(
        ProductAnalyticsRetentionPeriod.Day,
        "2026-03-01T23:30:00Z",
        "2026-03-02T01:00:00Z",
        "Asia/Tokyo",
      ),
    ).toBe(1);
    /* A zone the runtime does not know counts in UTC; an end before the start is one period. */
    expect(
      count(
        ProductAnalyticsRetentionPeriod.Day,
        "2026-03-01T23:30:00Z",
        "2026-03-02T01:00:00Z",
        "Not/AZone",
      ),
    ).toBe(2);
    expect(
      count(
        ProductAnalyticsRetentionPeriod.Day,
        "2026-03-05T00:00:00Z",
        "2026-03-01T00:00:00Z",
      ),
    ).toBe(1);
  });

  test("a period the range spans too many of reads as the next longer one that fits", () => {
    const fit: (
      period: ProductAnalyticsRetentionPeriod,
      start: string,
      end: string,
    ) => ProductAnalyticsRetentionPeriod = (
      period: ProductAnalyticsRetentionPeriod,
      start: string,
      end: string,
    ): ProductAnalyticsRetentionPeriod => {
      return fitProductAnalyticsRetentionPeriod({
        period: period,
        startTime: new Date(start),
        endTime: new Date(end),
        timeZone: "UTC",
      });
    };

    /* By day over any month's range, 31-day months too. */
    expect(
      fit(
        ProductAnalyticsRetentionPeriod.Day,
        "2026-10-10T14:00:00Z",
        "2026-11-10T14:00:00Z",
      ),
    ).toBe(ProductAnalyticsRetentionPeriod.Day);
    /* By day over three months: by week. */
    expect(
      fit(
        ProductAnalyticsRetentionPeriod.Day,
        "2026-08-10T14:00:00Z",
        "2026-11-10T14:00:00Z",
      ),
    ).toBe(ProductAnalyticsRetentionPeriod.Week);
    /* By week over a year: by month. */
    expect(
      fit(
        ProductAnalyticsRetentionPeriod.Week,
        "2025-11-10T14:00:00Z",
        "2026-11-10T14:00:00Z",
      ),
    ).toBe(ProductAnalyticsRetentionPeriod.Month);
    /* Never shorter than picked: by month over a week stays by month. */
    expect(
      fit(
        ProductAnalyticsRetentionPeriod.Month,
        "2026-11-03T14:00:00Z",
        "2026-11-10T14:00:00Z",
      ),
    ).toBe(ProductAnalyticsRetentionPeriod.Month);
    /* Past every cap, by month: the read then says to choose a shorter range. */
    expect(
      fit(
        ProductAnalyticsRetentionPeriod.Day,
        "2024-11-10T14:00:00Z",
        "2026-11-10T14:00:00Z",
      ),
    ).toBe(ProductAnalyticsRetentionPeriod.Month);
  });

  test("the read's caps hold every range the toolbar offers, by the period that suits it", () => {
    /* Past 1 Month by day; Past 3 Months by week. */
    expect(PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS.day).toBeGreaterThanOrEqual(
      32,
    );
    expect(PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS.week).toBeGreaterThanOrEqual(
      15,
    );
    expect(
      PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS.month,
    ).toBeGreaterThanOrEqual(13);
  });

  test("a cell's shade grows with its share, from none to full, and never past it", () => {
    expect(getProductAnalyticsRetentionShade(0)).toBe(0);
    expect(getProductAnalyticsRetentionShade(-1)).toBe(0);
    expect(getProductAnalyticsRetentionShade(Number.NaN)).toBe(0);
    expect(getProductAnalyticsRetentionShade(0.01)).toBeGreaterThan(0);
    expect(getProductAnalyticsRetentionShade(0.5)).toBeLessThan(
      getProductAnalyticsRetentionShade(0.6),
    );
    expect(getProductAnalyticsRetentionShade(1)).toBe(0.8);
    expect(getProductAnalyticsRetentionShade(7)).toBe(0.8);
  });
});

describe("the pages' addresses", () => {
  test("an empty address opens every default", () => {
    const state: ProductAnalyticsEventsUrlState =
      readProductAnalyticsEventsUrlState("");

    expect(state).toEqual({
      timeRange: DEFAULT_PRODUCT_ANALYTICS_RANGE,
      event: null,
      filters: [],
      breakdown: DEFAULT_PRODUCT_ANALYTICS_EVENT_BREAKDOWN,
      steps: [],
      windowMs: DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
      startEvent: SESSION_START_EVENT,
      returnEvent: SESSION_START_EVENT,
      period: DEFAULT_PRODUCT_ANALYTICS_RETENTION_PERIOD,
    });
  });

  test("state written into an address reads back the same, and every default is absence", () => {
    const written: string = writeProductAnalyticsEventsUrlState(HREF, {
      event: { kind: ProductAnalyticsEventKind.Custom, name: "Signed up & paid" },
      filters: [
        {
          field: ProductAnalyticsEventField.UserProperty,
          key: "plan",
          value: "pro",
        },
      ],
      breakdown: { field: ProductAnalyticsEventField.Property, key: "source" },
      steps: [
        SESSION_START_EVENT,
        { kind: ProductAnalyticsEventKind.Page, name: "/pricing" },
        { kind: ProductAnalyticsEventKind.Custom, name: "Signed up" },
      ],
      windowMs: PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS[0]!,
      startEvent: { kind: ProductAnalyticsEventKind.Custom, name: "Signed up" },
      returnEvent: SESSION_START_EVENT,
      period: ProductAnalyticsRetentionPeriod.Month,
    });
    const state: ProductAnalyticsEventsUrlState =
      readProductAnalyticsEventsUrlState(new URL(written).search);

    expect(state.event).toEqual({
      kind: ProductAnalyticsEventKind.Custom,
      name: "Signed up & paid",
    });
    expect(state.filters).toEqual([
      {
        field: ProductAnalyticsEventField.UserProperty,
        key: "plan",
        value: "pro",
      },
    ]);
    expect(state.breakdown).toEqual({
      field: ProductAnalyticsEventField.Property,
      key: "source",
    });
    expect(state.steps).toHaveLength(3);
    expect(state.windowMs).toBe(PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS[0]);
    expect(state.startEvent.name).toBe("Signed up");
    expect(state.period).toBe(ProductAnalyticsRetentionPeriod.Month);

    const params: URLSearchParams = new URL(written).searchParams;

    /* The defaults are not written. */
    expect(params.has(PRODUCT_ANALYTICS_EVENTS_URL_KEYS.return)).toBe(false);

    const defaults: string = writeProductAnalyticsEventsUrlState(HREF, {
      event: null,
      filters: [],
      breakdown: DEFAULT_PRODUCT_ANALYTICS_EVENT_BREAKDOWN,
      steps: [],
      windowMs: DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
      startEvent: SESSION_START_EVENT,
      returnEvent: SESSION_START_EVENT,
      period: DEFAULT_PRODUCT_ANALYTICS_RETENTION_PERIOD,
    });

    expect(new URL(defaults).search).toBe("");
  });

  test("writing one page's state keeps the range and every key it does not own", () => {
    const withRange: string = buildProductAnalyticsUrl(`${HREF}?tab=1`, {
      timeRange: { range: TimeRange.PAST_ONE_WEEK },
    });
    const written: string = writeProductAnalyticsEventsUrlState(withRange, {
      event: { kind: ProductAnalyticsEventKind.Custom, name: "Search" },
    });
    const params: URLSearchParams = new URL(written).searchParams;

    expect(params.get("tab")).toBe("1");
    expect(params.get(PRODUCT_ANALYTICS_EVENTS_URL_KEYS.event)).toBe(
      "custom:Search",
    );
    expect(
      readProductAnalyticsEventsUrlState(new URL(written).search).timeRange,
    ).toEqual({ range: TimeRange.PAST_ONE_WEEK });
  });

  test("a hand-made address opens the defaults for whatever it got wrong", () => {
    const steps: string = Array.from(
      { length: PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS + 3 },
      (_value: unknown, index: number): string => {
        return `step=custom%3AStep${index}`;
      },
    ).join("&");
    const state: ProductAnalyticsEventsUrlState =
      readProductAnalyticsEventsUrlState(
        `?event=screen%3AHome&by=identifiedUserLabel&within=5&per=year&start=nonsense&return=custom%3A&segment=%7Bbad&${steps}&step=screen%3Ax`,
      );

    expect(state.event).toBeNull();
    expect(state.breakdown).toEqual(DEFAULT_PRODUCT_ANALYTICS_EVENT_BREAKDOWN);
    expect(state.windowMs).toBe(DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS);
    expect(state.period).toBe(DEFAULT_PRODUCT_ANALYTICS_RETENTION_PERIOD);
    expect(state.startEvent).toEqual(SESSION_START_EVENT);
    expect(state.returnEvent).toEqual(SESSION_START_EVENT);
    expect(state.filters).toEqual([]);
    /* At most six steps, the readable ones in order. */
    expect(state.steps).toHaveLength(PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS);
    expect(state.steps[0]).toEqual({
      kind: ProductAnalyticsEventKind.Custom,
      name: "Step0",
    });
  });
});
