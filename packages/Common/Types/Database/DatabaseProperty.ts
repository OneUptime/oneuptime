import { ZodSchema } from "zod";
import NotImplementedException from "../Exception/NotImplementedException";
import { JSONArray, JSONObject } from "../JSON";
import SerializableObject from "../SerializableObject";
import { FindOperator } from "typeorm";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

export default class DatabaseProperty extends SerializableObject {
  public constructor() {
    super();
  }

  protected static fromDatabase(
    _value: string | number | JSONObject | JSONArray,
  ): DatabaseProperty | Array<DatabaseProperty> | null {
    throw new NotImplementedException();
  }

  protected static toDatabase(
    _value:
      | DatabaseProperty
      | Array<DatabaseProperty>
      | FindOperator<DatabaseProperty>,
  ): string | number | JSONObject | JSONArray | null {
    throw new NotImplementedException();
  }

  protected static _fromDatabase(
    value: string | number | JSONObject | JSONArray,
  ): DatabaseProperty | Array<DatabaseProperty> | null {
    return this.fromDatabase(value);
  }

  protected static _toDatabase(
    value: DatabaseProperty | FindOperator<DatabaseProperty>,
  ): string | number | JSONObject | JSONArray | null {
    // if its a RAW query. Return a raw query.
    if (value && (value as any)._type === "raw") {
      return value as any;
    }

    /*
     * A FindOperator reaches a transformer when the query value is an
     * operator rather than a plain value. Two ways in:
     *
     *   - Nested. `And(Equal(id), Raw(privacyClause))` — the shape every
     *     privacy/scope filter builds (Server/Utils/PrivacyFilterUtil.ts).
     *     TypeORM calls `operator.transformValue(column.transformer)`
     *     (SelectQueryBuilder.buildWhere), and FindOperator.transformValue
     *     hands each CHILD OPERATOR to this function whenever the operator
     *     carries multiple parameters — which And() and Or() both do.
     *   - Top level. ColumnMetadata.getEntityValue applies the transformer to
     *     the whole criteria of a .where()/.update()/.delete() call.
     *
     * Every toDatabase() below expects a value, so an operator makes it
     * produce garbage: "[object Object]" from the string-ish types (ObjectID
     * included — a uuid column then fails with Postgres 22P02 invalid input
     * syntax for type uuid), `null` from Port, a serialized operator from the
     * JSON types. The child is REPLACED by that garbage, so the caller's own
     * predicate is lost and the privacy clause it was ANDed with can no
     * longer match anything.
     *
     * Transform the operator's leaf value(s) in place and hand the operator
     * back, so `And`/`Or`/`In`/`Not`/`Between` keep their structure and only
     * the leaves are converted. Recursion terminates because transformValue
     * always descends into the operator's value, and a leaf is never a
     * FindOperator.
     *
     * NOTE: transformValue mutates. One query object can legitimately be
     * transformed more than once — BaseAPI.getList shares it between findBy
     * and countBy — so every toDatabase() has to be a fixpoint: handed its
     * own output it must return that output unchanged. Tests/Types/Database/
     * DatabasePropertyFindOperator.test.ts enforces that for each type.
     */
    if (value instanceof FindOperator) {
      value.transformValue(this.getDatabaseTransformer());
      return value as any;
    }

    return this.toDatabase(value);
  }

  public static getDatabaseTransformer(): ValueTransformer {
    return {
      to: (value: any) => {
        /*
         * `undefined` means "the caller did not set this column", and it has
         * to stay distinguishable from `null` all the way into TypeORM.
         *
         * TypeORM runs the transformer BEFORE deciding whether the column
         * was supplied:
         *
         *   InsertQueryBuilder.createColumnValueExpression
         *     -> driver.preparePersistentValue   (runs this function)
         *     -> if (value === undefined) expression += "DEFAULT"
         *
         * so answering `null` here (which every `toDatabase` does for a
         * falsy value) rewrites an omitted column into an explicit NULL and
         * makes the column's DEFAULT unreachable. On a NOT NULL column with
         * a default — an on-call layer's `rotation`, a drop filter's
         * `droppedCount` — that is a not-null constraint violation, i.e. an
         * HTTP 500, on every create that leaves the column alone.
         *
         * UPDATE is unaffected either way: UpdateQueryBuilder strips
         * undefined properties before the transformer ever sees them
         * ("it doesn't make sense to update undefined properties").
         */
        if (value === undefined) {
          return undefined;
        }

        return this._toDatabase(value);
      },
      from: (value: any) => {
        return this._fromDatabase(value);
      },
    };
  }

  public static getSchema(): ZodSchema {
    throw new NotImplementedException();
  }
}
