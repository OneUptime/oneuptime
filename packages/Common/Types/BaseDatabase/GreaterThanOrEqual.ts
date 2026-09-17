import CompareBase, { CompareType } from "../Database/CompareBase";
import OneUptimeDate from "../Date";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";

export default class GreaterThanOrEqual<
  T extends CompareType,
> extends CompareBase<T> {
  public constructor(value: T) {
    super(value);
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.GreaterThanOrEqual,
      /*
       * The RAW value is serialized (like InBetween), not toString():
       * toString() collapses a Date to a local-timezone date-only string
       * (asDateForDatabaseQuery), shifting Date bounds sent from the browser
       * by up to a day. JSON.stringify emits a raw Date as its full ISO
       * timestamp, which the server binds at full precision.
       */
      value: (this as GreaterThanOrEqual<T>).value,
    };
  }

  public override toString(): string {
    let value: T = this.value;

    if (value instanceof Date) {
      value = OneUptimeDate.asDateForDatabaseQuery(value) as T;
    }

    return value.toString();
  }

  public static override fromJSON<T extends CompareType>(
    json: JSONObject,
  ): GreaterThanOrEqual<T> {
    if (json["_type"] === ObjectType.GreaterThanOrEqual) {
      return new GreaterThanOrEqual<T>(json["value"] as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
