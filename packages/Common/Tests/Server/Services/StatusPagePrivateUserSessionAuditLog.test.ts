import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPagePrivateUserSessionService, {
  Service,
} from "../../../Server/Services/StatusPagePrivateUserSessionService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
  SESSION_END_CAUSE_DESCRIPTIONS,
} from "../../../Types/AuditLog/AuditLogSessionEvent";
import {
  STATUS_PAGE_SESSION_PASSWORD_CHANGED_REASON,
  STATUS_PAGE_SESSION_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
  STATUS_PAGE_SESSION_SIGNED_OUT_REASON,
  StatusPageSessionAuditEvent,
} from "../../../Types/AuditLog/AuditLogStatusPageSession";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RequestOrigin from "../../../Types/RequestOrigin";
import { SessionEndCause } from "../../../Types/UserSession/SessionEndCause";
import { SignInMethod } from "../../../Types/UserSession/SessionSignIn";
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
 * A PRIVATE STATUS PAGE'S READERS' SESSIONS IN THE AUDIT LOG, AS THE SESSION
 * SERVICE HANDS THEM OVER (issue #6790).
 *
 *   - A sign-in: createSession keeps how the reader signed in and from
 *     where on the session, and hands the audit log a Sign In read from
 *     that row - unless it is an SSO login code, which signs nobody in
 *     until it is exchanged (exchangeLoginCode hands it over then).
 *   - An end: every revocation is an update through this service. The hook
 *     before reads the sessions it is about to end, and once they have
 *     ended the audit log is handed one event each - a Sign Out, or a
 *     Session Revoked - by the words the revocation was kept with.
 *
 * The audit log itself is the fake enterprise module's recorder: what these
 * hand it is what the Enterprise recorder files in the status page's
 * project (ee/Tests/Server/AuditLog/AuditLogRecorderStatusPageSessions.test.ts).
 */

const NOW: Date = new Date("2026-11-16T09:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

const SESSION_ID: ObjectID = new ObjectID(
  "81818181-8181-4181-8181-818181818181",
);
const OTHER_SESSION_ID: ObjectID = new ObjectID(
  "82828282-8282-4282-8282-828282828282",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "83838383-8383-4383-8383-838383838383",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "84848484-8484-4484-8484-848484848484",
);
const READER_ID: ObjectID = new ObjectID(
  "85858585-8585-4585-8585-858585858585",
);
const READER_EMAIL: string = "customer@example.com";

const CHROME_ON_MAC: string =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const ORIGIN: RequestOrigin = {
  ipAddress: "203.0.113.7",
  location: "Berlin, Germany",
  device: "Firefox 132 on Windows",
};

type HookedSessionService = {
  onBeforeUpdate: (
    updateBy: UpdateBy<StatusPagePrivateUserSession>,
  ) => Promise<OnUpdate<StatusPagePrivateUserSession>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<StatusPagePrivateUserSession>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<StatusPagePrivateUserSession>>;
};

const hooks: HookedSessionService =
  StatusPagePrivateUserSessionService as unknown as HookedSessionService;

let fake: FakeEnterpriseModule;
let recorder: MockedAuditLogRecorder;
let findReaders: ReturnType<typeof jest.spyOn>;

// Every reader's session event the audit log was handed, in order.
const recordedEvents: () => Array<StatusPageSessionAuditEvent> =
  (): Array<StatusPageSessionAuditEvent> => {
    return recorder.recordStatusPageSessionEvents.mock.calls.flatMap(
      (call: Array<unknown>): Array<StatusPageSessionAuditEvent> => {
        return call[0] as Array<StatusPageSessionAuditEvent>;
      },
    );
  };

// A reader's session as a revocation's hook reads it.
const sessionRow: (data?: {
  id?: ObjectID;
  isRevoked?: boolean;
  additionalInfo?: Record<string, unknown>;
  readerId?: ObjectID | null;
}) => StatusPagePrivateUserSession = (data?: {
  id?: ObjectID;
  isRevoked?: boolean;
  additionalInfo?: Record<string, unknown>;
  readerId?: ObjectID | null;
}): StatusPagePrivateUserSession => {
  const session: StatusPagePrivateUserSession =
    new StatusPagePrivateUserSession();
  session.id = data?.id || SESSION_ID;
  session.projectId = PROJECT_ID;
  session.statusPageId = STATUS_PAGE_ID;

  if (data?.readerId !== null) {
    session.statusPagePrivateUserId = data?.readerId || READER_ID;
  }

  session.isRevoked = data?.isRevoked || false;
  session.createdAt = new Date(NOW.getTime() - 5 * HOUR);
  session.lastActiveAt = new Date(NOW.getTime() - HOUR);
  session.additionalInfo = (data?.additionalInfo || {
    signInMethod: SignInMethod.Password,
    signInDevice: "Chrome 130 on macOS",
    signInLocation: "Lisbon, Portugal",
  }) as JSONObject;
  session.ipAddress = "198.51.100.4";
  session.userAgent = CHROME_ON_MAC;

  return session;
};

/*
 * Runs a revocation's two hooks the way DatabaseService does: the hook
 * before reads the rows, the hook after is handed the ids the write ended.
 */
const revoke: (data: {
  rows: Array<StatusPagePrivateUserSession>;
  revokedReason: string | null;
  updatedIds?: Array<ObjectID>;
  props?: DatabaseCommonInteractionProps;
}) => Promise<void> = async (data: {
  rows: Array<StatusPagePrivateUserSession>;
  revokedReason: string | null;
  updatedIds?: Array<ObjectID>;
  props?: DatabaseCommonInteractionProps;
}): Promise<void> => {
  jest
    .spyOn(StatusPagePrivateUserSessionService, "findRowsAndHoldUpdateToThem")
    .mockResolvedValue(data.rows as never);

  const updateBy: UpdateBy<StatusPagePrivateUserSession> = {
    query: {
      _id: SESSION_ID.toString(),
    } as UpdateBy<StatusPagePrivateUserSession>["query"],
    data: {
      isRevoked: true,
      revokedAt: NOW,
      revokedReason: data.revokedReason,
    } as UpdateBy<StatusPagePrivateUserSession>["data"],
    props: data.props || { isRoot: true },
    limit: 1,
    skip: 0,
  };

  const before: OnUpdate<StatusPagePrivateUserSession> =
    await hooks.onBeforeUpdate(updateBy);

  await hooks.onUpdateSuccess(
    before,
    data.updatedIds ||
      data.rows.map((row: StatusPagePrivateUserSession): ObjectID => {
        return row.id!;
      }),
  );
};

const createReturningWritten: () => ReturnType<
  typeof jest.spyOn
> = (): ReturnType<typeof jest.spyOn> => {
  return jest
    .spyOn(StatusPagePrivateUserSessionService, "create")
    .mockImplementation((async (data: {
      data: StatusPagePrivateUserSession;
    }) => {
      data.data.id = SESSION_ID;
      data.data.createdAt = NOW;
      return data.data;
    }) as never);
};

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  fake = installFakeEnterpriseModule();
  recorder = fake.auditLogRecorder as MockedAuditLogRecorder;

  findReaders = jest
    .spyOn(StatusPagePrivateUserService, "findBy")
    .mockImplementation((async () => {
      const reader: StatusPagePrivateUser = new StatusPagePrivateUser();
      reader.id = READER_ID;
      reader.email = new Email(READER_EMAIL);
      return [reader];
    }) as never);

  // The reader's last activity, which a sign-in stamps.
  jest.spyOn(StatusPagePrivateUserService, "getRepository").mockReturnValue({
    update: jest.fn(async () => {
      return { affected: 1 };
    }),
  } as never);
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("a reader's sign-in", () => {
  test("keeps how and where they signed in on the session", async () => {
    const create: ReturnType<typeof jest.spyOn> = createReturningWritten();

    await StatusPagePrivateUserSessionService.createSession({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPagePrivateUserId: READER_ID,
      refreshTokenExpiresAt: new Date(NOW.getTime() + 24 * HOUR),
      ipAddress: ORIGIN.ipAddress,
      userAgent: CHROME_ON_MAC,
      signIn: { method: SignInMethod.Password },
      requestOrigin: ORIGIN,
    });

    const written: StatusPagePrivateUserSession = (
      create.mock.calls[0]![0] as { data: StatusPagePrivateUserSession }
    ).data;

    expect(written.additionalInfo).toEqual({
      signInMethod: "Password",
      // What the request said - never the raw header.
      signInDevice: "Firefox 132 on Windows",
      signInLocation: "Berlin, Germany",
    });
  });

  test("is handed to the audit log once, as a Sign In about the session, in the status page's project", async () => {
    createReturningWritten();

    await StatusPagePrivateUserSessionService.createSession({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPagePrivateUserId: READER_ID,
      refreshTokenExpiresAt: new Date(NOW.getTime() + 24 * HOUR),
      ipAddress: ORIGIN.ipAddress,
      userAgent: CHROME_ON_MAC,
      signIn: { method: SignInMethod.SignInLink },
      requestOrigin: ORIGIN,
    });

    expect(recorder.recordStatusPageSessionEvents).toHaveBeenCalledTimes(1);
    expect(recordedEvents()).toEqual([
      {
        action: AuditLogAction.SignIn,
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        readerEmail: READER_EMAIL,
        signIn: { method: SignInMethod.SignInLink },
        device: "Firefox 132 on Windows",
        location: "Berlin, Germany",
        ipAddress: "203.0.113.7",
      },
    ]);
    // Only the reader's address is looked up, by their id.
    expect(findReaders).toHaveBeenCalledTimes(1);
    expect(
      (findReaders.mock.calls[0]![0] as { select: JSONObject }).select,
    ).toEqual({ _id: true, email: true });
  });

  test("without a request handed over, the device is what its User-Agent says", async () => {
    createReturningWritten();

    await StatusPagePrivateUserSessionService.createSession({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPagePrivateUserId: READER_ID,
      refreshTokenExpiresAt: new Date(NOW.getTime() + 24 * HOUR),
      ipAddress: "192.0.2.10",
      userAgent: CHROME_ON_MAC,
    });

    const event: StatusPageSessionAuditEvent = recordedEvents()[0]!;

    expect(event.device).toBe("Chrome 130 on macOS");
    expect(event.ipAddress).toBe("192.0.2.10");
    expect(event.signIn).toBeNull();
    expect(JSON.stringify(event)).not.toContain("Mozilla");
  });

  test("an SSO login code signs nobody in until it is exchanged: nothing is recorded", async () => {
    createReturningWritten();

    await StatusPagePrivateUserSessionService.createLoginCodeSession({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPagePrivateUserId: READER_ID,
      statusPageSsoId: ObjectID.generate(),
      signIn: { method: SignInMethod.Saml, ssoProviderName: "Acme Okta" },
      requestOrigin: ORIGIN,
    });

    expect(recorder.recordStatusPageSessionEvents).not.toHaveBeenCalled();
  });

  test("the exchanged code is the sign-in, with the provider the code kept", async () => {
    const loginCodeSession: StatusPagePrivateUserSession = sessionRow({
      additionalInfo: {
        oneuptimeStatusPageSessionPurpose: "login-code",
        signInMethod: SignInMethod.Saml,
        ssoProviderName: "Acme Okta",
        signInDevice: "Firefox 132 on Windows",
      },
    });
    loginCodeSession.refreshTokenExpiresAt = new Date(NOW.getTime() + 60000);

    jest
      .spyOn(
        StatusPagePrivateUserSessionService,
        "findActiveSessionByRefreshToken",
      )
      .mockResolvedValue(loginCodeSession as never);
    jest
      .spyOn(StatusPagePrivateUserSessionService, "getRepository")
      .mockReturnValue({
        update: jest.fn(async () => {
          return { affected: 1 };
        }),
      } as never);
    jest
      .spyOn(
        StatusPagePrivateUserSessionService as unknown as {
          getRefreshTokenExpiryForPage: () => Promise<Date>;
        },
        "getRefreshTokenExpiryForPage",
      )
      .mockResolvedValue(new Date(NOW.getTime() + 24 * HOUR) as never);

    await StatusPagePrivateUserSessionService.exchangeLoginCode(
      ObjectID.generate().toString(),
      {
        statusPageId: STATUS_PAGE_ID,
        ipAddress: "203.0.113.99",
        userAgent: CHROME_ON_MAC,
      },
    );

    expect(recordedEvents()).toEqual([
      {
        action: AuditLogAction.SignIn,
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        readerEmail: READER_EMAIL,
        signIn: {
          method: SignInMethod.Saml,
          ssoProviderName: "Acme Okta",
        },
        device: "Firefox 132 on Windows",
        location: undefined,
        ipAddress: "203.0.113.99",
      },
    ]);
  });

  test("a code that is not exchanged records nothing", async () => {
    jest
      .spyOn(
        StatusPagePrivateUserSessionService,
        "findActiveSessionByRefreshToken",
      )
      .mockResolvedValue(null as never);

    await expect(
      StatusPagePrivateUserSessionService.exchangeLoginCode(
        ObjectID.generate().toString(),
        { statusPageId: STATUS_PAGE_ID },
      ),
    ).resolves.toBeNull();
    expect(recorder.recordStatusPageSessionEvents).not.toHaveBeenCalled();
  });

  test("goes ahead when the audit log fails", async () => {
    createReturningWritten();
    recorder.recordStatusPageSessionEvents.mockRejectedValue(
      new Error("ClickHouse is down") as never,
    );

    await expect(
      StatusPagePrivateUserSessionService.createSession({
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        statusPagePrivateUserId: READER_ID,
        refreshTokenExpiresAt: new Date(NOW.getTime() + 24 * HOUR),
      }),
    ).resolves.toEqual(
      expect.objectContaining({ refreshToken: expect.any(String) }),
    );
  });

  test("and when the reader cannot be looked up", async () => {
    createReturningWritten();
    findReaders.mockRejectedValue(new Error("Postgres is down") as never);

    await expect(
      StatusPagePrivateUserSessionService.createSession({
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        statusPagePrivateUserId: READER_ID,
        refreshTokenExpiresAt: new Date(NOW.getTime() + 24 * HOUR),
      }),
    ).resolves.toEqual(
      expect.objectContaining({ refreshToken: expect.any(String) }),
    );
    expect(recorder.recordStatusPageSessionEvents).not.toHaveBeenCalled();
  });

  // The Community Edition records nothing: not even the reader is looked up.
  test("nothing is looked up where nothing records", async () => {
    uninstallEnterpriseModule();
    createReturningWritten();

    await StatusPagePrivateUserSessionService.createSession({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPagePrivateUserId: READER_ID,
      refreshTokenExpiresAt: new Date(NOW.getTime() + 24 * HOUR),
    });

    expect(findReaders).not.toHaveBeenCalled();
  });
});

describe("a reader's session that ends", () => {
  test("signing out is a Sign Out, from where they signed out", async () => {
    await revoke({
      rows: [sessionRow()],
      revokedReason: STATUS_PAGE_SESSION_SIGNED_OUT_REASON,
      props: { isRoot: true, requestOrigin: ORIGIN },
    });

    expect(recordedEvents()).toEqual([
      {
        action: AuditLogAction.SignOut,
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        readerEmail: READER_EMAIL,
        signIn: { method: SignInMethod.Password },
        device: "Chrome 130 on macOS",
        location: "Lisbon, Portugal",
        ipAddress: "203.0.113.7",
        endReason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.SignedOut],
        signedInAt: new Date(NOW.getTime() - 5 * HOUR),
        lastActiveAt: new Date(NOW.getTime() - HOUR),
      },
    ]);
  });

  test("a new password revokes it, at the address it was last used from", async () => {
    await revoke({
      rows: [sessionRow()],
      revokedReason: STATUS_PAGE_SESSION_PASSWORD_CHANGED_REASON,
      // The request that changed the password is not where the session was.
      props: { isRoot: true, requestOrigin: ORIGIN },
    });

    const event: StatusPageSessionAuditEvent = recordedEvents()[0]!;

    expect(event.action).toBe(AuditLogAction.SessionRevoked);
    expect(event.endReason).toBe(
      SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.PasswordChanged],
    );
    expect(event.ipAddress).toBe("198.51.100.4");
  });

  test("a sign-in the page no longer accepts revokes it, and says so", async () => {
    await revoke({
      rows: [sessionRow()],
      revokedReason: STATUS_PAGE_SESSION_SIGN_IN_NO_LONGER_ACCEPTED_REASON,
    });

    expect(recordedEvents()[0]).toEqual(
      expect.objectContaining({
        action: AuditLogAction.SessionRevoked,
        endReason: AUDIT_LOG_SESSION_SIGN_IN_NO_LONGER_ACCEPTED,
      }),
    );
  });

  test("any other end is a session that ended", async () => {
    await revoke({
      rows: [sessionRow()],
      revokedReason: "Status page mismatch",
    });

    expect(recordedEvents()[0]).toEqual(
      expect.objectContaining({
        action: AuditLogAction.SessionRevoked,
        endReason: SESSION_END_CAUSE_DESCRIPTIONS[SessionEndCause.Other],
      }),
    );
  });

  test("every session a revocation ends, its reader looked up once", async () => {
    await revoke({
      rows: [sessionRow(), sessionRow({ id: OTHER_SESSION_ID })],
      revokedReason: STATUS_PAGE_SESSION_PASSWORD_CHANGED_REASON,
    });

    expect(
      recordedEvents().map((event: StatusPageSessionAuditEvent): string => {
        return event.sessionId.toString();
      }),
    ).toEqual([SESSION_ID.toString(), OTHER_SESSION_ID.toString()]);
    expect(findReaders).toHaveBeenCalledTimes(1);
  });

  test("one that had already ended is not recorded again", async () => {
    await revoke({
      rows: [sessionRow({ isRevoked: true })],
      revokedReason: STATUS_PAGE_SESSION_SIGNED_OUT_REASON,
    });

    expect(recorder.recordStatusPageSessionEvents).not.toHaveBeenCalled();
  });

  // A login code ends with the reader's other sessions when their password changes.
  test("a login code never exchanged signed nobody in: its end is not recorded", async () => {
    await revoke({
      rows: [
        sessionRow({
          additionalInfo: { oneuptimeStatusPageSessionPurpose: "login-code" },
        }),
      ],
      revokedReason: STATUS_PAGE_SESSION_PASSWORD_CHANGED_REASON,
    });

    expect(recorder.recordStatusPageSessionEvents).not.toHaveBeenCalled();
  });

  test("one the write did not end is not recorded", async () => {
    await revoke({
      rows: [sessionRow(), sessionRow({ id: OTHER_SESSION_ID })],
      revokedReason: STATUS_PAGE_SESSION_SIGNED_OUT_REASON,
      updatedIds: [OTHER_SESSION_ID],
    });

    expect(
      recordedEvents().map((event: StatusPageSessionAuditEvent): string => {
        return event.sessionId.toString();
      }),
    ).toEqual([OTHER_SESSION_ID.toString()]);
  });

  test("an update that ends nothing reads nothing", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPagePrivateUserSessionService,
      "findRowsAndHoldUpdateToThem",
    );

    const onUpdate: OnUpdate<StatusPagePrivateUserSession> =
      await hooks.onBeforeUpdate({
        query: {
          _id: SESSION_ID.toString(),
        } as UpdateBy<StatusPagePrivateUserSession>["query"],
        data: {
          lastActiveAt: NOW,
        } as UpdateBy<StatusPagePrivateUserSession>["data"],
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      });

    await hooks.onUpdateSuccess(onUpdate, [SESSION_ID]);

    expect(read).not.toHaveBeenCalled();
    expect(recorder.recordStatusPageSessionEvents).not.toHaveBeenCalled();
  });

  test("a revocation goes ahead when the audit log fails", async () => {
    recorder.recordStatusPageSessionEvents.mockRejectedValue(
      new Error("ClickHouse is down") as never,
    );

    await expect(
      revoke({
        rows: [sessionRow()],
        revokedReason: STATUS_PAGE_SESSION_SIGNED_OUT_REASON,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("the revocations carry where they were asked from", () => {
  test("revokeSessionById hands the sign-out's origin to the write", async () => {
    const updateOneById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPagePrivateUserSessionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await StatusPagePrivateUserSessionService.revokeSessionById(SESSION_ID, {
      reason: STATUS_PAGE_SESSION_SIGNED_OUT_REASON,
      requestOrigin: ORIGIN,
    });

    expect(
      (updateOneById.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true, requestOrigin: ORIGIN });
  });

  test("a revocation asked by no request is OneUptime's own", async () => {
    const updateOneById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPagePrivateUserSessionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await StatusPagePrivateUserSessionService.revokeSessionById(SESSION_ID);

    expect(
      (updateOneById.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });
});

describe("the audit log's event for a reader's session", () => {
  test("names no status page, no event", () => {
    const session: StatusPagePrivateUserSession = sessionRow();
    session.statusPageId = undefined;

    expect(
      Service.toAuditEvent({ session, action: AuditLogAction.SignIn }),
    ).toBeNull();
  });

  test("a sign-in says nothing of an end", () => {
    const event: StatusPageSessionAuditEvent | null = Service.toAuditEvent({
      session: sessionRow(),
      action: AuditLogAction.SignIn,
      endReason: "ignored",
    });

    expect(event?.endReason).toBeUndefined();
    expect(event?.signedInAt).toBeUndefined();
    expect(event?.lastActiveAt).toBeUndefined();
  });
});
