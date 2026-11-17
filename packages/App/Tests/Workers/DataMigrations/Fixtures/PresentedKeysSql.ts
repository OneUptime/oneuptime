import { digestOfValueRead } from "../../../../FeatureSet/Workers/DataMigrations/HashMasterApiKey";
import PresentedKeysInPlace, {
  PresentedKeyProtection,
  PresentedKeyTarget,
} from "../../../../FeatureSet/Workers/Utils/PresentedKeysInPlace";
import { ModelRepository } from "../../../../FeatureSet/Workers/Utils/EncryptColumnInPlace";
import Encryption from "Common/Server/Utils/Encryption";
import PresentedKey from "Common/Server/Utils/PresentedKey/PresentedKey";

/*
 * A TABLE OF KEYS, ANSWERED IN MEMORY AS POSTGRES ANSWERS THE STATEMENTS
 * PresentedKeysInPlace SENDS (#9012), so its passes run without Postgres:
 *
 *   SELECT "_id", "<key>"[, "<hash>"] FROM "<table>" WHERE <stored as
 *     written> [AND "_id" > $1] ORDER BY "_id" ASC LIMIT <n>
 *   SELECT 1 FROM "<table>" WHERE <stored as written> LIMIT 1
 *   UPDATE "<table>" SET "<a>" = $1[, "<b>" = $2] WHERE "_id" = $k AND
 *     encode(sha256(convert_to("<key>", 'UTF8')), 'hex') = $m
 *
 * A statement it does not know fails the test, loudly. Every statement is
 * kept, with its parameters, for the tests to read.
 */

export type KeyRow = Record<string, unknown>;

export interface KeySqlCall {
  sql: string;
  parameters: Array<unknown>;
}

export interface KeyTable {
  rows: Array<KeyRow>;
  calls: Array<KeySqlCall>;
  target: PresentedKeyTarget;
  // Runs before an UPDATE is answered: a write landing between read and write.
  beforeUpdate?: ((row: KeyRow) => void) | undefined;
  // Makes the UPDATE of a row with this id fail.
  failingIds?: Set<string> | undefined;
}

// Whether a row holds a key stored as written, as getStoredAsWrittenSql says.
function isStoredAsWritten(
  target: PresentedKeyTarget,
  value: unknown,
): boolean {
  if (typeof value !== "string" || value === "") {
    return false;
  }

  return target.protection === PresentedKeyProtection.Hash
    ? !PresentedKey.isStoredHash(value)
    : !value.startsWith(Encryption.CIPHERTEXT_PREFIX);
}

export function answerKeySql(table: KeyTable): ModelRepository {
  const query: (
    sql: string,
    parameters?: Array<unknown>,
  ) => Promise<unknown> = async (
    sql: string,
    parameters: Array<unknown> = [],
  ): Promise<unknown> => {
    table.calls.push({ sql: sql, parameters: [...parameters] });

    const storedAsWritten: string = PresentedKeysInPlace.getStoredAsWrittenSql(
      table.target,
    );

    if (sql.startsWith("SELECT 1 FROM")) {
      if (!sql.includes(storedAsWritten)) {
        throw new Error(`Unknown statement: ${sql}`);
      }

      return table.rows.some((row: KeyRow): boolean => {
        return isStoredAsWritten(table.target, row[table.target.column]);
      })
        ? [{ "?column?": 1 }]
        : [];
    }

    if (sql.startsWith("SELECT ")) {
      const match: RegExpMatchArray | null = sql.match(
        /^SELECT (.+) FROM "(\w+)" WHERE (.+?)( AND "_id" > \$1)? ORDER BY "_id" ASC LIMIT (\d+)$/,
      );

      if (!match || match[3] !== storedAsWritten) {
        throw new Error(`Unknown statement: ${sql}`);
      }

      const columns: Array<string> = match[1]!
        .split(", ")
        .map((column: string): string => {
          return column.replace(/"/g, "");
        });
      const afterId: string | null = match[4] ? String(parameters[0]) : null;
      const limit: number = Number(match[5]);

      return table.rows
        .filter((row: KeyRow): boolean => {
          return (
            isStoredAsWritten(table.target, row[table.target.column]) &&
            (afterId === null || String(row["_id"]) > afterId)
          );
        })
        .sort((a: KeyRow, b: KeyRow): number => {
          return String(a["_id"]).localeCompare(String(b["_id"]));
        })
        .slice(0, limit)
        .map((row: KeyRow): KeyRow => {
          const answered: KeyRow = {};

          for (const column of columns) {
            answered[column] = row[column] ?? null;
          }

          return answered;
        });
    }

    if (sql.startsWith("UPDATE ")) {
      const match: RegExpMatchArray | null = sql.match(
        /^UPDATE "(\w+)" SET (.+) WHERE "_id" = \$(\d+) AND encode\(sha256\(convert_to\("(\w+)", 'UTF8'\)\), 'hex'\) = \$(\d+)$/,
      );

      if (!match || match[4] !== table.target.column) {
        throw new Error(`Unknown statement: ${sql}`);
      }

      const id: string = String(parameters[Number(match[3]) - 1]);
      const digest: string = String(parameters[Number(match[5]) - 1]);
      const row: KeyRow | undefined = table.rows.find((candidate: KeyRow) => {
        return String(candidate["_id"]) === id;
      });

      if (table.failingIds?.has(id)) {
        throw new Error(`the write of ${id} failed`);
      }

      if (!row) {
        return [[], 0];
      }

      table.beforeUpdate?.(row);

      const current: unknown = row[table.target.column];

      if (
        typeof current !== "string" ||
        digestOfValueRead(current) !== digest
      ) {
        return [[], 0];
      }

      for (const assignment of match[2]!.split(", ")) {
        const set: RegExpMatchArray | null =
          assignment.match(/^"(\w+)" = \$(\d+)$/);

        if (!set) {
          throw new Error(`Unknown assignment: ${assignment}`);
        }

        row[set[1]!] = parameters[Number(set[2]) - 1];
      }

      return [[], 1];
    }

    throw new Error(`Unknown statement: ${sql}`);
  };

  return {
    metadata: { tableName: "Keys" },
    manager: { query: query },
  } as unknown as ModelRepository;
}

// A target over a table in memory: `target` as given, its repository the table's.
export function keyTable(data: {
  target: Omit<PresentedKeyTarget, "repository" | "tableName">;
  rows: Array<KeyRow>;
}): KeyTable {
  const table: KeyTable = {
    rows: data.rows,
    calls: [],
    target: { ...data.target, tableName: "Keys" } as PresentedKeyTarget,
  };

  table.target.repository = answerKeySql(table);

  return table;
}
