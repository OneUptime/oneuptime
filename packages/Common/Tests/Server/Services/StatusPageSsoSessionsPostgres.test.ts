import Entities from "../../../Models/DatabaseModels/Index";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import {
  END_SIGN_INS_OF_GLOBAL_OIDC_PROVIDERS_OFF,
  END_SIGN_INS_OF_GLOBAL_SAML_PROVIDERS_OFF,
  END_SIGN_INS_OF_STATUS_PAGE_OIDC_PROVIDERS_OFF,
  END_SIGN_INS_OF_STATUS_PAGE_SAML_PROVIDERS_OFF,
} from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1799910000000-EndSignInsOfGlobalAndStatusPageSsoProvidersAlreadyOff";
import { END_STATUS_PAGE_SSO_SESSIONS_WITHOUT_PROVIDER } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1799920000000-EndStatusPageSsoSessionsWithoutProvider";
import StatusPagePrivateUserSessionService from "../../../Server/Services/StatusPagePrivateUserSessionService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * A STATUS PAGE SESSION FOLLOWS THE SSO PROVIDER THAT SIGNED IT IN, AGAINST
 * POSTGRES (StatusPagePrivateUserSessionService.addSignInRule).
 *
 * Opt in with RUN_POSTGRES_STATUS_PAGE_SSO_SESSION_TESTS=true against a
 * database the migrations have run on (STATUS_PAGE_SSO_SESSION_TEST_DATABASE_*).
 * The real tables are cloned into an isolated schema; nothing else is
 * touched. The rule is asked the two ways the product asks it - a page read
 * (StatusPageService.hasReadAccess) and a refresh or login code
 * (doesSignInStillCount) - and must agree:
 *
 *   - a session signed in with one of the page's SAML or OIDC providers
 *     counts while that provider is the page's, on, and not turned off since
 *     the session began; turning it off or deleting it ends the session, and
 *     turning it on again does not bring it back;
 *   - a session no provider signed in counts only while the page does not
 *     require SSO.
 *
 * And the data fixes the upgrade runs: providers already off are treated as
 * turned off at the upgrade, and the live sessions of people only SSO ever
 * signed in, which cannot say which provider signed them in, end once.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_STATUS_PAGE_SSO_SESSION_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "StatusPagePrivateUser",
  "StatusPagePrivateUserSession",
  "StatusPageSSO",
  "StatusPageOIDC",
  "GlobalSSO",
  "GlobalOIDC",
];

describePostgres("status page SSO sessions against Postgres", () => {
  const schema: string = `status_page_sso_session_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const statusPageId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const sessionId: ObjectID = ObjectID.generate();
  const samlProviderId: ObjectID = ObjectID.generate();
  const oidcProviderId: ObjectID = ObjectID.generate();
  const statusPage: StatusPage = new StatusPage();
  let database: DataSource;
  let req: ExpressRequest;

  const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<any> => {
    return database.query(sql, parameters);
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["STATUS_PAGE_SSO_SESSION_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["STATUS_PAGE_SSO_SESSION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["STATUS_PAGE_SSO_SESSION_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

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
    statusPage.requireSsoForLogin = false;

    await query(
      `TRUNCATE ${TABLES.map((table: string): string => {
        return `"${schema}"."${table}"`;
      }).join(", ")}`,
    );
    await query(
      `INSERT INTO "${schema}"."StatusPagePrivateUser" ("_id", "projectId", "statusPageId", "version") VALUES ($1, $2, $3, 1)`,
      [userId.toString(), projectId.toString(), statusPageId.toString()],
    );
    // Signed in an hour ago.
    await query(
      `INSERT INTO "${schema}"."StatusPagePrivateUserSession"
       ("_id", "projectId", "statusPageId", "statusPagePrivateUserId", "refreshToken", "refreshTokenExpiresAt", "createdAt", "version")
       VALUES ($1, $2, $3, $4, 'synthetic-token-hash', NOW() + INTERVAL '1 day', NOW() - INTERVAL '1 hour', 1)`,
      [
        sessionId.toString(),
        projectId.toString(),
        statusPageId.toString(),
        userId.toString(),
      ],
    );
    await query(
      `INSERT INTO "${schema}"."StatusPageSSO"
       ("_id", "projectId", "statusPageId", "name", "description", "signatureMethod", "digestMethod", "signOnURL", "issuerURL", "publicCertificate", "isEnabled", "version")
       VALUES ($1, $2, $3, 'Okta', 'Synthetic', 'RSA-SHA256', 'SHA256', 'https://idp.example.com/sso', 'https://idp.example.com', 'synthetic-certificate', true, 1)`,
      [samlProviderId.toString(), projectId.toString(), statusPageId.toString()],
    );
    await query(
      `INSERT INTO "${schema}"."StatusPageOIDC"
       ("_id", "projectId", "statusPageId", "name", "description", "discoveryURL", "issuerURL", "clientId", "clientSecret", "scopes", "emailClaimName", "isEnabled", "version")
       VALUES ($1, $2, $3, 'Google', 'Synthetic', 'https://idp.example.com/.well-known/openid-configuration', 'https://idp.example.com', 'client', 'synthetic-secret', 'openid email', 'email', true, 1)`,
      [oidcProviderId.toString(), projectId.toString(), statusPageId.toString()],
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  // The rule, asked both ways the product asks it; they must agree.
  async function stillCounts(): Promise<boolean> {
    const byPageRead: boolean = (
      await StatusPageService.hasReadAccess({ statusPageId, req })
    ).hasReadAccess;
    const byRefresh: boolean =
      await StatusPagePrivateUserSessionService.doesSignInStillCount({
        sessionId,
        requiresSso: Boolean(statusPage.requireSsoForLogin),
      });

    expect(byRefresh).toBe(byPageRead);

    return byPageRead;
  }

  const KINDS: Array<[string, string, string, () => ObjectID]> = [
    [
      "SAML",
      "StatusPageSSO",
      "statusPageSsoId",
      (): ObjectID => {
        return samlProviderId;
      },
    ],
    [
      "OIDC",
      "StatusPageOIDC",
      "statusPageOidcId",
      (): ObjectID => {
        return oidcProviderId;
      },
    ],
  ];

  describe.each(KINDS)(
    "a session the page's %s provider signed in",
    (
      _label: string,
      table: string,
      column: string,
      providerId: () => ObjectID,
    ) => {
      beforeEach(async () => {
        await query(
          `UPDATE "${schema}"."StatusPagePrivateUserSession" SET "${column}" = $1`,
          [providerId().toString()],
        );
      });

      test("counts while the provider is on, on a page that requires SSO or not", async () => {
        expect(await stillCounts()).toBe(true);

        statusPage.requireSsoForLogin = true;
        expect(await stillCounts()).toBe(true);
      });

      test("ends when the provider is turned off, and turning it on again does not bring it back", async () => {
        await query(
          `UPDATE "${schema}"."${table}" SET "isEnabled" = false, "signInsEndedAt" = NOW()`,
        );
        expect(await stillCounts()).toBe(false);

        await query(`UPDATE "${schema}"."${table}" SET "isEnabled" = true`);
        expect(await stillCounts()).toBe(false);

        // Signing in again after it was turned on gives a session that counts.
        await query(
          `UPDATE "${schema}"."StatusPagePrivateUserSession" SET "createdAt" = NOW() + INTERVAL '1 second'`,
        );
        expect(await stillCounts()).toBe(true);
      });

      test("a provider turned off and on again before the session began vouches for it", async () => {
        await query(
          `UPDATE "${schema}"."${table}" SET "signInsEndedAt" = NOW() - INTERVAL '2 hours'`,
        );
        expect(await stillCounts()).toBe(true);
      });

      test("ends when the provider is deleted, or moved to another page", async () => {
        await query(
          `UPDATE "${schema}"."${table}" SET "statusPageId" = uuid_generate_v4()`,
        );
        expect(await stillCounts()).toBe(false);

        await query(
          `UPDATE "${schema}"."${table}" SET "statusPageId" = $1, "deletedAt" = NOW()`,
          [statusPageId.toString()],
        );
        expect(await stillCounts()).toBe(false);

        await query(`DELETE FROM "${schema}"."${table}"`);
        expect(await stillCounts()).toBe(false);
      });

      test("the other kind's provider never vouches for it", async () => {
        const otherTable: string =
          table === "StatusPageSSO" ? "StatusPageOIDC" : "StatusPageSSO";

        await query(`DELETE FROM "${schema}"."${table}"`);
        await query(
          `UPDATE "${schema}"."${otherTable}" SET "_id" = $1`,
          [providerId().toString()],
        );

        expect(await stillCounts()).toBe(false);
      });
    },
  );

  describe("a session no provider signed in", () => {
    test("counts on a page that does not require SSO", async () => {
      expect(await stillCounts()).toBe(true);
    });

    test("does not count on a page that requires SSO", async () => {
      statusPage.requireSsoForLogin = true;
      expect(await stillCounts()).toBe(false);
    });
  });

  describe("the data fixes the upgrade runs", () => {
    test("a provider that is off is treated as turned off now; one that is on, or stamped already, keeps what it has", async () => {
      const stampedAt: string = "2026-01-01T00:00:00.000Z";
      const globalOff: ObjectID = ObjectID.generate();
      const globalOn: ObjectID = ObjectID.generate();

      for (const [providerId, isEnabled] of [
        [globalOff, false],
        [globalOn, true],
      ] as Array<[ObjectID, boolean]>) {
        await query(
          `INSERT INTO "${schema}"."GlobalSSO"
           ("_id", "name", "description", "signatureMethod", "digestMethod", "signOnURL", "issuerURL", "publicCertificate", "isEnabled", "version")
           VALUES ($1, 'Global', 'Synthetic', 'RSA-SHA256', 'SHA256', 'https://idp.example.com/sso', 'https://idp.example.com', 'synthetic-certificate', $2, 1)`,
          [providerId.toString(), isEnabled],
        );
        await query(
          `INSERT INTO "${schema}"."GlobalOIDC"
           ("_id", "name", "description", "discoveryURL", "issuerURL", "clientId", "clientSecret", "scopes", "emailClaimName", "nameClaimName", "isEnabled", "version")
           VALUES ($1, 'Global', 'Synthetic', 'https://idp.example.com/.well-known/openid-configuration', 'https://idp.example.com', 'client', 'synthetic-secret', 'openid email', 'email', 'name', $2, 1)`,
          [providerId.toString(), isEnabled],
        );
      }

      // The page's SAML provider is off and stamped already; its OIDC one is off and not.
      await query(
        `UPDATE "${schema}"."StatusPageSSO" SET "isEnabled" = false, "signInsEndedAt" = $1`,
        [stampedAt],
      );
      await query(`UPDATE "${schema}"."StatusPageOIDC" SET "isEnabled" = false`);

      for (const statement of [
        END_SIGN_INS_OF_GLOBAL_SAML_PROVIDERS_OFF,
        END_SIGN_INS_OF_GLOBAL_OIDC_PROVIDERS_OFF,
        END_SIGN_INS_OF_STATUS_PAGE_SAML_PROVIDERS_OFF,
        END_SIGN_INS_OF_STATUS_PAGE_OIDC_PROVIDERS_OFF,
      ]) {
        await query(statement);
      }

      const stamp: (table: string, id: ObjectID) => Promise<Date | null> =
        async (table: string, id: ObjectID): Promise<Date | null> => {
          const rows: Array<{ signInsEndedAt: Date | null }> = await query(
            `SELECT "signInsEndedAt" FROM "${schema}"."${table}" WHERE "_id" = $1`,
            [id.toString()],
          );
          return rows[0]!.signInsEndedAt;
        };

      for (const table of ["GlobalSSO", "GlobalOIDC"]) {
        expect(await stamp(table, globalOff)).toBeInstanceOf(Date);
        expect(await stamp(table, globalOn)).toBeNull();
      }

      expect((await stamp("StatusPageSSO", samlProviderId))!.toISOString()).toBe(
        stampedAt,
      );
      expect(await stamp("StatusPageOIDC", oidcProviderId)).toBeInstanceOf(
        Date,
      );
    });

    test("the live sessions of people only SSO signed in, which name no provider, end once; every other session stays", async () => {
      const passwordUserId: ObjectID = ObjectID.generate();
      const passwordSessionId: ObjectID = ObjectID.generate();
      const namedSessionId: ObjectID = ObjectID.generate();
      const expiredSessionId: ObjectID = ObjectID.generate();

      await query(
        `UPDATE "${schema}"."StatusPagePrivateUser" SET "isSsoUser" = true`,
      );
      await query(
        `INSERT INTO "${schema}"."StatusPagePrivateUser" ("_id", "projectId", "statusPageId", "version") VALUES ($1, $2, $3, 1)`,
        [
          passwordUserId.toString(),
          projectId.toString(),
          statusPageId.toString(),
        ],
      );

      const addSession: (data: {
        id: ObjectID;
        user: ObjectID;
        providerId?: ObjectID;
        expired?: boolean;
      }) => Promise<void> = async (data: {
        id: ObjectID;
        user: ObjectID;
        providerId?: ObjectID;
        expired?: boolean;
      }): Promise<void> => {
        await query(
          `INSERT INTO "${schema}"."StatusPagePrivateUserSession"
           ("_id", "projectId", "statusPageId", "statusPagePrivateUserId", "statusPageSsoId", "refreshToken", "refreshTokenExpiresAt", "version")
           VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' hours')::interval, 1)`,
          [
            data.id.toString(),
            projectId.toString(),
            statusPageId.toString(),
            data.user.toString(),
            data.providerId ? data.providerId.toString() : null,
            `synthetic-token-${data.id.toString()}`,
            data.expired ? "-1" : "24",
          ],
        );
      };

      await addSession({ id: passwordSessionId, user: passwordUserId });
      await addSession({
        id: namedSessionId,
        user: userId,
        providerId: samlProviderId,
      });
      await addSession({ id: expiredSessionId, user: userId, expired: true });

      await query(END_STATUS_PAGE_SSO_SESSIONS_WITHOUT_PROVIDER);

      const revoked: (id: ObjectID) => Promise<boolean> = async (
        id: ObjectID,
      ): Promise<boolean> => {
        const rows: Array<{ isRevoked: boolean }> = await query(
          `SELECT "isRevoked" FROM "${schema}"."StatusPagePrivateUserSession" WHERE "_id" = $1`,
          [id.toString()],
        );
        return rows[0]!.isRevoked;
      };

      expect(await revoked(sessionId)).toBe(true);
      expect(await revoked(passwordSessionId)).toBe(false);
      expect(await revoked(namedSessionId)).toBe(false);
      expect(await revoked(expiredSessionId)).toBe(false);

      // Run again, it ends nothing more.
      await query(END_STATUS_PAGE_SSO_SESSIONS_WITHOUT_PROVIDER);
      expect(await revoked(passwordSessionId)).toBe(false);
    });
  });
});
