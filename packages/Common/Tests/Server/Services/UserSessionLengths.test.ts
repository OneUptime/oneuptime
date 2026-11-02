import UserSession from "../../../Models/DatabaseModels/UserSession";
import UserSessionService, {
  Service,
  SESSION_END_REVOKED_REASONS,
  SessionMetadata,
  SessionRenewalDecision,
} from "../../../Server/Services/UserSessionService";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  SessionEndReason,
  SessionLengths,
} from "../../../Types/UserSession/SessionLength";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * HOW LONG A SIGN-IN LASTS, AS THE SESSIONS KEEP IT (UserSessionService,
 * Types/UserSession/SessionLength.ts).
 *
 *   - A sign-in reads the server's session lengths before it writes the
 *     session (createSession): a sign-in whose lengths cannot be read is
 *     refused, never handed a session that would outlive them. Its access
 *     token is signed to live 15 minutes or until the session ends, and an
 *     SSO sign-in's proof (the sso-<project> and Global SSO tokens) no
 *     longer than the length SSO sign-ins follow.
 *   - A renewal (decideRenewal) ends the session once its kind's session
 *     length has passed since it signed in, or its person has been idle for
 *     its kind's idle timeout - counting, while an idle timeout is set, what
 *     the browser reports of its person's inactivity, held within what the
 *     session knew and now. Without one the renewal is the activity, as it
 *     always was.
 *   - A session the lengths ended is revoked with its reason, so a refresh
 *     after it can say why (getSessionLengthEndReason).
 *
 * The SQL that ends every session past a change is run against Postgres
 * in UserSessionLengthsPostgres.test.ts.
 */

const NOW: Date = new Date("2026-11-02T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const SESSION_ID: ObjectID = new ObjectID(
  "61616161-6161-4161-8161-616161616161",
);
const USER_ID: ObjectID = new ObjectID("62626262-6262-4262-8262-626262626262");

const lengths: (
  standard: { length?: number | null; idle?: number | null },
  sso?: { length?: number | null; idle?: number | null },
) => SessionLengths = (
  standard: { length?: number | null; idle?: number | null },
  sso?: { length?: number | null; idle?: number | null },
): SessionLengths => {
  const ssoRule: { length?: number | null; idle?: number | null } =
    sso || standard;

  return {
    standard: {
      lengthInMinutes: standard.length ?? null,
      idleTimeoutInMinutes: standard.idle ?? null,
    },
    sso: {
      lengthInMinutes: ssoRule.length ?? null,
      idleTimeoutInMinutes: ssoRule.idle ?? null,
    },
  };
};

const storedSession: (data: {
  signedInAgoMs: number;
  lastActiveAgoMs: number;
  isGlobalLogin?: boolean | undefined;
}) => UserSession = (data: {
  signedInAgoMs: number;
  lastActiveAgoMs: number;
  isGlobalLogin?: boolean | undefined;
}): UserSession => {
  const session: UserSession = new UserSession();
  session.id = SESSION_ID;
  session.userId = USER_ID;
  session.createdAt = new Date(NOW.getTime() - data.signedInAgoMs);
  session.lastActiveAt = new Date(NOW.getTime() - data.lastActiveAgoMs);
  session.additionalInfo = {
    isGlobalLogin: data.isGlobalLogin !== false,
  };
  return session;
};

let fake: FakeEnterpriseModule;

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  fake = installFakeEnterpriseModule({ userSessionLengths: null });
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("what a session is", () => {
  test("an SSO sign-in is one created without a global login; every other sign-in, and one that does not say, is not", () => {
    const sso: UserSession = new UserSession();
    sso.additionalInfo = { isGlobalLogin: false };
    const password: UserSession = new UserSession();
    password.additionalInfo = { isGlobalLogin: true };
    const silent: UserSession = new UserSession();

    expect(Service.isSsoSignIn(sso)).toBe(true);
    expect(Service.isSsoSignIn(password)).toBe(false);
    expect(Service.isSsoSignIn(silent)).toBe(false);
  });

  test("its facts are its row's createdAt and lastActiveAt", () => {
    const session: UserSession = storedSession({
      signedInAgoMs: 3 * HOUR,
      lastActiveAgoMs: 5 * MINUTE,
      isGlobalLogin: false,
    });

    expect(Service.getSessionFacts(session, NOW)).toEqual({
      signedInAt: new Date(NOW.getTime() - 3 * HOUR),
      lastActiveAt: new Date(NOW.getTime() - 5 * MINUTE),
      isSsoSignIn: true,
    });
  });

  test("a row that does not say when it signed in counts from now, and its activity from its sign-in", () => {
    const session: UserSession = new UserSession();

    expect(Service.getSessionFacts(session, NOW)).toEqual({
      signedInAt: NOW,
      lastActiveAt: NOW,
      isSsoSignIn: false,
    });
  });
});

describe("how long the tokens a sign-in hands out live", () => {
  test("an access token lives 15 minutes, or until the session ends if that is sooner, and at least a second", () => {
    const facts: {
      signedInAt: Date;
      lastActiveAt: Date;
      isSsoSignIn: boolean;
    } = {
      signedInAt: new Date(NOW.getTime() - 50 * MINUTE),
      lastActiveAt: NOW,
      isSsoSignIn: false,
    };

    expect(
      Service.getAccessTokenExpiresInSeconds({
        facts,
        lengths: null,
        now: NOW,
      }),
    ).toBe(15 * 60);
    expect(
      Service.getAccessTokenExpiresInSeconds({
        facts,
        lengths: lengths({ length: 60 }),
        now: NOW,
      }),
    ).toBe(10 * 60);
    expect(
      Service.getAccessTokenExpiresInSeconds({
        facts,
        lengths: lengths({ length: 50 }),
        now: NOW,
      }),
    ).toBe(1);
  });

  test("an SSO sign-in's proof lasts 30 days, or the SSO session length when that is shorter", () => {
    expect(Service.getSsoSignInExpiresInSeconds(null)).toBe(30 * 24 * 60 * 60);
    expect(
      Service.getSsoSignInExpiresInSeconds(lengths({ length: 8 * 60 })),
    ).toBe(8 * 60 * 60);
    // Only the SSO rule counts, and an idle timeout does not shorten the proof.
    expect(
      Service.getSsoSignInExpiresInSeconds(
        lengths({ length: 60 }, { length: null, idle: 15 }),
      ),
    ).toBe(30 * 24 * 60 * 60);
  });
});

describe("UserSessionService.createSession", () => {
  test("hands out the session's facts and token lifetimes, as the server's lengths make them", async () => {
    fake.userSessionLengths = lengths({ length: 8 * 60 }, { length: 60 });

    const created: UserSession = storedSession({
      signedInAgoMs: 0,
      lastActiveAgoMs: 0,
      isGlobalLogin: false,
    });
    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "create")
      .mockResolvedValue(created as never);

    const metadata: SessionMetadata = await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: false,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(metadata.session).toBe(created);
    expect(metadata.signedInAt).toEqual(NOW);
    expect(metadata.lastActiveAt).toEqual(NOW);
    expect(metadata.accessTokenExpiresInSeconds).toBe(15 * 60);
    // An SSO sign-in's proof ends with the SSO session length.
    expect(metadata.ssoSignInExpiresInSeconds).toBe(60 * 60);
    expect(metadata.refreshToken).toEqual(expect.any(String));
  });

  test("writes the sign-in's kind on the session, which every later check reads", async () => {
    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "create")
      .mockImplementation((async (data: { data: UserSession }) => {
        return data.data;
      }) as never);

    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: true,
    });

    const written: UserSession = (
      create.mock.calls[0]![0] as { data: UserSession }
    ).data;

    expect(written.additionalInfo).toEqual({ isGlobalLogin: true });
    expect(written.lastActiveAt).toEqual(NOW);
  });

  test("is refused, writing nothing, when the lengths cannot be read", async () => {
    fake.userSessionLengthsError = new Error("lengths unreadable");
    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "create")
      .mockResolvedValue(new UserSession() as never);

    await expect(
      UserSessionService.createSession({
        userId: USER_ID,
        isGlobalLogin: true,
      }),
    ).rejects.toThrow("lengths unreadable");
    expect(create).not.toHaveBeenCalled();
  });

  test("on the Community Edition, every token lives as it always did", async () => {
    uninstallEnterpriseModule();
    jest
      .spyOn(UserSessionService, "create")
      .mockResolvedValue(
        storedSession({ signedInAgoMs: 0, lastActiveAgoMs: 0 }) as never,
      );

    const metadata: SessionMetadata = await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: true,
    });

    expect(metadata.accessTokenExpiresInSeconds).toBe(15 * 60);
    expect(metadata.ssoSignInExpiresInSeconds).toBe(30 * 24 * 60 * 60);
  });
});

describe("UserSessionService.decideRenewal", () => {
  test("without lengths, nothing ends a session but its refresh token, and the renewal is the activity - whatever the browser says", async () => {
    const decision: SessionRenewalDecision =
      await UserSessionService.decideRenewal({
        session: storedSession({
          signedInAgoMs: 300 * DAY,
          lastActiveAgoMs: 29 * DAY,
        }),
        reportedInactivityInSeconds: 3600,
      });

    expect(decision).toEqual({
      hasEnded: false,
      lastActiveAt: NOW,
      lengths: null,
    });
  });

  test("a session past its length has ended, however active its person is", async () => {
    fake.userSessionLengths = lengths({ length: 8 * 60 });

    await expect(
      UserSessionService.decideRenewal({
        session: storedSession({ signedInAgoMs: 9 * HOUR, lastActiveAgoMs: 0 }),
        reportedInactivityInSeconds: 0,
      }),
    ).resolves.toEqual({
      hasEnded: true,
      reason: SessionEndReason.LengthReached,
    });
  });

  test("a session within its length is renewed, with the lengths it is renewed under", async () => {
    fake.userSessionLengths = lengths({ length: 8 * 60 });

    const decision: SessionRenewalDecision =
      await UserSessionService.decideRenewal({
        session: storedSession({ signedInAgoMs: 7 * HOUR, lastActiveAgoMs: 0 }),
        reportedInactivityInSeconds: null,
      });

    expect(decision).toEqual({
      hasEnded: false,
      lastActiveAt: NOW,
      lengths: lengths({ length: 8 * 60 }),
    });
  });

  test("with an idle timeout, the browser's report of inactivity counts: a tab open but unused does not keep a session alive", async () => {
    fake.userSessionLengths = lengths({ idle: 30 });

    // Renewed 5 minutes ago in the background, but nobody has clicked for 40.
    await expect(
      UserSessionService.decideRenewal({
        session: storedSession({
          signedInAgoMs: 2 * HOUR,
          lastActiveAgoMs: 40 * MINUTE,
        }),
        reportedInactivityInSeconds: 40 * 60,
      }),
    ).resolves.toEqual({ hasEnded: true, reason: SessionEndReason.Inactive });
  });

  test("with an idle timeout, a report of recent activity renews it, as of that activity", async () => {
    fake.userSessionLengths = lengths({ idle: 30 });

    const decision: SessionRenewalDecision =
      await UserSessionService.decideRenewal({
        session: storedSession({
          signedInAgoMs: 2 * HOUR,
          lastActiveAgoMs: 20 * MINUTE,
        }),
        reportedInactivityInSeconds: 120,
      });

    expect(decision).toEqual({
      hasEnded: false,
      lastActiveAt: new Date(NOW.getTime() - 2 * MINUTE),
      lengths: lengths({ idle: 30 }),
    });
  });

  test("a report never moves the activity before what the session knew: another tab in use is never signed out by an idle one", async () => {
    fake.userSessionLengths = lengths({ idle: 30 });

    const decision: SessionRenewalDecision =
      await UserSessionService.decideRenewal({
        session: storedSession({
          signedInAgoMs: 2 * HOUR,
          lastActiveAgoMs: 3 * MINUTE,
        }),
        reportedInactivityInSeconds: 2 * 60 * 60,
      });

    expect(decision).toEqual({
      hasEnded: false,
      lastActiveAt: new Date(NOW.getTime() - 3 * MINUTE),
      lengths: lengths({ idle: 30 }),
    });
  });

  test("without a report (the mobile app, an older page), the session's own last activity decides, and the renewal is the activity", async () => {
    fake.userSessionLengths = lengths({ idle: 30 });

    await expect(
      UserSessionService.decideRenewal({
        session: storedSession({
          signedInAgoMs: 2 * HOUR,
          lastActiveAgoMs: 31 * MINUTE,
        }),
        reportedInactivityInSeconds: null,
      }),
    ).resolves.toEqual({ hasEnded: true, reason: SessionEndReason.Inactive });

    await expect(
      UserSessionService.decideRenewal({
        session: storedSession({
          signedInAgoMs: 2 * HOUR,
          lastActiveAgoMs: 29 * MINUTE,
        }),
        reportedInactivityInSeconds: null,
      }),
    ).resolves.toEqual({
      hasEnded: false,
      lastActiveAt: NOW,
      lengths: lengths({ idle: 30 }),
    });
  });

  test("an SSO sign-in is held to the SSO lengths", async () => {
    fake.userSessionLengths = lengths({ length: 60 }, { length: 12 * 60 });

    await expect(
      UserSessionService.decideRenewal({
        session: storedSession({
          signedInAgoMs: 2 * HOUR,
          lastActiveAgoMs: 0,
          isGlobalLogin: false,
        }),
        reportedInactivityInSeconds: 0,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ hasEnded: false }) as SessionRenewalDecision,
    );

    await expect(
      UserSessionService.decideRenewal({
        session: storedSession({ signedInAgoMs: 2 * HOUR, lastActiveAgoMs: 0 }),
        reportedInactivityInSeconds: 0,
      }),
    ).resolves.toEqual({
      hasEnded: true,
      reason: SessionEndReason.LengthReached,
    });
  });

  test("is refused when the lengths cannot be read: never renewed past them", async () => {
    fake.userSessionLengthsError = new Error("lengths unreadable");

    await expect(
      UserSessionService.decideRenewal({
        session: storedSession({ signedInAgoMs: 0, lastActiveAgoMs: 0 }),
        reportedInactivityInSeconds: null,
      }),
    ).rejects.toThrow("lengths unreadable");
  });
});

describe("UserSessionService.renewSessionWithNewRefreshToken", () => {
  test("writes the activity the renewal decided, and signs its token under the lengths it was decided with", async () => {
    fake.userSessionLengths = lengths({ length: 99999 });
    const session: UserSession = storedSession({
      signedInAgoMs: 50 * MINUTE,
      lastActiveAgoMs: 10 * MINUTE,
    });
    const lastActiveAt: Date = new Date(NOW.getTime() - 2 * MINUTE);

    const update: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "updateOneByIdAndFetch")
      .mockImplementation((async (data: { data: Partial<UserSession> }) => {
        const updated: UserSession = storedSession({
          signedInAgoMs: 50 * MINUTE,
          lastActiveAgoMs: 2 * MINUTE,
        });
        Object.assign(updated, data.data);
        return updated;
      }) as never);

    const metadata: SessionMetadata =
      await UserSessionService.renewSessionWithNewRefreshToken({
        session,
        lastActiveAt,
        lengths: lengths({ length: 60 }),
      });

    expect(
      (update.mock.calls[0]![0] as { data: Partial<UserSession> }).data
        .lastActiveAt,
    ).toEqual(lastActiveAt);
    expect(metadata.signedInAt).toEqual(new Date(NOW.getTime() - 50 * MINUTE));
    expect(metadata.lastActiveAt).toEqual(lastActiveAt);
    // Ten minutes left of the hour the lengths it was decided with allow.
    expect(metadata.accessTokenExpiresInSeconds).toBe(10 * 60);
    // The lengths were handed over: not read again.
    expect(fake.userSessionLengthsReads).toBe(0);
  });

  test("reads the lengths itself when they are not handed over", async () => {
    fake.userSessionLengths = lengths({ length: 60 });
    jest.spyOn(UserSessionService, "updateOneByIdAndFetch").mockResolvedValue(
      storedSession({
        signedInAgoMs: 55 * MINUTE,
        lastActiveAgoMs: 0,
      }) as never,
    );

    const metadata: SessionMetadata =
      await UserSessionService.renewSessionWithNewRefreshToken({
        session: storedSession({
          signedInAgoMs: 55 * MINUTE,
          lastActiveAgoMs: 0,
        }),
      });

    expect(fake.userSessionLengthsReads).toBe(1);
    expect(metadata.accessTokenExpiresInSeconds).toBe(5 * 60);
  });
});

describe("ending a session the lengths ended", () => {
  test.each([
    [SessionEndReason.LengthReached, "Session length reached"],
    [SessionEndReason.Inactive, "Idle timeout reached"],
  ])(
    "revokes it with its reason (%s)",
    async (reason: SessionEndReason, revokedReason: string) => {
      const revoke: ReturnType<typeof jest.spyOn> = jest
        .spyOn(UserSessionService, "revokeSessionById")
        .mockResolvedValue(undefined as never);

      await UserSessionService.endSessionByLength(SESSION_ID, reason);

      expect(SESSION_END_REVOKED_REASONS[reason]).toBe(revokedReason);
      expect(revoke).toHaveBeenCalledWith(SESSION_ID, {
        reason: revokedReason,
      });
    },
  );

  test("a refresh after it learns why, from the reason the session was revoked with", async () => {
    const revoked: UserSession = new UserSession();
    revoked.id = SESSION_ID;
    revoked.revokedReason =
      SESSION_END_REVOKED_REASONS[SessionEndReason.Inactive];
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "findOneBy")
      .mockResolvedValue(revoked as never);

    await expect(
      UserSessionService.getSessionLengthEndReason("refresh-token"),
    ).resolves.toBe(SessionEndReason.Inactive);

    // Looked up among revoked sessions only, by the refresh token's hash.
    const query: Record<string, unknown> = (
      find.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["isRevoked"]).toBe(true);
    expect(query["refreshToken"]).toBeTruthy();
    expect(String(query["refreshToken"])).not.toContain("refresh-token");
  });

  test("a session ended any other way, or none at all, has no length reason", async () => {
    const signedOut: UserSession = new UserSession();
    signedOut.revokedReason = "User logout";
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "findOneBy")
      .mockResolvedValue(signedOut as never);

    await expect(
      UserSessionService.getSessionLengthEndReason("refresh-token"),
    ).resolves.toBeNull();

    find.mockResolvedValue(null as never);
    await expect(
      UserSessionService.getSessionLengthEndReason("refresh-token"),
    ).resolves.toBeNull();
  });
});

describe("without lengths, a change ends and counts nothing, and asks the database nothing", () => {
  test("endSessionsPastLengths(null) ends no session", async () => {
    const update: ReturnType<typeof jest.spyOn> = jest.spyOn(
      UserSessionService,
      "updateBy",
    );

    await expect(UserSessionService.endSessionsPastLengths(null)).resolves.toBe(
      0,
    );
    expect(update).not.toHaveBeenCalled();
  });

  test("countPeoplePastLengths with no lengths signs out nobody", async () => {
    await expect(
      UserSessionService.countPeoplePastLengths({
        lengths: null,
        sessionId: SESSION_ID,
      }),
    ).resolves.toEqual({ peopleCount: 0, includesSession: false });
  });
});
