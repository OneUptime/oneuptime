import PresentedKeysInPlace, {
  PresentedKeyProtection,
  PresentedKeyTarget,
  PresentedKeysPass,
} from "../../../FeatureSet/Workers/Utils/PresentedKeysInPlace";
import { keyTable, KeyRow, KeyTable } from "./Fixtures/PresentedKeysSql";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Encryption from "Common/Server/Utils/Encryption";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import PresentedKey from "Common/Server/Utils/PresentedKey/PresentedKey";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE KEYS PRESENTED TO ONEUPTIME THAT WERE STORED AS WRITTEN, PROTECTED IN
 * PLACE (#9012), with the table answered in memory as Postgres answers the
 * statements (Fixtures/PresentedKeysSql):
 *
 *   - the targets are every presented key of every model, each with how it
 *     is kept, its lookup hash column and how its key is compared;
 *   - writeLookupHashes writes the hash of each key stored as written,
 *     where it is missing or another key's, and changes no key - so a
 *     server of the release before keeps checking every key;
 *   - protect encrypts each key stored as written in place - or hashes a
 *     SCIM bearer token - with its lookup hash in the same statement, so
 *     every key a request presents keeps working, by its hash;
 *   - both read a page at a time, each after the last; a key protected is
 *     never read again, so a second run writes nothing; a key changed
 *     between its read and its write is kept; one row that cannot be
 *     written costs the others nothing; a deadline stops a pass;
 *   - no key is in any statement's parameters, nor in the log.
 */

jest.mock("Common/Server/Utils/Logger");

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const OTHER_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";
const TOKEN: string = "a".repeat(64);

function id(n: number): string {
  return `0e000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function monitorKeys(rows: Array<KeyRow>): KeyTable {
  return keyTable({
    target: {
      kind: "monitor",
      column: "incomingRequestSecretKey",
      protection: PresentedKeyProtection.Encrypt,
      lookupHashColumn: "incomingRequestSecretKeyHash",
      columnType: TableColumnType.ObjectID,
    },
    rows: rows,
  });
}

function scimTokens(rows: Array<KeyRow>): KeyTable {
  return keyTable({
    target: {
      kind: "project SCIM connection",
      column: "bearerToken",
      protection: PresentedKeyProtection.Hash,
      columnType: TableColumnType.HashedString,
    },
    rows: rows,
  });
}

function hashOf(key: string): string {
  return PresentedKey.hash(key, TableColumnType.ObjectID)!;
}

// What every statement carried, and every log line said.
function everythingSent(table: KeyTable): string {
  return JSON.stringify({
    calls: table.calls,
    logged: jest.mocked(logger.error).mock.calls,
  });
}

beforeEach(() => {
  jest.mocked(logger.error).mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the targets", () => {
  test("are every key presented to OneUptime that a model declares, as the model keeps it", () => {
    const declared: Array<string> = [];

    for (const modelType of AllModelTypes) {
      const model: BaseModel = new modelType();

      for (const column of model.getTableColumns().columns) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        if (!metadata?.presentedKey) {
          continue;
        }

        declared.push(`${model.tableName}.${column}`);

        const target: PresentedKeyTarget | undefined =
          PresentedKeysInPlace.getTargets().find(
            (candidate: PresentedKeyTarget): boolean => {
              return (
                candidate.tableName === model.tableName &&
                candidate.column === column
              );
            },
          );

        expect({
          column: `${model.tableName}.${column}`,
          found: Boolean(target),
        }).toEqual({
          column: `${model.tableName}.${column}`,
          found: true,
        });

        expect(target!.protection).toBe(
          metadata.encrypted
            ? PresentedKeyProtection.Encrypt
            : PresentedKeyProtection.Hash,
        );
        expect(target!.lookupHashColumn).toBe(metadata.lookupHashColumn);
        expect(target!.columnType).toBe(metadata.type);
      }
    }

    expect(PresentedKeysInPlace.getTargets()).toHaveLength(declared.length);
    expect(declared.length).toBe(16);
  });
});

describe("writeLookupHashes", () => {
  test("writes the hash of each key stored as written, and changes no key", async () => {
    const table: KeyTable = monitorKeys([
      { _id: id(1), incomingRequestSecretKey: KEY },
      { _id: id(2), incomingRequestSecretKey: OTHER_KEY },
    ]);

    const pass: PresentedKeysPass =
      await PresentedKeysInPlace.writeLookupHashes({
        migrationName: "Test",
        target: table.target,
      });

    expect(pass).toEqual({ read: 2, written: 2, failed: 0, isCutShort: false });
    expect(table.rows).toEqual([
      {
        _id: id(1),
        incomingRequestSecretKey: KEY,
        incomingRequestSecretKeyHash: hashOf(KEY),
      },
      {
        _id: id(2),
        incomingRequestSecretKey: OTHER_KEY,
        incomingRequestSecretKeyHash: hashOf(OTHER_KEY),
      },
    ]);
  });

  test("rewrites a hash left behind a key a server of the release before changed", async () => {
    const table: KeyTable = monitorKeys([
      {
        _id: id(1),
        incomingRequestSecretKey: OTHER_KEY,
        incomingRequestSecretKeyHash: hashOf(KEY),
      },
    ]);

    await PresentedKeysInPlace.writeLookupHashes({
      migrationName: "Test",
      target: table.target,
    });

    expect(table.rows[0]!["incomingRequestSecretKeyHash"]).toBe(
      hashOf(OTHER_KEY),
    );
  });

  test("leaves a key's hash as it is when it is the key's, and an encrypted key unread", async () => {
    const table: KeyTable = monitorKeys([
      {
        _id: id(1),
        incomingRequestSecretKey: KEY,
        incomingRequestSecretKeyHash: hashOf(KEY),
      },
      {
        _id: id(2),
        incomingRequestSecretKey: await Encryption.encrypt(OTHER_KEY),
        incomingRequestSecretKeyHash: hashOf(OTHER_KEY),
      },
    ]);

    const pass: PresentedKeysPass =
      await PresentedKeysInPlace.writeLookupHashes({
        migrationName: "Test",
        target: table.target,
      });

    expect(pass).toEqual({ read: 1, written: 0, failed: 0, isCutShort: false });
    expect(
      table.calls.filter((call: { sql: string }): boolean => {
        return call.sql.startsWith("UPDATE");
      }),
    ).toHaveLength(0);
  });

  test("a key with no lookup hash column has nothing to write, and is not read", async () => {
    const table: KeyTable = scimTokens([{ _id: id(1), bearerToken: TOKEN }]);

    expect(
      await PresentedKeysInPlace.writeLookupHashes({
        migrationName: "Test",
        target: table.target,
      }),
    ).toEqual({ read: 0, written: 0, failed: 0, isCutShort: false });
    expect(table.calls).toHaveLength(0);
  });

  test("puts no key in any statement's parameters, nor in the log", async () => {
    const table: KeyTable = monitorKeys([
      { _id: id(1), incomingRequestSecretKey: KEY },
    ]);

    await PresentedKeysInPlace.writeLookupHashes({
      migrationName: "Test",
      target: table.target,
    });

    expect(everythingSent(table)).not.toContain(KEY);
  });
});

describe("protect", () => {
  test("encrypts each key stored as written, in place, with its lookup hash", async () => {
    const table: KeyTable = monitorKeys([
      { _id: id(1), incomingRequestSecretKey: KEY },
    ]);

    const pass: PresentedKeysPass = await PresentedKeysInPlace.protect({
      migrationName: "Test",
      target: table.target,
    });

    expect(pass).toEqual({ read: 1, written: 1, failed: 0, isCutShort: false });

    const stored: string = table.rows[0]!["incomingRequestSecretKey"] as string;

    expect(Encryption.looksEncrypted(stored)).toBe(true);
    expect(await Encryption.decrypt(stored)).toBe(KEY);
    expect(table.rows[0]!["incomingRequestSecretKeyHash"]).toBe(hashOf(KEY));
  });

  test("hashes a SCIM bearer token stored as written, as the lookup by its hash finds it", async () => {
    const table: KeyTable = scimTokens([{ _id: id(1), bearerToken: TOKEN }]);

    await PresentedKeysInPlace.protect({
      migrationName: "Test",
      target: table.target,
    });

    const stored: string = table.rows[0]!["bearerToken"] as string;

    // What SCIMAuthorization.findConnection queries the token by.
    expect(stored).toBe(PresentedKey.toStoredHash(TOKEN));
    expect(PresentedKey.isStoredHash(stored)).toBe(true);
  });

  test("a second run reads nothing and writes nothing", async () => {
    const table: KeyTable = monitorKeys([
      { _id: id(1), incomingRequestSecretKey: KEY },
    ]);

    await PresentedKeysInPlace.protect({
      migrationName: "Test",
      target: table.target,
    });

    const stored: unknown = table.rows[0]!["incomingRequestSecretKey"];

    expect(
      await PresentedKeysInPlace.protect({
        migrationName: "Test",
        target: table.target,
      }),
    ).toEqual({ read: 0, written: 0, failed: 0, isCutShort: false });
    expect(table.rows[0]!["incomingRequestSecretKey"]).toBe(stored);
    expect(
      await PresentedKeysInPlace.hasKeysStoredAsWritten(table.target),
    ).toBe(false);
  });

  test("keeps a key changed between its read and its write", async () => {
    const table: KeyTable = monitorKeys([
      { _id: id(1), incomingRequestSecretKey: KEY },
    ]);

    table.beforeUpdate = (row: KeyRow): void => {
      row["incomingRequestSecretKey"] = OTHER_KEY;
    };

    await PresentedKeysInPlace.protect({
      migrationName: "Test",
      target: table.target,
    });

    expect(table.rows[0]!["incomingRequestSecretKey"]).toBe(OTHER_KEY);
  });

  test("reads a page at a time, each after the last, so every key is read once", async () => {
    const rows: Array<KeyRow> = [];

    for (let n: number = 1; n <= 5; n++) {
      rows.push({ _id: id(n), incomingRequestSecretKey: KEY });
    }

    const table: KeyTable = monitorKeys(rows);

    const pass: PresentedKeysPass =
      await PresentedKeysInPlace.writeLookupHashes({
        migrationName: "Test",
        target: table.target,
        pageSize: 2,
      });

    expect(pass.read).toBe(5);

    const selects: Array<{ sql: string; parameters: Array<unknown> }> =
      table.calls.filter((call: { sql: string }): boolean => {
        return call.sql.startsWith("SELECT");
      });

    expect(
      selects.map((call: { parameters: Array<unknown> }): unknown => {
        return call.parameters[0];
      }),
    ).toEqual([undefined, id(2), id(4)]);
  });

  test("one row that cannot be written costs the others nothing, and the log names it by its id alone", async () => {
    const table: KeyTable = monitorKeys([
      { _id: id(1), incomingRequestSecretKey: KEY },
      { _id: id(2), incomingRequestSecretKey: OTHER_KEY },
    ]);

    table.failingIds = new Set<string>([id(1)]);

    const pass: PresentedKeysPass = await PresentedKeysInPlace.protect({
      migrationName: "Test",
      target: table.target,
    });

    expect(pass).toEqual({ read: 2, written: 1, failed: 1, isCutShort: false });
    expect(table.rows[0]!["incomingRequestSecretKey"]).toBe(KEY);
    expect(
      Encryption.looksEncrypted(
        table.rows[1]!["incomingRequestSecretKey"] as string,
      ),
    ).toBe(true);

    const logged: string = JSON.stringify(jest.mocked(logger.error).mock.calls);

    expect(logged).toContain(id(1));
    expect(logged).not.toContain(KEY);
  });

  test("stops at its deadline, with what is left for the next run", async () => {
    const table: KeyTable = monitorKeys([
      { _id: id(1), incomingRequestSecretKey: KEY },
    ]);
    const deadline: JobDeadline = new JobDeadline();
    deadline.end(new Error("the run's time is up"));

    expect(
      await PresentedKeysInPlace.protect({
        migrationName: "Test",
        target: table.target,
        deadline: deadline,
      }),
    ).toEqual({ read: 0, written: 0, failed: 0, isCutShort: true });
    expect(table.rows[0]!["incomingRequestSecretKey"]).toBe(KEY);
  });

  test("puts no key in any statement's parameters, nor in the log", async () => {
    const table: KeyTable = monitorKeys([
      { _id: id(1), incomingRequestSecretKey: KEY },
    ]);
    const tokens: KeyTable = scimTokens([{ _id: id(1), bearerToken: TOKEN }]);

    await PresentedKeysInPlace.protect({
      migrationName: "Test",
      target: table.target,
    });
    await PresentedKeysInPlace.protect({
      migrationName: "Test",
      target: tokens.target,
    });

    const sent: string = everythingSent(table) + everythingSent(tokens);

    expect(sent).not.toContain(KEY);
    expect(sent).not.toContain(TOKEN);
  });
});
