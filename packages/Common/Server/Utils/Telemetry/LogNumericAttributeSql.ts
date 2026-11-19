import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import AggregationType, {
  getPercentileLevel,
} from "../../../Types/BaseDatabase/AggregationType";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * A NUMBER IN A LOG'S ATTRIBUTES, READ ONE WAY.
 *
 * A log's attributes are text (Map(String, String)): an OpenTelemetry int or
 * double arrives as its digits. Two reads aggregate one of them as a number
 * - a log recording rule's minute (LogRecordingRuleQuery) and the log
 * explorer's Analytics (LogAggregationService) - and both read it here, so
 * a chart and the rule made from it agree on every value:
 *
 *   - the value is toFloat64OrNull(attributes[{key}]), the key a bound
 *     query parameter, never SQL;
 *   - a log counts when that is a finite number: an integer or a decimal,
 *     signed or not, in scientific notation or not ("42", "-7", "3.14",
 *     ".5", "1e3"). A log without the attribute, or whose value is anything
 *     else - "12ms", "n/a", " 12" with a space, "1,5", "0x1A", "true", an
 *     empty value, "nan", "inf" or a number too large for a Float64 - is
 *     left out by the WHERE clause, never read as 0 and never failing the
 *     read;
 *   - the aggregate is ClickHouse's own: sum, avg, min, max, or
 *     quantile(level) for a percentile - reservoir sampling of at most
 *     8,192 values per group, so a percentile's memory is bounded however
 *     many logs it reads, as the trace explorer's percentiles are.
 *
 * Only code-owned text is appended raw: the function names and a
 * percentile's level, which comes from AggregationType.
 */
export default class LogNumericAttributeSql {
  // The attribute read as a number: NULL when it is missing or not one.
  public static buildValueExpression(attributeKey: string): Statement {
    return SQL`toFloat64OrNull(attributes[${{
      type: TableColumnType.Text,
      value: attributeKey,
    }}])`;
  }

  /*
   * Only the logs whose attribute is a finite number. The key check rides
   * the attributeKeys bloom index first, as StatementGenerator's map filters
   * do; rows written before that column existed have it empty and fall
   * through to the value test.
   */
  public static appendIsNumberFilter(
    statement: Statement,
    attributeKey: string,
  ): void {
    statement.append(
      SQL` AND (empty(attributeKeys) OR hasAny(attributeKeys, ${{
        type: TableColumnType.ArrayText,
        value: [attributeKey],
      }})) AND isFinite(`,
    );
    statement.append(LogNumericAttributeSql.buildValueExpression(attributeKey));
    statement.append(")");
  }

  // The aggregate of the attribute's values: sum(...), quantile(0.95)(...).
  public static buildAggregateExpression(
    aggregationType: AggregationType,
    attributeKey: string,
  ): Statement {
    return new Statement()
      .append(`${LogNumericAttributeSql.getFunctionCall(aggregationType)}(`)
      .append(LogNumericAttributeSql.buildValueExpression(attributeKey))
      .append(")");
  }

  private static getFunctionCall(aggregationType: AggregationType): string {
    const percentileLevel: number | null = getPercentileLevel(aggregationType);

    if (percentileLevel !== null) {
      return `quantile(${percentileLevel})`;
    }

    const functionNames: Partial<Record<AggregationType, string>> = {
      [AggregationType.Sum]: "sum",
      [AggregationType.Avg]: "avg",
      [AggregationType.Min]: "min",
      [AggregationType.Max]: "max",
    };

    const functionName: string | undefined = functionNames[aggregationType];

    if (!functionName) {
      throw new BadDataException(
        `A numeric log attribute cannot be aggregated as ${String(aggregationType)}. Use a sum, an average, a minimum, a maximum or a percentile.`,
      );
    }

    return functionName;
  }
}
