import CompareBase, { CompareType } from "../Database/CompareBase";
import OneUptimeDate from "../Date";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";

export default class LessThanOrEqual<
  T extends CompareType,
> extends CompareBase<T> {
  public constructor(value: T) {
    super(value);
  }

  /*
   * Serializes the RAW value (like InBetween does), not toString(): toString()
   * collapses a Date to a date-only string in the LOCAL timezone
   * (asDateForDatabaseQuery), so a bound of "now" would arrive at the server as
   * midnight of the browser's calendar date and silently exclude every row from
   * today. JSON.stringify turns a raw Date into its full ISO timestamp, which
   * the server binds at full precision.
   */
  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.LessThanOrEqual,
      value: (this as LessThanOrEqual<T>).value,
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
  ): LessThanOrEqual<T> {
    if (json["_type"] === ObjectType.LessThanOrEqual) {
      return new LessThanOrEqual<T>(json["value"] as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
