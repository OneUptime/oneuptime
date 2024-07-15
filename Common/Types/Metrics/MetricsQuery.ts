import Dictionary from "../Dictionary";
import MetricsAggregationType from "./MetricsAggregationType";

export default interface MetricsQuery {
    metricName: string; 
    attributes: Dictionary<string | boolean | number>;
    aggegationType: MetricsAggregationType;
    aggregateBy: Dictionary<boolean>;
    startTime: Date; 
    endTime: Date;
}