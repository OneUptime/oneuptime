import CompareBase, { CompareType } from "../Database/CompareBase";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";

export default class EqualToOrNull<T extends CompareType> extends CompareBase<T> {


  public constructor(value: T) {
    super(value);
    this.value = value;
  }

  public override toString(): string {
    return this.value.toString();
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.EqualToOrNull,
      value: (this as EqualToOrNull<T>).toString(),
    };
  }

  public static override fromJSON<T extends CompareType>(json: JSONObject): EqualToOrNull<T> {
    if (json["_type"] === ObjectType.EqualToOrNull) {
      return new EqualToOrNull(json["value"] as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
