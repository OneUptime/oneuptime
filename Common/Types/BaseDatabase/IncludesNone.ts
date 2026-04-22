import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import QueryOperator from "./QueryOperator";

export type IncludesNoneType =
  | Array<string>
  | Array<ObjectID>
  | Array<number>;

export default class IncludesNone extends QueryOperator<IncludesNoneType> {
  private _values: IncludesNoneType = [];

  public get values(): IncludesNoneType {
    return this._values;
  }

  public set values(v: IncludesNoneType) {
    this._values = v;
  }

  public constructor(values: IncludesNoneType) {
    super();
    this.values = values;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.IncludesNone,
      value: (this as IncludesNone)._values,
    };
  }

  public static override fromJSON(json: JSONObject): IncludesNone {
    if (json["_type"] === ObjectType.IncludesNone) {
      const valuesArray: Array<string> = [];

      for (const value of (json["value"] as Array<string>) || []) {
        valuesArray.push(JSONFunctions.deserializeValue(value) as string);
      }

      return new IncludesNone(valuesArray);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
