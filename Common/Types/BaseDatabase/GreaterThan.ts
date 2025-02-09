import CompareBase, { CompareType } from "../Database/CompareBase";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";

export default class GreaterThan<T extends CompareType> extends CompareBase<T> {
  public constructor(value: T) {
    super(value);
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.GreaterThan,
      value: (this as GreaterThan<T>).toString(),
    };
  }

  public static override fromJSON<T extends CompareType>(
    json: JSONObject,
  ): GreaterThan<T> {
    if (json["_type"] === ObjectType.GreaterThan) {
      return new GreaterThan(json["value"] as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
