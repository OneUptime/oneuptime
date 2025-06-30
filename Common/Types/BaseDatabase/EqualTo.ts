import CompareBase, { CompareType } from "../Database/CompareBase";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";

export default class EqualTo<T extends CompareType> extends CompareBase<T> {
  public constructor(value: T) {
    super(value);
    this.value = value;
  }

  public override toString(): string {
    return this.value.toString();
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.EqualTo,
      value: (this as EqualTo<T>).toString(),
    };
  }

  public static override fromJSON<T extends CompareType>(
    json: JSONObject,
  ): EqualTo<T> {
    if (json["_type"] === ObjectType.EqualTo) {
      return new EqualTo(json["value"] as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
