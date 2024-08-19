import CompareBase, { CompareType } from "../Database/CompareBase";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";

export default class GreaterThanOrEqual<T extends CompareType> extends CompareBase<T> {
  public constructor(value: T) {
    super(value);
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.GreaterThanOrEqual,
      value: (this as GreaterThanOrEqual<T>).toString(),
    };
  }

  public static override fromJSON<T extends CompareType>(json: JSONObject): GreaterThanOrEqual<T> {
    if (json["_type"] === ObjectType.GreaterThanOrEqual) {
      return new GreaterThanOrEqual<T>(json["value"] as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
