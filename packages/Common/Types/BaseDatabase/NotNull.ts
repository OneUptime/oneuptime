import BadDataException from "../Exception/BadDataException";
import GenericObject from "../GenericObject";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";

export default class NotNull extends QueryOperator<GenericObject> {
  public constructor() {
    super();
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.NotNull,
      value: null,
    };
  }

  public static override fromJSON(json: JSONObject): NotNull {
    if (json["_type"] === ObjectType.NotNull) {
      return new NotNull();
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public override toString(): string {
    return "";
  }
}
