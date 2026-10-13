import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(() => {
        return false;
      }),
      checkConnnectionStatus: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import Entities from "../../../Models/DatabaseModels/Index";
import ObjectID from "../../../Types/ObjectID";
import {
  OPERATOR_ENCRYPTION_SECRET,
  restoreEncryptionSecret,
  setEncryptionSecret,
} from "../TestingUtils/ShippedEncryptionSecrets";
import jwt from "jsonwebtoken";
import { DataSource } from "typeorm";

/*
 * The installation's own token signing key, as Postgres stores and hands it
 * out (InstanceTokenSigningKeyService, TokenSigningKey).
 *
 * Opt in with RUN_POSTGRES_TOKEN_SIGNING_KEY_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_TOKEN_SIGNING_KEY_TESTS=true \
 *   TOKEN_SIGNING_KEY_TEST_DATABASE_HOST=127.0.0.1 \
 *   TOKEN_SIGNING_KEY_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/InstanceTokenSigningKeyPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. It works on
 * a structure-only clone (LIKE ... INCLUDING ALL) of InstanceTokenSigningKey
 * in a uniquely named schema that is dropped afterwards.
 *
 * Each "process" is a fresh module registry booting with the given
 * ENCRYPTION_SECRET and running loadTokenSigningKey, as App/Index.ts does.
 * What it pins, as Postgres runs the statements:
 *   - the first process stores one 256-bit key, and every later one - and
 *     every restart - signs with that same key;
 *   - any number of processes starting at once all come away with one key,
 *     and the table holds one row;
 *   - a session one app process signs is accepted by every other one, and a
 *     session signed with the shipped value is accepted by none;
 *   - a damaged row fails the boot;
 *   - deleting the row makes a new key that refuses the old one's tokens;
 *   - an installation whose operator set ENCRYPTION_SECRET never writes it.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TOKEN_SIGNING_KEY_TESTS"] === "true"
    ? describe
    : describe.skip;

const HEX_KEY: RegExp = /^[0-9a-f]{64}$/;
const ZERO_ID: string = "00000000-0000-0000-0000-000000000000";

type ServiceClass =
  typeof import("../../../Server/Services/InstanceTokenSigningKeyService").default;
type TokenSigningKeyClass =
  typeof import("../../../Server/Utils/TokenSigningKey").default;
type JSONWebTokenClass =
  typeof import("../../../Server/Utils/JsonWebToken").default;

interface AppProcess {
  service: ServiceClass;
  TokenSigningKey: TokenSigningKeyClass;
  JSONWebToken: JSONWebTokenClass;
}

describePostgres("The installation's token signing key on Postgres", () => {
  const schema: string = `token_signing_key_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;

  // A process of this installation, started with this ENCRYPTION_SECRET.
  async function startProcess(
    encryptionSecret: string | undefined,
  ): Promise<AppProcess> {
    setEncryptionSecret(encryptionSecret);
    jest.resetModules();

    const PostgresAppInstance: {
      isConnected: () => boolean;
      getDataSource: () => DataSource | null;
    } = (await import("../../../Server/Infrastructure/PostgresDatabase"))
      .default as never;

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    return {
      service: (
        await import("../../../Server/Services/InstanceTokenSigningKeyService")
      ).default,
      TokenSigningKey: (await import("../../../Server/Utils/TokenSigningKey"))
        .default,
      JSONWebToken: (await import("../../../Server/Utils/JsonWebToken"))
        .default,
    };
  }

  async function bootProcess(
    encryptionSecret: string | undefined,
  ): Promise<AppProcess> {
    const appProcess: AppProcess = await startProcess(encryptionSecret);
    await appProcess.service.loadTokenSigningKey();
    return appProcess;
  }

  async function storedRows(): Promise<
    Array<{ _id: string; signingKey: string }>
  > {
    return await database.query(
      `SELECT "_id", "signingKey" FROM "${schema}"."InstanceTokenSigningKey"`,
    );
  }

  function verifies(appProcess: AppProcess, token: string): boolean {
    try {
      appProcess.JSONWebToken.decode(token);
      return true;
    } catch {
      return false;
    }
  }

  function masterAdminSession(key: string): string {
    return jwt.sign(
      {
        userId: "deadbeef-dead-4eef-8ead-beefdeadbeef",
        email: "nobody@example.com",
        name: "Nobody",
        isMasterAdmin: true,
        isGlobalLogin: true,
        sessionId: ZERO_ID,
      },
      key,
      { expiresIn: 15 * 60 },
    );
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["TOKEN_SIGNING_KEY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["TOKEN_SIGNING_KEY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["TOKEN_SIGNING_KEY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."InstanceTokenSigningKey" (LIKE public."InstanceTokenSigningKey" INCLUDING ALL)`,
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "${schema}"."InstanceTokenSigningKey"`);
  });

  afterEach(() => {
    restoreEncryptionSecret();
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test("the first process stores one 256-bit key in the one fixed row, and signs with it", async () => {
    const appProcess: AppProcess = await bootProcess(
      "please-change-this-to-random-value",
    );

    const rows: Array<{ _id: string; signingKey: string }> = await storedRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]!._id).toBe(ZERO_ID);
    expect(rows[0]!.signingKey).toMatch(HEX_KEY);
    expect(appProcess.TokenSigningKey.get()).toBe(rows[0]!.signingKey);
  });

  test("a restart signs with the key it had, and stores nothing new", async () => {
    const first: AppProcess = await bootProcess(undefined);
    const firstKey: string = first.TokenSigningKey.get();

    const afterRestart: AppProcess = await bootProcess(undefined);

    expect(afterRestart.TokenSigningKey.get()).toBe(firstKey);
    expect(await storedRows()).toHaveLength(1);
  });

  test("processes starting at once all come away with one key (multi-replica)", async () => {
    const appProcess: AppProcess = await startProcess(
      "please-change-this-to-random-value",
    );

    // Several fresh installations, each with 25 processes racing to store.
    for (let round: number = 0; round < 5; round++) {
      await database.query(`DELETE FROM "${schema}"."InstanceTokenSigningKey"`);

      const keys: Array<string> = await Promise.all(
        Array.from({ length: 25 }, () => {
          return appProcess.service.getOrCreateKey();
        }),
      );

      const rows: Array<{ _id: string; signingKey: string }> =
        await storedRows();

      expect({ round, keys: new Set(keys).size, rows: rows.length }).toEqual({
        round,
        keys: 1,
        rows: 1,
      });
      expect(keys[0]).toBe(rows[0]!.signingKey);
    }
  });

  test("a session one app process signs is accepted by another, and one signed with the shipped value by neither", async () => {
    const api: AppProcess = await bootProcess(
      "please-change-this-to-random-value",
    );
    const worker: AppProcess = await bootProcess(
      "please-change-this-to-random-value",
    );

    const signedByTheApi: string = api.JSONWebToken.signJsonPayload(
      {
        userId: "11111111-1111-4111-8111-111111111111",
        email: "member@example.com",
      },
      60,
    );

    expect(verifies(worker, signedByTheApi)).toBe(true);

    for (const shipped of ["please-change-this-to-random-value", "secret"]) {
      const forged: string = masterAdminSession(shipped);

      expect({ shipped, api: verifies(api, forged) }).toEqual({
        shipped,
        api: false,
      });
      expect({ shipped, worker: verifies(worker, forged) }).toEqual({
        shipped,
        worker: false,
      });
    }
  });

  test("a damaged row fails the boot instead of becoming the signing key", async () => {
    await bootProcess(undefined);
    await database.query(
      `UPDATE "${schema}"."InstanceTokenSigningKey" SET "signingKey" = 'please-change-this-to-random-value'`,
    );

    const appProcess: AppProcess = await startProcess(undefined);

    await expect(appProcess.service.loadTokenSigningKey()).rejects.toThrow(
      "no well-formed token signing key",
    );
    expect(appProcess.TokenSigningKey.isInstallationKeyLoaded()).toBe(false);
  });

  test("deleting the row makes a new key, which refuses what the old one signed", async () => {
    const before: AppProcess = await bootProcess(undefined);
    const signedBefore: string = masterAdminSession(
      before.TokenSigningKey.get(),
    );

    await database.query(`DELETE FROM "${schema}"."InstanceTokenSigningKey"`);

    const after: AppProcess = await bootProcess(undefined);

    expect(after.TokenSigningKey.get()).not.toBe(before.TokenSigningKey.get());
    expect(verifies(after, signedBefore)).toBe(false);
  });

  test("an installation whose operator set ENCRYPTION_SECRET never writes the table", async () => {
    const appProcess: AppProcess = await bootProcess(
      OPERATOR_ENCRYPTION_SECRET,
    );

    expect(appProcess.TokenSigningKey.get()).toBe(OPERATOR_ENCRYPTION_SECRET);
    expect(await storedRows()).toEqual([]);
  });
});
