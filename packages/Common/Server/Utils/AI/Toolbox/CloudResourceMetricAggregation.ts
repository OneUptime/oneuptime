import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import { getCloudResourceTypeLabel } from "../../../../Types/Cloud/CloudResourceCatalog";
import {
  CloudResourceSummedParts,
  getCloudResourceSummedParts,
} from "../../../../Types/Cloud/CloudResourceMetricAggregation";
import MetricQueryCloudAggregation, {
  MetricQueryCloudResource,
} from "../../../../Utils/Metrics/MetricQueryCloudAggregation";

/*
 * THE AGGREGATION OF AN AI METRIC READ OF A CLOUD RESOURCE, and what the
 * model is told about it.
 *
 * A Service Bus or Event Hubs namespace's metrics arrive once per queue,
 * topic and event hub, and its own number is their Sum: a count's over any
 * interval, an amount held's (messages waiting) while an interval is a
 * minute (MetricQueryCloudAggregation, CloudResourceMetricAggregation). The
 * namespace's Metrics tab and the monitors on it read so. query_metrics and
 * query_resource_telemetry read with the average where the model names no
 * aggregation, which for a namespace is the average queue: so a read whose
 * attributes name such a resource takes the catalog's aggregation instead,
 * and the model is told what it read where the two differ - a read that
 * names the average, and an amount held read in intervals longer than a
 * minute, which no aggregation of one read adds up.
 */

export interface CloudResourceMetricReadAggregation {
  aggregationType: AggregationType;
  // For the model; empty when the read needs no word.
  explanation: string;
}

function describeResource(resource: MetricQueryCloudResource): string {
  return `the ${getCloudResourceTypeLabel(resource.provider, resource.type)} ${JSON.stringify(resource.name)}`;
}

export function chooseCloudResourceMetricAggregation(data: {
  // The aggregation the model asked for, if it named one.
  requested: AggregationType | undefined;
  metricName: string;
  attributes: Record<string, string> | undefined;
  // The intervals the read is made in.
  aggregationInterval: AggregationInterval;
}): CloudResourceMetricReadAggregation {
  const resource: MetricQueryCloudResource | undefined =
    MetricQueryCloudAggregation.getCloudResource(data.attributes);
  const catalog: AggregationType | undefined =
    MetricQueryCloudAggregation.getCatalogAggregation({
      metricName: data.metricName,
      attributes: data.attributes,
      aggregationInterval: data.aggregationInterval,
    });
  // Whether the resource adds this metric up at all: by the minute, it does.
  const addsUp: boolean =
    MetricQueryCloudAggregation.getCatalogAggregation({
      metricName: data.metricName,
      attributes: data.attributes,
      aggregationInterval: AggregationInterval.Minute,
    }) === AggregationType.Sum;
  const aggregationType: AggregationType =
    data.requested || catalog || AggregationType.Avg;

  if (!resource || !addsUp) {
    return { aggregationType, explanation: "" };
  }

  const subject: string = describeResource(resource);
  // Its queues and topics, or event hubs: named for every type that adds up.
  const partNames: CloudResourceSummedParts =
    getCloudResourceSummedParts(resource)!;
  const parts: string = `${subject}'s ${partNames.all}`;

  if (catalog === AggregationType.Sum) {
    if (aggregationType === AggregationType.Sum) {
      return {
        aggregationType,
        explanation: data.requested
          ? ""
          : `Read with Sum: ${subject} reports ${data.metricName} once per ${partNames.each}, and their Sum is its own total, the number its Metrics tab shows (their Avg would be the average ${partNames.one}).`,
      };
    }

    return {
      aggregationType,
      explanation:
        aggregationType === AggregationType.Avg
          ? `Avg is the average of ${parts}, each a series of its own, not ${subject}'s own number: its total, the number its Metrics tab shows, is their Sum - read it with aggregationType Sum.`
          : `${aggregationType} is taken over ${parts}, each a series of its own; ${subject}'s own total, the number its Metrics tab shows, is their Sum.`,
    };
  }

  // An amount held, read in intervals longer than a minute, or whole.
  const isWhole: boolean =
    data.aggregationInterval === AggregationInterval.Total;

  if (aggregationType === AggregationType.Sum) {
    return {
      aggregationType,
      explanation: `A Sum ${isWhole ? "over the whole window" : `in ${data.aggregationInterval} intervals`} adds up several minutes of every one of ${parts}: no amount ${subject} ever held. Its total is the Sum of a read made by the minute: a shorter window, read as a trend.`,
    };
  }

  return {
    aggregationType,
    explanation: `${aggregationType} of ${parts}: ${data.metricName} adds up across them only a minute at a time, and ${isWhole ? "this whole-window read holds" : `this read's ${data.aggregationInterval} intervals hold`} several minutes of each. For ${subject}'s total, read a window short enough to be read by the minute, with aggregationType Sum.`,
  };
}
