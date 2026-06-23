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
  /*
   * OpenTelemetry / analytics attribute keys to group by. These are stored
   * inside the Metric.attributes Map column, so they cannot be expressed as
   * top-level GroupBy<Metric> keys without grouping the entire attributes map.
   */
  groupByAttributeKeys?: Array<string> | undefined;
}
