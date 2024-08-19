import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

export default class Search<T extends string> extends QueryOperator<T> {
  private _searchValue!: T;

  public get value(): T {
    return this._searchValue;
  }

  public set value(v: T) {
    this._searchValue = v;
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
      _type: ObjectType.Search,
      value: (this as Search<T>).toString(),
    };
  }

  public static override fromJSON<T extends string>(json: JSONObject): Search<T> {
    if (json["_type"] === ObjectType.Search) {
      return new Search<T>((json["value"] as T) || "" as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
