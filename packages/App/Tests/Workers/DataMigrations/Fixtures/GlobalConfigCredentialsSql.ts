import crypto from "crypto";

/*
 * The server's settings table as the EncryptGlobalConfigCredentials data
 * migration reads and writes it, in memory: the two statements it sends,
 * answered over the rows as Postgres answers them.
 *
 *   SELECT "_id", "<column>", ... FROM "GlobalConfig"
 *     every row's id and the columns named, NULL for a column not set;
 *   SELECT "_id", "<column>" FROM "GlobalConfig" WHERE "<column>" IS NOT
 *     NULL AND "<column>" <> '' AND "<column>" NOT LIKE $1 [AND "_id" > $2]
 *     ORDER BY "_id" ASC LIMIT <n>
 *     a page of the rows whose column is set and does not start with $1's
 *     prefix, in id order after $2 - how EncryptColumnInPlace reads one
 *     column, for the CredentialsAtRest:EncryptInPlace job;
 *   UPDATE "GlobalConfig" SET "<column>" = $1
 *     WHERE "_id" = $2 AND "<column>" = $3
 *     the one column of the one row, only while the column still holds $3
 *     (a NULL equals nothing), as [rows, count changed]; without the
 *     AND, whatever the column holds;
 *   UPDATE "GlobalConfig" SET "<column>" = $1 WHERE "_id" = $2
 *     AND encode(sha256(convert_to("<column>", 'UTF8')), 'hex') = $3
 *     the same, compared by the SHA-256 of what the column holds, which is
 *     how HashMasterApiKey keeps the key out of its parameters;
 *   UPDATE "GlobalConfig" SET "<column>" = $1, "<other>" = $2
 *     WHERE "_id" = $3
 *     AND encode(sha256(convert_to("<column>", 'UTF8')), 'hex') = $4
 *     the same, writing a second column with it - the key's hint, which
 *     HashMasterApiKey writes with its hash.
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
// One column's page, as EncryptColumnInPlace reads it.
const SELECT_ONE_COLUMN_PAGE: RegExp =
  /^SELECT "_id", "(\w+)" FROM "GlobalConfig" WHERE "(\w+)" IS NOT NULL AND "(\w+)" <> '' AND "(\w+)" NOT LIKE \$1( AND "_id" > \$2)? ORDER BY "_id" ASC LIMIT (\d+)$/;
const UPDATE_ONE_COLUMN: RegExp =
  /^UPDATE "GlobalConfig" SET "(\w+)" = \$1 WHERE "_id" = \$2 AND "(\w+)" = \$3$/;
// The same write without the compare: answered too, so a test sees what it would do.
const UPDATE_ONE_COLUMN_BLINDLY: RegExp =
  /^UPDATE "GlobalConfig" SET "(\w+)" = \$1 WHERE "_id" = \$2$/;
// The same write, compared by the SHA-256 of what the column holds.
const UPDATE_ONE_COLUMN_BY_DIGEST: RegExp =
  /^UPDATE "GlobalConfig" SET "(\w+)" = \$1 WHERE "_id" = \$2 AND encode\(sha256\(convert_to\("(\w+)", 'UTF8'\)\), 'hex'\) = \$3$/;
// And with a second column written beside the one compared.
const UPDATE_TWO_COLUMNS_BY_DIGEST: RegExp =
  /^UPDATE "GlobalConfig" SET "(\w+)" = \$1, "(\w+)" = \$2 WHERE "_id" = \$3 AND encode\(sha256\(convert_to\("(\w+)", 'UTF8'\)\), 'hex'\) = \$4$/;

// SHA-256 of a text, as Postgres's encode(sha256(convert_to(text, 'UTF8')), 'hex').
function sha256Of(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

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

      const page: RegExpMatchArray | null = text.match(SELECT_ONE_COLUMN_PAGE);

      if (page) {
        const column: string = page[1]!;

        if (page[2] !== column || page[3] !== column || page[4] !== column) {
          throw new Error(
            `GlobalConfigSql: a SELECT reads ${column} and filters on another column`,
          );
        }

        const prefix: string = String(params?.[0] || "").replace(/%$/, "");
        const afterId: string | null = page[5] ? String(params?.[1]) : null;
        const limit: number = Number(page[6]);

        if (sql.beforeSelect) {
          await sql.beforeSelect();
        }

        return rows()
          .filter((row: SqlRow): boolean => {
            const value: unknown = row[column];

            return (
              typeof value === "string" &&
              value !== "" &&
              !value.startsWith(prefix) &&
              (afterId === null ||
                String(row["_id"]).toLowerCase() > afterId.toLowerCase())
            );
          })
          .sort((left: SqlRow, right: SqlRow): number => {
            return String(left["_id"]).toLowerCase() <
              String(right["_id"]).toLowerCase()
              ? -1
              : 1;
          })
          .slice(0, limit)
          .map((row: SqlRow): SqlRow => {
            return { _id: row["_id"], [column]: row[column] };
          });
      }

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

      const twoByDigest: RegExpMatchArray | null = text.match(
        UPDATE_TWO_COLUMNS_BY_DIGEST,
      );

      if (twoByDigest) {
        const column: string = twoByDigest[1]!;
        const otherColumn: string = twoByDigest[2]!;

        if (twoByDigest[3] !== column) {
          throw new Error(
            `GlobalConfigSql: an UPDATE sets ${column} and compares ${twoByDigest[3]}`,
          );
        }

        if (!params || params.length !== 4) {
          throw new Error(
            "GlobalConfigSql: an UPDATE takes a value for each placeholder",
          );
        }

        const [value, otherValue, id, expected] = params;

        if (sql.beforeUpdate) {
          await sql.beforeUpdate({ id: String(id), column: column });
        }

        let changed: number = 0;

        for (const row of rows()) {
          if (
            sameId(row["_id"], id) &&
            !isNull(row[column]) &&
            !isNull(expected) &&
            sha256Of(row[column]) === expected
          ) {
            row[column] = value;
            row[otherColumn] = otherValue;
            sql.writes.push({
              id: String(row["_id"]),
              column: column,
              value: value,
            });
            sql.writes.push({
              id: String(row["_id"]),
              column: otherColumn,
              value: otherValue,
            });
            changed++;
          }
        }

        return [[], changed];
      }

      const byDigest: RegExpMatchArray | null = text.match(
        UPDATE_ONE_COLUMN_BY_DIGEST,
      );
      const compared: RegExpMatchArray | null =
        text.match(UPDATE_ONE_COLUMN) || byDigest;
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
                (byDigest
                  ? sha256Of(row[column]) === expected
                  : row[column] === expected)))
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
