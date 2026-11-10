import RumProductAnalyticsSessionService from "../../Services/RumProductAnalyticsSessionService";
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
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  PRODUCT_ANALYTICS_BREAKDOWN_LIMIT,
  PRODUCT_ANALYTICS_IDENTIFIED_PREFIX,
  PRODUCT_ANALYTICS_IN_RANGE_PEOPLE_FILTERS,
  PRODUCT_ANALYTICS_MONTHLY_WINDOW_DAYS,
  PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS,
  PRODUCT_ANALYTICS_VISITOR_PREFIX,
  PRODUCT_ANALYTICS_WEEKLY_WINDOW_DAYS,
  ProductAnalyticsBreakdownDto,
  ProductAnalyticsBreakdownRowDto,
  ProductAnalyticsDimension,
  ProductAnalyticsPeopleDto,
  ProductAnalyticsPeopleFilter,
  ProductAnalyticsPeriodDto,
  ProductAnalyticsPersonDetailDto,
  ProductAnalyticsPersonDto,
  ProductAnalyticsPersonKind,
  ProductAnalyticsPersonSessionDto,
  ProductAnalyticsSessionLengthBucket,
  ProductAnalyticsSummaryDto,
  ProductAnalyticsTrendDayDto,
  ProductAnalyticsTrendDto,
  readProductAnalyticsPersonKind,
} from "../../../Types/Rum/ProductAnalytics";

/*
 * The reads behind a RUM application's Product Analytics pages (issue
 * #6444), over RumProductAnalyticsSessionV1 (one row per session) and
 * RumProductAnalyticsUserV1 (one row per person per month). See
 * Types/Rum/ProductAnalytics.ts for who a person is and how long the rows
 * are kept, and the two models for how the views fill them.
 *
 * Every statement here:
 *
 *  - is pinned to one project and one application, both bound;
 *  - folds a session's rows first (GROUP BY sessionId, startTime - the
 *    provisional, finished and pinned writes of one session are separate
 *    rows until a merge) and only then counts, so a session is never
 *    counted twice;
 *  - names its own columns with a `pa` prefix. ClickHouse resolves an alias
 *    before a column of the same name, so an alias spelling a physical
 *    column would turn the WHERE that reads the column into a read of the
 *    aggregate (ILLEGAL_AGGREGATION);
 *  - stops with an error, never with a partial answer, after 45 seconds
 *    (INTERACTIVE_READ_TIME_LIMIT): a count cut short would look complete.
 *
 * Who a signed-in user is (the reference identify() was given) is read from
 * RumSessionV1 alone, from the recordings still kept, and only for a caller
 * the route allowed to see it: the product analytics tables never hold it.
 *
 * Counts come back as Float64 or strings (ClickHouse quotes 64-bit integers
 * in JSON); readNumber takes both.
 */

const READ_SETTINGS: string = getQuerySettings(INTERACTIVE_READ_TIME_LIMIT);

/* The person of a folded session (paUserKey, paVisitorId), or '' for nobody. */
const PERSON_KEY_SQL: string = `if(paUserKey != '', concat('${PRODUCT_ANALYTICS_IDENTIFIED_PREFIX}', paUserKey), if(paVisitorId != '', concat('${PRODUCT_ANALYTICS_VISITOR_PREFIX}', paVisitorId), ''))`;

/*
 * The header rows that still name a signed-in user: kept recordings with a
 * reference on them - what Session Replay itself still shows.
 */
const KEPT_LABEL_FILTER: string =
  " AND identifiedUserKey != '' AND identifiedUserLabel != '' AND retentionDate >= now()";

/* What a dimension reads off a folded session. Page is the pages array, joined out below. */
const DIMENSION_SQL: Record<ProductAnalyticsDimension, string> = {
  [ProductAnalyticsDimension.DeviceType]: "max(deviceType)",
  [ProductAnalyticsDimension.Browser]: "max(browserName)",
  [ProductAnalyticsDimension.OperatingSystem]: "max(osName)",
  [ProductAnalyticsDimension.Country]: "max(countryCode)",
  [ProductAnalyticsDimension.AppVersion]: "max(appVersion)",
  [ProductAnalyticsDimension.EntryPage]: "max(entryPage)",
  [ProductAnalyticsDimension.Page]: "groupUniqArrayArray(pages)",
};

export interface ProductAnalyticsScope {
  projectId: ObjectID;
  rumApplicationId: ObjectID;
}

export interface ProductAnalyticsRange extends ProductAnalyticsScope {
  startTime: Date;
  endTime: Date;
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

function readStringArray(row: JSONObject, key: string): Array<string> {
  const value: unknown = row[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return (value as Array<unknown>).map((entry: unknown): string => {
    return String(entry);
  });
}

function readBoolean(row: JSONObject, key: string): boolean {
  const value: unknown = row[key];

  return value === true || value === 1 || value === "1" || value === "true";
}

async function readRows(statement: Statement): Promise<Array<JSONObject>> {
  statement.append(READ_SETTINGS);

  const resultSet: Results =
    await RumProductAnalyticsSessionService.executeQuery(statement);

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

function startTimeRangeClause(startTime: Date, endTime: Date): Statement {
  return SQL` AND startTime >= ${{
    type: TableColumnType.DateTime64,
    value: startTime,
  }} AND startTime <= ${{
    type: TableColumnType.DateTime64,
    value: endTime,
  }}`;
}

/*
 * The sessions that started in a range, one row per session: its start
 * (paStartTime), its person (paPersonKey) and the extra folded columns a
 * read asks for, each "<aggregate> AS <alias>".
 */
function foldedSessions(data: {
  scope: ProductAnalyticsScope;
  startTime: Date;
  endTime: Date;
  columns?: Array<string> | undefined;
  where?: Statement | undefined;
  having?: string | undefined;
}): Statement {
  const statement: Statement = SQL`SELECT sessionId AS paSessionId, startTime AS paStartTime, max(identifiedUserKey) AS paUserKey, max(visitorId) AS paVisitorId, `;

  statement.append(`${PERSON_KEY_SQL} AS paPersonKey`);

  for (const column of data.columns || []) {
    statement.append(`, ${column}`);
  }

  statement.append(
    SQL` FROM ${AnalyticsTableName.RumProductAnalyticsSession} WHERE `,
  );
  statement.append(scopeClause(data.scope));
  statement.append(startTimeRangeClause(data.startTime, data.endTime));

  if (data.where) {
    statement.append(data.where);
  }

  statement.append(" GROUP BY sessionId, startTime");

  if (data.having) {
    statement.append(` HAVING ${data.having}`);
  }

  return statement;
}

/*
 * Everyone the history knows from before an instant: the person rows whose
 * first session is earlier. Only the months up to the instant's are read.
 */
function knownBefore(scope: ProductAnalyticsScope, before: Date): Statement {
  const statement: Statement = SQL`SELECT personKey AS paPersonKey, firstSeen AS paSeen, 0 AS paInRange FROM ${AnalyticsTableName.RumProductAnalyticsUser} WHERE `;

  statement.append(scopeClause(scope));
  statement.append(
    SQL` AND month <= toStartOfMonth(${{
      type: TableColumnType.DateTime64,
      value: before,
    }}) AND firstSeen < ${{
      type: TableColumnType.DateTime64,
      value: before,
    }}`,
  );

  return statement;
}

/*
 * One row per person who came in the range: paFirstSeen is their first
 * session ever (the history's, or the range's own when it holds the first),
 * and paDays the days of the range they came on, in the reader's zone.
 */
function peopleOfRange(
  range: ProductAnalyticsRange,
  timeZone?: string,
): Statement {
  const statement: Statement = SQL`SELECT paPersonKey, min(paSeen) AS paFirstSeen`;

  if (timeZone) {
    statement.append(
      SQL`, groupUniqArrayIf(toDate(paSeen, ${{
        type: TableColumnType.Text,
        value: timeZone,
      }}), paInRange = 1) AS paDays`,
    );
  }

  statement.append(
    " FROM (SELECT paPersonKey, paStartTime AS paSeen, 1 AS paInRange FROM (",
  );
  statement.append(
    foldedSessions({
      scope: range,
      startTime: range.startTime,
      endTime: range.endTime,
    }),
  );
  statement.append(") WHERE paPersonKey != '' UNION ALL ");
  statement.append(knownBefore(range, range.startTime));
  statement.append(") GROUP BY paPersonKey HAVING max(paInRange) = 1");

  return statement;
}

/*
 * The keys ("u:" + key) of the signed-in users whose reference - the one
 * the list shows, from their newest kept recording - holds the search,
 * ignoring case.
 */
function labelMatches(scope: ProductAnalyticsScope, search: string): Statement {
  const statement: Statement = SQL`SELECT concat(${{
    type: TableColumnType.Text,
    value: PRODUCT_ANALYTICS_IDENTIFIED_PREFIX,
  }}, identifiedUserKey) FROM ${AnalyticsTableName.RumSession} WHERE `;

  statement.append(scopeClause(scope));
  statement.append(KEPT_LABEL_FILTER);
  statement.append(
    SQL` GROUP BY identifiedUserKey HAVING positionCaseInsensitiveUTF8(argMax(identifiedUserLabel, startTime), ${{
      type: TableColumnType.Text,
      value: search,
    }}) > 0`,
  );

  return statement;
}

function emptyPeriod(): ProductAnalyticsPeriodDto {
  return {
    activeUsers: 0,
    signedInUsers: 0,
    anonymousUsers: 0,
    newUsers: 0,
    returningUsers: 0,
    sessions: 0,
    signedInSessions: 0,
    finishedSessions: 0,
    medianSessionMs: 0,
    averagePagesPerSession: 0,
    errorSessions: 0,
    frustratedSessions: 0,
    sessionLengths: PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.map((): number => {
      return 0;
    }),
  };
}

function bucketCondition(bucket: ProductAnalyticsSessionLengthBucket): string {
  const lower: string = `paDurationMs >= ${bucket.fromMs}`;

  return bucket.toMs === null
    ? lower
    : `${lower} AND paDurationMs < ${bucket.toMs}`;
}

export default class RumProductAnalyticsReadService {
  /*
   * The range's users and sessions, the same for the range before it, and
   * the history's total and dormant users. Dormant is "came before, not in
   * the last dormantAfterDays days" as of now, whatever the range.
   */
  @CaptureSpan()
  public static async getSummary(
    request: ProductAnalyticsRange & {
      dormantAfterDays: number;
      now: Date;
    },
  ): Promise<ProductAnalyticsSummaryDto> {
    const lengthMs: number =
      request.endTime.getTime() - request.startTime.getTime();
    const previousEndTime: Date = new Date(request.startTime.getTime() - 1);
    const previousStartTime: Date = new Date(
      request.startTime.getTime() - lengthMs - 1,
    );

    const [current, previous, history, dataStartedAt]: [
      ProductAnalyticsPeriodDto,
      ProductAnalyticsPeriodDto,
      { totalUsers: number; dormantUsers: number },
      number | null,
    ] = await Promise.all([
      this.getPeriod(request),
      this.getPeriod({
        projectId: request.projectId,
        rumApplicationId: request.rumApplicationId,
        startTime: previousStartTime,
        endTime: previousEndTime,
      }),
      this.getHistory(request),
      this.getDataStartedAt(request),
    ]);

    return {
      current: current,
      previous: previous,
      previousStartTime: previousStartTime.getTime(),
      previousEndTime: previousEndTime.getTime(),
      totalUsers: history.totalUsers,
      dormantUsers: history.dormantUsers,
      dormantAfterDays: request.dormantAfterDays,
      dataStartedAt: dataStartedAt,
    };
  }

  @CaptureSpan()
  public static async getPeriod(
    range: ProductAnalyticsRange,
  ): Promise<ProductAnalyticsPeriodDto> {
    const users: Statement = SQL`SELECT toFloat64(count()) AS paActiveUsers, toFloat64(countIf(startsWith(paPersonKey, ${{
      type: TableColumnType.Text,
      value: PRODUCT_ANALYTICS_IDENTIFIED_PREFIX,
    }}))) AS paSignedInUsers, toFloat64(countIf(paFirstSeen >= ${{
      type: TableColumnType.DateTime64,
      value: range.startTime,
    }})) AS paNewUsers FROM (`;
    users.append(peopleOfRange(range));
    users.append(")");

    const lengthColumns: Array<string> =
      PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.map(
        (
          bucket: ProductAnalyticsSessionLengthBucket,
          index: number,
        ): string => {
          return `toFloat64(countIf(paFinished AND ${bucketCondition(bucket)})) AS paLength${index}`;
        },
      );

    const sessions: Statement = SQL`SELECT toFloat64(count()) AS paSessions, toFloat64(countIf(paUserKey != '')) AS paSignedInSessions, toFloat64(countIf(paFinished)) AS paFinishedSessions, toFloat64(ifNotFinite(quantileIf(0.5)(paDurationMs, paFinished), 0)) AS paMedianSessionMs, toFloat64(ifNotFinite(avgIf(paPageCount, paFinished), 0)) AS paAveragePages, toFloat64(countIf(paErrorCount > 0)) AS paErrorSessions, toFloat64(countIf(paFrustrationCount > 0)) AS paFrustratedSessions, `;
    sessions.append(lengthColumns.join(", "));
    sessions.append(" FROM (");
    sessions.append(
      foldedSessions({
        scope: range,
        startTime: range.startTime,
        endTime: range.endTime,
        columns: [
          "max(durationMs) AS paDurationMs",
          "max(pageCount) AS paPageCount",
          "max(errorCount) AS paErrorCount",
          "max(frustrationCount) AS paFrustrationCount",
          "max(isFinalized) AS paFinished",
        ],
      }),
    );
    sessions.append(")");

    const [userRows, sessionRows]: [Array<JSONObject>, Array<JSONObject>] =
      await Promise.all([readRows(users), readRows(sessions)]);

    const userRow: JSONObject | undefined = userRows[0];
    const sessionRow: JSONObject | undefined = sessionRows[0];

    if (!userRow && !sessionRow) {
      return emptyPeriod();
    }

    const activeUsers: number = readNumber(userRow, "paActiveUsers");
    const signedInUsers: number = readNumber(userRow, "paSignedInUsers");
    const newUsers: number = readNumber(userRow, "paNewUsers");

    return {
      activeUsers: activeUsers,
      signedInUsers: signedInUsers,
      anonymousUsers: Math.max(0, activeUsers - signedInUsers),
      newUsers: newUsers,
      returningUsers: Math.max(0, activeUsers - newUsers),
      sessions: readNumber(sessionRow, "paSessions"),
      signedInSessions: readNumber(sessionRow, "paSignedInSessions"),
      finishedSessions: readNumber(sessionRow, "paFinishedSessions"),
      medianSessionMs: Math.round(readNumber(sessionRow, "paMedianSessionMs")),
      averagePagesPerSession: readNumber(sessionRow, "paAveragePages"),
      errorSessions: readNumber(sessionRow, "paErrorSessions"),
      frustratedSessions: readNumber(sessionRow, "paFrustratedSessions"),
      sessionLengths: PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.map(
        (
          _bucket: ProductAnalyticsSessionLengthBucket,
          index: number,
        ): number => {
          return readNumber(sessionRow, `paLength${index}`);
        },
      ),
    };
  }

  /*
   * Everyone the history keeps, and those of them whose last session is
   * older than the dormant window. A person still in a session that has not
   * finished yet is in the session table only, so the window's own sessions
   * are read too: someone on the app right now is not dormant.
   */
  @CaptureSpan()
  public static async getHistory(
    request: ProductAnalyticsScope & { dormantAfterDays: number; now: Date },
  ): Promise<{ totalUsers: number; dormantUsers: number }> {
    const dormantBefore: Date = new Date(
      request.now.getTime() - request.dormantAfterDays * 86400000,
    );

    const statement: Statement = SQL`SELECT toFloat64(count()) AS paTotalUsers, toFloat64(countIf(paLastSeen < ${{
      type: TableColumnType.DateTime64,
      value: dormantBefore,
    }})) AS paDormantUsers FROM (SELECT paPersonKey, max(paSeen) AS paLastSeen FROM (SELECT personKey AS paPersonKey, lastSeen AS paSeen FROM ${AnalyticsTableName.RumProductAnalyticsUser} WHERE `;
    statement.append(scopeClause(request));
    statement.append(
      " UNION ALL SELECT paPersonKey, paStartTime AS paSeen FROM (",
    );
    statement.append(
      foldedSessions({
        scope: request,
        startTime: dormantBefore,
        endTime: request.now,
      }),
    );
    statement.append(") WHERE paPersonKey != '') GROUP BY paPersonKey)");

    const row: JSONObject | undefined = (await readRows(statement))[0];

    return {
      totalUsers: readNumber(row, "paTotalUsers"),
      dormantUsers: readNumber(row, "paDormantUsers"),
    };
  }

  /* When the earliest session the tables still keep started, or null. */
  @CaptureSpan()
  public static async getDataStartedAt(
    scope: ProductAnalyticsScope,
  ): Promise<number | null> {
    const statement: Statement = SQL`SELECT toFloat64(count()) AS paRows, toFloat64(toUnixTimestamp64Milli(min(startTime))) AS paFirst FROM ${AnalyticsTableName.RumProductAnalyticsSession} WHERE `;
    statement.append(scopeClause(scope));

    const row: JSONObject | undefined = (await readRows(statement))[0];

    if (readNumber(row, "paRows") === 0) {
      return null;
    }

    return readNumber(row, "paFirst");
  }

  /*
   * One row per day of the range, in the reader's zone: daily, weekly and
   * monthly active users (each day's count over the day, the 7 days and the
   * 30 days ending on it), new and returning users, and sessions by device.
   * Every day is there, with zeros on a day nobody came.
   */
  @CaptureSpan()
  public static async getTrend(
    request: ProductAnalyticsRange & { timeZone: string },
  ): Promise<ProductAnalyticsTrendDto> {
    const timeZone: string = request.timeZone;
    const monthlyLookbackDays: number =
      PRODUCT_ANALYTICS_MONTHLY_WINDOW_DAYS - 1;
    const scanStart: Date = new Date(
      request.startTime.getTime() - (monthlyLookbackDays + 1) * 86400000,
    );

    const zone: () => Statement = (): Statement => {
      return SQL`${{ type: TableColumnType.Text, value: timeZone }}`;
    };

    const firstDay: () => Statement = (): Statement => {
      return SQL`toDate(${{
        type: TableColumnType.DateTime64,
        value: request.startTime,
      }}, `
        .append(zone())
        .append(")");
    };

    const lastDay: () => Statement = (): Statement => {
      return SQL`toDate(${{
        type: TableColumnType.DateTime64,
        value: request.endTime,
      }}, `
        .append(zone())
        .append(")");
    };

    /*
     * Each day's uniq state, every day from 29 before the first to the last
     * filled in with an empty state, then folded over the windows. The
     * windows are RANGE windows over the day, so they count days, not rows.
     */
    const active: Statement = SQL`SELECT toString(paDay) AS paDayText, paDaily, paWeekly, paMonthly FROM (SELECT paDay, toFloat64(finalizeAggregation(paDayState)) AS paDaily, toFloat64(uniqMerge(paDayState) OVER (ORDER BY paDay ASC RANGE BETWEEN `;
    active.append(
      `${PRODUCT_ANALYTICS_WEEKLY_WINDOW_DAYS - 1} PRECEDING AND CURRENT ROW)) AS paWeekly, toFloat64(uniqMerge(paDayState) OVER (ORDER BY paDay ASC RANGE BETWEEN ${monthlyLookbackDays} PRECEDING AND CURRENT ROW)) AS paMonthly FROM (SELECT paDay, uniqMergeState(paState) AS paDayState FROM (SELECT toDate(paStartTime, `,
    );
    active.append(zone());
    active.append(") AS paDay, uniqState(paPersonKey) AS paState FROM (");
    active.append(
      foldedSessions({
        scope: request,
        startTime: scanStart,
        endTime: request.endTime,
      }),
    );
    active.append(") WHERE paPersonKey != '' GROUP BY paDay UNION ALL SELECT ");
    active.append(firstDay());
    active.append(
      ` - ${monthlyLookbackDays} + number AS paDay, uniqStateIf('', 0) AS paState FROM numbers(toUInt64(greatest(0, dateDiff('day', `,
    );
    active.append(firstDay());
    active.append(` - ${monthlyLookbackDays}, `);
    active.append(lastDay());
    active.append(")) + 1)) GROUP BY paDay) GROUP BY paDay)) WHERE paDay >= ");
    active.append(firstDay());
    active.append(" ORDER BY paDay ASC");

    const newcomers: Statement = SQL`SELECT toString(paDay) AS paDayText, toFloat64(count()) AS paActive, toFloat64(countIf(toDate(paFirstSeen, `;
    newcomers.append(zone());
    newcomers.append(") = paDay)) AS paNew FROM (");
    newcomers.append(peopleOfRange(request, timeZone));
    newcomers.append(") ARRAY JOIN paDays AS paDay GROUP BY paDay");

    const devices: Statement = SQL`SELECT toString(toDate(paStartTime, `;
    devices.append(zone());
    devices.append(
      ")) AS paDayText, paDevice, toFloat64(count()) AS paSessions FROM (",
    );
    devices.append(
      foldedSessions({
        scope: request,
        startTime: request.startTime,
        endTime: request.endTime,
        columns: ["max(deviceType) AS paDevice"],
      }),
    );
    devices.append(") GROUP BY paDayText, paDevice");

    const [activeRows, newcomerRows, deviceRows]: [
      Array<JSONObject>,
      Array<JSONObject>,
      Array<JSONObject>,
    ] = await Promise.all([
      readRows(active),
      readRows(newcomers),
      readRows(devices),
    ]);

    const days: Array<ProductAnalyticsTrendDayDto> = activeRows.map(
      (row: JSONObject): ProductAnalyticsTrendDayDto => {
        return {
          day: readString(row, "paDayText"),
          activeUsers: readNumber(row, "paDaily"),
          weeklyActiveUsers: readNumber(row, "paWeekly"),
          monthlyActiveUsers: readNumber(row, "paMonthly"),
          newUsers: 0,
          returningUsers: 0,
          sessions: 0,
          desktopSessions: 0,
          mobileSessions: 0,
          tabletSessions: 0,
          otherSessions: 0,
        };
      },
    );

    const byDay: Map<string, ProductAnalyticsTrendDayDto> = new Map<
      string,
      ProductAnalyticsTrendDayDto
    >();

    for (const day of days) {
      byDay.set(day.day, day);
    }

    for (const row of newcomerRows) {
      const day: ProductAnalyticsTrendDayDto | undefined = byDay.get(
        readString(row, "paDayText"),
      );

      if (day) {
        const newUsers: number = readNumber(row, "paNew");
        day.newUsers = newUsers;
        day.returningUsers = Math.max(
          0,
          readNumber(row, "paActive") - newUsers,
        );
      }
    }

    for (const row of deviceRows) {
      const day: ProductAnalyticsTrendDayDto | undefined = byDay.get(
        readString(row, "paDayText"),
      );

      if (!day) {
        continue;
      }

      const count: number = readNumber(row, "paSessions");
      const device: string = readString(row, "paDevice");

      day.sessions += count;

      if (device === "desktop") {
        day.desktopSessions += count;
      } else if (device === "mobile") {
        day.mobileSessions += count;
      } else if (device === "tablet") {
        day.tabletSessions += count;
      } else {
        day.otherSessions += count;
      }
    }

    return { timeZone: timeZone, days: days };
  }

  /*
   * Users and sessions by one dimension, most users first, at most
   * PRODUCT_ANALYTICS_BREAKDOWN_LIMIT values. A session that visited three
   * pages counts once on each of them, so the page rows do not add up to the
   * total - which is why the total comes back as well.
   */
  @CaptureSpan()
  public static async getBreakdown(
    request: ProductAnalyticsRange & { dimension: ProductAnalyticsDimension },
  ): Promise<ProductAnalyticsBreakdownDto> {
    const isPage: boolean =
      request.dimension === ProductAnalyticsDimension.Page;
    const valueSql: string = DIMENSION_SQL[request.dimension];

    const rows: Statement = SQL`SELECT paValue, toFloat64(uniqIf(paPersonKey, paPersonKey != '')) AS paUsers, toFloat64(count()) AS paSessions FROM (`;
    rows.append(
      foldedSessions({
        scope: request,
        startTime: request.startTime,
        endTime: request.endTime,
        columns: [`${valueSql} AS ${isPage ? "paPages" : "paValue"}`],
      }),
    );
    rows.append(")");

    if (isPage) {
      rows.append(" ARRAY JOIN if(empty(paPages), [''], paPages) AS paValue");
    }

    rows.append(
      SQL` GROUP BY paValue ORDER BY paUsers DESC, paSessions DESC, paValue ASC LIMIT ${{
        type: TableColumnType.Number,
        value: PRODUCT_ANALYTICS_BREAKDOWN_LIMIT + 1,
      }}`,
    );

    const totals: Statement = SQL`SELECT toFloat64(uniqIf(paPersonKey, paPersonKey != '')) AS paUsers, toFloat64(count()) AS paSessions FROM (`;
    totals.append(
      foldedSessions({
        scope: request,
        startTime: request.startTime,
        endTime: request.endTime,
      }),
    );
    totals.append(")");

    const [valueRows, totalRows]: [Array<JSONObject>, Array<JSONObject>] =
      await Promise.all([readRows(rows), readRows(totals)]);

    const hasMore: boolean =
      valueRows.length > PRODUCT_ANALYTICS_BREAKDOWN_LIMIT;

    return {
      dimension: request.dimension,
      rows: valueRows
        .slice(0, PRODUCT_ANALYTICS_BREAKDOWN_LIMIT)
        .map((row: JSONObject): ProductAnalyticsBreakdownRowDto => {
          return {
            value: readString(row, "paValue"),
            users: readNumber(row, "paUsers"),
            sessions: readNumber(row, "paSessions"),
          };
        }),
      hasMore: hasMore,
      totalUsers: readNumber(totalRows[0], "paUsers"),
      totalSessions: readNumber(totalRows[0], "paSessions"),
    };
  }

  /*
   * People, one row each, newest visit first.
   *
   * The five range filters read who came in the range and add what the
   * history knows of them (first visit, sessions, label): only those
   * people's history rows are read. Dormant and All read the whole history,
   * the range (for each person's sessions in it) and the sessions of the
   * dormant window: a session still recording is in the history only once
   * it is finished, and someone in one right now is neither left out of All
   * nor counted as dormant.
   *
   * The label is named in the statement only when includeLabel is true, and
   * a search reads the label, so it is refused (by the route) without it.
   */
  @CaptureSpan()
  public static async listPeople(
    request: ProductAnalyticsRange & {
      filter: ProductAnalyticsPeopleFilter;
      dormantAfterDays: number;
      now: Date;
      limit: number;
      offset: number;
      includeLabel: boolean;
      search?: string | undefined;
    },
  ): Promise<ProductAnalyticsPeopleDto> {
    const isInRangeFilter: boolean =
      PRODUCT_ANALYTICS_IN_RANGE_PEOPLE_FILTERS.includes(request.filter);
    const dormantBefore: Date = new Date(
      request.now.getTime() - request.dormantAfterDays * 86400000,
    );

    /*
     * One row per person who had a session between two instants. Only the
     * range's rows say "came in the range" (paInRange) and count sessions
     * in it; the dormant window's rows only say when someone last came.
     */
    const visits: (window: {
      startTime: Date;
      endTime: Date;
      inRange: boolean;
    }) => Statement = (window: {
      startTime: Date;
      endTime: Date;
      inRange: boolean;
    }): Statement => {
      const statement: Statement = SQL`SELECT paPersonKey, `;
      statement.append(
        window.inRange
          ? "1 AS paInRange, toFloat64(count()) AS paRangeSessions"
          : "0 AS paInRange, toFloat64(0) AS paRangeSessions",
      );
      statement.append(
        ", min(paStartTime) AS paFirst, max(paStartTime) AS paLast, toFloat64(0) AS paKeptSessions, argMax(paSessionDevice, paStartTime) AS paDevice, argMax(paSessionCountry, paStartTime) AS paCountry FROM (",
      );
      statement.append(
        foldedSessions({
          scope: request,
          startTime: window.startTime,
          endTime: window.endTime,
          columns: [
            "max(deviceType) AS paSessionDevice",
            "max(countryCode) AS paSessionCountry",
          ],
        }),
      );
      statement.append(") WHERE paPersonKey != '' GROUP BY paPersonKey");
      return statement;
    };

    const range: { startTime: Date; endTime: Date; inRange: boolean } = {
      startTime: request.startTime,
      endTime: request.endTime,
      inRange: true,
    };

    const history: Statement = SQL`SELECT personKey AS paPersonKey, 0 AS paInRange, toFloat64(0) AS paRangeSessions, min(firstSeen) AS paFirst, max(lastSeen) AS paLast, toFloat64(uniqMerge(sessions)) AS paKeptSessions, argMaxMerge(deviceType) AS paDevice, argMaxMerge(countryCode) AS paCountry FROM ${AnalyticsTableName.RumProductAnalyticsUser} WHERE `;
    history.append(scopeClause(request));

    if (isInRangeFilter) {
      /* Only the people of the range: the rest of the history is not read. */
      history.append(" AND personKey GLOBAL IN (SELECT paPersonKey FROM (");
      history.append(visits(range));
      history.append("))");
    }

    history.append(" GROUP BY personKey");

    const statement: Statement = SQL`SELECT paPersonKey, max(paInRange) AS paActive, toFloat64(toUnixTimestamp64Milli(min(paFirst))) AS paFirstSeenAt, toFloat64(toUnixTimestamp64Milli(max(paLast))) AS paLastSeenAt, toFloat64(sum(paRangeSessions)) AS paSessionsInRange, toFloat64(greatest(max(paKeptSessions), sum(paRangeSessions))) AS paTotalSessions, argMax(paDevice, paLast) AS paDeviceType, argMax(paCountry, paLast) AS paCountryCode, min(paFirst) >= ${{
      type: TableColumnType.DateTime64,
      value: request.startTime,
    }} AND min(paFirst) <= ${{
      type: TableColumnType.DateTime64,
      value: request.endTime,
    }} AS paIsNew FROM (`;
    statement.append(visits(range));

    if (!isInRangeFilter) {
      statement.append(" UNION ALL ");
      statement.append(
        visits({
          startTime: dormantBefore,
          endTime: request.now,
          inRange: false,
        }),
      );
    }

    statement.append(" UNION ALL ");
    statement.append(history);
    statement.append(")");

    const search: string = (request.search || "").trim();

    if (search && request.includeLabel) {
      /* The signed-in users a kept recording names so. */
      statement.append(" WHERE paPersonKey GLOBAL IN (");
      statement.append(labelMatches(request, search));
      statement.append(")");
    }

    statement.append(" GROUP BY paPersonKey HAVING ");
    statement.append(this.peopleFilterCondition(request, dormantBefore));

    statement.append(
      SQL` ORDER BY paLastSeenAt DESC, paPersonKey DESC LIMIT ${{
        type: TableColumnType.Number,
        value: request.limit + 1,
      }} OFFSET ${{
        type: TableColumnType.Number,
        value: request.offset,
      }}`,
    );

    const rows: Array<JSONObject> = await readRows(statement);
    const hasMore: boolean = rows.length > request.limit;

    const people: Array<ProductAnalyticsPersonDto> = rows
      .slice(0, request.limit)
      .map((row: JSONObject): ProductAnalyticsPersonDto => {
        return this.toPerson(row);
      });

    if (request.includeLabel) {
      await this.addLabels(request, people);
    }

    return {
      people: people,
      hasMore: hasMore,
      includesLabels: request.includeLabel,
    };
  }

  /*
   * Who the page's signed-in users are: the reference on the newest of
   * their recordings still kept, "" when none is (see
   * ProductAnalyticsPersonDto.identifiedUserLabel). Called only for a reader
   * allowed to see it; visitors get no label at all.
   */
  private static async addLabels(
    scope: ProductAnalyticsScope,
    people: Array<ProductAnalyticsPersonDto>,
  ): Promise<void> {
    const identified: Array<ProductAnalyticsPersonDto> = people.filter(
      (person: ProductAnalyticsPersonDto): boolean => {
        return person.kind === "identified";
      },
    );

    if (identified.length === 0) {
      return;
    }

    const statement: Statement = SQL`SELECT identifiedUserKey AS paUserKey, argMax(identifiedUserLabel, startTime) AS paLabelText FROM ${AnalyticsTableName.RumSession} WHERE `;
    statement.append(scopeClause(scope));
    statement.append(
      SQL` AND identifiedUserKey IN ${{
        type: TableColumnType.Text,
        value: new Includes(
          identified.map((person: ProductAnalyticsPersonDto): string => {
            return person.identifiedUserKey;
          }),
        ),
      }}`,
    );
    statement.append(KEPT_LABEL_FILTER);
    statement.append(" GROUP BY identifiedUserKey");

    const labels: Map<string, string> = new Map<string, string>();

    for (const row of await readRows(statement)) {
      labels.set(readString(row, "paUserKey"), readString(row, "paLabelText"));
    }

    for (const person of identified) {
      person.identifiedUserLabel = labels.get(person.identifiedUserKey) || "";
    }
  }

  private static peopleFilterCondition(
    request: { filter: ProductAnalyticsPeopleFilter; startTime: Date },
    dormantBefore: Date,
  ): Statement {
    switch (request.filter) {
      case ProductAnalyticsPeopleFilter.New:
        return SQL`paActive = 1 AND min(paFirst) >= ${{
          type: TableColumnType.DateTime64,
          value: request.startTime,
        }}`;
      case ProductAnalyticsPeopleFilter.Returning:
        return SQL`paActive = 1 AND min(paFirst) < ${{
          type: TableColumnType.DateTime64,
          value: request.startTime,
        }}`;
      case ProductAnalyticsPeopleFilter.SignedIn:
        return SQL`paActive = 1 AND startsWith(paPersonKey, ${{
          type: TableColumnType.Text,
          value: PRODUCT_ANALYTICS_IDENTIFIED_PREFIX,
        }})`;
      case ProductAnalyticsPeopleFilter.Anonymous:
        return SQL`paActive = 1 AND startsWith(paPersonKey, ${{
          type: TableColumnType.Text,
          value: PRODUCT_ANALYTICS_VISITOR_PREFIX,
        }})`;
      case ProductAnalyticsPeopleFilter.Dormant:
        return SQL`max(paLast) < ${{
          type: TableColumnType.DateTime64,
          value: dormantBefore,
        }}`;
      case ProductAnalyticsPeopleFilter.All:
        return SQL`1 = 1`;
      case ProductAnalyticsPeopleFilter.Active:
      default:
        return SQL`paActive = 1`;
    }
  }

  private static toPerson(row: JSONObject): ProductAnalyticsPersonDto {
    const personKey: string = readString(row, "paPersonKey");
    const kind: ProductAnalyticsPersonKind =
      readProductAnalyticsPersonKind(personKey);
    const id: string = personKey.slice(
      PRODUCT_ANALYTICS_IDENTIFIED_PREFIX.length,
    );

    return {
      personKey: personKey,
      kind: kind,
      identifiedUserKey: kind === "identified" ? id : "",
      visitorId: kind === "visitor" ? id : "",
      firstSeenAt: readNumber(row, "paFirstSeenAt"),
      lastSeenAt: readNumber(row, "paLastSeenAt"),
      sessionsInRange: readNumber(row, "paSessionsInRange"),
      totalSessions: readNumber(row, "paTotalSessions"),
      deviceType: readString(row, "paDeviceType"),
      countryCode: readString(row, "paCountryCode"),
      isNew: readBoolean(row, "paIsNew"),
    };
  }

  /*
   * One person: what the history knows of them, and their sessions, newest
   * first. A signed-in user's sessions are the ones that named them; a
   * visitor's are the ones from their browser in which nobody signed in.
   */
  @CaptureSpan()
  public static async getPerson(
    request: ProductAnalyticsScope & {
      personKey: string;
      now: Date;
      limit: number;
      offset: number;
      includeLabel: boolean;
    },
  ): Promise<ProductAnalyticsPersonDetailDto> {
    const kind: ProductAnalyticsPersonKind = readProductAnalyticsPersonKind(
      request.personKey,
    );
    const id: string = request.personKey.slice(
      PRODUCT_ANALYTICS_IDENTIFIED_PREFIX.length,
    );

    /* The whole kept history: from the epoch to now. */
    const sessionsOfPerson: (columns: Array<string>) => Statement = (
      columns: Array<string>,
    ): Statement => {
      return foldedSessions({
        scope: request,
        startTime: new Date(0),
        endTime: request.now,
        columns: columns,
        where:
          kind === "identified"
            ? SQL` AND identifiedUserKey = ${{
                type: TableColumnType.Text,
                value: id,
              }}`
            : SQL` AND visitorId = ${{
                type: TableColumnType.Text,
                value: id,
              }}`,
        having: kind === "identified" ? undefined : "paUserKey = ''",
      });
    };

    /*
     * Two parts, each a row only when it knows the person: the history,
     * and the sessions themselves (which also hold the ones still
     * recording). The count of parts says whether the person is known.
     */
    const summary: Statement = SQL`SELECT toFloat64(toUnixTimestamp64Milli(min(paFirst))) AS paFirstSeenAt, toFloat64(toUnixTimestamp64Milli(max(paLast))) AS paLastSeenAt, toFloat64(max(paCount)) AS paTotalSessions, argMax(paDevice, paLast) AS paDeviceType, argMax(paCountry, paLast) AS paCountryCode, toFloat64(count()) AS paParts FROM (SELECT min(firstSeen) AS paFirst, max(lastSeen) AS paLast, toFloat64(uniqMerge(sessions)) AS paCount, argMaxMerge(deviceType) AS paDevice, argMaxMerge(countryCode) AS paCountry FROM ${AnalyticsTableName.RumProductAnalyticsUser} WHERE `;
    summary.append(scopeClause(request));
    summary.append(
      SQL` AND personKey = ${{
        type: TableColumnType.Text,
        value: request.personKey,
      }} HAVING count() > 0 UNION ALL SELECT min(paStartTime) AS paFirst, max(paStartTime) AS paLast, toFloat64(count()) AS paCount, argMax(paSessionDevice, paStartTime) AS paDevice, argMax(paSessionCountry, paStartTime) AS paCountry FROM (`,
    );
    summary.append(
      sessionsOfPerson([
        "max(deviceType) AS paSessionDevice",
        "max(countryCode) AS paSessionCountry",
      ]),
    );
    summary.append(") HAVING count() > 0)");

    const sessions: Statement = SQL`SELECT paSessionId, toFloat64(toUnixTimestamp64Milli(paStartTime)) AS paStartedAt, toFloat64(paDurationMs) AS paDuration, toFloat64(paPageCount) AS paPages, paEntryPage, paPageList, paDevice, paBrowser, paOs, paCountry, paAppVersion, toFloat64(paErrorCount) AS paErrors, toFloat64(paFrustrationCount) AS paFrustration, paFinished, paReplayRetention >= now() AS paReplayKept FROM (`;
    sessions.append(
      sessionsOfPerson([
        "max(durationMs) AS paDurationMs",
        "max(pageCount) AS paPageCount",
        "max(entryPage) AS paEntryPage",
        "groupUniqArrayArray(pages) AS paPageList",
        "max(deviceType) AS paDevice",
        "max(browserName) AS paBrowser",
        "max(osName) AS paOs",
        "max(countryCode) AS paCountry",
        "max(appVersion) AS paAppVersion",
        "max(errorCount) AS paErrorCount",
        "max(frustrationCount) AS paFrustrationCount",
        "max(isFinalized) AS paFinished",
        "max(replayRetentionDate) AS paReplayRetention",
      ]),
    );
    sessions.append(
      SQL`) ORDER BY paStartTime DESC, paSessionId DESC LIMIT ${{
        type: TableColumnType.Number,
        value: request.limit + 1,
      }} OFFSET ${{
        type: TableColumnType.Number,
        value: request.offset,
      }}`,
    );

    const [summaryRows, sessionRows]: [Array<JSONObject>, Array<JSONObject>] =
      await Promise.all([readRows(summary), readRows(sessions)]);

    const summaryRow: JSONObject | undefined = summaryRows[0];
    const knownAtAll: boolean = readNumber(summaryRow, "paParts") > 0;

    let person: ProductAnalyticsPersonDto | null = null;

    if (knownAtAll) {
      person = {
        personKey: request.personKey,
        kind: kind,
        identifiedUserKey: kind === "identified" ? id : "",
        visitorId: kind === "visitor" ? id : "",
        firstSeenAt: readNumber(summaryRow, "paFirstSeenAt"),
        lastSeenAt: readNumber(summaryRow, "paLastSeenAt"),
        sessionsInRange: 0,
        totalSessions: readNumber(summaryRow, "paTotalSessions"),
        deviceType: readString(summaryRow, "paDeviceType"),
        countryCode: readString(summaryRow, "paCountryCode"),
        isNew: false,
      };

      if (request.includeLabel) {
        await this.addLabels(request, [person]);
      }
    }

    return {
      person: person,
      sessions: sessionRows
        .slice(0, request.limit)
        .map((row: JSONObject): ProductAnalyticsPersonSessionDto => {
          return {
            sessionId: readString(row, "paSessionId"),
            startedAt: readNumber(row, "paStartedAt"),
            durationMs: readNumber(row, "paDuration"),
            pageCount: readNumber(row, "paPages"),
            entryPage: readString(row, "paEntryPage"),
            pages: readStringArray(row, "paPageList").sort(),
            deviceType: readString(row, "paDevice"),
            browserName: readString(row, "paBrowser"),
            osName: readString(row, "paOs"),
            countryCode: readString(row, "paCountry"),
            appVersion: readString(row, "paAppVersion"),
            errorCount: readNumber(row, "paErrors"),
            frustrationCount: readNumber(row, "paFrustration"),
            isFinished: readBoolean(row, "paFinished"),
            isReplayKept: readBoolean(row, "paReplayKept"),
          };
        }),
      hasMore: sessionRows.length > request.limit,
      includesLabels: request.includeLabel,
    };
  }
}
