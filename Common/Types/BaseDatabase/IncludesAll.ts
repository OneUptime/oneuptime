import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import QueryOperator from "./QueryOperator";

export type IncludesAllType = Array<string> | Array<ObjectID> | Array<number>;

export default class IncludesAll extends QueryOperator<IncludesAllType> {
  private _values: IncludesAllType = [];

  public get values(): IncludesAllType {
    return this._values;
  }

  public set values(v: IncludesAllType) {
    this._values = v;
  }

  public constructor(values: IncludesAllType) {
    super();
    this.values = values;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.IncludesAll,
      value: (this as IncludesAll)._values,
    };
  }

  public static override fromJSON(json: JSONObject): IncludesAll {
    if (json["_type"] === ObjectType.IncludesAll) {
      const valuesArray: Array<string> = [];

      for (const value of (json["value"] as Array<string>) || []) {
        valuesArray.push(JSONFunctions.deserializeValue(value) as string);
      }

      return new IncludesAll(valuesArray);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
