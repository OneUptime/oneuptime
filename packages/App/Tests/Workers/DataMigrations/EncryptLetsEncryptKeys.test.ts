import AcmeCertificateService from "Common/Server/Services/AcmeCertificateService";
import AcmeCertificate from "Common/Models/DatabaseModels/AcmeCertificate";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import EncryptLetsEncryptKeys from "../../../FeatureSet/Workers/DataMigrations/EncryptLetsEncryptKeys";
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
 * The private keys of the free certificates OneUptime orders from Let's
 * Encrypt (AcmeCertificate.certificateKey), stored as plaintext before the
 * column was kept encrypted at rest. The upgrade's EncryptLetsEncryptKeys
 * leaves them as written (#9266), so the ingress of the release before
 * serves them while the upgrade rolls out, and a day later the
 * CredentialsAtRest:EncryptInPlace job encrypts them in place. Pinned here,
 * with the repository stubbed so the real migrate() and the job's real pass
 * run without Postgres:
 *
 *   1. it is registered in DataMigrations/Index.ts, once, after the custom
 *      domains' keys and before the slot AddAuditLogMcpClientColumns keeps
 *      last, and the upgrade's run of it changes nothing;
 *   2. the column is declared encrypted, so what the pass writes is read
 *      back decrypted, and every later write is encrypted by the service;
 *   3. the pass encrypts a plaintext key, and the stored value decrypts back
 *      to the key nginx served before;
 *   4. each write holds to the plaintext it read, so a key renewed meanwhile
 *      is left as its renewal stored it;
 *   5. it leaves an encrypted, empty or null value alone, so a second run
 *      rewrites nothing;
 *   6. a row that cannot be written costs the others nothing, a table that
 *      cannot be read ends the run quietly - and no key is ever logged;
 *   7. it reads nothing of the Greenlock store any more, whose tables a
 *      schema migration drops before any data migration runs (#8990);
 *   8. rollback changes nothing.
 */

const MIGRATION_NAME: string = "EncryptLetsEncryptKeys";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;
const SELECT_START: RegExp = /^\s*SELECT/i;
const UPDATE_START: RegExp = /^\s*UPDATE/i;

// Stand-ins for what the table holds: the migration never parses one.
const CERTIFICATE_KEY: string =
  "-----BEGIN PRIVATE KEY-----\nstatus-acme-com-certificate-key\n-----END PRIVATE KEY-----";
const HOST_KEY: string =
  "-----BEGIN PRIVATE KEY-----\noneuptime-acme-com-host-key\n-----END PRIVATE KEY-----";

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

function stubTable(stub: TableStub): Array<QueryCall> {
  const calls: Array<QueryCall> = [];
  const table: string = "AcmeCertificate";

  jest.spyOn(AcmeCertificateService, "getRepository").mockReturnValue({
    metadata: { tableName: table },
    manager: {
      query: async (sql: string, params?: Array<unknown>): Promise<unknown> => {
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
  } as never);

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
    // Its slot, and every installation's record of it, stay as they were.
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("MoveGreenlockCertsToAcmeCerts"),
    );
  });

  test("has the name it is recorded under", () => {
    expect(new EncryptLetsEncryptKeys().name).toBe(MIGRATION_NAME);
  });

  test("the upgrade's run changes nothing: the ingress of the release before serves every key as written", async () => {
    const calls: Array<QueryCall> = stubTable({
      rows: [{ _id: "certificate-1", certificateKey: CERTIFICATE_KEY }],
    });

    await new EncryptLetsEncryptKeys().migrate();

    expect(calls).toHaveLength(0);
  });

  test("the column it encrypts is declared encrypted, so it is read back decrypted", () => {
    expect(new AcmeCertificate().getEncryptedColumns().columns).toContain(
      "certificateKey",
    );
  });

  test("encrypts a plaintext key, and each decrypts back", async () => {
    const calls: Array<QueryCall> = stubTable({
      rows: [
        { _id: "certificate-1", certificateKey: CERTIFICATE_KEY },
        { _id: "certificate-2", certificateKey: HOST_KEY },
      ],
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const updates: Array<QueryCall> = updateCalls(calls);

    expect(
      updates.map((call: QueryCall): string => {
        return `${call.table}:${(call.params as Array<string>)[1]}`;
      }),
    ).toEqual([
      "AcmeCertificate:certificate-1",
      "AcmeCertificate:certificate-2",
    ]);

    for (const [index, value] of [CERTIFICATE_KEY, HOST_KEY].entries()) {
      const [encrypted, , previous] = updates[index]!.params as [
        string,
        string,
        string,
      ];

      expect(updates[index]!.sql).toContain(`SET "certificateKey" = $1`);
      // Held to the plaintext it read: a key renewed meanwhile is left alone.
      expect(updates[index]!.sql).toContain(`AND "certificateKey" = $3`);
      expect(previous).toBe(value);
      expect(encrypted).not.toBe(value);
      expect(Encryption.looksEncrypted(encrypted)).toBe(true);
      expect(await Encryption.decrypt(encrypted)).toBe(value);
    }
  });

  test("reads only the values that are there and not encrypted yet", async () => {
    const calls: Array<QueryCall> = stubTable({ rows: [] });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const selects: Array<QueryCall> = calls.filter(
      (call: QueryCall): boolean => {
        return SELECT_START.test(call.sql);
      },
    );

    expect(selects).toHaveLength(1);
    expect(selects[0]!.sql).toContain(`FROM "AcmeCertificate"`);
    expect(selects[0]!.sql).toContain(`"certificateKey" IS NOT NULL`);
    expect(selects[0]!.params).toEqual([`${Encryption.CIPHERTEXT_PREFIX}%`]);
  });

  test("reads nothing of the Greenlock store, whose tables are dropped before it runs (#8990)", async () => {
    const calls: Array<QueryCall> = stubTable({
      rows: [{ _id: "certificate-1", certificateKey: CERTIFICATE_KEY }],
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    expect(
      calls.every((call: QueryCall): boolean => {
        return !call.sql.includes("Greenlock");
      }),
    ).toBe(true);

    const source: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, `${MIGRATION_NAME}.ts`),
      "utf8",
    );

    expect(source).not.toContain("GreenlockCertificateService");
  });

  test("leaves an already-encrypted, empty or null value alone (idempotent)", async () => {
    const alreadyEncrypted: string = await Encryption.encrypt(CERTIFICATE_KEY);
    const calls: Array<QueryCall> = stubTable({
      rows: [
        { _id: "already", certificateKey: alreadyEncrypted },
        { _id: "empty", certificateKey: "" },
        { _id: "null", certificateKey: null },
      ],
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    expect(updateCalls(calls)).toHaveLength(0);
  });

  test("a second run over the keys it encrypted rewrites nothing", async () => {
    const first: Array<QueryCall> = stubTable({
      rows: [{ _id: "certificate-1", certificateKey: CERTIFICATE_KEY }],
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    const encrypted: string = (
      updateCalls(first)[0]!.params as Array<string>
    )[0]!;

    jest.restoreAllMocks();
    jest.spyOn(logger, "info").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const second: Array<QueryCall> = stubTable({
      rows: [{ _id: "certificate-1", certificateKey: encrypted }],
    });

    await encryptInPlaceADayLater(MIGRATION_NAME);

    expect(updateCalls(second)).toHaveLength(0);
  });

  test("a row that cannot be written costs the others nothing - and logs no key", async () => {
    const calls: Array<QueryCall> = stubTable({
      rows: [
        { _id: "bad", certificateKey: CERTIFICATE_KEY },
        { _id: "good", certificateKey: HOST_KEY },
      ],
      failUpdateForId: "bad",
    });

    // Not done: the job's next run goes on.
    await expect(
      encryptInPlaceADayLater(MIGRATION_NAME),
    ).resolves.toMatchObject({
      isDone: false,
    });

    expect(
      updateCalls(calls).map((call: QueryCall): string => {
        return `${call.table}:${(call.params as Array<string>)[1]}`;
      }),
    ).toEqual(["AcmeCertificate:bad", "AcmeCertificate:good"]);

    expect(logger.error).toHaveBeenCalledTimes(1);

    const logged: string = JSON.stringify(
      (logger.error as unknown as jest.Mock).mock.calls,
    );

    for (const value of [CERTIFICATE_KEY, HOST_KEY]) {
      expect(logged).not.toContain(JSON.stringify(value).slice(1, -1));
    }

    expect(logged).not.toContain("status-acme-com-certificate-key");
    expect(logged).toContain("bad");
  });

  test("a table that cannot be read is logged, and the run ends without a write", async () => {
    const calls: Array<QueryCall> = stubTable({ rows: [], failRead: true });

    // Not done: the job's next run goes on.
    await expect(
      encryptInPlaceADayLater(MIGRATION_NAME),
    ).resolves.toMatchObject({
      isDone: false,
    });

    expect(updateCalls(calls)).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("rollback changes nothing", async () => {
    const calls: Array<QueryCall> = stubTable({
      rows: [{ _id: "certificate-1", certificateKey: CERTIFICATE_KEY }],
    });

    await new EncryptLetsEncryptKeys().rollback();

    expect(calls).toHaveLength(0);
  });
});
