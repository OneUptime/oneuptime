import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

export default class NotContains<T extends string> extends QueryOperator<T> {
  private _value!: T;

  public get value(): T {
    return this._value;
  }

  public set value(v: T) {
    this._value = v;
  }

  public constructor(value: T) {
    super();
    this.value = value;
  }

  public override toString(): T {
    return this.value;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.NotContains,
      value: (this as NotContains<T>).toString(),
    };
  }

  public static override fromJSON<T extends string>(
    json: JSONObject,
  ): NotContains<T> {
    if (json["_type"] === ObjectType.NotContains) {
      return new NotContains<T>((json["value"] as T) || ("" as T));
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
