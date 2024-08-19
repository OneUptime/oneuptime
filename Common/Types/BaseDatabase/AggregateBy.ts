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
}
