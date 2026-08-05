import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * Round-trip for columns declared `ColumnType.BigPositiveNumber` (Postgres
 * bigint) that the rest of the codebase wants to read as a plain number.
 *
 * `to` MUST pass `undefined` through untouched. TypeORM runs the column
 * transformer *before* it decides whether the column was supplied at all:
 *
 *   InsertQueryBuilder.createColumnValueExpression
 *     -> driver.preparePersistentValue    (applies transformer.to)
 *     -> if (value === undefined) expression += "DEFAULT"
 *
 * so a transformer that folds `undefined` into `null` rewrites "the caller
 * did not set this column" into "the caller explicitly set it to NULL". The
 * column's DEFAULT is then never reached. On a `NOT NULL DEFAULT 0` counter
 * that is a 500 on *every* insert:
 *
 *   null value in column "droppedCount" of relation "LogDropFilter"
 *   violates not-null constraint
 *
 * which is exactly what shipped for the drop-filter drop counters. Nothing
 * in the product sets those counters on create — they are ingest-owned — so
 * every drop filter created through the dashboard failed.
 *
 * `from` exists because node-postgres hands bigint back as a string (it does
 * not fit a JS number in the general case). Every value we store here is a
 * record counter well inside Number.MAX_SAFE_INTEGER, and the UI renders it
 * as a number, so normalize once here rather than making each reader
 * remember.
 */
export function getBigIntDatabaseTransformer(): ValueTransformer {
  return {
    to: (value: number | null | undefined): string | null | undefined => {
      /*
       * Not a mistake and not the same as `null`: see the note above. This
       * is the branch that lets the column DEFAULT apply.
       */
      if (value === undefined) {
        return undefined;
      }

      if (value === null) {
        return null;
      }

      if (typeof value !== "number" || !Number.isFinite(value)) {
        /*
         * `Math.trunc(NaN).toString()` is the string "NaN", which Postgres
         * rejects with a syntax error that names neither the column nor the
         * caller. Null at least fails as a constraint violation on the
         * column it belongs to.
         */
        return null;
      }

      return Math.trunc(value).toString();
    },

    from: (value: string | number | null | undefined): number | null => {
      if (value === null || value === undefined) {
        return null;
      }

      if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
      }

      const parsed: number = parseInt(value, 10);

      return isNaN(parsed) ? null : parsed;
    },
  };
}
