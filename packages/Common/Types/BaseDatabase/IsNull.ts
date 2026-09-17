import BadDataException from "../Exception/BadDataException";
import GenericObject from "../GenericObject";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

export default class IsNull extends QueryOperator<GenericObject> {
  public constructor() {
    super();
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.IsNull,
      value: null,
    };
  }

  public static override fromJSON(json: JSONObject): IsNull {
    if (json["_type"] === ObjectType.IsNull) {
      return new IsNull();
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public override toString(): string {
    return "";
  }
}
