import OneUptimeDate from "../Date";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

export default class InBetween<T extends number | Date | string> extends QueryOperator<T> {
  private _startValue!: T;
  public get startValue(): T {
    return this._startValue;
  }
  public set startValue(v: T) {
    this._startValue = v;
  }

  private _endValue!: T;
  public get endValue(): T {
    return this._endValue;
  }
  public set endValue(v: T) {
    this._endValue = v;
  }

  public constructor(
    startValue: T,
    endValue: T,
  ) {
    super();
    this.startValue = startValue;
    this.endValue = endValue;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.InBetween,
      startValue: (this as InBetween<T>).startValue,
      endValue: (this as InBetween<T>).endValue,
    };
  }

  public static override fromJSON<T extends number | Date | string>(json: JSONObject): InBetween<T> {
    if (json["_type"] === ObjectType.InBetween) {
      return new InBetween(
        json["startValue"] as T,
        json["endValue"] as T,
      );
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public override toString(): string {
    let startValue: T = this.startValue;
    let endValue: T = this.endValue;

    if (startValue instanceof Date) {
      startValue = OneUptimeDate.asDateForDatabaseQuery(startValue) as T;
    }

    if (endValue instanceof Date) {
      endValue = OneUptimeDate.asDateForDatabaseQuery(endValue) as T;
    }

    if (startValue.toString() === endValue.toString()) {
      return this.startValue.toString();
    }

    return this.startValue.toString() + " - " + this.endValue.toString();
  }

  public toStartValueString(): string {
    return this.startValue.toString();
  }

  public toEndValueString(): string {
    return this.endValue.toString();
  }
}
