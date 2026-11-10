import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import {
  readDtoBoolean,
  readDtoNumber,
  readDtoOptionalNumber,
  readDtoString,
  readDtoStringArray,
} from "Common/Types/Rum/SessionReplayApi";
import {
  PRODUCT_ANALYTICS_BREAKDOWN_ROUTE,
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_PEOPLE_ROUTE,
  PRODUCT_ANALYTICS_PERSON_ROUTE,
  PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS,
  PRODUCT_ANALYTICS_SUMMARY_ROUTE,
  PRODUCT_ANALYTICS_TREND_ROUTE,
  ProductAnalyticsBreakdownDto,
  ProductAnalyticsBreakdownRowDto,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleDto,
  ProductAnalyticsPeopleFilter,
  ProductAnalyticsPeriodDto,
  ProductAnalyticsPersonDetailDto,
  ProductAnalyticsPersonDto,
  ProductAnalyticsPersonSessionDto,
  ProductAnalyticsSummaryDto,
  ProductAnalyticsTrendDayDto,
  ProductAnalyticsTrendDto,
  isProductAnalyticsPersonKey,
  readProductAnalyticsPersonKind,
} from "Common/Types/Rum/ProductAnalytics";

/*
 * The client half of the five product analytics reads (issue #6444). Each
 * answer is read back field by field with the same defensive readers the
 * session list uses: a server mid-rollout may leave a field out, and a page
 * that draws NaN or "undefined" is worse than one that draws 0.
 */

export interface ProductAnalyticsWindow {
  rumApplicationId: ObjectID;
  startTime: Date;
  endTime: Date;
}

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

export function parseProductAnalyticsPeriod(
  value: unknown,
): ProductAnalyticsPeriodDto {
  const row: Record<string, unknown> = asRecord(value);
  const lengths: Array<unknown> = Array.isArray(row["sessionLengths"])
    ? (row["sessionLengths"] as Array<unknown>)
    : [];

  return {
    activeUsers: readDtoNumber(row, "activeUsers"),
    signedInUsers: readDtoNumber(row, "signedInUsers"),
    anonymousUsers: readDtoNumber(row, "anonymousUsers"),
    newUsers: readDtoNumber(row, "newUsers"),
    returningUsers: readDtoNumber(row, "returningUsers"),
    sessions: readDtoNumber(row, "sessions"),
    signedInSessions: readDtoNumber(row, "signedInSessions"),
    finishedSessions: readDtoNumber(row, "finishedSessions"),
    medianSessionMs: readDtoNumber(row, "medianSessionMs"),
    averagePagesPerSession: readDtoNumber(row, "averagePagesPerSession"),
    errorSessions: readDtoNumber(row, "errorSessions"),
    frustratedSessions: readDtoNumber(row, "frustratedSessions"),
    /* One count per bucket, in the buckets' order, whatever the server sent. */
    sessionLengths: PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.map(
      (_bucket: unknown, index: number): number => {
        return readDtoNumber({ count: lengths[index] }, "count");
      },
    ),
  };
}

export function parseProductAnalyticsSummary(
  value: unknown,
): ProductAnalyticsSummaryDto {
  const row: Record<string, unknown> = asRecord(value);
  const dataStartedAt: number | undefined = readDtoOptionalNumber(
    row,
    "dataStartedAt",
  );

  return {
    current: parseProductAnalyticsPeriod(row["current"]),
    previous: parseProductAnalyticsPeriod(row["previous"]),
    previousStartTime: readDtoNumber(row, "previousStartTime"),
    previousEndTime: readDtoNumber(row, "previousEndTime"),
    totalUsers: readDtoNumber(row, "totalUsers"),
    dormantUsers: readDtoNumber(row, "dormantUsers"),
    dormantAfterDays: readDtoNumber(row, "dormantAfterDays"),
    dataStartedAt:
      dataStartedAt === undefined || dataStartedAt <= 0 ? null : dataStartedAt,
  };
}

const DAY_SHAPE: RegExp = /^\d{4}-\d{2}-\d{2}$/;

export function parseProductAnalyticsTrend(
  value: unknown,
): ProductAnalyticsTrendDto {
  const row: Record<string, unknown> = asRecord(value);

  return {
    timeZone: readDtoString(row, "timeZone"),
    days: asRows(row["days"])
      .filter((day: Record<string, unknown>): boolean => {
        return DAY_SHAPE.test(readDtoString(day, "day"));
      })
      .map((day: Record<string, unknown>): ProductAnalyticsTrendDayDto => {
        return {
          day: readDtoString(day, "day"),
          activeUsers: readDtoNumber(day, "activeUsers"),
          weeklyActiveUsers: readDtoNumber(day, "weeklyActiveUsers"),
          monthlyActiveUsers: readDtoNumber(day, "monthlyActiveUsers"),
          newUsers: readDtoNumber(day, "newUsers"),
          returningUsers: readDtoNumber(day, "returningUsers"),
          sessions: readDtoNumber(day, "sessions"),
          desktopSessions: readDtoNumber(day, "desktopSessions"),
          mobileSessions: readDtoNumber(day, "mobileSessions"),
          tabletSessions: readDtoNumber(day, "tabletSessions"),
          otherSessions: readDtoNumber(day, "otherSessions"),
        };
      }),
  };
}

export function parseProductAnalyticsBreakdown(
  value: unknown,
  dimension: ProductAnalyticsDimension,
): ProductAnalyticsBreakdownDto {
  const row: Record<string, unknown> = asRecord(value);
  const answered: unknown = row["dimension"];

  return {
    dimension:
      typeof answered === "string" &&
      (PRODUCT_ANALYTICS_DIMENSIONS as ReadonlyArray<string>).includes(answered)
        ? (answered as ProductAnalyticsDimension)
        : dimension,
    rows: asRows(row["rows"]).map(
      (entry: Record<string, unknown>): ProductAnalyticsBreakdownRowDto => {
        return {
          value: readDtoString(entry, "value"),
          users: readDtoNumber(entry, "users"),
          sessions: readDtoNumber(entry, "sessions"),
        };
      },
    ),
    hasMore: readDtoBoolean(row, "hasMore"),
    totalUsers: readDtoNumber(row, "totalUsers"),
    totalSessions: readDtoNumber(row, "totalSessions"),
  };
}

/*
 * A person off the wire, or null when the row names nobody a link could
 * open: a key of any other shape is refused by the person route, so a row
 * carrying one would be a dead click.
 */
export function parseProductAnalyticsPerson(
  value: unknown,
): ProductAnalyticsPersonDto | null {
  const row: Record<string, unknown> = asRecord(value);
  const personKey: string = readDtoString(row, "personKey");

  if (!isProductAnalyticsPersonKey(personKey)) {
    return null;
  }

  const label: unknown = row["identifiedUserLabel"];

  return {
    personKey: personKey,
    kind: readProductAnalyticsPersonKind(personKey),
    identifiedUserKey: readDtoString(row, "identifiedUserKey"),
    visitorId: readDtoString(row, "visitorId"),
    /* Absent means hidden from this reader, never anonymous. */
    identifiedUserLabel:
      label === undefined || label === null ? undefined : String(label),
    firstSeenAt: readDtoNumber(row, "firstSeenAt"),
    lastSeenAt: readDtoNumber(row, "lastSeenAt"),
    sessionsInRange: readDtoNumber(row, "sessionsInRange"),
    totalSessions: readDtoNumber(row, "totalSessions"),
    deviceType: readDtoString(row, "deviceType"),
    countryCode: readDtoString(row, "countryCode"),
    isNew: readDtoBoolean(row, "isNew"),
  };
}

export function parseProductAnalyticsPeople(
  value: unknown,
): ProductAnalyticsPeopleDto {
  const row: Record<string, unknown> = asRecord(value);
  const people: Array<ProductAnalyticsPersonDto> = [];

  for (const entry of asRows(row["people"])) {
    const person: ProductAnalyticsPersonDto | null =
      parseProductAnalyticsPerson(entry);

    if (person) {
      people.push(person);
    }
  }

  return {
    people: people,
    hasMore: readDtoBoolean(row, "hasMore"),
    includesLabels: readDtoBoolean(row, "includesLabels"),
  };
}

export function parseProductAnalyticsPersonDetail(
  value: unknown,
): ProductAnalyticsPersonDetailDto {
  const row: Record<string, unknown> = asRecord(value);

  return {
    person:
      row["person"] === null || row["person"] === undefined
        ? null
        : parseProductAnalyticsPerson(row["person"]),
    sessions: asRows(row["sessions"]).map(
      (entry: Record<string, unknown>): ProductAnalyticsPersonSessionDto => {
        return {
          sessionId: readDtoString(entry, "sessionId"),
          startedAt: readDtoNumber(entry, "startedAt"),
          durationMs: readDtoNumber(entry, "durationMs"),
          pageCount: readDtoNumber(entry, "pageCount"),
          entryPage: readDtoString(entry, "entryPage"),
          pages: readDtoStringArray(entry, "pages"),
          deviceType: readDtoString(entry, "deviceType"),
          browserName: readDtoString(entry, "browserName"),
          osName: readDtoString(entry, "osName"),
          countryCode: readDtoString(entry, "countryCode"),
          appVersion: readDtoString(entry, "appVersion"),
          errorCount: readDtoNumber(entry, "errorCount"),
          frustrationCount: readDtoNumber(entry, "frustrationCount"),
          isFinished: readDtoBoolean(entry, "isFinished"),
          isReplayKept: readDtoBoolean(entry, "isReplayKept"),
        };
      },
    ),
    hasMore: readDtoBoolean(row, "hasMore"),
    includesLabels: readDtoBoolean(row, "includesLabels"),
  };
}

export async function fetchProductAnalyticsSummary(
  request: ProductAnalyticsWindow & { dormantAfterDays: number },
): Promise<ProductAnalyticsSummaryDto> {
  return parseProductAnalyticsSummary(
    await post(PRODUCT_ANALYTICS_SUMMARY_ROUTE, {
      ...windowBody(request),
      dormantAfterDays: request.dormantAfterDays,
    }),
  );
}

export async function fetchProductAnalyticsTrend(
  request: ProductAnalyticsWindow & { timeZone: string },
): Promise<ProductAnalyticsTrendDto> {
  return parseProductAnalyticsTrend(
    await post(PRODUCT_ANALYTICS_TREND_ROUTE, {
      ...windowBody(request),
      timeZone: request.timeZone,
    }),
  );
}

export async function fetchProductAnalyticsBreakdown(
  request: ProductAnalyticsWindow & { dimension: ProductAnalyticsDimension },
): Promise<ProductAnalyticsBreakdownDto> {
  return parseProductAnalyticsBreakdown(
    await post(PRODUCT_ANALYTICS_BREAKDOWN_ROUTE, {
      ...windowBody(request),
      dimension: request.dimension,
    }),
    request.dimension,
  );
}

export async function fetchProductAnalyticsPeople(
  request: ProductAnalyticsWindow & {
    filter: ProductAnalyticsPeopleFilter;
    dormantAfterDays: number;
    search: string;
    limit: number;
    offset: number;
  },
): Promise<ProductAnalyticsPeopleDto> {
  const search: string = request.search.trim();

  return parseProductAnalyticsPeople(
    await post(PRODUCT_ANALYTICS_PEOPLE_ROUTE, {
      ...windowBody(request),
      filter: request.filter,
      dormantAfterDays: request.dormantAfterDays,
      limit: request.limit,
      offset: request.offset,
      /* A blank search is no search: the route would refuse it for a reader without names. */
      ...(search ? { search: search } : {}),
    }),
  );
}

export async function fetchProductAnalyticsPerson(request: {
  rumApplicationId: ObjectID;
  personKey: string;
  limit: number;
  offset: number;
}): Promise<ProductAnalyticsPersonDetailDto> {
  return parseProductAnalyticsPersonDetail(
    await post(PRODUCT_ANALYTICS_PERSON_ROUTE, {
      rumApplicationId: request.rumApplicationId.toString(),
      personKey: request.personKey,
      limit: request.limit,
      offset: request.offset,
    }),
  );
}
