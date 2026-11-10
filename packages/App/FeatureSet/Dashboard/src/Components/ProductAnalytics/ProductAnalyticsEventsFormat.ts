import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { ProductAnalyticsEventKind } from "Common/Types/Rum/ProductAnalyticsEvents";
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
  ProductAnalyticsFieldRef,
  ProductAnalyticsRetentionPeriod,
  ProductAnalyticsSegmentFilter,
  isProductAnalyticsKeyedField,
  isSameProductAnalyticsEvent,
  toProductAnalyticsEventRef,
  toProductAnalyticsFieldRef,
  toProductAnalyticsSegmentFilter,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import { ProductAnalyticsDimension } from "Common/Types/Rum/ProductAnalytics";
import {
  NOT_REPORTED,
  describeProductAnalyticsValue,
  findProductAnalyticsCountryCode,
  findProductAnalyticsDeviceType,
  getProductAnalyticsZoneDay,
} from "./ProductAnalyticsFormat";
import { readProductAnalyticsRange } from "./ProductAnalyticsUrlState";

/*
 * The words and the addresses of the Events, Funnels and Retention pages
 * (issue #6444, part two), kept apart from React so each rule is tested on
 * its own. Every label is English the extractor finds (translationKey) and
 * the page looks up where it draws it. Everything read from an address is
 * untrusted: a value the page does not know reads as the default.
 */

/* ---- Events. ---- */

export const SESSION_STARTED: string = translationKey("Session started");
export const PAGE_VIEW_TEMPLATE: string = translationKey("Viewed {{page}}");

export const PRODUCT_ANALYTICS_EVENT_GROUP_LABELS: Record<
  ProductAnalyticsEventKind,
  string
> = {
  [ProductAnalyticsEventKind.Custom]: translationKey("Your events"),
  [ProductAnalyticsEventKind.Page]: translationKey("Page views"),
  [ProductAnalyticsEventKind.Session]: translationKey("Sessions"),
};

/* The session's start: the event every funnel and cohort can begin with. */
export const SESSION_START_EVENT: ProductAnalyticsEventRef = {
  kind: ProductAnalyticsEventKind.Session,
  name: "",
};

/*
 * An event as the reader reads it: a session's start in their language, a
 * page view as "Viewed /pricing", one of the application's own events by
 * the name it sent.
 */
export function describeProductAnalyticsEvent(
  event: ProductAnalyticsEventRef,
  translator: Translator,
): string {
  if (event.kind === ProductAnalyticsEventKind.Session) {
    return translator.translateText(SESSION_STARTED) || SESSION_STARTED;
  }

  if (event.kind === ProductAnalyticsEventKind.Page) {
    return translator.translateTemplate(PAGE_VIEW_TEMPLATE, {
      page: event.name,
    });
  }

  return event.name;
}

/* An event as one address value: "custom:Signed up", "page:/pricing", "session:". */
export function encodeProductAnalyticsEvent(
  event: ProductAnalyticsEventRef,
): string {
  return `${event.kind}:${event.name}`;
}

export function decodeProductAnalyticsEvent(
  value: string | null | undefined,
): ProductAnalyticsEventRef | null {
  if (typeof value !== "string") {
    return null;
  }

  const colon: number = value.indexOf(":");

  if (colon <= 0) {
    return null;
  }

  return toProductAnalyticsEventRef({
    kind: value.slice(0, colon),
    name: value.slice(colon + 1),
  });
}

export function isProductAnalyticsEventListed(
  event: ProductAnalyticsEventRef,
  events: ReadonlyArray<ProductAnalyticsEventNameDto>,
): boolean {
  return events.some((candidate: ProductAnalyticsEventNameDto): boolean => {
    return isSameProductAnalyticsEvent(candidate, event);
  });
}

/*
 * The event a page opens on when its address names none: the
 * application's most frequent event of its own, else its most viewed page,
 * else a session's start. The list arrives most frequent first.
 */
export function pickDefaultProductAnalyticsEvent(
  events: ReadonlyArray<ProductAnalyticsEventNameDto>,
): ProductAnalyticsEventRef {
  for (const kind of [
    ProductAnalyticsEventKind.Custom,
    ProductAnalyticsEventKind.Page,
  ]) {
    const first: ProductAnalyticsEventNameDto | undefined = events.find(
      (event: ProductAnalyticsEventNameDto): boolean => {
        return event.kind === kind;
      },
    );

    if (first) {
      return { kind: first.kind, name: first.name };
    }
  }

  return SESSION_START_EVENT;
}

/* ---- Fields: what an event is broken down and segmented by. ---- */

export const PRODUCT_ANALYTICS_EVENT_FIELD_LABELS: Record<
  ProductAnalyticsEventField,
  string
> = {
  [ProductAnalyticsEventField.DeviceType]: translationKey("Device type"),
  [ProductAnalyticsEventField.Browser]: translationKey("Browser"),
  [ProductAnalyticsEventField.OperatingSystem]:
    translationKey("Operating system"),
  [ProductAnalyticsEventField.Country]: translationKey("Country"),
  [ProductAnalyticsEventField.AppVersion]: translationKey("App version"),
  [ProductAnalyticsEventField.Page]: translationKey("Page"),
  [ProductAnalyticsEventField.Property]: translationKey("Event property"),
  [ProductAnalyticsEventField.UserProperty]: translationKey("User property"),
};

export const PROPERTY_FIELD_TEMPLATE: string = translationKey(
  "Event property: {{key}}",
);
export const USER_PROPERTY_FIELD_TEMPLATE: string = translationKey(
  "User property: {{key}}",
);

/* The fields that need no key, in the order the pages offer them. */
export const PRODUCT_ANALYTICS_PLAIN_FIELDS: ReadonlyArray<ProductAnalyticsEventField> =
  PRODUCT_ANALYTICS_EVENT_FIELDS.filter(
    (field: ProductAnalyticsEventField): boolean => {
      return !isProductAnalyticsKeyedField(field);
    },
  );

export function describeProductAnalyticsField(
  ref: ProductAnalyticsFieldRef,
  translator: Translator,
): string {
  if (ref.field === ProductAnalyticsEventField.Property) {
    return translator.translateTemplate(PROPERTY_FIELD_TEMPLATE, {
      key: ref.key,
    });
  }

  if (ref.field === ProductAnalyticsEventField.UserProperty) {
    return translator.translateTemplate(USER_PROPERTY_FIELD_TEMPLATE, {
      key: ref.key,
    });
  }

  const label: string = PRODUCT_ANALYTICS_EVENT_FIELD_LABELS[ref.field];

  return translator.translateText(label) || label;
}

/* A field as one dropdown value: "deviceType", "property:plan", "userProperty:role". */
export function encodeProductAnalyticsField(ref: ProductAnalyticsFieldRef): string {
  return isProductAnalyticsKeyedField(ref.field)
    ? `${ref.field}:${ref.key}`
    : ref.field;
}

export function decodeProductAnalyticsField(
  value: string | null | undefined,
): ProductAnalyticsFieldRef | null {
  if (typeof value !== "string") {
    return null;
  }

  const colon: number = value.indexOf(":");

  return toProductAnalyticsFieldRef(
    colon < 0
      ? { field: value, key: "" }
      : { field: value.slice(0, colon), key: value.slice(colon + 1) },
  );
}

const DIMENSION_OF_FIELD: Partial<
  Record<ProductAnalyticsEventField, ProductAnalyticsDimension>
> = {
  [ProductAnalyticsEventField.DeviceType]: ProductAnalyticsDimension.DeviceType,
  [ProductAnalyticsEventField.Country]: ProductAnalyticsDimension.Country,
};

/*
 * A field's value as the reader reads it: a device type in their language,
 * a country by its name, anything else as the application sent it; "Not
 * reported" for an event that carried none.
 */
export function describeProductAnalyticsFieldValue(data: {
  field: ProductAnalyticsEventField;
  value: string;
  translator: Translator;
}): string {
  const dimension: ProductAnalyticsDimension | undefined =
    DIMENSION_OF_FIELD[data.field];

  if (dimension) {
    return describeProductAnalyticsValue({
      dimension: dimension,
      value: data.value,
      translator: data.translator,
    });
  }

  return data.value.trim()
    ? data.value
    : data.translator.translateText(NOT_REPORTED) || NOT_REPORTED;
}

/*
 * A value typed into a segment as the events store it: a device type or a
 * country by its code ("desktop", "DE"), whether typed as the code or by
 * its name in the reader's language; anything else as typed. A segment
 * matches values exactly, so "Germany" would otherwise match nothing.
 */
export function toProductAnalyticsFilterValue(data: {
  field: ProductAnalyticsEventField;
  value: string;
  translator: Translator;
}): string {
  const value: string = data.value.trim();

  if (data.field === ProductAnalyticsEventField.DeviceType) {
    return findProductAnalyticsDeviceType(value, data.translator) || value;
  }

  if (data.field === ProductAnalyticsEventField.Country) {
    return (
      findProductAnalyticsCountryCode(value, data.translator.language) || value
    );
  }

  return value;
}

export function isSameProductAnalyticsFilter(
  left: ProductAnalyticsSegmentFilter,
  right: ProductAnalyticsSegmentFilter,
): boolean {
  return (
    left.field === right.field &&
    left.key === right.key &&
    left.value === right.value
  );
}

/*
 * A segment with one more filter: the same field and key matches one value
 * at a time, so a new value for it replaces the old one; past the cap, the
 * segment stays as it was.
 */
export function addProductAnalyticsFilter(
  filters: ReadonlyArray<ProductAnalyticsSegmentFilter>,
  filter: ProductAnalyticsSegmentFilter,
): Array<ProductAnalyticsSegmentFilter> {
  const others: Array<ProductAnalyticsSegmentFilter> = filters.filter(
    (candidate: ProductAnalyticsSegmentFilter): boolean => {
      return !(
        candidate.field === filter.field && candidate.key === filter.key
      );
    },
  );

  if (others.length >= PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS) {
    return [...filters];
  }

  return [...others, filter];
}

/* ---- Funnels. ---- */

export const PRODUCT_ANALYTICS_FUNNEL_WINDOW_LABELS: Record<number, string> = {
  [60 * 60 * 1000]: translationKey("Within 1 hour"),
  [24 * 60 * 60 * 1000]: translationKey("Within 1 day"),
  [7 * 24 * 60 * 60 * 1000]: translationKey("Within 7 days"),
  [14 * 24 * 60 * 60 * 1000]: translationKey("Within 14 days"),
  [30 * 24 * 60 * 60 * 1000]: translationKey("Within 30 days"),
};

/* ---- Retention. ---- */

export const PRODUCT_ANALYTICS_RETENTION_PERIOD_LABELS: Record<
  ProductAnalyticsRetentionPeriod,
  string
> = {
  [ProductAnalyticsRetentionPeriod.Day]: translationKey("By day"),
  [ProductAnalyticsRetentionPeriod.Week]: translationKey("By week"),
  [ProductAnalyticsRetentionPeriod.Month]: translationKey("By month"),
};

const DAY_MS: number = 24 * 60 * 60 * 1000;

/*
 * How many periods a range spans in the reader's zone, as the retention
 * read counts them: from the period the range starts in to the one it ends
 * in, both counted, weeks from Monday. A month from a time of day to the
 * same time a month later spans up to 32 days.
 */
export function countProductAnalyticsRetentionPeriods(data: {
  period: ProductAnalyticsRetentionPeriod;
  startTime: Date;
  endTime: Date;
  timeZone: string;
}): number {
  const start: number = data.startTime.getTime();
  const days: Array<Array<number>> = [
    start,
    Math.max(start, data.endTime.getTime()),
  ].map((instant: number): Array<number> => {
    return getProductAnalyticsZoneDay(instant, data.timeZone)
      .split("-")
      .map(Number);
  });
  const [firstYear, firstMonth, firstDay] = days[0] as Array<number>;
  const [lastYear, lastMonth, lastDay] = days[1] as Array<number>;

  if (data.period === ProductAnalyticsRetentionPeriod.Month) {
    return (
      lastYear! * 12 + lastMonth! - (firstYear! * 12 + firstMonth!) + 1
    );
  }

  const dayNumber: (year: number, month: number, day: number) => number = (
    year: number,
    month: number,
    day: number,
  ): number => {
    return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
  };
  const first: number = dayNumber(firstYear!, firstMonth!, firstDay!);
  const last: number = dayNumber(lastYear!, lastMonth!, lastDay!);

  if (data.period === ProductAnalyticsRetentionPeriod.Day) {
    return last - first + 1;
  }

  const monday: (day: number) => number = (day: number): number => {
    return day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);
  };

  return Math.round((monday(last) - monday(first)) / 7) + 1;
}

/*
 * The period a range is read by: the one picked, or - when the range spans
 * more of them than one read covers - the next longer one that fits, so
 * "By day" over a quarter reads by week instead of failing.
 */
export function fitProductAnalyticsRetentionPeriod(data: {
  period: ProductAnalyticsRetentionPeriod;
  startTime: Date;
  endTime: Date;
  timeZone: string;
}): ProductAnalyticsRetentionPeriod {
  const candidates: Array<ProductAnalyticsRetentionPeriod> =
    PRODUCT_ANALYTICS_RETENTION_PERIODS.slice(
      Math.max(0, PRODUCT_ANALYTICS_RETENTION_PERIODS.indexOf(data.period)),
    );

  for (const period of candidates) {
    if (
      countProductAnalyticsRetentionPeriods({ ...data, period: period }) <=
      PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS[period]
    ) {
      return period;
    }
  }

  return ProductAnalyticsRetentionPeriod.Month;
}

/* The column over the n-th period after a cohort's own: "Week 0" is the cohort's week. */
export function describeProductAnalyticsRetentionColumn(data: {
  period: ProductAnalyticsRetentionPeriod;
  index: number;
  translator: Translator;
}): string {
  const values: { number: string } = {
    number: data.translator.formatNumber(data.index),
  };

  if (data.period === ProductAnalyticsRetentionPeriod.Day) {
    return data.translator.translateTemplate("Day {{number}}", values);
  }

  if (data.period === ProductAnalyticsRetentionPeriod.Month) {
    return data.translator.translateTemplate("Month {{number}}", values);
  }

  return data.translator.translateTemplate("Week {{number}}", values);
}

/*
 * How strongly a cell is shaded: its share of the cohort, from a faint
 * tint to full, so a glance down a column finds where people stop coming
 * back. The figure is always printed too.
 */
export function getProductAnalyticsRetentionShade(share: number): number {
  if (!Number.isFinite(share) || share <= 0) {
    return 0;
  }

  return Math.round((0.08 + Math.min(1, share) * 0.72) * 100) / 100;
}

/* ---- The pages' addresses. ---- */

export const PRODUCT_ANALYTICS_EVENTS_URL_KEYS: {
  event: string;
  segment: string;
  breakdown: string;
  step: string;
  window: string;
  start: string;
  return: string;
  period: string;
} = {
  event: "event",
  segment: "segment",
  breakdown: "by",
  step: "step",
  window: "within",
  start: "start",
  return: "return",
  period: "per",
};

export const DEFAULT_PRODUCT_ANALYTICS_EVENT_BREAKDOWN: ProductAnalyticsFieldRef =
  { field: ProductAnalyticsEventField.DeviceType, key: "" };

export const DEFAULT_PRODUCT_ANALYTICS_RETENTION_PERIOD: ProductAnalyticsRetentionPeriod =
  ProductAnalyticsRetentionPeriod.Week;

export interface ProductAnalyticsEventsUrlState {
  timeRange: RangeStartAndEndDateTime;
  /* Null: the page picks one once it knows the application's events. */
  event: ProductAnalyticsEventRef | null;
  filters: Array<ProductAnalyticsSegmentFilter>;
  breakdown: ProductAnalyticsFieldRef;
  /* Funnels: the steps in order; empty until the page picks or is given some. */
  steps: Array<ProductAnalyticsEventRef>;
  windowMs: number;
  /* Retention. */
  startEvent: ProductAnalyticsEventRef;
  returnEvent: ProductAnalyticsEventRef;
  period: ProductAnalyticsRetentionPeriod;
}

export function readProductAnalyticsSegment(
  value: string | null,
): Array<ProductAnalyticsSegmentFilter> {
  if (!value) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  let filters: Array<ProductAnalyticsSegmentFilter> = [];

  for (const entry of parsed as Array<unknown>) {
    const filter: ProductAnalyticsSegmentFilter | null =
      toProductAnalyticsSegmentFilter(entry);

    if (filter) {
      filters = addProductAnalyticsFilter(filters, filter);
    }
  }

  return filters;
}

export function readProductAnalyticsEventsUrlState(
  search: string,
): ProductAnalyticsEventsUrlState {
  const params: URLSearchParams = new URLSearchParams(search);
  const keys: typeof PRODUCT_ANALYTICS_EVENTS_URL_KEYS =
    PRODUCT_ANALYTICS_EVENTS_URL_KEYS;
  const windowMs: number = Number(params.get(keys.window));
  const period: string | null = params.get(keys.period);
  const steps: Array<ProductAnalyticsEventRef> = [];

  for (const value of params.getAll(keys.step)) {
    const step: ProductAnalyticsEventRef | null =
      decodeProductAnalyticsEvent(value);

    if (step && steps.length < PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS) {
      steps.push(step);
    }
  }

  return {
    timeRange: readProductAnalyticsRange(params),
    event: decodeProductAnalyticsEvent(params.get(keys.event)),
    filters: readProductAnalyticsSegment(params.get(keys.segment)),
    breakdown:
      decodeProductAnalyticsField(params.get(keys.breakdown)) ||
      DEFAULT_PRODUCT_ANALYTICS_EVENT_BREAKDOWN,
    steps: steps,
    windowMs: PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS.includes(windowMs)
      ? windowMs
      : DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS,
    startEvent:
      decodeProductAnalyticsEvent(params.get(keys.start)) ||
      SESSION_START_EVENT,
    returnEvent:
      decodeProductAnalyticsEvent(params.get(keys.return)) ||
      SESSION_START_EVENT,
    period:
      period &&
      (PRODUCT_ANALYTICS_RETENTION_PERIODS as ReadonlyArray<string>).includes(
        period,
      )
        ? (period as ProductAnalyticsRetentionPeriod)
        : DEFAULT_PRODUCT_ANALYTICS_RETENTION_PERIOD,
  };
}

/*
 * The address with the pages' own state written in, every default as
 * absence. The range is written by buildProductAnalyticsUrl, which keeps
 * the keys this does not own - so a link from Users to Events keeps it.
 */
export function writeProductAnalyticsEventsUrlState(
  href: string,
  state: Partial<Omit<ProductAnalyticsEventsUrlState, "timeRange">>,
): string {
  const url: URL = new URL(href);
  const params: URLSearchParams = url.searchParams;
  const keys: typeof PRODUCT_ANALYTICS_EVENTS_URL_KEYS =
    PRODUCT_ANALYTICS_EVENTS_URL_KEYS;

  const set: (key: string, value: string | null) => void = (
    key: string,
    value: string | null,
  ): void => {
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  };

  if (state.event !== undefined) {
    set(
      keys.event,
      state.event ? encodeProductAnalyticsEvent(state.event) : null,
    );
  }

  if (state.filters !== undefined) {
    set(
      keys.segment,
      state.filters.length > 0 ? JSON.stringify(state.filters) : null,
    );
  }

  if (state.breakdown !== undefined) {
    const value: string = encodeProductAnalyticsField(state.breakdown);

    set(
      keys.breakdown,
      value ===
        encodeProductAnalyticsField(DEFAULT_PRODUCT_ANALYTICS_EVENT_BREAKDOWN)
        ? null
        : value,
    );
  }

  if (state.steps !== undefined) {
    params.delete(keys.step);

    for (const step of state.steps) {
      params.append(keys.step, encodeProductAnalyticsEvent(step));
    }
  }

  if (state.windowMs !== undefined) {
    set(
      keys.window,
      state.windowMs === DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS
        ? null
        : String(state.windowMs),
    );
  }

  const writeEvent: (
    key: string,
    event: ProductAnalyticsEventRef | undefined,
  ) => void = (
    key: string,
    event: ProductAnalyticsEventRef | undefined,
  ): void => {
    if (event !== undefined) {
      set(
        key,
        isSameProductAnalyticsEvent(event, SESSION_START_EVENT)
          ? null
          : encodeProductAnalyticsEvent(event),
      );
    }
  };

  writeEvent(keys.start, state.startEvent);
  writeEvent(keys.return, state.returnEvent);

  if (state.period !== undefined) {
    set(
      keys.period,
      state.period === DEFAULT_PRODUCT_ANALYTICS_RETENTION_PERIOD
        ? null
        : state.period,
    );
  }

  return url.toString();
}
