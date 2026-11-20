import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import User from "Common/Models/DatabaseModels/User";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import UserService from "Common/Server/Services/UserService";
import UserSessionService from "Common/Server/Services/UserSessionService";
import CookieUtil from "Common/Server/Utils/Cookie";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import MarketplaceConfig from "../../../../Server/CloudMarketplace/MarketplaceConfig";
import VercelMarketplaceAPI from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAPI";
import VercelMarketplaceAuth, {
  VercelAuthError,
  VercelMarketplaceCaller,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAuth";
import VercelMarketplaceSignIn, {
  VercelSignInError,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceSignIn";
import Response from "Common/Server/Utils/Response";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import AuthenticationEmail from "App/FeatureSet/Identity/Utils/AuthenticationEmail";
import VercelSignInRouter from "../../../../Server/CloudMarketplace/API/VercelSignIn";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { SignInMethod } from "Common/Types/UserSession/SessionSignIn";
import SsoRequiredSignIn from "Common/Server/Utils/SsoRequiredSignIn";
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SignInMethods";

/*
 * Sign-in from Vercel (/identity/vercel/sso): the code Vercel sends the
 * person with is exchanged for an ID token, which signs in the OneUptime
 * user with its verified email address - under the rules of Sign in with
 * Microsoft - after they are put in the resource's project.
 */

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      createByEmail: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: { createSession: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: { setUserCookie: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: { render: jest.fn() },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: { shouldDisableSignup: jest.fn() },
  };
});

jest.mock("App/FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: { sendVerificationEmail: jest.fn() },
  };
});

jest.mock(
  "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceSignIn",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceSignIn",
    );
    const real: { getRedirectUrl: (...args: Array<unknown>) => string } =
      actual["default"] as {
        getRedirectUrl: (...args: Array<unknown>) => string;
      };

    return {
      __esModule: true,
      ...actual,
      default: {
        getPurchases: jest.fn(),
        ensureMemberships: jest.fn(),
        getRedirectUrl: (...args: Array<unknown>): string => {
          return real.getRedirectUrl(...args);
        },
      },
    };
  },
);

const mocked: (fn: unknown) => jest.Mock = (fn: unknown): jest.Mock => {
  return fn as jest.Mock;
};

type Handler = (req: ExpressRequest, res: ExpressResponse) => unknown;

const getHandler: () => Handler = (): Handler => {
  const stack: Array<{
    route?: { path: string; stack: Array<{ handle: Handler }> };
  }> = (VercelSignInRouter as unknown as { stack: Array<never> }).stack;

  const layer: { route?: { path: string; stack: Array<{ handle: Handler }> } } =
    stack.find(
      (candidate: {
        route?: { path: string; stack: Array<{ handle: Handler }> };
      }) => {
        return candidate.route?.path === "/vercel/sso";
      },
    )!;

  return layer.route!.stack[layer.route!.stack.length - 1]!.handle;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "6720a1b2-0000-4000-8000-00000000000c",
);

const CALLER: VercelMarketplaceCaller = {
  kind: "user",
  accountId: "team_acme",
  installationId: "icfg_acme",
  userId: "user_ada",
  userRole: "USER",
  userEmail: "ada@example.com",
  isUserEmailVerified: true,
  userName: "Ada Lovelace",
};

const PURCHASE: MarketplaceSubscription = Object.assign(
  new MarketplaceSubscription(),
  {
    marketplace: CloudMarketplace.Vercel,
    externalSubscriptionId: "res_1",
    projectId: PROJECT_ID,
  },
);

const existingUser: (overrides?: Partial<User>) => User = (
  overrides?: Partial<User>,
): User => {
  return Object.assign(new User(), {
    _id: ObjectID.generate().toString(),
    email: new Email("ada@example.com"),
    isEmailVerified: true,
    isBlocked: false,
    isMasterAdmin: false,
    enableTwoFactorAuth: false,
    ...overrides,
  });
};

const request: (query: Record<string, string>) => ExpressRequest = (
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

let redirect: jest.Mock;
let exchange: jest.SpyInstance;
let verify: jest.SpyInstance;
let ssoRequired: jest.SpyInstance;

const signIn: (query: Record<string, string>) => Promise<void> = async (
  query: Record<string, string>,
): Promise<void> => {
  redirect = jest.fn();
  await getHandler()(request(query), {
    redirect: redirect,
  } as unknown as ExpressResponse);
};

const renderedTitle: () => string | null = (): string | null => {
  const call: Array<unknown> | undefined = mocked(Response.render).mock
    .calls[0];
  return call ? ((call[3] as { title: string }).title as string) : null;
};

beforeEach(() => {
  jest.clearAllMocks();

  jest.spyOn(MarketplaceConfig, "isVercelConfigured").mockReturnValue(true);
  jest
    .spyOn(MarketplaceConfig, "getPublicOrigin")
    .mockReturnValue("https://oneuptime.com");
  exchange = jest
    .spyOn(VercelMarketplaceAPI.prototype, "exchangeSsoCode")
    .mockResolvedValue("id-token");
  verify = jest
    .spyOn(VercelMarketplaceAuth.prototype, "verifyToken")
    .mockResolvedValue(CALLER);

  mocked(VercelMarketplaceSignIn.getPurchases).mockResolvedValue([PURCHASE]);
  mocked(VercelMarketplaceSignIn.ensureMemberships).mockResolvedValue(
    undefined,
  );
  mocked(UserService.findOneBy).mockResolvedValue(existingUser());
  mocked(UserSessionService.createSession).mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh",
    refreshTokenExpiresAt: new Date(),
  });
  mocked(DatabaseConfig.shouldDisableSignup).mockResolvedValue(false);
  // A server that does not require single sign-on, unless a test says.
  ssoRequired = jest
    .spyOn(SsoRequiredSignIn, "isSsoRequired")
    .mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /identity/vercel/sso", () => {
  it("signs a Vercel user in to the resource's project, in the team their role gives them", async () => {
    await signIn({
      mode: "sso",
      code: "code-1",
      state: "state-1",
      resource_id: "res_1",
    });

    expect(exchange).toHaveBeenCalledWith({ code: "code-1", state: "state-1" });
    expect(verify).toHaveBeenCalledWith("id-token", "id_token");
    expect(VercelMarketplaceSignIn.getPurchases).toHaveBeenCalledWith({
      caller: CALLER,
      resourceId: "res_1",
    });
    expect(VercelMarketplaceSignIn.ensureMemberships).toHaveBeenCalledWith(
      expect.objectContaining({ role: "USER", purchases: [PURCHASE] }),
    );
    expect(UserSessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        isGlobalLogin: true,
        // The audit log names how they signed in (SessionSignIn).
        signIn: { method: SignInMethod.Vercel },
      }),
    );
    expect(CookieUtil.setUserCookie).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      `/dashboard/${PROJECT_ID.toString()}/home/`,
    );
  });

  /*
   * Never a Sign In Again (#10331): OneUptime cannot ask Vercel to have the
   * person sign in again - Vercel starts the sign-in, and its SSO takes no
   * prompt=login or max_age - and Vercel's ID token says nothing of when
   * they signed in. So a sign-in from Vercel, with or without Sign In
   * Again's query, keeps only that it was Vercel's: the session it makes is
   * never confirmed by it (Common/Server/Utils/Reauthentication), and the
   * prompt says so.
   */
  it.each([
    ["without Sign In Again", {}],
    ["asked as a Sign In Again", { reauthenticate: "true" }],
  ] as Array<[string, Record<string, string>]>)(
    "keeps only that the session signed in with Vercel, %s",
    async (_name: string, query: Record<string, string>) => {
      await signIn({ mode: "sso", code: "code-1", ...query });

      const created: { signIn: unknown } = mocked(
        UserSessionService.createSession,
      ).mock.calls[0]![0] as { signIn: unknown };

      expect(created.signIn).toEqual({ method: SignInMethod.Vercel });
      expect(created.signIn).not.toHaveProperty("signInAgain");
      expect(redirect).toHaveBeenCalled();
    },
  );

  it("reads nothing from Vercel's ID token as when the person signed in, however fresh it is", async () => {
    const now: number = Math.floor(Date.now() / 1000);

    const caller: VercelMarketplaceCaller = VercelMarketplaceAuth.readCaller(
      {
        type: "id_token",
        sub: "account:1a2b3c:user:4d5e6f",
        account_id: "team_acme",
        installation_id: "icfg_acme",
        user_id: "user_ada",
        user_role: "USER",
        user_email: "ada@example.com",
        user_email_verified: true,
        // When the token was made, not when the person signed in to Vercel.
        iat: now,
        // Not a claim Vercel sends; read as nothing were it ever there.
        auth_time: now,
      },
      "id_token",
    );

    expect(Object.keys(caller).sort()).toEqual(
      [
        "accountId",
        "installationId",
        "isUserEmailVerified",
        "kind",
        "userEmail",
        "userId",
        "userName",
        "userRole",
      ].sort(),
    );
  });

  it("lands on the billing page for an invoice link", async () => {
    await signIn({ code: "code-1", invoice_id: "inv_1" });

    expect(redirect).toHaveBeenCalledWith(
      `/dashboard/${PROJECT_ID.toString()}/settings/billing`,
    );
  });

  it("makes a verified OneUptime account for someone who has none", async () => {
    const created: User = existingUser();

    mocked(UserService.findOneBy).mockResolvedValue(null);
    mocked(UserService.createByEmail).mockResolvedValue(created);
    mocked(UserService.findOneById).mockResolvedValue(created);

    await signIn({ code: "code-1" });

    expect(UserService.createByEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        isEmailVerified: true,
        generateRandomPassword: true,
      }),
    );
    expect(redirect).toHaveBeenCalled();
  });

  it("matches no account to an email address Vercel has not verified", async () => {
    verify.mockResolvedValue({ ...CALLER, isUserEmailVerified: false });

    await signIn({ code: "code-1" });

    expect(UserService.findOneBy).not.toHaveBeenCalled();
    expect(VercelMarketplaceSignIn.ensureMemberships).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(renderedTitle()).toBe("Verify your email address on Vercel.");
  });

  it("sends a verification link to an account whose own address was never verified", async () => {
    const unverified: User = existingUser({ isEmailVerified: false });
    mocked(UserService.findOneBy).mockResolvedValue(unverified);

    await signIn({ code: "code-1" });

    expect(AuthenticationEmail.sendVerificationEmail).toHaveBeenCalledWith(
      unverified,
    );
    expect(VercelMarketplaceSignIn.ensureMemberships).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("puts a two-factor account in the project, but asks it for its password", async () => {
    mocked(UserService.findOneBy).mockResolvedValue(
      existingUser({ enableTwoFactorAuth: true }),
    );

    await signIn({ code: "code-1" });

    expect(VercelMarketplaceSignIn.ensureMemberships).toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
    expect(renderedTitle()).toBe("Please sign in with your password.");
  });

  it("does the same for a master admin", async () => {
    mocked(UserService.findOneBy).mockResolvedValue(
      existingUser({ isMasterAdmin: true }),
    );

    await signIn({ code: "code-1" });

    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("refuses a blocked account, and a new one where sign-up is closed", async () => {
    mocked(UserService.findOneBy).mockResolvedValue(
      existingUser({ isBlocked: true }),
    );

    await signIn({ code: "code-1" });
    expect(renderedTitle()).toBe("Account blocked.");

    jest.clearAllMocks();
    mocked(UserService.findOneBy).mockResolvedValue(null);
    mocked(DatabaseConfig.shouldDisableSignup).mockResolvedValue(true);
    mocked(VercelMarketplaceSignIn.getPurchases).mockResolvedValue([PURCHASE]);

    await signIn({ code: "code-1" });
    expect(renderedTitle()).toBe("Sign up is disabled.");
    expect(UserService.createByEmail).not.toHaveBeenCalled();
  });

  it("says why there is nothing to open", async () => {
    mocked(VercelMarketplaceSignIn.getPurchases).mockRejectedValue(
      new VercelSignInError("This OneUptime resource was deleted."),
    );

    await signIn({ code: "code-1", resource_id: "res_gone" });

    expect(renderedTitle()).toBe("We could not sign you in from Vercel.");
    expect(
      (mocked(Response.render).mock.calls[0]![3] as { message: string })
        .message,
    ).toBe("This OneUptime resource was deleted.");
  });

  it("refuses a code Vercel will not exchange, or a token it did not sign", async () => {
    exchange.mockRejectedValue(new Error("invalid_grant"));
    await signIn({ code: "stale" });
    expect(renderedTitle()).toBe("Your sign-in from Vercel expired.");

    jest.clearAllMocks();
    exchange.mockResolvedValue("forged");
    verify.mockRejectedValue(new VercelAuthError("bad signature"));
    await signIn({ code: "code-1" });
    expect(renderedTitle()).toBe("Your sign-in from Vercel expired.");
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("signs in nobody from a token that names no person", async () => {
    verify.mockResolvedValue({
      kind: "system",
      accountId: "team_acme",
      installationId: "icfg_acme",
    });

    await signIn({ code: "code-1" });

    expect(renderedTitle()).toBe("We could not sign you in.");
  });

  it("explains itself when opened without a code, or on a server not set up for Vercel", async () => {
    await signIn({});
    expect(renderedTitle()).toBe("Open OneUptime from Vercel.");
    expect(exchange).not.toHaveBeenCalled();

    jest.clearAllMocks();
    jest.spyOn(MarketplaceConfig, "isVercelConfigured").mockReturnValue(false);

    await signIn({ code: "code-1" });
    expect(renderedTitle()).toBe("Vercel Marketplace is not available.");
  });

  /*
   * While the whole server requires single sign-on (#6116), Vercel signs
   * nobody in: its sign-in is not SSO, as Sign in with Microsoft is not.
   * Refused before Vercel is asked anything, so nobody is joined to a
   * project, no account is made and no code is spent.
   */
  it("signs nobody in while the server requires SSO, and says to sign in with SSO", async () => {
    ssoRequired.mockResolvedValue(true);

    await signIn({ code: "code-1", resource_id: "res_1" });

    expect(renderedTitle()).toBe("Sign in with SSO instead.");
    expect(
      (mocked(Response.render).mock.calls[0]![3] as { message: string })
        .message,
    ).toBe(SSO_REQUIRED_SIGN_IN_MESSAGE);
    expect(exchange).not.toHaveBeenCalled();
    expect(VercelMarketplaceSignIn.ensureMemberships).not.toHaveBeenCalled();
    expect(UserService.createByEmail).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
    expect(CookieUtil.setUserCookie).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("signs nobody in when whether SSO is required cannot be read", async () => {
    ssoRequired.mockRejectedValue(new Error("connection terminated"));

    await signIn({ code: "code-1" });

    expect(renderedTitle()).toBe("We could not sign you in from Vercel.");
    expect(exchange).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });
});
