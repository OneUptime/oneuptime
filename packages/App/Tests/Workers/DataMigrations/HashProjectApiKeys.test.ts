import ApiKeyService from "Common/Server/Services/ApiKeyService";
import HashedApiKey from "Common/Server/Utils/APIKey/HashedApiKey";
import logger from "Common/Server/Utils/Logger";
import { digestOfValueRead } from "../../../FeatureSet/Workers/DataMigrations/HashMasterApiKey";
import HashProjectApiKeys, {
  HASH_PROJECT_API_KEYS_PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/HashProjectApiKeys";
import {
  answerApiKeySql,
  ApiKeyRow,
  ApiKeySql,
  ApiKeySqlCall,
} from "./Fixtures/ApiKeysSql";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PROJECT'S API KEYS STORED BEFORE KEYS WERE HASHED ARE HASHED ONCE (#8902).
 *
 * ApiKey.apiKey holds a key's hash now. The keys made before hold the key
 * itself - the schema migration ApiKeyHashedColumn kept each as its text -
 * and this data migration writes each key's hash in its place, with its
 * hint, in raw SQL, only while the column still holds the key read.
 *
 * Pinned here, with the table answered in memory as Postgres answers the
 * two statements the migration sends (Fixtures/ApiKeysSql), so the real
 * migrate() runs without Postgres:
 *   1. it is registered once, after HashMasterApiKey, before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. every key stored as written is replaced by its hash, which the key
 *      presented still matches - every script and integration keeps
 *      working - with its hint; nothing else of the row changes; a key
 *      deleted already is hashed too, so no backup holds it;
 *   3. it reads a page at a time, each after the last, so every key is
 *      read once however many there are;
 *   4. a key already stored as its hash is not read, so a second run
 *      changes nothing;
 *   5. a key reset between its read and its write is kept, and two runs at
 *      once hash each key once;
 *   6. a write that fails, or a read that fails, does not throw - the
 *      migrations queued behind it still run - and the keys not hashed
 *      keep working as written;
 *   7. no key reaches the SQL text, a statement's parameters (which
 *      TypeORM's slow-query log prints) or the log;
 *   8. rollback changes nothing.
 * HashProjectApiKeysPostgres.test.ts runs it on a real Postgres, with the
 * schema migration before it and an API call with a key after.
 */

const MIGRATION_NAME: string = "HashProjectApiKeys";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

const SHA_256_HEX: RegExp = /^[0-9a-f]{64}$/;

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const OTHER_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";
const RESET_KEY: string = "5f3b9c1e-7a2d-4e8f-b6c0-1d2e3f4a5b6c";

const ROW_ID: string = "0a000000-0000-4000-8000-000000000001";
const OTHER_ROW_ID: string = "0a000000-0000-4000-8000-000000000002";

const OTHER_COLUMNS: Readonly<ApiKeyRow> = {
  name: "Terraform",
  projectId: "0b000000-0000-4000-8000-000000000001",
  expiresAt: "2027-11-16T00:00:00.000Z",
};

function keyRow(apiKey: unknown, id: string = ROW_ID): ApiKeyRow {
  return { _id: id, apiKey: apiKey, ...OTHER_COLUMNS };
}

// A row id for the n-th key, in id order.
function nthId(n: number): string {
  return `0c000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

// A key for the n-th row, a uuid as the column held it.
function nthKey(n: number): string {
  return `7d000000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;
}

function stubTable(rows: Array<ApiKeyRow>): ApiKeySql {
  const sql: ApiKeySql = answerApiKeySql(() => {
    return rows;
  });

  jest.spyOn(ApiKeyService, "getRepository").mockReturnValue({
    metadata: { tableName: "ApiKey" },
    manager: { query: sql.query },
  } as never);

  return sql;
}

function selects(sql: ApiKeySql): Array<ApiKeySqlCall> {
  return sql.calls.filter((call: ApiKeySqlCall): boolean => {
    return call.sql.startsWith("SELECT");
  });
}

function updates(sql: ApiKeySql): Array<ApiKeySqlCall> {
  return sql.calls.filter((call: ApiKeySqlCall): boolean => {
    return call.sql.startsWith("UPDATE");
  });
}

async function migrate(): Promise<void> {
  await new HashProjectApiKeys().migrate();
}

function loggedText(): string {
  return (jest.mocked(logger.error).mock.calls as Array<Array<unknown>>)
    .flat()
    .map((part: unknown): string => {
      return part instanceof Error ? part.message : String(part);
    })
    .join("\n");
}

// The key a request presents still matches what is stored.
function expectKeyWorks(row: ApiKeyRow, key: string): void {
  expect(
    HashedApiKey.matches({
      presentedKey: key,
      storedValue: row["apiKey"] as string,
    }),
  ).toBe(true);
}

describe("HashProjectApiKeys", () => {
  beforeEach(() => {
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("where it runs", () => {
    const registered: () => Array<string> = (): Array<string> => {
      const index: string = fs.readFileSync(
        path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
        "utf8",
      );

      expect(index).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );

      return Array.from(index.matchAll(NEW_MIGRATION_CALL)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );
    };

    test("is registered once, after the master API key's, before the last slot", () => {
      const names: Array<string> = registered();
      const position: number = names.indexOf(MIGRATION_NAME);

      expect(
        names.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(position).toBeGreaterThan(names.indexOf("HashMasterApiKey"));
      expect(names[names.length - 1]).toBe("AddAuditLogMcpClientColumns");
      expect(position).toBeLessThan(names.length - 1);
    });

    test("has the name it is recorded under", () => {
      expect(new HashProjectApiKeys().name).toBe(MIGRATION_NAME);
    });

    test("runs on a clustered ClickHouse too: it is Postgres only", () => {
      expect(new HashProjectApiKeys().runsInClusterMode()).toBe(true);
    });
  });

  test("replaces each key with its hash, which the key still matches, with its hint", async () => {
    const rows: Array<ApiKeyRow> = [
      keyRow(KEY),
      keyRow(OTHER_KEY, OTHER_ROW_ID),
    ];
    const sql: ApiKeySql = stubTable(rows);

    await migrate();

    expect(rows[0]!["apiKey"]).toBe(HashedApiKey.hash(KEY));
    expect(rows[0]!["apiKeyHint"]).toBe("2b34");
    expect(rows[1]!["apiKey"]).toBe(HashedApiKey.hash(OTHER_KEY));
    expect(rows[1]!["apiKeyHint"]).toBe("3e12");

    expectKeyWorks(rows[0]!, KEY);
    expectKeyWorks(rows[0]!, KEY.toUpperCase());
    expectKeyWorks(rows[1]!, OTHER_KEY);

    for (const row of rows) {
      expect(HashedApiKey.isStoredAsWritten(row["apiKey"] as string)).toBe(
        false,
      );

      // Nothing else of the row changes.
      for (const [column, value] of Object.entries(OTHER_COLUMNS)) {
        expect([column, row[column]]).toEqual([column, value]);
      }
    }

    // One page read, then one write per key, compared by the digest of the key read.
    expect(selects(sql)).toHaveLength(1);
    expect(updates(sql)[0]!.params).toEqual([
      HashedApiKey.hash(KEY),
      "2b34",
      ROW_ID,
      digestOfValueRead(KEY),
    ]);
    expect(sql.writes).toHaveLength(2);
  });

  test("a key stored upper-case is hashed as the lookup hashes it, and compared as it was read", async () => {
    const rows: Array<ApiKeyRow> = [keyRow(KEY.toUpperCase())];
    const sql: ApiKeySql = stubTable(rows);

    await migrate();

    expect(rows[0]!["apiKey"]).toBe(HashedApiKey.hash(KEY));
    expect(rows[0]!["apiKeyHint"]).toBe("2b34");
    expectKeyWorks(rows[0]!, KEY);
    expect(updates(sql)[0]!.params[3]).toBe(
      digestOfValueRead(KEY.toUpperCase()),
    );
  });

  test("a key deleted already is hashed too: no backup holds a working key", async () => {
    const rows: Array<ApiKeyRow> = [
      { ...keyRow(KEY), deletedAt: "2026-10-01T00:00:00.000Z" },
    ];

    stubTable(rows);

    await migrate();

    expect(rows[0]!["apiKey"]).toBe(HashedApiKey.hash(KEY));
  });

  test(`reads a page of ${HASH_PROJECT_API_KEYS_PAGE_SIZE} keys at a time, each after the last, until none is left`, async () => {
    const count: number = HASH_PROJECT_API_KEYS_PAGE_SIZE * 2 + 3;
    const rows: Array<ApiKeyRow> = [];

    for (let n: number = 1; n <= count; n++) {
      rows.push(keyRow(nthKey(n), nthId(n)));
    }

    // Read out of order: the pages follow the ids, not the rows' order.
    rows.reverse();

    const sql: ApiKeySql = stubTable(rows);

    await migrate();

    expect(sql.writes).toHaveLength(count);

    for (const row of rows) {
      expect(HashedApiKey.isHash(row["apiKey"] as string)).toBe(true);
    }

    const pages: Array<ApiKeySqlCall> = selects(sql);

    expect(pages).toHaveLength(3);
    expect(pages[0]!.params).toEqual(["00000000-0000-0000-0000-000000000000"]);
    expect(pages[1]!.params).toEqual([
      nthId(HASH_PROJECT_API_KEYS_PAGE_SIZE),
    ]);
    expect(pages[2]!.params).toEqual([
      nthId(HASH_PROJECT_API_KEYS_PAGE_SIZE * 2),
    ]);
    expect(pages[0]!.sql).toContain(
      `LIMIT ${HASH_PROJECT_API_KEYS_PAGE_SIZE}`,
    );
  });

  test("a key already stored as its hash is not read, let alone written: a key made since, through the service", async () => {
    const madeSince: string = HashedApiKey.hash(RESET_KEY);
    const rows: Array<ApiKeyRow> = [
      { ...keyRow(madeSince), apiKeyHint: "5b6c" },
    ];
    const sql: ApiKeySql = stubTable(rows);

    await migrate();

    expect(updates(sql)).toHaveLength(0);
    expect(rows[0]!["apiKey"]).toBe(madeSince);
    expect(rows[0]!["apiKeyHint"]).toBe("5b6c");
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("run twice: the second run changes nothing", async () => {
    const rows: Array<ApiKeyRow> = [keyRow(KEY)];

    stubTable(rows);
    await migrate();

    const afterFirst: ApiKeyRow = { ...rows[0]! };

    jest.mocked(ApiKeyService.getRepository).mockRestore();
    const second: ApiKeySql = stubTable(rows);

    await migrate();

    expect(updates(second)).toHaveLength(0);
    expect(rows[0]).toEqual(afterFirst);
    expectKeyWorks(rows[0]!, KEY);
  });

  test("a key reset between its read and its write is kept: the write compares the key read", async () => {
    const rows: Array<ApiKeyRow> = [keyRow(KEY)];
    const sql: ApiKeySql = stubTable(rows);

    sql.beforeUpdate = (): void => {
      // Someone presses Reset API Key: the service stores the new key's hash.
      rows[0]!["apiKey"] = HashedApiKey.hash(RESET_KEY);
      rows[0]!["apiKeyHint"] = "5b6c";
    };

    await migrate();

    expect(rows[0]!["apiKey"]).toBe(HashedApiKey.hash(RESET_KEY));
    // Nor the old key's hint over the new key's.
    expect(rows[0]!["apiKeyHint"]).toBe("5b6c");
    expectKeyWorks(rows[0]!, RESET_KEY);
    expect(sql.writes).toHaveLength(0);
  });

  test("two runs at once hash each key once", async () => {
    const rows: Array<ApiKeyRow> = [
      keyRow(KEY),
      keyRow(OTHER_KEY, OTHER_ROW_ID),
    ];
    const sql: ApiKeySql = stubTable(rows);
    let reads: number = 0;
    let bothHaveRead: () => void = (): void => {};
    const bothRead: Promise<void> = new Promise<void>((resolve: () => void) => {
      bothHaveRead = resolve;
    });

    // Neither run writes before both have read the keys as they were written.
    sql.beforeSelect = async (): Promise<void> => {
      reads++;

      if (reads === 2) {
        bothHaveRead();
      }

      await bothRead;
    };

    await Promise.all([migrate(), migrate()]);

    expect(reads).toBe(2);
    expect(updates(sql)).toHaveLength(4);
    // Hashed once each: the hash of the key, not a hash of its hash.
    expect(sql.writes).toHaveLength(2);
    expect(rows[0]!["apiKey"]).toBe(HashedApiKey.hash(KEY));
    expect(rows[1]!["apiKey"]).toBe(HashedApiKey.hash(OTHER_KEY));
  });

  test("a key that cannot be written keeps working as it was, says what to do, and the others are hashed", async () => {
    const rows: Array<ApiKeyRow> = [
      keyRow(KEY),
      keyRow(OTHER_KEY, OTHER_ROW_ID),
    ];
    const sql: ApiKeySql = stubTable(rows);

    sql.beforeUpdate = (id: string): void => {
      if (id === ROW_ID) {
        throw new Error("could not write");
      }
    };

    await expect(migrate()).resolves.toBeUndefined();

    expect(rows[0]!["apiKey"]).toBe(KEY);
    expect(rows[1]!["apiKey"]).toBe(HashedApiKey.hash(OTHER_KEY));
    expect(loggedText()).toContain(
      `HashProjectApiKeys: failed to hash the API key ${ROW_ID}. It keeps working; reset it on its page under Project Settings > Advanced > API Keys to store it hashed:`,
    );
  });

  test("a read that fails writes nothing, and does not throw", async () => {
    const rows: Array<ApiKeyRow> = [keyRow(KEY)];
    const sql: ApiKeySql = stubTable(rows);

    sql.beforeSelect = (): void => {
      throw new Error("could not read");
    };

    await expect(migrate()).resolves.toBeUndefined();

    expect(updates(sql)).toHaveLength(0);
    expect(rows[0]).toEqual(keyRow(KEY));
    expect(loggedText()).toContain(
      "HashProjectApiKeys: failed to read the project API keys to hash them. They keep working as they were written:",
    );
  });

  test("no key reaches the SQL text, a statement's parameters or the log", async () => {
    const rows: Array<ApiKeyRow> = [
      keyRow(KEY.toUpperCase()),
      keyRow(OTHER_KEY, OTHER_ROW_ID),
    ];
    const sql: ApiKeySql = stubTable(rows);

    sql.beforeUpdate = (id: string): void => {
      if (id === OTHER_ROW_ID) {
        throw new Error("could not write");
      }
    };

    await migrate();

    const statements: string = sql.calls
      .map((call: ApiKeySqlCall): string => {
        return call.sql;
      })
      .join("\n")
      .toLowerCase();
    const parameters: string = JSON.stringify(
      sql.calls.map((call: ApiKeySqlCall): Array<unknown> => {
        return call.params;
      }),
    ).toLowerCase();

    for (const key of [KEY, OTHER_KEY]) {
      expect(statements).not.toContain(key);
      expect(parameters).not.toContain(key);
      expect(loggedText().toLowerCase()).not.toContain(key);
    }

    // What it compares by is no key, nor the hash a request is looked up by.
    expect(digestOfValueRead(KEY)).toMatch(SHA_256_HEX);
    expect(digestOfValueRead(KEY)).not.toBe(HashedApiKey.hash(KEY));
  });

  test("rollback changes nothing", async () => {
    const rows: Array<ApiKeyRow> = [keyRow(KEY)];
    const sql: ApiKeySql = stubTable(rows);

    await new HashProjectApiKeys().rollback();

    expect(sql.calls).toHaveLength(0);
    expect(rows[0]).toEqual(keyRow(KEY));
  });
});
