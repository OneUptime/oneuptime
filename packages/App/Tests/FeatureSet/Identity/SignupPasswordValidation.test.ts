import {
  buildRequest,
  buildResponse,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import AuthenticationEmail from "../../../FeatureSet/Identity/Utils/AuthenticationEmail";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "Common/Models/DatabaseModels/User";
import UserSession from "Common/Models/DatabaseModels/UserSession";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import MailService from "Common/Server/Services/MailService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import UserSessionService from "Common/Server/Services/UserSessionService";
import CookieUtil from "Common/Server/Utils/Cookie";
import Express, {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import UserRegistrationToken from "Common/Server/Utils/UserRegistrationToken";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import HashedString from "Common/Types/HashedString";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, it } from "@jest/globals";
import "../../../FeatureSet/Identity/API/Authentication";

/*
 * Keep the real model deserializer and password policy in this route test.
 * Only persistence and external effects are replaced.
 */
jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  );
  const util: typeof import("./IdentityRouterTestUtil") = jest.requireActual(
    "./IdentityRouterTestUtil",
  );
  const router: MockIdentityRouter = util.createMockIdentityRouter();

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockIdentityRouter => {
        return router;
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

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      shouldDisableSignup: jest.fn(),
      getHost: jest.fn().mockResolvedValue("localhost"),
      getHttpProtocol: jest.fn().mockResolvedValue("http://"),
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      createUserOnSignup: jest.fn(),
      updateOneByIdAndFetch: jest.fn(),
      verifyHashedColumnValue: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: { createSession: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
  };
});

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: { sendMail: jest.fn().mockResolvedValue(undefined) },
  };
});

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn().mockResolvedValue([]) },
  };
});

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn().mockResolvedValue([]) },
  };
});

jest.mock("Common/Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    default: { consumeRegistrationToken: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Captcha", () => {
  return {
    __esModule: true,
    default: { verifyCaptcha: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: { setUserCookie: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: { signUserLoginToken: jest.fn().mockReturnValue("access-token") },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: { sendErrorResponse: jest.fn(), sendEntityResponse: jest.fn() },
  };
});

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: jest.fn(),
      sendCompleteRegistrationEmail: jest.fn(),
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

const mockRouter: MockIdentityRouter =
  Express.getRouter() as unknown as MockIdentityRouter;
const VALID_PASSWORD: string = "violet river lantern";
const VALID_TOKEN: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let savedUser: User;

async function invoke(
  body: unknown,
  route: string = "/signup",
): Promise<{
  nextError: Exception | null;
}> {
  const handler: RouteHandler = mockRouter.match("post", route);
  const req: ExpressRequest = buildRequest(body);
  const res: ExpressResponse = buildResponse();
  let nextError: Exception | null = null;
  const next: NextFunction = ((error?: Exception): void => {
    nextError = error || null;
  }) as NextFunction;

  await handler(req, res, next);
  return { nextError };
}

function signupBody(password: unknown): unknown {
  return {
    data: {
      email: "new-user@example.com",
      name: "New User",
      password,
    },
    miscDataProps: { registrationToken: VALID_TOKEN },
  };
}

function expectNoSignupEffects(): void {
  expect(UserService.createUserOnSignup).not.toHaveBeenCalled();
  expect(UserService.updateOneByIdAndFetch).not.toHaveBeenCalled();
  expect(UserRegistrationToken.consumeRegistrationToken).not.toHaveBeenCalled();
  expect(UserSessionService.createSession).not.toHaveBeenCalled();
  expect(CookieUtil.setUserCookie).not.toHaveBeenCalled();
  expect(AccessTokenService.refreshUserAllPermissions).not.toHaveBeenCalled();
  expect(EmailVerificationTokenService.create).not.toHaveBeenCalled();
  expect(MailService.sendMail).not.toHaveBeenCalled();
  expect(
    AuthenticationEmail.sendCompleteRegistrationEmail,
  ).not.toHaveBeenCalled();
  expect(Response.sendEntityResponse).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  savedUser = new User();
  savedUser.id = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  savedUser.email = new Email("new-user@example.com");
  savedUser.name = new Name("New User");
  savedUser.isEmailVerified = true;
  savedUser.enableTwoFactorAuth = false;

  const session: UserSession = new UserSession();
  session.id = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

  jest.mocked(DatabaseConfig.shouldDisableSignup).mockResolvedValue(false);
  jest.mocked(UserService.findOneBy).mockResolvedValue(null);
  jest.mocked(UserService.createUserOnSignup).mockResolvedValue(savedUser);
  jest.mocked(UserService.updateOneByIdAndFetch).mockResolvedValue(savedUser);
  jest
    .mocked(UserRegistrationToken.consumeRegistrationToken)
    .mockResolvedValue(true);
  jest.mocked(UserSessionService.createSession).mockResolvedValue({
    session,
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date("2030-01-01"),
  });
});

describe("Identity /signup password validation", () => {
  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", "                "],
    ["formerly accepted six characters", "hunter"],
    ["one below the minimum", "V7m!r2@K9p#s4Q"],
    ["over the maximum", "a".repeat(101)],
    ["repeated letters", "a".repeat(15)],
    ["repeated words", "passwordpassword"],
    ["numeric sequence", "123456789012345"],
    ["keyboard sequence", "qwertyuiopasdfgh"],
    ["boolean", true],
    ["number", 123456789012345],
    ["array", [VALID_PASSWORD]],
    ["plain object", { value: VALID_PASSWORD }],
    ["wrong serialized type", { _type: "Name", value: VALID_PASSWORD }],
    ["missing serialized value", { _type: "HashedString" }],
    ["null serialized value", { _type: "HashedString", value: null }],
    ["boolean serialized value", { _type: "HashedString", value: true }],
    [
      "number serialized value",
      { _type: "HashedString", value: 123456789012345 },
    ],
    [
      "array serialized value",
      { _type: "HashedString", value: [VALID_PASSWORD] },
    ],
    [
      "nested serialized value",
      {
        _type: "HashedString",
        value: { _type: "HashedString", value: VALID_PASSWORD },
      },
    ],
    ["weak serialized value", { _type: "HashedString", value: "hunter2" }],
    [
      "pre-hashed flag on a weak value",
      { _type: "HashedString", value: "hunter2", isHashed: true },
    ],
  ])(
    "rejects a %s password before signup effects",
    async (_name: string, password: unknown) => {
      const result: { nextError: Exception | null } = await invoke(
        signupBody(password),
      );

      expect(result.nextError).toBeInstanceOf(BadDataException);
      expect(UserService.findOneBy).not.toHaveBeenCalled();
      expectNoSignupEffects();
    },
  );

  it.each([undefined, null, {}, { data: null }, { data: {} }])(
    "rejects a missing password in body %p with a useful error",
    async (body: unknown) => {
      const result: { nextError: Exception | null } = await invoke(body);

      expect(result.nextError).toBeInstanceOf(BadDataException);
      expect(result.nextError?.message).toBe("Password is required.");
      expectNoSignupEffects();
    },
  );

  it("returns an actionable minimum-length message", async () => {
    const result: { nextError: Exception | null } = await invoke(
      signupBody("hunter2"),
    );

    expect(result.nextError?.message).toBe(
      "Password must be at least 15 characters.",
    );
  });

  it.each([
    ["minimum-length password manager value", "V7m!r2@K9p#s4Q8"],
    ["lowercase passphrase", VALID_PASSWORD],
    ["spaces at either end", "  violet river lantern  "],
    ["Unicode", "星月山川花鳥風雨空海森光夢希望"],
    ["maximum-length value", "violet river lantern".repeat(5)],
  ])(
    "accepts a %s without changing the secret",
    async (_name: string, password: string) => {
      const result: { nextError: Exception | null } = await invoke(
        signupBody(password),
      );

      expect(result.nextError).toBeNull();
      expect(UserService.createUserOnSignup).toHaveBeenCalledTimes(1);
      const createdUser: User = jest.mocked(UserService.createUserOnSignup).mock
        .calls[0]![0].user;
      expect(createdUser.password).toBeInstanceOf(HashedString);
      expect(createdUser.password!.toString()).toBe(password);
      expect(createdUser.password!.isValueHashed()).toBe(false);
      expect(UserSessionService.createSession).toHaveBeenCalledTimes(1);
      expect(Response.sendEntityResponse).toHaveBeenCalledTimes(1);
    },
  );

  it("accepts a request serialized by the model form", async () => {
    const user: User = new User();
    user.email = new Email("new-user@example.com");
    user.name = new Name("New User");
    user.password = new HashedString(VALID_PASSWORD);

    const result: { nextError: Exception | null } = await invoke({
      data: BaseModel.toJSON(user, User),
    });

    expect(result.nextError).toBeNull();
    expect(UserService.createUserOnSignup).toHaveBeenCalledTimes(1);
    const createdUser: User = jest.mocked(UserService.createUserOnSignup).mock
      .calls[0]![0].user;
    expect(createdUser.password!.toString()).toBe(VALID_PASSWORD);
    expect(UserSessionService.createSession).toHaveBeenCalledTimes(1);
  });

  it("ignores a caller's pre-hashed flag and preserves the plaintext", async () => {
    const password: string = "  violet river lantern  ";
    const result: { nextError: Exception | null } = await invoke(
      signupBody({
        _type: "HashedString",
        value: password,
        isHashed: true,
      }),
    );

    expect(result.nextError).toBeNull();
    const createdUser: User = jest.mocked(UserService.createUserOnSignup).mock
      .calls[0]![0].user;
    expect(createdUser.password!.toString()).toBe(password);
    expect(createdUser.password!.isValueHashed()).toBe(false);
  });

  it("leaves a valid invitation usable after a weak-password attempt", async () => {
    jest.mocked(UserService.findOneBy).mockResolvedValue(savedUser);

    const rejected: { nextError: Exception | null } = await invoke(
      signupBody("hunter2"),
    );
    expect(rejected.nextError).toBeInstanceOf(BadDataException);
    expectNoSignupEffects();

    const accepted: { nextError: Exception | null } = await invoke(
      signupBody({
        _type: "HashedString",
        value: `  ${VALID_PASSWORD}  `,
      }),
    );
    expect(accepted.nextError).toBeNull();
    expect(
      UserRegistrationToken.consumeRegistrationToken,
    ).toHaveBeenCalledTimes(1);
    expect(UserService.updateOneByIdAndFetch).toHaveBeenCalledTimes(1);
    const update: Parameters<typeof UserService.updateOneByIdAndFetch>[0] =
      jest.mocked(UserService.updateOneByIdAndFetch).mock.calls[0]![0];
    expect(update.data.password).toBeInstanceOf(HashedString);
    expect((update.data.password as HashedString).toString()).toBe(
      `  ${VALID_PASSWORD}  `,
    );
    expect(UserSessionService.createSession).toHaveBeenCalledTimes(1);
    expect(UserService.createUserOnSignup).not.toHaveBeenCalled();
  });

  it("enforces the same policy when signup is disabled but an invitation exists", async () => {
    jest.mocked(DatabaseConfig.shouldDisableSignup).mockResolvedValue(true);
    jest.mocked(UserService.findOneBy).mockResolvedValue(savedUser);
    jest.mocked(TeamMemberService.findOneBy).mockResolvedValue({} as never);

    const result: { nextError: Exception | null } = await invoke(
      signupBody("hunter2"),
    );

    expect(result.nextError).toBeInstanceOf(BadDataException);
    expectNoSignupEffects();
  });

  it("keeps existing accounts with short passwords able to log in", async () => {
    savedUser.password = new HashedString("stored-hash", true);
    jest.mocked(UserService.findOneBy).mockResolvedValue(savedUser);
    jest.mocked(UserService.verifyHashedColumnValue).mockResolvedValue(true);

    const result: { nextError: Exception | null } = await invoke(
      {
        data: { email: "new-user@example.com", password: "hunter2" },
      },
      "/login",
    );

    expect(result.nextError).toBeNull();
    expect(UserService.verifyHashedColumnValue).toHaveBeenCalledWith(
      expect.objectContaining({
        plainValue: "hunter2",
      }),
    );
    expect(UserSessionService.createSession).toHaveBeenCalledTimes(1);
    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
  });
});
