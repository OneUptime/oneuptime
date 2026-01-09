import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CaptureSpan from "./CaptureSpan";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import MetricTypeService from "../../Services/MetricTypeService";
import Service from "../../../Models/DatabaseModels/Service";
import Dictionary from "../../../Types/Dictionary";

export type AttributeType = string | number | boolean | null;

export default class TelemetryUtil {
  @CaptureSpan()
  public static async indexMetricNameServiceNameMap(data: {
    projectId: ObjectID;
    metricNameServiceNameMap: Dictionary<MetricType>;
  }): Promise<void> {
    for (const metricName of Object.keys(data.metricNameServiceNameMap)) {
      // fetch metric
      const metricType: MetricType | null = await MetricTypeService.findOneBy({
        query: {
          projectId: data.projectId,
          name: metricName,
        },
        select: {
          services: true,
          name: true,
          description: true,
          unit: true,
        },
        props: {
          isRoot: true,
        },
      });

      const metricTypeInMap: MetricType =
        data.metricNameServiceNameMap[metricName]!;

      // check if services are same as the ones in the map
      const servicesInMap: Array<ObjectID> =
        metricTypeInMap?.services?.map((service: Service) => {
          return service.id!;
        }) || [];

      if (metricType) {
        if (!metricType.services) {
          metricType.services = [];
        }

        const serviceIds: Array<ObjectID> = metricType.services!.map(
          (service: Service) => {
            return service.id!;
          },
        );

        let isSame: boolean = true;

        // check if description is same
        if (metricType.description !== metricTypeInMap.description) {
          isSame = false;
          metricType.description = metricTypeInMap.description || "";
        }

        // check if unit is same
        if (metricType.unit !== metricTypeInMap.unit) {
          isSame = false;
          metricType.unit = metricTypeInMap.unit || "";
        }

        // check if services are same

        for (const serviceId of servicesInMap) {
          if (
            serviceIds.filter((existingServiceId: ObjectID) => {
              return existingServiceId.toString() === serviceId.toString();
            }).length === 0
          ) {
            isSame = false;
            // add the service id to the list
            const service: Service = new Service();
            service.id = serviceId;
            metricType.services!.push(service);
          }
        }

        // if its not the same then update the metric type

        if (!isSame) {
          // update metric type
          await MetricTypeService.updateOneById({
            id: metricType.id!,
            data: {
              services: metricType.services || [],
              description: metricTypeInMap.description || "",
              unit: metricTypeInMap.unit || "",
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
        metricType.description = metricTypeInMap.description || "";
        metricType.unit = metricTypeInMap.unit || "";
        metricType.projectId = data.projectId;
        metricType.services = [];

        for (const serviceId of servicesInMap) {
          const service: Service = new Service();
          service.id = serviceId;
          metricType.services!.push(service);
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
      prefixKeysWithString = `${prefixKeysWithString}.`;
    }

    const finalObj: Dictionary<AttributeType | Array<AttributeType>> = {};
    const attributes: JSONArray = items;

    if (!attributes) {
      return finalObj;
    }

    for (const attribute of attributes) {
      if (!attribute["key"] || typeof attribute["key"] !== "string") {
        continue;
      }

      const keyWithPrefix: string = `${prefixKeysWithString}${attribute["key"]}`;

      const value:
        | AttributeType
        | Dictionary<AttributeType | Array<AttributeType>>
        | Array<AttributeType>
        | null = this.getAttributeValues(keyWithPrefix, attribute["value"]);

      if (value === null) {
        finalObj[keyWithPrefix] = null;
        continue;
      }

      if (Array.isArray(value)) {
        finalObj[keyWithPrefix] = value;
        continue;
      }

      if (typeof value === "object") {
        for (const [nestedKey, nestedValue] of Object.entries(
          value as Dictionary<AttributeType | Array<AttributeType>>,
        )) {
          finalObj[nestedKey] = nestedValue as
            | AttributeType
            | Array<AttributeType>;
        }

        continue;
      }

      finalObj[keyWithPrefix] = value as AttributeType;
    }

    return finalObj;
  }

  public static getAttributeValues(
    prefixKeysWithString: string,
    value: JSONValue,
  ):
    | AttributeType
    | Dictionary<AttributeType | Array<AttributeType>>
    | Array<AttributeType>
    | null {
    let finalObj:
      | Dictionary<AttributeType | Array<AttributeType>>
      | AttributeType
      | Array<AttributeType>
      | null = null;
    const jsonValue: JSONObject = value as JSONObject;

    if (jsonValue && typeof jsonValue === "object") {
      if (Object.prototype.hasOwnProperty.call(jsonValue, "stringValue")) {
        const stringValue: JSONValue = jsonValue["stringValue"];
        finalObj =
          stringValue !== undefined && stringValue !== null
            ? (stringValue as string)
            : "";
      } else if (Object.prototype.hasOwnProperty.call(jsonValue, "intValue")) {
        const intValue: JSONValue = jsonValue["intValue"];
        if (intValue !== undefined && intValue !== null) {
          finalObj = intValue as number;
        }
      } else if (
        Object.prototype.hasOwnProperty.call(jsonValue, "doubleValue")
      ) {
        const doubleValue: JSONValue = jsonValue["doubleValue"];
        if (doubleValue !== undefined && doubleValue !== null) {
          finalObj = doubleValue as number;
        }
      } else if (Object.prototype.hasOwnProperty.call(jsonValue, "boolValue")) {
        finalObj = jsonValue["boolValue"] as boolean;
      } else if (
        jsonValue["arrayValue"] &&
        (jsonValue["arrayValue"] as JSONObject)["values"]
      ) {
        const values: JSONArray = (jsonValue["arrayValue"] as JSONObject)[
          "values"
        ] as JSONArray;
        finalObj = values.map((v: JSONObject) => {
          return this.getAttributeValues(
            prefixKeysWithString,
            v,
          ) as AttributeType;
        }) as Array<AttributeType>;
      } else if (
        jsonValue["mapValue"] &&
        (jsonValue["mapValue"] as JSONObject)["fields"]
      ) {
        const fields: JSONObject = (jsonValue["mapValue"] as JSONObject)[
          "fields"
        ] as JSONObject;

        const flattenedFields: Dictionary<
          AttributeType | Array<AttributeType>
        > = {};
        for (const key in fields) {
          const nestedPrefix: string = `${prefixKeysWithString}.${key}`;
          const nestedValue:
            | AttributeType
            | Dictionary<AttributeType | Array<AttributeType>>
            | Array<AttributeType>
            | null = this.getAttributeValues(nestedPrefix, fields[key]);

          if (nestedValue === null) {
            flattenedFields[nestedPrefix] = null;
            continue;
          }

          if (Array.isArray(nestedValue)) {
            flattenedFields[nestedPrefix] = nestedValue;
            continue;
          }

          if (typeof nestedValue === "object") {
            for (const [nestedKey, nestedEntry] of Object.entries(
              nestedValue as Dictionary<AttributeType | Array<AttributeType>>,
            )) {
              flattenedFields[nestedKey] = nestedEntry as
                | AttributeType
                | Array<AttributeType>;
            }

            continue;
          }

          flattenedFields[nestedPrefix] = nestedValue as AttributeType;
        }

        finalObj = flattenedFields;
      } else if (
        jsonValue["kvlistValue"] &&
        (jsonValue["kvlistValue"] as JSONObject)["values"]
      ) {
        const values: JSONArray = (jsonValue["kvlistValue"] as JSONObject)[
          "values"
        ] as JSONArray;
        finalObj = this.getAttributes({
          prefixKeysWithString,
          items: values,
        });
      } else if ("nullValue" in jsonValue) {
        finalObj = null;
      }
    }

    return finalObj;
  }

  public static getAttributeKeys(
    attributes:
      | Dictionary<AttributeType | Array<AttributeType> | JSONObject>
      | JSONObject
      | undefined,
  ): Array<string> {
    if (!attributes || typeof attributes !== "object") {
      return [];
    }

    return Object.keys(attributes).sort();
  }
}
