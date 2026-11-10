import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS,
  PRODUCT_ANALYTICS_PEOPLE_FILTERS,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleFilter,
} from "Common/Types/Rum/ProductAnalytics";

/*
 * What the product analytics pages keep in their address (issue #6444), so
 * a link opens the page as it was: the range, the people list's filter and
 * dormant window, and the breakdown. The range is spelled with the session
 * list's keys (range, startTime, endTime), so a link from one page to the
 * other keeps it. A value the page does not know reads as the default: a
 * link is untrusted input.
 */

/*
 * A month by default: monthly active users is the number people ask for
 * first, and a day of a product's users says little.
 */
export const DEFAULT_PRODUCT_ANALYTICS_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_MONTH,
};

export const DEFAULT_PRODUCT_ANALYTICS_PEOPLE_FILTER: ProductAnalyticsPeopleFilter =
  ProductAnalyticsPeopleFilter.Active;

export const DEFAULT_PRODUCT_ANALYTICS_DIMENSION: ProductAnalyticsDimension =
  ProductAnalyticsDimension.DeviceType;

export const PRODUCT_ANALYTICS_URL_KEYS: {
  range: string;
  startTime: string;
  endTime: string;
  filter: string;
  dormant: string;
  dimension: string;
} = {
  range: "range",
  startTime: "startTime",
  endTime: "endTime",
  filter: "people",
  dormant: "dormant",
  dimension: "by",
};

export interface ProductAnalyticsUrlState {
  timeRange: RangeStartAndEndDateTime;
  filter: ProductAnalyticsPeopleFilter;
  dormantAfterDays: number;
  dimension: ProductAnalyticsDimension;
}

function readDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

export function readProductAnalyticsRange(
  params: URLSearchParams,
): RangeStartAndEndDateTime {
  const startTime: Date | null = readDate(
    params.get(PRODUCT_ANALYTICS_URL_KEYS.startTime),
  );
  const endTime: Date | null = readDate(
    params.get(PRODUCT_ANALYTICS_URL_KEYS.endTime),
  );

  if (startTime && endTime && startTime.getTime() < endTime.getTime()) {
    return {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(startTime, endTime),
    };
  }

  const range: string | null = params.get(PRODUCT_ANALYTICS_URL_KEYS.range);

  if (
    range &&
    range !== TimeRange.CUSTOM &&
    (Object.values(TimeRange) as Array<string>).includes(range)
  ) {
    return { range: range as TimeRange };
  }

  return DEFAULT_PRODUCT_ANALYTICS_RANGE;
}

export function readProductAnalyticsUrlState(
  search: string,
): ProductAnalyticsUrlState {
  const params: URLSearchParams = new URLSearchParams(search);
  const filter: string | null = params.get(PRODUCT_ANALYTICS_URL_KEYS.filter);
  const dimension: string | null = params.get(
    PRODUCT_ANALYTICS_URL_KEYS.dimension,
  );
  const dormant: number = Number(
    params.get(PRODUCT_ANALYTICS_URL_KEYS.dormant),
  );

  return {
    timeRange: readProductAnalyticsRange(params),
    filter:
      filter &&
      (PRODUCT_ANALYTICS_PEOPLE_FILTERS as ReadonlyArray<string>).includes(
        filter,
      )
        ? (filter as ProductAnalyticsPeopleFilter)
        : DEFAULT_PRODUCT_ANALYTICS_PEOPLE_FILTER,
    dormantAfterDays: PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS_OPTIONS.includes(
      dormant,
    )
      ? dormant
      : DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS,
    dimension:
      dimension &&
      (PRODUCT_ANALYTICS_DIMENSIONS as ReadonlyArray<string>).includes(
        dimension,
      )
        ? (dimension as ProductAnalyticsDimension)
        : DEFAULT_PRODUCT_ANALYTICS_DIMENSION,
  };
}

/*
 * The address with the state written in, every default as absence, so an
 * untouched page has a clean link. Keys the pages do not own are kept.
 */
export function buildProductAnalyticsUrl(
  href: string,
  state: Partial<ProductAnalyticsUrlState>,
): string {
  const url: URL = new URL(href);
  const params: URLSearchParams = url.searchParams;

  if (state.timeRange) {
    params.delete(PRODUCT_ANALYTICS_URL_KEYS.range);
    params.delete(PRODUCT_ANALYTICS_URL_KEYS.startTime);
    params.delete(PRODUCT_ANALYTICS_URL_KEYS.endTime);

    if (
      state.timeRange.range === TimeRange.CUSTOM &&
      state.timeRange.startAndEndDate
    ) {
      params.set(
        PRODUCT_ANALYTICS_URL_KEYS.startTime,
        state.timeRange.startAndEndDate.startValue.toISOString(),
      );
      params.set(
        PRODUCT_ANALYTICS_URL_KEYS.endTime,
        state.timeRange.startAndEndDate.endValue.toISOString(),
      );
    } else if (
      state.timeRange.range !== TimeRange.CUSTOM &&
      state.timeRange.range !== DEFAULT_PRODUCT_ANALYTICS_RANGE.range
    ) {
      params.set(PRODUCT_ANALYTICS_URL_KEYS.range, state.timeRange.range);
    }
  }

  if (state.filter !== undefined) {
    if (state.filter === DEFAULT_PRODUCT_ANALYTICS_PEOPLE_FILTER) {
      params.delete(PRODUCT_ANALYTICS_URL_KEYS.filter);
    } else {
      params.set(PRODUCT_ANALYTICS_URL_KEYS.filter, state.filter);
    }
  }

  if (state.dormantAfterDays !== undefined) {
    if (
      state.dormantAfterDays === DEFAULT_PRODUCT_ANALYTICS_DORMANT_AFTER_DAYS
    ) {
      params.delete(PRODUCT_ANALYTICS_URL_KEYS.dormant);
    } else {
      params.set(
        PRODUCT_ANALYTICS_URL_KEYS.dormant,
        String(state.dormantAfterDays),
      );
    }
  }

  if (state.dimension !== undefined) {
    if (state.dimension === DEFAULT_PRODUCT_ANALYTICS_DIMENSION) {
      params.delete(PRODUCT_ANALYTICS_URL_KEYS.dimension);
    } else {
      params.set(PRODUCT_ANALYTICS_URL_KEYS.dimension, state.dimension);
    }
  }

  return url.toString();
}

/*
 * The state alone as a query string ("?people=dormant&dormant=60", or "" for
 * the defaults). A person's link carries the Users page's, so Back to users
 * opens the page as it was left.
 */
export function buildProductAnalyticsSearch(
  state: Partial<ProductAnalyticsUrlState>,
): string {
  return new URL(buildProductAnalyticsUrl("https://oneuptime.invalid/", state))
    .search;
}
