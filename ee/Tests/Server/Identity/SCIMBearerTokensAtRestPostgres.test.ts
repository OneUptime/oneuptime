import SCIMMiddleware from "../../../Server/Identity/Middleware/SCIMAuthorization";
import PresentedKeysInPlace, {
  PresentedKeyTarget,
} from "App/FeatureSet/Workers/Utils/PresentedKeysInPlace";
import PresentedKeysProtection, {
  PresentedKeysProtectionOutcome,
} from "App/FeatureSet/Workers/Utils/PresentedKeysProtection";
import Entities from "Common/Models/DatabaseModels/Index";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import DatabaseService from "Common/Server/Services/DatabaseService";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import logger from "Common/Server/Utils/Logger";
import PresentedKey from "Common/Server/Utils/PresentedKey/PresentedKey";
import PresentedKeysAtRest, {
  LOOKUP_HASH_MIGRATION_NAME,
  SETTLE_PERIOD_MS,
} from "Common/Server/Utils/PresentedKey/PresentedKeysAtRest";
import ObjectID from "Common/Types/ObjectID";
import { DataSource } from "Common/node_modules/typeorm";

/*
 * A SCIM CONNECTION'S BEARER TOKEN THROUGH THE UPGRADE THAT HASHES IT, ON A
 * REAL POSTGRES, AS THE SCIM MIDDLEWARE LOOKS IT UP (#9012).
 *
 * A bearer token was stored as written; the identity provider out there
 * keeps sending it. SCIMMiddleware.findConnection matches it by its stored
 * hash in the query, and - while a token may still be stored as written -
 * as written too. On the ProjectSCIM and StatusPageSCIM tables as migrated,
 * with a token stored as written in each:
 *
 *   - after the upgrade wrote the lookup hashes, a day before the job
 *     protects anything, the token as written finds its connection, and a
 *     wrong one, or another connection's, finds none;
 *   - a day after, the PresentedKeys:ProtectAtRest job hashes each token in
 *     place; the token still finds its connection, by its hash alone - the
 *     token itself is in no query - and the hash presented as a token, or a
 *     wrong token, finds none.
 *
 * Opt in with RUN_POSTGRES_SCIM_TOKEN_AT_REST_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database. The tables' STRUCTURE is cloned into a unique schema
 * (search_path holds only that schema), dropped afterwards; every row is
 * synthetic. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from SCIM_TOKEN_AT_REST_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from SCIM_TOKEN_AT_REST_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SCIM_TOKEN_AT_REST_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const PROJECT_ID: string = "90120000-0000-4000-8000-0000000001f1";
const STATUS_PAGE_ID: string = "90120000-0000-4000-8000-0000000001f2";
const PROJECT_SCIM_ID: string = "90120000-0000-4000-8000-0000000001a1";
const STATUS_PAGE_SCIM_ID: string = "90120000-0000-4000-8000-0000000001a2";

// The tokens as the Dashboard made them before: 64 hex digits each.
const PROJECT_TOKEN: string = "3c".repeat(32);
const STATUS_PAGE_TOKEN: string = "4d".repeat(32);
const WRONG_TOKEN: string = "5e".repeat(32);

const UPGRADED_AT: Date = new Date("2026-11-16T08:00:00.000Z");

// What a statement sent to Postgres was, as TypeORM's logger hears it.
interface SentQuery {
  query: string;
  parameters: Array<unknown> | undefined;
}

interface Connection {
  name: string;
  table: string;
  id: string;
  token: string;
  otherToken: string;
  find: (bearerToken: string) => Promise<string | null>;
}

describePostgres(
  "a SCIM bearer token through its upgrade, as the middleware looks it up (Postgres)",
  () => {
    const schema: string = `scim_tokens_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;
    const sent: Array<SentQuery> = [];

    const CONNECTIONS: Array<Connection> = [
      {
        name: "a project's connection",
        table: "ProjectSCIM",
        id: PROJECT_SCIM_ID,
        token: PROJECT_TOKEN,
        otherToken: STATUS_PAGE_TOKEN,
        find: async (bearerToken: string): Promise<string | null> => {
          const found: ProjectSCIM | null =
            await SCIMMiddleware.findConnection<ProjectSCIM>({
              service: ProjectSCIMService,
              scimId: PROJECT_SCIM_ID,
              accessToken: null,
              bearerToken: bearerToken,
              select: { _id: true, projectId: true },
            });

          return found?._id ? String(found._id) : null;
        },
      },
      {
        name: "a status page's connection",
        table: "StatusPageSCIM",
        id: STATUS_PAGE_SCIM_ID,
        token: STATUS_PAGE_TOKEN,
        otherToken: PROJECT_TOKEN,
        find: async (bearerToken: string): Promise<string | null> => {
          const found: StatusPageSCIM | null =
            await SCIMMiddleware.findConnection<StatusPageSCIM>({
              service: StatusPageSCIMService,
              scimId: STATUS_PAGE_SCIM_ID,
              accessToken: null,
              bearerToken: bearerToken,
              select: { _id: true, projectId: true, statusPageId: true },
            });

          return found?._id ? String(found._id) : null;
        },
      },
    ];

    async function storedToken(connection: Connection): Promise<string> {
      const rows: Array<{ bearerToken: string }> = await database.query(
        `SELECT "bearerToken" FROM "${schema}"."${connection.table}" WHERE "_id" = $1`,
        [connection.id],
      );

      return rows[0]!.bearerToken;
    }

    function scimTargets(): Array<PresentedKeyTarget> {
      return PresentedKeysInPlace.getTargets().filter(
        (target: PresentedKeyTarget): boolean => {
          return (
            target.tableName === "ProjectSCIM" ||
            target.tableName === "StatusPageSCIM"
          );
        },
      );
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SCIM_TOKEN_AT_REST_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["SCIM_TOKEN_AT_REST_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SCIM_TOKEN_AT_REST_TEST_DATABASE_NAME"] ||
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

      for (const table of ["ProjectSCIM", "StatusPageSCIM", "DataMigrations"]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // Each connection's token, as written, as the release before kept it.
      await database.query(
        `INSERT INTO "${schema}"."ProjectSCIM" ("_id", "version", "projectId", "name", "bearerToken") VALUES ($1, 1, $2, 'Okta', $3)`,
        [PROJECT_SCIM_ID, PROJECT_ID, PROJECT_TOKEN],
      );
      await database.query(
        `INSERT INTO "${schema}"."StatusPageSCIM" ("_id", "version", "projectId", "statusPageId", "name", "bearerToken") VALUES ($1, 1, $2, $3, 'Okta', $4)`,
        [STATUS_PAGE_SCIM_ID, PROJECT_ID, STATUS_PAGE_ID, STATUS_PAGE_TOKEN],
      );

      // The upgrade's data migration ran: the day's wait has begun.
      await database.query(
        `INSERT INTO "${schema}"."DataMigrations" ("_id", "version", "name", "executed", "executedAt") VALUES ($1, 1, $2, true, $3)`,
        [
          ObjectID.generate().toString(),
          LOOKUP_HASH_MIGRATION_NAME,
          UPGRADED_AT,
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
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      // A fresh server each test: it asks again whether tokens are protected.
      PresentedKeysAtRest.forget();
      sent.length = 0;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test.each(
      CONNECTIONS.map((connection: Connection) => {
        return [connection.name, connection];
      }),
    )(
      "%s: within the day, the token as written finds it, and a wrong one or another connection's finds none",
      async (_name: string, connection: Connection) => {
        expect(await storedToken(connection)).toBe(connection.token);

        expect(await connection.find(connection.token)).toBe(connection.id);
        expect(await connection.find(WRONG_TOKEN)).toBeNull();
        expect(await connection.find(connection.otherToken)).toBeNull();
      },
    );

    test("a day after, every token is hashed in place, and still finds its connection by its hash alone", async () => {
      expect(
        await PresentedKeysProtection.run({
          runner: database,
          now: new Date(UPGRADED_AT.getTime() + SETTLE_PERIOD_MS),
          targets: scimTargets(),
        }),
      ).toBe(PresentedKeysProtectionOutcome.Protected);

      PresentedKeysAtRest.forget();
      sent.length = 0;

      for (const connection of CONNECTIONS) {
        expect(await storedToken(connection)).toBe(
          PresentedKey.toStoredHash(connection.token),
        );

        expect(await connection.find(connection.token)).toBe(connection.id);
        expect(await connection.find(WRONG_TOKEN)).toBeNull();
        expect(await connection.find(connection.otherToken)).toBeNull();
        // The hash itself is no token.
        expect(
          await connection.find(PresentedKey.toStoredHash(connection.token)),
        ).toBeNull();
      }

      // No token went into a statement or its parameters: only its hash.
      const leaks: Array<string> = sent
        .filter((query: SentQuery): boolean => {
          const text: string = `${query.query} ${JSON.stringify(query.parameters || [])}`;

          return (
            text.includes(PROJECT_TOKEN) || text.includes(STATUS_PAGE_TOKEN)
          );
        })
        .map((query: SentQuery): string => {
          return query.query;
        });

      expect(sent.length).toBeGreaterThan(0);
      expect(leaks).toEqual([]);
    });
  },
);
