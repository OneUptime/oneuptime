import OneUptimeDate from "Common/Types/Date";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import Metric, { AggregationTemporality } from "Model/AnalyticsModels/Metric";

export enum OtelAggregationTemporality {
  Cumulative = "AGGREGATION_TEMPORALITY_CUMULATIVE",
  Delta = "AGGREGATION_TEMPORALITY_DELTA",
}

export default class OTelIngestService {
  public static getAttributes(items: JSONArray): JSONObject {
    const finalObj: JSONObject = {};
    // We need to convert this to date.
    const attributes: JSONArray = items;

    if (attributes) {
      for (const attribute of attributes) {
        if (attribute["key"] && typeof attribute["key"] === "string") {
          let value: JSONValue = attribute["value"] as JSONObject;

          if (value["stringValue"]) {
            value = value["stringValue"] as string;
          } else if (value["intValue"]) {
            value = value["intValue"] as number;
          } else if (value["doubleValue"]) {
            value = value["doubleValue"] as number;
          } else if (value["boolValue"]) {
            value = value["boolValue"] as boolean;
          } else if (value["arrayValue"]) {
            value = value["arrayValue"] as JSONArray;
          } else if (value["mapValue"]) {
            value = value["mapValue"] as JSONObject;
          } else if (value["nullValue"]) {
            value = null;
          }

          finalObj[attribute["key"]] = value;
        }
      }
    }

    return JSONFunctions.flattenObject(finalObj);
  }

  public static getMetricFromDatapoint(data: {
    dbMetric: Metric;
    datapoint: JSONObject;
    aggregationTemporality: OtelAggregationTemporality;
    isMonotonic: boolean | undefined;
  }): Metric {
    const { dbMetric, datapoint, aggregationTemporality, isMonotonic } = data;

    const newDbMetric: Metric = Metric.fromJSON(
      dbMetric.toJSON(),
      Metric,
    ) as Metric;

    newDbMetric.startTimeUnixNano = datapoint["startTimeUnixNano"] as number;
    newDbMetric.startTime = OneUptimeDate.fromUnixNano(
      datapoint["startTimeUnixNano"] as number,
    );

    newDbMetric.timeUnixNano = datapoint["timeUnixNano"] as number;
    newDbMetric.time = OneUptimeDate.fromUnixNano(
      datapoint["timeUnixNano"] as number,
    );

    if (Object.keys(datapoint).includes("asInt")) {
      newDbMetric.value = datapoint["asInt"] as number;
    } else if (Object.keys(datapoint).includes("asDouble")) {
      newDbMetric.value = datapoint["asDouble"] as number;
    }

    newDbMetric.count = datapoint["count"] as number;
    newDbMetric.sum = datapoint["sum"] as number;

    newDbMetric.min = datapoint["min"] as number;
    newDbMetric.max = datapoint["max"] as number;

    newDbMetric.bucketCounts = datapoint["bucketCounts"] as Array<number>;
    newDbMetric.explicitBounds = datapoint["explicitBounds"] as Array<number>;

    // attrbutes

    if (Object.keys(datapoint).includes("attributes")) {
      if (!newDbMetric.attributes) {
        newDbMetric.attributes = {};
      }

      newDbMetric.attributes = {
        ...(newDbMetric.attributes || {}),
        ...this.getAttributes(datapoint["attributes"] as JSONArray),
      };
    }

    if (newDbMetric.attributes) {
      newDbMetric.attributes = JSONFunctions.flattenObject(
        newDbMetric.attributes,
      );
    }

    // aggregationTemporality

    if (aggregationTemporality) {
      if (aggregationTemporality === OtelAggregationTemporality.Cumulative) {
        newDbMetric.aggregationTemporality = AggregationTemporality.Cumulative;
      }

      if (aggregationTemporality === OtelAggregationTemporality.Delta) {
        newDbMetric.aggregationTemporality = AggregationTemporality.Delta;
      }
    }

    if (isMonotonic !== undefined) {
      newDbMetric.isMonotonic = isMonotonic;
    }

    return newDbMetric;
  }
}
