import UserMiddleware, {
  RequestSession,
  SESSION_LENGTH_ENDED_TOKEN_MESSAGE,
} from "../../../Server/Middleware/UserAuthorization";
import UserService from "../../../Server/Services/UserService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Email from "../../../Types/Email";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import Name from "../../../Types/Name";
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
 * HOW LONG A SIGN-IN LASTS, ASKED ON EVERY REQUEST (UserMiddleware.
 * readRequestSession, Types/UserSession/SessionLength.ts).
 *
 * An access token is signed to expire when its session ends under the
 * server's session lengths, but a master admin can shorten them while it
 * lives. So every request that carries a session - the API, the
 * master-admin gates, the Admin Dashboard's page, the Status Page's
 * member preview, MCP's consent, the realtime socket's join, which all
 * read it here - holds the token's own claims of its session (when it
 * signed in, when its person was last active, whether it is SSO) to the
 * lengths as they are now:
 *
 *   - past them, the session is "invalid", like an expired token: the
 *     client renews, and the renewal says why it ended;
 *   - within them, or with none set (the Community Edition, or nothing
 *     set), it is the user's;
 *   - a token an earlier release signed says neither time: its own expiry,
 *     at most 15 minutes away, ends it, and the lengths are not asked;
 *   - lengths that cannot be read are an error, never a pass.
 *
 * Tokens are signed and verified for real; only the account lookups and
 * the enterprise module are stubbed.
 */

const USER_ID: ObjectID = new ObjectID("51515151-5151-4151-8151-515151515151");
const SESSION_ID: ObjectID = new ObjectID(
  "52525252-5252-4252-8252-525252525252",
);

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const sessionToken: (data: {
  signedInAgoMs?: number | undefined;
  lastActiveAgoMs?: number | undefined;
  isGlobalLogin?: boolean | undefined;
  withClaims?: boolean | undefined;
}) => string = (data: {
  signedInAgoMs?: number | undefined;
  lastActiveAgoMs?: number | undefined;
  isGlobalLogin?: boolean | undefined;
  withClaims?: boolean | undefined;
}): string => {
  const now: number = Date.now();
  const withClaims: boolean = data.withClaims !== false;

  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("someone@example.com"),
      name: new Name("Someone"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: data.isGlobalLogin !== false,
      sessionId: SESSION_ID,
      ...(withClaims
        ? {
            signedInAt: new Date(now - (data.signedInAgoMs ?? 0)),
            lastActiveAt: new Date(
              now - (data.lastActiveAgoMs ?? data.signedInAgoMs ?? 0),
            ),
          }
        : {}),
    },
    expiresInSeconds: 15 * 60,
  });
};

const request: (token: string) => ExpressRequest = (
  token: string,
): ExpressRequest => {
  return {
    cookies: { [CookieUtil.getUserTokenKey()]: token },
    headers: {},
  } as unknown as ExpressRequest;
};

const read: (token: string) => Promise<RequestSession> = (
  token: string,
): Promise<RequestSession> => {
  return UserMiddleware.readRequestSession(request(token));
};

const rule: (
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

let isUserBlocked: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  isUserBlocked = jest
    .spyOn(UserService, "isUserBlocked")
    .mockResolvedValue(false as never);
  jest.spyOn(UserService, "isUserMasterAdmin").mockResolvedValue(true as never);
});

afterEach(() => {
  uninstallEnterpriseModule();
  jest.restoreAllMocks();
});

describe("a session's access token carries what its session ends by", () => {
  test("when it signed in and when its person was last active, in milliseconds, read only from a session token", () => {
    const signedInAt: Date = new Date(Date.now() - 2 * HOUR);
    const lastActiveAt: Date = new Date(Date.now() - 10 * MINUTE);
    const token: string = JSONWebToken.signUserLoginToken({
      tokenData: {
        userId: USER_ID,
        email: new Email("someone@example.com"),
        name: new Name("Someone"),
        timezone: null,
        isMasterAdmin: false,
        isGlobalLogin: false,
        sessionId: SESSION_ID,
        signedInAt,
        lastActiveAt,
      },
      expiresInSeconds: 600,
    });

    const payload: Record<string, unknown> =
      JSONWebToken.decodeJsonPayload(token);

    expect(payload["signedInAt"]).toBe(signedInAt.getTime());
    expect(payload["lastActiveAt"]).toBe(lastActiveAt.getTime());
    expect(Number(payload["exp"]) - Number(payload["iat"])).toBe(600);
  });

  test("a token without the claims (an earlier release's) reads without them", async () => {
    const session: RequestSession = await read(
      sessionToken({ withClaims: false }),
    );

    expect(session.kind).toBe("user");
    expect(
      (session as { session: JSONWebTokenData }).session.signedInAtMs,
    ).toBeUndefined();
  });
});

describe("UserMiddleware.readRequestSession, under the server's session lengths", () => {
  test("the Community Edition never asks: a session signed in a year ago is the user's", async () => {
    uninstallEnterpriseModule();

    expect(
      (await read(sessionToken({ signedInAgoMs: 365 * 24 * HOUR }))).kind,
    ).toBe("user");
  });

  test("with nothing set, every session is as it always was", async () => {
    installFakeEnterpriseModule({ userSessionLengths: null });

    expect(
      (await read(sessionToken({ signedInAgoMs: 90 * 24 * HOUR }))).kind,
    ).toBe("user");
  });

  test("a session within its length is the user's", async () => {
    installFakeEnterpriseModule({ userSessionLengths: rule({ length: 60 }) });

    expect(
      (await read(sessionToken({ signedInAgoMs: 59 * MINUTE }))).kind,
    ).toBe("user");
  });

  test("a session past its length is invalid at once, like an expired token, whatever its token's own expiry", async () => {
    installFakeEnterpriseModule({ userSessionLengths: rule({ length: 60 }) });

    const session: RequestSession = await read(
      sessionToken({ signedInAgoMs: 61 * MINUTE, lastActiveAgoMs: 0 }),
    );

    expect(session.kind).toBe("invalid");
    expect((session as { error: unknown }).error).toBeInstanceOf(
      NotAuthenticatedException,
    );
    expect(((session as { error: Error }).error as Error).message).toBe(
      SESSION_LENGTH_ENDED_TOKEN_MESSAGE,
    );
    // Refused before anything about the account is looked up.
    expect(isUserBlocked).not.toHaveBeenCalled();
  });

  test("a session idle longer than the idle timeout is invalid; one active within it is not", async () => {
    installFakeEnterpriseModule({ userSessionLengths: rule({ idle: 30 }) });

    expect(
      (
        await read(
          sessionToken({
            signedInAgoMs: 5 * HOUR,
            lastActiveAgoMs: 31 * MINUTE,
          }),
        )
      ).kind,
    ).toBe("invalid");
    expect(
      (
        await read(
          sessionToken({
            signedInAgoMs: 5 * HOUR,
            lastActiveAgoMs: 29 * MINUTE,
          }),
        )
      ).kind,
    ).toBe("user");
  });

  test("an SSO sign-in is held to the SSO lengths, every other sign-in to the standard ones", async () => {
    installFakeEnterpriseModule({
      userSessionLengths: rule({ length: 60 }, { length: 12 * 60 }),
    });

    const twoHoursAgo: number = 2 * HOUR;

    expect(
      (await read(sessionToken({ signedInAgoMs: twoHoursAgo }))).kind,
    ).toBe("invalid");
    expect(
      (
        await read(
          sessionToken({ signedInAgoMs: twoHoursAgo, isGlobalLogin: false }),
        )
      ).kind,
    ).toBe("user");
  });

  test("a shorter length applies to a token signed before it, on its very next request", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      userSessionLengths: rule({ length: 8 * 60 }),
    });
    const token: string = sessionToken({ signedInAgoMs: 2 * HOUR });

    expect((await read(token)).kind).toBe("user");

    fake.userSessionLengths = rule({ length: 60 });

    expect((await read(token)).kind).toBe("invalid");
  });

  test("a token without the claims is left to its own expiry, and the lengths are not even asked", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      userSessionLengths: rule({ length: 15 }),
    });

    expect((await read(sessionToken({ withClaims: false }))).kind).toBe("user");
    expect(fake.userSessionLengthsReads).toBe(0);
  });

  test("throws when the lengths cannot be read: a failed read is an error, never a pass", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      userSessionLengths: rule({ length: 60 }),
    });
    fake.userSessionLengthsError = new Error(
      "the session lengths could not be read",
    );

    await expect(read(sessionToken({ signedInAgoMs: 0 }))).rejects.toThrow(
      "the session lengths could not be read",
    );
  });

  test("getSessionUser, which the image routes read, takes an ended session for no one", async () => {
    installFakeEnterpriseModule({ userSessionLengths: rule({ length: 60 }) });

    await expect(
      UserMiddleware.getSessionUser(
        request(sessionToken({ signedInAgoMs: 2 * HOUR })),
      ),
    ).resolves.toBeNull();
  });
});

describe("UserMiddleware.getSessionLengthEndReason", () => {
  test("says which length ended the session", async () => {
    installFakeEnterpriseModule({
      userSessionLengths: rule({ length: 60, idle: 30 }),
    });

    const now: number = Date.now();

    await expect(
      UserMiddleware.getSessionLengthEndReason({
        userId: USER_ID,
        isGlobalLogin: true,
        signedInAtMs: now - 2 * HOUR,
        lastActiveAtMs: now - MINUTE,
      } as JSONWebTokenData),
    ).resolves.toBe(SessionEndReason.LengthReached);

    await expect(
      UserMiddleware.getSessionLengthEndReason({
        userId: USER_ID,
        isGlobalLogin: true,
        signedInAtMs: now - 40 * MINUTE,
        lastActiveAtMs: now - 35 * MINUTE,
      } as JSONWebTokenData),
    ).resolves.toBe(SessionEndReason.Inactive);
  });

  test("a token that says when it signed in but not when its person was last active counts from the sign-in", async () => {
    installFakeEnterpriseModule({ userSessionLengths: rule({ idle: 30 }) });

    await expect(
      UserMiddleware.getSessionLengthEndReason({
        userId: USER_ID,
        isGlobalLogin: true,
        signedInAtMs: Date.now() - 31 * MINUTE,
      } as JSONWebTokenData),
    ).resolves.toBe(SessionEndReason.Inactive);
  });
});
