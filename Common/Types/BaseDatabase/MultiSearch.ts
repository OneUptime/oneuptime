import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

export default class MultiSearch extends QueryOperator<string> {
  private _fields: Array<string> = [];
  private _value: string = "";

  public get fields(): Array<string> {
    return this._fields;
  }

  public set fields(v: Array<string>) {
    this._fields = v;
  }

  public get value(): string {
    return this._value;
  }

  public set value(v: string) {
    this._value = v;
  }

  public constructor(data: { fields: Array<string>; value: string }) {
    super();
    this.fields = data.fields;
    this.value = data.value;
  }

  public override toString(): string {
    return this.value;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.MultiSearch,
      value: this.value,
      fields: this.fields,
    };
  }

  public static override fromJSON(json: JSONObject): MultiSearch {
    if (json["_type"] === ObjectType.MultiSearch) {
      return new MultiSearch({
        fields: (json["fields"] as Array<string>) || [],
        value: (json["value"] as string) || "",
      });
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
