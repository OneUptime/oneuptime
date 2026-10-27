import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import MicrosoftSignInClient, {
  MICROSOFT_CONSUMER_TENANT_ID,
  MicrosoftIdentity,
  MicrosoftSignInError,
} from "../../../Server/Utils/MicrosoftSignIn/MicrosoftSignInClient";
import Response from "../../../Server/Utils/Response";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import AuthenticationEmail from "../../../../App/FeatureSet/Identity/Utils/AuthenticationEmail";
import MicrosoftSignInRouter from "../../../../App/FeatureSet/Identity/API/MicrosoftSignIn";
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "../../../Types/SSO/SignInMethods";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Sign in with Microsoft's two endpoints. The callback is where a Microsoft
 * account becomes a OneUptime session, so who it signs in is pinned here:
 *
 *   - only with the state, nonce and PKCE verifier it sent the browser off
 *     with, from a cookie only the callback path receives;
 *   - an existing user only when their address is verified, they are not
 *     blocked, and they have no second factor and are not a master admin
 *     (this sign-in would skip what protects those accounts);
 *   - a new user only where sign-up is open;
 *   - nobody while the whole server requires single sign-on: it is not SSO,
 *     and no master admin signs in this way (SsoRequiredSignIn), so neither
 *     endpoint signs anyone in then, nor when that cannot be read.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    MicrosoftSignInClientId: "sign-in-client-id",
    MicrosoftSignInClientSecret: "sign-in-client-secret",
  };
});

jest.mock("../../../Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      createByEmail: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: { createSession: jest.fn() },
  };
});

jest.mock("../../../Server/Utils/Cookie", () => {
  /*
   * The state cookie is cleared by the real removeCookie, so the response's
   * clearCookie sees the path (and Secure, over HTTPS) every cookie gets.
   */
  const actual: {
    default: { removeCookie: (...args: Array<unknown>) => void };
  } = jest.requireActual("../../../Server/Utils/Cookie");

  return {
    __esModule: true,
    default: {
      setCookie: jest.fn(),
      getCookieFromExpressRequest: jest.fn(),
      setUserCookie: jest.fn(),
      removeCookie: (...args: Array<unknown>): void => {
        actual.default.removeCookie(...args);
      },
    },
  };
});

// The state cookie's payload, readable in the test; signing is JsonWebToken's own business.
jest.mock("../../../Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      signJsonPayload: jest.fn((payload: unknown): string => {
        return JSON.stringify(payload);
      }),
      decodeJsonPayload: jest.fn((token: string): unknown => {
        return JSON.parse(token);
      }),
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: { render: jest.fn() },
  };
});

// Whether the server requires single sign-on: what each test says.
const mockIsSsoRequired: jest.Mock = jest.fn();

jest.mock("../../../Server/Utils/SsoRequiredSignIn", () => {
  return {
    __esModule: true,
    default: {
      isSsoRequired: (...args: Array<unknown>): unknown => {
        return mockIsSsoRequired(...args);
      },
    },
  };
});

jest.mock("../../../Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: { shouldDisableSignup: jest.fn() },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Identity/Utils/AuthenticationEmail",
  () => {
    return {
      __esModule: true,
      default: { sendVerificationEmail: jest.fn() },
    };
  },
);

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

type Handler = (req: ExpressRequest, res: ExpressResponse) => unknown;

const getHandler: (path: string) => Handler = (path: string): Handler => {
  const stack: Array<{
    route?: { path: string; stack: Array<{ handle: Handler }> };
  }> = (MicrosoftSignInRouter as unknown as { stack: Array<never> }).stack;

  const layer: { route?: { path: string; stack: Array<{ handle: Handler }> } } =
    stack.find(
      (candidate: {
        route?: { path: string; stack: Array<{ handle: Handler }> };
      }) => {
        return candidate.route?.path === path;
      },
    )!;

  return layer.route!.stack[layer.route!.stack.length - 1]!.handle;
};

const STATE: Record<string, string> = {
  state: "state-from-the-sign-in",
  nonce: "nonce-from-the-sign-in",
  codeVerifier: "verifier-from-the-sign-in",
};

const IDENTITY: MicrosoftIdentity = {
  email: new Email("ada@contoso.com"),
  name: "Ada Lovelace",
  tenantId: MICROSOFT_CONSUMER_TENANT_ID,
  objectId: "00000000-0000-0000-66f3-3332eca7ea81",
};

interface FakeResponse {
  res: ExpressResponse;
  redirect: jest.Mock;
  clearCookie: jest.Mock;
}

const createResponse: () => FakeResponse = (): FakeResponse => {
  const redirect: jest.Mock = jest.fn();
  const clearCookie: jest.Mock = jest.fn();

  return {
    res: { redirect, clearCookie } as unknown as ExpressResponse,
    redirect,
    clearCookie,
  };
};

const callbackRequest: (query: Record<string, string>) => ExpressRequest = (
  query: Record<string, string>,
): ExpressRequest => {
  return {
    query: query,
    headers: { "user-agent": "Mozilla/5.0" },
    body: {},
    cookies: {},
    socket: { remoteAddress: "203.0.113.5" },
  } as unknown as ExpressRequest;
};

const existingUser: (overrides?: Partial<User>) => User = (
  overrides?: Partial<User>,
): User => {
  return Object.assign(new User(), {
    _id: ObjectID.generate().toString(),
    email: new Email("ada@contoso.com"),
    isEmailVerified: true,
    isBlocked: false,
    isMasterAdmin: false,
    enableTwoFactorAuth: false,
    ...overrides,
  });
};

// The title of the message page the callback rendered, if it rendered one.
const renderedTitle: () => string | null = (): string | null => {
  const call: Array<unknown> | undefined = mocked(Response.render).mock
    .calls[0];
  return call ? ((call[3] as { title: string }).title as string) : null;
};

describe("GET /microsoft/sign-in", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSsoRequired.mockResolvedValue(false);
  });

  it("sends the browser to Microsoft, keeping what the callback must match in a signed cookie only the callback sees", async () => {
    const { res, redirect } = createResponse();

    await getHandler("/microsoft/sign-in")(
      { query: {}, headers: {} } as unknown as ExpressRequest,
      res,
    );

    const authorizationUrl: URL = new URL(redirect.mock.calls[0]![0] as string);
    expect(authorizationUrl.hostname).toBe("login.microsoftonline.com");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      "sign-in-client-id",
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toMatch(
      /\/identity\/microsoft\/callback$/,
    );

    const [, name, value, options] = mocked(CookieUtil.setCookie).mock
      .calls[0] as [unknown, string, string, Record<string, unknown>];

    expect(name).toBe("oneuptime-microsoft-sign-in");
    expect(options).toMatchObject({
      path: "/identity/microsoft",
      httpOnly: true,
      maxAge: 10 * 60 * 1000,
    });

    const stored: Record<string, string> = JSON.parse(value);
    expect(stored["state"]).toBe(authorizationUrl.searchParams.get("state"));
    expect(stored["nonce"]).toBe(authorizationUrl.searchParams.get("nonce"));
    // Only the challenge goes to Microsoft; the verifier stays in the cookie.
    expect(authorizationUrl.toString()).not.toContain(stored["codeVerifier"]);
  });

  it("starts no sign-in while the server requires SSO, and says to use SSO", async () => {
    mockIsSsoRequired.mockResolvedValue(true);
    const { res, redirect } = createResponse();

    await getHandler("/microsoft/sign-in")(
      { query: {}, headers: {} } as unknown as ExpressRequest,
      res,
    );

    expect(redirect).not.toHaveBeenCalled();
    expect(CookieUtil.setCookie).not.toHaveBeenCalled();
    expect(renderedTitle()).toBe("Sign in with SSO instead.");
    expect(
      (mocked(Response.render).mock.calls[0]![3] as { message: string })
        .message,
    ).toBe(SSO_REQUIRED_SIGN_IN_MESSAGE);
  });

  it("starts no sign-in when the rule cannot be read", async () => {
    mockIsSsoRequired.mockRejectedValue(new Error("connection terminated"));
    const { res, redirect } = createResponse();

    await getHandler("/microsoft/sign-in")(
      { query: {}, headers: {} } as unknown as ExpressRequest,
      res,
    );

    expect(redirect).not.toHaveBeenCalled();
    expect(CookieUtil.setCookie).not.toHaveBeenCalled();
    expect(renderedTitle()).toBe("We could not sign you in with Microsoft.");
  });
});

describe("GET /microsoft/callback", () => {
  let completeSignIn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    completeSignIn = jest
      .spyOn(MicrosoftSignInClient.prototype, "completeSignIn")
      .mockResolvedValue(IDENTITY);

    mocked(CookieUtil.getCookieFromExpressRequest).mockReturnValue(
      JSON.stringify(STATE),
    );
    mocked(UserSessionService.createSession).mockResolvedValue({
      session: { id: ObjectID.generate() },
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: new Date(),
    });
    mocked(DatabaseConfig.shouldDisableSignup).mockResolvedValue(false);
    mockIsSsoRequired.mockResolvedValue(false);
  });

  afterEach(() => {
    completeSignIn.mockRestore();
  });

  const runCallback: (
    query?: Record<string, string>,
  ) => Promise<FakeResponse> = async (
    query?: Record<string, string>,
  ): Promise<FakeResponse> => {
    const response: FakeResponse = createResponse();

    await getHandler("/microsoft/callback")(
      callbackRequest(
        query || { code: "authorization-code", state: STATE["state"]! },
      ),
      response.res,
    );

    return response;
  };

  it("signs in the verified user with the account's address, and ends on the dashboard", async () => {
    const user: User = existingUser();
    mocked(UserService.findOneBy).mockResolvedValue(user);

    const { redirect, clearCookie } = await runCallback();

    expect(completeSignIn).toHaveBeenCalledWith({
      code: "authorization-code",
      codeVerifier: STATE["codeVerifier"],
      nonce: STATE["nonce"],
    });
    expect(UserService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({ query: { email: IDENTITY.email } }),
    );
    expect(UserSessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        isGlobalLogin: true,
        additionalInfo: { signInMethod: "Microsoft" },
      }),
    );
    expect(CookieUtil.setUserCookie).toHaveBeenCalledWith(
      expect.objectContaining({ user: user, isGlobalLogin: true }),
    );
    expect(redirect).toHaveBeenCalledWith("/dashboard");

    // The state cookie is spent whatever happens.
    expect(clearCookie).toHaveBeenCalledWith(
      "oneuptime-microsoft-sign-in",
      expect.objectContaining({ path: "/identity/microsoft" }),
    );
    expect(Response.render).not.toHaveBeenCalled();
  });

  /*
   * Turned on while the person was at Microsoft: the sign-in finishes
   * nowhere, not even for an account that exists - and Microsoft is not
   * asked who it is.
   */
  it("signs nobody in, nor makes an account, while the server requires SSO", async () => {
    mockIsSsoRequired.mockResolvedValue(true);
    mocked(UserService.findOneBy).mockResolvedValue(existingUser());

    const { redirect, clearCookie } = await runCallback();

    expect(renderedTitle()).toBe("Sign in with SSO instead.");
    expect(completeSignIn).not.toHaveBeenCalled();
    expect(UserService.findOneBy).not.toHaveBeenCalled();
    expect(UserService.createByEmail).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
    expect(CookieUtil.setUserCookie).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    // The state cookie is still spent.
    expect(clearCookie).toHaveBeenCalledWith(
      "oneuptime-microsoft-sign-in",
      expect.objectContaining({ path: "/identity/microsoft" }),
    );
  });

  it("signs nobody in when the rule cannot be read", async () => {
    mockIsSsoRequired.mockRejectedValue(new Error("connection terminated"));
    mocked(UserService.findOneBy).mockResolvedValue(existingUser());

    await runCallback();

    expect(renderedTitle()).toBe("We could not sign you in with Microsoft.");
    expect(completeSignIn).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("refuses a callback whose state does not match the one it sent, without asking Microsoft", async () => {
    for (const query of [
      { code: "authorization-code", state: "someone-elses-state" },
      { code: "authorization-code" },
      { state: STATE["state"]! },
    ]) {
      jest.clearAllMocks();
      await runCallback(query as Record<string, string>);

      expect(renderedTitle()).toBe("Your sign-in expired.");
    }

    jest.clearAllMocks();
    mocked(CookieUtil.getCookieFromExpressRequest).mockReturnValue(undefined);
    await runCallback();
    expect(renderedTitle()).toBe("Your sign-in expired.");

    jest.clearAllMocks();
    mocked(CookieUtil.getCookieFromExpressRequest).mockReturnValue("not json");
    await runCallback();
    expect(renderedTitle()).toBe("Your sign-in expired.");

    expect(completeSignIn).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("says so when the person cancelled at Microsoft", async () => {
    await runCallback({ error: "access_denied", state: STATE["state"]! });

    expect(renderedTitle()).toBe("Sign in was cancelled.");
    expect(completeSignIn).not.toHaveBeenCalled();
  });

  it("asks a user with a second factor, or a master admin, for their password instead", async () => {
    for (const user of [
      existingUser({ enableTwoFactorAuth: true }),
      existingUser({ isMasterAdmin: true }),
    ]) {
      jest.clearAllMocks();
      mocked(UserService.findOneBy).mockResolvedValue(user);

      await runCallback();

      expect(renderedTitle()).toBe("Please sign in with your password.");
      expect(UserSessionService.createSession).not.toHaveBeenCalled();
      expect(CookieUtil.setUserCookie).not.toHaveBeenCalled();
    }
  });

  it("does not sign in a blocked user", async () => {
    mocked(UserService.findOneBy).mockResolvedValue(
      existingUser({ isBlocked: true }),
    );

    await runCallback();

    expect(renderedTitle()).toBe("Account blocked.");
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("sends an account nobody verified a verification link, instead of signing into it", async () => {
    const unverified: User = existingUser({ isEmailVerified: false });
    mocked(UserService.findOneBy).mockResolvedValue(unverified);

    await runCallback();

    expect(AuthenticationEmail.sendVerificationEmail).toHaveBeenCalledWith(
      unverified,
    );
    expect(renderedTitle()).toBe("Email not verified.");
    expect(UserService.updateOneById).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("creates a verified user for a new address where sign-up is open", async () => {
    const created: User = existingUser();

    mocked(UserService.findOneBy).mockResolvedValue(null);
    mocked(UserService.createByEmail).mockResolvedValue(created);
    mocked(UserService.findOneById).mockResolvedValue(created);

    const { redirect } = await runCallback();

    expect(UserService.createByEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: IDENTITY.email,
        isEmailVerified: true,
        generateRandomPassword: true,
      }),
    );
    expect(UserSessionService.createSession).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("creates no one where sign-up is closed", async () => {
    mocked(UserService.findOneBy).mockResolvedValue(null);
    mocked(DatabaseConfig.shouldDisableSignup).mockResolvedValue(true);

    await runCallback();

    expect(renderedTitle()).toBe("Sign up is disabled.");
    expect(UserService.createByEmail).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("shows the person Microsoft's refusal in words meant for them", async () => {
    completeSignIn.mockRejectedValue(
      new MicrosoftSignInError(
        "Microsoft does not vouch for the email address in this ID token (no xms_edov).",
        "Your organization's Microsoft account does not confirm this email address, so OneUptime cannot sign you in with it. Please sign in with your email and password.",
      ),
    );

    await runCallback();

    const options: { message: string } = mocked(Response.render).mock
      .calls[0]![3] as { message: string };

    expect(renderedTitle()).toBe("We could not sign you in with Microsoft.");
    expect(options.message).toMatch(/does not confirm this email address/);
    expect(options.message).not.toMatch(/xms_edov/);
    expect(UserService.findOneBy).not.toHaveBeenCalled();
  });
});
