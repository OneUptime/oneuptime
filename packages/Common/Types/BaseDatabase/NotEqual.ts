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
      /*
       * The RAW value is serialized (like GreaterThan / InBetween), not
       * toString(): toString() stringifies a Date into a locale- and
       * timezone-dependent form that loses milliseconds, and coerces a number
       * into a string. JSON.stringify emits a raw Date as its full ISO
       * timestamp, which the server binds at full precision — and which is
       * what lets an equality filter survive a round trip through the URL.
       */
      value: (this as NotEqual<T>).value,
    };
  }

  public static override fromJSON<T extends CompareType>(
    json: JSONObject,
  ): NotEqual<T> {
    if (json["_type"] === ObjectType.NotEqual) {
      return new NotEqual(json["value"] as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
