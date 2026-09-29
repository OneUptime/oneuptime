import Entities from "../../../Models/DatabaseModels/Index";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPagePrivateUserSessionService from "../../../Server/Services/StatusPagePrivateUserSessionService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_STATUS_PAGE_PRIVACY_TESTS=true and config.env.
 * Clone the real tables into an isolated schema; never modify project data.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_STATUS_PAGE_PRIVACY_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("private status page authorization against Postgres", () => {
  const schema: string = `status_page_access_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const statusPageId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const sessionId: ObjectID = ObjectID.generate();
  let database: DataSource;
  let req: ExpressRequest;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["STATUS_PAGE_PRIVACY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["STATUS_PAGE_PRIVACY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of [
      "StatusPagePrivateUser",
      "StatusPagePrivateUserSession",
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    const statusPage: StatusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.isPublicStatusPage = false;
    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(statusPage);
    req = {
      cookies: {
        [CookieUtil.getUserTokenKey(statusPageId)]: JSONWebToken.sign({
          data: {
            userId,
            statusPageId,
            sessionId,
            email: new Email("synthetic@example.com"),
          },
          expiresInSeconds: 900,
        }),
      },
    } as ExpressRequest;
  });

  beforeEach(async () => {
    await database.query(
      `TRUNCATE "${schema}"."StatusPagePrivateUserSession", "${schema}"."StatusPagePrivateUser"`,
    );
    await database.query(
      `INSERT INTO "${schema}"."StatusPagePrivateUser" ("_id", "projectId", "statusPageId", "version") VALUES ($1, $2, $3, 1)`,
      [userId.toString(), projectId.toString(), statusPageId.toString()],
    );
    await database.query(
      `INSERT INTO "${schema}"."StatusPagePrivateUserSession"
       ("_id", "projectId", "statusPageId", "statusPagePrivateUserId", "refreshToken", "refreshTokenExpiresAt", "version")
       VALUES ($1, $2, $3, $4, 'synthetic-token-hash', NOW() + INTERVAL '1 day', 1)`,
      [
        sessionId.toString(),
        projectId.toString(),
        statusPageId.toString(),
        userId.toString(),
      ],
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function hasAccess(): Promise<boolean> {
    return (await StatusPageService.hasReadAccess({ statusPageId, req }))
      .hasReadAccess;
  }

  test("authorizes an active session with exactly one database query", async () => {
    const logQuery: jest.SpyInstance = jest.spyOn(database.logger, "logQuery");
    try {
      expect(await hasAccess()).toBe(true);
      expect(logQuery).toHaveBeenCalledTimes(1);
      const sql: string = logQuery.mock.calls[0]![0] as string;
      expect(sql).toContain('"session"."_id" = $1');
      expect(sql).not.toContain('"email"');
      expect(sql).not.toContain('"ipAddress"');
      expect(sql).not.toContain('"userAgent"');
    } finally {
      logQuery.mockRestore();
    }
  });

  test.each([
    [
      "revoked session",
      'UPDATE "StatusPagePrivateUserSession" SET "isRevoked" = true',
    ],
    [
      "expired refresh token",
      'UPDATE "StatusPagePrivateUserSession" SET "refreshTokenExpiresAt" = NOW()',
    ],
    [
      "soft-deleted session",
      'UPDATE "StatusPagePrivateUserSession" SET "deletedAt" = NOW()',
    ],
    ["hard-deleted session", 'DELETE FROM "StatusPagePrivateUserSession"'],
    [
      "soft-deleted user",
      'UPDATE "StatusPagePrivateUser" SET "deletedAt" = NOW()',
    ],
    ["hard-deleted user", 'DELETE FROM "StatusPagePrivateUser"'],
    [
      "session owned by another user",
      'UPDATE "StatusPagePrivateUserSession" SET "statusPagePrivateUserId" = uuid_generate_v4()',
    ],
    [
      "session for another page",
      'UPDATE "StatusPagePrivateUserSession" SET "statusPageId" = uuid_generate_v4()',
    ],
    [
      "user moved to another page",
      'UPDATE "StatusPagePrivateUser" SET "statusPageId" = uuid_generate_v4()',
    ],
    [
      "unexchanged login code",
      `UPDATE "StatusPagePrivateUserSession" SET "additionalInfo" = '{"oneuptimeStatusPageSessionPurpose":"login-code"}'::jsonb`,
    ],
  ])(
    "denies the same unexpired JWT after %s",
    async (_label: string, sql: string) => {
      expect(await hasAccess()).toBe(true);
      // All connections in this test use only the isolated schema first.
      await database.query(sql);
      expect(await hasAccess()).toBe(false);
    },
  );

  describe("login-code exchange activity", () => {
    let loginCode: string;

    beforeEach(async () => {
      loginCode = ObjectID.generate().toString();
      const codeHash: string = await HashedString.hashValue(
        loginCode,
        EncryptionSecret,
      );
      await database.query(
        `UPDATE "${schema}"."StatusPagePrivateUserSession"
         SET "refreshToken" = $1, "refreshTokenExpiresAt" = NOW() + INTERVAL '5 minutes',
             "additionalInfo" = '{"oneuptimeStatusPageSessionPurpose":"login-code"}'::jsonb
         WHERE "_id" = $2`,
        [codeHash, sessionId.toString()],
      );
    });

    async function activity(): Promise<Date | null> {
      const rows: Array<{ lastActive: Date | null }> = await database.query(
        `SELECT "lastActive" FROM "${schema}"."StatusPagePrivateUser" WHERE "_id" = $1`,
        [userId.toString()],
      );
      return rows[0]?.lastActive || null;
    }

    test("successful exchange records activity once without logging private data", async () => {
      const email: string = "synthetic-activity@example.com";
      const ipAddress: string = "192.0.2.42";
      const userAgent: string = "Synthetic private browser";
      await database.query(
        `UPDATE "${schema}"."StatusPagePrivateUser" SET "email" = $1 WHERE "_id" = $2`,
        [email, userId.toString()],
      );
      const logSpies: Array<jest.SpyInstance> = [
        jest.spyOn(logger, "debug").mockImplementation(() => {}),
        jest.spyOn(logger, "info").mockImplementation(() => {}),
        jest.spyOn(logger, "warn").mockImplementation(() => {}),
        jest.spyOn(logger, "error").mockImplementation(() => {}),
      ];

      try {
        expect(await activity()).toBeNull();
        const startedAt: number = Date.now();
        await expect(
          StatusPagePrivateUserSessionService.exchangeLoginCode(loginCode, {
            statusPageId,
            ipAddress,
            userAgent,
          }),
        ).resolves.not.toBeNull();

        const lastActive: Date | null = await activity();
        expect(lastActive).toBeInstanceOf(Date);
        expect(lastActive!.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(lastActive!.getTime()).toBeLessThanOrEqual(Date.now());

        await expect(
          StatusPagePrivateUserSessionService.exchangeLoginCode(loginCode, {
            statusPageId,
          }),
        ).resolves.toBeNull();
        expect(await activity()).toEqual(lastActive);

        const logs: string = JSON.stringify(
          logSpies.map((spy: jest.SpyInstance) => {
            return spy.mock.calls;
          }),
        );
        expect(logs).not.toContain(email);
        expect(logs).not.toContain(ipAddress);
        expect(logs).not.toContain(userAgent);
      } finally {
        for (const spy of logSpies) {
          spy.mockRestore();
        }
      }
    });

    test.each([
      [
        "soft-deleted user",
        'UPDATE "StatusPagePrivateUser" SET "deletedAt" = NOW()',
      ],
      ["hard-deleted user", 'DELETE FROM "StatusPagePrivateUser"'],
      [
        "user moved to another page",
        'UPDATE "StatusPagePrivateUser" SET "statusPageId" = uuid_generate_v4()',
      ],
      [
        "user moved to another project",
        'UPDATE "StatusPagePrivateUser" SET "projectId" = uuid_generate_v4()',
      ],
      [
        "session assigned to another user",
        'UPDATE "StatusPagePrivateUserSession" SET "statusPagePrivateUserId" = uuid_generate_v4()',
      ],
    ])(
      "exchange cannot record activity for a %s",
      async (_label: string, sql: string) => {
        await database.query(sql);

        await expect(
          StatusPagePrivateUserSessionService.exchangeLoginCode(loginCode, {
            statusPageId,
          }),
        ).resolves.not.toBeNull();

        expect(await activity()).toBeNull();
      },
    );

    test.each([
      [
        "expired",
        'UPDATE "StatusPagePrivateUserSession" SET "refreshTokenExpiresAt" = NOW() - INTERVAL \'1 second\'',
      ],
      [
        "revoked",
        'UPDATE "StatusPagePrivateUserSession" SET "isRevoked" = true',
      ],
    ])(
      "a %s code cannot record activity",
      async (_label: string, sql: string) => {
        await database.query(sql);

        await expect(
          StatusPagePrivateUserSessionService.exchangeLoginCode(loginCode, {
            statusPageId,
          }),
        ).resolves.toBeNull();

        expect(await activity()).toBeNull();
      },
    );
  });
});
