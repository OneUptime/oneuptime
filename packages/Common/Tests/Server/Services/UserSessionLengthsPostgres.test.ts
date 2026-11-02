import Entities from "../../../Models/DatabaseModels/Index";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserSessionService, {
  SESSION_END_REVOKED_REASONS,
  SessionLengthsImpact,
  SessionRenewalDecision,
} from "../../../Server/Services/UserSessionService";
import RealtimeAccessChanges, {
  RealtimeAccessChange,
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import {
  readSessionLengths,
  SESSION_LENGTH_SETTING_COLUMNS,
  SessionEndReason,
  SessionLengths,
  SessionLengthSettingColumn,
} from "../../../Types/UserSession/SessionLength";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { DataSource } from "typeorm";

/*
 * HOW LONG A SIGN-IN LASTS, AGAINST POSTGRES (UserSessionService.
 * endSessionsPastLengths, countPeoplePastLengths, getSessionLengthEndReason,
 * findActiveSessionByRefreshToken, and GlobalConfigService's change of the
 * lengths).
 *
 * Opt in with RUN_POSTGRES_USER_SESSION_LENGTH_TESTS=true against a
 * database the migrations have run on (USER_SESSION_LENGTH_TEST_DATABASE_*).
 * The real UserSession and GlobalConfig tables are cloned into an isolated
 * schema; nothing else is touched. The Enterprise module is a fake that
 * reads the lengths from the cloned GlobalConfig row, as the real one does
 * (ee/Server/SessionLength/SessionLengthStore).
 *
 *   - a shorter length ends, at once, every session already past it - by
 *     the database's clock, each with its reason, and tells every server
 *     (SessionsEnded); the sessions within it, and those already over, are
 *     left alone;
 *   - SSO sign-ins follow the lengths of every sign-in, or their own;
 *   - an idle timeout ends the sessions idle longer than it;
 *   - the Admin Dashboard's count says how many people a change signs out,
 *     and whether the asker is one of them, ending nothing;
 *   - saving the setting through GlobalConfigService applies it to the
 *     sessions there are, and a refresh after it can say why;
 *   - thousands of sessions end in batches.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_USER_SESSION_LENGTH_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["UserSession", "GlobalConfig"];

const ZERO_ID: string = ObjectID.getZeroObjectID().toString();

interface SessionRow {
  isRevoked: boolean;
  revokedReason: string | null;
  revokedAt: Date | null;
}

describePostgres("how long a sign-in lasts, against Postgres", () => {
  const schema: string = `user_session_length_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let fake: FakeEnterpriseModule;
  let announced: Array<RealtimeAccessChange> = [];

  const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<any> => {
    return database.query(sql, parameters);
  };

  // The lengths, as the Enterprise module reads them: from the GlobalConfig row.
  const readLengthsFromRow: () => Promise<SessionLengths> =
    async (): Promise<SessionLengths> => {
      const select: Record<string, true> = {};

      for (const column of SESSION_LENGTH_SETTING_COLUMNS) {
        select[column] = true;
      }

      const config: GlobalConfig | null = await GlobalConfigService.findOneById(
        {
          id: ObjectID.getZeroObjectID(),
          select: select,
          props: { isRoot: true },
        },
      );

      return readSessionLengths(
        config as unknown as Partial<
          Record<SessionLengthSettingColumn, unknown>
        > | null,
      );
    };

  const hashOf: (token: string) => Promise<string> = async (
    token: string,
  ): Promise<string> => {
    return await HashedString.hashValue(token, EncryptionSecret);
  };

  // A session, signed in and last active that many minutes ago.
  const insertSession: (data: {
    userId: ObjectID;
    signedInMinutesAgo: number;
    lastActiveMinutesAgo?: number | undefined;
    isSso?: boolean | undefined;
    isRevoked?: boolean | undefined;
    refreshTokenExpired?: boolean | undefined;
    refreshToken?: string | undefined;
  }) => Promise<ObjectID> = async (data: {
    userId: ObjectID;
    signedInMinutesAgo: number;
    lastActiveMinutesAgo?: number | undefined;
    isSso?: boolean | undefined;
    isRevoked?: boolean | undefined;
    refreshTokenExpired?: boolean | undefined;
    refreshToken?: string | undefined;
  }): Promise<ObjectID> => {
    const id: ObjectID = ObjectID.generate();
    const refreshToken: string = data.refreshToken || ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."UserSession"
       ("_id", "userId", "refreshToken", "refreshTokenExpiresAt", "createdAt", "lastActiveAt", "isRevoked", "revokedReason", "additionalInfo", "version")
       VALUES ($1, $2, $3,
         ${data.refreshTokenExpired ? "NOW() - INTERVAL '1 minute'" : "NOW() + INTERVAL '29 days'"},
         NOW() - make_interval(mins => $4), NOW() - make_interval(mins => $5), $6, $7, $8, 1)`,
      [
        id.toString(),
        data.userId.toString(),
        await hashOf(refreshToken),
        data.signedInMinutesAgo,
        data.lastActiveMinutesAgo ?? 0,
        Boolean(data.isRevoked),
        data.isRevoked ? "User logout" : null,
        JSON.stringify({ isGlobalLogin: !data.isSso }),
      ],
    );

    return id;
  };

  const rowOf: (id: ObjectID) => Promise<SessionRow> = async (
    id: ObjectID,
  ): Promise<SessionRow> => {
    const rows: Array<SessionRow> = await query(
      `SELECT "isRevoked", "revokedReason", "revokedAt" FROM "${schema}"."UserSession" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  };

  const setLengths: (
    values: Partial<Record<SessionLengthSettingColumn, number | boolean | null>>,
  ) => Promise<void> = async (
    values: Partial<Record<SessionLengthSettingColumn, number | boolean | null>>,
  ): Promise<void> => {
    const full: Record<SessionLengthSettingColumn, number | boolean | null> = {
      sessionLengthInMinutes: null,
      sessionIdleTimeoutInMinutes: null,
      useSeparateSsoSessionLengths: false,
      ssoSessionLengthInMinutes: null,
      ssoSessionIdleTimeoutInMinutes: null,
      ...values,
    };

    await query(
      `UPDATE "${schema}"."GlobalConfig" SET "sessionLengthInMinutes" = $1, "sessionIdleTimeoutInMinutes" = $2, "useSeparateSsoSessionLengths" = $3, "ssoSessionLengthInMinutes" = $4, "ssoSessionIdleTimeoutInMinutes" = $5 WHERE "_id" = $6`,
      [
        full.sessionLengthInMinutes,
        full.sessionIdleTimeoutInMinutes,
        full.useSeparateSsoSessionLengths,
        full.ssoSessionLengthInMinutes,
        full.ssoSessionIdleTimeoutInMinutes,
        ZERO_ID,
      ],
    );
  };

  const endedSessionIds: () => Array<string> = (): Array<string> => {
    return announced
      .filter((change: RealtimeAccessChange): boolean => {
        return change.kind === RealtimeAccessChangeKind.SessionsEnded;
      })
      .flatMap((change: RealtimeAccessChange): Array<string> => {
        return (
          (change as { sessionIds?: Array<string> | undefined }).sessionIds ||
          []
        );
      })
      .sort();
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["USER_SESSION_LENGTH_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["USER_SESSION_LENGTH_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["USER_SESSION_LENGTH_TEST_DATABASE_NAME"] ||
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
  });

  beforeEach(async () => {
    await query(
      `TRUNCATE ${TABLES.map((table: string): string => {
        return `"${schema}"."${table}"`;
      }).join(", ")}`,
    );
    await query(
      `INSERT INTO "${schema}"."GlobalConfig" ("_id", "version") VALUES ($1, 1)`,
      [ZERO_ID],
    );

    fake = installFakeEnterpriseModule();
    fake.getUserSessionLengths = async (): Promise<SessionLengths | null> => {
      fake.userSessionLengthsReads++;
      return await readLengthsFromRow();
    };

    announced = [];
    jest
      .spyOn(RealtimeAccessChanges, "announce")
      .mockImplementation((change: RealtimeAccessChange): void => {
        announced.push(change);
      });
  });

  afterEach(() => {
    uninstallEnterpriseModule();
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("a session length ends every session already past it, with its reason, and leaves the rest", async () => {
    const user: ObjectID = ObjectID.generate();
    const pastIt: ObjectID = await insertSession({
      userId: user,
      signedInMinutesAgo: 180,
    });
    const withinIt: ObjectID = await insertSession({
      userId: user,
      signedInMinutesAgo: 30,
    });
    const ssoPastIt: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 180,
      isSso: true,
    });
    const signedOut: ObjectID = await insertSession({
      userId: user,
      signedInMinutesAgo: 180,
      isRevoked: true,
    });
    const refreshTokenOver: ObjectID = await insertSession({
      userId: user,
      signedInMinutesAgo: 180,
      refreshTokenExpired: true,
    });

    await setLengths({ sessionLengthInMinutes: 60 });

    const ended: number = await UserSessionService.endSessionsPastLengths(
      await readLengthsFromRow(),
    );

    expect(ended).toBe(2);

    for (const id of [pastIt, ssoPastIt]) {
      const row: SessionRow = await rowOf(id);
      expect(row.isRevoked).toBe(true);
      expect(row.revokedReason).toBe(
        SESSION_END_REVOKED_REASONS[SessionEndReason.LengthReached],
      );
      expect(row.revokedAt).toBeTruthy();
    }

    expect((await rowOf(withinIt)).isRevoked).toBe(false);
    // Over already: left as they were, their reason too.
    expect(await rowOf(signedOut)).toEqual(
      expect.objectContaining({ isRevoked: true, revokedReason: "User logout" }),
    );
    expect((await rowOf(refreshTokenOver)).isRevoked).toBe(false);

    // Every server hears which sessions ended, so their live updates end too.
    expect(endedSessionIds()).toEqual(
      [pastIt.toString(), ssoPastIt.toString()].sort(),
    );
  });

  test("SSO sign-ins with lengths of their own are held to those, and every other sign-in to the general ones", async () => {
    const password: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 180,
    });
    const sso: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 180,
      isSso: true,
    });

    await setLengths({
      sessionLengthInMinutes: 60,
      useSeparateSsoSessionLengths: true,
      ssoSessionLengthInMinutes: null,
    });

    await expect(
      UserSessionService.endSessionsPastLengths(await readLengthsFromRow()),
    ).resolves.toBe(1);
    expect((await rowOf(password)).isRevoked).toBe(true);
    expect((await rowOf(sso)).isRevoked).toBe(false);

    // And the other way round: only SSO sign-ins limited.
    await setLengths({
      useSeparateSsoSessionLengths: true,
      ssoSessionLengthInMinutes: 120,
    });

    await expect(
      UserSessionService.endSessionsPastLengths(await readLengthsFromRow()),
    ).resolves.toBe(1);
    expect((await rowOf(sso)).revokedReason).toBe(
      SESSION_END_REVOKED_REASONS[SessionEndReason.LengthReached],
    );
  });

  test("an idle timeout ends the sessions idle longer than it, with its own reason", async () => {
    const idle: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 600,
      lastActiveMinutesAgo: 45,
    });
    const active: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 600,
      lastActiveMinutesAgo: 10,
    });

    await setLengths({ sessionIdleTimeoutInMinutes: 30 });

    await expect(
      UserSessionService.endSessionsPastLengths(await readLengthsFromRow()),
    ).resolves.toBe(1);
    expect((await rowOf(idle)).revokedReason).toBe(
      SESSION_END_REVOKED_REASONS[SessionEndReason.Inactive],
    );
    expect((await rowOf(active)).isRevoked).toBe(false);
  });

  test("without any lengths nothing is ended, however old", async () => {
    const old: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 60 * 24 * 300,
      lastActiveMinutesAgo: 60 * 24 * 20,
    });

    await expect(
      UserSessionService.endSessionsPastLengths(await readLengthsFromRow()),
    ).resolves.toBe(0);
    expect((await rowOf(old)).isRevoked).toBe(false);
  });

  test("the count a change is asked with: people, not sessions, whether the asker is one, and nothing ended", async () => {
    const somebody: ObjectID = ObjectID.generate();
    const askerSession: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 240,
    });
    await insertSession({ userId: somebody, signedInMinutesAgo: 200 });
    await insertSession({ userId: somebody, signedInMinutesAgo: 300 });
    const recent: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 5,
    });

    const lengths: SessionLengths = readSessionLengths({
      sessionLengthInMinutes: 60,
    });

    const withAsker: SessionLengthsImpact =
      await UserSessionService.countPeoplePastLengths({
        lengths,
        sessionId: askerSession,
      });

    expect(withAsker).toEqual({ peopleCount: 2, includesSession: true });

    await expect(
      UserSessionService.countPeoplePastLengths({
        lengths,
        sessionId: recent,
      }),
    ).resolves.toEqual({ peopleCount: 2, includesSession: false });

    await expect(
      UserSessionService.countPeoplePastLengths({ lengths }),
    ).resolves.toEqual({ peopleCount: 2, includesSession: false });

    // Counting ended nothing.
    expect((await rowOf(askerSession)).isRevoked).toBe(false);
    expect(endedSessionIds()).toEqual([]);
  });

  test("saving a shorter length applies it to the sessions there are, and a refresh after it says why", async () => {
    const refreshToken: string = "refresh-token-of-a-long-session";
    const longSession: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 300,
      refreshToken,
    });
    const newSession: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 5,
      refreshToken: "refresh-token-of-a-new-session",
    });

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: { sessionLengthInMinutes: 120 },
      props: { isRoot: true },
    });

    // Every server reads them again, and the server that saved them ended the sessions past them.
    expect(fake.forgetUserSessionLengthsCount).toBeGreaterThanOrEqual(1);
    expect(announced).toEqual(
      expect.arrayContaining([
        { kind: RealtimeAccessChangeKind.SessionLengthsChanged },
      ]),
    );
    expect((await rowOf(longSession)).isRevoked).toBe(true);
    expect((await rowOf(newSession)).isRevoked).toBe(false);

    // A refresh with the ended session's token finds no session to renew, and learns why.
    await expect(
      UserSessionService.findActiveSessionByRefreshToken(refreshToken),
    ).resolves.toBeNull();
    await expect(
      UserSessionService.getSessionLengthEndReason(refreshToken),
    ).resolves.toBe(SessionEndReason.LengthReached);
    await expect(
      UserSessionService.getSessionLengthEndReason(
        "refresh-token-of-a-new-session",
      ),
    ).resolves.toBeNull();
  });

  test("removing a length signs nobody out, and a renewal of a live session reads when it signed in from its row", async () => {
    await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 300,
      refreshToken: "refresh-token-to-renew",
    });

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: { sessionLengthInMinutes: null },
      props: { isRoot: true },
    });

    expect(endedSessionIds()).toEqual([]);

    const session: UserSession | null =
      await UserSessionService.findActiveSessionByRefreshToken(
        "refresh-token-to-renew",
      );

    expect(session?.createdAt).toBeTruthy();
    expect(Date.now() - new Date(session!.createdAt!).getTime()).toBeGreaterThan(
      290 * 60 * 1000,
    );

    // Under a 4-hour length set now, that renewal is refused.
    await setLengths({ sessionLengthInMinutes: 240 });

    const decision: SessionRenewalDecision =
      await UserSessionService.decideRenewal({
        session: session!,
        reportedInactivityInSeconds: null,
      });

    expect(decision).toEqual({
      hasEnded: true,
      reason: SessionEndReason.LengthReached,
    });
  });

  test("a change refused by the setting's rules ends nothing", async () => {
    const old: ObjectID = await insertSession({
      userId: ObjectID.generate(),
      signedInMinutesAgo: 300,
    });

    await expect(
      GlobalConfigService.updateOneById({
        id: ObjectID.getZeroObjectID(),
        data: { sessionLengthInMinutes: 5 },
        props: { isRoot: true },
      }),
    ).rejects.toThrow("A session length must be a whole number of minutes");

    expect((await rowOf(old)).isRevoked).toBe(false);
  });

  test("thousands of sessions past a length end in batches, every one of them", async () => {
    const user: ObjectID = ObjectID.generate();

    await query(
      `INSERT INTO "${schema}"."UserSession"
       ("_id", "userId", "refreshToken", "refreshTokenExpiresAt", "createdAt", "lastActiveAt", "isRevoked", "additionalInfo", "version")
       SELECT uuid_generate_v4(), $1, 'bulk-token-' || n, NOW() + INTERVAL '29 days', NOW() - INTERVAL '5 hours', NOW(), false, '{"isGlobalLogin": true}'::jsonb, 1
       FROM generate_series(1, 1234) AS n`,
      [user.toString()],
    );

    await setLengths({ sessionLengthInMinutes: 60 });

    await expect(
      UserSessionService.endSessionsPastLengths(await readLengthsFromRow()),
    ).resolves.toBe(1234);

    const live: Array<{ count: string }> = await query(
      `SELECT COUNT(*)::text AS count FROM "${schema}"."UserSession" WHERE "isRevoked" = false`,
    );

    expect(live[0]!.count).toBe("0");
    expect(endedSessionIds()).toHaveLength(1234);
  });
});
