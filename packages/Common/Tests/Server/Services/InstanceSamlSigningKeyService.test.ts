import InstanceSamlSigningKeyService, {
  INSTANCE_SAML_SIGNING_KEY_ROW_ID,
  SAML_SIGNING_CERTIFICATE_COMMON_NAME,
  UNUSABLE_SAML_SIGNING_KEY_MESSAGE,
} from "../../../Server/Services/InstanceSamlSigningKeyService";
import Encryption from "../../../Server/Utils/Encryption";
import SelfSignedCertificate, {
  SelfSignedKeyPair,
} from "../../../Server/Utils/SelfSignedCertificate";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import crypto from "crypto";

jest.mock("../../../Server/Utils/Logger");

/*
 * ---------------------------------------------------------------------------
 * ONE SAML SIGNING KEY PAIR PER INSTALLATION, MADE BY WHICHEVER PROCESS
 * NEEDS IT FIRST (#9603).
 *
 * Identity providers pin the certificate an admin gave them, so every
 * OneUptime process, and every restart, must sign with the same key:
 * InstanceSamlSigningKeyService reads the one row, and makes it - with an
 * INSERT that does nothing when another process stored one first - only
 * when there is none, then reads what was stored. The private key is
 * stored encrypted. A row that holds no usable key pair is refused, never
 * signed with. Postgres is a stand-in here that keeps one row and settles
 * the insert as ON CONFLICT DO NOTHING does.
 * ---------------------------------------------------------------------------
 */

interface StoredRow {
  privateKey: unknown;
  certificate: unknown;
}

const database: {
  row: StoredRow | null;
  statements: Array<{ sql: string; parameters: Array<unknown> }>;
  // A row another process stores while this one makes its key.
  storedMeanwhile: StoredRow | null;
} = { row: null, statements: [], storedMeanwhile: null };

let stored: SelfSignedKeyPair;

beforeAll(async () => {
  stored = await SelfSignedCertificate.create({
    commonName: SAML_SIGNING_CERTIFICATE_COMMON_NAME,
    validForDays: 365,
  });
});

beforeEach(() => {
  database.row = null;
  database.statements = [];
  database.storedMeanwhile = null;
  InstanceSamlSigningKeyService.forgetKeyPairForTests();

  jest.spyOn(InstanceSamlSigningKeyService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        database.statements.push({ sql, parameters });

        if (sql.trim().startsWith("SELECT")) {
          expect(parameters).toEqual([INSTANCE_SAML_SIGNING_KEY_ROW_ID]);
          return database.row ? [database.row] : [];
        }

        if (sql.trim().startsWith("INSERT")) {
          if (database.storedMeanwhile) {
            database.row = database.storedMeanwhile;
          }

          if (!database.row) {
            database.row = {
              privateKey: parameters[1],
              certificate: parameters[2],
            };
          }

          return [];
        }

        throw new Error(`Unexpected statement: ${sql}`);
      },
    },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  InstanceSamlSigningKeyService.forgetKeyPairForTests();
});

async function storeEncrypted(keyPair: SelfSignedKeyPair): Promise<void> {
  database.row = {
    privateKey: await Encryption.encrypt(keyPair.privateKey),
    certificate: keyPair.certificate,
  };
}

describe("InstanceSamlSigningKeyService.getKeyPair", () => {
  test("reads the stored key pair, decrypting its private key, and makes none", async () => {
    await storeEncrypted(stored);

    await expect(InstanceSamlSigningKeyService.getKeyPair()).resolves.toEqual(
      stored,
    );

    expect(
      database.statements.filter((statement: { sql: string }): boolean => {
        return statement.sql.includes("INSERT");
      }),
    ).toHaveLength(0);
  });

  test("with none stored, makes one, stores it with its private key encrypted, and reads back what was stored", async () => {
    const keyPair: SelfSignedKeyPair =
      await InstanceSamlSigningKeyService.getKeyPair();

    const insert: { sql: string; parameters: Array<unknown> } =
      database.statements.find((statement: { sql: string }): boolean => {
        return statement.sql.includes("INSERT");
      })!;

    expect(insert.sql).toContain('INSERT INTO "InstanceSamlSigningKey"');
    expect(insert.sql).toContain('ON CONFLICT ("_id") DO NOTHING');
    expect(insert.parameters[0]).toBe(INSTANCE_SAML_SIGNING_KEY_ROW_ID);
    expect(INSTANCE_SAML_SIGNING_KEY_ROW_ID).toBe(
      ObjectID.getZeroObjectID().toString(),
    );

    // Kept encrypted: the stored text is the cipher, not the key.
    expect(Encryption.looksEncrypted(insert.parameters[1] as string)).toBe(
      true,
    );
    expect(insert.parameters[1]).not.toContain("PRIVATE KEY");
    expect(await Encryption.decrypt(insert.parameters[1] as string)).toBe(
      keyPair.privateKey,
    );

    // The certificate is public, and stored as it is.
    expect(insert.parameters[2]).toBe(keyPair.certificate);

    const certificate: crypto.X509Certificate = new crypto.X509Certificate(
      keyPair.certificate,
    );

    expect(certificate.subject).toBe(
      `CN=${SAML_SIGNING_CERTIFICATE_COMMON_NAME}`,
    );
    expect(
      certificate.checkPrivateKey(crypto.createPrivateKey(keyPair.privateKey)),
    ).toBe(true);
  });

  test("the certificate is valid already, and for twenty years", async () => {
    const before: number = Date.now();
    const keyPair: SelfSignedKeyPair =
      await InstanceSamlSigningKeyService.getKeyPair();
    const certificate: crypto.X509Certificate = new crypto.X509Certificate(
      keyPair.certificate,
    );

    expect(new Date(certificate.validFrom).getTime()).toBeLessThan(before);
    expect(new Date(certificate.validTo).getTime()).toBeGreaterThan(
      before + 19 * 365 * 24 * 60 * 60 * 1000,
    );
  });

  test("a key pair another process stored first is the one every process signs with", async () => {
    database.storedMeanwhile = {
      privateKey: await Encryption.encrypt(stored.privateKey),
      certificate: stored.certificate,
    };

    await expect(InstanceSamlSigningKeyService.getKeyPair()).resolves.toEqual(
      stored,
    );
  });

  test("is read once per process: callers at once share the read, and later ones the answer", async () => {
    await storeEncrypted(stored);

    const all: Array<SelfSignedKeyPair> = await Promise.all([
      InstanceSamlSigningKeyService.getKeyPair(),
      InstanceSamlSigningKeyService.getKeyPair(),
      InstanceSamlSigningKeyService.getKeyPair(),
    ]);

    await InstanceSamlSigningKeyService.getKeyPair();

    expect(
      new Set(
        all.map((pair: SelfSignedKeyPair) => {
          return pair.privateKey;
        }),
      ).size,
    ).toBe(1);
    expect(database.statements).toHaveLength(1);
  });

  test("a private key stored before it was encrypted still reads", async () => {
    database.row = {
      privateKey: stored.privateKey,
      certificate: stored.certificate,
    };

    await expect(InstanceSamlSigningKeyService.getKeyPair()).resolves.toEqual(
      stored,
    );
  });

  test.each([
    [
      "a certificate of another key",
      async (): Promise<StoredRow> => {
        const other: SelfSignedKeyPair = await SelfSignedCertificate.create({
          commonName: "Another",
          validForDays: 1,
        });

        return {
          privateKey: await Encryption.encrypt(stored.privateKey),
          certificate: other.certificate,
        };
      },
    ],
    [
      "a private key that is not one",
      async (): Promise<StoredRow> => {
        return {
          privateKey: await Encryption.encrypt("not a key"),
          certificate: stored.certificate,
        };
      },
    ],
    [
      "a certificate that is not one",
      async (): Promise<StoredRow> => {
        return {
          privateKey: await Encryption.encrypt(stored.privateKey),
          certificate: "not a certificate",
        };
      },
    ],
    [
      "no text at all",
      async (): Promise<StoredRow> => {
        return { privateKey: null, certificate: null };
      },
    ],
  ])(
    "a row that holds %s is refused, never signed with",
    async (_: string, row: () => Promise<StoredRow>) => {
      database.row = await row();

      await expect(InstanceSamlSigningKeyService.getKeyPair()).rejects.toThrow(
        UNUSABLE_SAML_SIGNING_KEY_MESSAGE,
      );
    },
  );

  test("a refused read is not kept: the next asks again", async () => {
    database.row = { privateKey: null, certificate: null };

    await expect(InstanceSamlSigningKeyService.getKeyPair()).rejects.toThrow();

    await storeEncrypted(stored);

    await expect(InstanceSamlSigningKeyService.getKeyPair()).resolves.toEqual(
      stored,
    );
  });

  test("the certificate alone, for anyone to download", async () => {
    await storeEncrypted(stored);

    await expect(InstanceSamlSigningKeyService.getCertificate()).resolves.toBe(
      stored.certificate,
    );
  });
});
