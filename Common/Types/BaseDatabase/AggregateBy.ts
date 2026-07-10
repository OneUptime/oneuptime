import GroupBy from "../../Server/Types/Database/GroupBy";
import GenericObject from "../GenericObject";
import AggregationType from "./AggregationType";
import Query from "./Query";
import Sort from "./Sort";

export default interface AggregateBy<TBaseModel extends GenericObject> {
  aggregateColumnName: keyof TBaseModel;
  aggregationType: AggregationType;
  // aggregationInterval?: AggregationInterval;
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
}
