import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import { DataSourceValueReduce } from "../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";

/*
 * Collapsing an external Data Source time series into the single number the
 * Value and Gauge widgets show.
 *
 * The metric widgets get this for free — the OneUptime metrics API already
 * reduces server-side according to the query's "Aggregate by" — but an
 * external query returns whatever its source returns, so the reduction is a
 * widget setting and happens here, on the client.
 */
export default class DataSourceValueReducer {
  /*
   * Flatten the points into values in TIME order, discarding non-finite
   * entries. Time order is what makes First/Last mean what they say; the
   * finiteness filter matters because `value` is typed `number` but
   * AggregatedModel carries a JSONValue index signature, and a SQL NULL /
   * missing column arrives as null — left unchecked it poisons an average
   * with NaN.
   */
  public static getNumericValues(
    results: Array<AggregatedResult>,
  ): Array<number> {
    const values: Array<number> = [];

    for (const point of DataSourceValueReducer.sortPointsByTime(results)) {
      const value: number = point.value as number;
      if (typeof value === "number" && Number.isFinite(value)) {
        values.push(value);
      }
    }

    return values;
  }

  /*
   * Reduce to one number. Returns null for an empty input so callers can
   * tell "the query returned nothing" apart from "the query returned 0" —
   * seeding a reduction with 0 is what makes an empty widget render a
   * confident, wrong zero.
   *
   * Undefined `reduce` means Last: for an external query, "what is this
   * right now" is the overwhelmingly common intent, and it is the only
   * reduction that leaves a raw gauge/instant query untouched.
   */
  public static reduce(
    values: Array<number>,
    reduce: DataSourceValueReduce | undefined,
  ): number | null {
    if (values.length === 0) {
      return null;
    }

    switch (reduce) {
      case DataSourceValueReduce.First:
        return values[0]!;
      case DataSourceValueReduce.Avg:
        return (
          values.reduce((sum: number, value: number) => {
            return sum + value;
          }, 0) / values.length
        );
      case DataSourceValueReduce.Sum:
        return values.reduce((sum: number, value: number) => {
          return sum + value;
        }, 0);
      /*
       * Folded, not `Math.min(...values)`. The spread pushes one argument
       * per point onto the call stack, and a fine-step query over a wide
       * dashboard window really does return hundreds of thousands of points
       * — enough to throw RangeError mid-render, and only for these two of
       * the six reductions, which reads as a data problem rather than a bug.
       */
      case DataSourceValueReduce.Min:
        return values.reduce((min: number, value: number) => {
          return value < min ? value : min;
        }, values[0]!);
      case DataSourceValueReduce.Max:
        return values.reduce((max: number, value: number) => {
          return value > max ? value : max;
        }, values[0]!);
      case DataSourceValueReduce.Last:
      default:
        return values[values.length - 1]!;
    }
  }

  /*
   * Convenience for the widgets: numeric values + the reduced number in one
   * pass. `value` is null when the query returned no usable points.
   */
  public static reduceResults(
    results: Array<AggregatedResult>,
    reduce: DataSourceValueReduce | undefined,
  ): { values: Array<number>; value: number | null } {
    const values: Array<number> =
      DataSourceValueReducer.getNumericValues(results);

    return {
      values: values,
      value: DataSourceValueReducer.reduce(values, reduce),
    };
  }

  /*
   * First error a connector attached to a result, so an empty widget can say
   * WHY it is empty instead of just "no data".
   */
  public static getResultsErrorMessage(
    results: Array<AggregatedResult>,
  ): string | undefined {
    return results.find((result: AggregatedResult) => {
      return Boolean(result.errorMessage);
    })?.errorMessage;
  }

  /*
   * Points in timestamp order, for the sparkline. Connectors are expected to
   * return sorted data, but "expected to" is not "guaranteed to" for a
   * hand-written SQL query with no ORDER BY — an unsorted series draws a
   * scribble, and Last would pick an arbitrary point.
   */
  public static sortPointsByTime(
    results: Array<AggregatedResult>,
  ): Array<AggregatedModel> {
    const points: Array<AggregatedModel> = [];

    for (const result of results) {
      points.push(...result.data);
    }

    return points.sort((a: AggregatedModel, b: AggregatedModel): number => {
      return (
        DataSourceValueReducer.getTime(a) - DataSourceValueReducer.getTime(b)
      );
    });
  }

  private static getTime(point: AggregatedModel): number {
    const timestamp: Date =
      point.timestamp instanceof Date
        ? point.timestamp
        : new Date(point.timestamp as unknown as string);

    const time: number = timestamp.getTime();

    /*
     * NaN sorts unpredictably. Park unparseable timestamps at the start —
     * NEGATIVE_INFINITY, not 0, so they stay first even for a query that
     * legitimately returns pre-1970 timestamps.
     */
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  }
}
