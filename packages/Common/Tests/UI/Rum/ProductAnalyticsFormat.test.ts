import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_PEOPLE_FILTERS,
  PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS,
  ProductAnalyticsDimension,
  ProductAnalyticsPersonDto,
  ProductAnalyticsTrendDayDto,
} from "../../../Types/Rum/ProductAnalytics";
import {
  ANONYMOUS_VISITOR,
  CHANGE_DOWN,
  CHANGE_NEW,
  CHANGE_SAME,
  CHANGE_UP,
  NOT_REPORTED,
  PRODUCT_ANALYTICS_DIMENSION_LABELS,
  PRODUCT_ANALYTICS_FILTER_LABELS,
  PRODUCT_ANALYTICS_SESSION_LENGTH_LABELS,
  SIGNED_IN_USER,
  describeProductAnalyticsChange,
  describeProductAnalyticsCountry,
  describeProductAnalyticsDevice,
  describeProductAnalyticsPerson,
  describeProductAnalyticsValue,
  formatProductAnalyticsAverage,
  formatProductAnalyticsCount,
  formatProductAnalyticsDuration,
  formatProductAnalyticsShare,
  getProductAnalyticsDayStart,
  getProductAnalyticsTimeZone,
  getProductAnalyticsTrendWindow,
  shortProductAnalyticsId,
  toProductAnalyticsSeries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsFormat";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";

/*
 * The words and numbers of the product analytics pages (issue #6444),
 * without React: every filter, dimension and length bucket has a name; a
 * value reads as the reader reads it; a change against the range before
 * says up, down, the same or none; a person is named only by what the
 * reader may see; and each day of the trend starts where it starts in the
 * reader's zone, through daylight saving, odd offsets, and days that have
 * no midnight.
 */

const english: Translator = createTranslator(undefined, "en");

/* A reader whose locale has German words for a few keys and English for the rest. */
const GERMAN_WORDS: Record<string, string> = {
  [NOT_REPORTED]: "Nicht gemeldet",
  Desktop: "Desktop-PC",
  Mobile: "Mobilgerät",
  [CHANGE_UP]: "{{percent}} mehr als im vorherigen Zeitraum",
  [CHANGE_DOWN]: "{{percent}} weniger als im vorherigen Zeitraum",
  [CHANGE_SAME]: "Gleich wie im vorherigen Zeitraum",
  [CHANGE_NEW]: "Keine im vorherigen Zeitraum",
  [SIGNED_IN_USER]: "Angemeldeter Benutzer",
  [ANONYMOUS_VISITOR]: "Anonymer Besucher",
};

const german: Translator = createTranslator((key: string) => {
  return GERMAN_WORDS[key];
}, "de");

const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const VISITOR_ID: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";

function person(
  overrides: Partial<ProductAnalyticsPersonDto>,
): ProductAnalyticsPersonDto {
  return {
    personKey: `u:${USER_KEY}`,
    kind: "identified",
    identifiedUserKey: USER_KEY,
    visitorId: VISITOR_ID,
    identifiedUserLabel: "jane@acme.com",
    firstSeenAt: 1,
    lastSeenAt: 2,
    sessionsInRange: 3,
    totalSessions: 4,
    deviceType: "desktop",
    countryCode: "DE",
    isNew: false,
    ...overrides,
  };
}

function day(
  value: string,
  overrides?: Partial<ProductAnalyticsTrendDayDto>,
): ProductAnalyticsTrendDayDto {
  return {
    day: value,
    activeUsers: 0,
    weeklyActiveUsers: 0,
    monthlyActiveUsers: 0,
    newUsers: 0,
    returningUsers: 0,
    sessions: 0,
    desktopSessions: 0,
    mobileSessions: 0,
    tabletSessions: 0,
    otherSessions: 0,
    ...overrides,
  };
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

describe("every choice has a name", () => {
  test("each people filter is named, as its tile names the same people", () => {
    for (const filter of PRODUCT_ANALYTICS_PEOPLE_FILTERS) {
      expect(PRODUCT_ANALYTICS_FILTER_LABELS[filter]).toBeTruthy();
    }

    expect(PRODUCT_ANALYTICS_FILTER_LABELS).toEqual({
      active: "Active users",
      new: "New users",
      returning: "Returning users",
      "signed-in": "Signed-in users",
      anonymous: "Anonymous visitors",
      dormant: "Dormant users",
      all: "Everyone",
    });
    expect(new Set(Object.values(PRODUCT_ANALYTICS_FILTER_LABELS)).size).toBe(
      PRODUCT_ANALYTICS_PEOPLE_FILTERS.length,
    );
  });

  test("each dimension is named, once", () => {
    for (const dimension of PRODUCT_ANALYTICS_DIMENSIONS) {
      expect(PRODUCT_ANALYTICS_DIMENSION_LABELS[dimension]).toBeTruthy();
    }

    expect(
      new Set(Object.values(PRODUCT_ANALYTICS_DIMENSION_LABELS)).size,
    ).toBe(PRODUCT_ANALYTICS_DIMENSIONS.length);
  });

  test("each session length bucket is named, in the buckets' order", () => {
    expect(
      PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.map(
        (bucket: { key: string }): string | undefined => {
          return PRODUCT_ANALYTICS_SESSION_LENGTH_LABELS[bucket.key];
        },
      ),
    ).toEqual([
      "Under 10 seconds",
      "10 to 30 seconds",
      "30 seconds to 1 minute",
      "1 to 3 minutes",
      "3 to 10 minutes",
      "10 to 30 minutes",
      "30 minutes or more",
    ]);
  });
});

describe("a breakdown value as the reader reads it", () => {
  test("a session that reported nothing reads Not reported, never a blank row", () => {
    for (const dimension of PRODUCT_ANALYTICS_DIMENSIONS) {
      expect(
        describeProductAnalyticsValue({
          dimension: dimension,
          value: "  ",
          translator: english,
        }),
      ).toBe("Not reported");
    }

    expect(
      describeProductAnalyticsValue({
        dimension: ProductAnalyticsDimension.Browser,
        value: "",
        translator: german,
      }),
    ).toBe("Nicht gemeldet");
  });

  test("a device type is a word of the reader's language, whatever its case", () => {
    expect(
      describeProductAnalyticsValue({
        dimension: ProductAnalyticsDimension.DeviceType,
        value: "desktop",
        translator: english,
      }),
    ).toBe("Desktop");
    expect(describeProductAnalyticsDevice(" Mobile ", english)).toBe("Mobile");
    expect(describeProductAnalyticsDevice("TABLET", english)).toBe("Tablet");
    expect(describeProductAnalyticsDevice("mobile", german)).toBe("Mobilgerät");
    expect(describeProductAnalyticsDevice("", german)).toBe("Nicht gemeldet");
    /* A type the recorders may add later reads as written. */
    expect(describeProductAnalyticsDevice("tv", english)).toBe("tv");
  });

  test("a country is its name in the reader's language, a code it cannot name stays a code", () => {
    expect(describeProductAnalyticsCountry("DE", "en")).toBe("Germany");
    expect(describeProductAnalyticsCountry("de", "de")).toBe("Deutschland");
    expect(describeProductAnalyticsCountry(" fr ", "en")).toBe("France");
    expect(describeProductAnalyticsCountry("XYZ", "en")).toBe("XYZ");
    expect(describeProductAnalyticsCountry("1A", "en")).toBe("1A");
    /* A language the runtime refuses still names the country, in English. */
    expect(describeProductAnalyticsCountry("JP", "not a language")).toBe("JP");
    expect(
      describeProductAnalyticsValue({
        dimension: ProductAnalyticsDimension.Country,
        value: "US",
        translator: english,
      }),
    ).toBe("United States");
  });

  test("a browser, a version or a page reads as the recorder wrote it, trimmed", () => {
    expect(
      describeProductAnalyticsValue({
        dimension: ProductAnalyticsDimension.Browser,
        value: " Chrome ",
        translator: german,
      }),
    ).toBe("Chrome");
    expect(
      describeProductAnalyticsValue({
        dimension: ProductAnalyticsDimension.Page,
        value: "https://app.acme.com/checkout",
        translator: english,
      }),
    ).toBe("https://app.acme.com/checkout");
    expect(
      describeProductAnalyticsValue({
        dimension: ProductAnalyticsDimension.AppVersion,
        value: "desktop",
        translator: english,
      }),
    ).toBe("desktop");
  });
});

describe("numbers", () => {
  test("a count is a whole number in the reader's digits", () => {
    expect(formatProductAnalyticsCount(1234.4, english)).toBe("1,234");
    expect(formatProductAnalyticsCount(1234.6, german)).toBe("1.235");
    expect(formatProductAnalyticsCount(0, english)).toBe("0");
  });

  test("a share is a whole percent, a tenth below one percent, and 0% of nothing", () => {
    expect(
      formatProductAnalyticsShare({ part: 1, whole: 3, language: "en" }),
    ).toBe("33%");
    expect(
      formatProductAnalyticsShare({ part: 1, whole: 200, language: "en" }),
    ).toBe("0.5%");
    expect(
      formatProductAnalyticsShare({ part: 5, whole: 0, language: "en" }),
    ).toBe("0%");
    expect(
      formatProductAnalyticsShare({ part: 0, whole: 9, language: "en" }),
    ).toBe("0%");
    expect(
      formatProductAnalyticsShare({ part: 1, whole: 1, language: "en" }),
    ).toBe("100%");
    expect(
      formatProductAnalyticsShare({ part: 1, whole: 4, language: "de" }),
    ).toBe("25 %");
  });

  test("a length is in whole seconds and never below zero", () => {
    expect(formatProductAnalyticsDuration(135000, "en")).toBe("2m 15s");
    expect(formatProductAnalyticsDuration(999, "en")).toBe("1s");
    expect(formatProductAnalyticsDuration(-5000, "en")).toBe("0s");
    expect(formatProductAnalyticsDuration(0, "en")).toBe("0s");
    /* Two parts at most: an hour long session reads to the minute. */
    expect(formatProductAnalyticsDuration(3723000, "en")).toBe("1h 2m");
  });

  test("an average keeps one decimal at most, in the reader's digits", () => {
    expect(formatProductAnalyticsAverage(2.345, "en")).toBe("2.3");
    expect(formatProductAnalyticsAverage(2.345, "de")).toBe("2,3");
    expect(formatProductAnalyticsAverage(3, "en")).toBe("3");
    expect(formatProductAnalyticsAverage(0, "en")).toBe("0");
  });
});

describe("how a number moved since the range before", () => {
  test("nothing at all when both ranges are empty", () => {
    expect(
      describeProductAnalyticsChange({
        current: 0,
        previous: 0,
        translator: english,
      }),
    ).toBeUndefined();
  });

  test("none before is said as none, not as an infinite rise", () => {
    expect(
      describeProductAnalyticsChange({
        current: 12,
        previous: 0,
        translator: english,
      }),
    ).toBe("None in the previous period");
    expect(
      describeProductAnalyticsChange({
        current: 12,
        previous: 0,
        translator: german,
      }),
    ).toBe("Keine im vorherigen Zeitraum");
  });

  test("up and down in whole percents of the range before", () => {
    expect(
      describeProductAnalyticsChange({
        current: 110,
        previous: 100,
        translator: english,
      }),
    ).toBe("Up 10% on the previous period");
    expect(
      describeProductAnalyticsChange({
        current: 50,
        previous: 100,
        translator: english,
      }),
    ).toBe("Down 50% on the previous period");
    expect(
      describeProductAnalyticsChange({
        current: 0,
        previous: 40,
        translator: english,
      }),
    ).toBe("Down 100% on the previous period");
    expect(
      describeProductAnalyticsChange({
        current: 300,
        previous: 100,
        translator: german,
      }),
    ).toBe("200 % mehr als im vorherigen Zeitraum");
  });

  test("a move under half a percent is the same", () => {
    expect(
      describeProductAnalyticsChange({
        current: 1000,
        previous: 1004,
        translator: english,
      }),
    ).toBe("Same as the previous period");
    expect(
      describeProductAnalyticsChange({
        current: 7,
        previous: 7,
        translator: german,
      }),
    ).toBe("Gleich wie im vorherigen Zeitraum");
    /* Half a percent and over is a move. */
    expect(
      describeProductAnalyticsChange({
        current: 1005,
        previous: 1000,
        translator: english,
      }),
    ).toBe("Up 0.5% on the previous period");
  });

  test("a negative count from a confused server reads as zero", () => {
    expect(
      describeProductAnalyticsChange({
        current: -3,
        previous: -1,
        translator: english,
      }),
    ).toBeUndefined();
    expect(
      describeProductAnalyticsChange({
        current: 4,
        previous: -1,
        translator: english,
      }),
    ).toBe("None in the previous period");
  });
});

describe("a person as a row names them", () => {
  test("a signed-in user the reader may see is named by their reference", () => {
    expect(describeProductAnalyticsPerson(person({}), english)).toEqual({
      primary: "jane@acme.com",
      secondary: "Signed-in user",
      isLabel: true,
    });
    expect(
      describeProductAnalyticsPerson(
        person({ identifiedUserLabel: "  Jane  " }),
        german,
      ),
    ).toEqual({
      primary: "Jane",
      secondary: "Angemeldeter Benutzer",
      isLabel: true,
    });
  });

  test("a signed-in user without a name, hidden or never captured, is named by the start of their key", () => {
    for (const label of [undefined, "", "   "]) {
      expect(
        describeProductAnalyticsPerson(
          person({ identifiedUserLabel: label }),
          english,
        ),
      ).toEqual({
        primary: "Signed-in user",
        secondary: "9f86d081…",
        isLabel: false,
      });
    }
  });

  test("an anonymous visitor is named as one, with the start of their browser's id", () => {
    expect(
      describeProductAnalyticsPerson(
        person({
          personKey: `v:${VISITOR_ID}`,
          kind: "visitor",
          identifiedUserKey: "",
          /* A visitor never has a name, even if a server sent one. */
          identifiedUserLabel: "someone",
        }),
        german,
      ),
    ).toEqual({
      primary: "Anonymer Besucher",
      secondary: "7f3a2b1c…",
      isLabel: false,
    });
  });

  test("a short id is the first eight characters, and a shorter one is left whole", () => {
    expect(shortProductAnalyticsId("abcdefghij")).toBe("abcdefgh…");
    expect(shortProductAnalyticsId("abcdefgh")).toBe("abcdefgh");
    expect(shortProductAnalyticsId("")).toBe("");
  });
});

describe("the zone days are counted in", () => {
  test("a zone the runtime knows, spelled as the runtime spells it", () => {
    expect(getProductAnalyticsTimeZone("America/New_York")).toBe(
      "America/New_York",
    );
    expect(getProductAnalyticsTimeZone("america/new_york")).toBe(
      "America/New_York",
    );
    /* ICU may answer the older name; ClickHouse knows both. */
    expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(
      getProductAnalyticsTimeZone("asia/kolkata"),
    );
  });

  test("anything else is UTC, so the trend never fails over a zone name", () => {
    for (const zone of [
      undefined,
      "",
      "Mars/Olympus_Mons",
      "UTC'; DROP TABLE x",
      "../../etc/passwd",
      "a".repeat(200),
    ]) {
      expect(getProductAnalyticsTimeZone(zone)).toBe("UTC");
    }
  });
});

describe("the instant a day starts in a zone", () => {
  test("UTC days start at midnight UTC", () => {
    expect(iso(getProductAnalyticsDayStart("2026-03-01", "UTC"))).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    expect(iso(getProductAnalyticsDayStart("2024-02-29", "UTC"))).toBe(
      "2024-02-29T00:00:00.000Z",
    );
  });

  test("a zone ahead of UTC starts its day the evening before, in winter and in summer", () => {
    expect(
      iso(getProductAnalyticsDayStart("2026-01-16", "Europe/Berlin")),
    ).toBe("2026-01-15T23:00:00.000Z");
    expect(
      iso(getProductAnalyticsDayStart("2026-07-16", "Europe/Berlin")),
    ).toBe("2026-07-15T22:00:00.000Z");
    expect(iso(getProductAnalyticsDayStart("2026-06-01", "Asia/Kolkata"))).toBe(
      "2026-05-31T18:30:00.000Z",
    );
  });

  test("the days either side of a spring-forward each start at their own midnight", () => {
    /* Berlin goes to summer time at 02:00 on 29 March 2026. */
    expect(
      iso(getProductAnalyticsDayStart("2026-03-29", "Europe/Berlin")),
    ).toBe("2026-03-28T23:00:00.000Z");
    expect(
      iso(getProductAnalyticsDayStart("2026-03-30", "Europe/Berlin")),
    ).toBe("2026-03-29T22:00:00.000Z");
    /* New York on 8 March 2026. */
    expect(
      iso(getProductAnalyticsDayStart("2026-03-08", "America/New_York")),
    ).toBe("2026-03-08T05:00:00.000Z");
    expect(
      iso(getProductAnalyticsDayStart("2026-03-09", "America/New_York")),
    ).toBe("2026-03-09T04:00:00.000Z");
  });

  test("and either side of a fall-back", () => {
    /* New York goes back an hour at 02:00 on 1 November 2026. */
    expect(
      iso(getProductAnalyticsDayStart("2026-11-01", "America/New_York")),
    ).toBe("2026-11-01T04:00:00.000Z");
    expect(
      iso(getProductAnalyticsDayStart("2026-11-02", "America/New_York")),
    ).toBe("2026-11-02T05:00:00.000Z");
  });

  test("the far ends of the clock: +14, -3:30 and +5:45", () => {
    expect(
      iso(getProductAnalyticsDayStart("2026-05-01", "Pacific/Kiritimati")),
    ).toBe("2026-04-30T10:00:00.000Z");
    expect(
      iso(getProductAnalyticsDayStart("2026-01-10", "America/St_Johns")),
    ).toBe("2026-01-10T03:30:00.000Z");
    expect(
      iso(getProductAnalyticsDayStart("2026-01-10", "Asia/Kathmandu")),
    ).toBe("2026-01-09T18:15:00.000Z");
  });

  test("a day with no midnight starts at its first instant, never on the day before", () => {
    /*
     * Chile springs forward at 24:00 on Saturday 5 September 2026: Sunday's
     * clocks start at 01:00 (-03), which is 04:00 UTC.
     */
    expect(
      iso(getProductAnalyticsDayStart("2026-09-06", "America/Santiago")),
    ).toBe("2026-09-06T04:00:00.000Z");
    /* The day before and the day after are ordinary. */
    expect(
      iso(getProductAnalyticsDayStart("2026-09-05", "America/Santiago")),
    ).toBe("2026-09-05T04:00:00.000Z");
    expect(
      iso(getProductAnalyticsDayStart("2026-09-07", "America/Santiago")),
    ).toBe("2026-09-07T03:00:00.000Z");
  });

  test("every day of a year starts on that day in its zone, a day after the one before", () => {
    for (const zone of [
      "UTC",
      "Europe/Berlin",
      "America/New_York",
      "America/Santiago",
      "Australia/Lord_Howe",
      "Asia/Tehran",
      "Pacific/Chatham",
    ]) {
      let previous: Date | null = null;

      for (let index: number = 0; index < 366; index++) {
        const date: string = new Date(Date.UTC(2026, 0, 1 + index))
          .toISOString()
          .slice(0, 10);
        const start: Date | null = getProductAnalyticsDayStart(date, zone);

        expect(start).not.toBeNull();

        const local: string = new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(start!);

        expect(`${zone} ${local}`).toBe(`${zone} ${date}`);

        if (previous) {
          const hours: number =
            (start!.getTime() - previous.getTime()) / 3600000;

          /* 23 to 25 hours, or Lord Howe's half-hour step. */
          expect(hours).toBeGreaterThanOrEqual(22.5);
          expect(hours).toBeLessThanOrEqual(25);
        }

        previous = start;
      }
    }
  });

  test("anything that is not a day is null", () => {
    for (const value of [
      "",
      "2026-3-1",
      "2026-02-30",
      "2026-13-01",
      "2026-03-01T00:00:00Z",
      "yesterday",
      " 2026-03-01",
    ]) {
      expect(getProductAnalyticsDayStart(value, "UTC")).toBeNull();
    }
  });
});

describe("the trend as chart lines", () => {
  test("one point a day at the day's start, one line per series, in order", () => {
    const series: Array<SeriesPoint> = toProductAnalyticsSeries({
      days: [
        day("2026-03-28", { activeUsers: 3, newUsers: 1 }),
        day("2026-03-29", { activeUsers: 5, newUsers: 2 }),
      ],
      timeZone: "Europe/Berlin",
      series: [
        {
          seriesName: "Daily active users",
          read: (entry: ProductAnalyticsTrendDayDto): number => {
            return entry.activeUsers;
          },
        },
        {
          seriesName: "New users",
          read: (entry: ProductAnalyticsTrendDayDto): number => {
            return entry.newUsers;
          },
        },
      ],
    });

    expect(
      series.map((line: SeriesPoint): string => {
        return line.seriesName;
      }),
    ).toEqual(["Daily active users", "New users"]);
    expect(
      series[0]!.data.map((point: SeriesPoint["data"][number]) => {
        return [(point.x as Date).toISOString(), point.y];
      }),
    ).toEqual([
      ["2026-03-27T23:00:00.000Z", 3],
      ["2026-03-28T23:00:00.000Z", 5],
    ]);
    expect(
      series[1]!.data.map((point: SeriesPoint["data"][number]) => {
        return point.y;
      }),
    ).toEqual([1, 2]);
  });

  test("a day that is not a day is left out, not drawn at 1970", () => {
    const series: Array<SeriesPoint> = toProductAnalyticsSeries({
      days: [day("2026-03-01"), day("nope"), day("2026-03-02")],
      timeZone: "UTC",
      series: [
        {
          seriesName: "Sessions",
          read: (entry: ProductAnalyticsTrendDayDto): number => {
            return entry.sessions;
          },
        },
      ],
    });

    expect(series[0]!.data).toHaveLength(2);
  });

  test("the window runs from the first day's start to the last day's", () => {
    expect(
      getProductAnalyticsTrendWindow({ days: [], timeZone: "UTC" }),
    ).toBeNull();

    const window: { start: Date; end: Date } | null =
      getProductAnalyticsTrendWindow({
        days: [day("2026-03-01"), day("2026-03-02"), day("2026-03-03")],
        timeZone: "America/New_York",
      });

    expect(iso(window?.start ?? null)).toBe("2026-03-01T05:00:00.000Z");
    expect(iso(window?.end ?? null)).toBe("2026-03-03T05:00:00.000Z");
  });

  test("a single day still has a window: that day", () => {
    const window: { start: Date; end: Date } | null =
      getProductAnalyticsTrendWindow({
        days: [day("2026-03-01")],
        timeZone: "UTC",
      });

    expect(iso(window?.start ?? null)).toBe("2026-03-01T00:00:00.000Z");
    expect(iso(window?.end ?? null)).toBe("2026-03-02T00:00:00.000Z");
  });

  test("a window whose ends are not days is no window", () => {
    expect(
      getProductAnalyticsTrendWindow({
        days: [day("bad"), day("2026-03-02")],
        timeZone: "UTC",
      }),
    ).toBeNull();
  });
});
