import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import UserProjectSsoConsentService from "../../../Server/Services/UserProjectSsoConsentService";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return { getUserMiddleware: jest.fn() };
});
jest.mock("../../../Server/Services/ProjectService", () => {
  return { getCurrentPlan: jest.fn() };
});
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

/*
 * The consent record against a real, migrated database.
 *
 * UserProjectSsoConsentService.test.ts pins the service's logic with the
 * database faked. What only a database can show is the guarantee that logic
 * leans on: the unique index turns a second, racing insert for the same
 * (user, project) into an error rather than a duplicate row, so two clicks on
 * one confirmation link -- or two links for one project -- end with exactly
 * one consent, and the second click still succeeds.
 *
 * Opt in with RUN_POSTGRES_SSO_CONSENT_TESTS=true and config.env; point it at
 * a migrated database with SSO_CONSENT_TEST_DATABASE_HOST/PORT/NAME
 * (default localhost:5400; the Postgres Schema Drift job runs it). Only the table definition is copied from public, into an
 * isolated schema that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SSO_CONSENT_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("UserProjectSsoConsent against Postgres", () => {
  const schema: string = `sso_consent_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;

  const countRows: (
    userId: ObjectID,
    projectId: ObjectID,
  ) => Promise<number> = async (
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<number> => {
    const rows: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*)::text AS count FROM "${schema}"."UserProjectSsoConsent" WHERE "userId" = $1 AND "projectId" = $2`,
      [userId.toString(), projectId.toString()],
    );

    return Number(rows[0]!.count);
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["SSO_CONSENT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["SSO_CONSENT_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SSO_CONSENT_TEST_DATABASE_NAME"] ||
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
      `CREATE TABLE "${schema}"."UserProjectSsoConsent" (LIKE public."UserProjectSsoConsent" INCLUDING ALL)`,
    );

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }

    jest.restoreAllMocks();
  });

  test("records consent once, and finds it for that project only", async () => {
    const userId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    expect(
      await UserProjectSsoConsentService.hasConsent({ userId, projectId }),
    ).toBe(false);

    await UserProjectSsoConsentService.recordConsent({ userId, projectId });

    expect(
      await UserProjectSsoConsentService.hasConsent({ userId, projectId }),
    ).toBe(true);
    expect(
      await UserProjectSsoConsentService.hasConsent({
        userId,
        projectId: otherProjectId,
      }),
    ).toBe(false);
    expect(
      await UserProjectSsoConsentService.hasConsent({
        userId: ObjectID.generate(),
        projectId,
      }),
    ).toBe(false);
  });

  test("a second confirmation neither fails nor duplicates the row", async () => {
    const userId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    await UserProjectSsoConsentService.recordConsent({ userId, projectId });
    await UserProjectSsoConsentService.recordConsent({ userId, projectId });

    expect(await countRows(userId, projectId)).toBe(1);
  });

  test("two confirmations racing each other end with exactly one row", async () => {
    const userId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    await Promise.all([
      UserProjectSsoConsentService.recordConsent({ userId, projectId }),
      UserProjectSsoConsentService.recordConsent({ userId, projectId }),
      UserProjectSsoConsentService.recordConsent({ userId, projectId }),
    ]);

    expect(await countRows(userId, projectId)).toBe(1);
  });

  test("the database itself refuses a duplicate live consent", async () => {
    const userId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();
    const insert: string = `INSERT INTO "${schema}"."UserProjectSsoConsent" ("userId", "projectId", "version") VALUES ($1, $2, 1)`;

    await database.query(insert, [userId.toString(), projectId.toString()]);

    await expect(
      database.query(insert, [userId.toString(), projectId.toString()]),
    ).rejects.toThrow(/duplicate key value/);
  });
});
