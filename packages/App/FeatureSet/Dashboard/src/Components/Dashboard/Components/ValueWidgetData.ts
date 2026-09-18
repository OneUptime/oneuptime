import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";

/*
 * Pure, React-free data helpers for the value widget. Kept out of the .tsx so
 * the reduction that produces the single displayed number — and, just as
 * importantly, its "there was nothing to reduce" answer — can be unit-tested
 * in the node test environment.
 */

// Flatten every result's buckets into one list, in result then bucket order.
export function collectDataPoints(
  results: Array<AggregatedResult>,
): Array<AggregatedModel> {
  const dataPoints: Array<AggregatedModel> = [];
  for (const result of results) {
    for (const item of result.data) {
      dataPoints.push(item);
    }
  }
  return dataPoints;
}

/*
 * Keep only the finite per-bucket values. AggregatedModel.value is typed
 * `number` but the model carries a JSONValue index signature, and a ClickHouse
 * NULL / missing column arrives as null — left unchecked it poisons the
 * reduction with NaN.
 */
export function getNumericValues(
  dataPoints: Array<AggregatedModel>,
): Array<number> {
  const numericValues: Array<number> = [];
  for (const item of dataPoints) {
    const value: number = item.value as number;
    if (typeof value === "number" && Number.isFinite(value)) {
      numericValues.push(value);
    }
  }
  return numericValues;
}

/*
 * Reduce the per-bucket values into the single displayed number, or null when
 * there is nothing to reduce.
 *
 * The null is the point: seeding an accumulator at 0 and rendering it made an
 * empty metric indistinguishable from a genuine measurement of zero, which on
 * the RUM template read as a flawless site ("AVG LCP 0", "AVG CLS 0"). Callers
 * must render a no-data state rather than substituting a number.
 *
 * - Percentiles (P50/P90/P95/P99) are computed per bucket server-side, so —
 *   like Avg — we take the mean across the window.
 * - Count sums the per-bucket counts the server already returned
 *   (`count(value) as value`) rather than counting time buckets.
 * - Min/Max fold over the real values, so an all-positive metric's Min is not
 *   forced to exactly 0.
 */
export function aggregateValues(
  values: Array<number>,
  aggregationType: AggregationType,
): number | null {
  if (values.length === 0) {
    return null;
  }

  switch (aggregationType) {
    case AggregationType.Sum:
    case AggregationType.Count:
      return values.reduce((sum: number, value: number) => {
        return sum + value;
      }, 0);
    case AggregationType.Min:
      return Math.min(...values);
    case AggregationType.Max:
      return Math.max(...values);
    default:
      // Avg and every percentile aggregation: mean of per-bucket values.
      return (
        values.reduce((sum: number, value: number) => {
          return sum + value;
        }, 0) / values.length
      );
  }
}

/*
 * The first reason any result carries for being empty — set by client-side
 * formula evaluation, never by the server — so the widget can explain itself
 * instead of showing a bare "no data".
 */
export function getResultsErrorMessage(
  results: Array<AggregatedResult>,
): string | undefined {
  return results.find((result: AggregatedResult) => {
    return Boolean(result.errorMessage);
  })?.errorMessage;
}
