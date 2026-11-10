import { describe, expect, test } from "@jest/globals";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS,
  PRODUCT_ANALYTICS_PEOPLE_FILTERS,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleFilter,
} from "../../../Types/Rum/ProductAnalytics";
import {
  DEFAULT_PRODUCT_ANALYTICS_DIMENSION,
  DEFAULT_PRODUCT_ANALYTICS_PEOPLE_FILTER,
  DEFAULT_PRODUCT_ANALYTICS_RANGE,
  ProductAnalyticsUrlState,
  buildProductAnalyticsSearch,
  buildProductAnalyticsUrl,
  readProductAnalyticsUrlState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsUrlState";

/*
 * What the product analytics pages keep in their address (issue #6444): a
 * link opens the page as it was, an untouched page has a clean address,
 * and a value the page does not know - a link is untrusted - reads as the
 * default rather than as an error or a request the server would refuse.
 */

const PAGE: string =
  "https://oneuptime.example/dashboard/p/rum/a/product-analytics-users";

const START: Date = new Date("2026-09-01T00:00:00.000Z");
const END: Date = new Date("2026-09-08T00:00:00.000Z");

function defaults(): ProductAnalyticsUrlState {
  return {
    timeRange: DEFAULT_PRODUCT_ANALYTICS_RANGE,
    filter: DEFAULT_PRODUCT_ANALYTICS_PEOPLE_FILTER,
    dormantAfterDays: DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
    dimension: DEFAULT_PRODUCT_ANALYTICS_DIMENSION,
  };
}

function searchOf(href: string): string {
  return new URL(href).search;
}

describe("the defaults", () => {
  test("a month, the active users, 30 days to dormant, and device type", () => {
    expect(DEFAULT_PRODUCT_ANALYTICS_RANGE).toEqual({
      range: TimeRange.PAST_ONE_MONTH,
    });
    expect(DEFAULT_PRODUCT_ANALYTICS_PEOPLE_FILTER).toBe(
      ProductAnalyticsPeopleFilter.Active,
    );
    expect(DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS).toBe(30);
    expect(DEFAULT_PRODUCT_ANALYTICS_DIMENSION).toBe(
      ProductAnalyticsDimension.DeviceType,
    );
  });

  test("an empty address reads as the defaults", () => {
    expect(readProductAnalyticsUrlState("")).toEqual(defaults());
    expect(readProductAnalyticsUrlState("?")).toEqual(defaults());
  });

  test("the defaults write as absence: an untouched page has a clean address", () => {
    expect(buildProductAnalyticsUrl(PAGE, defaults())).toBe(PAGE);
    expect(buildProductAnalyticsSearch(defaults())).toBe("");
  });
});

describe("reading the address", () => {
  test("each filter, dormant window and dimension the pages offer", () => {
    for (const filter of PRODUCT_ANALYTICS_PEOPLE_FILTERS) {
      expect(readProductAnalyticsUrlState(`?people=${filter}`).filter).toBe(
        filter,
      );
    }

    for (const days of PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS) {
      expect(
        readProductAnalyticsUrlState(`?dormant=${days}`).dormantAfterDays,
      ).toBe(days);
    }

    for (const dimension of PRODUCT_ANALYTICS_DIMENSIONS) {
      expect(readProductAnalyticsUrlState(`?by=${dimension}`).dimension).toBe(
        dimension,
      );
    }
  });

  test("a value the pages do not offer is the default, never passed on", () => {
    const state: ProductAnalyticsUrlState = readProductAnalyticsUrlState(
      "?people=admins&dormant=45&by=plan&range=Forever",
    );

    expect(state).toEqual(defaults());

    for (const dormant of ["0", "-30", "30.5", "1e9", "abc", ""]) {
      expect(
        readProductAnalyticsUrlState(`?dormant=${dormant}`).dormantAfterDays,
      ).toBe(DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS);
    }

    /* Case matters: the server knows "signed-in", not "Signed-In". */
    expect(readProductAnalyticsUrlState("?people=Signed-In").filter).toBe(
      DEFAULT_PRODUCT_ANALYTICS_PEOPLE_FILTER,
    );
  });

  test("a named range, in either encoding", () => {
    expect(
      readProductAnalyticsUrlState("?range=Past+1+Week").timeRange,
    ).toEqual({ range: TimeRange.PAST_ONE_WEEK });
    expect(
      readProductAnalyticsUrlState("?range=Past%203%20Months").timeRange,
    ).toEqual({ range: TimeRange.PAST_THREE_MONTHS });
  });

  test("Custom without its two times is no range", () => {
    expect(readProductAnalyticsUrlState("?range=Custom").timeRange).toEqual(
      DEFAULT_PRODUCT_ANALYTICS_RANGE,
    );
  });

  test("an absolute window wins over a stale named range", () => {
    const state: ProductAnalyticsUrlState = readProductAnalyticsUrlState(
      `?range=Past+1+Week&startTime=${START.toISOString()}&endTime=${END.toISOString()}`,
    );

    expect(state.timeRange.range).toBe(TimeRange.CUSTOM);
    expect(state.timeRange.startAndEndDate?.startValue.toISOString()).toBe(
      START.toISOString(),
    );
    expect(state.timeRange.startAndEndDate?.endValue.toISOString()).toBe(
      END.toISOString(),
    );
  });

  test("a window that ends before it starts, or is not a time, falls back to the named range", () => {
    expect(
      readProductAnalyticsUrlState(
        `?range=Past+1+Week&startTime=${END.toISOString()}&endTime=${START.toISOString()}`,
      ).timeRange,
    ).toEqual({ range: TimeRange.PAST_ONE_WEEK });
    expect(
      readProductAnalyticsUrlState(
        `?startTime=yesterday&endTime=${END.toISOString()}`,
      ).timeRange,
    ).toEqual(DEFAULT_PRODUCT_ANALYTICS_RANGE);
    expect(
      readProductAnalyticsUrlState(`?startTime=${START.toISOString()}`)
        .timeRange,
    ).toEqual(DEFAULT_PRODUCT_ANALYTICS_RANGE);
    /* An empty window is no window either. */
    expect(
      readProductAnalyticsUrlState(
        `?startTime=${START.toISOString()}&endTime=${START.toISOString()}`,
      ).timeRange,
    ).toEqual(DEFAULT_PRODUCT_ANALYTICS_RANGE);
  });
});

describe("writing the address", () => {
  test("each choice off its default is written under its own key", () => {
    expect(
      searchOf(
        buildProductAnalyticsUrl(PAGE, {
          timeRange: { range: TimeRange.PAST_ONE_WEEK },
          filter: ProductAnalyticsPeopleFilter.Dormant,
          dormantAfterDays: 60,
          dimension: ProductAnalyticsDimension.Country,
        }),
      ),
    ).toBe("?range=Past+1+Week&people=dormant&dormant=60&by=country");
  });

  test("going back to a default takes its key away", () => {
    const changed: string = buildProductAnalyticsUrl(PAGE, {
      filter: ProductAnalyticsPeopleFilter.New,
      dimension: ProductAnalyticsDimension.Browser,
      dormantAfterDays: 90,
    });

    expect(
      buildProductAnalyticsUrl(changed, {
        filter: DEFAULT_PRODUCT_ANALYTICS_PEOPLE_FILTER,
        dimension: DEFAULT_PRODUCT_ANALYTICS_DIMENSION,
        dormantAfterDays: DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
      }),
    ).toBe(PAGE);
  });

  test("a part the call does not name is left as it is", () => {
    const withDimension: string = buildProductAnalyticsUrl(PAGE, {
      dimension: ProductAnalyticsDimension.Page,
    });

    expect(
      searchOf(
        buildProductAnalyticsUrl(withDimension, {
          filter: ProductAnalyticsPeopleFilter.All,
        }),
      ),
    ).toBe("?by=page&people=all");
  });

  test("keys the pages do not own are kept", () => {
    expect(
      searchOf(
        buildProductAnalyticsUrl(`${PAGE}?utm_source=mail&people=new`, {
          filter: ProductAnalyticsPeopleFilter.Returning,
        }),
      ),
    ).toBe("?utm_source=mail&people=returning");
  });

  test("an absolute window is written as two ISO times, without range=", () => {
    const href: string = buildProductAnalyticsUrl(`${PAGE}?range=Past+1+Week`, {
      timeRange: {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(START, END),
      },
    });
    const params: URLSearchParams = new URL(href).searchParams;

    expect(params.get("range")).toBeNull();
    expect(params.get("startTime")).toBe(START.toISOString());
    expect(params.get("endTime")).toBe(END.toISOString());
  });

  test("a named range after an absolute one drops the two times", () => {
    const absolute: string = buildProductAnalyticsUrl(PAGE, {
      timeRange: {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(START, END),
      },
    });

    expect(
      searchOf(
        buildProductAnalyticsUrl(absolute, {
          timeRange: { range: TimeRange.PAST_ONE_DAY },
        }),
      ),
    ).toBe("?range=Past+1+Day");
    expect(
      buildProductAnalyticsUrl(absolute, {
        timeRange: DEFAULT_PRODUCT_ANALYTICS_RANGE,
      }),
    ).toBe(PAGE);
  });

  test("Custom without its window writes nothing", () => {
    expect(
      buildProductAnalyticsUrl(`${PAGE}?range=Past+1+Week`, {
        timeRange: { range: TimeRange.CUSTOM },
      }),
    ).toBe(PAGE);
  });
});

describe("what is written is what is read", () => {
  test("every filter, window, dimension and a few ranges round-trip", () => {
    const ranges: Array<ProductAnalyticsUrlState["timeRange"]> = [
      DEFAULT_PRODUCT_ANALYTICS_RANGE,
      { range: TimeRange.PAST_ONE_DAY },
      { range: TimeRange.PAST_THREE_MONTHS },
      {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(START, END),
      },
    ];

    for (const timeRange of ranges) {
      for (const filter of PRODUCT_ANALYTICS_PEOPLE_FILTERS) {
        for (const dormantAfterDays of PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS) {
          const dimension: ProductAnalyticsDimension =
            PRODUCT_ANALYTICS_DIMENSIONS[
              (filter.length + dormantAfterDays) %
                PRODUCT_ANALYTICS_DIMENSIONS.length
            ]!;
          const state: ProductAnalyticsUrlState = {
            timeRange: timeRange,
            filter: filter,
            dormantAfterDays: dormantAfterDays,
            dimension: dimension,
          };
          const read: ProductAnalyticsUrlState = readProductAnalyticsUrlState(
            searchOf(buildProductAnalyticsUrl(PAGE, state)),
          );

          expect(read.filter).toBe(filter);
          expect(read.dormantAfterDays).toBe(dormantAfterDays);
          expect(read.dimension).toBe(dimension);
          expect(read.timeRange.range).toBe(timeRange.range);
          expect(read.timeRange.startAndEndDate?.startValue.toISOString()).toBe(
            timeRange.startAndEndDate?.startValue.toISOString(),
          );
          expect(read.timeRange.startAndEndDate?.endValue.toISOString()).toBe(
            timeRange.startAndEndDate?.endValue.toISOString(),
          );
          expect(
            readProductAnalyticsUrlState(buildProductAnalyticsSearch(state)),
          ).toEqual(read);
        }
      }
    }
  });

  test("the search alone is the state as a query string, for a link that carries it", () => {
    expect(
      buildProductAnalyticsSearch({
        filter: ProductAnalyticsPeopleFilter.Dormant,
        dormantAfterDays: 60,
      }),
    ).toBe("?people=dormant&dormant=60");
    expect(
      buildProductAnalyticsSearch({
        timeRange: { range: TimeRange.PAST_ONE_WEEK },
      }),
    ).toBe("?range=Past+1+Week");
  });
});
