import { Dictionary } from "lodash";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import GlobalCache from "../../Infrastructure/GlobalCache";
import TelemetryAttributeService from "../../Services/TelemetryAttributeService";
import CaptureSpan from "./CaptureSpan";
import logger from "../Logger";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import MetricTypeService from "../../Services/MetricTypeService";
import TelemetryService from "../../../Models/DatabaseModels/TelemetryService";

export type AttributeType = string | number | boolean | null;

export default class TelemetryUtil {
  @CaptureSpan()
  public static async indexMetricNameServiceNameMap(data: {
    projectId: ObjectID;
    metricNameServiceNameMap: Dictionary<Array<ObjectID>>;
  }): Promise<void> {
    for (const metricName of Object.keys(data.metricNameServiceNameMap)) {
      // fetch metric
      const metricType: MetricType | null = await MetricTypeService.findOneBy({
        query: {
          projectId: data.projectId,
          name: metricName,
        },
        select: {
          telemetryServices: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (metricType) {
        if (!metricType.telemetryServices) {
          metricType.telemetryServices = [];
        }

        const telemetryServiceIds: Array<ObjectID> =
          metricType.telemetryServices!.map((service: TelemetryService) => {
            return service.id!;
          });

        // check if telemetry services are same as the ones in the map
        const telemetryServicesInMap: Array<ObjectID> =
          data.metricNameServiceNameMap[metricName] || [];

        let isSame: boolean = true;

        for (const telemetryServiceId of telemetryServicesInMap) {
          if (
            telemetryServiceIds.filter((serviceId: ObjectID) => {
              return serviceId.toString() === telemetryServiceId.toString();
            }).length === 0
          ) {
            isSame = false;
            // add the service id to the list
            const telemetryService: TelemetryService = new TelemetryService();
            telemetryService.id = telemetryServiceId;
            metricType.telemetryServices!.push(telemetryService);
          }
        }

        // if its not the same then update the metric type

        if (!isSame) {
          // update metric type
          await MetricTypeService.updateOneById({
            id: metricType.id!,
            data: {
              telemetryServices: metricType.telemetryServices || [],
            },
            props: {
              isRoot: true,
            },
          } as any);
        }
      } else {
        // create metric type
        const metricType: MetricType = new MetricType();
        metricType.name = metricName;
        metricType.projectId = data.projectId;
        metricType.telemetryServices = [];

        const telemetryServiceIds: Array<ObjectID> =
          data.metricNameServiceNameMap[metricName] || [];

        for (const telemetryServiceId of telemetryServiceIds) {
          const telemetryService: TelemetryService = new TelemetryService();
          telemetryService.id = telemetryServiceId;
          metricType.telemetryServices!.push(telemetryService);
        }

        // save metric type
        await MetricTypeService.create({
          data: metricType,
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  @CaptureSpan()
  public static async indexAttributes(data: {
    attributes: Array<string>;
    projectId: ObjectID;
    telemetryType: TelemetryType;
  }): Promise<void> {
    // index attributes

    logger.debug("Indexing attributes");
    logger.debug("data: " + JSON.stringify(data, null, 2));

    const cacheKey: string =
      data.projectId.toString() + "_" + data.telemetryType;

    // get keys from cache
    const cacheKeys: string[] =
      (await GlobalCache.getStringArray("telemetryAttributesKeys", cacheKey)) ||
      [];

    let isKeysMissingInCache: boolean = false;

    // check if keys are missing in cache

    const attributeKeys: string[] = data.attributes;

    for (const key of attributeKeys) {
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

      const mergedKeys: Array<string> = Array.from(
        new Set([...dbKeys, ...attributeKeys, ...cacheKeys]),
      );

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

  public static getAttributesForServiceIdAndServiceName(data: {
    serviceId: ObjectID;
    serviceName: string;
  }): Dictionary<AttributeType> {
    // get attributes for service id and service name
    return {
      "oneuptime.service.id": data.serviceId.toString(),
      "oneuptime.service.name": data.serviceName,
    };
  }

  @CaptureSpan()
  public static getAttributes(data: {
    prefixKeysWithString: string;
    items: JSONArray;
  }): Dictionary<AttributeType | Array<AttributeType>> {
    const { items } = data;
    let { prefixKeysWithString } = data;

    if (prefixKeysWithString) {
      prefixKeysWithString = prefixKeysWithString + ".";
    }

    let finalObj: Dictionary<AttributeType | Array<AttributeType>> = {};
    const attributes: JSONArray = items;

    if (!attributes) {
      return finalObj;
    }

    for (const attribute of attributes) {
      if (attribute["key"] && typeof attribute["key"] === "string") {
        const keyWithPrefix: string = `${prefixKeysWithString}${attribute["key"]}`;

        const value:
          | AttributeType
          | Dictionary<AttributeType>
          | Array<AttributeType> = this.getAttributeValues(
          keyWithPrefix,
          attribute["value"],
        );

        if (Array.isArray(value)) {
          finalObj = { ...finalObj, [keyWithPrefix]: value };
        } else if (typeof value === "object" && value !== null) {
          finalObj = { ...finalObj, ...(value as Dictionary<AttributeType>) };
        } else {
          finalObj[keyWithPrefix] = value;
        }
      }
    }

    return finalObj;
  }

  public static getAttributeValues(
    prefixKeysWithString: string,
    value: JSONValue,
  ): AttributeType | Dictionary<AttributeType> | Array<AttributeType> {
    let finalObj:
      | Dictionary<AttributeType>
      | AttributeType
      | Array<AttributeType> = null;
    value = value as JSONObject;

    if (value["stringValue"]) {
      finalObj = value["stringValue"] as string;
    } else if (value["intValue"]) {
      finalObj = value["intValue"] as number;
    } else if (value["doubleValue"]) {
      finalObj = value["doubleValue"] as number;
    } else if (value["boolValue"]) {
      finalObj = value["boolValue"] as boolean;
    } else if (
      value["arrayValue"] &&
      (value["arrayValue"] as JSONObject)["values"]
    ) {
      const values: JSONArray = (value["arrayValue"] as JSONObject)[
        "values"
      ] as JSONArray;
      finalObj = values.map((v: JSONObject) => {
        return this.getAttributeValues(
          prefixKeysWithString,
          v,
        ) as AttributeType;
      }) as Array<AttributeType>;
    } else if (
      value["mapValue"] &&
      (value["mapValue"] as JSONObject)["fields"]
    ) {
      const fields: JSONObject = (value["mapValue"] as JSONObject)?.[
        "fields"
      ] as JSONObject;

      const flattenedFields: Dictionary<AttributeType> = {};
      for (const key in fields) {
        const prefixKey: string = `${prefixKeysWithString}.${key}`;
        const nestedValue: AttributeType | Dictionary<AttributeType> =
          this.getAttributeValues(prefixKey, fields[key]) as AttributeType;
        if (typeof nestedValue === "object" && nestedValue !== null) {
          for (const nestedKey in nestedValue as Dictionary<AttributeType>) {
            flattenedFields[`${prefixKey}.${nestedKey}`] = (
              nestedValue as Dictionary<AttributeType>
            )[nestedKey] as AttributeType;
          }
        } else {
          flattenedFields[prefixKey] = nestedValue;
        }
      }
      finalObj = flattenedFields;
    }
    // kvlistValue
    else if (
      value["kvlistValue"] &&
      (value["kvlistValue"] as JSONObject)["values"]
    ) {
      const values: JSONArray = (value["kvlistValue"] as JSONObject)[
        "values"
      ] as JSONArray;
      finalObj = this.getAttributes({
        prefixKeysWithString,
        items: values,
      }) as Dictionary<AttributeType>;
    } else if (value["nullValue"]) {
      finalObj = null;
    }

    return finalObj;
  }
}
