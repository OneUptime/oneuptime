import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import FormDomainService from "Common/Server/Services/FormDomainService";
import StatusPageDomainService from "Common/Server/Services/StatusPageDomainService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import EncryptUploadedCertificateKeys from "../../../FeatureSet/Workers/DataMigrations/EncryptUploadedCertificateKeys";
import { encryptInPlaceADayLater } from "./Fixtures/CredentialsAtRestPass";
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
 * The private keys customers uploaded for their status page, dashboard and
 * form domains, stored as plaintext before the column was kept encrypted
 * at rest. The upgrade's EncryptUploadedCertificateKeys leaves them as
 * written (#9266), so the ingress of the release before serves them while
 * the upgrade rolls out; a day later the CredentialsAtRest:EncryptInPlace
 * job reads each row's raw key and, when it is not already our ciphertext,
 * encrypts it and writes it back - in raw SQL, so the services' own encrypt
 * and decrypt never touch it.
 *
 * Pinned here, with the three repositories stubbed so the real migrate()
 * and the job's real pass run without Postgres:
 *   1. it is registered in DataMigrations/Index.ts, once, before the slot
 *      AddAuditLogMcpClientColumns keeps last, and the upgrade's run of it
 *      changes nothing;
 *   2. the pass encrypts a plaintext key on every kind of domain, and the
 *      stored value decrypts back to the key;
 *   3. each write holds to the plaintext it read, so a key replaced
 *      meanwhile is left as its new write stored it;
 *   4. it leaves an encrypted, empty or null key alone, so a second run
 *      rewrites nothing;
 *   5. a table that cannot be read, or a row that cannot be written, costs
 *      the others nothing - and no key is ever logged;
 *   6. rollback changes nothing.
 */

const MIGRATION_NAME: string = "EncryptUploadedCertificateKeys";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;
const SELECT_START: RegExp = /^\s*SELECT/i;
const UPDATE_START: RegExp = /^\s*UPDATE/i;

// Stand-ins for a PEM key: the migration never parses one.
const KEY_A: string =
  "-----BEGIN PRIVATE KEY-----\nstatus-page-key\n-----END PRIVATE KEY-----";
const KEY_B: string =
  "-----BEGIN PRIVATE KEY-----\ndashboard-key\n-----END PRIVATE KEY-----";
const KEY_C: string =
  "-----BEGIN PRIVATE KEY-----\nform-key\n-----END PRIVATE KEY-----";

interface QueryCall {
  table: string;
  sql: string;
  params: Array<unknown> | undefined;
}

type KeyRow = { _id: string; customCertificateKey: string | null };

interface TableStub {
  rows: Array<KeyRow>;
  failRead?: boolean;
  failUpdateForId?: string;
}

function stubTables(tables: {
  StatusPageDomain?: TableStub;
  DashboardDomain?: TableStub;
  FormDomain?: TableStub;
}): Array<QueryCall> {
  const calls: Array<QueryCall> = [];

  const repositoryFor: (table: string) => unknown = (
    table: string,
  ): unknown => {
    const stub: TableStub = (tables as Record<string, TableStub | undefined>)[
      table
    ] || { rows: [] };

    return {
      metadata: { tableName: table },
      manager: {
        query: async (
          sql: string,
          params?: Array<unknown>,
        ): Promise<unknown> => {
          calls.push({ table, sql, params });

          if (SELECT_START.test(sql)) {
            if (stub.failRead) {
              throw new Error("read failed");
            }

            return stub.rows;
          }

          if (
            UPDATE_START.test(sql) &&
            stub.failUpdateForId &&
            params &&
            params[1] === stub.failUpdateForId
          ) {
            throw new Error("write failed");
          }

          return [];
        },
      },
    };
  };

  jest
    .spyOn(StatusPageDomainService, "getRepository")
    .mockReturnValue(repositoryFor("StatusPageDomain") as never);
  jest
    .spyOn(DashboardDomainService, "getRepository")
    .mockReturnValue(repositoryFor("DashboardDomain") as never);
  jest
    .spyOn(FormDomainService, "getRepository")
    .mockReturnValue(repositoryFor("FormDomain") as never);

  return calls;
}

function updateCalls(calls: Array<QueryCall>): Array<QueryCall> {
  return calls.filter((call: QueryCall): boolean => {
    return UPDATE_START.test(call.sql);
  });
}

describe("EncryptUploadedCertificateKeys", () => {
  beforeEach(() => {
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(NEW_MIGRATION_CALL),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });

  test("has the name it is recorded under", () => {
    expect(new EncryptUploadedCertificateKeys().name).toBe(MIGRATION_NAME);
  });

  test("the upgrade's run changes nothing: the ingress of the release before serves every key as written", async () => {
    const calls: Array<QueryCall> = stubTables({
      StatusPageDomain: {
        rows: [{ _id: "status-1", customCertificateKey: KEY_A }],
      },
      DashboardDomain: {
        rows: [{ _id: "dashboard-1", customCertificateKey: KEY_B }],
      },
      FormDomain: { rows: [{ _id: "form-1", customCertificateKey: KEY_C }] },
    });

    await new EncryptUploadedCertificateKeys().migrate();

    expect(calls).toHaveLength(0);
  });

  test("encrypts a plaintext key on every kind of custom domain, and each decrypts back", async () => {
    const calls: Array<QueryCall> = stubTables({
      StatusPageDomain: {
        rows: [{ _id: "status-1", customCertificateKey: KEY_A }],
      },
      DashboardDomain: {
        rows: [{ _id: "dashboard-1", customCertificateKey: KEY_B }],
      },
      FormDomain: { rows: [{ _id: "form-1", customCertificateKey: KEY_C }] },
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const updates: Array<QueryCall> = updateCalls(calls);

    expect(
      updates.map((call: QueryCall): string => {
        return call.table;
      }),
    ).toEqual(["StatusPageDomain", "DashboardDomain", "FormDomain"]);

    for (const [index, key] of [KEY_A, KEY_B, KEY_C].entries()) {
      const [encrypted, , previous] = updates[index]!.params as [
        string,
        string,
        string,
      ];

      expect(updates[index]!.sql).toContain('SET "customCertificateKey" = $1');
      // Held to the plaintext it read: a key replaced meanwhile is left alone.
      expect(updates[index]!.sql).toContain('AND "customCertificateKey" = $3');
      expect(previous).toBe(key);
      expect(encrypted).not.toBe(key);
      expect(Encryption.looksEncrypted(encrypted)).toBe(true);
      expect(await Encryption.decrypt(encrypted)).toBe(key);
    }
  });

  test("reads only the keys that are there", async () => {
    const calls: Array<QueryCall> = stubTables({});

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const selects: Array<QueryCall> = calls.filter(
      (call: QueryCall): boolean => {
        return SELECT_START.test(call.sql);
      },
    );

    expect(selects).toHaveLength(3);

    for (const select of selects) {
      expect(select.sql).toContain('"customCertificateKey" IS NOT NULL');
      expect(select.sql).toContain(`FROM "${select.table}"`);
    }
  });

  test("leaves an already-encrypted, empty or null key alone (idempotent)", async () => {
    const alreadyEncrypted: string = await Encryption.encrypt(KEY_A);
    const calls: Array<QueryCall> = stubTables({
      StatusPageDomain: {
        rows: [
          { _id: "already", customCertificateKey: alreadyEncrypted },
          { _id: "empty", customCertificateKey: "" },
          { _id: "null", customCertificateKey: null },
        ],
      },
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    expect(updateCalls(calls)).toHaveLength(0);
  });

  test("a second run over the keys it encrypted rewrites nothing", async () => {
    const first: Array<QueryCall> = stubTables({
      FormDomain: { rows: [{ _id: "form-1", customCertificateKey: KEY_C }] },
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const encrypted: string = (
      updateCalls(first)[0]!.params as Array<string>
    )[0]!;

    jest.restoreAllMocks();
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const second: Array<QueryCall> = stubTables({
      FormDomain: {
        rows: [{ _id: "form-1", customCertificateKey: encrypted }],
      },
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    expect(updateCalls(second)).toHaveLength(0);
  });

  test("a table that cannot be read, or a row that cannot be written, costs the others nothing - and logs no key", async () => {
    const calls: Array<QueryCall> = stubTables({
      StatusPageDomain: { rows: [], failRead: true },
      DashboardDomain: {
        rows: [
          { _id: "bad", customCertificateKey: KEY_B },
          { _id: "good", customCertificateKey: KEY_A },
        ],
        failUpdateForId: "bad",
      },
      FormDomain: { rows: [{ _id: "form-1", customCertificateKey: KEY_C }] },
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const written: Array<string> = updateCalls(calls).map(
      (call: QueryCall): string => {
        return `${call.table}:${(call.params as Array<string>)[1]}`;
      },
    );

    expect(written).toEqual([
      "DashboardDomain:bad",
      "DashboardDomain:good",
      "FormDomain:form-1",
    ]);

    expect(logger.error).toHaveBeenCalled();

    const logged: string = JSON.stringify(
      (logger.error as unknown as jest.Mock).mock.calls,
    );

    for (const key of [KEY_A, KEY_B, KEY_C]) {
      expect(logged).not.toContain(key);
    }
  });

  test("rollback changes nothing", async () => {
    const calls: Array<QueryCall> = stubTables({
      StatusPageDomain: {
        rows: [{ _id: "status-1", customCertificateKey: KEY_A }],
      },
    });

    await new EncryptUploadedCertificateKeys().rollback();

    expect(calls).toHaveLength(0);
  });
});
