import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import IncludesNoneOrNull from "../../../Types/BaseDatabase/IncludesNoneOrNull";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqualOrNull from "../../../Types/BaseDatabase/NotEqualOrNull";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import { JSONObject, ObjectType } from "../../../Types/JSON";

/*
 * COLUMNS EVERY RECORD HAD, WHICH A REQUEST MAY STILL NAME (#10469).
 *
 * `deletedByUserId`, and the relation over it, `deletedByUser`, were on 563
 * models, and nothing ever wrote them: OneUptime deletes a record outright,
 * so no record ever had one (who deleted a record is in the audit log's
 * Delete entries). They went in 1809187480000-DropDeletedByUserColumns. An
 * API client, a workflow or an agent written before then may still name
 * them, and gets what it always got from a column nobody wrote:
 *
 *   - a create or an update that sends one: the value is dropped, as a value
 *     for a column only OneUptime writes was (UserAttribution), and a create
 *     still names it among the fields it left out (FieldsLeftOut);
 *   - a select of one: nothing is read for it, and the API answers it as
 *     null, as it did;
 *   - a sort by one: dropped. Every record held the same nothing, so the
 *     order is the one the rest of the sort gives;
 *   - a query on one: read as a column empty on every record. An empty value
 *     (null, IsNull), and an operator that lets an empty column through
 *     (EqualToOrNull, NotContains...), held for every record, so it is
 *     dropped; anything else - an id, EqualTo, NotEqual, Includes, NotNull -
 *     held for none, so the read finds nothing, the count is 0, and an update
 *     or a delete by it writes nothing. RetiredColumnsPostgres holds each
 *     operator to what Postgres answers for an empty column.
 *
 * The same holds of a query or a sort through a relation, which names the
 * related record's fields ({ statusPage: { deletedByUserId: null } }), one
 * level deep as the API reads one. A select through a relation was refused
 * then (no column of these was readable on a relation query), and still is.
 *
 * Before any of this, a model that declares a column of one of these names
 * is read as it declares it.
 */
export const RETIRED_COLUMNS: ReadonlyArray<string> = [
  "deletedByUserId",
  "deletedByUser",
];

/*
 * What a query may compare a column with that holds for an empty one: the
 * compiled SQL is `IS NULL`, or ends `OR <column> IS NULL` (QueryHelper).
 */
const HOLDS_FOR_EMPTY: ReadonlyArray<new (...args: Array<any>) => unknown> = [
  IsNull,
  EqualToOrNull,
  NotEqualOrNull,
  GreaterThanOrNull,
  LessThanOrNull,
  IncludesNoneOrNull,
  NotContains,
  NotWildcard,
];

// The same, as a request that was never deserialized writes them.
const HOLDS_FOR_EMPTY_TYPES: ReadonlyArray<string> = [
  ObjectType.IsNull,
  ObjectType.EqualToOrNull,
  ObjectType.NotEqualOrNull,
  ObjectType.GreaterThanOrNull,
  ObjectType.LessThanOrNull,
  ObjectType.IncludesNoneOrNull,
  ObjectType.NotContains,
  ObjectType.NotWildcard,
];

/*
 * The parts of a model this reads: whether it has a column, and the model a
 * relation of it points at, for a query or a sort through the relation.
 */
export interface ModelWithColumns {
  hasColumn(columnName: string): boolean;
  getTableColumnMetadata?(columnName: string):
    | { modelType?: (new () => ModelWithColumns) | undefined }
    | undefined;
}

// A query with the retired columns read: what is left to ask, and whether anything can match.
export interface RetiredColumnsQuery<TQuery> {
  query: TQuery;
  matchesNothing: boolean;
}

export default class RetiredColumns {
  // Whether `name` is a retired column on this model.
  public static isRetired(model: ModelWithColumns, name: string): boolean {
    return RETIRED_COLUMNS.includes(name) && !model.hasColumn(name);
  }

  /*
   * The retired columns a select, a sort, a query or a write names, in the
   * order it names them. None for anything that is not an object of fields.
   */
  public static getNamedIn(
    model: ModelWithColumns,
    value: unknown,
  ): Array<string> {
    if (!RetiredColumns.isObjectOfFields(value)) {
      return [];
    }

    return Object.keys(value).filter((name: string): boolean => {
      return RetiredColumns.isRetired(model, name);
    });
  }

  /*
   * A select, a sort, a group by or a write without the retired columns: a
   * copy when it names one, the same object when it names none, so a
   * caller's own object is never changed.
   */
  public static takeOut<T>(model: ModelWithColumns, value: T): T {
    const named: Array<string> = RetiredColumns.getNamedIn(model, value);

    if (named.length === 0) {
      return value;
    }

    const copy: Record<string, unknown> = {
      ...(value as unknown as Record<string, unknown>),
    };

    for (const name of named) {
      delete copy[name];
    }

    return copy as unknown as T;
  }

  /*
   * A sort without the retired columns, its own and those of a record a
   * relation names ({ statusPage: { deletedByUserId: "ASC" } }): each held
   * the same nothing on every record, so the order is the one the rest of
   * the sort gives. A relation left with no field to sort by is no sort.
   */
  public static takeOutOfSort<T>(model: ModelWithColumns, sort: T): T {
    let result: T = RetiredColumns.takeOut(model, sort);

    for (const [key, related] of RetiredColumns.getRelationsNamingThem(
      model,
      result,
    )) {
      const inner: unknown = RetiredColumns.takeOut(
        related,
        (result as unknown as Record<string, unknown>)[key],
      );

      result = RetiredColumns.withField(result, key, inner);
    }

    return result;
  }

  /*
   * A query with each retired column read as empty on every record: a
   * condition that holds for an empty column is dropped, and one that does
   * not means the query matches nothing. So is one on a record a relation
   * names ({ statusPage: { deletedByUserId: "<id>" } }): the related record
   * is read as the query reads it, joined beside the record, where it was as
   * empty; a relation left with no field to match is no condition.
   */
  public static readQuery<TQuery>(
    model: ModelWithColumns,
    query: TQuery,
  ): RetiredColumnsQuery<TQuery> {
    const own: RetiredColumnsQuery<TQuery> = RetiredColumns.readOwnColumns(
      model,
      query,
    );

    let matchesNothing: boolean = own.matchesNothing;
    let result: TQuery = own.query;

    for (const [key, related] of RetiredColumns.getRelationsNamingThem(
      model,
      result,
    )) {
      const inner: RetiredColumnsQuery<unknown> = RetiredColumns.readOwnColumns(
        related,
        (result as unknown as Record<string, unknown>)[key],
      );

      matchesNothing = matchesNothing || inner.matchesNothing;
      result = RetiredColumns.withField(result, key, inner.query);
    }

    return { query: result, matchesNothing: matchesNothing };
  }

  // A query's conditions on the model's own retired columns, read as empty.
  private static readOwnColumns<TQuery>(
    model: ModelWithColumns,
    query: TQuery,
  ): RetiredColumnsQuery<TQuery> {
    const named: Array<string> = RetiredColumns.getNamedIn(model, query);

    return {
      query: RetiredColumns.takeOut(model, query),
      matchesNothing: named.some((name: string): boolean => {
        return !RetiredColumns.holdsForEmpty(
          (query as unknown as Record<string, unknown>)[name],
        );
      }),
    };
  }

  /*
   * The relations of a query or a sort that name a retired column of the
   * record they point at, each with that record's model: a field whose
   * value is a plain object of fields, of a relation of `model`. One level
   * deep, as the API reads a relation's fields.
   */
  private static getRelationsNamingThem(
    model: ModelWithColumns,
    value: unknown,
  ): Array<[string, ModelWithColumns]> {
    if (!RetiredColumns.isObjectOfFields(value) || !model.getTableColumnMetadata) {
      return [];
    }

    const relations: Array<[string, ModelWithColumns]> = [];

    for (const [key, inner] of Object.entries(value)) {
      if (!RetiredColumns.isPlainObject(inner)) {
        continue;
      }

      const relatedType: (new () => ModelWithColumns) | undefined =
        model.getTableColumnMetadata(key)?.modelType;

      if (!relatedType) {
        continue;
      }

      const related: ModelWithColumns = new relatedType();

      if (RetiredColumns.getNamedIn(related, inner).length > 0) {
        relations.push([key, related]);
      }
    }

    return relations;
  }

  /*
   * `value` with `key` set to `inner`, as a copy, and without `key` when
   * `inner` holds no field: a relation with nothing left to ask of it.
   */
  private static withField<T>(value: T, key: string, inner: unknown): T {
    const copy: Record<string, unknown> = {
      ...(value as unknown as Record<string, unknown>),
    };

    if (
      RetiredColumns.isObjectOfFields(inner) &&
      Object.keys(inner).length === 0
    ) {
      delete copy[key];
    } else {
      copy[key] = inner;
    }

    return copy as unknown as T;
  }

  // Whether a query's condition on a column holds where the column is empty.
  public static holdsForEmpty(condition: unknown): boolean {
    if (condition === null || condition === undefined) {
      return true;
    }

    if (
      HOLDS_FOR_EMPTY.some(
        (operator: new (...args: Array<any>) => unknown): boolean => {
          return condition instanceof operator;
        },
      )
    ) {
      return true;
    }

    // A relation's fields, an id, a list of them: none holds for no record.
    return (
      RetiredColumns.isObjectOfFields(condition) &&
      HOLDS_FOR_EMPTY_TYPES.includes(
        String((condition as JSONObject)["_type"] || ""),
      )
    );
  }

  /*
   * An answer's records, each with the retired columns its select named set
   * to null, as the API answered them while the columns were there.
   */
  public static answerAsNull<T extends JSONObject | Array<JSONObject>>(
    answer: T,
    names: ReadonlyArray<string>,
  ): T {
    if (names.length === 0) {
      return answer;
    }

    const records: Array<JSONObject> = Array.isArray(answer)
      ? answer
      : [answer as JSONObject];

    for (const record of records) {
      if (!RetiredColumns.isObjectOfFields(record)) {
        continue;
      }

      for (const name of names) {
        record[name] = null;
      }
    }

    return answer;
  }

  private static isObjectOfFields(value: unknown): value is object {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // An object of fields that is no operator, id or date: a relation's fields.
  private static isPlainObject(value: unknown): value is object {
    if (!RetiredColumns.isObjectOfFields(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }
}
