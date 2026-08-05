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
