/**
 * Dashboard-scoped metric fetcher.
 *
 * Wraps `MetricUtil.fetchResults` with an in-flight request coalescer so
 * that when N panels on the same dashboard issue identical queries (same
 * metric, same time range, same filters), only one underlying HTTP call
 * goes out — the rest reuse the in-flight Promise.
 *
 * This is purely an in-flight dedup; results are not cached past settle.
 * The cache key is derived from a serialized form of the request inputs,
 * so any field change produces a new key.
 */
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import MetricUtil from "../../Metrics/Utils/Metrics";
import QueryCoalescer from "Common/Utils/Dashboard/QueryCoalescer";
import JSONFunctions from "Common/Types/JSONFunctions";
import { JSONValue } from "Common/Types/JSON";

const coalescer: QueryCoalescer<Array<AggregatedResult>> = new QueryCoalescer<
  Array<AggregatedResult>
>();

const buildCacheKey: (input: {
  metricViewData: MetricViewData;
}) => string = (input: { metricViewData: MetricViewData }): string => {
  /*
   * serializeValue normalizes class wrappers (Date, InBetween, ObjectID)
   * into a JSON-safe shape so the resulting key is stable across calls.
   */
  return JSONFunctions.toString(
    JSONFunctions.serializeValue(input.metricViewData as unknown as JSONValue),
  );
};

export default class DashboardMetricFetcher {
  public static async fetchResults(data: {
    metricViewData: MetricViewData;
    metricTypes?: Array<MetricType> | undefined;
  }): Promise<Array<AggregatedResult>> {
    const key: string = buildCacheKey({ metricViewData: data.metricViewData });
    return coalescer.run(key, () => {
      return MetricUtil.fetchResults(data);
    });
  }

  // Test helper — drops in-flight entries.
  public static __resetForTests(): void {
    coalescer.clear();
  }
}
