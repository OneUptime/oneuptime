/*
 * Product analytics, part two (issue #6444): the reads behind a RUM
 * application's Events, Funnels and Retention pages - their routes, limits,
 * request shapes and answers - shared by Common/Server/API/TelemetryAPI.ts,
 * RumProductAnalyticsEventReadService and the Dashboard.
 *
 * Kept apart from ProductAnalyticsEvents.ts, the wire format the recorders
 * share with the ingest: the browser recorder bundles that one into the
 * script served on customers' pages, and nothing here belongs there.
 */

import { PRODUCT_ANALYTICS_ROUTE_PREFIX } from "./ProductAnalytics";
import {
  SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH,
  SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH,
} from "./SessionReplay";
import {
  ProductAnalyticsEventKind,
  isProductAnalyticsEventKind,
  toProductAnalyticsEventName,
  toProductAnalyticsPage,
} from "./ProductAnalyticsEvents";

/* ---- Routes. ---- */

export const PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/event-names`;
export const PRODUCT_ANALYTICS_EVENT_TREND_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/event-trend`;
export const PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/event-breakdown`;
export const PRODUCT_ANALYTICS_EVENT_PROPERTIES_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/event-properties`;
export const PRODUCT_ANALYTICS_FUNNEL_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/funnel`;
export const PRODUCT_ANALYTICS_RETENTION_ROUTE: string = `${PRODUCT_ANALYTICS_ROUTE_PREFIX}/retention`;

/* The events list: the most frequent first. */
export const PRODUCT_ANALYTICS_EVENT_NAMES_LIMIT: number = 200;

/* Property keys offered for an event's breakdown and segments. */
export const PRODUCT_ANALYTICS_PROPERTY_KEYS_LIMIT: number = 50;

/* A segment: events whose field equals a value. All of them must hold. */
export const PRODUCT_ANALYTICS_MAX_SEGMENT_FILTERS: number = 5;

/* A value a segment matches, as written. */
export const PRODUCT_ANALYTICS_MAX_SEGMENT_VALUE_LENGTH: number =
  SESSION_REPLAY_MAX_TRAIT_VALUE_LENGTH;

/*
 * What an event can be broken down and segmented by: what the session ran
 * on and where it was (the same names as part one's breakdown), the event's
 * own properties, and the user properties it carries.
 */
export enum ProductAnalyticsEventField {
  DeviceType = "deviceType",
  Browser = "browser",
  OperatingSystem = "operatingSystem",
  Country = "country",
  AppVersion = "appVersion",
  Page = "page",
  Property = "property",
  UserProperty = "userProperty",
}

export const PRODUCT_ANALYTICS_EVENT_FIELDS: ReadonlyArray<ProductAnalyticsEventField> =
  [
    ProductAnalyticsEventField.DeviceType,
    ProductAnalyticsEventField.Browser,
    ProductAnalyticsEventField.OperatingSystem,
    ProductAnalyticsEventField.Country,
    ProductAnalyticsEventField.AppVersion,
    ProductAnalyticsEventField.Page,
    ProductAnalyticsEventField.Property,
    ProductAnalyticsEventField.UserProperty,
  ];

/* The two fields that need a key: which property, which user property. */
export function isProductAnalyticsKeyedField(
  field: ProductAnalyticsEventField,
): boolean {
  return (
    field === ProductAnalyticsEventField.Property ||
    field === ProductAnalyticsEventField.UserProperty
  );
}

export interface ProductAnalyticsFieldRef {
  field: ProductAnalyticsEventField;
  /* The property's key; "" for the other fields. */
  key: string;
}

export interface ProductAnalyticsSegmentFilter extends ProductAnalyticsFieldRef {
  value: string;
}

/* An event to count: a kind and a name ("" for a session start). */
export interface ProductAnalyticsEventRef {
  kind: ProductAnalyticsEventKind;
  name: string;
}

/*
 * A field reference as a request carries it, or null when it names nothing
 * a read can answer: an unknown field, or a keyed field with no key.
 */
export function toProductAnalyticsFieldRef(
  value: unknown,
): ProductAnalyticsFieldRef | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const field: unknown = record["field"];

  if (
    !PRODUCT_ANALYTICS_EVENT_FIELDS.includes(
      field as ProductAnalyticsEventField,
    )
  ) {
    return null;
  }

  const typedField: ProductAnalyticsEventField =
    field as ProductAnalyticsEventField;

  if (!isProductAnalyticsKeyedField(typedField)) {
    return { field: typedField, key: "" };
  }

  const key: string =
    typeof record["key"] === "string"
      ? record["key"].trim().slice(0, SESSION_REPLAY_MAX_TRAIT_KEY_LENGTH)
      : "";

  return key.length > 0 ? { field: typedField, key: key } : null;
}

export function toProductAnalyticsSegmentFilter(
  value: unknown,
): ProductAnalyticsSegmentFilter | null {
  const ref: ProductAnalyticsFieldRef | null =
    toProductAnalyticsFieldRef(value);

  if (!ref) {
    return null;
  }

  const raw: unknown = (value as Record<string, unknown>)["value"];

  if (typeof raw !== "string") {
    return null;
  }

  return {
    ...ref,
    value: raw.slice(0, PRODUCT_ANALYTICS_MAX_SEGMENT_VALUE_LENGTH),
  };
}

export function toProductAnalyticsEventRef(
  value: unknown,
): ProductAnalyticsEventRef | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const kind: unknown = record["kind"];

  if (!isProductAnalyticsEventKind(kind)) {
    return null;
  }

  if (kind === ProductAnalyticsEventKind.Session) {
    return { kind: kind, name: "" };
  }

  const name: string | null =
    kind === ProductAnalyticsEventKind.Page
      ? toProductAnalyticsPage(record["name"]) || null
      : toProductAnalyticsEventName(record["name"]);

  return name === null ? null : { kind: kind, name: name };
}

export function isSameProductAnalyticsEvent(
  left: ProductAnalyticsEventRef,
  right: ProductAnalyticsEventRef,
): boolean {
  return left.kind === right.kind && left.name === right.name;
}

/* ---- Funnels. ---- */

export const PRODUCT_ANALYTICS_FUNNEL_MIN_STEPS: number = 2;
export const PRODUCT_ANALYTICS_FUNNEL_MAX_STEPS: number = 6;

/*
 * How long after the first step a person has to finish the funnel. The page
 * offers these and the server refuses anything else.
 */
export const PRODUCT_ANALYTICS_FUNNEL_WINDOWS_MS: ReadonlyArray<number> = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
];

export const DEFAULT_PRODUCT_ANALYTICS_FUNNEL_WINDOW_MS: number =
  24 * 60 * 60 * 1000;

/*
 * Of all the times a person did the first step in the range, at most this
 * many earliest ones are tried as the funnel's start, and at most
 * PRODUCT_ANALYTICS_FUNNEL_MAX_TIMES_PER_STEP of each later step's times
 * are read: a person who did a step thousands of times is still counted,
 * and the read stays bounded.
 */
export const PRODUCT_ANALYTICS_FUNNEL_MAX_STARTS: number = 100;
export const PRODUCT_ANALYTICS_FUNNEL_MAX_TIMES_PER_STEP: number = 1000;

export interface ProductAnalyticsFunnelStepDto {
  kind: ProductAnalyticsEventKind;
  name: string;
  /* People who reached this step. */
  people: number;
  /* Share of the first step's people, 0 to 1. */
  conversionFromStart: number;
  /* Share of the previous step's people, 0 to 1; 1 for the first step. */
  conversionFromPrevious: number;
  /* People of the previous step who did not reach this one; 0 for the first. */
  droppedOff: number;
  /* Median time from the previous step; null for the first, or nobody reached it. */
  medianMsFromPrevious: number | null;
}

export interface ProductAnalyticsFunnelDto {
  windowMs: number;
  steps: Array<ProductAnalyticsFunnelStepDto>;
}

/* ---- Retention. ---- */

export enum ProductAnalyticsRetentionPeriod {
  Day = "day",
  Week = "week",
  Month = "month",
}

export const PRODUCT_ANALYTICS_RETENTION_PERIODS: ReadonlyArray<ProductAnalyticsRetentionPeriod> =
  [
    ProductAnalyticsRetentionPeriod.Day,
    ProductAnalyticsRetentionPeriod.Week,
    ProductAnalyticsRetentionPeriod.Month,
  ];

/* The most cohorts (and so periods after them) one read covers, per period. */
export const PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS: Readonly<
  Record<ProductAnalyticsRetentionPeriod, number>
> = {
  [ProductAnalyticsRetentionPeriod.Day]: 31,
  [ProductAnalyticsRetentionPeriod.Week]: 26,
  [ProductAnalyticsRetentionPeriod.Month]: 13,
};

export interface ProductAnalyticsRetentionCohortDto {
  /* The cohort's first day, YYYY-MM-DD in the reader's time zone. */
  start: string;
  /* People whose first start event fell in this period. */
  people: number;
  /*
   * For each period from this one on (index 0 is the cohort's own period),
   * how many of them did the return event in it; null for a period that
   * has not begun by the end of the range.
   */
  returning: Array<number | null>;
}

export interface ProductAnalyticsRetentionDto {
  period: ProductAnalyticsRetentionPeriod;
  timeZone: string;
  cohorts: Array<ProductAnalyticsRetentionCohortDto>;
}

/* ---- Event reads. ---- */

export interface ProductAnalyticsEventNameDto {
  kind: ProductAnalyticsEventKind;
  name: string;
  events: number;
  users: number;
  lastSeenAt: number;
}

export interface ProductAnalyticsEventNamesDto {
  events: Array<ProductAnalyticsEventNameDto>;
  hasMore: boolean;
  /* When the first event the table still keeps arrived; null when none is kept. */
  dataStartedAt: number | null;
}

export interface ProductAnalyticsEventTrendDayDto {
  day: string;
  events: number;
  users: number;
}

export interface ProductAnalyticsEventTrendDto {
  timeZone: string;
  days: Array<ProductAnalyticsEventTrendDayDto>;
  totalEvents: number;
  totalUsers: number;
  totalSessions: number;
}

export interface ProductAnalyticsEventBreakdownRowDto {
  /* "" when the events did not carry one. */
  value: string;
  events: number;
  users: number;
}

export interface ProductAnalyticsEventBreakdownDto {
  field: ProductAnalyticsEventField;
  key: string;
  rows: Array<ProductAnalyticsEventBreakdownRowDto>;
  hasMore: boolean;
  totalEvents: number;
  totalUsers: number;
}

export interface ProductAnalyticsEventPropertiesDto {
  /* The event's own property keys, the most used first. */
  propertyKeys: Array<string>;
  /* The user property keys its events carry, the most used first. */
  userPropertyKeys: Array<string>;
}
