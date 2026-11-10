import {
  DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
  DEFAULT_PRODUCT_ANALYTICS_PEOPLE_LIMIT,
  DEFAULT_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT,
  DEFAULT_PRODUCT_ANALYTICS_TIME_ZONE,
  MAX_PRODUCT_ANALYTICS_PEOPLE_LIMIT,
  MAX_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT,
  PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS,
  PRODUCT_ANALYTICS_IN_RANGE_PEOPLE_FILTERS,
  PRODUCT_ANALYTICS_MAX_RANGE_DAYS,
  PRODUCT_ANALYTICS_MONTHLY_WINDOW_DAYS,
  PRODUCT_ANALYTICS_PEOPLE_FILTERS,
  PRODUCT_ANALYTICS_PEOPLE_ROUTE,
  PRODUCT_ANALYTICS_PERSON_ROUTE,
  PRODUCT_ANALYTICS_RETENTION_MONTHS,
  PRODUCT_ANALYTICS_ROUTE_PREFIX,
  PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS,
  PRODUCT_ANALYTICS_SUMMARY_ROUTE,
  PRODUCT_ANALYTICS_TREND_ROUTE,
  PRODUCT_ANALYTICS_WEEKLY_WINDOW_DAYS,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleFilter,
  ProductAnalyticsSessionLengthBucket,
  fromProductAnalyticsPersonSegment,
  isProductAnalyticsPersonKey,
  readProductAnalyticsPersonKind,
  toProductAnalyticsPersonSegment,
  toProductAnalyticsTimeZone,
} from "../../../Types/Rum/ProductAnalytics";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * The vocabulary the product analytics routes and the Dashboard share
 * (issue #6444). Every value a body may carry is checked against these, so
 * a shape that slips here reaches ClickHouse.
 */

const USER_KEY: string = "0123456789abcdef".repeat(4);
const VISITOR_ID: string = "fedcba9876543210".repeat(2);

describe("person keys", () => {
  test("u: and a 64-hex user key, or v: and a 32-hex visitor id", () => {
    expect(isProductAnalyticsPersonKey(`u:${USER_KEY}`)).toBe(true);
    expect(isProductAnalyticsPersonKey(`v:${VISITOR_ID}`)).toBe(true);
  });

  test.each([
    undefined,
    null,
    42,
    { personKey: `u:${USER_KEY}` },
    "",
    "u:",
    "v:",
    USER_KEY,
    `u:${VISITOR_ID}`,
    `v:${USER_KEY}`,
    `u:${USER_KEY.toUpperCase()}`,
    `u:${USER_KEY} `,
    ` u:${USER_KEY}`,
    `u:${USER_KEY}\n`,
    `U:${USER_KEY}`,
    `x:${VISITOR_ID}`,
    `v:${VISITOR_ID.slice(1)}g`,
    `u-${USER_KEY}`,
  ])("refuses %p", (value: unknown) => {
    expect(isProductAnalyticsPersonKey(value)).toBe(false);
  });

  test("a key's kind is read from its prefix", () => {
    expect(readProductAnalyticsPersonKind(`u:${USER_KEY}`)).toBe("identified");
    expect(readProductAnalyticsPersonKind(`v:${VISITOR_ID}`)).toBe("visitor");
  });

  test("a key travels in an address as one segment, and comes back the same", () => {
    for (const personKey of [`u:${USER_KEY}`, `v:${VISITOR_ID}`]) {
      const segment: string = toProductAnalyticsPersonSegment(personKey);

      expect(segment).not.toContain(":");
      expect(segment).toBe(encodeURIComponent(segment));
      expect(fromProductAnalyticsPersonSegment(segment)).toBe(personKey);
    }
  });

  test.each(["", "u-", "u-xyz", "nobody", `w-${VISITOR_ID}`, `u:${USER_KEY}`])(
    "a segment that names nobody, %p, is null",
    (segment: string) => {
      /* u:… itself is a key, not a segment: its colon is already a dash in a link. */
      const back: string | null = fromProductAnalyticsPersonSegment(segment);

      if (segment === `u:${USER_KEY}`) {
        expect(back).toBe(`u:${USER_KEY}`);
      } else {
        expect(back).toBeNull();
      }
    },
  );
});

describe("time zones", () => {
  test("UTC is the default", () => {
    expect(DEFAULT_PRODUCT_ANALYTICS_TIME_ZONE).toBe("UTC");
    expect(toProductAnalyticsTimeZone("UTC")).toBe("UTC");
  });

  test.each([
    ["Europe/Berlin", "Europe/Berlin"],
    ["europe/berlin", "Europe/Berlin"],
    ["America/New_York", "America/New_York"],
    ["Etc/GMT+5", "Etc/GMT+5"],
    ["Etc/GMT-14", "Etc/GMT-14"],
  ])("%s is spelled %s", (value: string, spelled: string) => {
    expect(toProductAnalyticsTimeZone(value)).toBe(spelled);
  });

  test("a three-part zone is accepted, spelled as the runtime spells it", () => {
    const resolved: string | null = toProductAnalyticsTimeZone(
      "America/Argentina/Buenos_Aires",
    );

    expect(resolved).toBe(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Argentina/Buenos_Aires",
      }).resolvedOptions().timeZone,
    );
  });

  test("every zone the runtime knows is accepted", () => {
    /*
     * ES2022's Intl.supportedValuesOf: every Node the tests run on has it,
     * but the lib the tests compile against does not name it.
     */
    const intl: { supportedValuesOf: (key: "timeZone") => Array<string> } =
      Intl as unknown as {
        supportedValuesOf: (key: "timeZone") => Array<string>;
      };
    const timeZones: Array<string> = intl.supportedValuesOf("timeZone");

    // Hundreds of zones, so the loop below cannot pass by checking none.
    expect(timeZones.length).toBeGreaterThan(300);

    for (const timeZone of timeZones) {
      expect(toProductAnalyticsTimeZone(timeZone)).not.toBeNull();
    }
  });

  test.each([
    undefined,
    null,
    5,
    ["UTC"],
    "",
    "Mars/Olympus_Mons",
    "Europe/Nowhere",
    "../etc/passwd",
    "/Europe/Berlin",
    "Europe//Berlin",
    "Europe/Berlin/",
    "Europe/Berlin'",
    "Europe/Berlin; DROP TABLE x",
    "Europe Berlin",
    `Europe/${"a".repeat(41)}`,
    "A/B/C/D",
    "+05:00",
    "Europe/Berlin\u0000",
  ])("refuses %p", (value: unknown) => {
    expect(toProductAnalyticsTimeZone(value)).toBeNull();
  });

  test("the shape check is linear on a long hostile input", () => {
    // 400,000 characters of slashes the shape almost takes, then one it never does.
    const run: FastestRun<string | null> = fastestRun({
      run: (): string | null => {
        return toProductAnalyticsTimeZone(`${"a/".repeat(200000)}!`);
      },
      limitInMs: 2000,
    });

    expect(run.result).toBeNull();
    expect(run.inMs).toBeLessThan(2000);
  });
});

describe("the routes, ranges and lists", () => {
  test("the five routes share one prefix under /telemetry/rum", () => {
    expect(PRODUCT_ANALYTICS_ROUTE_PREFIX).toBe(
      "/telemetry/rum/product-analytics",
    );

    expect([
      PRODUCT_ANALYTICS_SUMMARY_ROUTE,
      PRODUCT_ANALYTICS_TREND_ROUTE,
      PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
      PRODUCT_ANALYTICS_PEOPLE_ROUTE,
      PRODUCT_ANALYTICS_PERSON_ROUTE,
    ]).toEqual([
      "/telemetry/rum/product-analytics/summary",
      "/telemetry/rum/product-analytics/trend",
      "/telemetry/rum/product-analytics/breakdown",
      "/telemetry/rum/product-analytics/people",
      "/telemetry/rum/product-analytics/person",
    ]);
  });

  test("a range never reaches past what the tables keep", () => {
    expect(PRODUCT_ANALYTICS_RETENTION_MONTHS).toBe(13);
    /* 13 months is at least 365 + 30 days, so 400 days is within it. */
    expect(PRODUCT_ANALYTICS_MAX_RANGE_DAYS).toBeLessThanOrEqual(
      PRODUCT_ANALYTICS_RETENTION_MONTHS * 31,
    );
    expect(PRODUCT_ANALYTICS_WEEKLY_WINDOW_DAYS).toBe(7);
    expect(PRODUCT_ANALYTICS_MONTHLY_WINDOW_DAYS).toBe(30);
  });

  test("the dormant windows are whole days, ascending, and hold the default", () => {
    expect([...PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS]).toEqual([
      7, 14, 30, 60, 90,
    ]);
    expect(PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS).toContain(
      DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
    );
  });

  test("the page sizes hold their defaults", () => {
    expect(DEFAULT_PRODUCT_ANALYTICS_PEOPLE_LIMIT).toBeLessThanOrEqual(
      MAX_PRODUCT_ANALYTICS_PEOPLE_LIMIT,
    );
    expect(DEFAULT_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT).toBeLessThanOrEqual(
      MAX_PRODUCT_ANALYTICS_PERSON_SESSIONS_LIMIT,
    );
  });

  test("every dimension and filter is listed once", () => {
    expect([...PRODUCT_ANALYTICS_DIMENSIONS].sort()).toEqual(
      Object.values(ProductAnalyticsDimension).sort(),
    );
    expect([...PRODUCT_ANALYTICS_PEOPLE_FILTERS].sort()).toEqual(
      Object.values(ProductAnalyticsPeopleFilter).sort(),
    );

    for (const filter of PRODUCT_ANALYTICS_IN_RANGE_PEOPLE_FILTERS) {
      expect(PRODUCT_ANALYTICS_PEOPLE_FILTERS).toContain(filter);
    }

    expect(PRODUCT_ANALYTICS_IN_RANGE_PEOPLE_FILTERS).not.toContain(
      ProductAnalyticsPeopleFilter.Dormant,
    );
    expect(PRODUCT_ANALYTICS_IN_RANGE_PEOPLE_FILTERS).not.toContain(
      ProductAnalyticsPeopleFilter.All,
    );
  });

  test("the session length buckets cover every length once, from zero up", () => {
    const buckets: ReadonlyArray<ProductAnalyticsSessionLengthBucket> =
      PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS;

    expect(buckets[0]!.fromMs).toBe(0);
    expect(buckets[buckets.length - 1]!.toMs).toBeNull();

    buckets.forEach(
      (bucket: ProductAnalyticsSessionLengthBucket, index: number): void => {
        if (index > 0) {
          expect(bucket.fromMs).toBe(buckets[index - 1]!.toMs);
        }

        if (bucket.toMs !== null) {
          expect(bucket.toMs).toBeGreaterThan(bucket.fromMs);
        }
      },
    );

    expect(
      new Set(
        buckets.map((bucket: ProductAnalyticsSessionLengthBucket): string => {
          return bucket.key;
        }),
      ).size,
    ).toBe(buckets.length);
  });
});
