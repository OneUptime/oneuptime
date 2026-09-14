import BaseModel from "../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseProperty from "./Database/DatabaseProperty";
import OneUptimeDate from "./Date";
import DiskSize from "./DiskSize";
import GenericObject from "./GenericObject";
import { JSONArray, JSONObject, JSONValue, ObjectType } from "./JSON";
import SerializableObject from "./SerializableObject";
import SerializableObjectDictionary from "./SerializableObjectDictionary";
import Typeof from "./Typeof";
import JSON5 from "json5";

export default class JSONFunctions {
  private static readonly unsafeObjectPathSegments: ReadonlySet<string> =
    new Set(["__proto__", "prototype", "constructor"]);

  private static createSafeJSONObject(): JSONObject {
    return Object.create(null) as JSONObject;
  }

  private static isObjectValue(
    value: unknown,
  ): value is Record<string, unknown> {
    return value !== null && typeof value === Typeof.Object;
  }

  /**
   * A reserved name is safe as a terminal primitive on a null-prototype
   * dictionary. It is unsafe when it would be traversed, or when an object at
   * that name could later become a bridge to one of its properties.
   */
  private static containsUnsafeObjectPathSegment(
    pathSegments: Array<string>,
    terminalValue: JSONValue,
  ): boolean {
    return pathSegments.some((segment: string, index: number): boolean => {
      if (!JSONFunctions.unsafeObjectPathSegments.has(segment)) {
        return false;
      }

      return (
        index < pathSegments.length - 1 ||
        JSONFunctions.isObjectValue(terminalValue)
      );
    });
  }

  /**
   * Copy untrusted JSON values before placing them in a generated tree. This
   * strips inherited state, never invokes accessors, and ensures later path
   * construction can only descend through containers created here.
   *
   * Reserved primitive property names remain useful telemetry data and are
   * safe on the null-prototype dictionaries we create. Object-valued reserved
   * properties are omitted because they could act as traversal bridges if the
   * result is later consumed by less defensive code.
   */
  private static copyToSafeJSONValue(
    value: JSONValue,
    safeContainers: WeakSet<Record<string, unknown>>,
    copiedValues: WeakMap<Record<string, unknown>, JSONValue> = new WeakMap<
      Record<string, unknown>,
      JSONValue
    >(),
  ): JSONValue {
    if (!JSONFunctions.isObjectValue(value)) {
      return value;
    }

    const alreadyCopied: JSONValue | undefined = copiedValues.get(value);
    if (alreadyCopied !== undefined) {
      return alreadyCopied;
    }

    if (Array.isArray(value)) {
      const copiedArray: Array<JSONValue> = new Array<JSONValue>(value.length);
      safeContainers.add(copiedArray as unknown as Record<string, unknown>);
      copiedValues.set(
        value as unknown as Record<string, unknown>,
        copiedArray,
      );

      for (let index: number = 0; index < value.length; index++) {
        const itemDescriptor: PropertyDescriptor | undefined =
          Object.getOwnPropertyDescriptor(value, index.toString());

        if (!itemDescriptor || !("value" in itemDescriptor)) {
          continue;
        }

        copiedArray[index] = JSONFunctions.copyToSafeJSONValue(
          itemDescriptor.value as JSONValue,
          safeContainers,
          copiedValues,
        );
      }

      return copiedArray;
    }

    const copiedObject: JSONObject = JSONFunctions.createSafeJSONObject();
    safeContainers.add(copiedObject);
    copiedValues.set(value, copiedObject);

    for (const key of Object.keys(value)) {
      const propertyDescriptor: PropertyDescriptor | undefined =
        Object.getOwnPropertyDescriptor(value, key);

      /*
       * JSON data properties are all that can be copied without executing
       * caller-controlled code.
       */
      if (!propertyDescriptor || !("value" in propertyDescriptor)) {
        continue;
      }

      const propertyValue: JSONValue = propertyDescriptor.value as JSONValue;
      if (
        JSONFunctions.unsafeObjectPathSegments.has(key) &&
        JSONFunctions.isObjectValue(propertyValue)
      ) {
        continue;
      }

      copiedObject[key] = JSONFunctions.copyToSafeJSONValue(
        propertyValue,
        safeContainers,
        copiedValues,
      );
    }

    return copiedObject;
  }

  public static getSizeOfJSONinGB(obj: JSONObject): number {
    const sizeInBytes: number = Buffer.byteLength(JSON.stringify(obj));
    const sizeToGb: number = DiskSize.byteSizeToGB(sizeInBytes);
    return sizeToGb;
  }

  public static isJSONObjectDifferent(
    obj1: GenericObject,
    obj2: GenericObject,
  ): boolean {
    return !JSONFunctions.deepEqual(obj1, obj2);
  }

  /*
   * Structural deep-equal that short-circuits at the first mismatch. The
   * dashboard widget hot path was previously running JSON.stringify on
   * both sides of nested metricQueryConfig objects every render, which
   * dominated CPU when many widgets were on screen. This visits the
   * tree once and bails on the first divergence.
   */
  public static deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }

    if (
      a === null ||
      b === null ||
      typeof a !== "object" ||
      typeof b !== "object"
    ) {
      return false;
    }

    if (a instanceof Date || b instanceof Date) {
      return (
        a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
      );
    }

    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
      }
      for (let i: number = 0; i < a.length; i++) {
        if (!JSONFunctions.deepEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }

    const keysA: Array<string> = Object.keys(a as Record<string, unknown>);
    const keysB: Array<string> = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) {
      return false;
    }
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) {
        return false;
      }
      if (
        !JSONFunctions.deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      ) {
        return false;
      }
    }
    return true;
  }

  public static nestJson(obj: JSONObject): JSONObject {
    // obj could be in this format:

    /**
     * {
     *"http.url.protocol": "http",
     *"http.url.hostname": "localhost",
     *"http.host": "localhost",
     */

    // we want to convert it to this format:

    /**
     * {
     *
     * "http": {
     *     "url": {
     *        "protocol": "http",
     *       "hostname": "localhost"
     *   },
     *    "host": "localhost",
     *   "method": "POST",
     *  "scheme": "http",
     * "client_ip": "
     * ...
     *
     * },
     */

    const result: JSONObject = JSONFunctions.createSafeJSONObject();
    const safeContainers: WeakSet<Record<string, unknown>> = new WeakSet<
      Record<string, unknown>
    >();
    safeContainers.add(result);

    for (const key of Object.keys(obj)) {
      const valueDescriptor: PropertyDescriptor | undefined =
        Object.getOwnPropertyDescriptor(obj, key);

      if (!valueDescriptor || !("value" in valueDescriptor)) {
        continue;
      }

      const value: JSONValue = valueDescriptor.value as JSONValue;
      const keys: Array<string> = key.split(".").filter(Boolean);

      if (
        keys.length === 0 ||
        JSONFunctions.containsUnsafeObjectPathSegment(keys, value)
      ) {
        continue;
      }

      let currentObj: JSONObject = result;

      for (let i: number = 0; i < keys.length; i++) {
        const k: string = keys[i]!;

        if (i === keys.length - 1) {
          currentObj[k] = JSONFunctions.copyToSafeJSONValue(
            value,
            safeContainers,
          );
        } else {
          const currentValue: JSONValue = currentObj[k];

          if (
            !currentValue ||
            !JSONFunctions.isObjectValue(currentValue) ||
            Array.isArray(currentValue) ||
            !safeContainers.has(currentValue as Record<string, unknown>)
          ) {
            currentObj[k] = JSONFunctions.createSafeJSONObject();
            safeContainers.add(currentObj[k] as JSONObject);
          }

          currentObj = currentObj[k] as JSONObject;
        }
      }
    }

    return result;
  }

  public static isEmptyObject(
    obj: JSONObject | BaseModel | null | undefined,
  ): boolean {
    if (!obj) {
      return true;
    }

    return Object.keys(obj).length === 0;
  }

  public static removeCircularReferences(obj: JSONObject): JSONObject {
    const cache: any[] = [];
    const returnValue: string = JSON.stringify(
      obj,
      (_key: string, value: any) => {
        if (typeof value === "object" && value !== null) {
          if (cache.includes(value)) {
            return;
          }

          cache.push(value);
        }

        return value;
      },
    );

    return JSON.parse(returnValue);
  }

  public static isEqualObject(
    obj1: JSONObject | undefined,
    obj2: JSONObject | undefined,
  ): boolean {
    // check if all the keys are the same

    if (!obj1 && !obj2) {
      return true;
    }

    if (!obj1 || !obj2) {
      return false;
    }

    const keys1: Array<string> = Object.keys(obj1);
    const keys2: Array<string> = Object.keys(obj2);

    if (keys1.length !== keys2.length) {
      return false;
    }

    for (const key of keys1) {
      if (!keys2.includes(key)) {
        return false;
      }
    }

    // check if all the values are the same

    for (const key of keys1) {
      if (obj1[key] !== obj2[key]) {
        return false;
      }
    }

    return true;
  }

  public static toCompressedString(val: JSONValue): string {
    return JSON.stringify(val, null, 2);
  }

  public static toString(val: JSONValue): string {
    if (typeof val === Typeof.String) {
      return val as string;
    }

    return JSON.stringify(val);
  }

  public static getJSONValueInPath(
    obj: JSONObject,
    path: string,
  ): JSONValue | null {
    const paths: Array<string> = path.split(".");
    let returnValue: JSONObject = obj as JSONObject;
    for (const p of paths) {
      if (!p) {
        continue;
      }

      if (returnValue && returnValue[p as string]!) {
        returnValue = returnValue[p] as JSONObject;
      } else {
        return null;
      }
    }

    return returnValue as JSONValue;
  }

  // this function serializes JSON with Common Objects to JSON that can be stringified.
  public static serialize(val: JSONObject): JSONObject {
    const newVal: JSONObject = {};

    for (const key in val) {
      if (val[key] === undefined) {
        continue;
      }

      if (val[key] === null) {
        newVal[key] = val[key];
      }

      if (Array.isArray(val[key])) {
        const arraySerialize: Array<JSONValue> = [];
        for (const arrVal of val[key] as Array<JSONValue>) {
          arraySerialize.push(this.serializeValue(arrVal));
        }

        newVal[key] = arraySerialize;
      } else {
        newVal[key] = this.serializeValue(val[key] as JSONValue);
      }
    }

    return newVal;
  }

  public static serializeValue(val: JSONValue): JSONValue {
    if (val === null || val === undefined) {
      return val;
    } else if (typeof val === Typeof.String && val.toString().trim() === "") {
      return val;
    } else if (val instanceof BaseModel) {
      return BaseModel.toJSON(val, BaseModel);
    } else if (typeof val === Typeof.Number) {
      return val;
    } else if (ArrayBuffer.isView(val)) {
      return {
        _type: ObjectType.Buffer,
        value: val as Uint8Array,
      };
    } else if (val && val instanceof SerializableObject) {
      return val.toJSON();
    } else if (val && val instanceof Date) {
      return {
        _type: ObjectType.DateTime,
        value: OneUptimeDate.toString(val as Date).toString(),
      };
    } else if (
      typeof val === Typeof.Object &&
      (val as JSONObject)["_type"] &&
      Object.keys(ObjectType).includes((val as JSONObject)["_type"] as string)
    ) {
      return val;
    } else if (Array.isArray(val)) {
      /*
       * This has to be checked before the plain-object branch below: arrays are
       * typeof "object", so falling through to serialize() would walk them by
       * key and hand back { "0": ..., "1": ... } instead of an array. That
       * silently corrupts every nested array persisted into a JSON column —
       * e.g. the [facetKey, value] filter tuples of a telemetry saved view.
       */
      const arr: Array<JSONValue> = [];

      for (const v of val) {
        arr.push(this.serializeValue(v));
      }

      return arr;
    } else if (typeof val === Typeof.Object) {
      return this.serialize(val as JSONObject);
    }

    return val;
  }

  public static deserializeValue(val: JSONValue): JSONValue {
    if (val === null || val === undefined) {
      return val;
    } else if (typeof val === Typeof.String && val.toString().trim() === "") {
      return val;
    } else if (
      val &&
      typeof val === Typeof.Object &&
      (val as JSONObject)["_type"] &&
      (val as JSONObject)["value"] &&
      ((val as JSONObject)["value"] as JSONObject)["data"] &&
      ((val as JSONObject)["value"] as JSONObject)["type"] &&
      ((val as JSONObject)["value"] as JSONObject)["type"] ===
        ObjectType.Buffer &&
      ((val as JSONObject)["_type"] as string) === ObjectType.Buffer
    ) {
      return Buffer.from(
        ((val as JSONObject)["value"] as JSONObject)["data"] as Uint8Array,
      );
    } else if (val && ArrayBuffer.isView(val)) {
      return Buffer.from(val as Uint8Array);
    } else if (typeof val === Typeof.Number) {
      return val;
    } else if (val instanceof DatabaseProperty) {
      return val;
    } else if (val instanceof SerializableObject) {
      return val;
    } else if (
      val &&
      typeof val === Typeof.Object &&
      (val as JSONObject)["_type"] &&
      SerializableObjectDictionary[(val as JSONObject)["_type"] as string]
    ) {
      return SerializableObjectDictionary[
        (val as JSONObject)["_type"] as string
      ].fromJSON(val);
    } else if (val instanceof Date) {
      return val;
    } else if (Array.isArray(val)) {
      /*
       * This has to be checked before the plain-object branch below: arrays are
       * typeof "object", so falling through to deserialize() would walk them by
       * key and hand back { "0": ..., "1": ... } instead of an array.
       */
      const arr: Array<JSONValue> = [];

      for (const v of val) {
        arr.push(this.deserializeValue(v));
      }

      return arr;
    } else if (typeof val === Typeof.Object) {
      return this.deserialize(val as JSONObject);
    }

    return val;
  }

  public static deserializeArray(array: JSONArray): JSONArray {
    const returnArr: JSONArray = [];

    for (const obj of array) {
      returnArr.push(this.deserialize(obj));
    }

    return returnArr;
  }

  public static serializeArray(array: JSONArray): JSONArray {
    const returnArr: JSONArray = [];

    for (const obj of array) {
      returnArr.push(this.serialize(obj));
    }

    return returnArr;
  }

  public static parse(val: string): JSONObject | JSONArray {
    return JSON5.parse(val);
  }

  /*
   * Guarding only against an array leaves every OTHER non-object through:
   * `42`, `"text"`, `true` and `null` are all valid JSON that JSON5.parse
   * returns happily, and none of them is an array, so each used to be handed
   * back typed as a JSONObject. Nothing downstream re-checks - the Text to
   * JSON workflow component reported a bare number as a SUCCESSFUL parse and
   * put it on its `json` port, and JSONWebToken.decodeJsonPayload read
   * properties off a string payload and got undefined for every one of them.
   * A parse that cannot produce an object should say so where it happens.
   */
  public static parseJSONObject(val: string): JSONObject {
    const result: JSONObject | JSONArray = this.parse(val);

    if (Array.isArray(result)) {
      throw new Error("Expected JSONObject, but got JSONArray");
    }

    if (result === null || typeof result !== "object") {
      throw new Error(
        `Expected JSONObject, but got ${result === null ? "null" : typeof result}`,
      );
    }

    return result;
  }

  public static parseJSONArray(val: string): JSONArray {
    const result: JSONObject | JSONArray = this.parse(val);

    if (!Array.isArray(result)) {
      throw new Error("Expected JSONArray, but got JSONObject");
    }

    return result;
  }

  public static deserialize(val: JSONObject): JSONObject {
    const newVal: JSONObject = {};
    for (const key in val) {
      if (val[key] === null || val[key] === undefined) {
        newVal[key] = val[key];
      }

      if (Array.isArray(val[key])) {
        const arraySerialize: Array<JSONValue> = [];
        for (const arrVal of val[key] as Array<JSONValue>) {
          arraySerialize.push(this.deserializeValue(arrVal));
        }

        newVal[key] = arraySerialize;
      } else {
        newVal[key] = this.deserializeValue(val[key] as JSONValue);
      }
    }

    return newVal;
  }

  public static toFormattedString(val: JSONValue): string {
    return JSON.stringify(val, null, 4);
  }

  public static anyObjectToJSONObject(val: any): JSONObject {
    return JSON.parse(JSON.stringify(val));
  }

  public static unflattenArray(val: JSONArray): JSONArray {
    const returnArr: JSONArray = [];

    for (const obj of val) {
      returnArr.push(this.unflattenObject(obj as JSONObject));
    }

    return returnArr;
  }

  public static unflattenObject(val: JSONObject): JSONObject {
    return JSONFunctions.nestJson(val);
  }

  public static flattenObject(val: JSONObject): JSONObject {
    const returnObj: JSONObject = JSONFunctions.createSafeJSONObject();
    const safeContainers: WeakSet<Record<string, unknown>> = new WeakSet<
      Record<string, unknown>
    >();
    const copiedValue: JSONValue = JSONFunctions.copyToSafeJSONValue(
      val,
      safeContainers,
    );

    if (!JSONFunctions.isObjectValue(copiedValue)) {
      return returnObj;
    }

    type FlattenFunction = (obj: JSONObject, prefix: string) => void;

    const flatten: FlattenFunction = (
      obj: JSONObject,
      prefix: string,
    ): void => {
      for (const key of Object.keys(obj)) {
        const value: JSONValue = obj[key];
        const flattenedKey: string = `${prefix}${key}`;
        const pathSegments: Array<string> = flattenedKey
          .split(".")
          .filter(Boolean);

        if (
          pathSegments.length === 0 ||
          JSONFunctions.containsUnsafeObjectPathSegment(pathSegments, value)
        ) {
          continue;
        }

        if (JSONFunctions.isObjectValue(value)) {
          flatten(value as JSONObject, `${prefix}${key}.`);
        } else {
          returnObj[flattenedKey] = value;
        }
      }
    };

    flatten(copiedValue as JSONObject, "");

    return returnObj;
  }

  public static flattenArray(val: JSONArray): JSONArray {
    const returnArr: JSONArray = [];

    for (const obj of val) {
      returnArr.push(this.flattenObject(obj as JSONObject));
    }

    return returnArr;
  }
}
