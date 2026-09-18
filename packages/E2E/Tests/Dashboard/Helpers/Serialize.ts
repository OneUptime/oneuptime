import OneUptimeDate from "Common/Types/Date";
import { JSONObject, JSONValue, ObjectType } from "Common/Types/JSON";
import SerializableObject from "Common/Types/SerializableObject";
import Typeof from "Common/Types/Typeof";

/*
 * A local stand-in for JSONFunctions.serialize, used only by the E2E specs.
 *
 * The specs cannot import JSONFunctions directly: it statically imports
 * DatabaseBaseModel (a TypeORM entity), and Playwright's own transpiler does
 * not emit the `emitDecoratorMetadata` that TypeORM's column decorators read,
 * so merely loading the spec throws
 *   "Cannot read properties of undefined (reading 'constructor')"
 * at DatabaseBaseModel's first decorated field, before any test runs.
 *
 * This mirrors JSONFunctions.serialize / serializeValue exactly for every value
 * kind an E2E request body actually carries — SerializableObject (ObjectID,
 * InBetween, ...), Date, arrays, already-wrapped `{_type,...}` objects, nested
 * plain objects and primitives — so the bytes on the wire are identical to the
 * product's. The only branch left out is BaseModel, which a test payload never
 * contains (and which is the sole reason JSONFunctions drags in the entity).
 */

export function serializeValue(val: JSONValue): JSONValue {
  if (val === null || val === undefined) {
    return val;
  } else if (typeof val === Typeof.String && val.toString().trim() === "") {
    return val;
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
    const arr: Array<JSONValue> = [];

    for (const v of val) {
      arr.push(serializeValue(v));
    }

    return arr;
  } else if (typeof val === Typeof.Object) {
    return serialize(val as JSONObject);
  }

  return val;
}

export function serialize(val: JSONObject): JSONObject {
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
        arraySerialize.push(serializeValue(arrVal));
      }

      newVal[key] = arraySerialize;
    } else {
      newVal[key] = serializeValue(val[key] as JSONValue);
    }
  }

  return newVal;
}
