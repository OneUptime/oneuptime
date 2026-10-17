import Entities from "../../../Models/DatabaseModels/Index";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPagePrivateUserSessionService from "../../../Server/Services/StatusPagePrivateUserSessionService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Email from "../../../Types/Email";
import JsonWebTokenPurpose from "../../../Types/JsonWebTokenPurpose";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * SIGN READERS OUT AFTER, AGAINST POSTGRES
 * (StatusPage.privateUserSessionLengthInHours,
 * StatusPagePrivateUserSessionService.addSignInRule and
 * doesSignInStillCount).
 *
 * Opt in with RUN_POSTGRES_STATUS_PAGE_SESSION_LENGTH_TESTS=true against a
 * database the migrations have run on
 * (STATUS_PAGE_SESSION_LENGTH_TEST_DATABASE_*). The real tables are cloned
 * into an isolated schema; nothing else is touched. The limit is asked the
 * two ways the product asks it - a page read (StatusPageService.
 * hasReadAccess, handed the page) and a refresh or login code
 * (doesSignInStillCount, which reads the page's own row) - and they must
 * agree:
 *
 *   - with no limit a session counts however long ago it signed in;
 *   - with one, it counts only until that many hours have passed since its
 *     sign-in, by the database's clock, whichever way it signed in;
 *   - changing the limit applies to the sessions there are, at once;
 *   - a stored value no write could hold is no limit;
 *   - and a renewal sets the refresh token to expire at the end of the
 *     limit, as stored.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_STATUS_PAGE_SESSION_LENGTH_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "StatusPage",
  "StatusPagePrivateUser",
  "StatusPagePrivateUserSession",
  "StatusPageSSO",
  "StatusPageOIDC",
];

describePostgres("status page Sign Readers Out After against Postgres", () => {
  const schema: string = `status_page_session_length_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const statusPageId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const sessionId: ObjectID = ObjectID.generate();
  const samlProviderId: ObjectID = ObjectID.generate();
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
        process.env["STATUS_PAGE_SESSION_LENGTH_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["STATUS_PAGE_SESSION_LENGTH_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["STATUS_PAGE_SESSION_LENGTH_TEST_DATABASE_NAME"] ||
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
          purpose: JsonWebTokenPurpose.StatusPageSession,
        }),
      },
    } as ExpressRequest;
  });

  beforeEach(async () => {
    statusPage.requireSsoForLogin = false;
    delete statusPage.privateUserSessionLengthInHours;

    await query(
      `TRUNCATE ${TABLES.map((table: string): string => {
        return `"${schema}"."${table}"`;
      }).join(", ")}`,
    );
    await query(
      `INSERT INTO "${schema}"."StatusPage" ("_id", "projectId", "name", "slug", "requireSsoForLogin", "version") VALUES ($1, $2, 'Synthetic', 'synthetic', false, 1)`,
      [statusPageId.toString(), projectId.toString()],
    );
    await query(
      `INSERT INTO "${schema}"."StatusPagePrivateUser" ("_id", "projectId", "statusPageId", "version") VALUES ($1, $2, $3, 1)`,
      [userId.toString(), projectId.toString(), statusPageId.toString()],
    );
    // Its refresh token is live for another day: only the limit can end it.
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
       VALUES ($1, $2, $3, 'Entra ID', 'Synthetic', 'RSA-SHA256', 'SHA256', 'https://idp.example.com/sso', 'https://idp.example.com', 'synthetic-certificate', true, 1)`,
      [
        samlProviderId.toString(),
        projectId.toString(),
        statusPageId.toString(),
      ],
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  // The page's limit, in the row and in the page the read is handed.
  const setLimit: (lengthInHours: number | null) => Promise<void> = async (
    lengthInHours: number | null,
  ): Promise<void> => {
    if (lengthInHours === null) {
      delete statusPage.privateUserSessionLengthInHours;
    } else {
      statusPage.privateUserSessionLengthInHours = lengthInHours;
    }
    await query(
      `UPDATE "${schema}"."StatusPage" SET "privateUserSessionLengthInHours" = $1`,
      [lengthInHours],
    );
  };

  const signedInHoursAgo: (hours: number) => Promise<void> = async (
    hours: number,
  ): Promise<void> => {
    await query(
      `UPDATE "${schema}"."StatusPagePrivateUserSession" SET "createdAt" = NOW() - make_interval(mins => $1)`,
      [Math.round(hours * 60)],
    );
  };

  // Asked both ways; they must agree.
  async function stillCounts(): Promise<boolean> {
    await query(
      `UPDATE "${schema}"."StatusPage" SET "requireSsoForLogin" = $1`,
      [Boolean(statusPage.requireSsoForLogin)],
    );

    const byPageRead: boolean = (
      await StatusPageService.hasReadAccess({ statusPageId, req })
    ).hasReadAccess;
    const byRefresh: boolean =
      await StatusPagePrivateUserSessionService.doesSignInStillCount({
        sessionId,
      });

    expect(byRefresh).toBe(byPageRead);

    return byPageRead;
  }

  test("with no limit, a session counts however long ago it signed in", async () => {
    await signedInHoursAgo(40 * 24);
    expect(await stillCounts()).toBe(true);
  });

  test("with a limit, a session counts until that many hours have passed since its sign-in", async () => {
    await setLimit(12);

    await signedInHoursAgo(1);
    expect(await stillCounts()).toBe(true);

    await signedInHoursAgo(11.9);
    expect(await stillCounts()).toBe(true);

    await signedInHoursAgo(12.1);
    expect(await stillCounts()).toBe(false);

    await signedInHoursAgo(30);
    expect(await stillCounts()).toBe(false);
  });

  test("a session the page's SSO provider signed in ends at the limit too", async () => {
    await query(
      `UPDATE "${schema}"."StatusPagePrivateUserSession" SET "statusPageSsoId" = $1`,
      [samlProviderId.toString()],
    );
    statusPage.requireSsoForLogin = true;
    await setLimit(8);

    await signedInHoursAgo(7.5);
    expect(await stillCounts()).toBe(true);

    await signedInHoursAgo(8.5);
    expect(await stillCounts()).toBe(false);
  });

  test("shortening the limit signs out, at once, everyone signed in for longer", async () => {
    await signedInHoursAgo(13);

    await setLimit(24);
    expect(await stillCounts()).toBe(true);

    await setLimit(12);
    expect(await stillCounts()).toBe(false);
  });

  test("removing the limit lets a session that is otherwise live count again", async () => {
    await signedInHoursAgo(13);
    await setLimit(12);
    expect(await stillCounts()).toBe(false);

    await setLimit(null);
    expect(await stillCounts()).toBe(true);
  });

  test("the limit does not keep alive a session that has ended another way", async () => {
    await setLimit(720);
    await query(
      `UPDATE "${schema}"."StatusPagePrivateUserSession" SET "refreshTokenExpiresAt" = NOW() - INTERVAL '1 minute'`,
    );

    expect(
      (await StatusPageService.hasReadAccess({ statusPageId, req }))
        .hasReadAccess,
    ).toBe(false);
  });

  test.each([0, -4, 9000])(
    "a stored value no write could hold (%p) is no limit, read either way",
    async (stored: number) => {
      await signedInHoursAgo(40 * 24);
      // Written past the server's checks, as only the database itself could.
      await query(
        `UPDATE "${schema}"."StatusPage" SET "privateUserSessionLengthInHours" = $1`,
        [stored],
      );
      statusPage.privateUserSessionLengthInHours = stored;

      expect(await stillCounts()).toBe(true);
    },
  );

  test("a renewal sets the refresh token to expire at the end of the limit", async () => {
    await setLimit(12);
    await signedInHoursAgo(3);

    const session: StatusPagePrivateUserSession | null =
      await StatusPagePrivateUserSessionService.findOneById({
        id: sessionId,
        select: {
          _id: true,
          statusPageId: true,
          createdAt: true,
        },
        props: { isRoot: true },
      });

    expect(session?.createdAt).toBeInstanceOf(Date);

    const renewed: { refreshTokenExpiresAt: Date } =
      await StatusPagePrivateUserSessionService.renewSessionWithNewRefreshToken(
        { session: session! },
      );

    const rows: Array<{ expiresAt: Date; endsAt: Date }> = await query(
      `SELECT "refreshTokenExpiresAt" AS "expiresAt", "createdAt" + INTERVAL '12 hours' AS "endsAt" FROM "${schema}"."StatusPagePrivateUserSession" WHERE "_id" = $1`,
      [sessionId.toString()],
    );

    expect(new Date(rows[0]!.expiresAt).getTime()).toBe(
      new Date(rows[0]!.endsAt).getTime(),
    );
    expect(renewed.refreshTokenExpiresAt.getTime()).toBe(
      new Date(rows[0]!.endsAt).getTime(),
    );

    // Renewed, it still counts until then.
    expect(await stillCounts()).toBe(true);
  });
});
