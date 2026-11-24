jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import Entities from "../../../Models/DatabaseModels/Index";
import DashboardPrivateUser from "../../../Models/DatabaseModels/DashboardPrivateUser";
import DashboardPrivateUserSession from "../../../Models/DatabaseModels/DashboardPrivateUserSession";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DashboardPrivateUserService from "../../../Server/Services/DashboardPrivateUserService";
import DashboardPrivateUserSessionService from "../../../Server/Services/DashboardPrivateUserSessionService";
import {
  PRIVATE_USER_SESSION_PASSWORD_CHANGED_REASON,
  PrivateUserSessionMetadata,
} from "../../../Server/Services/PrivateUserSessionServiceBase";
import logger from "../../../Server/Utils/Logger";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { SignInMethod } from "../../../Types/UserSession/SessionSignIn";
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
import { DataSource } from "typeorm";

/*
 * THE SESSIONS OF A DASHBOARD'S PRIVATE USERS, ON POSTGRES (#10250).
 *
 * A dashboard shared as "Only people who sign in" lets in a visitor only
 * while they hold a live session of one of its private users, read on every
 * request (DashboardPrivateUserSessionService, over the rules every kind of
 * private user shares: PrivateUserSessionServiceBase). These are the real
 * queries - the conditional writes and the sign-in rule's joins - on real
 * rows of the migrated tables:
 *
 *   - a session's refresh token is kept only as its hash, finds its session,
 *     and is rotated in one conditional write a sign-out that lands first
 *     is never written over;
 *   - a session counts only for its own dashboard and private user, while
 *     it is not revoked, not expired, and its private user is still there;
 *   - a password sign-in stops counting once the dashboard requires single
 *     sign-on; a single sign-on one counts only while its provider is on,
 *     there, and was not turned off after it began;
 *   - a single sign-on code signs nobody in until it is exchanged, once, on
 *     its own dashboard, before it runs out;
 *   - a new password, and removing the private user, end every session of
 *     theirs - and nobody else's; a reset link is found by its hash on its
 *     own dashboard alone, and a new address ends it.
 *
 * Opt in with RUN_POSTGRES_DASHBOARD_PRIVATE_USER_TESTS=true against a
 * database the registered migrations have been applied to - the Postgres
 * Schema Drift workflow's database right after its drift check - e.g.
 *
 *   RUN_POSTGRES_DASHBOARD_PRIVATE_USER_TESTS=true \
 *   DASHBOARD_PRIVATE_USER_TEST_DATABASE_HOST=127.0.0.1 \
 *   DASHBOARD_PRIVATE_USER_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/DashboardPrivateUserSessionsPostgres.test.ts
 *
 * It runs against the STRUCTURE of the tables, and the foreign keys between
 * them, cloned from public into a uniquely named schema - the only one on
 * the search path - that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DASHBOARD_PRIVATE_USER_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  // Who removed a private user is kept (deletedByUserId).
  "User",
  "Project",
  "Dashboard",
  "DashboardDomain",
  "DashboardPrivateUser",
  "DashboardPrivateUserSession",
  "DashboardSSO",
  "DashboardOIDC",
];

const STRONG_PASSWORD: string = "a brand new Passphrase 2026!";

interface ForeignKeyRow {
  table: string;
  name: string;
  definition: string;
}

describePostgres(
  "the sessions of a dashboard's private users, on Postgres",
  () => {
    const schema: string = `dashboard_private_users_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;

    const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<any> => {
      return database.query(sql, parameters);
    };

    let projectId: ObjectID;
    let dashboardId: ObjectID;
    let otherDashboardId: ObjectID;

    const addProject: () => Promise<ObjectID> = async (): Promise<ObjectID> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'Acme Retail', $2)`,
        [id, `acme-${id}`],
      );

      return new ObjectID(id);
    };

    const addDashboard: (data: {
      projectId: ObjectID;
      requireSsoForLogin?: boolean;
    }) => Promise<ObjectID> = async (data: {
      projectId: ObjectID;
      requireSsoForLogin?: boolean;
    }): Promise<ObjectID> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."Dashboard"
        ("_id", "version", "projectId", "name", "slug", "isPublicDashboard", "requireSignIn", "requireSsoForLogin", "dashboardViewConfig")
       VALUES ($1, 1, $2, 'Checkout', $3, true, true, $4, '{"components": [], "heightInDashboardUnits": 10}')`,
        [
          id,
          data.projectId.toString(),
          `checkout-${id}`,
          data.requireSsoForLogin === true,
        ],
      );

      return new ObjectID(id);
    };

    const addPrivateUser: (data: {
      dashboardId: ObjectID;
      email: string;
    }) => Promise<ObjectID> = async (data: {
      dashboardId: ObjectID;
      email: string;
    }): Promise<ObjectID> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."DashboardPrivateUser" ("_id", "version", "projectId", "dashboardId", "email")
       VALUES ($1, 1, $2, $3, $4)`,
        [id, projectId.toString(), data.dashboardId.toString(), data.email],
      );

      return new ObjectID(id);
    };

    const addProvider: (data: {
      table: "DashboardSSO" | "DashboardOIDC";
      dashboardId: ObjectID;
    }) => Promise<ObjectID> = async (data: {
      table: "DashboardSSO" | "DashboardOIDC";
      dashboardId: ObjectID;
    }): Promise<ObjectID> => {
      const id: string = ObjectID.generate().toString();

      if (data.table === "DashboardSSO") {
        await query(
          `INSERT INTO "${schema}"."DashboardSSO"
          ("_id", "version", "projectId", "dashboardId", "name", "description", "signatureMethod", "digestMethod", "signOnURL", "issuerURL", "publicCertificate", "isEnabled")
         VALUES ($1, 1, $2, $3, 'Acme Okta', '', 'RSA-SHA256', 'SHA256', 'https://idp.example.com/sso', 'https://idp.example.com', 'certificate', true)`,
          [id, projectId.toString(), data.dashboardId.toString()],
        );
      } else {
        await query(
          `INSERT INTO "${schema}"."DashboardOIDC"
          ("_id", "version", "projectId", "dashboardId", "name", "description", "discoveryURL", "issuerURL", "clientId", "clientSecret", "scopes", "emailClaimName", "isEnabled")
         VALUES ($1, 1, $2, $3, 'Acme Google', '', 'https://idp.example.com', 'https://idp.example.com', 'client', 'secret', 'openid email', 'email', true)`,
          [id, projectId.toString(), data.dashboardId.toString()],
        );
      }

      return new ObjectID(id);
    };

    const signIn: (data: {
      dashboardId: ObjectID;
      privateUserId: ObjectID;
      ssoProviderId?: ObjectID;
      oidcProviderId?: ObjectID;
    }) => Promise<
      PrivateUserSessionMetadata<DashboardPrivateUserSession>
    > = async (data: {
      dashboardId: ObjectID;
      privateUserId: ObjectID;
      ssoProviderId?: ObjectID;
      oidcProviderId?: ObjectID;
    }): Promise<PrivateUserSessionMetadata<DashboardPrivateUserSession>> => {
      return await DashboardPrivateUserSessionService.createSession({
        projectId,
        resourceId: data.dashboardId,
        privateUserId: data.privateUserId,
        ssoProviderId: data.ssoProviderId,
        oidcProviderId: data.oidcProviderId,
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0",
        signIn: { method: SignInMethod.Password },
      });
    };

    const isSignedIn: (data: {
      dashboardId: ObjectID;
      privateUserId: ObjectID;
      sessionId: ObjectID;
      requiresSso?: boolean;
    }) => Promise<boolean> = async (data: {
      dashboardId: ObjectID;
      privateUserId: ObjectID;
      sessionId: ObjectID;
      requiresSso?: boolean;
    }): Promise<boolean> => {
      return Boolean(
        await DashboardPrivateUserSessionService.findSignedInSession({
          resourceId: data.dashboardId,
          privateUserId: data.privateUserId,
          sessionId: data.sessionId,
          requiresSso: data.requiresSso === true,
        }),
      );
    };

    const sessionRow: (
      sessionId: ObjectID,
    ) => Promise<Record<string, unknown> | undefined> = async (
      sessionId: ObjectID,
    ): Promise<Record<string, unknown> | undefined> => {
      const rows: Array<Record<string, unknown>> = await query(
        `SELECT * FROM "${schema}"."DashboardPrivateUserSession" WHERE "_id" = $1`,
        [sessionId.toString()],
      );

      return rows[0];
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["DASHBOARD_PRIVATE_USER_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["DASHBOARD_PRIVATE_USER_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["DASHBOARD_PRIVATE_USER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema}` },
      });
      await database.initialize();

      const foreignKeys: Array<ForeignKeyRow> = await query(
        `SELECT t.relname AS "table",
              c.conname AS "name",
              pg_get_constraintdef(c.oid) AS "definition"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_class r ON r.oid = c.confrelid
        WHERE n.nspname = 'public'
          AND c.contype = 'f'
          AND t.relname = ANY($1)
          AND r.relname = ANY($1)
        ORDER BY t.relname, c.conname`,
        [TABLES],
      );

      await query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      for (const foreignKey of foreignKeys) {
        await query(
          `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(
            /REFERENCES public\./g,
            "REFERENCES ",
          )}`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> = await query(
        "SELECT current_schema()",
      );
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const table of [...TABLES].reverse()) {
        await query(`DELETE FROM "${schema}"."${table}"`);
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      // The workflows a write announces run in another service.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      for (const silenced of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, silenced).mockImplementation((): void => {
          return undefined;
        });
      }

      projectId = await addProject();
      dashboardId = await addDashboard({ projectId });
      otherDashboardId = await addDashboard({ projectId });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("copies the foreign keys of the sessions as the migration declares them", async () => {
      const copied: Array<{ table: string; referencedTable: string }> =
        await query(
          `SELECT t.relname AS "table", r.relname AS "referencedTable"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_class r ON r.oid = c.confrelid
           JOIN pg_namespace rn ON rn.oid = r.relnamespace
          WHERE n.nspname = $1 AND rn.nspname = $1 AND c.contype = 'f'
          ORDER BY 1, 2`,
          [schema],
        );

      expect(copied).toEqual(
        expect.arrayContaining([
          {
            table: "DashboardPrivateUserSession",
            referencedTable: "Dashboard",
          },
          {
            table: "DashboardPrivateUserSession",
            referencedTable: "DashboardPrivateUser",
          },
          { table: "DashboardPrivateUser", referencedTable: "Dashboard" },
          { table: "DashboardSSO", referencedTable: "Dashboard" },
          { table: "DashboardOIDC", referencedTable: "Dashboard" },
        ]),
      );
    });

    test("keeps a session's refresh token only as its hash, which finds the session", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const signedIn: PrivateUserSessionMetadata<DashboardPrivateUserSession> =
        await signIn({ dashboardId, privateUserId: userId });

      const row: Record<string, unknown> | undefined = await sessionRow(
        signedIn.session.id!,
      );

      expect(row?.["refreshToken"]).not.toBe(signedIn.refreshToken);
      expect(row?.["refreshToken"]).toBe(
        await HashedString.hashValue(signedIn.refreshToken, EncryptionSecret),
      );

      const found: DashboardPrivateUserSession | null =
        await DashboardPrivateUserSessionService.findActiveSessionByRefreshToken(
          signedIn.refreshToken,
        );

      expect(found?.id?.toString()).toBe(signedIn.session.id!.toString());
      expect(
        await DashboardPrivateUserSessionService.findActiveSessionByRefreshToken(
          "8dab0000-0000-4000-8000-000000000999",
        ),
      ).toBeNull();
    });

    test("a session counts for its own dashboard and private user only", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const otherUserId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "someone-else@example.com",
      });
      const sessionId: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;

      expect(
        await isSignedIn({ dashboardId, privateUserId: userId, sessionId }),
      ).toBe(true);
      expect(
        await isSignedIn({
          dashboardId: otherDashboardId,
          privateUserId: userId,
          sessionId,
        }),
      ).toBe(false);
      expect(
        await isSignedIn({
          dashboardId,
          privateUserId: otherUserId,
          sessionId,
        }),
      ).toBe(false);
    });

    test("a session stops counting once it is revoked, runs out, or its private user is removed", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });

      const revoked: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;
      await DashboardPrivateUserSessionService.revokeSessionById(revoked, {
        reason: "Signed out",
      });

      expect(
        await isSignedIn({
          dashboardId,
          privateUserId: userId,
          sessionId: revoked,
        }),
      ).toBe(false);

      const expired: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;
      await query(
        `UPDATE "${schema}"."DashboardPrivateUserSession" SET "refreshTokenExpiresAt" = now() - interval '1 minute' WHERE "_id" = $1`,
        [expired.toString()],
      );

      expect(
        await isSignedIn({
          dashboardId,
          privateUserId: userId,
          sessionId: expired,
        }),
      ).toBe(false);

      const live: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;

      expect(
        await isSignedIn({
          dashboardId,
          privateUserId: userId,
          sessionId: live,
        }),
      ).toBe(true);

      await query(
        `UPDATE "${schema}"."DashboardPrivateUser" SET "deletedAt" = now() WHERE "_id" = $1`,
        [userId.toString()],
      );

      expect(
        await isSignedIn({
          dashboardId,
          privateUserId: userId,
          sessionId: live,
        }),
      ).toBe(false);
    });

    test("a password sign-in stops counting once the dashboard requires single sign-on", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const sessionId: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;

      expect(
        await DashboardPrivateUserSessionService.doesSignInStillCount({
          sessionId,
        }),
      ).toBe(true);

      await query(
        `UPDATE "${schema}"."Dashboard" SET "requireSsoForLogin" = true WHERE "_id" = $1`,
        [dashboardId.toString()],
      );

      expect(
        await DashboardPrivateUserSessionService.doesSignInStillCount({
          sessionId,
        }),
      ).toBe(false);
      expect(
        await isSignedIn({
          dashboardId,
          privateUserId: userId,
          sessionId,
          requiresSso: true,
        }),
      ).toBe(false);
    });

    test.each([
      ["SAML", "DashboardSSO"],
      ["OIDC", "DashboardOIDC"],
    ] as Array<[string, "DashboardSSO" | "DashboardOIDC"]>)(
      "a %s sign-in counts while its provider vouches for it - Require SSO or not - and ends when it is turned off, its sign-ins ended, or deleted",
      async (_label: string, table: "DashboardSSO" | "DashboardOIDC") => {
        const userId: ObjectID = await addPrivateUser({
          dashboardId,
          email: "reader@example.com",
        });

        const providerId: ObjectID = await addProvider({ table, dashboardId });

        const providerOf: (id: ObjectID) => {
          ssoProviderId?: ObjectID;
          oidcProviderId?: ObjectID;
        } = (id: ObjectID) => {
          return table === "DashboardSSO"
            ? { ssoProviderId: id }
            : { oidcProviderId: id };
        };

        const sessionId: ObjectID = (
          await signIn({
            dashboardId,
            privateUserId: userId,
            ...providerOf(providerId),
          })
        ).session.id!;

        for (const requiresSso of [false, true]) {
          expect(
            await isSignedIn({
              dashboardId,
              privateUserId: userId,
              sessionId,
              requiresSso,
            }),
          ).toBe(true);
        }

        expect(
          await DashboardPrivateUserSessionService.doesSignInStillCount({
            sessionId,
          }),
        ).toBe(true);

        // Turned off: the session ends, and turning it on again does not bring it back.
        await query(
          `UPDATE "${schema}"."${table}" SET "isEnabled" = false, "signInsEndedAt" = now() WHERE "_id" = $1`,
          [providerId.toString()],
        );

        expect(
          await isSignedIn({ dashboardId, privateUserId: userId, sessionId }),
        ).toBe(false);

        await query(
          `UPDATE "${schema}"."${table}" SET "isEnabled" = true WHERE "_id" = $1`,
          [providerId.toString()],
        );

        expect(
          await isSignedIn({ dashboardId, privateUserId: userId, sessionId }),
        ).toBe(false);

        // A provider deleted ends the sessions it signed in.
        const anotherProviderId: ObjectID = await addProvider({
          table,
          dashboardId,
        });
        const anotherSessionId: ObjectID = (
          await signIn({
            dashboardId,
            privateUserId: userId,
            ...providerOf(anotherProviderId),
          })
        ).session.id!;

        expect(
          await isSignedIn({
            dashboardId,
            privateUserId: userId,
            sessionId: anotherSessionId,
          }),
        ).toBe(true);

        await query(
          `UPDATE "${schema}"."${table}" SET "deletedAt" = now() WHERE "_id" = $1`,
          [anotherProviderId.toString()],
        );

        expect(
          await isSignedIn({
            dashboardId,
            privateUserId: userId,
            sessionId: anotherSessionId,
          }),
        ).toBe(false);
        expect(
          await DashboardPrivateUserSessionService.doesSignInStillCount({
            sessionId: anotherSessionId,
          }),
        ).toBe(false);
      },
    );

    test("a provider of another dashboard vouches for nobody here", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const otherDashboardsProvider: ObjectID = await addProvider({
        table: "DashboardSSO",
        dashboardId: otherDashboardId,
      });

      const sessionId: ObjectID = (
        await signIn({
          dashboardId,
          privateUserId: userId,
          ssoProviderId: otherDashboardsProvider,
        })
      ).session.id!;

      expect(
        await isSignedIn({ dashboardId, privateUserId: userId, sessionId }),
      ).toBe(false);
    });

    test("renewing rotates the refresh token in one write, and never writes over a sign-out that landed first", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const signedIn: PrivateUserSessionMetadata<DashboardPrivateUserSession> =
        await signIn({ dashboardId, privateUserId: userId });

      const session: DashboardPrivateUserSession | null =
        await DashboardPrivateUserSessionService.findActiveSessionByRefreshToken(
          signedIn.refreshToken,
        );

      const renewed: PrivateUserSessionMetadata<DashboardPrivateUserSession> | null =
        await DashboardPrivateUserSessionService.renewSessionWithNewRefreshToken(
          {
            session: session!,
            ipAddress: "203.0.113.7",
            userAgent: "Mozilla/5.0",
          },
        );

      expect(renewed?.refreshToken).toBeTruthy();
      expect(renewed?.refreshToken).not.toBe(signedIn.refreshToken);

      // The old token finds nothing; the new one finds the session.
      expect(
        await DashboardPrivateUserSessionService.findActiveSessionByRefreshToken(
          signedIn.refreshToken,
        ),
      ).toBeNull();
      expect(
        (
          await DashboardPrivateUserSessionService.findActiveSessionByRefreshToken(
            renewed!.refreshToken,
          )
        )?.id?.toString(),
      ).toBe(signedIn.session.id!.toString());

      // Signed out between the read and the write: the renewal writes nothing.
      const read: DashboardPrivateUserSession | null =
        await DashboardPrivateUserSessionService.findActiveSessionByRefreshToken(
          renewed!.refreshToken,
        );

      await DashboardPrivateUserSessionService.revokeSessionById(
        signedIn.session.id!,
        { reason: "Signed out" },
      );

      expect(
        await DashboardPrivateUserSessionService.renewSessionWithNewRefreshToken(
          {
            session: read!,
            ipAddress: "203.0.113.7",
            userAgent: "Mozilla/5.0",
          },
        ),
      ).toBeNull();

      const row: Record<string, unknown> | undefined = await sessionRow(
        signedIn.session.id!,
      );

      expect(row?.["isRevoked"]).toBe(true);
      expect(row?.["revokedReason"]).toBe("Signed out");
    });

    test("a single sign-on code signs nobody in until it is exchanged, once, on its own dashboard", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const providerId: ObjectID = await addProvider({
        table: "DashboardSSO",
        dashboardId,
      });

      const code: PrivateUserSessionMetadata<DashboardPrivateUserSession> =
        await DashboardPrivateUserSessionService.createLoginCodeSession({
          projectId,
          resourceId: dashboardId,
          privateUserId: userId,
          ssoProviderId: providerId,
          ipAddress: "203.0.113.7",
          userAgent: "Mozilla/5.0",
          signIn: { method: SignInMethod.Saml, ssoProviderName: "Acme Okta" },
        });

      // Good for five minutes, and no sign-in yet.
      const minutesLeft: number =
        (code.refreshTokenExpiresAt.getTime() - Date.now()) / 60000;

      expect(minutesLeft).toBeGreaterThan(4);
      expect(minutesLeft).toBeLessThanOrEqual(5);
      expect(
        await isSignedIn({
          dashboardId,
          privateUserId: userId,
          sessionId: code.session.id!,
        }),
      ).toBe(false);

      // Not on another dashboard.
      expect(
        await DashboardPrivateUserSessionService.exchangeLoginCode(
          code.refreshToken,
          { resourceId: otherDashboardId },
        ),
      ).toBeNull();

      const exchanged: PrivateUserSessionMetadata<DashboardPrivateUserSession> | null =
        await DashboardPrivateUserSessionService.exchangeLoginCode(
          code.refreshToken,
          { resourceId: dashboardId, ipAddress: "203.0.113.7" },
        );

      expect(exchanged?.refreshToken).toBeTruthy();
      expect(exchanged?.refreshToken).not.toBe(code.refreshToken);
      expect(
        await isSignedIn({
          dashboardId,
          privateUserId: userId,
          sessionId: code.session.id!,
        }),
      ).toBe(true);

      // Once.
      expect(
        await DashboardPrivateUserSessionService.exchangeLoginCode(
          code.refreshToken,
          { resourceId: dashboardId },
        ),
      ).toBeNull();

      // And the private user's last sign-in is written then.
      const users: Array<{ lastActive: Date | null }> = await query(
        `SELECT "lastActive" FROM "${schema}"."DashboardPrivateUser" WHERE "_id" = $1`,
        [userId.toString()],
      );

      expect(users[0]?.lastActive).toBeInstanceOf(Date);
    });

    test("a code that ran out exchanges nothing", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });

      const code: PrivateUserSessionMetadata<DashboardPrivateUserSession> =
        await DashboardPrivateUserSessionService.createLoginCodeSession({
          projectId,
          resourceId: dashboardId,
          privateUserId: userId,
          signIn: { method: SignInMethod.Saml },
        });

      await query(
        `UPDATE "${schema}"."DashboardPrivateUserSession" SET "refreshTokenExpiresAt" = now() - interval '1 second' WHERE "_id" = $1`,
        [code.session.id!.toString()],
      );

      expect(
        await DashboardPrivateUserSessionService.exchangeLoginCode(
          code.refreshToken,
          { resourceId: dashboardId },
        ),
      ).toBeNull();
    });

    test("a sign-out cookie ends only the live session it names, of its own private user and dashboard - never a code", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const otherUserId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "someone-else@example.com",
      });
      const sessionId: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;

      // Named with another user, or another dashboard: nothing ends.
      expect(
        await DashboardPrivateUserSessionService.revokeLiveSessionOfPrivateUser(
          {
            resourceId: dashboardId,
            privateUserId: otherUserId,
            sessionId,
          },
        ),
      ).toBe(false);
      expect(
        await DashboardPrivateUserSessionService.revokeLiveSessionOfPrivateUser(
          {
            resourceId: otherDashboardId,
            privateUserId: userId,
            sessionId,
          },
        ),
      ).toBe(false);
      expect(
        await isSignedIn({ dashboardId, privateUserId: userId, sessionId }),
      ).toBe(true);

      expect(
        await DashboardPrivateUserSessionService.revokeLiveSessionOfPrivateUser(
          {
            resourceId: dashboardId,
            privateUserId: userId,
            sessionId,
          },
        ),
      ).toBe(true);
      expect(
        await isSignedIn({ dashboardId, privateUserId: userId, sessionId }),
      ).toBe(false);

      const code: PrivateUserSessionMetadata<DashboardPrivateUserSession> =
        await DashboardPrivateUserSessionService.createLoginCodeSession({
          projectId,
          resourceId: dashboardId,
          privateUserId: userId,
          signIn: { method: SignInMethod.Saml },
        });

      expect(
        await DashboardPrivateUserSessionService.revokeLiveSessionOfPrivateUser(
          {
            resourceId: dashboardId,
            privateUserId: userId,
            sessionId: code.session.id!,
          },
        ),
      ).toBe(false);
    });

    test("a new password ends every session of the private user - codes too - and nobody else's, and ends their reset link", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const otherUserId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "someone-else@example.com",
      });

      const first: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;
      const second: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;
      const code: ObjectID = (
        await DashboardPrivateUserSessionService.createLoginCodeSession({
          projectId,
          resourceId: dashboardId,
          privateUserId: userId,
          signIn: { method: SignInMethod.Saml },
        })
      ).session.id!;
      const someoneElses: ObjectID = (
        await signIn({ dashboardId, privateUserId: otherUserId })
      ).session.id!;

      await query(
        `UPDATE "${schema}"."DashboardPrivateUser" SET "resetPasswordToken" = 'a-hash', "resetPasswordExpires" = now() + interval '1 day' WHERE "_id" = $1`,
        [userId.toString()],
      );

      await DashboardPrivateUserService.updateOneById({
        id: userId,
        data: { password: new HashedString(STRONG_PASSWORD) } as never,
        props: { isRoot: true },
      });

      for (const sessionId of [first, second, code]) {
        const row: Record<string, unknown> | undefined =
          await sessionRow(sessionId);

        expect(row?.["isRevoked"]).toBe(true);
        expect(row?.["revokedReason"]).toBe(
          PRIVATE_USER_SESSION_PASSWORD_CHANGED_REASON,
        );
      }

      expect((await sessionRow(someoneElses))?.["isRevoked"]).toBe(false);

      const users: Array<Record<string, unknown>> = await query(
        `SELECT "resetPasswordToken", "resetPasswordExpires", "hasPassword", "password" FROM "${schema}"."DashboardPrivateUser" WHERE "_id" = $1`,
        [userId.toString()],
      );

      expect(users[0]?.["resetPasswordToken"]).toBeNull();
      expect(users[0]?.["resetPasswordExpires"]).toBeNull();
      expect(users[0]?.["hasPassword"]).toBe(true);
      // Stored as its hash, never as typed.
      expect(users[0]?.["password"]).toBeTruthy();
      expect(users[0]?.["password"]).not.toBe(STRONG_PASSWORD);
    });

    test("a new password is held to the one password rule", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });

      await expect(
        DashboardPrivateUserService.updateOneById({
          id: userId,
          data: { password: new HashedString("short") } as never,
          props: { isRoot: true },
        }),
      ).rejects.toThrow();
    });

    test("removing a private user ends every session of theirs", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const sessionId: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;

      await DashboardPrivateUserService.deleteOneById({
        id: userId,
        props: { isRoot: true },
      });

      // The private user is gone, and their sessions with them (ON DELETE CASCADE).
      const users: Array<Record<string, unknown>> = await query(
        `SELECT "_id" FROM "${schema}"."DashboardPrivateUser" WHERE "_id" = $1`,
        [userId.toString()],
      );

      expect(users).toEqual([]);
      expect(await sessionRow(sessionId)).toBeUndefined();
      expect(
        await isSignedIn({ dashboardId, privateUserId: userId, sessionId }),
      ).toBe(false);
    });

    test("a reset link is found by its token's hash on its own dashboard alone, and says when it ran out", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const token: string = "1dab0000-0000-4000-8000-000000000001";
      const hash: string = await HashedString.hashValue(
        token,
        EncryptionSecret,
      );

      await query(
        `UPDATE "${schema}"."DashboardPrivateUser" SET "resetPasswordToken" = $2, "resetPasswordExpires" = now() + interval '1 day' WHERE "_id" = $1`,
        [userId.toString(), hash],
      );

      const found: { user: DashboardPrivateUser | null; isExpired: boolean } =
        await DashboardPrivateUserService.findByResetPasswordToken({
          resourceId: dashboardId,
          token,
        });

      expect(found.user?.id?.toString()).toBe(userId.toString());
      expect(found.isExpired).toBe(false);

      // The hash itself is no token, and another dashboard has no such link.
      expect(
        (
          await DashboardPrivateUserService.findByResetPasswordToken({
            resourceId: dashboardId,
            token: hash,
          })
        ).user,
      ).toBeNull();
      expect(
        (
          await DashboardPrivateUserService.findByResetPasswordToken({
            resourceId: otherDashboardId,
            token,
          })
        ).user,
      ).toBeNull();

      await query(
        `UPDATE "${schema}"."DashboardPrivateUser" SET "resetPasswordExpires" = now() - interval '1 minute' WHERE "_id" = $1`,
        [userId.toString()],
      );

      expect(
        (
          await DashboardPrivateUserService.findByResetPasswordToken({
            resourceId: dashboardId,
            token,
          })
        ).isExpired,
      ).toBe(true);
    });

    test("a new address ends the reset link sent to the old one", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });

      await query(
        `UPDATE "${schema}"."DashboardPrivateUser" SET "resetPasswordToken" = 'a-hash', "resetPasswordExpires" = now() + interval '1 day' WHERE "_id" = $1`,
        [userId.toString()],
      );

      await DashboardPrivateUserService.updateOneById({
        id: userId,
        data: { email: new Email("reader.new@example.com") } as never,
        props: { isRoot: true },
      });

      const users: Array<Record<string, unknown>> = await query(
        `SELECT "email", "resetPasswordToken" FROM "${schema}"."DashboardPrivateUser" WHERE "_id" = $1`,
        [userId.toString()],
      );

      expect(users[0]?.["email"]).toBe("reader.new@example.com");
      expect(users[0]?.["resetPasswordToken"]).toBeNull();
    });

    test("ending every session of a private user keeps when and why the ones already over ended", async () => {
      const userId: ObjectID = await addPrivateUser({
        dashboardId,
        email: "reader@example.com",
      });
      const signedOut: ObjectID = (
        await signIn({ dashboardId, privateUserId: userId })
      ).session.id!;

      await DashboardPrivateUserSessionService.revokeSessionById(signedOut, {
        reason: "Signed out",
      });

      await DashboardPrivateUserSessionService.revokeAllSessionsByPrivateUserId(
        userId,
        { reason: PRIVATE_USER_SESSION_PASSWORD_CHANGED_REASON },
      );

      expect((await sessionRow(signedOut))?.["revokedReason"]).toBe(
        "Signed out",
      );
    });
  },
);
