import HashProjectApiKeys from "../../../FeatureSet/Workers/DataMigrations/HashProjectApiKeys";
import { digestOfValueRead } from "../../../FeatureSet/Workers/DataMigrations/HashMasterApiKey";
import Entities from "Common/Models/DatabaseModels/Index";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import { ApiKeyHashedColumn1809181100000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809181100000-ApiKeyHashedColumn";
import { AddMasterApiKeyCreatedByAndHint1809181200000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809181200000-AddMasterApiKeyCreatedByAndHint";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import ProjectMiddleware from "Common/Server/Middleware/ProjectAuthorization";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ApiKeyService, {
  API_KEY_WRITTEN_HERE_MESSAGE,
  MadeApiKey,
} from "Common/Server/Services/ApiKeyService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import APIKeyAccessPermission from "Common/Server/Utils/APIKey/AccessPermission";
import HashedApiKey from "Common/Server/Utils/APIKey/HashedApiKey";
import PlanCutoffCredentialAccess from "Common/Server/Utils/Billing/PlanCutoffCredentialAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import HashedString from "Common/Types/HashedString";
import { MasterApiKeyState } from "Common/Types/MasterApiKey/MasterApiKeyAnswer";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { DataSource, QueryRunner } from "Common/node_modules/typeorm";

/*
 * A PROJECT'S API KEYS THROUGH THE UPGRADE THAT HASHES THEM, ON A REAL
 * POSTGRES (#8902), and the master API key's record of which key it is
 * (#8903).
 *
 * A project's API keys were stored as they were written, in a uuid column.
 * The upgrade turns the column into a varchar and adds a hint column
 * (1809181100000-ApiKeyHashedColumn), and the HashProjectApiKeys data
 * migration writes each key's hash and hint in place of the key. Every
 * script, integration and Terraform configuration that uses a key must
 * keep working throughout, with the key as it was written. On the ApiKey
 * table as it was before the upgrade, with keys stored the old way:
 *
 *   - the API takes a key before the schema migration (a server that did
 *     not wait for it), after it, and after the data migration - written
 *     as it was, or upper-cased - and refuses any other key all along;
 *   - the schema migration keeps every key and its index; the data
 *     migration leaves only hashes, with hints - a deleted key's too - and
 *     a second run changes nothing;
 *   - once every key is hashed, no key a request presents goes into a
 *     query, nor into its parameters;
 *   - a master admin's read gets neither key nor hash, and a write of a
 *     key of their choosing is refused;
 *   - a reset stores the new key's hash: the new key works, the old one
 *     stops; a key created now is answered once and stored as its hash;
 *   - the master API key made by a master admin says when, by whom and
 *     how it ends;
 *   - rolled back, the key column is a uuid again: each hashed key a new
 *     random one, a key not hashed yet kept.
 *
 * Opt in with RUN_POSTGRES_PROJECT_API_KEY_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database, right after its drift check. The ApiKey, GlobalConfig and User
 * tables' STRUCTURE is cloned into a unique schema (search_path holds only
 * that schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from PROJECT_API_KEY_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from PROJECT_API_KEY_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PROJECT_API_KEY_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const ZERO_ID: string = ObjectID.getZeroObjectID().toString();
const PROJECT_ID: string = "0d000000-0000-4000-8000-000000000001";
const KEY_ROW_ID: string = "0d000000-0000-4000-8000-000000000002";
const DELETED_ROW_ID: string = "0d000000-0000-4000-8000-000000000003";

// The keys as the Dashboard made them then, stored as they were written.
const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const DELETED_KEY: string = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_KEY: string = "1c9d7f40-2b83-4a55-8e70-6d4b9a0c3e12";

interface StoredKey {
  apiKey: string | null;
  type: string;
}

// How the API's one door answered a request with a key.
interface DoorAnswer {
  error: unknown;
  request: OneUptimeRequest;
}

// What a statement sent to Postgres was, as TypeORM's logger hears it.
interface SentQuery {
  query: string;
  parameters: Array<unknown> | undefined;
}

describePostgres(
  "a project's API keys through their upgrade (Postgres)",
  () => {
    const schema: string = `project_api_keys_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    const masterAdminId: ObjectID = ObjectID.generate();

    let database: DataSource;
    const sent: Array<SentQuery> = [];
    // The key a reset made, once one has.
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

    async function stored(id: string = KEY_ROW_ID): Promise<StoredKey> {
      const rows: Array<StoredKey> = await database.query(
        `SELECT "apiKey"::text AS "apiKey", pg_typeof("apiKey")::text AS "type" FROM "${schema}"."ApiKey" WHERE "_id" = $1`,
        [id],
      );

      expect(rows).toHaveLength(1);

      return rows[0]!;
    }

    async function storedHint(id: string = KEY_ROW_ID): Promise<string | null> {
      const rows: Array<{ apiKeyHint: string | null }> = await database.query(
        `SELECT "apiKeyHint" FROM "${schema}"."ApiKey" WHERE "_id" = $1`,
        [id],
      );

      return rows[0]!.apiKeyHint;
    }

    async function columnsOf(table: string): Promise<Array<string>> {
      const rows: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [schema, table],
      );

      return rows.map((row: { column_name: string }): string => {
        return row.column_name;
      });
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

    async function expectAccepted(
      key: string,
      rowId: string = KEY_ROW_ID,
    ): Promise<void> {
      const answer: DoorAnswer = await callApi(key);

      expect(answer.error).toBeUndefined();
      expect(answer.request.userType).toBe(UserType.API);
      expect(answer.request.apiKeyId?.toString()).toBe(rowId);
      expect(answer.request.tenantId?.toString()).toBe(PROJECT_ID);
    }

    async function expectRefused(key: string): Promise<void> {
      const answer: DoorAnswer = await callApi(key);

      expect((answer.error as Error | undefined)?.message).toBe(
        "Invalid API Key",
      );
      expect(answer.request.userType).toBeUndefined();
    }

    // Forgets what the service learned: a fresh server, every test.
    function forgetLookups(): void {
      (
        ApiKeyService as unknown as { apiKeyCache: { clear: () => void } }
      ).apiKeyCache.clear();
      (
        ApiKeyService as unknown as { keysStoredAsWritten: unknown }
      ).keysStoredAsWritten = null;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["PROJECT_API_KEY_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["PROJECT_API_KEY_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PROJECT_API_KEY_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: ["query"],
        logger: {
          logQuery: (query: string, parameters?: Array<unknown>): void => {
            sent.push({ query, parameters });
          },
          logQueryError: (): void => {},
          logQuerySlow: (): void => {},
          logSchemaBuild: (): void => {},
          logMigration: (): void => {},
          log: (): void => {},
        },
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of ["ApiKey", "GlobalConfig", "User"]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // The keys table as it was before the upgrade: a uuid column, no hint.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new ApiKeyHashedColumn1809181100000().down(queryRunner);
      });

      // A key as the Dashboard made it then, and one deleted since.
      for (const [id, key, deletedAt] of [
        [KEY_ROW_ID, KEY, null],
        [DELETED_ROW_ID, DELETED_KEY, new Date()],
      ] as Array<[string, string, Date | null]>) {
        await database.query(
          `INSERT INTO "${schema}"."ApiKey" ("_id", "version", "projectId", "name", "slug", "expiresAt", "apiKey", "deletedAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            PROJECT_ID,
            `Key ${id.slice(-1)}`,
            `key-${id}`,
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            key,
            deletedAt,
          ],
        );
      }

      // The server's settings, with no master API key, and its master admin.
      await database.query(
        `INSERT INTO "${schema}"."GlobalConfig" ("_id", "version", "isMasterApiKeyEnabled") VALUES ($1, 1, false)`,
        [ZERO_ID],
      );
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
      for (const level of ["debug", "info", "warn", "error"] as const) {
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

      /*
       * What the door asks of a key once it is found - the project not
       * blocked, on its plan, and what the key may do - is not what this is
       * about either: the lookup is.
       */
      jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
      jest
        .spyOn(PlanCutoffCredentialAccess, "getRefusal")
        .mockResolvedValue(null);
      jest
        .spyOn(APIKeyAccessPermission, "getDefaultApiGlobalPermission")
        .mockResolvedValue({} as never);
      jest
        .spyOn(APIKeyAccessPermission, "getApiTenantAccessPermission")
        .mockResolvedValue({ projectId: PROJECT_ID, permissions: [] } as never);

      // A request with a key carries no session.
      jest
        .spyOn(UserMiddleware, "readRequestSession")
        .mockResolvedValue({ kind: "none" } as never);
      jest
        .spyOn(Response, "sendErrorResponse")
        .mockImplementation((): void => {});

      forgetLookups();
      sent.length = 0;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("before the upgrade: the column is a uuid, and the API takes the key as written - on a server that did not wait for the schema migration", async () => {
      expect(await stored()).toEqual({ apiKey: KEY, type: "uuid" });
      expect(await columnsOf("ApiKey")).not.toContain("apiKeyHint");

      await expectAccepted(KEY);
      await expectAccepted(KEY.toUpperCase());
      await expectRefused(OTHER_KEY);
      // A deleted key works no more than it did.
      await expectRefused(DELETED_KEY);
    });

    test("the schema migration keeps every key, as its text, and its index; the API still takes the key", async () => {
      await withRunner(async (queryRunner: QueryRunner) => {
        await new ApiKeyHashedColumn1809181100000().up(queryRunner);
      });

      expect(await stored()).toEqual({
        apiKey: KEY,
        type: "character varying",
      });
      expect(await stored(DELETED_ROW_ID)).toEqual({
        apiKey: DELETED_KEY,
        type: "character varying",
      });
      expect(await storedHint()).toBeNull();

      const indexes: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'ApiKey'`,
        [schema],
      );

      expect(
        indexes.some((index: { indexdef: string }): boolean => {
          return index.indexdef.includes(`("apiKey")`);
        }),
      ).toBe(true);

      await expectAccepted(KEY);
      await expectAccepted(KEY.toUpperCase());
      await expectRefused(OTHER_KEY);
    });

    test("Postgres digests a key as the data migration does, so its compare-and-set matches the key read", async () => {
      const rows: Array<{ digest: string }> = await database.query(
        `SELECT encode(sha256(convert_to("apiKey", 'UTF8')), 'hex') AS "digest" FROM "${schema}"."ApiKey" WHERE "_id" = $1`,
        [KEY_ROW_ID],
      );

      expect(rows).toEqual([{ digest: digestOfValueRead(KEY) }]);
    });

    test("the data migration leaves only hashes, with their hints - a deleted key's too - and the API still takes the key as written", async () => {
      await new HashProjectApiKeys().migrate();

      const afterHash: StoredKey = await stored();

      expect(afterHash.apiKey).toBe(HashedApiKey.hash(KEY));
      expect(afterHash.apiKey).not.toContain(KEY);
      expect(await storedHint()).toBe("2b34");
      expect((await stored(DELETED_ROW_ID)).apiKey).toBe(
        HashedApiKey.hash(DELETED_KEY),
      );
      expect(await storedHint(DELETED_ROW_ID)).toBe("3c4d");

      await expectAccepted(KEY);
      await expectAccepted(KEY.toUpperCase());
      await expectRefused(OTHER_KEY);
      // The hash itself is no key.
      await expectRefused(HashedApiKey.hash(KEY));
      await expectRefused(DELETED_KEY);
    });

    test("run again, the data migration changes nothing", async () => {
      await new HashProjectApiKeys().migrate();

      expect((await stored()).apiKey).toBe(HashedApiKey.hash(KEY));
      expect(await storedHint()).toBe("2b34");
      await expectAccepted(KEY);
    });

    test("once every key is hashed, no key a request presents goes into a query", async () => {
      expect(await ApiKeyService.mayHoldKeysStoredAsWritten()).toBe(false);

      forgetLookups();
      sent.length = 0;

      await expectAccepted(KEY.toUpperCase());
      await expectRefused(OTHER_KEY);

      const everything: string = JSON.stringify(sent).toLowerCase();

      expect(sent.length).toBeGreaterThan(0);
      expect(everything).not.toContain(KEY);
      expect(everything).not.toContain(OTHER_KEY);
      // Looked up by its hash.
      expect(everything).toContain(HashedApiKey.hash(KEY));
    });

    test("a master admin reads the keys through the API without a key or its hash, and cannot write one", async () => {
      const masterAdmin: DatabaseCommonInteractionProps = {
        userId: masterAdminId,
        isMasterAdmin: true,
      } as DatabaseCommonInteractionProps;

      const key: ApiKey | null = await ApiKeyService.findOneById({
        id: new ObjectID(KEY_ROW_ID),
        select: { _id: true, name: true, apiKey: true, apiKeyHint: true },
        props: masterAdmin,
      });

      expect(key?.name).toBe("Key 2");
      expect(key?.apiKeyHint).toBe("2b34");
      expect(key?.apiKey).toBeUndefined();
      expect(JSON.stringify(key)).not.toContain(HashedApiKey.hash(KEY));

      await expect(
        ApiKeyService.updateOneById({
          id: new ObjectID(KEY_ROW_ID),
          data: {
            apiKey: new HashedString(OTHER_KEY),
            apiKeyHint: "3e12",
          } as never,
          props: masterAdmin,
        }),
      ).rejects.toThrow(
        new NotAuthorizedException(API_KEY_WRITTEN_HERE_MESSAGE),
      );

      expect((await stored()).apiKey).toBe(HashedApiKey.hash(KEY));
      await expectRefused(OTHER_KEY);
    });

    test("a reset stores the new key's hash and hint: the new key works, the one before stops", async () => {
      const made: MadeApiKey = await ApiKeyService.resetApiKey({
        id: new ObjectID(KEY_ROW_ID),
        props: { isRoot: true } as DatabaseCommonInteractionProps,
      });

      resetKey = made.apiKey;

      expect((await stored()).apiKey).toBe(HashedApiKey.hash(resetKey));
      expect((await stored()).apiKey).not.toContain(resetKey);
      expect(await storedHint()).toBe(resetKey.slice(-4));
      expect(made.apiKeyHint).toBe(resetKey.slice(-4));

      await expectAccepted(resetKey);
      await expectRefused(KEY);
    });

    test("a key created now is answered once and stored as its hash, with its hint: it works", async () => {
      const created: ApiKey = await ApiKeyService.create({
        data: Object.assign(new ApiKey(), {
          projectId: new ObjectID(PROJECT_ID),
          name: "Created now",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }),
        props: { isRoot: true } as DatabaseCommonInteractionProps,
      });

      const key: string = created.apiKey!.toString();
      const row: StoredKey = await stored(created.id!.toString());

      expect(HashedApiKey.normalize(key)).toBe(key);
      expect(row.apiKey).toBe(HashedApiKey.hash(key));
      expect(await storedHint(created.id!.toString())).toBe(key.slice(-4));

      await expectAccepted(key, created.id!.toString());
    });

    test("the master API key a master admin makes says when, by whom, and how it ends (#8903)", async () => {
      const madeKey: string = await GlobalConfigService.createMasterApiKey({
        createdByUserId: masterAdminId,
      });
      const state: MasterApiKeyState =
        await GlobalConfigService.getMasterApiKeyState();

      expect(state).toEqual({
        isSet: true,
        isEnabled: true,
        createdAt: expect.any(Date),
        createdByName: "Ada Admin",
        hint: madeKey.slice(-4),
      });

      // Rolled back, the three columns go, and come back empty.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new AddMasterApiKeyCreatedByAndHint1809181200000().down(
          queryRunner,
        );
      });

      expect(await columnsOf("GlobalConfig")).not.toContain("masterApiKeyHint");

      await withRunner(async (queryRunner: QueryRunner) => {
        await new AddMasterApiKeyCreatedByAndHint1809181200000().up(
          queryRunner,
        );
      });

      expect(
        (await GlobalConfigService.getMasterApiKeyState()).hint,
      ).toBeNull();
    });

    test("rolled back, the key column is a uuid again: a hashed key is a new random key, a key not hashed yet is kept", async () => {
      // A key a server of the release before wrote the old way, not hashed yet.
      await database.query(
        `UPDATE "${schema}"."ApiKey" SET "apiKey" = $1 WHERE "_id" = $2`,
        [DELETED_KEY, DELETED_ROW_ID],
      );

      await withRunner(async (queryRunner: QueryRunner) => {
        await new ApiKeyHashedColumn1809181100000().down(queryRunner);
      });

      const afterRollback: StoredKey = await stored();

      expect(afterRollback.type).toBe("uuid");
      expect(ObjectID.isValidUUID(afterRollback.apiKey!)).toBe(true);
      expect(afterRollback.apiKey).not.toBe(resetKey);
      expect(await stored(DELETED_ROW_ID)).toEqual({
        apiKey: DELETED_KEY,
        type: "uuid",
      });
      expect(await columnsOf("ApiKey")).not.toContain("apiKeyHint");

      // Left as the schema stands now, for whoever reads the schema next.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new ApiKeyHashedColumn1809181100000().up(queryRunner);
      });
    });
  },
);
