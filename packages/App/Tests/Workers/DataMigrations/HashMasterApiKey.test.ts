import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import logger from "Common/Server/Utils/Logger";
import MasterApiKey from "Common/Server/Utils/MasterApiKey";
import HashMasterApiKey, {
  digestOfValueRead,
} from "../../../FeatureSet/Workers/DataMigrations/HashMasterApiKey";
import {
  answerGlobalConfigSql,
  GlobalConfigSql,
  SqlCall,
  SqlRow,
  SqlWrite,
} from "./Fixtures/GlobalConfigCredentialsSql";
import { SERVER_SETTINGS_ID } from "./Fixtures/ServerSettingsAsWritten";
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
 * THE MASTER API KEY STORED BEFORE KEYS WERE HASHED IS HASHED ONCE (#7901).
 *
 * The server's master API key (GlobalConfig.masterApiKey) is stored as its
 * hash now. The row written before holds the key itself - the schema
 * migration MasterApiKeyHashedColumn kept it as its text - and this data
 * migration writes its hash in its place, in raw SQL, only while the
 * column still holds the key read.
 *
 * Pinned here, with the table answered in memory as Postgres answers the
 * two statements the migration sends (Fixtures/GlobalConfigCredentialsSql),
 * so the real migrate() runs without Postgres:
 *   1. it is registered once, after the migrations that make the row, and
 *      before the slot AddAuditLogMcpClientColumns keeps last;
 *   2. a stored key is replaced by its hash, which the key presented still
 *      matches - every integration keeps working - with its hint, its last
 *      four characters (#8903), and nothing else of the row changes;
 *   3. a row with no key, and a key already stored as its hash, are left
 *      as they are, so a second run changes nothing;
 *   4. a key made between its read and its write is kept, and two runs at
 *      once hash the key once;
 *   5. a write that fails, or a read that fails, does not throw (the
 *      migrations queued behind it still run), and neither the key nor its
 *      hash reaches the log or the SQL text;
 *   6. rollback changes nothing.
 * MasterApiKeyPostgres.test.ts (Common) runs it on a real Postgres, with
 * the schema migration before it and an API call with the key after.
 */

const MIGRATION_NAME: string = "HashMasterApiKey";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

// The key as the uuid column held it, and as the schema migration kept it.
const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";

const SHA_256_HEX: RegExp = /^[0-9a-f]{64}$/;

const OTHER_COLUMNS: Readonly<SqlRow> = {
  isMasterApiKeyEnabled: true,
  smtpHost: "smtp.example.com",
  twilioAuthToken: "U2FsdGVkX1+already+encrypted",
};

// The row with the key as written, or whatever `masterApiKey` says it holds.
function storedRow(
  ...args: [masterApiKey?: unknown, id?: string | undefined]
): SqlRow {
  const masterApiKey: unknown = args.length > 0 ? args[0] : KEY;

  return {
    _id: args[1] || SERVER_SETTINGS_ID,
    masterApiKey: masterApiKey,
    ...OTHER_COLUMNS,
  };
}

function stubTable(rows: Array<SqlRow>): GlobalConfigSql {
  const sql: GlobalConfigSql = answerGlobalConfigSql(() => {
    return rows;
  });

  jest.spyOn(GlobalConfigService, "getRepository").mockReturnValue({
    metadata: { tableName: "GlobalConfig" },
    manager: { query: sql.query },
  } as never);

  return sql;
}

function updates(sql: GlobalConfigSql): Array<SqlCall> {
  return sql.calls.filter((call: SqlCall): boolean => {
    return call.sql.startsWith("UPDATE");
  });
}

// The writes of the key itself: its hint is written beside each one.
function keyWrites(sql: GlobalConfigSql): Array<SqlWrite> {
  return sql.writes.filter((write: SqlWrite): boolean => {
    return write.column === "masterApiKey";
  });
}

async function migrate(): Promise<void> {
  await new HashMasterApiKey().migrate();
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
function expectKeyWorks(row: SqlRow, key: string = KEY): void {
  expect(
    MasterApiKey.matches({
      presentedKey: key,
      storedValue: row["masterApiKey"] as string,
    }),
  ).toBe(true);
}

describe("HashMasterApiKey", () => {
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

    test("is registered once, after the migrations that make the row, before the last slot", () => {
      const names: Array<string> = registered();
      const position: number = names.indexOf(MIGRATION_NAME);

      expect(
        names.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(names.indexOf("AddDefaultGlobalConfig")).toBeGreaterThan(-1);
      expect(position).toBeGreaterThan(names.indexOf("AddDefaultGlobalConfig"));
      expect(position).toBeGreaterThan(
        names.indexOf("UpdateGlobalConfigFromEnv"),
      );
      expect(names[names.length - 1]).toBe("AddAuditLogMcpClientColumns");
      expect(position).toBeLessThan(names.length - 1);
    });

    test("has the name it is recorded under", () => {
      expect(new HashMasterApiKey().name).toBe(MIGRATION_NAME);
    });

    test("runs on a clustered ClickHouse too: it is Postgres only", () => {
      expect(new HashMasterApiKey().runsInClusterMode()).toBe(true);
    });
  });

  test("replaces the stored key with its hash, which the key still matches", async () => {
    const rows: Array<SqlRow> = [storedRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    await migrate();

    expect(rows[0]!["masterApiKey"]).toBe(MasterApiKey.hash(KEY));
    expect(
      MasterApiKey.isStoredAsWritten(rows[0]!["masterApiKey"] as string),
    ).toBe(false);
    expectKeyWorks(rows[0]!);
    expectKeyWorks(rows[0]!, KEY.toUpperCase());

    // With its hint, the page's "ends in 2b34": once hashed, nothing can tell it.
    expect(rows[0]!["masterApiKeyHint"]).toBe("2b34");
    expect(rows[0]!["masterApiKeyHint"]).toBe(MasterApiKey.getHint(KEY));

    // Nothing else of the row changes.
    for (const [column, value] of Object.entries(OTHER_COLUMNS)) {
      expect([column, rows[0]![column]]).toEqual([column, value]);
    }

    // One read of the column, then one write compared by the digest of the key read.
    expect(
      sql.calls.map((call: SqlCall): string => {
        return call.sql;
      }),
    ).toEqual([
      `SELECT "_id", "masterApiKey" FROM "GlobalConfig"`,
      `UPDATE "GlobalConfig" SET "masterApiKey" = $1, "masterApiKeyHint" = $2 WHERE "_id" = $3 AND encode(sha256(convert_to("masterApiKey", 'UTF8')), 'hex') = $4`,
    ]);
    expect(updates(sql)[0]!.params).toEqual([
      MasterApiKey.hash(KEY),
      "2b34",
      SERVER_SETTINGS_ID,
      digestOfValueRead(KEY),
    ]);
    expect(keyWrites(sql)).toHaveLength(1);
  });

  test("a key stored upper-case is hashed as the lookup hashes it, and compared as it was read", async () => {
    const rows: Array<SqlRow> = [storedRow(KEY.toUpperCase())];
    const sql: GlobalConfigSql = stubTable(rows);

    await migrate();

    expect(rows[0]!["masterApiKey"]).toBe(MasterApiKey.hash(KEY));
    expectKeyWorks(rows[0]!);
    // Its hint, as the page writes it: lower-case.
    expect(rows[0]!["masterApiKeyHint"]).toBe("2b34");
    expect(updates(sql)[0]!.params[3]).toBe(
      digestOfValueRead(KEY.toUpperCase()),
    );
  });

  test("hashes every row's key against that row", async () => {
    const otherId: string = "4e000000-0000-4000-8000-0000000000aa";
    const otherKey: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";
    const rows: Array<SqlRow> = [storedRow(), storedRow(otherKey, otherId)];

    stubTable(rows);

    await migrate();

    expectKeyWorks(rows[0]!, KEY);
    expectKeyWorks(rows[1]!, otherKey);
    expect(rows[0]!["masterApiKey"]).not.toBe(rows[1]!["masterApiKey"]);
    expect([rows[0]!["masterApiKeyHint"], rows[1]!["masterApiKeyHint"]]).toEqual(
      ["2b34", "3e12"],
    );
  });

  test.each([
    ["null", null],
    ["empty", ""],
    ["not there", undefined],
  ])(
    "leaves a row with no key as it is: %s",
    async (_label: string, value: unknown) => {
      const rows: Array<SqlRow> = [storedRow(value)];
      const sql: GlobalConfigSql = stubTable(rows);

      await migrate();

      expect(updates(sql)).toHaveLength(0);
      expect(rows[0]).toEqual(storedRow(value));
    },
  );

  test("leaves a key already stored as its hash as it is: a key made since, through the service", async () => {
    const madeSince: string = MasterApiKey.hash(
      "5f3b9c1e-7a2d-4e8f-b6c0-1d2e3f4a5b6c",
    );
    const rows: Array<SqlRow> = [storedRow(madeSince)];
    const sql: GlobalConfigSql = stubTable(rows);

    await migrate();

    expect(updates(sql)).toHaveLength(0);
    expect(rows[0]!["masterApiKey"]).toBe(madeSince);
    // Its hint was written with it by the service: nothing here touches it.
    expect(rows[0]!["masterApiKeyHint"]).toBeUndefined();
    // Known for a hash, and passed by: not tried as a key, and no failure logged.
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("run twice: the second run changes nothing", async () => {
    const rows: Array<SqlRow> = [storedRow()];
    const first: GlobalConfigSql = stubTable(rows);

    await migrate();

    expect(keyWrites(first)).toHaveLength(1);

    const afterFirst: SqlRow = { ...rows[0]! };

    jest.mocked(GlobalConfigService.getRepository).mockRestore();
    const second: GlobalConfigSql = stubTable(rows);

    await migrate();

    expect(updates(second)).toHaveLength(0);
    expect(second.writes).toHaveLength(0);
    expect(rows[0]).toEqual(afterFirst);
    expectKeyWorks(rows[0]!);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("a key made between its read and its write is kept: the write compares the key read", async () => {
    const rows: Array<SqlRow> = [storedRow()];
    const sql: GlobalConfigSql = stubTable(rows);
    const newKey: string = "5f3b9c1e-7a2d-4e8f-b6c0-1d2e3f4a5b6c";

    sql.beforeUpdate = (): void => {
      // An admin presses Reset Key: the service stores the new key's hash.
      rows[0]!["masterApiKey"] = MasterApiKey.hash(newKey);
    };

    await migrate();

    expect(rows[0]!["masterApiKey"]).toBe(MasterApiKey.hash(newKey));
    expectKeyWorks(rows[0]!, newKey);
    expect(sql.writes).toHaveLength(0);
    // Nor the old key's hint over the new key's.
    expect(rows[0]!["masterApiKeyHint"]).toBeUndefined();
    expect(updates(sql)[0]!.params[3]).toBe(digestOfValueRead(KEY));
  });

  test("two runs at once hash the key once", async () => {
    const rows: Array<SqlRow> = [storedRow()];
    const sql: GlobalConfigSql = stubTable(rows);
    let reads: number = 0;
    let bothHaveRead: () => void = (): void => {};
    const bothRead: Promise<void> = new Promise<void>((resolve: () => void) => {
      bothHaveRead = resolve;
    });

    // Neither run writes before both have read the key as it was written.
    sql.beforeSelect = async (): Promise<void> => {
      reads++;

      if (reads === 2) {
        bothHaveRead();
      }

      await bothRead;
    };

    await Promise.all([migrate(), migrate()]);

    expect(reads).toBe(2);
    expect(updates(sql)).toHaveLength(2);
    expect(keyWrites(sql)).toHaveLength(1);
    // Hashed once: the hash of the key, not a hash of its hash.
    expect(rows[0]!["masterApiKey"]).toBe(MasterApiKey.hash(KEY));
    expectKeyWorks(rows[0]!);
  });

  test("a key that cannot be written keeps working as it was, says what to do, and does not throw", async () => {
    const rows: Array<SqlRow> = [storedRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    sql.beforeUpdate = (): void => {
      throw new Error("could not write");
    };

    await expect(migrate()).resolves.toBeUndefined();

    expect(rows[0]!["masterApiKey"]).toBe(KEY);
    expect(rows[0]!["masterApiKeyHint"]).toBeUndefined();
    expectKeyWorks(rows[0]!);
    expect(loggedText()).toContain(
      `HashMasterApiKey: failed to hash the master API key of the server's settings ${SERVER_SETTINGS_ID}. It keeps working; reset it on Admin Dashboard > Settings > API Key to store it hashed:`,
    );
  });

  test("a read that fails writes nothing, and does not throw", async () => {
    const rows: Array<SqlRow> = [storedRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    sql.beforeSelect = (): void => {
      throw new Error("could not read");
    };

    await expect(migrate()).resolves.toBeUndefined();

    expect(updates(sql)).toHaveLength(0);
    expect(rows[0]).toEqual(storedRow());
    expect(loggedText()).toContain(
      "HashMasterApiKey: failed to read the server's settings to hash their master API key:",
    );
  });

  test("neither the key nor its hash reaches the SQL text or the log: they go only as parameters", async () => {
    const rows: Array<SqlRow> = [storedRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    sql.beforeUpdate = (): void => {
      throw new Error("could not write");
    };

    await migrate();

    const statements: string = sql.calls
      .map((call: SqlCall): string => {
        return call.sql;
      })
      .join("\n");

    for (const value of [KEY, MasterApiKey.hash(KEY)]) {
      expect(statements.includes(value)).toBe(false);
      expect(loggedText().includes(value)).toBe(false);
    }
  });

  test("the key is in no statement's parameters either, which TypeORM's slow-query log prints whole", async () => {
    const rows: Array<SqlRow> = [storedRow(KEY.toUpperCase())];
    const sql: GlobalConfigSql = stubTable(rows);

    await migrate();

    const parameters: string = JSON.stringify(
      sql.calls.map((call: SqlCall): Array<unknown> => {
        return call.params;
      }),
    ).toLowerCase();

    expect(parameters).not.toContain(KEY);
    // What it compares by is no key, nor the hash a request is matched by.
    expect(digestOfValueRead(KEY)).toMatch(SHA_256_HEX);
    expect(digestOfValueRead(KEY)).not.toBe(MasterApiKey.hash(KEY));
    expect(
      MasterApiKey.matches({
        presentedKey: KEY,
        storedValue: digestOfValueRead(KEY),
      }),
    ).toBe(false);
  });

  test("rollback changes nothing", async () => {
    const rows: Array<SqlRow> = [storedRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    await new HashMasterApiKey().rollback();

    expect(sql.calls).toHaveLength(0);
    expect(rows[0]).toEqual(storedRow());
  });
});
