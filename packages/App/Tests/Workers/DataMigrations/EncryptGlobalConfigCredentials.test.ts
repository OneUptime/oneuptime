import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import EncryptGlobalConfigCredentials, {
  GLOBAL_CONFIG_COLUMNS_TO_ENCRYPT,
} from "../../../FeatureSet/Workers/DataMigrations/EncryptGlobalConfigCredentials";
import {
  answerGlobalConfigSql,
  GlobalConfigSql,
  SqlCall,
  SqlRow,
} from "./Fixtures/GlobalConfigCredentialsSql";
import {
  CREDENTIALS_AS_WRITTEN,
  SERVER_SETTINGS_ID,
} from "./Fixtures/ServerSettingsAsWritten";
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
 * THE SERVER'S CREDENTIALS STORED BEFORE THEIR COLUMNS WERE ENCRYPTED ARE
 * ENCRYPTED ONCE (#7739).
 *
 * Every credential column of the server's settings (GlobalConfig) is now
 * declared encrypted, as the newer provider keys were from the start. The
 * row written before holds each value as it was written; this data
 * migration encrypts each value that is set and not already our
 * ciphertext, in raw SQL, writing it only while the column still holds the
 * value read.
 *
 * Pinned here, with the table answered in memory as Postgres answers the
 * two statements the migration sends (Fixtures/GlobalConfigCredentialsSql),
 * so the real migrate() runs without Postgres:
 *   1. it is registered once, after the migrations that make and fill the
 *      row, and before the slot AddAuditLogMcpClientColumns keeps last;
 *   2. it encrypts every credential column the model declares encrypted
 *      but the four encrypted from the start;
 *   3. each value is stored encrypted and decrypts to exactly the value
 *      written; nothing else of the row changes;
 *   4. a value not set (null or empty) and one already encrypted are left
 *      as they are, so a second run changes nothing;
 *   5. a value saved between its read and its write is kept, and two runs
 *      at once encrypt each value once;
 *   6. one value that cannot be written, or a read that fails, costs the
 *      other values nothing and does not throw (the migrations queued
 *      behind it still run), and no value reaches the log or the SQL text;
 *   7. rollback changes nothing.
 * EncryptGlobalConfigCredentialsReadPath.test.ts reads a migrated row
 * through the service, the senders' settings and the sending fingerprints;
 * EncryptGlobalConfigCredentialsSenders.test.ts sends with it.
 */

const MIGRATION_NAME: string = "EncryptGlobalConfigCredentials";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

// Encrypted since they were added: no value of theirs was ever stored as written.
const ENCRYPTED_FROM_THE_START: ReadonlyArray<string> = [
  "amazonSesSecretAccessKey",
  "mailgunApiKey",
  "postmarkServerToken",
  "resendApiKey",
];

const COLUMNS: Array<string> = GLOBAL_CONFIG_COLUMNS_TO_ENCRYPT.map(
  (column: keyof GlobalConfig): string => {
    return String(column);
  },
);

// Each as an admin may have written it: kept exactly, spaces and all.
const WRITTEN: Readonly<Record<string, string>> = CREDENTIALS_AS_WRITTEN;

// The columns of the row the migration does not touch.
const OTHER_COLUMNS: Readonly<SqlRow> = {
  smtpUsername: "alerts@example.com",
  twilioAccountSID: "AC00000000000000000000000000000001",
  metaWhatsAppPhoneNumberId: "1234567890",
  telegramBotUsername: "oneuptime_alerts_bot",
  amazonSesSecretAccessKey: "U2FsdGVkX1+already+encrypted+from+the+start",
};

function writtenRow(id: string = SERVER_SETTINGS_ID): SqlRow {
  return { _id: id, ...WRITTEN, ...OTHER_COLUMNS };
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

async function migrate(): Promise<void> {
  await new EncryptGlobalConfigCredentials().migrate();
}

// Each credential as a reader decrypts it: exactly as written.
async function expectEncryptedAsWritten(row: SqlRow): Promise<void> {
  for (const column of COLUMNS) {
    const stored: string = row[column] as string;

    expect([column, Encryption.looksEncrypted(stored)]).toEqual([column, true]);
    expect([column, await Encryption.decrypt(stored)]).toEqual([
      column,
      WRITTEN[column],
    ]);
  }
}

function loggedText(): string {
  return (jest.mocked(logger.error).mock.calls as Array<Array<unknown>>)
    .flat()
    .map((part: unknown): string => {
      return part instanceof Error ? part.message : String(part);
    })
    .join("\n");
}

describe("EncryptGlobalConfigCredentials", () => {
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

    test("is registered once, after the migrations that make and fill the row, before the last slot", () => {
      const names: Array<string> = registered();
      const position: number = names.indexOf(MIGRATION_NAME);

      expect(
        names.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(position).toBeGreaterThan(names.indexOf("AddDefaultGlobalConfig"));
      expect(position).toBeGreaterThan(
        names.indexOf("UpdateGlobalConfigFromEnv"),
      );
      expect(names.indexOf("AddDefaultGlobalConfig")).toBeGreaterThan(-1);
      expect(names.indexOf("UpdateGlobalConfigFromEnv")).toBeGreaterThan(-1);
      expect(names[names.length - 1]).toBe("AddAuditLogMcpClientColumns");
      expect(position).toBeLessThan(names.length - 1);
    });

    test("has the name it is recorded under", () => {
      expect(new EncryptGlobalConfigCredentials().name).toBe(MIGRATION_NAME);
    });
  });

  test("encrypts every credential column the model declares encrypted, but the four encrypted from the start", () => {
    const encrypted: Array<string> = new GlobalConfig().getEncryptedColumns()
      .columns;

    expect(new Set(COLUMNS).size).toBe(COLUMNS.length);
    expect([...COLUMNS, ...ENCRYPTED_FROM_THE_START].sort()).toEqual(
      [...encrypted].sort(),
    );
  });

  test("stores each value encrypted, and each decrypts to exactly the value written", async () => {
    const rows: Array<SqlRow> = [writtenRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    await migrate();

    await expectEncryptedAsWritten(rows[0]!);
    expect(sql.writes).toHaveLength(COLUMNS.length);

    // Nothing else of the row changes.
    for (const [column, value] of Object.entries(OTHER_COLUMNS)) {
      expect([column, rows[0]![column]]).toEqual([column, value]);
    }

    // One read of the credential columns, then one write a value.
    expect(sql.calls[0]!.sql).toBe(
      `SELECT "_id", ${COLUMNS.map((column: string): string => {
        return `"${column}"`;
      }).join(", ")} FROM "GlobalConfig"`,
    );
    expect(updates(sql)).toHaveLength(COLUMNS.length);
  });

  test("encrypts every row's values against that row", async () => {
    const otherId: string = "4e000000-0000-4000-8000-0000000000aa";
    const rows: Array<SqlRow> = [writtenRow(), writtenRow(otherId)];
    const sql: GlobalConfigSql = stubTable(rows);

    await migrate();

    await expectEncryptedAsWritten(rows[0]!);
    await expectEncryptedAsWritten(rows[1]!);

    for (const update of updates(sql)) {
      expect([SERVER_SETTINGS_ID, otherId]).toContain(update.params[1]);
    }
  });

  test("leaves a value that is not set as it is: null stays null, empty stays empty", async () => {
    const rows: Array<SqlRow> = [
      {
        _id: SERVER_SETTINGS_ID,
        smtpPassword: null,
        twilioAuthToken: "",
        sendgridApiKey: undefined,
      },
    ];
    const sql: GlobalConfigSql = stubTable(rows);

    await migrate();

    expect(updates(sql)).toHaveLength(0);
    expect(rows[0]).toEqual({
      _id: SERVER_SETTINGS_ID,
      smtpPassword: null,
      twilioAuthToken: "",
      sendgridApiKey: undefined,
    });
  });

  test("a row partly encrypted: encrypts only the values still as written", async () => {
    const savedSince: Record<string, string> = {
      smtpPassword: await Encryption.encrypt("password saved since"),
      telegramBotToken: await Encryption.encrypt("987654321:bot-token-since"),
    };
    const rows: Array<SqlRow> = [{ ...writtenRow(), ...savedSince }];
    const sql: GlobalConfigSql = stubTable(rows);

    await migrate();

    // The values saved since are the very ciphertexts saved: never encrypted twice.
    expect(rows[0]!["smtpPassword"]).toBe(savedSince["smtpPassword"]);
    expect(rows[0]!["telegramBotToken"]).toBe(savedSince["telegramBotToken"]);
    expect(
      sql.writes.map((write: { column: string }): string => {
        return write.column;
      }),
    ).toEqual(
      COLUMNS.filter((column: string): boolean => {
        return !(column in savedSince);
      }),
    );

    for (const column of COLUMNS) {
      const expected: string =
        column === "smtpPassword"
          ? "password saved since"
          : column === "telegramBotToken"
            ? "987654321:bot-token-since"
            : WRITTEN[column]!;

      expect([
        column,
        await Encryption.decrypt(rows[0]![column] as string),
      ]).toEqual([column, expected]);
    }
  });

  test("run twice: the second run changes nothing", async () => {
    const rows: Array<SqlRow> = [writtenRow()];
    const first: GlobalConfigSql = stubTable(rows);

    await migrate();

    expect(first.writes).toHaveLength(COLUMNS.length);

    const afterFirst: SqlRow = { ...rows[0]! };

    jest.mocked(GlobalConfigService.getRepository).mockRestore();
    const second: GlobalConfigSql = stubTable(rows);

    await migrate();

    expect(updates(second)).toHaveLength(0);
    expect(second.writes).toHaveLength(0);
    expect(rows[0]).toEqual(afterFirst);
    await expectEncryptedAsWritten(rows[0]!);
  });

  test("a value saved between its read and its write is kept: the write compares the value read", async () => {
    const rows: Array<SqlRow> = [writtenRow()];
    const sql: GlobalConfigSql = stubTable(rows);
    const savedMeanwhile: string = await Encryption.encrypt(
      "a password saved meanwhile",
    );

    sql.beforeUpdate = (update: { id: string; column: string }): void => {
      if (update.column === "smtpPassword") {
        // An admin saves a new password, through the service, encrypted.
        rows[0]!["smtpPassword"] = savedMeanwhile;
      }
    };

    await migrate();

    expect(rows[0]!["smtpPassword"]).toBe(savedMeanwhile);

    const passwordUpdate: SqlCall | undefined = updates(sql).find(
      (call: SqlCall): boolean => {
        return call.sql.includes(`SET "smtpPassword"`);
      },
    );

    expect(passwordUpdate?.params[2]).toBe(WRITTEN["smtpPassword"]);
    expect(
      sql.writes.find((write: { column: string }): boolean => {
        return write.column === "smtpPassword";
      }),
    ).toBeUndefined();

    for (const column of COLUMNS) {
      if (column === "smtpPassword") {
        continue;
      }

      expect([
        column,
        await Encryption.decrypt(rows[0]![column] as string),
      ]).toEqual([column, WRITTEN[column]]);
    }
  });

  test("two runs at once encrypt each value once", async () => {
    const rows: Array<SqlRow> = [writtenRow()];
    const sql: GlobalConfigSql = stubTable(rows);
    let reads: number = 0;
    let bothHaveRead: () => void = (): void => {};
    const bothRead: Promise<void> = new Promise<void>((resolve: () => void) => {
      bothHaveRead = resolve;
    });

    // Neither run writes before both have read the row as written.
    sql.beforeSelect = async (): Promise<void> => {
      reads++;

      if (reads === 2) {
        bothHaveRead();
      }

      await bothRead;
    };

    await Promise.all([migrate(), migrate()]);

    expect(reads).toBe(2);
    expect(updates(sql)).toHaveLength(COLUMNS.length * 2);
    expect(sql.writes).toHaveLength(COLUMNS.length);
    // Decrypted once, each is the value written: not a ciphertext of a ciphertext.
    await expectEncryptedAsWritten(rows[0]!);
  });

  test("a value that cannot be written costs the others nothing, and does not throw", async () => {
    const rows: Array<SqlRow> = [writtenRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    sql.beforeUpdate = (update: { id: string; column: string }): void => {
      if (update.column === "twilioAuthToken") {
        throw new Error("could not write");
      }
    };

    await expect(migrate()).resolves.toBeUndefined();

    // It reads as itself until it is written again.
    expect(rows[0]!["twilioAuthToken"]).toBe(WRITTEN["twilioAuthToken"]);

    for (const column of COLUMNS) {
      if (column === "twilioAuthToken") {
        continue;
      }

      expect([
        column,
        await Encryption.decrypt(rows[0]![column] as string),
      ]).toEqual([column, WRITTEN[column]]);
    }

    expect(loggedText()).toContain(
      `failed to encrypt twilioAuthToken of the server's settings ${SERVER_SETTINGS_ID}`,
    );
  });

  test("a read that fails writes nothing, and does not throw", async () => {
    const rows: Array<SqlRow> = [writtenRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    sql.beforeSelect = (): void => {
      throw new Error("could not read");
    };

    await expect(migrate()).resolves.toBeUndefined();

    expect(updates(sql)).toHaveLength(0);
    expect(rows[0]).toEqual(writtenRow());
    expect(loggedText()).toContain(
      "failed to read the server's settings to encrypt",
    );
  });

  test("no value reaches the SQL text or the log: values go only as parameters", async () => {
    const rows: Array<SqlRow> = [writtenRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    sql.beforeUpdate = (update: { id: string; column: string }): void => {
      if (update.column === "sendgridApiKey") {
        throw new Error("could not write");
      }
    };

    await migrate();

    const statements: string = sql.calls
      .map((call: SqlCall): string => {
        return call.sql;
      })
      .join("\n");
    const ciphertexts: Array<string> = sql.writes.map(
      (write: { value: unknown }): string => {
        return String(write.value);
      },
    );

    for (const value of [...Object.values(WRITTEN), ...ciphertexts]) {
      expect(statements.includes(value)).toBe(false);
      expect(loggedText().includes(value)).toBe(false);
    }
  });

  test("rollback changes nothing", async () => {
    const rows: Array<SqlRow> = [writtenRow()];
    const sql: GlobalConfigSql = stubTable(rows);

    await new EncryptGlobalConfigCredentials().rollback();

    expect(sql.calls).toHaveLength(0);
    expect(rows[0]).toEqual(writtenRow());
  });
});
