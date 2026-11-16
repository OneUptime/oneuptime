import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import GreenlockCertificateService from "Common/Server/Services/GreenlockCertificateService";
import AcmeCertificate from "Common/Models/DatabaseModels/AcmeCertificate";
import GreenlockCertificate from "Common/Models/DatabaseModels/GreenlockCertificate";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import EncryptLetsEncryptKeys from "../../../FeatureSet/Workers/DataMigrations/EncryptLetsEncryptKeys";
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
 * EncryptLetsEncryptKeys encrypts the private keys of the free certificates
 * OneUptime orders from Let's Encrypt (AcmeCertificate.certificateKey), and
 * the account and certificate keys the Greenlock store before it kept
 * (GreenlockCertificate.blob), stored as plaintext before both columns were
 * kept encrypted at rest. Pinned here, with the two repositories stubbed so
 * the real migrate() runs without Postgres:
 *
 *   1. it is registered in DataMigrations/Index.ts, once, after the custom
 *      domains' keys and before the slot AddAuditLogMcpClientColumns keeps
 *      last;
 *   2. both columns are declared encrypted, so what it writes is read back
 *      decrypted, and every later write is encrypted by the service;
 *   3. it encrypts a plaintext key in both tables, and the stored value
 *      decrypts back to the key nginx served before;
 *   4. each write holds to the plaintext it read, so a key renewed meanwhile
 *      is left as its renewal stored it;
 *   5. it leaves an encrypted, empty or null value alone, so a second run
 *      rewrites nothing;
 *   6. a table that cannot be read, or a row that cannot be written, costs
 *      the others nothing - and no key is ever logged;
 *   7. rollback changes nothing.
 */

const MIGRATION_NAME: string = "EncryptLetsEncryptKeys";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;
const SELECT_START: RegExp = /^\s*SELECT/i;
const UPDATE_START: RegExp = /^\s*UPDATE/i;

// Stand-ins for what each table holds: the migration never parses one.
const CERTIFICATE_KEY: string =
  "-----BEGIN PRIVATE KEY-----\nstatus-acme-com-certificate-key\n-----END PRIVATE KEY-----";
const HOST_KEY: string =
  "-----BEGIN PRIVATE KEY-----\noneuptime-acme-com-host-key\n-----END PRIVATE KEY-----";
const ACCOUNT_KEY_PAIR: string = JSON.stringify({
  privateKeyPem:
    "-----BEGIN EC PRIVATE KEY-----\ngreenlock-account-key\n-----END EC PRIVATE KEY-----",
  privateKeyJwk: { kty: "EC", crv: "P-256", d: "greenlock-account-d" },
});

interface QueryCall {
  table: string;
  sql: string;
  params: Array<unknown> | undefined;
}

type StoredRow = Record<string, unknown>;

interface TableStub {
  rows: Array<StoredRow>;
  failRead?: boolean;
  failUpdateForId?: string;
}

function stubTables(tables: {
  AcmeCertificate?: TableStub;
  GreenlockCertificate?: TableStub;
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
            // As TypeORM's QueryFailedError carries the query's parameters.
            const error: Error & { parameters?: Array<unknown> } = new Error(
              "write failed",
            );
            error.parameters = params;
            throw error;
          }

          return [];
        },
      },
    };
  };

  jest
    .spyOn(AcmeCertificateService, "getRepository")
    .mockReturnValue(repositoryFor("AcmeCertificate") as never);
  jest
    .spyOn(GreenlockCertificateService, "getRepository")
    .mockReturnValue(repositoryFor("GreenlockCertificate") as never);

  return calls;
}

function updateCalls(calls: Array<QueryCall>): Array<QueryCall> {
  return calls.filter((call: QueryCall): boolean => {
    return UPDATE_START.test(call.sql);
  });
}

describe("EncryptLetsEncryptKeys", () => {
  beforeEach(() => {
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, after the custom domains' keys and before the last slot", () => {
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
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("EncryptUploadedCertificateKeys"),
    );
    // The Greenlock store's domains were moved to ACME certificates first.
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("MoveGreenlockCertsToAcmeCerts"),
    );
  });

  test("has the name it is recorded under", () => {
    expect(new EncryptLetsEncryptKeys().name).toBe(MIGRATION_NAME);
  });

  test("both columns it encrypts are declared encrypted, so they are read back decrypted", () => {
    expect(new AcmeCertificate().getEncryptedColumns().columns).toContain(
      "certificateKey",
    );
    expect(new GreenlockCertificate().getEncryptedColumns().columns).toContain(
      "blob",
    );
  });

  test("encrypts a plaintext key in both tables, and each decrypts back", async () => {
    const calls: Array<QueryCall> = stubTables({
      AcmeCertificate: {
        rows: [
          { _id: "certificate-1", certificateKey: CERTIFICATE_KEY },
          { _id: "certificate-2", certificateKey: HOST_KEY },
        ],
      },
      GreenlockCertificate: {
        rows: [{ _id: "greenlock-1", blob: ACCOUNT_KEY_PAIR }],
      },
    });

    await new EncryptLetsEncryptKeys().migrate();

    const updates: Array<QueryCall> = updateCalls(calls);

    expect(
      updates.map((call: QueryCall): string => {
        return `${call.table}:${(call.params as Array<string>)[1]}`;
      }),
    ).toEqual([
      "AcmeCertificate:certificate-1",
      "AcmeCertificate:certificate-2",
      "GreenlockCertificate:greenlock-1",
    ]);

    const expected: Array<[string, string]> = [
      ["certificateKey", CERTIFICATE_KEY],
      ["certificateKey", HOST_KEY],
      ["blob", ACCOUNT_KEY_PAIR],
    ];

    for (const [index, [column, value]] of expected.entries()) {
      const [encrypted, , previous] = updates[index]!.params as [
        string,
        string,
        string,
      ];

      expect(updates[index]!.sql).toContain(`SET "${column}" = $1`);
      // Held to the plaintext it read: a key renewed meanwhile is left alone.
      expect(updates[index]!.sql).toContain(`AND "${column}" = $3`);
      expect(previous).toBe(value);
      expect(encrypted).not.toBe(value);
      expect(Encryption.looksEncrypted(encrypted)).toBe(true);
      expect(await Encryption.decrypt(encrypted)).toBe(value);
    }
  });

  test("reads only the values that are there and not encrypted yet, in both tables", async () => {
    const calls: Array<QueryCall> = stubTables({});

    await new EncryptLetsEncryptKeys().migrate();

    const selects: Array<QueryCall> = calls.filter(
      (call: QueryCall): boolean => {
        return SELECT_START.test(call.sql);
      },
    );

    expect(
      selects.map((call: QueryCall): string => {
        return call.table;
      }),
    ).toEqual(["AcmeCertificate", "GreenlockCertificate"]);

    expect(selects[0]!.sql).toContain(`FROM "AcmeCertificate"`);
    expect(selects[0]!.sql).toContain(`"certificateKey" IS NOT NULL`);
    expect(selects[1]!.sql).toContain(`FROM "GreenlockCertificate"`);
    expect(selects[1]!.sql).toContain(`"blob" IS NOT NULL`);

    for (const select of selects) {
      expect(select.params).toEqual([`${Encryption.CIPHERTEXT_PREFIX}%`]);
    }
  });

  test("leaves an already-encrypted, empty or null value alone (idempotent)", async () => {
    const alreadyEncrypted: string = await Encryption.encrypt(CERTIFICATE_KEY);
    const calls: Array<QueryCall> = stubTables({
      AcmeCertificate: {
        rows: [
          { _id: "already", certificateKey: alreadyEncrypted },
          { _id: "empty", certificateKey: "" },
          { _id: "null", certificateKey: null },
        ],
      },
      GreenlockCertificate: {
        rows: [{ _id: "already", blob: await Encryption.encrypt("{}") }],
      },
    });

    await new EncryptLetsEncryptKeys().migrate();

    expect(updateCalls(calls)).toHaveLength(0);
  });

  test("a second run over the keys it encrypted rewrites nothing", async () => {
    const first: Array<QueryCall> = stubTables({
      AcmeCertificate: {
        rows: [{ _id: "certificate-1", certificateKey: CERTIFICATE_KEY }],
      },
    });

    await new EncryptLetsEncryptKeys().migrate();

    const encrypted: string = (
      updateCalls(first)[0]!.params as Array<string>
    )[0]!;

    jest.restoreAllMocks();
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const second: Array<QueryCall> = stubTables({
      AcmeCertificate: {
        rows: [{ _id: "certificate-1", certificateKey: encrypted }],
      },
    });

    await new EncryptLetsEncryptKeys().migrate();

    expect(updateCalls(second)).toHaveLength(0);
  });

  test("a table that cannot be read, or a row that cannot be written, costs the others nothing - and logs no key", async () => {
    const calls: Array<QueryCall> = stubTables({
      AcmeCertificate: {
        rows: [
          { _id: "bad", certificateKey: CERTIFICATE_KEY },
          { _id: "good", certificateKey: HOST_KEY },
        ],
        failUpdateForId: "bad",
      },
      GreenlockCertificate: { rows: [], failRead: true },
    });

    await expect(new EncryptLetsEncryptKeys().migrate()).resolves.toBe(
      undefined,
    );

    expect(
      updateCalls(calls).map((call: QueryCall): string => {
        return `${call.table}:${(call.params as Array<string>)[1]}`;
      }),
    ).toEqual(["AcmeCertificate:bad", "AcmeCertificate:good"]);

    expect(logger.error).toHaveBeenCalledTimes(2);

    const logged: string = JSON.stringify(
      (logger.error as unknown as jest.Mock).mock.calls,
    );

    for (const value of [CERTIFICATE_KEY, HOST_KEY, ACCOUNT_KEY_PAIR]) {
      expect(logged).not.toContain(JSON.stringify(value).slice(1, -1));
    }

    expect(logged).not.toContain("status-acme-com-certificate-key");
    expect(logged).toContain("bad");
  });

  test("rollback changes nothing", async () => {
    const calls: Array<QueryCall> = stubTables({
      AcmeCertificate: {
        rows: [{ _id: "certificate-1", certificateKey: CERTIFICATE_KEY }],
      },
    });

    await new EncryptLetsEncryptKeys().rollback();

    expect(calls).toHaveLength(0);
  });
});
