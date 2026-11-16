import { KEY_STORED_AS_WRITTEN_SQL_PATTERN } from "Common/Server/Services/ApiKeyService";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import crypto from "crypto";

/*
 * The ApiKey table as the HashProjectApiKeys data migration reads and
 * writes it, in memory: the two statements it sends, answered over the rows
 * as Postgres answers them.
 *
 *   SELECT "_id", "apiKey" FROM "ApiKey" WHERE "_id" > $1
 *     AND "apiKey" ~* '<a uuid>' ORDER BY "_id" ASC LIMIT <n>
 *     the keys still stored as written - a uuid, whatever its case - after
 *     the id given, in id order (a uuid's bytes, so its lower-case text),
 *     at most n of them;
 *   UPDATE "ApiKey" SET "apiKey" = $1, "apiKeyHint" = $2 WHERE "_id" = $3
 *     AND encode(sha256(convert_to("apiKey", 'UTF8')), 'hex') = $4
 *     the key and its hint of the one row, only while the key column still
 *     holds the value whose SHA-256 is $4, as [rows, count changed].
 *
 * Any other statement fails the test. A test may run code before a SELECT
 * answers or before an UPDATE applies: a write made in between, a second
 * run reading at the same time, or a failure.
 */

export type ApiKeyRow = Record<string, unknown>;

export interface ApiKeySqlCall {
  sql: string;
  params: Array<unknown>;
}

export interface ApiKeySql {
  // Every statement sent, in order.
  calls: Array<ApiKeySqlCall>;
  // Every key an UPDATE changed: the row, and what it now holds.
  writes: Array<{ id: string; apiKey: unknown; apiKeyHint: unknown }>;
  beforeSelect: ((afterId: string) => Promise<void> | void) | null;
  beforeUpdate: ((id: string) => Promise<void> | void) | null;
  query: (sql: string, params?: Array<unknown>) => Promise<unknown>;
}

const SELECT: RegExp = new RegExp(
  `^SELECT "_id", "apiKey" FROM "ApiKey" WHERE "_id" > \\$1 AND "apiKey" ~\\* '${escapeRegExp(
    KEY_STORED_AS_WRITTEN_SQL_PATTERN,
  )}' ORDER BY "_id" ASC LIMIT (\\d+)$`,
);

const UPDATE: RegExp =
  /^UPDATE "ApiKey" SET "apiKey" = \$1, "apiKeyHint" = \$2 WHERE "_id" = \$3 AND encode\(sha256\(convert_to\("apiKey", 'UTF8'\)\), 'hex'\) = \$4$/;

const STORED_AS_WRITTEN: RegExp = new RegExp(
  KEY_STORED_AS_WRITTEN_SQL_PATTERN,
  "i",
);

// SHA-256 of a text, as Postgres's encode(sha256(convert_to(text, 'UTF8')), 'hex').
function sha256Of(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function idOf(row: ApiKeyRow): string {
  return String(row["_id"]).toLowerCase();
}

// `rows` is read on every statement: the rows as they are at that moment.
export function answerApiKeySql(rows: () => Array<ApiKeyRow>): ApiKeySql {
  const sql: ApiKeySql = {
    calls: [],
    writes: [],
    beforeSelect: null,
    beforeUpdate: null,
    query: async (text: string, params?: Array<unknown>): Promise<unknown> => {
      sql.calls.push({ sql: text, params: params ? [...params] : [] });

      const select: RegExpMatchArray | null = text.match(SELECT);

      if (select) {
        if (!params || params.length !== 1) {
          throw new Error("ApiKeySql: a SELECT takes the id to start after");
        }

        const afterId: string = String(params[0]).toLowerCase();
        const limit: number = Number(select[1]);

        if (sql.beforeSelect) {
          await sql.beforeSelect(afterId);
        }

        return rows()
          .filter((row: ApiKeyRow): boolean => {
            return (
              idOf(row) > afterId &&
              typeof row["apiKey"] === "string" &&
              STORED_AS_WRITTEN.test(row["apiKey"] as string)
            );
          })
          .sort((left: ApiKeyRow, right: ApiKeyRow): number => {
            return idOf(left) < idOf(right) ? -1 : 1;
          })
          .slice(0, limit)
          .map((row: ApiKeyRow): ApiKeyRow => {
            return { _id: row["_id"], apiKey: row["apiKey"] };
          });
      }

      if (UPDATE.test(text)) {
        if (!params || params.length !== 4) {
          throw new Error(
            "ApiKeySql: an UPDATE takes a value for each placeholder",
          );
        }

        const [apiKey, apiKeyHint, id, expected] = params;

        if (sql.beforeUpdate) {
          await sql.beforeUpdate(String(id));
        }

        let changed: number = 0;

        for (const row of rows()) {
          if (
            idOf(row) === String(id).toLowerCase() &&
            typeof row["apiKey"] === "string" &&
            sha256Of(row["apiKey"]) === expected
          ) {
            row["apiKey"] = apiKey;
            row["apiKeyHint"] = apiKeyHint;
            sql.writes.push({
              id: idOf(row),
              apiKey: apiKey,
              apiKeyHint: apiKeyHint,
            });
            changed++;
          }
        }

        return [[], changed];
      }

      throw new Error(`ApiKeySql: unknown statement ${text}`);
    },
  };

  return sql;
}
