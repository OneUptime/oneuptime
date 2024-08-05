import ArrayUtil from "Common/Types/ArrayUtil";
import OneUptimeDate from "Common/Types/Date";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import GlobalCache from "CommonServer/Infrastructure/GlobalCache";
import Metric, {
  AggregationTemporality,
} from "Common/AppModels/AnalyticsModels/Metric";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TelemetryAttributeService from "CommonServer/Services/TelemetryAttributeService";
import Dictionary from "Common/Types/Dictionary";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { IsBillingEnabled } from "CommonServer/EnvironmentConfig";
import TelemetryUsageBillingService from "CommonServer/Services/TelemetryUsageBillingService";
import logger from "CommonServer/Utils/Logger";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import TelemetryServiceService from "CommonServer/Services/TelemetryServiceService";
import { DEFAULT_RETENTION_IN_DAYS } from "Common/Models/DatabaseModels/TelemetryUsageBilling";

export enum OtelAggregationTemporality {
  Cumulative = "AGGREGATION_TEMPORALITY_CUMULATIVE",
  Delta = "AGGREGATION_TEMPORALITY_DELTA",
}

export interface TelemetryServiceDataIngested {
  serviceName: string;
  serviceId: ObjectID;
  dataIngestedInGB: number;
  dataRententionInDays: number;
}

export default class OTelIngestService {
  public static async telemetryServiceFromName(data: {
    serviceName: string;
    projectId: ObjectID;
  }): Promise<{
    serviceId: ObjectID;
    dataRententionInDays: number;
  }> {
    const service: TelemetryService | null =
      await TelemetryServiceService.findOneBy({
        query: {
          projectId: data.projectId,
          name: data.serviceName,
        },
        select: {
          _id: true,
          retainTelemetryDataForDays: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!service) {
      // create service

      const newService: TelemetryService = new TelemetryService();
      newService.projectId = data.projectId;
      newService.name = data.serviceName;
      newService.description = data.serviceName;
      newService.retainTelemetryDataForDays = DEFAULT_RETENTION_IN_DAYS;

      const createdService: TelemetryService =
        await TelemetryServiceService.create({
          data: newService,
          props: {
            isRoot: true,
          },
        });

      return {
        serviceId: createdService.id!,
        dataRententionInDays: DEFAULT_RETENTION_IN_DAYS,
      };
    }

    return {
      serviceId: service.id!,
      dataRententionInDays:
        service.retainTelemetryDataForDays || DEFAULT_RETENTION_IN_DAYS,
    };
  }

  public static async recordDataIngestedUsgaeBilling(data: {
    services: Dictionary<TelemetryServiceDataIngested>;
    projectId: ObjectID;
    productType: ProductType;
  }): Promise<void> {
    if (!IsBillingEnabled) {
      return;
    }

    for (const serviceName in data.services) {
      const serviceData: TelemetryServiceDataIngested | undefined =
        data.services[serviceName];

      if (!serviceData) {
        continue;
      }

      TelemetryUsageBillingService.updateUsageBilling({
        projectId: data.projectId,
        productType: data.productType,
        dataIngestedInGB: serviceData.dataIngestedInGB || 0,
        telemetryServiceId: serviceData.serviceId,
        retentionInDays: serviceData.dataRententionInDays,
      }).catch((err: Error) => {
        logger.error("Failed to update usage billing for OTel");
        logger.error(err);
      });
    }
  }

  public static async indexAttributes(data: {
    attributes: string[];
    projectId: ObjectID;
    telemetryType: TelemetryType;
  }): Promise<void> {
    // index attributes

    const cacheKey: string =
      data.projectId.toString() + "_" + data.telemetryType;

    // get keys from cache
    const cacheKeys: string[] =
      (await GlobalCache.getStringArray("telemetryAttributesKeys", cacheKey)) ||
      [];

    let isKeysMissingInCache: boolean = false;

    // check if keys are missing in cache

    for (const key of data.attributes) {
      if (!cacheKeys.includes(key)) {
        isKeysMissingInCache = true;
        break;
      }
    }

    // merge keys and remove duplicates
    if (isKeysMissingInCache) {
      const dbKeys: string[] = await TelemetryAttributeService.fetchAttributes({
        projectId: data.projectId,
        telemetryType: data.telemetryType,
      });

      const mergedKeys: Array<string> = ArrayUtil.removeDuplicates([
        ...dbKeys,
        ...data.attributes,
        ...cacheKeys,
      ]);

      await GlobalCache.setStringArray(
        "telemetryAttributesKeys",
        cacheKey,
        mergedKeys,
      );

      await TelemetryAttributeService.refreshAttributes({
        projectId: data.projectId,
        telemetryType: data.telemetryType,
        attributes: mergedKeys,
      });
    }
  }

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

    if (!newDbMetric.value) {
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
