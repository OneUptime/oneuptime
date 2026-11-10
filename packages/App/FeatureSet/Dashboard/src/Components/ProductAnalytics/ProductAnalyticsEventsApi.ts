import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import {
  readDtoBoolean,
  readDtoNumber,
  readDtoOptionalNumber,
  readDtoString,
  readDtoStringArray,
} from "Common/Types/Rum/SessionReplayApi";
import {
  ProductAnalyticsEventKind,
  isProductAnalyticsEventKind,
} from "Common/Types/Rum/ProductAnalyticsEvents";
import {
  PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE,
  PRODUCT_ANALYTICS_EVENT_PROPERTIES_ROUTE,
  PRODUCT_ANALYTICS_EVENT_TREND_ROUTE,
  PRODUCT_ANALYTICS_FUNNEL_ROUTE,
  PRODUCT_ANALYTICS_RETENTION_PERIODS,
  PRODUCT_ANALYTICS_RETENTION_ROUTE,
  ProductAnalyticsEventBreakdownDto,
  ProductAnalyticsEventBreakdownRowDto,
  ProductAnalyticsEventField,
  ProductAnalyticsEventNameDto,
  ProductAnalyticsEventNamesDto,
  ProductAnalyticsEventPropertiesDto,
  ProductAnalyticsEventRef,
  ProductAnalyticsEventTrendDayDto,
  ProductAnalyticsEventTrendDto,
  ProductAnalyticsFieldRef,
  ProductAnalyticsFunnelDto,
  ProductAnalyticsFunnelStepDto,
  ProductAnalyticsRetentionCohortDto,
  ProductAnalyticsRetentionDto,
  ProductAnalyticsRetentionPeriod,
  ProductAnalyticsSegmentFilter,
  toProductAnalyticsFieldRef,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import { ProductAnalyticsWindow } from "./ProductAnalyticsApi";

/*
 * The client half of the event reads behind the Events, Funnels and
 * Retention pages (issue #6444, part two). Each answer is read back field
 * by field with the same defensive readers part one's pages use: a server
 * mid-rollout may leave a field out, and a page that draws NaN or
 * "undefined" is worse than one that draws 0.
 */

async function post(route: string, data: JSONObject): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(route),
      data: data,
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return (response.data || {}) as JSONObject;
}

function windowBody(window: ProductAnalyticsWindow): JSONObject {
  return {
    rumApplicationId: window.rumApplicationId.toString(),
    startTime: OneUptimeDate.toString(window.startTime),
    endTime: OneUptimeDate.toString(window.endTime),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<unknown>).map(asRecord) : [];
}

function eventBody(event: ProductAnalyticsEventRef): JSONObject {
  return { kind: event.kind, name: event.name };
}

function filtersBody(
  filters: ReadonlyArray<ProductAnalyticsSegmentFilter>,
): JSONArray {
  return filters.map((filter: ProductAnalyticsSegmentFilter): JSONObject => {
    return { field: filter.field, key: filter.key, value: filter.value };
  });
}

/* An event's kind off the wire, or null for one this page cannot name. */
function readKind(row: Record<string, unknown>): ProductAnalyticsEventKind | null {
  const kind: unknown = row["kind"];

  return isProductAnalyticsEventKind(kind) ? kind : null;
}

// A day as the reads write it: "2026-03-01".
const DAY_SHAPE: RegExp = /^\d{4}-\d{2}-\d{2}$/;

export function parseProductAnalyticsEventNames(
  value: unknown,
): ProductAnalyticsEventNamesDto {
  const row: Record<string, unknown> = asRecord(value);
  const dataStartedAt: number | undefined = readDtoOptionalNumber(
    row,
    "dataStartedAt",
  );
  const events: Array<ProductAnalyticsEventNameDto> = [];

  for (const entry of asRows(row["events"])) {
    const kind: ProductAnalyticsEventKind | null = readKind(entry);

    if (!kind) {
      continue;
    }

    events.push({
      kind: kind,
      name: readDtoString(entry, "name"),
      events: readDtoNumber(entry, "events"),
      users: readDtoNumber(entry, "users"),
      lastSeenAt: readDtoNumber(entry, "lastSeenAt"),
    });
  }

  return {
    events: events,
    hasMore: readDtoBoolean(row, "hasMore"),
    dataStartedAt:
      dataStartedAt === undefined || dataStartedAt <= 0 ? null : dataStartedAt,
  };
}

export function parseProductAnalyticsEventTrend(
  value: unknown,
): ProductAnalyticsEventTrendDto {
  const row: Record<string, unknown> = asRecord(value);

  return {
    timeZone: readDtoString(row, "timeZone"),
    days: asRows(row["days"])
      .filter((day: Record<string, unknown>): boolean => {
        return DAY_SHAPE.test(readDtoString(day, "day"));
      })
      .map((day: Record<string, unknown>): ProductAnalyticsEventTrendDayDto => {
        return {
          day: readDtoString(day, "day"),
          events: readDtoNumber(day, "events"),
          users: readDtoNumber(day, "users"),
        };
      }),
    totalEvents: readDtoNumber(row, "totalEvents"),
    totalUsers: readDtoNumber(row, "totalUsers"),
    totalSessions: readDtoNumber(row, "totalSessions"),
  };
}

export function parseProductAnalyticsEventBreakdown(
  value: unknown,
  breakdown: ProductAnalyticsFieldRef,
): ProductAnalyticsEventBreakdownDto {
  const row: Record<string, unknown> = asRecord(value);
  const answered: ProductAnalyticsFieldRef | null = toProductAnalyticsFieldRef({
    field: row["field"],
    key: row["key"],
  });
  const field: ProductAnalyticsFieldRef = answered || breakdown;

  return {
    field: field.field,
    key: field.key,
    rows: asRows(row["rows"]).map(
      (entry: Record<string, unknown>): ProductAnalyticsEventBreakdownRowDto => {
        return {
          value: readDtoString(entry, "value"),
          events: readDtoNumber(entry, "events"),
          users: readDtoNumber(entry, "users"),
        };
      },
    ),
    hasMore: readDtoBoolean(row, "hasMore"),
    totalEvents: readDtoNumber(row, "totalEvents"),
    totalUsers: readDtoNumber(row, "totalUsers"),
  };
}

export function parseProductAnalyticsEventProperties(
  value: unknown,
): ProductAnalyticsEventPropertiesDto {
  const row: Record<string, unknown> = asRecord(value);

  return {
    propertyKeys: readDtoStringArray(row, "propertyKeys").filter(
      (key: string): boolean => {
        return key.length > 0;
      },
    ),
    userPropertyKeys: readDtoStringArray(row, "userPropertyKeys").filter(
      (key: string): boolean => {
        return key.length > 0;
      },
    ),
  };
}

/* A share off the wire, held to 0..1: a bar never runs past its track. */
function readShare(row: Record<string, unknown>, key: string): number {
  return Math.min(1, Math.max(0, readDtoNumber(row, key)));
}

export function parseProductAnalyticsFunnel(
  value: unknown,
  windowMs: number,
): ProductAnalyticsFunnelDto {
  const row: Record<string, unknown> = asRecord(value);
  const steps: Array<ProductAnalyticsFunnelStepDto> = [];

  for (const entry of asRows(row["steps"])) {
    const kind: ProductAnalyticsEventKind | null = readKind(entry);

    if (!kind) {
      continue;
    }

    const median: number | undefined = readDtoOptionalNumber(
      entry,
      "medianMsFromPrevious",
    );

    steps.push({
      kind: kind,
      name: readDtoString(entry, "name"),
      people: readDtoNumber(entry, "people"),
      conversionFromStart: readShare(entry, "conversionFromStart"),
      conversionFromPrevious: readShare(entry, "conversionFromPrevious"),
      droppedOff: readDtoNumber(entry, "droppedOff"),
      medianMsFromPrevious:
        median === undefined || median < 0 ? null : median,
    });
  }

  return {
    windowMs: readDtoOptionalNumber(row, "windowMs") ?? windowMs,
    steps: steps,
  };
}

export function parseProductAnalyticsRetention(
  value: unknown,
  period: ProductAnalyticsRetentionPeriod,
): ProductAnalyticsRetentionDto {
  const row: Record<string, unknown> = asRecord(value);
  const answered: unknown = row["period"];

  return {
    period:
      typeof answered === "string" &&
      (PRODUCT_ANALYTICS_RETENTION_PERIODS as ReadonlyArray<string>).includes(
        answered,
      )
        ? (answered as ProductAnalyticsRetentionPeriod)
        : period,
    timeZone: readDtoString(row, "timeZone"),
    cohorts: asRows(row["cohorts"])
      .filter((cohort: Record<string, unknown>): boolean => {
        return DAY_SHAPE.test(readDtoString(cohort, "start"));
      })
      .map(
        (
          cohort: Record<string, unknown>,
        ): ProductAnalyticsRetentionCohortDto => {
          const returning: Array<unknown> = Array.isArray(cohort["returning"])
            ? (cohort["returning"] as Array<unknown>)
            : [];

          return {
            start: readDtoString(cohort, "start"),
            people: readDtoNumber(cohort, "people"),
            /* A period not yet begun stays null; anything else unreadable is 0. */
            returning: returning.map((count: unknown): number | null => {
              return count === null
                ? null
                : readDtoNumber({ count: count }, "count");
            }),
          };
        },
      ),
  };
}

export async function fetchProductAnalyticsEventNames(
  request: ProductAnalyticsWindow & { kind?: ProductAnalyticsEventKind },
): Promise<ProductAnalyticsEventNamesDto> {
  return parseProductAnalyticsEventNames(
    await post(PRODUCT_ANALYTICS_EVENT_NAMES_ROUTE, {
      ...windowBody(request),
      ...(request.kind ? { kind: request.kind } : {}),
    }),
  );
}

export async function fetchProductAnalyticsEventTrend(
  request: ProductAnalyticsWindow & {
    event: ProductAnalyticsEventRef;
    filters: ReadonlyArray<ProductAnalyticsSegmentFilter>;
    timeZone: string;
  },
): Promise<ProductAnalyticsEventTrendDto> {
  return parseProductAnalyticsEventTrend(
    await post(PRODUCT_ANALYTICS_EVENT_TREND_ROUTE, {
      ...windowBody(request),
      event: eventBody(request.event),
      filters: filtersBody(request.filters),
      timeZone: request.timeZone,
    }),
  );
}

export async function fetchProductAnalyticsEventBreakdown(
  request: ProductAnalyticsWindow & {
    event: ProductAnalyticsEventRef;
    filters: ReadonlyArray<ProductAnalyticsSegmentFilter>;
    breakdown: ProductAnalyticsFieldRef;
  },
): Promise<ProductAnalyticsEventBreakdownDto> {
  return parseProductAnalyticsEventBreakdown(
    await post(PRODUCT_ANALYTICS_EVENT_BREAKDOWN_ROUTE, {
      ...windowBody(request),
      event: eventBody(request.event),
      filters: filtersBody(request.filters),
      breakdown: { field: request.breakdown.field, key: request.breakdown.key },
    }),
    request.breakdown,
  );
}

export async function fetchProductAnalyticsEventProperties(
  request: ProductAnalyticsWindow & { event: ProductAnalyticsEventRef },
): Promise<ProductAnalyticsEventPropertiesDto> {
  return parseProductAnalyticsEventProperties(
    await post(PRODUCT_ANALYTICS_EVENT_PROPERTIES_ROUTE, {
      ...windowBody(request),
      event: eventBody(request.event),
    }),
  );
}

export async function fetchProductAnalyticsFunnel(
  request: ProductAnalyticsWindow & {
    steps: ReadonlyArray<ProductAnalyticsEventRef>;
    filters: ReadonlyArray<ProductAnalyticsSegmentFilter>;
    windowMs: number;
  },
): Promise<ProductAnalyticsFunnelDto> {
  return parseProductAnalyticsFunnel(
    await post(PRODUCT_ANALYTICS_FUNNEL_ROUTE, {
      ...windowBody(request),
      steps: request.steps.map(eventBody),
      filters: filtersBody(request.filters),
      windowMs: request.windowMs,
    }),
    request.windowMs,
  );
}

export async function fetchProductAnalyticsRetention(
  request: ProductAnalyticsWindow & {
    startEvent: ProductAnalyticsEventRef;
    returnEvent: ProductAnalyticsEventRef;
    filters: ReadonlyArray<ProductAnalyticsSegmentFilter>;
    period: ProductAnalyticsRetentionPeriod;
    timeZone: string;
  },
): Promise<ProductAnalyticsRetentionDto> {
  return parseProductAnalyticsRetention(
    await post(PRODUCT_ANALYTICS_RETENTION_ROUTE, {
      ...windowBody(request),
      startEvent: eventBody(request.startEvent),
      returnEvent: eventBody(request.returnEvent),
      filters: filtersBody(request.filters),
      period: request.period,
      timeZone: request.timeZone,
    }),
    request.period,
  );
}

/* The fields an event can be broken down by: the plain ones, then its property keys. */
export function getProductAnalyticsBreakdownFields(
  properties: ProductAnalyticsEventPropertiesDto | null,
  plainFields: ReadonlyArray<ProductAnalyticsEventField>,
): Array<ProductAnalyticsFieldRef> {
  const fields: Array<ProductAnalyticsFieldRef> = plainFields.map(
    (field: ProductAnalyticsEventField): ProductAnalyticsFieldRef => {
      return { field: field, key: "" };
    },
  );

  for (const key of properties?.propertyKeys || []) {
    fields.push({ field: ProductAnalyticsEventField.Property, key: key });
  }

  for (const key of properties?.userPropertyKeys || []) {
    fields.push({ field: ProductAnalyticsEventField.UserProperty, key: key });
  }

  return fields;
}
