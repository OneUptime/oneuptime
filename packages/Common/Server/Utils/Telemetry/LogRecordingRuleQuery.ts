import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import TelemetryReadScopeUtil from "./TelemetryReadScope";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE,
  LogRecordingRuleAttributeFilter,
  LogRecordingRuleDefinitionUtil,
  LogRecordingRuleFilter,
} from "../../../Types/Log/LogRecordingRuleDefinition";
import LogRecordingRuleWindowUtil, {
  LogRecordingRuleWindow,
} from "../../../Utils/Telemetry/LogRecordingRuleWindow";

/*
 * The ClickHouse side of a log recording rule: one statement per rule per
 * run, over the window LogRecordingRuleWindow handed it, that returns one
 * row per minute per series -
 *
 *   SELECT toUnixTimestamp(toStartOfInterval(time, INTERVAL 1 MINUTE)) AS bucket,
 *          attributes[{gw_name}] AS g0, ...          -- one per group-by key
 *          count() AS matchedLogs,
 *          avg(toFloat64OrNull(attributes[{latency}])) AS value
 *   FROM LogItemV3
 *   WHERE projectId = {..} AND time >= {start} AND time < {end}
 *     AND <the rule's filter> [AND the value attribute is a finite number]
 *   GROUP BY bucket, g0, ...
 *   ORDER BY bucket ASC, matchedLogs DESC
 *   LIMIT <max series> BY bucket
 *
 * Everything a person typed - attribute keys, filter values, the body text,
 * service ids, severities - is a bound query parameter, compiled the way
 * the log explorer's own aggregations compile it (LogAggregationService):
 * attribute filters match their key case-insensitively over mapKeys /
 * mapValues, the body is an escaped ILIKE, services go through
 * TelemetryReadScopeUtil.appendServiceFilter. Only code-owned text is ever
 * appended raw: the column aliases (g0, g1 ...), the aggregate function, a
 * percentile level from AggregationType and the numeric limits.
 *
 * The numeric attribute is read with toFloat64OrNull, and a log whose
 * value is missing, not a number or not finite (nan, inf) is left out by
 * the WHERE clause - never read as 0. The bucket comes back as a unix
 * timestamp, so reading it does not depend on the server's time zone.
 */

export const LOG_RECORDING_RULE_QUERY_MAX_EXECUTION_TIME_IN_SECONDS: number = 45;

export interface LogRecordingRulePoint {
  // The start of the minute the point is for.
  bucketStart: Date;
  /*
   * The series: each group-by key's value on the logs it was computed from
   * ('' for logs that did not carry the attribute). Empty with no group by.
   */
  groupValues: Record<string, string>;
  value: number;
  // How many logs the value was computed from.
  matchedLogs: number;
}

export interface LogRecordingRulePoints {
  points: Array<LogRecordingRulePoint>;
  /*
   * Minutes that reached LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE series:
   * their quietest series beyond the cap were not written.
   */
  truncatedMinutes: Array<Date>;
}

export interface LogRecordingRuleQueryInput {
  projectId: ObjectID;
  // A definition LogRecordingRuleDefinitionUtil accepted and normalized.
  definition: LogRecordingRuleDefinition;
  window: LogRecordingRuleWindow;
}

export default class LogRecordingRuleQuery {
  // The result column a group-by key is read into: g0, g1, ...
  public static getGroupByAlias(index: number): string {
    return `g${index}`;
  }

  public static buildStatement(input: LogRecordingRuleQueryInput): Statement {
    const definition: LogRecordingRuleDefinition = input.definition;
    const groupBy: Array<string> = definition.groupByAttributes || [];
    const filter: LogRecordingRuleFilter = definition.filter || {};

    if (
      !LogRecordingRuleDefinitionUtil.isSupportedAggregation(
        definition.aggregationType,
      )
    ) {
      throw new BadDataException(
        `Unsupported log recording rule aggregation: ${String(definition.aggregationType)}`,
      );
    }

    const needsValueAttribute: boolean =
      LogRecordingRuleDefinitionUtil.needsValueAttribute(
        definition.aggregationType,
      );
    const valueAttribute: string = (definition.valueAttribute || "").trim();

    if (needsValueAttribute && !valueAttribute) {
      throw new BadDataException(
        "A log recording rule that aggregates a value needs its numeric attribute.",
      );
    }

    const statement: Statement = SQL`SELECT toUnixTimestamp(toStartOfInterval(time, INTERVAL 1 MINUTE)) AS bucket`;

    groupBy.forEach((key: string, index: number) => {
      statement
        .append(
          SQL`, attributes[${{
            type: TableColumnType.Text,
            value: key,
          }}] AS `,
        )
        .append(LogRecordingRuleQuery.getGroupByAlias(index));
    });

    statement.append(", count() AS matchedLogs, ");
    statement.append(
      LogRecordingRuleQuery.buildAggregateExpression(
        definition.aggregationType,
        valueAttribute,
      ),
    );
    statement.append(" AS value");

    statement.append(
      SQL` FROM ${AnalyticsTableName.Log} WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: input.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: input.window.startTime,
      }} AND time < ${{
        type: TableColumnType.DateTime64,
        value: input.window.endTime,
      }}`,
    );

    LogRecordingRuleQuery.appendFilter(statement, filter);

    if (needsValueAttribute) {
      /*
       * Only logs that carry the attribute, as a finite number. The key
       * check first rides the attributeKeys bloom index the way
       * StatementGenerator's map filters do (rows written before that
       * column existed have it empty and fall through to the value test).
       */
      statement.append(
        SQL` AND (empty(attributeKeys) OR hasAny(attributeKeys, ${{
          type: TableColumnType.ArrayText,
          value: [valueAttribute],
        }})) AND isFinite(`,
      );
      statement.append(
        LogRecordingRuleQuery.buildValueExpression(valueAttribute),
      );
      statement.append(")");
    }

    statement.append(" GROUP BY bucket");

    groupBy.forEach((_key: string, index: number) => {
      statement.append(`, ${LogRecordingRuleQuery.getGroupByAlias(index)}`);
    });

    /*
     * The cap on series: per minute, the busiest series (by how many logs
     * they were computed from) up to the cap. Code-owned integers, so they
     * are appended as they are.
     */
    const maxSeries: number = Math.max(
      1,
      Math.floor(LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE),
    );
    const minutes: number = Math.max(1, Math.floor(input.window.minutes));

    statement.append(" ORDER BY bucket ASC, matchedLogs DESC");
    statement.append(` LIMIT ${maxSeries} BY bucket`);
    statement.append(` LIMIT ${maxSeries * minutes}`);

    /*
     * A timeout fails the query rather than returning a partial aggregate:
     * a partial count or average written as the minute's value would be
     * wrong data, while a failed run hands its window back for the next one.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds:
          LOG_RECORDING_RULE_QUERY_MAX_EXECUTION_TIME_IN_SECONDS,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  /*
   * The rows buildStatement returned, as points. A row outside the window,
   * or whose value is not a finite number, is dropped. A Count with no
   * group by has one series that exists whether or not a log matched, so
   * every minute of the window gets a point - 0 for a minute with no
   * matching logs - instead of a gap; a group by or a value aggregation
   * writes only what it saw.
   */
  public static readPoints(input: {
    rows: Array<JSONObject>;
    definition: LogRecordingRuleDefinition;
    window: LogRecordingRuleWindow;
  }): LogRecordingRulePoints {
    const groupBy: Array<string> = input.definition.groupByAttributes || [];
    const windowStart: number = input.window.startTime.getTime();
    const windowEnd: number = input.window.endTime.getTime();

    const points: Array<LogRecordingRulePoint> = [];
    const seriesPerMinute: Map<number, number> = new Map<number, number>();

    for (const row of input.rows) {
      const bucketSeconds: number = LogRecordingRuleQuery.readNumber(
        row["bucket"],
      );
      const value: number = LogRecordingRuleQuery.readNumber(row["value"]);

      if (!Number.isFinite(bucketSeconds) || !Number.isFinite(value)) {
        continue;
      }

      const bucketTime: number = bucketSeconds * 1000;

      if (bucketTime < windowStart || bucketTime >= windowEnd) {
        continue;
      }

      const groupValues: Record<string, string> = {};

      groupBy.forEach((key: string, index: number) => {
        groupValues[key] = LogRecordingRuleQuery.readText(
          row[LogRecordingRuleQuery.getGroupByAlias(index)],
        );
      });

      const matchedLogs: number = LogRecordingRuleQuery.readNumber(
        row["matchedLogs"],
      );

      points.push({
        bucketStart: new Date(bucketTime),
        groupValues,
        value,
        matchedLogs: Number.isFinite(matchedLogs) ? matchedLogs : 0,
      });

      seriesPerMinute.set(
        bucketTime,
        (seriesPerMinute.get(bucketTime) || 0) + 1,
      );
    }

    if (
      input.definition.aggregationType === AggregationType.Count &&
      groupBy.length === 0
    ) {
      for (const bucketStart of LogRecordingRuleWindowUtil.getBucketStarts(
        input.window,
      )) {
        if (!seriesPerMinute.has(bucketStart.getTime())) {
          points.push({
            bucketStart,
            groupValues: {},
            value: 0,
            matchedLogs: 0,
          });
        }
      }

      points.sort((a: LogRecordingRulePoint, b: LogRecordingRulePoint) => {
        return a.bucketStart.getTime() - b.bucketStart.getTime();
      });
    }

    const truncatedMinutes: Array<Date> = Array.from(seriesPerMinute.entries())
      .filter((entry: [number, number]): boolean => {
        return entry[1] >= LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE;
      })
      .map((entry: [number, number]): Date => {
        return new Date(entry[0]);
      });

    return { points, truncatedMinutes };
  }

  private static appendFilter(
    statement: Statement,
    filter: LogRecordingRuleFilter,
  ): void {
    const serviceIds: Array<ObjectID> = (filter.telemetryServiceIds || []).map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    );

    TelemetryReadScopeUtil.appendServiceFilter(statement, { serviceIds });

    if (filter.severityTexts && filter.severityTexts.length > 0) {
      statement.append(
        SQL` AND severityText IN (${{
          type: TableColumnType.Text,
          value: new Includes(filter.severityTexts),
        }})`,
      );
    }

    const body: string = (filter.body || "").trim();

    if (body) {
      // Escaped so a body containing `%` or `_` matches literally.
      statement.append(
        SQL` AND body ILIKE ${{
          type: TableColumnType.Text,
          value: `%${escapeIlikePattern(body)}%`,
        }}`,
      );
    }

    for (const attributeFilter of filter.attributeFilters || []) {
      LogRecordingRuleQuery.appendAttributeFilter(statement, attributeFilter);
    }
  }

  /*
   * Key matched case-insensitively - the keys come from many conventions
   * and the log explorer's filters, which a rule is usually copied from,
   * match them the same way (LogAggregationService.appendCommonFilters).
   */
  private static appendAttributeFilter(
    statement: Statement,
    attributeFilter: LogRecordingRuleAttributeFilter,
  ): void {
    statement.append(
      SQL` AND arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
        type: TableColumnType.Text,
        value: attributeFilter.key,
      }}) AND v = ${{
        type: TableColumnType.Text,
        value: attributeFilter.value,
      }}, mapKeys(attributes), mapValues(attributes))`,
    );
  }

  private static buildValueExpression(valueAttribute: string): Statement {
    return SQL`toFloat64OrNull(attributes[${{
      type: TableColumnType.Text,
      value: valueAttribute,
    }}])`;
  }

  private static buildAggregateExpression(
    aggregationType: AggregationType,
    valueAttribute: string,
  ): Statement {
    if (aggregationType === AggregationType.Count) {
      return new Statement().append("count()");
    }

    const percentileLevel: number | null =
      LogRecordingRuleDefinitionUtil.getPercentileLevel(aggregationType);

    let functionCall: string;

    if (percentileLevel !== null) {
      functionCall = `quantile(${percentileLevel})`;
    } else {
      const functionNames: Partial<Record<AggregationType, string>> = {
        [AggregationType.Sum]: "sum",
        [AggregationType.Avg]: "avg",
        [AggregationType.Min]: "min",
        [AggregationType.Max]: "max",
      };

      const functionName: string | undefined = functionNames[aggregationType];

      if (!functionName) {
        throw new BadDataException(
          `Unsupported log recording rule aggregation: ${String(aggregationType)}`,
        );
      }

      functionCall = functionName;
    }

    return new Statement()
      .append(`${functionCall}(`)
      .append(LogRecordingRuleQuery.buildValueExpression(valueAttribute))
      .append(")");
  }

  /*
   * ClickHouse's JSON output writes 64-bit integers (count()) as strings
   * and finite floats as numbers.
   */
  private static readNumber(value: JSONValue | undefined): number {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && value.trim() !== "") {
      return Number(value);
    }

    return NaN;
  }

  private static readText(value: JSONValue | undefined): string {
    if (value === undefined || value === null) {
      return "";
    }

    return typeof value === "string" ? value : String(value);
  }
}
