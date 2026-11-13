import UserSession from "../../../Models/DatabaseModels/UserSession";
import UserSessionService, {
  Service,
  SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS,
} from "../../../Server/Services/UserSessionService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import { SessionAuditEvent } from "../../../Types/AuditLog/AuditLogSessionEvent";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RequestOrigin from "../../../Types/RequestOrigin";
import {
  getSessionEndCauseRevokedReason,
  SessionEndCause,
} from "../../../Types/UserSession/SessionEndCause";
import { SessionLengths } from "../../../Types/UserSession/SessionLength";
import {
  SecondFactor,
  SignInMethod,
} from "../../../Types/UserSession/SessionSignIn";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  MockedAuditLogRecorder,
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
 * PEOPLE'S SESSIONS IN THE AUDIT LOG, AS THE SESSION SERVICE HANDS THEM OVER
 * (issue #6762).
 *
 *   - A sign-in: createSession keeps how the person signed in and from
 *     where on the session, and hands the audit log a Sign In event read
 *     from that very row - so the entry about the session's end, read from
 *     the same row later, says the same.
 *   - An end: every revocation is an update through this service. The
 *     update's hook reads the sessions it is about to end (onBeforeUpdate),
 *     and once they are ended hands the audit log one event each, as what
 *     their cause makes them - Sign Out, Session Timeout or Session Revoked -
 *     with when a timed-out session ran out.
 *   - A sweep (endSessionsThatRanOut) ends the sessions past saving that
 *     nobody has ended yet, so their timeouts are recorded within minutes.
 *
 * The audit log itself is the fake enterprise module's recorder: what these
 * hand it is what the Enterprise recorder files in each project
 * (ee/Tests/Server/AuditLog/AuditLogRecorderSessions.test.ts).
 */

const NOW: Date = new Date("2026-11-11T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const SESSION_ID: ObjectID = new ObjectID(
  "71717171-7171-4171-8171-717171717171",
);
const OTHER_SESSION_ID: ObjectID = new ObjectID(
  "72727272-7272-4272-8272-727272727272",
);
const USER_ID: ObjectID = new ObjectID("73737373-7373-4373-8373-737373737373");
const PROJECT_ID: ObjectID = new ObjectID(
  "74747474-7474-4474-8474-747474747474",
);

const CHROME_ON_MAC: string =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const ORIGIN: RequestOrigin = {
  ipAddress: "203.0.113.7",
  location: "Berlin, Germany",
  device: "Brave 130 on macOS",
};

type HookedSessionService = {
  onBeforeUpdate: (
    updateBy: UpdateBy<UserSession>,
  ) => Promise<OnUpdate<UserSession>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<UserSession>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<UserSession>>;
};

const hooks: HookedSessionService =
  UserSessionService as unknown as HookedSessionService;

const lengthsOf: (standard: {
  length?: number | null;
  idle?: number | null;
}) => SessionLengths = (standard: {
  length?: number | null;
  idle?: number | null;
}): SessionLengths => {
  const rule: {
    lengthInMinutes: number | null;
    idleTimeoutInMinutes: number | null;
  } = {
    lengthInMinutes: standard.length ?? null,
    idleTimeoutInMinutes: standard.idle ?? null,
  };

  return { standard: rule, sso: { ...rule } };
};

// A session as a revocation's hook reads it.
const sessionRow: (data?: {
  id?: ObjectID;
  userId?: ObjectID | null;
  isRevoked?: boolean;
  signedInAgoMs?: number;
  lastActiveAgoMs?: number;
  refreshTokenExpiresAt?: Date;
  additionalInfo?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) => UserSession = (data?: {
  id?: ObjectID;
  userId?: ObjectID | null;
  isRevoked?: boolean;
  signedInAgoMs?: number;
  lastActiveAgoMs?: number;
  refreshTokenExpiresAt?: Date;
  additionalInfo?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}): UserSession => {
  const session: UserSession = new UserSession();
  session.id = data?.id || SESSION_ID;

  if (data?.userId !== null) {
    session.userId = data?.userId || USER_ID;
  }

  session.isRevoked = data?.isRevoked || false;
  session.createdAt = new Date(
    NOW.getTime() - (data?.signedInAgoMs ?? 3 * HOUR),
  );
  session.lastActiveAt = new Date(
    NOW.getTime() - (data?.lastActiveAgoMs ?? 20 * MINUTE),
  );
  session.refreshTokenExpiresAt =
    data?.refreshTokenExpiresAt || new Date(NOW.getTime() + 29 * DAY);
  session.additionalInfo = (data?.additionalInfo || {
    isGlobalLogin: true,
    signInMethod: SignInMethod.Password,
    secondFactor: SecondFactor.SecurityKey,
    signInDevice: "Chrome 130 on macOS",
    signInLocation: "Lisbon, Portugal",
  }) as JSONObject;
  session.ipAddress = data?.ipAddress || "198.51.100.4";
  session.userAgent = data?.userAgent || CHROME_ON_MAC;

  return session;
};

const revocationOf: (data: {
  revokedReason: string | null;
  props?: DatabaseCommonInteractionProps;
}) => UpdateBy<UserSession> = (data: {
  revokedReason: string | null;
  props?: DatabaseCommonInteractionProps;
}): UpdateBy<UserSession> => {
  return {
    query: { _id: SESSION_ID.toString() } as UpdateBy<UserSession>["query"],
    data: {
      isRevoked: true,
      revokedAt: NOW,
      revokedReason: data.revokedReason,
    } as UpdateBy<UserSession>["data"],
    props: data.props || { isRoot: true },
    limit: 1,
    skip: 0,
  };
};

let fake: FakeEnterpriseModule;
let recorder: MockedAuditLogRecorder;

// Every event the audit log was handed, in order.
const recordedEvents: () => Array<SessionAuditEvent> =
  (): Array<SessionAuditEvent> => {
    return recorder.recordSessionEvents.mock.calls.flatMap(
      (call: Array<unknown>): Array<SessionAuditEvent> => {
        return call[0] as Array<SessionAuditEvent>;
      },
    );
  };

/*
 * Runs a revocation's two hooks the way DatabaseService does: the hook
 * before reads the rows, the hook after is handed the ids the write ended.
 */
const revoke: (data: {
  rows: Array<UserSession>;
  revokedReason: string | null;
  updatedIds?: Array<ObjectID>;
  props?: DatabaseCommonInteractionProps;
}) => Promise<void> = async (data: {
  rows: Array<UserSession>;
  revokedReason: string | null;
  updatedIds?: Array<ObjectID>;
  props?: DatabaseCommonInteractionProps;
}): Promise<void> => {
  jest
    .spyOn(UserSessionService, "findRowsAndHoldUpdateToThem")
    .mockResolvedValue(data.rows as never);

  const updateBy: UpdateBy<UserSession> = revocationOf({
    revokedReason: data.revokedReason,
    ...(data.props ? { props: data.props } : {}),
  });

  const before: OnUpdate<UserSession> = await hooks.onBeforeUpdate(updateBy);

  await hooks.onUpdateSuccess(
    before,
    data.updatedIds ||
      data.rows.map((row: UserSession): ObjectID => {
        return row.id!;
      }),
  );
};

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest.spyOn(RealtimeAccessChanges, "announce").mockImplementation(() => {
    return undefined;
  });
  fake = installFakeEnterpriseModule({ userSessionLengths: null });
  recorder = fake.auditLogRecorder as MockedAuditLogRecorder;
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("a sign-in", () => {
  const createReturningWritten: () => ReturnType<
    typeof jest.spyOn
  > = (): ReturnType<typeof jest.spyOn> => {
    return jest
      .spyOn(UserSessionService, "create")
      .mockImplementation((async (data: { data: UserSession }) => {
        data.data.id = SESSION_ID;
        return data.data;
      }) as never);
  };

  test("keeps how and where it signed in on the session", async () => {
    const create: ReturnType<typeof jest.spyOn> = createReturningWritten();

    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: true,
      ipAddress: ORIGIN.ipAddress,
      userAgent: CHROME_ON_MAC,
      signIn: {
        method: SignInMethod.Password,
        secondFactor: SecondFactor.AuthenticatorApp,
      },
      requestOrigin: ORIGIN,
    });

    const written: UserSession = (
      create.mock.calls[0]![0] as { data: UserSession }
    ).data;

    expect(written.additionalInfo).toEqual({
      signInMethod: "Password",
      secondFactor: "Authenticator app",
      // What the request said, client hints and all - never the raw header.
      signInDevice: "Brave 130 on macOS",
      signInLocation: "Berlin, Germany",
      isGlobalLogin: true,
    });
  });

  test("is handed to the audit log once, as a Sign In about the session just made", async () => {
    createReturningWritten();

    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: true,
      ipAddress: ORIGIN.ipAddress,
      userAgent: CHROME_ON_MAC,
      signIn: {
        method: SignInMethod.Password,
        secondFactor: SecondFactor.AuthenticatorApp,
      },
      requestOrigin: ORIGIN,
    });

    expect(recorder.recordSessionEvents).toHaveBeenCalledTimes(1);
    expect(recordedEvents()).toEqual([
      {
        action: AuditLogAction.SignIn,
        userId: USER_ID,
        sessionId: SESSION_ID,
        signIn: {
          method: SignInMethod.Password,
          secondFactor: SecondFactor.AuthenticatorApp,
        },
        device: "Brave 130 on macOS",
        location: "Berlin, Germany",
        ipAddress: "203.0.113.7",
      },
    ]);
  });

  test("a project's single sign-on names its provider and project", async () => {
    const create: ReturnType<typeof jest.spyOn> = createReturningWritten();

    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: false,
      additionalInfo: { projectId: PROJECT_ID.toString() },
      signIn: {
        method: SignInMethod.Saml,
        ssoProviderName: "Acme Okta",
        ssoProjectId: PROJECT_ID,
      },
      requestOrigin: ORIGIN,
    });

    const written: UserSession = (
      create.mock.calls[0]![0] as { data: UserSession }
    ).data;

    expect(written.additionalInfo).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        signInMethod: "SAML single sign-on",
        ssoProviderName: "Acme Okta",
        isGlobalLogin: false,
      }),
    );

    const event: SessionAuditEvent = recordedEvents()[0]!;

    expect(event.signIn?.method).toBe(SignInMethod.Saml);
    expect(event.signIn?.ssoProviderName).toBe("Acme Okta");
    expect(event.signIn?.ssoProjectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("without a request handed over, the device is what its User-Agent says, and the address its own", async () => {
    createReturningWritten();

    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: true,
      ipAddress: "192.0.2.10",
      userAgent: CHROME_ON_MAC,
    });

    expect(recordedEvents()).toEqual([
      {
        action: AuditLogAction.SignIn,
        userId: USER_ID,
        sessionId: SESSION_ID,
        signIn: null,
        device: "Chrome 130 on macOS",
        location: undefined,
        ipAddress: "192.0.2.10",
      },
    ]);
  });

  test("a User-Agent of words is never repeated: nothing it says reaches the session", async () => {
    const create: ReturnType<typeof jest.spyOn> = createReturningWritten();

    await UserSessionService.createSession({
      userId: USER_ID,
      isGlobalLogin: true,
      userAgent: "Your account is locked. Call +1 555 0100 now.",
    });

    const written: UserSession = (
      create.mock.calls[0]![0] as { data: UserSession }
    ).data;

    expect(JSON.stringify(written.additionalInfo)).not.toContain("locked");
    expect(recordedEvents()[0]!.device).toBeUndefined();
  });

  test("goes ahead when the audit log fails", async () => {
    createReturningWritten();
    recorder.recordSessionEvents.mockRejectedValue(
      new Error("ClickHouse is down") as never,
    );

    await expect(
      UserSessionService.createSession({
        userId: USER_ID,
        isGlobalLogin: true,
        signIn: { method: SignInMethod.Passkey },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        refreshToken: expect.any(String),
      }),
    );
  });

  test("on the Community Edition there is no audit log, and the sign-in is as it was", async () => {
    uninstallEnterpriseModule();
    createReturningWritten();

    await expect(
      UserSessionService.createSession({
        userId: USER_ID,
        isGlobalLogin: true,
        signIn: { method: SignInMethod.Password },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ refreshToken: expect.any(String) }),
    );
    expect(recorder.recordSessionEvents).not.toHaveBeenCalled();
  });
});

describe("a revocation reads the sessions it is about to end", () => {
  test("with what an entry about their end needs, and the update held to them", async () => {
    const find: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue([sessionRow()] as never);

    const updateBy: UpdateBy<UserSession> = revocationOf({
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.SignedOut),
    });

    await hooks.onBeforeUpdate(updateBy);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]![0]).toBe(updateBy);
    expect(find.mock.calls[0]![1]).toEqual({
      _id: true,
      userId: true,
      isRevoked: true,
      createdAt: true,
      lastActiveAt: true,
      refreshTokenExpiresAt: true,
      additionalInfo: true,
      ipAddress: true,
      userAgent: true,
    });
  });

  test("an update that ends nothing reads nothing", async () => {
    const find: ReturnType<typeof jest.spyOn> = jest.spyOn(
      UserSessionService,
      "findRowsAndHoldUpdateToThem",
    );

    const renewal: UpdateBy<UserSession> = {
      ...revocationOf({ revokedReason: null }),
      data: { lastActiveAt: NOW } as UpdateBy<UserSession>["data"],
    };

    await expect(hooks.onBeforeUpdate(renewal)).resolves.toEqual({
      updateBy: renewal,
      carryForward: null,
    });
    expect(find).not.toHaveBeenCalled();
  });
});

describe("a session's end in the audit log", () => {
  test("a sign-out is a Sign Out, from where they signed out", async () => {
    await revoke({
      rows: [sessionRow()],
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.SignedOut),
      props: { isRoot: true, requestOrigin: ORIGIN },
    });

    expect(recordedEvents()).toEqual([
      {
        action: AuditLogAction.SignOut,
        userId: USER_ID,
        sessionId: SESSION_ID,
        signIn: {
          method: SignInMethod.Password,
          secondFactor: SecondFactor.SecurityKey,
        },
        // How it signed in, as it kept it - not the sign-out's browser.
        device: "Chrome 130 on macOS",
        location: "Lisbon, Portugal",
        // The address it was ended from.
        ipAddress: "203.0.113.7",
        endCause: SessionEndCause.SignedOut,
        signedInAt: new Date(NOW.getTime() - 3 * HOUR),
        lastActiveAt: new Date(NOW.getTime() - 20 * MINUTE),
      },
    ]);
  });

  test("a new password ends every session as a Session Revoked, from the last address each was used from", async () => {
    await revoke({
      rows: [sessionRow(), sessionRow({ id: OTHER_SESSION_ID })],
      revokedReason: getSessionEndCauseRevokedReason(
        SessionEndCause.PasswordChanged,
      ),
    });

    const events: Array<SessionAuditEvent> = recordedEvents();

    expect(recorder.recordSessionEvents).toHaveBeenCalledTimes(1);
    expect(
      events.map((event: SessionAuditEvent): Array<unknown> => {
        return [
          event.action,
          event.sessionId.toString(),
          event.endCause,
          event.ipAddress,
          event.endedAt,
        ];
      }),
    ).toEqual([
      [
        AuditLogAction.SessionRevoked,
        SESSION_ID.toString(),
        SessionEndCause.PasswordChanged,
        "198.51.100.4",
        undefined,
      ],
      [
        AuditLogAction.SessionRevoked,
        OTHER_SESSION_ID.toString(),
        SessionEndCause.PasswordChanged,
        "198.51.100.4",
        undefined,
      ],
    ]);
  });

  /*
   * An entry about a session says where that session was: a new password
   * set from another device, or a master admin's block, is not where the
   * session was used.
   */
  test("a revocation another request asked for names the session's own last address", async () => {
    await revoke({
      rows: [sessionRow({ ipAddress: "198.51.100.4" })],
      revokedReason: getSessionEndCauseRevokedReason(
        SessionEndCause.PasswordChanged,
      ),
      props: { isRoot: true, requestOrigin: ORIGIN },
    });

    expect(recordedEvents()[0]!.ipAddress).toBe("198.51.100.4");
  });

  test.each([
    [SessionEndCause.AccountBlocked, AuditLogAction.SessionRevoked],
    [SessionEndCause.TwoFactorReset, AuditLogAction.SessionRevoked],
    [SessionEndCause.TwoFactorRequired, AuditLogAction.SessionRevoked],
    [SessionEndCause.PasswordReset, AuditLogAction.SessionRevoked],
    [SessionEndCause.Expired, AuditLogAction.SessionTimeout],
  ])(
    "%s is recorded as %s",
    async (cause: SessionEndCause, action: AuditLogAction) => {
      await revoke({
        rows: [sessionRow()],
        revokedReason: getSessionEndCauseRevokedReason(
          cause as Exclude<SessionEndCause, SessionEndCause.Other>,
        ),
      });

      expect(recordedEvents()[0]!.action).toBe(action);
      expect(recordedEvents()[0]!.endCause).toBe(cause);
    },
  );

  test("an idle timeout says when it ran out: its last activity plus the idle timeout", async () => {
    fake.userSessionLengths = lengthsOf({ idle: 30 });

    await revoke({
      rows: [sessionRow({ lastActiveAgoMs: 2 * HOUR })],
      revokedReason: getSessionEndCauseRevokedReason(
        SessionEndCause.IdleTimeout,
      ),
    });

    const event: SessionAuditEvent = recordedEvents()[0]!;

    expect(event.action).toBe(AuditLogAction.SessionTimeout);
    expect(event.endCause).toBe(SessionEndCause.IdleTimeout);
    expect(event.endedAt).toEqual(
      new Date(NOW.getTime() - 2 * HOUR + 30 * MINUTE),
    );
  });

  test("a session length says when it ran out: its sign-in plus the length", async () => {
    fake.userSessionLengths = lengthsOf({ length: 8 * 60 });

    await revoke({
      rows: [sessionRow({ signedInAgoMs: 9 * HOUR })],
      revokedReason: getSessionEndCauseRevokedReason(
        SessionEndCause.LengthReached,
      ),
    });

    expect(recordedEvents()[0]!.endedAt).toEqual(
      new Date(NOW.getTime() - 9 * HOUR + 8 * HOUR),
    );
  });

  test("30 days without use says when its refresh token ran out", async () => {
    const ranOut: Date = new Date(NOW.getTime() - 3 * MINUTE);

    await revoke({
      rows: [sessionRow({ refreshTokenExpiresAt: ranOut })],
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.Expired),
    });

    expect(recordedEvents()[0]!.endedAt).toEqual(ranOut);
  });

  test("a timeout whose lengths cannot be read is recorded without the moment", async () => {
    fake.userSessionLengthsError = new Error("lengths unreadable");

    await revoke({
      rows: [sessionRow()],
      revokedReason: getSessionEndCauseRevokedReason(
        SessionEndCause.IdleTimeout,
      ),
    });

    const event: SessionAuditEvent = recordedEvents()[0]!;

    expect(event.action).toBe(AuditLogAction.SessionTimeout);
    expect(event.endedAt).toBeUndefined();
  });

  test("a revocation no cause names is a Session Revoked, for Other", async () => {
    await revoke({
      rows: [sessionRow()],
      revokedReason: "Session missing user",
    });

    expect(recordedEvents()[0]!.action).toBe(AuditLogAction.SessionRevoked);
    expect(recordedEvents()[0]!.endCause).toBe(SessionEndCause.Other);
  });

  test("a session revoked before is not recorded again", async () => {
    await revoke({
      rows: [sessionRow({ isRevoked: true })],
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.SignedOut),
    });

    expect(recorder.recordSessionEvents).not.toHaveBeenCalled();
  });

  test("only the sessions the write ended are recorded", async () => {
    await revoke({
      rows: [sessionRow(), sessionRow({ id: OTHER_SESSION_ID })],
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.SignedOut),
      // The other one was ended by someone else while this was on its way.
      updatedIds: [SESSION_ID],
    });

    expect(
      recordedEvents().map((event: SessionAuditEvent): string => {
        return event.sessionId.toString();
      }),
    ).toEqual([SESSION_ID.toString()]);
  });

  test("a row that names no person is not recorded", async () => {
    await revoke({
      rows: [sessionRow({ userId: null })],
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.SignedOut),
    });

    expect(recorder.recordSessionEvents).not.toHaveBeenCalled();
  });

  test("a session that did not keep how it signed in still says its device, from its User-Agent", async () => {
    await revoke({
      rows: [sessionRow({ additionalInfo: { isGlobalLogin: true } })],
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.SignedOut),
    });

    const event: SessionAuditEvent = recordedEvents()[0]!;

    expect(event.signIn).toBeNull();
    expect(event.device).toBe("Chrome 130 on macOS");
    expect(event.location).toBeUndefined();
  });

  test("the revocation goes ahead when the audit log fails, and live updates still end", async () => {
    recorder.recordSessionEvents.mockRejectedValue(
      new Error("ClickHouse is down") as never,
    );

    await expect(
      revoke({
        rows: [sessionRow()],
        revokedReason: getSessionEndCauseRevokedReason(
          SessionEndCause.SignedOut,
        ),
      }),
    ).resolves.toBeUndefined();
    expect(RealtimeAccessChanges.announce).toHaveBeenCalledTimes(1);
  });

  // DatabaseService hands an update with no hook before an empty list.
  test("an update that read nothing records nothing", async () => {
    await hooks.onUpdateSuccess(
      {
        updateBy: revocationOf({
          revokedReason: getSessionEndCauseRevokedReason(
            SessionEndCause.SignedOut,
          ),
        }),
        carryForward: [],
      },
      [SESSION_ID],
    );

    expect(recorder.recordSessionEvents).not.toHaveBeenCalled();
  });
});

describe("what a revocation writes", () => {
  test("a cause is kept as its words, and the request it came from rides along", async () => {
    const updateOneById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await UserSessionService.revokeSessionById(SESSION_ID, {
      cause: SessionEndCause.SignedOut,
      requestOrigin: ORIGIN,
    });

    expect(updateOneById).toHaveBeenCalledWith({
      id: SESSION_ID,
      data: {
        isRevoked: true,
        revokedAt: NOW,
        revokedReason: "User logout",
      },
      props: { isRoot: true, requestOrigin: ORIGIN },
    });
  });

  test("every session of a person, by its cause's words, as OneUptime", async () => {
    const updateBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "updateBy")
      .mockResolvedValue(0 as never);

    await UserSessionService.revokeAllSessionsByUserId(USER_ID, {
      cause: SessionEndCause.AccountBlocked,
    });

    expect(updateBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { userId: USER_ID, isRevoked: false },
        data: {
          isRevoked: true,
          revokedAt: NOW,
          revokedReason: "User blocked",
        },
        props: { isRoot: true },
      }),
    );
  });

  test("a reason no cause names is kept as it is", async () => {
    const updateOneById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await UserSessionService.revokeSessionById(SESSION_ID, {
      reason: "Session missing user",
    });
    await UserSessionService.revokeSessionById(SESSION_ID);

    expect(
      updateOneById.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { data: { revokedReason: unknown } }).data
          .revokedReason;
      }),
    ).toEqual(["Session missing user", null]);
  });

  test("the session lengths end a session with the timeout's words", async () => {
    const revokeSessionById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserSessionService, "revokeSessionById")
      .mockResolvedValue(undefined as never);

    const { SessionEndReason } = jest.requireActual(
      "../../../Types/UserSession/SessionLength",
    ) as typeof import("../../../Types/UserSession/SessionLength");

    await UserSessionService.endSessionByLength(
      SESSION_ID,
      SessionEndReason.Inactive,
    );
    await UserSessionService.endSessionByLength(
      SESSION_ID,
      SessionEndReason.LengthReached,
    );

    expect(revokeSessionById.mock.calls).toEqual([
      [SESSION_ID, { cause: SessionEndCause.IdleTimeout }],
      [SESSION_ID, { cause: SessionEndCause.LengthReached }],
    ]);
  });
});

describe("when a timed-out session ran out", () => {
  test("is never later than now", () => {
    expect(
      Service.getRanOutAt({
        session: sessionRow({
          refreshTokenExpiresAt: new Date(NOW.getTime() + DAY),
        }),
        cause: SessionEndCause.Expired,
        lengths: null,
        now: NOW,
      }),
    ).toEqual(NOW);
  });

  test("is nothing for an end that is not a timeout", () => {
    for (const cause of [
      SessionEndCause.SignedOut,
      SessionEndCause.PasswordChanged,
      SessionEndCause.AccountBlocked,
      SessionEndCause.Other,
    ]) {
      expect(
        Service.getRanOutAt({
          session: sessionRow(),
          cause,
          lengths: lengthsOf({ length: 60, idle: 30 }),
          now: NOW,
        }),
      ).toBeNull();
    }
  });

  test("a session length that is not set has no moment", () => {
    expect(
      Service.getRanOutAt({
        session: sessionRow(),
        cause: SessionEndCause.LengthReached,
        lengths: lengthsOf({ idle: 30 }),
        now: NOW,
      }),
    ).toBeNull();
  });

  // The idle timeout that is not set is the default: 30 days.
  test("an idle timeout that is not set is counted as the default 30 days", () => {
    expect(
      Service.getRanOutAt({
        session: sessionRow({ lastActiveAgoMs: 31 * DAY }),
        cause: SessionEndCause.IdleTimeout,
        lengths: lengthsOf({ length: 60 * 24 * 90 }),
        now: NOW,
      }),
    ).toEqual(new Date(NOW.getTime() - 31 * DAY + 30 * DAY));
  });

  test("an SSO sign-in is counted by the SSO lengths", () => {
    const lengths: SessionLengths = {
      standard: { lengthInMinutes: 8 * 60, idleTimeoutInMinutes: null },
      sso: { lengthInMinutes: 60, idleTimeoutInMinutes: null },
    };

    expect(
      Service.getRanOutAt({
        session: sessionRow({
          signedInAgoMs: 2 * HOUR,
          additionalInfo: { isGlobalLogin: false },
        }),
        cause: SessionEndCause.LengthReached,
        lengths,
        now: NOW,
      }),
    ).toEqual(new Date(NOW.getTime() - 2 * HOUR + HOUR));
  });
});

/*
 * A query builder that remembers what it was asked and answers each
 * batch's ids in turn.
 */
class FakeQuery {
  public conditions: Array<string> = [];
  public parameters: Record<string, unknown> = {};
  private batches: Array<Array<string>>;

  public constructor(batches: Array<Array<string>>) {
    this.batches = batches;
  }

  public where(condition: string, parameters?: Record<string, unknown>): this {
    return this.andWhere(condition, parameters);
  }

  public andWhere(
    condition: string,
    parameters?: Record<string, unknown>,
  ): this {
    this.conditions.push(condition);
    Object.assign(this.parameters, parameters || {});
    return this;
  }

  public select(): this {
    return this;
  }

  public limit(): this {
    return this;
  }

  public async getRawMany(): Promise<Array<{ sessionId: string }>> {
    return (this.batches.shift() || []).map(
      (sessionId: string): { sessionId: string } => {
        return { sessionId };
      },
    );
  }
}

describe("the sweep that ends sessions that ran out", () => {
  /*
   * Each batch of each kind of session asks a fresh query; `answers` are
   * the ids each query answers, in the order they are asked.
   */
  const sweepWith: (data: {
    lengths: SessionLengths | null;
    answers: Array<Array<string>>;
  }) => Promise<{
    ended: number;
    queries: Array<FakeQuery>;
    updates: Array<UpdateBy<UserSession>>;
  }> = async (data: {
    lengths: SessionLengths | null;
    answers: Array<Array<string>>;
  }): Promise<{
    ended: number;
    queries: Array<FakeQuery>;
    updates: Array<UpdateBy<UserSession>>;
  }> => {
    const queries: Array<FakeQuery> = [];
    const answers: Array<Array<string>> = [...data.answers];

    jest
      .spyOn(UserSessionService, "getQueryBuilder")
      .mockImplementation((() => {
        const query: FakeQuery = new FakeQuery([answers.shift() || []]);
        queries.push(query);
        return query;
      }) as never);

    const updates: Array<UpdateBy<UserSession>> = [];

    jest.spyOn(UserSessionService, "updateBy").mockImplementation((async (
      updateBy: UpdateBy<UserSession>,
    ) => {
      updates.push(updateBy);
      return 0;
    }) as never);

    const ended: number = await UserSessionService.endSessionsThatRanOut(
      data.lengths,
    );

    return { ended, queries, updates };
  };

  test("ends the sessions whose refresh token ran out in the last day, with the timeout's words", async () => {
    const { ended, queries, updates } = await sweepWith({
      lengths: null,
      answers: [[SESSION_ID.toString(), OTHER_SESSION_ID.toString()]],
    });

    expect(ended).toBe(2);
    expect(queries[0]!.conditions).toEqual([
      "session.isRevoked = false",
      "session.refreshTokenExpiresAt <= NOW()",
      "session.refreshTokenExpiresAt > NOW() - make_interval(hours => :ranOutLookbackHours)",
    ]);
    expect(queries[0]!.parameters["ranOutLookbackHours"]).toBe(
      SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS,
    );
    expect(SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS).toBe(24);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.data).toEqual({
      isRevoked: true,
      revokedAt: NOW,
      revokedReason: getSessionEndCauseRevokedReason(SessionEndCause.Expired),
    });
    // Through updateBy, as OneUptime, so its hooks record every end.
    expect(updates[0]!.props).toEqual({ isRoot: true });
  });

  test("without a session length, ends nothing else - an idle timeout is decided at its renewal", async () => {
    const { queries } = await sweepWith({
      lengths: lengthsOf({ idle: 30 }),
      answers: [],
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.conditions.join(" ")).not.toContain("lastActiveAt");
  });

  test("with a session length, ends the live sessions past it, for the last day", async () => {
    const { ended, queries, updates } = await sweepWith({
      lengths: lengthsOf({ length: 8 * 60, idle: 30 }),
      // Nothing ran out of its refresh token; one standard sign-in past its length.
      answers: [[], [SESSION_ID.toString()]],
    });

    expect(ended).toBe(1);

    const lengthQuery: FakeQuery = queries.find((query: FakeQuery): boolean => {
      return query.conditions.some((condition: string): boolean => {
        return condition.includes("session.createdAt <= NOW()");
      });
    })!;

    expect(lengthQuery.conditions).toEqual(
      expect.arrayContaining([
        "session.isRevoked = false",
        "session.refreshTokenExpiresAt > NOW()",
        "session.createdAt > NOW() - make_interval(mins => :ranOutLookbackMinutes)",
      ]),
    );
    expect(lengthQuery.parameters["pastLengthMinutes0"]).toBe(8 * 60);
    expect(lengthQuery.parameters["ranOutLookbackMinutes"]).toBe(
      8 * 60 + SESSIONS_RAN_OUT_LOOKBACK_IN_HOURS * 60,
    );
    expect(updates[0]!.data).toEqual(
      expect.objectContaining({
        revokedReason: getSessionEndCauseRevokedReason(
          SessionEndCause.LengthReached,
        ),
      }),
    );
  });

  test("ends nothing, and writes nothing, when nothing ran out", async () => {
    const { ended, updates } = await sweepWith({
      lengths: lengthsOf({ length: 60 }),
      answers: [],
    });

    expect(ended).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
