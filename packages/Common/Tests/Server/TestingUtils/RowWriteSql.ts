import { VISIBLE_UNLESS_PRIVATE_SQL } from "../../../Server/Utils/StatusPage/StatusPageVisibilityQuery";

/*
 * An in-memory stand-in for what Postgres stores when an update writes a
 * column as an SQL expression (DatabaseService.getRowWriteSql), for the
 * suites that run the services without a database.
 *
 * Only the expressions the services write are known here, worked out on the
 * row as it is before the write - as Postgres works out every value of one
 * UPDATE on the row it locked. Any other expression fails the test, so a
 * change to one is noticed here too. The expressions themselves run against
 * Postgres in StatusPageVisibilityWritePostgres.
 */

type Row = Record<string, unknown>;

// What Postgres stores for one row write expression, on the row as it is.
export function evaluateRowWriteSql(sql: string, row: Row): unknown {
  if (sql === VISIBLE_UNLESS_PRIVATE_SQL) {
    // ("isPrivate" IS NOT TRUE): null and false are not private.
    return row["isPrivate"] !== true;
  }

  throw new Error(`No in-memory stand-in for the row write SQL ${sql}`);
}

/*
 * The values one update writes to a row, as TypeORM takes them - a value,
 * or a function returning SQL - applied as Postgres applies them: every
 * expression worked out on the row as it was before this write. The
 * version counter is TypeORM's own, and is left out. Returns what was set.
 */
export function applyUpdateValues(row: Row, values: Row): Row {
  const before: Row = { ...row };
  const set: Row = {};

  for (const [column, value] of Object.entries(values)) {
    if (column === "version") {
      continue;
    }

    set[column] =
      typeof value === "function"
        ? evaluateRowWriteSql((value as () => string)(), before)
        : value;
  }

  Object.assign(row, set);

  return set;
}

// The columns an update asks back (TypeORM's `returning`), as the row holds them.
export function returnedColumns(
  row: Row,
  options: { returning?: unknown } | undefined,
): Array<Row> | undefined {
  if (!options || !Array.isArray(options.returning)) {
    return undefined;
  }

  const returned: Row = {};

  for (const column of options.returning as Array<string>) {
    returned[column] = row[column];
  }

  return [returned];
}
