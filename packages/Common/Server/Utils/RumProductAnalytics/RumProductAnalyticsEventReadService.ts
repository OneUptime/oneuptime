import RumProductAnalyticsEventService from "../../Services/RumProductAnalyticsEventService";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  ProductAnalyticsRange,
  ProductAnalyticsScope,
} from "./RumProductAnalyticsReadService";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  PRODUCT_ANALYTICS_IDENTIFIED_PREFIX,
  PRODUCT_ANALYTICS_VISITOR_PREFIX,
} from "../../../Types/Rum/ProductAnalytics";
import { SESSION_REPLAY_MAX_SESSION_MS } from "../../../Types/Rum/SessionReplay";
import {
  ProductAnalyticsEventKind,
  isProductAnalyticsEventKind,
} from "../../../Types/Rum/ProductAnalyticsEvents";
import {
  PRODUCT_ANALYTICS_EVENT_NAMES_LIMIT,
  PRODUCT_ANALYTICS_FUNNEL_MAX_STARTS,
  PRODUCT_ANALYTICS_FUNNEL_MAX_TIMES_PER_STEP,
  PRODUCT_ANALYTICS_PROPERTY_KEYS_LIMIT,
  PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS,
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
  isSameProductAnalyticsEvent,
} from "../../../Types/Rum/ProductAnalyticsEventReads";

/*
 * The reads behind a RUM application's Events, Funnels and Retention pages
 * (issue #6444, part two), over RumProductAnalyticsEventV1: one row per
 * event a recorder sent - a session start, a page view, a track() call.
 *
 * Who did an event is a PERSON, as on the Users page: the signed-in user
 * when the session named one, otherwise the browser's visitor id. A
 * session's events are sent in batches as they happen, so the ones before
 * identify() carry no user and the ones after it do. Every read therefore
 * folds each session first (GROUP BY sessionId) and takes the session's
 * person from ALL its rows - which is what keeps a funnel whose first step
 * happened before sign-in and whose last happened after it in one piece.
 * The rows that only name the user are read from a window padded by the
 * longest a session lasts (SESSION_REPLAY_MAX_SESSION_MS) on both sides,
 * so a session that crosses the range's edge gets the same person in every
 * read.
 *
 * Like the part one reads, every statement here is pinned to one project
 * and one application (both bound), binds every value it was given, names
 * its own columns with a `pa` prefix (an alias spelling a physical column
 * would turn a WHERE on that column into a read of the aggregate), and
 * stops with an error - never a partial answer - after
 * INTERACTIVE_READ_TIME_LIMIT.
 */

const READ_SETTINGS: string = getQuerySettings(INTERACTIVE_READ_TIME_LIMIT);

/* The person of a folded session (paUserKey, paVisitorId), or '' for nobody. */
const PERSON_KEY_SQL: string = `if(paUserKey != '', concat('${PRODUCT_ANALYTICS_IDENTIFIED_PREFIX}', paUserKey), if(paVisitorId != '', concat('${PRODUCT_ANALYTICS_VISITOR_PREFIX}', paVisitorId), ''))`;

/* How far past a range's edges the rows that name a session's user are read. */
const IDENTITY_PAD_MS: number = SESSION_REPLAY_MAX_SESSION_MS;

export interface ProductAnalyticsEventRead extends ProductAnalyticsRange {
  event: ProductAnalyticsEventRef;
  filters: Array<ProductAnalyticsSegmentFilter>;
}

/* ---- Row readers. ---- */

function readNumber(row: JSONObject | undefined, key: string): number {
  if (!row) {
    return 0;
  }

  const parsed: number = Number(row[key]);

  return Number.isFinite(parsed) ? parsed : 0;
}

function readString(row: JSONObject | undefined, key: string): string {
  if (!row) {
    return "";
  }

  const value: unknown = row[key];

  return value === null || value === undefined ? "" : String(value);
}

async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  statement.append(READ_SETTINGS);

  const resultSet: Results =
    await RumProductAnalyticsEventService.executeQuery(statement);

  const response: DbJSONResponse = await resultSet.json<{
    data?: Array<JSONObject>;
  }>();

  return response.data || [];
}

/* ---- Statement pieces. ---- */

function scopeClause(scope: ProductAnalyticsScope): Statement {
  return SQL`projectId = ${{
    type: TableColumnType.ObjectID,
    value: scope.projectId,
  }} AND rumApplicationId = ${{
    type: TableColumnType.ObjectID,
    value: scope.rumApplicationId,
  }}`;
}

function timeWindow(startTime: Date, endTime: Date): Statement {
  return SQL` AND time >= ${{
    type: TableColumnType.DateTime64,
    value: startTime,
  }} AND time <= ${{
    type: TableColumnType.DateTime64,
    value: endTime,
  }}`;
}

function zone(timeZone: string): Statement {
  return SQL`${{ type: TableColumnType.Text, value: timeZone }}`;
}

function eventCondition(event: ProductAnalyticsEventRef): Statement {
  return SQL`kind = ${{
    type: TableColumnType.Text,
    value: event.kind,
  }} AND name = ${{
    type: TableColumnType.Text,
    value: event.name,
  }}`;
}

/* What a field reads off one event row; "" when the event does not carry it. */
export function fieldValueStatement(ref: ProductAnalyticsFieldRef): Statement {
  switch (ref.field) {
    case ProductAnalyticsEventField.DeviceType:
      return SQL`toString(deviceType)`;
    case ProductAnalyticsEventField.Browser:
      return SQL`toString(browserName)`;
    case ProductAnalyticsEventField.OperatingSystem:
      return SQL`toString(osName)`;
    case ProductAnalyticsEventField.Country:
      return SQL`toString(countryCode)`;
    case ProductAnalyticsEventField.AppVersion:
      return SQL`toString(appVersion)`;
    case ProductAnalyticsEventField.Page:
      return SQL`page`;
    case ProductAnalyticsEventField.Property:
      return SQL`properties[${{ type: TableColumnType.Text, value: ref.key }}]`;
    case ProductAnalyticsEventField.UserProperty:
      return SQL`userProperties[${{
        type: TableColumnType.Text,
        value: ref.key,
      }}]`;
    default:
      throw new BadDataException("Unknown product analytics field.");
  }
}

/* " AND <field> = <value>" for every filter of a segment. */
function filtersCondition(
  filters: Array<ProductAnalyticsSegmentFilter>,
): Statement {
  const statement: Statement = SQL``;

  for (const filter of filters) {
    statement.append(" AND ");
    statement.append(fieldValueStatement(filter));
    statement.append(
      SQL` = ${{ type: TableColumnType.Text, value: filter.value }}`,
    );
  }

  return statement;
}

/* One event of a read, in a window, in a segment: "(kind AND name AND time AND filters)". */
function stepCondition(data: {
  event: ProductAnalyticsEventRef;
  filters: Array<ProductAnalyticsSegmentFilter>;
  startTime: Date;
  endTime: Date;
}): Statement {
  const statement: Statement = SQL`(`;
  statement.append(eventCondition(data.event));
  statement.append(timeWindow(data.startTime, data.endTime));
  statement.append(filtersCondition(data.filters));
  statement.append(")");
  return statement;
}

interface FoldSelector {
  /* What the session collects from each event the condition matches. */
  collect: () => Statement;
  condition: () => Statement;
}

/*
 * One row per session that has an event some selector matches: the
 * session's person parts (paUserKey, paVisitorId, read from every row of
 * the session in the scan window) and, for selector i, the array paS<i> of
 * what it collected. Sessions no selector matches are dropped.
 */
function foldSessions(data: {
  scope: ProductAnalyticsScope;
  scanStart: Date;
  scanEnd: Date;
  selectors: Array<FoldSelector>;
}): Statement {
  const statement: Statement = SQL`SELECT sessionId AS paSessionId, max(identifiedUserKey) AS paUserKey, max(visitorId) AS paVisitorId`;

  data.selectors.forEach((selector: FoldSelector, index: number): void => {
    statement.append(", groupArrayIf(");
    statement.append(selector.collect());
    statement.append(", ");
    statement.append(selector.condition());
    statement.append(`) AS paS${index}`);
  });

  statement.append(
    SQL` FROM ${AnalyticsTableName.RumProductAnalyticsEvent} WHERE `,
  );
  statement.append(scopeClause(data.scope));
  statement.append(timeWindow(data.scanStart, data.scanEnd));
  statement.append(" AND (identifiedUserKey != ''");

  for (const selector of data.selectors) {
    statement.append(" OR ");
    statement.append(selector.condition());
  }

  statement.append(") GROUP BY sessionId HAVING ");
  statement.append(
    data.selectors
      .map((_selector: FoldSelector, index: number): string => {
        return `notEmpty(paS${index})`;
      })
      .join(" OR "),
  );

  return statement;
}

/* The folded sessions with their person: paSessionId, paPersonKey and paS<i>. */
function sessionsWithPeople(fold: Statement, selectorCount: number): Statement {
  const statement: Statement = SQL`SELECT paSessionId, `;
  statement.append(`${PERSON_KEY_SQL} AS paPersonKey`);

  for (let index: number = 0; index < selectorCount; index++) {
    statement.append(`, paS${index}`);
  }

  statement.append(" FROM (");
  statement.append(fold);
  statement.append(")");

  return statement;
}

function padded(range: { startTime: Date; endTime: Date }): {
  scanStart: Date;
  scanEnd: Date;
} {
  return {
    scanStart: new Date(range.startTime.getTime() - IDENTITY_PAD_MS),
    scanEnd: new Date(range.endTime.getTime() + IDENTITY_PAD_MS),
  };
}

/* The events of one read, collected as their time (DateTime64), or as `collect`. */
function eventSessions(
  read: ProductAnalyticsEventRead,
  collect?: () => Statement,
): Statement {
  return sessionsWithPeople(
    foldSessions({
      scope: read,
      ...padded(read),
      selectors: [
        {
          collect:
            collect ||
            ((): Statement => {
              return SQL`time`;
            }),
          condition: (): Statement => {
            return stepCondition({
              event: read.event,
              filters: read.filters,
              startTime: read.startTime,
              endTime: read.endTime,
            });
          },
        },
      ],
    }),
    1,
  );
}

/* What a period's first day is, of a DateTime64 or a Date, in a zone. */
function periodStartSql(
  period: ProductAnalyticsRetentionPeriod,
  value: Statement,
  timeZone: string,
): Statement {
  const functionName: string =
    period === ProductAnalyticsRetentionPeriod.Month
      ? "toStartOfMonth"
      : period === ProductAnalyticsRetentionPeriod.Week
        ? "toMonday"
        : "toDate";

  const statement: Statement = SQL``;
  statement.append(`${functionName}(`);
  statement.append(value);
  statement.append(", ");
  statement.append(zone(timeZone));
  statement.append(")");
  return statement;
}

/* Whole periods from one period start (a Date) to another. */
function periodOffsetStatement(
  period: ProductAnalyticsRetentionPeriod,
  from: Statement,
  to: Statement,
): Statement {
  const statement: Statement = SQL``;
  const isWeek: boolean = period === ProductAnalyticsRetentionPeriod.Week;

  if (isWeek) {
    statement.append("intDiv(");
  }

  statement.append(
    period === ProductAnalyticsRetentionPeriod.Month
      ? "dateDiff('month', "
      : "dateDiff('day', ",
  );
  statement.append(from);
  statement.append(", ");
  statement.append(to);
  statement.append(")");

  if (isWeek) {
    statement.append(", 7)");
  }

  return statement;
}

function periodAddFunction(period: ProductAnalyticsRetentionPeriod): string {
  if (period === ProductAnalyticsRetentionPeriod.Month) {
    return "addMonths";
  }

  if (period === ProductAnalyticsRetentionPeriod.Week) {
    return "addWeeks";
  }

  return "addDays";
}

export default class RumProductAnalyticsEventReadService {
  /*
   * The first day (YYYY-MM-DD, in the zone) of every period a range
   * touches, oldest first. A day read of 1 to 3 March is three days, a week
   * read the Mondays of the weeks it touches.
   */
  @CaptureSpan()
  public static async getPeriods(data: {
    startTime: Date;
    endTime: Date;
    timeZone: string;
    period: ProductAnalyticsRetentionPeriod;
  }): Promise<Array<string>> {
    const statement: Statement = SQL`SELECT arrayMap(paN -> toString(`;
    statement.append(`${periodAddFunction(data.period)}(paFirst, paN)), `);
    statement.append("range(toUInt64(greatest(0, ");
    statement.append(
      periodOffsetStatement(data.period, SQL`paFirst`, SQL`paLast`),
    );
    statement.append(") + 1))) AS paPeriods FROM (SELECT ");
    statement.append(
      periodStartSql(
        data.period,
        SQL`${{ type: TableColumnType.DateTime64, value: data.startTime }}`,
        data.timeZone,
      ),
    );
    statement.append(" AS paFirst, ");
    statement.append(
      periodStartSql(
        data.period,
        SQL`${{ type: TableColumnType.DateTime64, value: data.endTime }}`,
        data.timeZone,
      ),
    );
    statement.append(" AS paLast)");

    const row: JSONObject | undefined = (await readRows(statement))[0];
    const periods: unknown = row ? row["paPeriods"] : undefined;

    if (!Array.isArray(periods)) {
      return [];
    }

    return (periods as Array<unknown>).map((value: unknown): string => {
      return String(value);
    });
  }

  /*
   * The events the application sent in a range, the most frequent first,
   * at most PRODUCT_ANALYTICS_EVENT_NAMES_LIMIT, of one kind or of all.
   */
  @CaptureSpan()
  public static async listEventNames(
    request: ProductAnalyticsRange & {
      kind?: ProductAnalyticsEventKind | undefined;
    },
  ): Promise<ProductAnalyticsEventNamesDto> {
    const inRange: () => Statement = (): Statement => {
      return SQL`time >= ${{
        type: TableColumnType.DateTime64,
        value: request.startTime,
      }} AND time <= ${{
        type: TableColumnType.DateTime64,
        value: request.endTime,
      }}`;
    };

    const scan: { scanStart: Date; scanEnd: Date } = padded(request);

    /*
     * Per session and event: how many times it happened in the range and
     * when last, beside the session's person parts. The rows of other
     * events are read only for who the session's user is.
     */
    const perSessionEvent: Statement = SQL`SELECT sessionId AS paSessionId, toString(kind) AS paRowKind, name AS paRowName, countIf(`;
    perSessionEvent.append(inRange());
    perSessionEvent.append(
      ") AS paRowCount, toUnixTimestamp64Milli(maxIf(time, ",
    );
    perSessionEvent.append(inRange());
    perSessionEvent.append(
      ")) AS paRowLast, max(identifiedUserKey) AS paRowUserKey, max(visitorId) AS paRowVisitorId",
    );
    perSessionEvent.append(
      SQL` FROM ${AnalyticsTableName.RumProductAnalyticsEvent} WHERE `,
    );
    perSessionEvent.append(scopeClause(request));
    perSessionEvent.append(timeWindow(scan.scanStart, scan.scanEnd));

    if (request.kind) {
      perSessionEvent.append(
        SQL` AND (kind = ${{
          type: TableColumnType.Text,
          value: request.kind,
        }} OR identifiedUserKey != '')`,
      );
    }

    perSessionEvent.append(" GROUP BY sessionId, kind, name");

    const itemCondition: Statement = SQL`paRowCount > 0`;

    if (request.kind) {
      itemCondition.append(
        SQL` AND paRowKind = ${{
          type: TableColumnType.Text,
          value: request.kind,
        }}`,
      );
    }

    const statement: Statement = SQL`SELECT paKind, paName, toFloat64(sum(paCount)) AS paEvents, toFloat64(uniqIf(paPersonKey, paPersonKey != '')) AS paUsers, toFloat64(max(paLast)) AS paLastSeenAt FROM (SELECT `;
    statement.append(`${PERSON_KEY_SQL} AS paPersonKey`);
    statement.append(
      ", tupleElement(paItem, 1) AS paKind, tupleElement(paItem, 2) AS paName, tupleElement(paItem, 3) AS paCount, tupleElement(paItem, 4) AS paLast FROM (SELECT paSessionId, max(paRowUserKey) AS paUserKey, max(paRowVisitorId) AS paVisitorId, groupArrayIf((paRowKind, paRowName, paRowCount, paRowLast), ",
    );
    statement.append(itemCondition);
    statement.append(") AS paItems FROM (");
    statement.append(perSessionEvent);
    statement.append(
      ") GROUP BY paSessionId HAVING notEmpty(paItems)) ARRAY JOIN paItems AS paItem) GROUP BY paKind, paName ORDER BY paEvents DESC, paKind ASC, paName ASC",
    );
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: PRODUCT_ANALYTICS_EVENT_NAMES_LIMIT + 1,
      }}`,
    );

    const [rows, dataStartedAt]: [Array<JSONObject>, number | null] =
      await Promise.all([readRows(statement), this.getDataStartedAt(request)]);

    const events: Array<ProductAnalyticsEventNameDto> = [];

    for (const row of rows.slice(0, PRODUCT_ANALYTICS_EVENT_NAMES_LIMIT)) {
      const kind: string = readString(row, "paKind");

      if (!isProductAnalyticsEventKind(kind)) {
        continue;
      }

      events.push({
        kind: kind,
        name: readString(row, "paName"),
        events: readNumber(row, "paEvents"),
        users: readNumber(row, "paUsers"),
        lastSeenAt: readNumber(row, "paLastSeenAt"),
      });
    }

    return {
      events: events,
      hasMore: rows.length > PRODUCT_ANALYTICS_EVENT_NAMES_LIMIT,
      dataStartedAt: dataStartedAt,
    };
  }

  /*
   * When the earliest session the events table still keeps started, or
   * null: every recorder sends a session's start first, and the session
   * rows are few, so only they are read.
   */
  @CaptureSpan()
  public static async getDataStartedAt(
    scope: ProductAnalyticsScope,
  ): Promise<number | null> {
    const statement: Statement = SQL`SELECT toFloat64(count()) AS paRows, toFloat64(toUnixTimestamp64Milli(min(time))) AS paFirst FROM ${AnalyticsTableName.RumProductAnalyticsEvent} WHERE `;
    statement.append(scopeClause(scope));
    statement.append(
      SQL` AND kind = ${{
        type: TableColumnType.Text,
        value: ProductAnalyticsEventKind.Session,
      }}`,
    );

    const row: JSONObject | undefined = (await readRows(statement))[0];

    if (readNumber(row, "paRows") === 0) {
      return null;
    }

    return readNumber(row, "paFirst");
  }

  /*
   * One event day by day in the reader's zone - how many times it
   * happened and how many people did it - with every day of the range
   * there, and the range's totals (people over the range, not a sum of
   * days).
   */
  @CaptureSpan()
  public static async getEventTrend(
    request: ProductAnalyticsEventRead & { timeZone: string },
  ): Promise<ProductAnalyticsEventTrendDto> {
    const byDay: Statement = SQL`SELECT toString(toDate(paTime, `;
    byDay.append(zone(request.timeZone));
    byDay.append(
      ")) AS paDayText, toFloat64(count()) AS paEvents, toFloat64(uniqIf(paPersonKey, paPersonKey != '')) AS paUsers FROM (",
    );
    byDay.append(eventSessions(request));
    byDay.append(") ARRAY JOIN paS0 AS paTime GROUP BY paDayText");

    const totals: Statement = SQL`SELECT toFloat64(sum(length(paS0))) AS paEvents, toFloat64(uniqIf(paPersonKey, paPersonKey != '')) AS paUsers, toFloat64(count()) AS paSessions FROM (`;
    totals.append(eventSessions(request));
    totals.append(")");

    const [days, dayRows, totalRows]: [
      Array<string>,
      Array<JSONObject>,
      Array<JSONObject>,
    ] = await Promise.all([
      this.getPeriods({
        startTime: request.startTime,
        endTime: request.endTime,
        timeZone: request.timeZone,
        period: ProductAnalyticsRetentionPeriod.Day,
      }),
      readRows(byDay),
      readRows(totals),
    ]);

    const counted: Map<string, JSONObject> = new Map<string, JSONObject>();

    for (const row of dayRows) {
      counted.set(readString(row, "paDayText"), row);
    }

    return {
      timeZone: request.timeZone,
      days: days.map((day: string): ProductAnalyticsEventTrendDayDto => {
        const row: JSONObject | undefined = counted.get(day);

        return {
          day: day,
          events: readNumber(row, "paEvents"),
          users: readNumber(row, "paUsers"),
        };
      }),
      totalEvents: readNumber(totalRows[0], "paEvents"),
      totalUsers: readNumber(totalRows[0], "paUsers"),
      totalSessions: readNumber(totalRows[0], "paSessions"),
    };
  }

  /*
   * One event by one field - what the session ran on, where, the page, one
   * of the event's properties or one of its user properties - the most
   * frequent values first, at most `limit`. A person who did the event with
   * two values counts on both rows, so the people column does not add up
   * to the total, which comes back as well.
   */
  @CaptureSpan()
  public static async getEventBreakdown(
    request: ProductAnalyticsEventRead & {
      breakdown: ProductAnalyticsFieldRef;
      limit: number;
    },
  ): Promise<ProductAnalyticsEventBreakdownDto> {
    const rows: Statement = SQL`SELECT paValue, toFloat64(count()) AS paEvents, toFloat64(uniqIf(paPersonKey, paPersonKey != '')) AS paUsers FROM (`;
    rows.append(
      eventSessions(request, (): Statement => {
        return fieldValueStatement(request.breakdown);
      }),
    );
    rows.append(
      SQL`) ARRAY JOIN paS0 AS paValue GROUP BY paValue ORDER BY paEvents DESC, paUsers DESC, paValue ASC LIMIT ${{
        type: TableColumnType.Number,
        value: request.limit + 1,
      }}`,
    );

    const totals: Statement = SQL`SELECT toFloat64(sum(length(paS0))) AS paEvents, toFloat64(uniqIf(paPersonKey, paPersonKey != '')) AS paUsers FROM (`;
    totals.append(eventSessions(request));
    totals.append(")");

    const [valueRows, totalRows]: [Array<JSONObject>, Array<JSONObject>] =
      await Promise.all([readRows(rows), readRows(totals)]);

    return {
      field: request.breakdown.field,
      key: request.breakdown.key,
      rows: valueRows
        .slice(0, request.limit)
        .map((row: JSONObject): ProductAnalyticsEventBreakdownRowDto => {
          return {
            value: readString(row, "paValue"),
            events: readNumber(row, "paEvents"),
            users: readNumber(row, "paUsers"),
          };
        }),
      hasMore: valueRows.length > request.limit,
      totalEvents: readNumber(totalRows[0], "paEvents"),
      totalUsers: readNumber(totalRows[0], "paUsers"),
    };
  }

  /*
   * The property keys one event carried in a range, and the user property
   * keys, the most used first: what its breakdown and segments offer.
   */
  @CaptureSpan()
  public static async getEventProperties(
    request: ProductAnalyticsRange & { event: ProductAnalyticsEventRef },
  ): Promise<ProductAnalyticsEventPropertiesDto> {
    const keysOf: (column: "properties" | "userProperties") => Statement = (
      column: "properties" | "userProperties",
    ): Statement => {
      const statement: Statement = SQL`SELECT paKey, toFloat64(count()) AS paCount FROM `;
      statement.append(SQL`${AnalyticsTableName.RumProductAnalyticsEvent}`);
      statement.append(` ARRAY JOIN mapKeys(${column}) AS paKey WHERE `);
      statement.append(scopeClause(request));
      statement.append(" AND ");
      statement.append(eventCondition(request.event));
      statement.append(timeWindow(request.startTime, request.endTime));
      statement.append(
        SQL` GROUP BY paKey ORDER BY paCount DESC, paKey ASC LIMIT ${{
          type: TableColumnType.Number,
          value: PRODUCT_ANALYTICS_PROPERTY_KEYS_LIMIT,
        }}`,
      );
      return statement;
    };

    const [propertyRows, userPropertyRows]: [
      Array<JSONObject>,
      Array<JSONObject>,
    ] = await Promise.all([
      readRows(keysOf("properties")),
      readRows(keysOf("userProperties")),
    ]);

    const toKeys: (rows: Array<JSONObject>) => Array<string> = (
      rows: Array<JSONObject>,
    ): Array<string> => {
      return rows
        .map((row: JSONObject): string => {
          return readString(row, "paKey");
        })
        .filter((key: string): boolean => {
          return key.length > 0;
        });
    };

    return {
      propertyKeys: toKeys(propertyRows),
      userPropertyKeys: toKeys(userPropertyRows),
    };
  }

  /*
   * A funnel: of the people who did the first step in the range, how many
   * then did each next step in order, each within `windowMs` of their first
   * step (so the later steps may fall after the range, up to `now`).
   *
   * For every person, each of their first PRODUCT_ANALYTICS_FUNNEL_MAX_STARTS
   * first-step times starts a chain; each next step is the earliest time of
   * that step after the previous one (strictly after when the two steps are
   * the same event, so one event never counts twice) and inside the window.
   * The person's chain is the one that got furthest, the earliest of those
   * on a tie, and the times between its steps are what the medians read.
   */
  @CaptureSpan()
  public static async getFunnel(
    request: ProductAnalyticsRange & {
      steps: Array<ProductAnalyticsEventRef>;
      filters: Array<ProductAnalyticsSegmentFilter>;
      windowMs: number;
      now: Date;
    },
  ): Promise<ProductAnalyticsFunnelDto> {
    const stepCount: number = request.steps.length;
    const laterEnd: Date = new Date(
      Math.max(
        request.endTime.getTime(),
        Math.min(
          request.endTime.getTime() + request.windowMs,
          request.now.getTime(),
        ),
      ),
    );

    const selectors: Array<FoldSelector> = request.steps.map(
      (step: ProductAnalyticsEventRef, index: number): FoldSelector => {
        return {
          collect: (): Statement => {
            return SQL`toUnixTimestamp64Milli(time)`;
          },
          condition: (): Statement => {
            return stepCondition({
              event: step,
              filters: request.filters,
              startTime: request.startTime,
              endTime: index === 0 ? request.endTime : laterEnd,
            });
          },
        };
      },
    );

    const fold: Statement = foldSessions({
      scope: request,
      ...padded({ startTime: request.startTime, endTime: laterEnd }),
      selectors: selectors,
    });

    /* Per person: the first step's earliest times, and every later step's times. */
    const perPerson: Statement = SQL`SELECT paPersonKey, arraySlice(arraySort(groupArrayArray(paS0)), 1, `;
    perPerson.append(
      SQL`${{
        type: TableColumnType.Number,
        value: PRODUCT_ANALYTICS_FUNNEL_MAX_STARTS,
      }}) AS paStarts`,
    );

    for (let index: number = 1; index < stepCount; index++) {
      perPerson.append(
        `, arraySort(groupArrayArray(paS${index})) AS paAll${index}`,
      );
    }

    perPerson.append(" FROM (");
    perPerson.append(sessionsWithPeople(fold, stepCount));
    perPerson.append(
      ") WHERE paPersonKey != '' GROUP BY paPersonKey HAVING notEmpty(paStarts)",
    );

    /* Only the later times after the first start can be used: keep the first of those. */
    const bounded: Statement = SQL`SELECT paStarts`;

    for (let index: number = 1; index < stepCount; index++) {
      bounded.append(
        `, arraySlice(arrayFilter(paX -> paX >= paStarts[1], paAll${index}), 1, `,
      );
      bounded.append(
        SQL`${{
          type: TableColumnType.Number,
          value: PRODUCT_ANALYTICS_FUNNEL_MAX_TIMES_PER_STEP,
        }}`,
      );
      bounded.append(`) AS paT${index}`);
    }

    bounded.append(" FROM (");
    bounded.append(perPerson);
    bounded.append(")");

    /*
     * The chains: paC<k> is, for every start, the time of step k on the
     * chain from it, or 0 where the chain stopped before step k.
     */
    const chains: Statement = SQL`SELECT paStarts`;
    const windowParam: () => Statement = (): Statement => {
      return SQL`${{ type: TableColumnType.BigNumber, value: request.windowMs }}`;
    };

    for (let index: number = 1; index < stepCount; index++) {
      const comparison: string = isSameProductAnalyticsEvent(
        request.steps[index] as ProductAnalyticsEventRef,
        request.steps[index - 1] as ProductAnalyticsEventRef,
      )
        ? ">"
        : ">=";

      if (index === 1) {
        chains.append(
          `, arrayMap(paS -> arrayFirst(paX -> paX ${comparison} paS AND paX <= paS + `,
        );
        chains.append(windowParam());
        chains.append(", paT1), paStarts) AS paC1");
      } else {
        chains.append(
          `, arrayMap((paS, paP) -> if(paP = 0, 0, arrayFirst(paX -> paX ${comparison} paP AND paX <= paS + `,
        );
        chains.append(windowParam());
        chains.append(
          `, paT${index})), paStarts, paC${index - 1}) AS paC${index}`,
        );
      }
    }

    chains.append(" FROM (");
    chains.append(bounded);
    chains.append(")");

    /* Per person: how far their best chain got, and the times between its steps. */
    const chainArguments: Array<string> = [];
    const chainLambdaArguments: Array<string> = [];
    const chainSteps: Array<string> = [];

    for (let index: number = 1; index < stepCount; index++) {
      chainArguments.push(`paC${index}`);
      chainLambdaArguments.push(`paV${index}`);
      chainSteps.push(`(paV${index} != 0)`);
    }

    const lambdaArguments: string =
      chainLambdaArguments.length === 1
        ? (chainLambdaArguments[0] as string)
        : `(${chainLambdaArguments.join(", ")})`;
    const levels: string = `arrayMap(${lambdaArguments} -> toUInt8(1 + ${chainSteps.join(" + ")}), ${chainArguments.join(", ")})`;

    const best: Statement = SQL`SELECT paLevel`;

    for (let index: number = 1; index < stepCount; index++) {
      const previous: string =
        index === 1 ? "paStarts[paBest]" : `paC${index - 1}[paBest]`;
      best.append(`, paC${index}[paBest] - ${previous} AS paD${index}`);
    }

    best.append(
      ` FROM (SELECT *, arrayMax(paLevels) AS paLevel, indexOf(paLevels, paLevel) AS paBest FROM (SELECT *, ${levels} AS paLevels FROM (`,
    );
    best.append(chains);
    best.append(")))");

    const columns: Array<string> = [];

    for (let index: number = 0; index < stepCount; index++) {
      columns.push(
        `toFloat64(countIf(paLevel >= ${index + 1})) AS paPeople${index}`,
      );

      if (index > 0) {
        columns.push(
          `toFloat64(ifNotFinite(quantileIf(0.5)(paD${index}, paLevel >= ${index + 1}), 0)) AS paMedian${index}`,
        );
      }
    }

    const statement: Statement = SQL`SELECT `;
    statement.append(columns.join(", "));
    statement.append(" FROM (");
    statement.append(best);
    statement.append(")");

    const row: JSONObject | undefined = (await readRows(statement))[0];

    const people: Array<number> = request.steps.map(
      (_step: ProductAnalyticsEventRef, index: number): number => {
        return readNumber(row, `paPeople${index}`);
      },
    );
    const firstPeople: number = people[0] || 0;

    return {
      windowMs: request.windowMs,
      steps: request.steps.map(
        (
          step: ProductAnalyticsEventRef,
          index: number,
        ): ProductAnalyticsFunnelStepDto => {
          const reached: number = people[index] || 0;
          const previous: number =
            index === 0 ? reached : people[index - 1] || 0;

          return {
            kind: step.kind,
            name: step.name,
            people: reached,
            conversionFromStart: firstPeople > 0 ? reached / firstPeople : 0,
            conversionFromPrevious:
              index === 0 ? 1 : previous > 0 ? reached / previous : 0,
            droppedOff: index === 0 ? 0 : Math.max(0, previous - reached),
            medianMsFromPrevious:
              index === 0 || reached === 0
                ? null
                : Math.round(readNumber(row, `paMedian${index}`)),
          };
        },
      ),
    };
  }

  /*
   * Retention: people grouped by the first period of the range in which
   * they did the start event (their cohort), and for each period from the
   * cohort's on, how many of them did the return event in it - at or after
   * their first start event. A period that begins after the range's end is
   * null, not 0: nobody could have come back in it yet.
   */
  @CaptureSpan()
  public static async getRetention(
    request: ProductAnalyticsRange & {
      startEvent: ProductAnalyticsEventRef;
      returnEvent: ProductAnalyticsEventRef;
      filters: Array<ProductAnalyticsSegmentFilter>;
      period: ProductAnalyticsRetentionPeriod;
      timeZone: string;
    },
  ): Promise<ProductAnalyticsRetentionDto> {
    const periods: Array<string> = await this.getPeriods({
      startTime: request.startTime,
      endTime: request.endTime,
      timeZone: request.timeZone,
      period: request.period,
    });

    const maxCohorts: number =
      PRODUCT_ANALYTICS_RETENTION_MAX_COHORTS[request.period];

    if (periods.length > maxCohorts) {
      throw new BadDataException(
        `A ${request.period} retention read covers at most ${maxCohorts} ${request.period}s. Choose a shorter range or a longer period.`,
      );
    }

    const fold: Statement = foldSessions({
      scope: request,
      ...padded(request),
      selectors: [request.startEvent, request.returnEvent].map(
        (event: ProductAnalyticsEventRef): FoldSelector => {
          return {
            collect: (): Statement => {
              return SQL`toUnixTimestamp64Milli(time)`;
            },
            condition: (): Statement => {
              return stepCondition({
                event: event,
                filters: request.filters,
                startTime: request.startTime,
                endTime: request.endTime,
              });
            },
          };
        },
      ),
    });

    const perPerson: Statement = SQL`SELECT paPersonKey, arrayMin(groupArrayArray(paS0)) AS paFirstStart, groupArrayArray(paS1) AS paReturns FROM (`;
    perPerson.append(sessionsWithPeople(fold, 2));
    perPerson.append(
      ") WHERE paPersonKey != '' GROUP BY paPersonKey HAVING notEmpty(groupArrayArray(paS0))",
    );

    /*
     * Per person: the cohort (-1) and the offset of every period they did
     * the return event in, at or after their first start event.
     */
    const cohorts: Statement = SQL`SELECT toString(paCohort) AS paCohortText, arrayConcat([-1], arrayDistinct(arrayMap(paT -> toInt64(`;
    cohorts.append(
      periodOffsetStatement(
        request.period,
        SQL`paCohort`,
        periodStartSql(
          request.period,
          SQL`fromUnixTimestamp64Milli(paT)`,
          request.timeZone,
        ),
      ),
    );
    cohorts.append(
      "), arrayFilter(paT -> paT >= paFirstStart, paReturns)))) AS paOffsets FROM (SELECT paPersonKey, paFirstStart, paReturns, ",
    );
    cohorts.append(
      periodStartSql(
        request.period,
        SQL`fromUnixTimestamp64Milli(paFirstStart)`,
        request.timeZone,
      ),
    );
    cohorts.append(" AS paCohort FROM (");
    cohorts.append(perPerson);
    cohorts.append("))");

    const statement: Statement = SQL`SELECT paCohortText, toInt64(paOffset) AS paOffsetValue, toFloat64(count()) AS paPeople FROM (`;
    statement.append(cohorts);
    statement.append(
      ") ARRAY JOIN paOffsets AS paOffset GROUP BY paCohortText, paOffsetValue",
    );

    const rows: Array<JSONObject> = await readRows(statement);

    const counts: Map<string, Map<number, number>> = new Map<
      string,
      Map<number, number>
    >();

    for (const row of rows) {
      const cohort: string = readString(row, "paCohortText");
      const offset: number = readNumber(row, "paOffsetValue");
      const byOffset: Map<number, number> =
        counts.get(cohort) || new Map<number, number>();
      byOffset.set(offset, readNumber(row, "paPeople"));
      counts.set(cohort, byOffset);
    }

    return {
      period: request.period,
      timeZone: request.timeZone,
      cohorts: periods.map(
        (start: string, index: number): ProductAnalyticsRetentionCohortDto => {
          const byOffset: Map<number, number> | undefined = counts.get(start);
          const returning: Array<number | null> = [];

          for (let offset: number = 0; offset < periods.length; offset++) {
            returning.push(
              index + offset < periods.length
                ? byOffset?.get(offset) || 0
                : null,
            );
          }

          return {
            start: start,
            people: byOffset?.get(-1) || 0,
            returning: returning,
          };
        },
      ),
    };
  }
}
