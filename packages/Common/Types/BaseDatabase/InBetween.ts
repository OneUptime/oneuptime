import OneUptimeDate from "../Date";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

export interface InBetweenOptions {
  /*
   * Whether the range holds its end: true, the default, for a range a
   * person filters by; false for the window a telemetry check judges
   * (TelemetryCheckWindow), which holds its start and not its end.
   */
  includesEnd?: boolean | undefined;
}

export default class InBetween<
  T extends number | Date | string,
> extends QueryOperator<T> {
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

  /*
   * Whether a value equal to the end is in the range. A range always holds
   * its start. One that holds its end too (`time >= start AND time <= end`)
   * is what a filter asks for. A telemetry check's window does not (`time >=
   * start AND time < end`): a monitor's windows follow on, each starting
   * where the one before ended, so a record stamped on that instant is in
   * exactly one of them - the later one (issue #11334). Every reader of a
   * range writes this end as it says: the analytics and Postgres query
   * builders (StatementGenerator, QueryHelper) and the reads that write
   * their own SQL from a range's bounds.
   */
  private _includesEnd: boolean = true;
  public get includesEnd(): boolean {
    return this._includesEnd;
  }

  public constructor(startValue: T, endValue: T, options?: InBetweenOptions) {
    super();
    this.startValue = startValue;
    this.endValue = endValue;
    this._includesEnd = options?.includesEnd !== false;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.InBetween,
      startValue: (this as InBetween<T>).startValue,
      endValue: (this as InBetween<T>).endValue,
      /*
       * Written only when the end is left out, so every range that holds
       * both ends - what every range was before - reads exactly as it did.
       */
      ...(this.includesEnd ? {} : { includesEnd: false }),
    };
  }

  public static override fromJSON<T extends number | Date | string>(
    json: JSONObject,
  ): InBetween<T> {
    if (json["_type"] === ObjectType.InBetween) {
      return new InBetween(json["startValue"] as T, json["endValue"] as T, {
        includesEnd: json["includesEnd"] !== false,
      });
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
