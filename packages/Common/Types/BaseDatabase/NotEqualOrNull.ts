import CompareBase, { CompareType } from "../Database/CompareBase";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";

/*
 * A COLUMN THAT IS ANYTHING BUT THIS VALUE, EMPTY INCLUDED (#10399).
 *
 * NotEqual is SQL's `<>`, and `NULL <> x` is not true, so NotEqual leaves
 * out every row whose column is empty. That is right where the column always
 * holds a value, and wrong where an empty one is an answer of its own: "the
 * monitors not linked to this template" are the ones linked to another
 * template AND the ones linked to none. Without this operator a list could
 * only ask for one half, so Link Existing Monitors read every monitor of the
 * template's type into the browser - at most 10,000 - and dropped the linked
 * ones there; in a project with more, a monitor whose name sorted late was
 * never offered, and a search for it found nothing.
 *
 * The database reads it as `(column <> value OR column IS NULL)`, Postgres's
 * IS DISTINCT FROM, beside the rest of the query (QueryUtil.serializeQuery,
 * QueryHelper.notEqualsOrNull). The mirror of EqualToOrNull.
 */
export default class NotEqualOrNull<
  T extends CompareType,
> extends CompareBase<T> {
  public constructor(value: T) {
    super(value);
    this.value = value;
  }

  public override toString(): string {
    return this.value.toString();
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.NotEqualOrNull,
      /*
       * The RAW value, as NotEqual and EqualToOrNull send theirs: a Date
       * crosses the wire as its full ISO timestamp, never as toString()'s
       * text for people.
       */
      value: (this as NotEqualOrNull<T>).value,
    };
  }

  public static override fromJSON<T extends CompareType>(
    json: JSONObject,
  ): NotEqualOrNull<T> {
    if (json["_type"] === ObjectType.NotEqualOrNull) {
      return new NotEqualOrNull(json["value"] as T);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
