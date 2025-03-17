import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import ArrayUtil from "../../../Utils/Array";
import GlobalCache from "../../Infrastructure/GlobalCache";
import TelemetryAttributeService from "../../Services/TelemetryAttributeService";
import CaptureSpan from "./CaptureSpan";

export default class TelemetryUtil {
  @CaptureSpan()
  @CaptureSpan()
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

  @CaptureSpan()
  @CaptureSpan()
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
}
