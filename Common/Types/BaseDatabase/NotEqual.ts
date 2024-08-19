import CompareBase, { CompareType } from "../Database/CompareBase";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";

export default class NotEqual<T extends CompareType> extends CompareBase<T> {


  public constructor(value: T) {
    super(value);
  }

  public override toString(): string {
    return this.value.toString();
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.NotEqual,
      value: (this as NotEqual<T>).toString(),
    };
  }

  public static override fromJSON<T extends CompareType>(json: JSONObject): NotEqual<T> {
    if (json["_type"] === ObjectType.NotEqual) {
      return new NotEqual(json["value"] as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
