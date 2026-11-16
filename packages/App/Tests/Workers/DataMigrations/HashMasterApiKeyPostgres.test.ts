import HashMasterApiKey from "../../../FeatureSet/Workers/DataMigrations/HashMasterApiKey";
import Entities from "Common/Models/DatabaseModels/Index";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { MasterApiKeyHashedColumn1809180790100 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809180790100-MasterApiKeyHashedColumn";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import ProjectMiddleware from "Common/Server/Middleware/ProjectAuthorization";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import DatabaseService from "Common/Server/Services/DatabaseService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import MasterApiKey from "Common/Server/Utils/MasterApiKey";
import Response from "Common/Server/Utils/Response";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { DataSource, QueryRunner } from "Common/node_modules/typeorm";

/*
 * THE MASTER API KEY THROUGH THE UPGRADE THAT HASHES IT, ON A REAL POSTGRES
 * (#7901).
 *
 * The server's master API key was stored as it was written, in a uuid
 * column. The upgrade turns the column into a varchar
 * (1809180790100-MasterApiKeyHashedColumn), and the HashMasterApiKey data
 * migration writes the key's hash in place of the key. Every script and
 * integration that uses the key must keep working throughout, with the key
 * as it was written. On the server's settings table as it was before the
 * upgrade, with a key stored the old way:
 *
 *   - the API takes the key before the schema migration, after it, and
 *     after the data migration - written as it was, or upper-cased - and
 *     refuses any other key all along;
 *   - the schema migration keeps the key; the data migration leaves only
 *     its hash, and a second run changes nothing;
 *   - a key made afterwards (Reset Key) is stored as its hash, works, and
 *     the key before it stops working; nothing stored is ever the key;
 *   - a master admin's read through the generic API gets neither the key
 *     nor its hash, and their write of it is refused;
 *   - turned off, the key is refused;
 *   - rolled back, the column is a uuid again and a hashed key is cleared:
 *     the key cannot be worked out from its hash.
 *
 * Opt in with RUN_POSTGRES_MASTER_API_KEY_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database, right after its drift check. The GlobalConfig, User and ApiKey
 * tables' STRUCTURE is cloned into a unique schema (search_path holds only
 * that schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from MASTER_API_KEY_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from MASTER_API_KEY_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MASTER_API_KEY_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const ZERO_ID: string = ObjectID.getZeroObjectID().toString();

// The key as an admin generated it, before keys were hashed.
const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const OTHER_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";

interface StoredKey {
  masterApiKey: string | null;
  type: string;
}

// How the API's one door answered a request with a key.
interface DoorAnswer {
  error: unknown;
  request: OneUptimeRequest;
}

describePostgres("the master API key through its upgrade (Postgres)", () => {
  const schema: string = `master_api_key_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  const masterAdminId: ObjectID = ObjectID.generate();

  let database: DataSource;
  // The key Reset Key made, once it has.
  let resetKey: string = "";

  async function withRunner(
    work: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();

    try {
      await work(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function stored(): Promise<StoredKey> {
    const rows: Array<StoredKey> = await database.query(
      `SELECT "masterApiKey"::text AS "masterApiKey", pg_typeof("masterApiKey")::text AS "type" FROM "${schema}"."GlobalConfig" WHERE "_id" = $1`,
      [ZERO_ID],
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  async function setEnabled(isEnabled: boolean): Promise<void> {
    await database.query(
      `UPDATE "${schema}"."GlobalConfig" SET "isMasterApiKeyEnabled" = $1 WHERE "_id" = $2`,
      [isEnabled, ZERO_ID],
    );
  }

  // A request with the key through the one door every API-key request walks.
  async function callApi(key: string): Promise<DoorAnswer> {
    const request: OneUptimeRequest = {
      headers: { apikey: key },
      params: {},
      query: {},
      body: {},
    } as unknown as OneUptimeRequest;
    let error: unknown = "next was never called";

    await ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
      request as unknown as ExpressRequest,
      {} as ExpressResponse,
      ((err?: unknown) => {
        error = err;
      }) as NextFunction,
    );

    return { error, request };
  }

  async function expectAccepted(key: string): Promise<void> {
    const answer: DoorAnswer = await callApi(key);

    expect(answer.error).toBeUndefined();
    expect(answer.request.userType).toBe(UserType.MasterAdmin);
    expect(answer.request.userAuthorization?.userId.toString()).toBe(
      masterAdminId.toString(),
    );
    expect(answer.request.apiKeyName).toBe(
      ProjectMiddleware.MASTER_API_KEY_AUDIT_NAME,
    );
  }

  async function expectRefused(key: string): Promise<void> {
    const answer: DoorAnswer = await callApi(key);

    expect((answer.error as Error | undefined)?.message).toBe(
      "Invalid API Key",
    );
    expect(answer.request.userType).toBeUndefined();
  }

  // The read-only master-admin routes (OneUptime Health) take the key too.
  async function expectHealthRoutesTake(key: string): Promise<boolean> {
    let isPassed: boolean = false;

    await MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
      { headers: { apikey: key }, cookies: {} } as unknown as ExpressRequest,
      {} as ExpressResponse,
      (() => {
        isPassed = true;
      }) as NextFunction,
    );

    return isPassed;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["MASTER_API_KEY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["MASTER_API_KEY_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MASTER_API_KEY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of ["GlobalConfig", "User", "ApiKey"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // The settings table as it was before the upgrade: a uuid column.
    await withRunner(async (queryRunner: QueryRunner) => {
      await new MasterApiKeyHashedColumn1809180790100().down(queryRunner);
    });

    // The key as the Admin Dashboard stored it then, turned on.
    await database.query(
      `INSERT INTO "${schema}"."GlobalConfig" ("_id", "version", "masterApiKey", "isMasterApiKeyEnabled") VALUES ($1, 1, $2, true)`,
      [ZERO_ID, KEY],
    );

    // The master admin a request with the key acts as.
    await database.query(
      `INSERT INTO "${schema}"."User" ("_id", "version", "email", "slug", "name", "isMasterAdmin") VALUES ($1, 1, $2, $3, $4, true)`,
      [
        masterAdminId.toString(),
        `admin-${masterAdminId.toString()}@example.com`,
        `admin-${masterAdminId.toString()}`,
        "Ada Admin",
      ],
    );
  }, 120000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest
      .spyOn(PostgresAppInstance, "getDataSource")
      .mockReturnValue(database as never);

    // Live updates and workflows are not what this is about.
    jest
      .spyOn(DatabaseService.prototype, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);

    // A request with the key carries no session.
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "none" } as never);
    jest
      .spyOn(Response, "sendErrorResponse")
      .mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("before the upgrade: the column is a uuid, and the API takes the key as written", async () => {
    expect(await stored()).toEqual({ masterApiKey: KEY, type: "uuid" });

    await expectAccepted(KEY);
    await expectAccepted(KEY.toUpperCase());
    await expectRefused(OTHER_KEY);
    expect(await expectHealthRoutesTake(KEY)).toBe(true);
    expect(await expectHealthRoutesTake(OTHER_KEY)).toBe(false);
  });

  test("the schema migration keeps the key, as its text, and the API still takes it", async () => {
    await withRunner(async (queryRunner: QueryRunner) => {
      await new MasterApiKeyHashedColumn1809180790100().up(queryRunner);
    });

    expect(await stored()).toEqual({
      masterApiKey: KEY,
      type: "character varying",
    });

    await expectAccepted(KEY);
    await expectAccepted(KEY.toUpperCase());
    await expectRefused(OTHER_KEY);
  });

  test("the data migration leaves only the key's hash, and the API still takes the key as written", async () => {
    await new HashMasterApiKey().migrate();

    const afterHash: StoredKey = await stored();

    expect(afterHash.masterApiKey).toBe(MasterApiKey.hash(KEY));
    expect(afterHash.masterApiKey).not.toContain(KEY);
    expect(MasterApiKey.isStoredAsWritten(afterHash.masterApiKey!)).toBe(false);

    await expectAccepted(KEY);
    await expectAccepted(KEY.toUpperCase());
    await expectRefused(OTHER_KEY);
    // The hash itself is no key.
    await expectRefused(MasterApiKey.hash(KEY));
    expect(await expectHealthRoutesTake(KEY)).toBe(true);
  });

  test("run again, the data migration changes nothing", async () => {
    await new HashMasterApiKey().migrate();

    expect((await stored()).masterApiKey).toBe(MasterApiKey.hash(KEY));
    await expectAccepted(KEY);
  });

  test("a master admin reads the settings through the API without the key or its hash", async () => {
    const masterAdmin: DatabaseCommonInteractionProps = {
      userId: masterAdminId,
      isMasterAdmin: true,
    } as DatabaseCommonInteractionProps;

    const config: GlobalConfig | null = await GlobalConfigService.findOneById({
      id: ObjectID.getZeroObjectID(),
      select: { masterApiKey: true, isMasterApiKeyEnabled: true },
      props: masterAdmin,
    });

    expect(config?.isMasterApiKeyEnabled).toBe(true);
    expect(config?.masterApiKey).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain(MasterApiKey.hash(KEY));
  });

  test("and cannot write a key of their own choosing", async () => {
    await expect(
      GlobalConfigService.updateOneById({
        id: ObjectID.getZeroObjectID(),
        data: { masterApiKey: OTHER_KEY } as never,
        props: {
          userId: masterAdminId,
          isMasterAdmin: true,
        } as DatabaseCommonInteractionProps,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect((await stored()).masterApiKey).toBe(MasterApiKey.hash(KEY));
    await expectRefused(OTHER_KEY);
  });

  test("a key made by Reset Key is stored as its hash and works; the key before it stops working", async () => {
    await setEnabled(false);

    resetKey = await GlobalConfigService.createMasterApiKey();
    const afterReset: StoredKey = await stored();

    expect(afterReset.masterApiKey).toBe(MasterApiKey.hash(resetKey));
    expect(afterReset.masterApiKey).not.toContain(resetKey);
    expect(await GlobalConfigService.getMasterApiKeyState()).toEqual({
      isSet: true,
      isEnabled: true,
    });

    await expectAccepted(resetKey);
    await expectRefused(KEY);
  });

  test("turned off, the key is refused, and turned on again it works", async () => {
    await setEnabled(false);

    expect((await stored()).masterApiKey).toBe(MasterApiKey.hash(resetKey));
    expect(await GlobalConfigService.getMasterApiKeyState()).toEqual({
      isSet: true,
      isEnabled: false,
    });
    await expectRefused(resetKey);
    expect(await expectHealthRoutesTake(resetKey)).toBe(false);

    await setEnabled(true);

    await expectAccepted(resetKey);
  });

  test("rolled back, the column is a uuid again and the hashed key is cleared", async () => {
    await withRunner(async (queryRunner: QueryRunner) => {
      await new MasterApiKeyHashedColumn1809180790100().down(queryRunner);
    });

    expect(await stored()).toEqual({ masterApiKey: null, type: "uuid" });
  });

  test("while a key not hashed yet is kept by the roll back", async () => {
    await withRunner(async (queryRunner: QueryRunner) => {
      await new MasterApiKeyHashedColumn1809180790100().up(queryRunner);
    });
    await database.query(
      `UPDATE "${schema}"."GlobalConfig" SET "masterApiKey" = $1 WHERE "_id" = $2`,
      [KEY, ZERO_ID],
    );
    await withRunner(async (queryRunner: QueryRunner) => {
      await new MasterApiKeyHashedColumn1809180790100().down(queryRunner);
    });

    expect(await stored()).toEqual({ masterApiKey: KEY, type: "uuid" });

    // Left as the schema stands now, for whoever reads the schema next.
    await withRunner(async (queryRunner: QueryRunner) => {
      await new MasterApiKeyHashedColumn1809180790100().up(queryRunner);
    });
  });
});
