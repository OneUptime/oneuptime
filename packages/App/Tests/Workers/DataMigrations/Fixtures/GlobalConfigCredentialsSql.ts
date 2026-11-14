/*
 * The server's settings table as the EncryptGlobalConfigCredentials data
 * migration reads and writes it, in memory: the two statements it sends,
 * answered over the rows as Postgres answers them.
 *
 *   SELECT "_id", "<column>", ... FROM "GlobalConfig"
 *     every row's id and the columns named, NULL for a column not set;
 *   UPDATE "GlobalConfig" SET "<column>" = $1
 *     WHERE "_id" = $2 AND "<column>" = $3
 *     the one column of the one row, only while the column still holds $3
 *     (a NULL equals nothing), as [rows, count changed]; without the
 *     AND, whatever the column holds.
 *
 * Any other statement, or one that sets a column other than the one it
 * compares, fails the test. A test may run code before a SELECT answers or
 * before an UPDATE applies: a write made in between, a second run reading
 * at the same time, or a failure.
 */

export type SqlRow = Record<string, unknown>;

export interface SqlCall {
  sql: string;
  params: Array<unknown>;
}

export interface SqlWrite {
  id: string;
  column: string;
  value: unknown;
}

export interface GlobalConfigSql {
  // Every statement sent, in order.
  calls: Array<SqlCall>;
  // Every value an UPDATE changed, in order.
  writes: Array<SqlWrite>;
  beforeSelect: (() => Promise<void> | void) | null;
  beforeUpdate:
    | ((update: { id: string; column: string }) => Promise<void> | void)
    | null;
  query: (sql: string, params?: Array<unknown>) => Promise<unknown>;
}

const TABLE: string = "GlobalConfig";
const SELECT_START: string = `SELECT "_id", `;
const SELECT_END: string = ` FROM "${TABLE}"`;
const QUOTED_COLUMN: RegExp = /^"(\w+)"$/;
const UPDATE_ONE_COLUMN: RegExp =
  /^UPDATE "GlobalConfig" SET "(\w+)" = \$1 WHERE "_id" = \$2 AND "(\w+)" = \$3$/;
// The same write without the compare: answered too, so a test sees what it would do.
const UPDATE_ONE_COLUMN_BLINDLY: RegExp =
  /^UPDATE "GlobalConfig" SET "(\w+)" = \$1 WHERE "_id" = \$2$/;

function isNull(value: unknown): boolean {
  return value === null || value === undefined;
}

function sameId(left: unknown, right: unknown): boolean {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

// `rows` is read on every statement: the rows as they are at that moment.
export function answerGlobalConfigSql(
  rows: () => Array<SqlRow>,
): GlobalConfigSql {
  const sql: GlobalConfigSql = {
    calls: [],
    writes: [],
    beforeSelect: null,
    beforeUpdate: null,
    query: async (text: string, params?: Array<unknown>): Promise<unknown> => {
      sql.calls.push({ sql: text, params: params ? [...params] : [] });

      if (text.startsWith(SELECT_START) && text.endsWith(SELECT_END)) {
        const columns: Array<string> = text
          .slice(SELECT_START.length, text.length - SELECT_END.length)
          .split(", ")
          .map((quoted: string): string => {
            const match: RegExpMatchArray | null = quoted.match(QUOTED_COLUMN);

            if (!match) {
              throw new Error(`GlobalConfigSql: unknown column ${quoted}`);
            }

            return match[1]!;
          });

        if (sql.beforeSelect) {
          await sql.beforeSelect();
        }

        return rows().map((row: SqlRow): SqlRow => {
          const read: SqlRow = { _id: row["_id"] };

          for (const column of columns) {
            read[column] = isNull(row[column]) ? null : row[column];
          }

          return read;
        });
      }

      const compared: RegExpMatchArray | null = text.match(UPDATE_ONE_COLUMN);
      const update: RegExpMatchArray | null =
        compared || text.match(UPDATE_ONE_COLUMN_BLINDLY);

      if (update) {
        const column: string = update[1]!;

        if (compared && compared[2] !== column) {
          throw new Error(
            `GlobalConfigSql: an UPDATE sets ${column} and compares ${compared[2]}`,
          );
        }

        if (!params || params.length !== (compared ? 3 : 2)) {
          throw new Error(
            "GlobalConfigSql: an UPDATE takes a value for each placeholder",
          );
        }

        const [value, id, expected] = params;

        if (sql.beforeUpdate) {
          await sql.beforeUpdate({ id: String(id), column: column });
        }

        let changed: number = 0;

        for (const row of rows()) {
          if (
            sameId(row["_id"], id) &&
            (!compared ||
              (!isNull(row[column]) &&
                !isNull(expected) &&
                row[column] === expected))
          ) {
            row[column] = value;
            sql.writes.push({
              id: String(row["_id"]),
              column: column,
              value: value,
            });
            changed++;
          }
        }

        return [[], changed];
      }

      throw new Error(`GlobalConfigSql: unknown statement ${text}`);
    },
  };

  return sql;
}
