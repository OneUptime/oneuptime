import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import SerializableObject from "../SerializableObject";

export type IncludesType = Array<string> | Array<ObjectID>;

export default class Includes extends SerializableObject {
  private _values: IncludesType = [];

  public get values(): IncludesType {
    return this._values;
  }

  public set values(v: IncludesType) {
    this._values = v;
  }

  public constructor(values: IncludesType) {
    super();
    this.values = values;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Includes,
      value: (this as Includes)._values,
    };
  }

  public static override fromJSON(json: JSONObject): Includes {
    if (json["_type"] === ObjectType.Includes) {
      const valuesArray: Array<string> = [];

      for (const value of (json["value"] as Array<string>) || []) {
        valuesArray.push(JSONFunctions.deserializeValue(value) as string);
      }

      return new Includes(valuesArray);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
