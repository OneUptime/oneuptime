import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import ObjectID from "../ObjectID";
import QueryOperator from "./QueryOperator";

export type IncludesNoneOrNullType =
  | Array<string>
  | Array<ObjectID>
  | Array<number>;

/*
 * A COLUMN THAT IS NONE OF THESE VALUES, EMPTY INCLUDED (#10581).
 *
 * IncludesNone is SQL's `NOT IN (...)`, and `NULL NOT IN (...)` is not true,
 * so IncludesNone leaves out every row whose column is empty. On a list's
 * "is not" filter that reads wrong: "Template is not WB KSK Ping Monitor
 * Template" listed the monitors linked to other templates and dropped every
 * monitor linked to no template, though those are not linked to it either.
 * A negative filter on a column that may be empty keeps the empty rows, as
 * "does not contain" (QueryHelper.notContains) and the Owner chip's "is not"
 * always have; "is not empty" stays there for anyone who wants only the rows
 * that have a value.
 *
 * The database reads it as `(column NOT IN (...) OR column IS NULL)`
 * (QueryUtil.serializeQuery, QueryHelper.notInOrNull). The multi-value
 * mirror of NotEqualOrNull, and a class of its own rather than a kind of
 * IncludesNone: a check written for IncludesNone that rebuilt it as one
 * would quietly drop the empty rows again.
 */
export default class IncludesNoneOrNull extends QueryOperator<IncludesNoneOrNullType> {
  private _values: IncludesNoneOrNullType = [];

  public get values(): IncludesNoneOrNullType {
    return this._values;
  }

  public set values(v: IncludesNoneOrNullType) {
    this._values = v;
  }

  public constructor(values: IncludesNoneOrNullType) {
    super();
    this.values = values;
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.IncludesNoneOrNull,
      value: (this as IncludesNoneOrNull)._values,
    };
  }

  public static override fromJSON(json: JSONObject): IncludesNoneOrNull {
    if (json["_type"] === ObjectType.IncludesNoneOrNull) {
      const valuesArray: Array<string> = [];

      for (const value of (json["value"] as Array<string>) || []) {
        valuesArray.push(JSONFunctions.deserializeValue(value) as string);
      }

      return new IncludesNoneOrNull(valuesArray);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
