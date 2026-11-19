import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  expectNoUserSecrets,
  MockIdentityRouter,
  RouteHandler,
  sentEntityBody,
  withSecretColumns,
} from "./IdentityRouterTestUtil";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import Exception from "Common/Types/Exception/Exception";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import { beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------------------------
 * GHSA-qg84-6hrg-mr5g -- account takeover by registering as an invited user.
 *
 * The shape of it:
 *
 *   1. Inviting somebody to a project creates their User row up front, so the membership has
 *      something to point at. That row has no password until they register.
 *   2. /signup decided "does this account already exist?" with `if (alreadySavedUser.password)`.
 *      An unclaimed row's password is NULL, NULL is falsy in JavaScript, and the guard fell
 *      through.
 *   3. The handler then wrote the *caller's* password onto that row and called
 *      finalizeUserLogin -- a real session, for an account the caller never proved was theirs.
 *
 * Knowing the address was the whole attack. Corporate addresses are guessable by construction,
 * so anyone who could guess that alice@company.com had been invited could claim her invitation,
 * inherit whatever the invite granted, and leave her unable to take it.
 *
 * The fix makes the claim conditional on a registration token that only ever travels inside the
 * invitation email. So the assertions that matter here are not "an error came back" -- the
 * caller is deliberately told something bland either way -- but that on a failed claim
 * NOTHING HAPPENED: no write to the account, and no session.
 * ---------------------------------------------------------------------------------------------
 */

/*
 * The server does not require single sign-on here: every sign-in and sign-up
 * asks SsoRequiredSignIn first, which reads GlobalConfig. Driven for real in
 * SsoRequiredSignInRoutes.test.ts.
 */
jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return (
    jest.requireActual(
      "./SsoNotRequiredStandIn",
    ) as typeof import("./SsoNotRequiredStandIn")
  ).ssoNotRequired();
});

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockIdentityRouter => {
        return mockRouter;
      },
    },
    getClientIp: (): string => {
      return "127.0.0.1";
    },
    extractDeviceInfo: (): Record<string, unknown> => {
      return {};
    },
    headerValueToString: (): string => {
      return "";
    },
  };
});

const createEmailVerificationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: (...args: Array<unknown>): unknown => {
        return createEmailVerificationToken(...args);
      },
      deleteOneBy: jest.fn(),
    },
  };
});

const consumeRegistrationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    REGISTRATION_TOKEN_EXPIRY_IN_DAYS: 7,
    default: {
      consumeRegistrationToken: (...args: Array<unknown>): unknown => {
        return consumeRegistrationToken(...args);
      },
      generateRegistrationToken: jest.fn(),
      generateRegistrationLink: jest.fn(),
      getRegistrationLink: jest.fn(),
    },
  };
});

const userFindOneBy: jest.Mock = jest.fn();
const userUpdateOneByIdAndFetch: jest.Mock = jest.fn();
const userCreateUserOnSignup: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
      updateOneByIdAndFetch: (...args: Array<unknown>): unknown => {
        return userUpdateOneByIdAndFetch(...args);
      },
      create: jest.fn(),
      createUserOnSignup: (...args: Array<unknown>): unknown => {
        return userCreateUserOnSignup(...args);
      },
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

const refreshUserAllPermissions: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshUserAllPermissions: (...args: Array<unknown>): unknown => {
        return refreshUserAllPermissions(...args);
      },
    },
  };
});

// What the sign-up page may say, and the invitation a claim accepts (#7471).
const readSignUpInvitation: jest.Mock = jest.fn();
const acceptForClaimedAccount: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/SignUpInvitation", () => {
  return {
    __esModule: true,
    default: {
      read: (...args: Array<unknown>): unknown => {
        return readSignUpInvitation(...args);
      },
      acceptForClaimedAccount: (...args: Array<unknown>): unknown => {
        return acceptForClaimedAccount(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
      },
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
      },
      verifyAuthentication: jest.fn(),
    },
  };
});

// The load-bearing "was a session issued?" probe.
const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
    },
  };
});

const sendMail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (...args: Array<unknown>): Promise<void> => {
        sendMail(...args);
        return Promise.resolve();
      },
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      shouldDisableSignup: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      getHost: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "localhost";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "http://";
          },
        });
      },
    },
  };
});

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setUserCookie: jest.fn(),
      removeAllCookies: jest.fn(),
      removeCookie: jest.fn(),
      getRefreshTokenFromExpressRequest: jest.fn(),
      getUserTokenKey: jest.fn(),
      getRefreshTokenKey: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Captcha", () => {
  return {
    __esModule: true,
    default: {
      verifyCaptcha: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      sign: (): string => {
        return "signed-token";
      },
      signUserLoginToken: (): string => {
        return "signed-user-token";
      },
    },
  };
});

const sendCompleteRegistrationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: jest.fn(),
      sendCompleteRegistrationEmail: (...args: Array<unknown>): unknown => {
        return sendCompleteRegistrationEmail(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const sendErrorResponse: jest.Mock = jest.fn();
const sendEntityResponse: jest.Mock = jest.fn();
const sendJsonObjectResponse: jest.Mock = jest.fn();
const setNoCacheHeaders: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        return sendJsonObjectResponse(...args);
      },
      setNoCacheHeaders: (...args: Array<unknown>): unknown => {
        return setNoCacheHeaders(...args);
      },
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const INVITED_USER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VICTIM_EMAIL: string = "alice@company.com";
const VALID_TOKEN: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type InvokeResult = {
  nextError: Exception | null;
};

type InvokeFunction = (uri: string, body: unknown) => Promise<InvokeResult>;

const invoke: InvokeFunction = async (
  uri: string,
  body: unknown,
): Promise<InvokeResult> => {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body);
  const res: ExpressResponse = buildResponse();

  let nextError: Exception | null = null;

  const next: NextFunction = ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  return { nextError };
};

/* The row an invitation leaves behind: real, and with no password on it. */
function unclaimedInvitedUser(): Record<string, unknown> {
  return {
    _id: INVITED_USER_ID,
    id: {
      toString: (): string => {
        return INVITED_USER_ID;
      },
    },
    password: null,
  };
}

function registeredUser(): Record<string, unknown> {
  return {
    _id: INVITED_USER_ID,
    id: {
      toString: (): string => {
        return INVITED_USER_ID;
      },
    },
    password: "$argon2id$already-set",
  };
}

type SignupBody = {
  email?: string;
  password?: string;
  name?: string;
  registrationToken?: string;
};

function signupBody(data: SignupBody): JSONObject {
  const body: JSONObject = {
    data: {
      email: data.email,
      password: data.password,
      name: data.name || "Whoever",
    },
  };

  if (data.registrationToken !== undefined) {
    body["miscDataProps"] = { registrationToken: data.registrationToken };
  }

  return body;
}

/*
 * The two things a failed claim must not have done, asserted together because
 * either one alone is the vulnerability: writing the password locks the invited
 * person out, and issuing a session hands their access to the caller.
 */
function expectNothingHappened(): void {
  expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
  expect(createSession).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();

  acceptForClaimedAccount.mockResolvedValue(null);
  userFindOneBy.mockResolvedValue(unclaimedInvitedUser());
  consumeRegistrationToken.mockResolvedValue(false);
  sendCompleteRegistrationEmail.mockResolvedValue(undefined);
  createSession.mockResolvedValue({
    session: { id: "session-id" },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
  userUpdateOneByIdAndFetch.mockResolvedValue({
    _id: INVITED_USER_ID,
    id: {
      toString: (): string => {
        return INVITED_USER_ID;
      },
    },
    email: {
      toString: (): string => {
        return VICTIM_EMAIL;
      },
    },
  });
});

describe("Identity /signup - claiming an invited account without the invitation", () => {
  it("does not hand over an unclaimed invited account to a caller with no token", async () => {
    /*
     * The advisory's exact request: the victim's address, the attacker's chosen
     * password, nothing else. This is the regression test for the CVE.
     */
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
      }),
    );

    expectNothingHappened();
  });

  it("does not consult the token service at all when no token is supplied", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
      }),
    );

    expect(consumeRegistrationToken).not.toHaveBeenCalled();
  });

  it("rejects a token that is not even a well-formed id, without querying for it", async () => {
    /*
     * Short-circuited before the lookup so a malformed value cannot reach the
     * uuid column and be answered with a database error instead of a refusal.
     */
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
        registrationToken: "not-a-uuid",
      }),
    );

    expect(consumeRegistrationToken).not.toHaveBeenCalled();
    expectNothingHappened();
  });

  it("rejects an empty-string token", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
        registrationToken: "",
      }),
    );

    expect(consumeRegistrationToken).not.toHaveBeenCalled();
    expectNothingHappened();
  });

  it("rejects a well-formed token the token service refuses", async () => {
    /*
     * Unknown, expired, already spent, or minted for a different address --
     * consumeRegistrationToken collapses all of them to false on purpose, and
     * every one of them has to end here.
     */
    consumeRegistrationToken.mockResolvedValue(false);

    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
        registrationToken: VALID_TOKEN,
      }),
    );

    expect(consumeRegistrationToken).toHaveBeenCalledTimes(1);
    expectNothingHappened();
  });

  it("checks the token against the address being claimed, not just its existence", async () => {
    /*
     * Without the address in the query, a token from any invitation the caller
     * had legitimately received would unlock any other unclaimed account.
     */
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
        registrationToken: VALID_TOKEN,
      }),
    );

    const call: Record<string, any> = consumeRegistrationToken.mock
      .calls[0]![0] as Record<string, any>;

    expect(call["token"].toString()).toBe(VALID_TOKEN);
    expect(call["email"].toString()).toBe(VICTIM_EMAIL);
  });

  it("sends the link to the invited address instead of answering the caller with it", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
      }),
    );

    expect(sendCompleteRegistrationEmail).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = sendCompleteRegistrationEmail.mock
      .calls[0]![0] as Record<string, any>;

    expect(call["email"].toString()).toBe(VICTIM_EMAIL);
    expect(call["userId"].toString()).toBe(INVITED_USER_ID);
  });

  it("answers with the bland check-your-email response and no account", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
      }),
    );

    expect(sendEntityResponse).toHaveBeenCalledTimes(1);

    const args: Array<unknown> = sendEntityResponse.mock.calls[0]!;

    // Third argument is the entity: null, so no user is echoed back.
    expect(args[2]).toBeNull();
    expect(
      (args[4] as Record<string, any>)["miscData"]["registrationEmailSent"],
    ).toBe(true);
  });

  it("never puts a registration token in the response", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
      }),
    );

    /*
     * The token is the whole secret. If it ever reached the caller, the mail
     * would just be a courtesy copy and the fix would be worthless.
     *
     * Only the two arguments that become the body are inspected -- the entity
     * and the miscData. The request, the response and the model constructor
     * that sit alongside them are plumbing, and the constructor is not
     * serializable anyway.
     */
    const args: Array<unknown> = sendEntityResponse.mock.calls[0]!;
    const bodyParts: string = JSON.stringify([args[2], args[4]]);

    expect(bodyParts).not.toContain(VALID_TOKEN);
    expect(bodyParts.toLowerCase()).not.toContain("registrationtoken");
  });

  it("leaves the invited person able to still claim their own invitation", async () => {
    /*
     * The advisory claimed the victim gets locked out. They must not be: a
     * failed claim writes no password, so the invitation is still theirs.
     */
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
      }),
    );

    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
  });
});

describe("Identity /signup - the invited person following their own invitation", () => {
  beforeEach(() => {
    consumeRegistrationToken.mockResolvedValue(true);
  });

  it("claims the account when the token checks out", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "alice-chosen-passphrase",
        registrationToken: VALID_TOKEN,
      }),
    );

    expect(userUpdateOneByIdAndFetch).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = userUpdateOneByIdAndFetch.mock
      .calls[0]![0] as Record<string, any>;

    expect(call["id"].toString()).toBe(INVITED_USER_ID);
    expect(call["data"]["password"]).toBeDefined();
  });

  it("marks the address verified, because spending the token proved it", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "alice-chosen-passphrase",
        registrationToken: VALID_TOKEN,
      }),
    );

    const call: Record<string, any> = userUpdateOneByIdAndFetch.mock
      .calls[0]![0] as Record<string, any>;

    expect(call["data"]["isEmailVerified"]).toBe(true);
  });

  it("signs them in", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "alice-chosen-passphrase",
        registrationToken: VALID_TOKEN,
      }),
    );

    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("does not ask them to verify an address they just proved they own", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "alice-chosen-passphrase",
        registrationToken: VALID_TOKEN,
      }),
    );

    expect(createEmailVerificationToken).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does not also mail them a fresh registration link", async () => {
    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "alice-chosen-passphrase",
        registrationToken: VALID_TOKEN,
      }),
    );

    expect(sendCompleteRegistrationEmail).not.toHaveBeenCalled();
  });

  describe("the account in the response body", () => {
    beforeEach(() => {
      /*
       * The claim re-reads the row with a narrow select today, so nothing
       * secret comes back from it. That select is one edit away from widening,
       * and the response must not depend on it staying narrow: the row handed
       * back here carries every secret column a stored account can hold.
       */
      const claimedUser: User = new User();
      claimedUser._id = INVITED_USER_ID;
      claimedUser.email = new Email(VICTIM_EMAIL);
      claimedUser.name = new Name("Alice");
      claimedUser.isMasterAdmin = false;

      userUpdateOneByIdAndFetch.mockResolvedValue(
        withSecretColumns(claimedUser),
      );
    });

    it("never carries the password hash, its salt, or any other secret column", async () => {
      await invoke(
        "/signup",
        signupBody({
          email: VICTIM_EMAIL,
          password: "alice-chosen-passphrase",
          registrationToken: VALID_TOKEN,
        }),
      );

      expect(sendEntityResponse).toHaveBeenCalledTimes(1);
      expectNoUserSecrets(sentEntityBody(sendEntityResponse.mock.calls[0]!));
    });

    it("still carries what the sign-in page reads to start the session", async () => {
      await invoke(
        "/signup",
        signupBody({
          email: VICTIM_EMAIL,
          password: "alice-chosen-passphrase",
          registrationToken: VALID_TOKEN,
        }),
      );

      const body: JSONObject = sentEntityBody(
        sendEntityResponse.mock.calls[0]!,
      );

      expect(body["_id"]).toBe(INVITED_USER_ID);
      expect(body["email"]).toEqual({ _type: "Email", value: VICTIM_EMAIL });
      expect(body["name"]).toEqual({ _type: "Name", value: "Alice" });
      expect(body["isMasterAdmin"]).toBe(false);
    });
  });
});

describe("Identity /signup - the paths that must not have changed", () => {
  it("still refuses an address that has finished registering", async () => {
    userFindOneBy.mockResolvedValue(registeredUser());

    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
      }),
    );

    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    expectNothingHappened();
  });

  it("does not go looking for a token when the account already has a password", async () => {
    /*
     * A registered account is not claimable at all, so the token branch must be
     * unreachable -- otherwise a valid token for one's own old invitation would
     * be a way back into an account that has since been given a password.
     */
    userFindOneBy.mockResolvedValue(registeredUser());

    await invoke(
      "/signup",
      signupBody({
        email: VICTIM_EMAIL,
        password: "attacker-chosen-passphrase",
        registrationToken: VALID_TOKEN,
      }),
    );

    expect(consumeRegistrationToken).not.toHaveBeenCalled();
    expect(sendCompleteRegistrationEmail).not.toHaveBeenCalled();
  });

  it("signs a brand-new person up with no token in sight", async () => {
    userFindOneBy.mockResolvedValue(null);
    userCreateUserOnSignup.mockResolvedValue({
      _id: INVITED_USER_ID,
      id: {
        toString: (): string => {
          return INVITED_USER_ID;
        },
      },
      email: {
        toString: (): string => {
          return "newcomer@example.com";
        },
      },
    });

    await invoke(
      "/signup",
      signupBody({
        email: "newcomer@example.com",
        password: "violet river lantern",
      }),
    );

    expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);
    expect(consumeRegistrationToken).not.toHaveBeenCalled();
    expect(sendCompleteRegistrationEmail).not.toHaveBeenCalled();

    /*
     * Signed in at once only where no email verification is waiting: on the
     * hosted service a new account gets its session after the welcome link is
     * followed (SignupEmailVerification.test.ts), never from this request.
     */
    expect(createSession).toHaveBeenCalledTimes(IsBillingEnabled ? 0 : 1);
  });

  it("still sends the ordinary welcome-and-verify email to a brand-new person", async () => {
    userFindOneBy.mockResolvedValue(null);
    userCreateUserOnSignup.mockResolvedValue({
      _id: INVITED_USER_ID,
      id: {
        toString: (): string => {
          return INVITED_USER_ID;
        },
      },
      email: {
        toString: (): string => {
          return "newcomer@example.com";
        },
      },
    });

    await invoke(
      "/signup",
      signupBody({
        email: "newcomer@example.com",
        password: "violet river lantern",
      }),
    );

    /*
     * The hosted service's welcome asks to verify the address, with a token;
     * a self-hosted server's says the account is ready, and has nothing to
     * verify (#7988).
     */
    expect(createEmailVerificationToken).toHaveBeenCalledTimes(
      IsBillingEnabled ? 1 : 0,
    );
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(
      (sendMail.mock.calls[0]![0] as Record<string, unknown>)["templateType"],
    ).toBe(
      IsBillingEnabled
        ? "SignupWelcomeEmail.hbs"
        : "SignupAccountReadyEmail.hbs",
    );
  });
});

/*
 * #7471: the sign-up page an invitation opens says which project invited
 * them, and creating the account joins it - nothing is asked twice. The
 * page asks POST /sign-up-invitation with the address and the token, and
 * sends back the project it showed; a sign-up that claims the account with
 * the token accepts that project's invitation, before the session opens.
 * Anything short of a claim accepts nothing.
 */
describe("Identity /sign-up-invitation - what the sign-up page may say", () => {
  it("hands the address and the token to SignUpInvitation, and answers with what it read", async () => {
    readSignUpInvitation.mockResolvedValue({
      projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      projectName: "Walk Co",
      inviterName: "Ada Walker",
      name: "Grace Member",
      isAccepted: false,
    });

    await invoke("/sign-up-invitation", {
      email: VICTIM_EMAIL,
      token: VALID_TOKEN,
    });

    expect(readSignUpInvitation).toHaveBeenCalledWith({
      email: VICTIM_EMAIL,
      token: VALID_TOKEN,
    });
    expect(sendJsonObjectResponse.mock.calls[0]![2]).toEqual({
      invitation: {
        projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        projectName: "Walk Co",
        inviterName: "Ada Walker",
        name: "Grace Member",
        isAccepted: false,
      },
    });
    expect(setNoCacheHeaders).toHaveBeenCalled();
  });

  it("answers none, the same for everyone, when there is nothing to say", async () => {
    readSignUpInvitation.mockResolvedValue(null);

    await invoke("/sign-up-invitation", { email: VICTIM_EMAIL });

    expect(sendJsonObjectResponse.mock.calls[0]![2]).toEqual({
      invitation: null,
    });
  });

  it("never spends the token: only /signup does", async () => {
    readSignUpInvitation.mockResolvedValue(null);

    await invoke("/sign-up-invitation", {
      email: VICTIM_EMAIL,
      token: VALID_TOKEN,
    });

    expect(consumeRegistrationToken).not.toHaveBeenCalled();
    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("Identity /signup - joining the project the sign-up page named", () => {
  const PROJECT_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  function signupBodyNaming(projectId: unknown): JSONObject {
    const body: JSONObject = signupBody({
      email: VICTIM_EMAIL,
      password: "alice-chosen-passphrase",
      registrationToken: VALID_TOKEN,
    });

    (body["miscDataProps"] as JSONObject)["invitationProjectId"] =
      projectId as string;

    return body;
  }

  it("accepts the named project's invitation for the account the token claimed", async () => {
    consumeRegistrationToken.mockResolvedValue(true);

    await invoke("/signup", signupBodyNaming(PROJECT_ID));

    expect(acceptForClaimedAccount).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = acceptForClaimedAccount.mock
      .calls[0]![0] as Record<string, any>;

    expect(call["userId"].toString()).toBe(INVITED_USER_ID);
    expect(call["projectId"]).toBe(PROJECT_ID);
  });

  it("accepts it after the account is claimed, and before the session opens with its permissions", async () => {
    consumeRegistrationToken.mockResolvedValue(true);

    await invoke("/signup", signupBodyNaming(PROJECT_ID));

    const accepted: number =
      acceptForClaimedAccount.mock.invocationCallOrder[0]!;

    expect(accepted).toBeGreaterThan(
      userUpdateOneByIdAndFetch.mock.invocationCallOrder[0]!,
    );
    expect(accepted).toBeLessThan(
      refreshUserAllPermissions.mock.invocationCallOrder[0]!,
    );
    expect(accepted).toBeLessThan(createSession.mock.invocationCallOrder[0]!);
  });

  it("accepts nothing when the token does not claim the account", async () => {
    consumeRegistrationToken.mockResolvedValue(false);

    await invoke("/signup", signupBodyNaming(PROJECT_ID));

    expect(acceptForClaimedAccount).not.toHaveBeenCalled();
    expectNothingHappened();
  });

  it("accepts nothing for a brand-new account: there is no invitation behind it", async () => {
    userFindOneBy.mockResolvedValue(null);
    userCreateUserOnSignup.mockResolvedValue({
      _id: INVITED_USER_ID,
      id: {
        toString: (): string => {
          return INVITED_USER_ID;
        },
      },
      email: {
        toString: (): string => {
          return "newcomer@example.com";
        },
      },
      name: {
        toString: (): string => {
          return "Newcomer";
        },
      },
    });

    await invoke("/signup", signupBodyNaming(PROJECT_ID));

    expect(acceptForClaimedAccount).not.toHaveBeenCalled();
  });

  it("hands on whatever the page sent, for SignUpInvitation to refuse what is not a project", async () => {
    consumeRegistrationToken.mockResolvedValue(true);

    await invoke("/signup", signupBodyNaming(undefined));

    expect(acceptForClaimedAccount).toHaveBeenCalledTimes(1);
    expect(
      (acceptForClaimedAccount.mock.calls[0]![0] as Record<string, unknown>)[
        "projectId"
      ],
    ).toBeUndefined();
    // The account is still claimed, and signed in.
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
