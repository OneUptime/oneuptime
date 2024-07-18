import GenericObject from "../GenericObject";
import PositiveNumber from "../PositiveNumber";
import AggregationInterval from "./AggregationInterval";
import AggregationType from "./AggregationType";
import Query from "./Query";
import Sort from "./Sort";

export default interface AggregateBy<TBaseModel extends GenericObject> {
  aggregateColumnName: keyof TBaseModel;
  aggregateBy: AggregationType;
  aggregationInterval?: AggregationInterval;
  aggregationTimestampColumnName: keyof TBaseModel;
  startTimestamp?: Date;
  endTimestamp?: Date;
  query: Query<TBaseModel>;
  limit: PositiveNumber;
  skip: PositiveNumber;
  sort?: Sort<TBaseModel> | undefined;
}
