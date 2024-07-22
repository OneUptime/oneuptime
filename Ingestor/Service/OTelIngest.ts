import OneUptimeDate from "Common/Types/Date";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Metric, { AggregationTemporality } from "Model/AnalyticsModels/Metric";

export enum OtelAggregationTemporality {
  Cumulative = "AGGREGATION_TEMPORALITY_CUMULATIVE",
  Delta = "AGGREGATION_TEMPORALITY_DELTA",
}

export default class OTelIngestService {
  public static getAttributes(data: {
    items: JSONArray;
    telemetryServiceId?: ObjectID;
    telemetryServiceName?: string;
  }): JSONObject {
    const { items } = data;

    const finalObj: JSONObject = {};
    // We need to convert this to date.
    const attributes: JSONArray = items;

    type GetValueFunction = (value: JSONValue) => JSONValue;

    const getValue: GetValueFunction = (value: JSONValue): JSONValue => {
      value = value as JSONObject;

      if (value["stringValue"]) {
        value = value["stringValue"] as string;
      } else if (value["intValue"]) {
        value = value["intValue"] as number;
      } else if (value["doubleValue"]) {
        value = value["doubleValue"] as number;
      } else if (value["boolValue"]) {
        value = value["boolValue"] as boolean;
      } else if (
        value["arrayValue"] &&
        (value["arrayValue"] as JSONObject)["values"]
      ) {
        value = (
          (value["arrayValue"] as JSONObject)["values"] as JSONArray
        ).map((v: JSONObject) => {
          return getValue(v);
        });
      } else if (
        value["mapValue"] &&
        (value["mapValue"] as JSONObject)["fields"]
      ) {
        value = getValue((value["mapValue"] as JSONObject)["fields"]);
      } else if (value["nullValue"]) {
        value = null;
      }

      return value;
    };

    if (attributes) {
      for (const attribute of attributes) {
        if (attribute["key"] && typeof attribute["key"] === "string") {
          const value: JSONValue = getValue(attribute["value"]);
          finalObj[attribute["key"]] = value;
        }
      }
    }

    // add oneuptime specific attributes
    if (!finalObj["oneuptime"]) {
      finalObj["oneuptime"] = {};
    }

    if (!(finalObj["oneuptime"] as JSONObject)["telemetry"]) {
      (finalObj["oneuptime"] as JSONObject)["telemetry"] = {};
    }

    if (
      !((finalObj["oneuptime"] as JSONObject)["telemetry"] as JSONObject)[
        "service"
      ]
    ) {
      ((finalObj["oneuptime"] as JSONObject)["telemetry"] as JSONObject)[
        "service"
      ] = {};
    }

    if (data.telemetryServiceId) {
      (
        ((finalObj["oneuptime"] as JSONObject)["telemetry"] as JSONObject)[
          "service"
        ] as JSONObject
      )["id"] = data.telemetryServiceId.toString();
    }

    if (data.telemetryServiceName) {
      (
        ((finalObj["oneuptime"] as JSONObject)["telemetry"] as JSONObject)[
          "service"
        ] as JSONObject
      )["name"] = data.telemetryServiceName;
    }

    return JSONFunctions.flattenObject(finalObj);
  }

  public static getMetricFromDatapoint(data: {
    dbMetric: Metric;
    datapoint: JSONObject;
    aggregationTemporality: OtelAggregationTemporality;
    isMonotonic: boolean | undefined;
    telemetryServiceId: ObjectID;
    telemetryServiceName: string;
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

    if(!newDbMetric.value){
      newDbMetric.value = newDbMetric.sum;
    }

    // attrbutes

    if (Object.keys(datapoint).includes("attributes")) {
      if (!newDbMetric.attributes) {
        newDbMetric.attributes = {};
      }

      newDbMetric.attributes = {
        ...(newDbMetric.attributes || {}),
        ...this.getAttributes({
          items: datapoint["attributes"] as JSONArray,
          telemetryServiceId: data.telemetryServiceId,
          telemetryServiceName: data.telemetryServiceName,
        }),
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
