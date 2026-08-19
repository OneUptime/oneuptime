import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import Exception from "Common/Types/Exception/Exception";
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

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
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
      sendJsonObjectResponse: jest.fn(),
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
      signupBody({ email: VICTIM_EMAIL, password: "attacker-chosen" }),
    );

    expectNothingHappened();
  });

  it("does not consult the token service at all when no token is supplied", async () => {
    await invoke(
      "/signup",
      signupBody({ email: VICTIM_EMAIL, password: "attacker-chosen" }),
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
        password: "attacker-chosen",
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
        password: "attacker-chosen",
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
        password: "attacker-chosen",
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
        password: "attacker-chosen",
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
      signupBody({ email: VICTIM_EMAIL, password: "attacker-chosen" }),
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
      signupBody({ email: VICTIM_EMAIL, password: "attacker-chosen" }),
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
      signupBody({ email: VICTIM_EMAIL, password: "attacker-chosen" }),
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
      signupBody({ email: VICTIM_EMAIL, password: "attacker-chosen" }),
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
        password: "alice-chosen",
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
        password: "alice-chosen",
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
        password: "alice-chosen",
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
        password: "alice-chosen",
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
        password: "alice-chosen",
        registrationToken: VALID_TOKEN,
      }),
    );

    expect(sendCompleteRegistrationEmail).not.toHaveBeenCalled();
  });
});

describe("Identity /signup - the paths that must not have changed", () => {
  it("still refuses an address that has finished registering", async () => {
    userFindOneBy.mockResolvedValue(registeredUser());

    await invoke(
      "/signup",
      signupBody({ email: VICTIM_EMAIL, password: "attacker-chosen" }),
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
        password: "attacker-chosen",
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
      signupBody({ email: "newcomer@example.com", password: "hunter2" }),
    );

    expect(userCreateUserOnSignup).toHaveBeenCalledTimes(1);
    expect(consumeRegistrationToken).not.toHaveBeenCalled();
    expect(sendCompleteRegistrationEmail).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
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
      signupBody({ email: "newcomer@example.com", password: "hunter2" }),
    );

    expect(createEmailVerificationToken).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
