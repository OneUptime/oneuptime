import GroupBy from "../../Server/Types/Database/GroupBy";
import GenericObject from "../GenericObject";
import AggregationInterval from "./AggregationInterval";
import AggregationType from "./AggregationType";
import Query from "./Query";
import Sort from "./Sort";

export default interface AggregateBy<TBaseModel extends GenericObject> {
  aggregateColumnName: keyof TBaseModel;
  aggregationType: AggregationType;
  /**
   * Optional explicit time-bucket size. When omitted (the default), the
   * bucket size is derived from the query window (≤3h → minute, ≤12h →
   * 5 minutes, ≤24h → 15 minutes, ≤3d → 30 minutes, ≤7d → hour, ≤6w →
   * day, …) — see AggregationIntervalUtil. Set this to pin a
   * granularity independent of the window (e.g. `Day` buckets over a
   * one-week window), or to `Total` to aggregate the whole window into a
   * single value per group (no time bucketing). Invalid values are
   * rejected with a 400 in AnalyticsDatabaseService.aggregateBy.
   */
  aggregationInterval?: AggregationInterval | undefined;
  aggregationTimestampColumnName: keyof TBaseModel;
  startTimestamp: Date;
  endTimestamp: Date;
  query: Query<TBaseModel>;
  limit: number;
  skip: number;
  sort?: Sort<TBaseModel> | undefined;
  groupBy?: GroupBy<TBaseModel> | undefined;
  /**
   * OpenTelemetry attribute keys (e.g. "service.name") to group the
   * aggregation by. Grouping happens on the individual map entries —
   * `attributes['service.name']` — so all rows sharing the selected
   * key values are pooled into one series per bucket. This is distinct
   * from `groupBy: { attributes: true }`, which groups by the ENTIRE
   * attribute map and therefore fragments the result into one series
   * per unique attribute combination. Only supported by models with an
   * `attributes` map column (currently Metric); result rows carry an
   * `attributes` object containing exactly these keys.
   */
  groupByAttributeKeys?: Array<string> | undefined;
  /**
   * Server-side Top-K group selection for grouped aggregations. When
   * set (and the aggregation is grouped via `groupBy` /
   * `groupByAttributeKeys`), the server ranks groups by `rankBy`
   * (max or avg of the aggregated column) over the WHOLE query window,
   * keeps only the top `count` groups, and reports the total number of
   * matching groups via `AggregatedResult.totalGroups` — so a chart can
   * plot the top 10 series without fetching every bucket of every
   * group. Ignored for ungrouped aggregations. Plain JSON so it
   * round-trips the API's serialize/deserialize unchanged.
   */
  topK?:
    | {
        count: number;
        rankBy: "max" | "avg";
      }
    | undefined;
}
