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
      /*
       * The RAW value is serialized (like GreaterThan / InBetween), not
       * toString(): toString() stringifies a Date into a locale- and
       * timezone-dependent form that loses milliseconds, and coerces a number
       * into a string. JSON.stringify emits a raw Date as its full ISO
       * timestamp, which the server binds at full precision — and which is
       * what lets an equality filter survive a round trip through the URL.
       */
      value: (this as EqualTo<T>).value,
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
