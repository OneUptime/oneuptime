import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import ConfigLogLevel from "Common/Server/Types/ConfigLogLevel";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Regression tests for GHSA-c4c2-r4hm-6pjj -- "Login passwords and MFA
 * material are written to debug logs".
 *
 * The shared login handler used to open with
 * `logger.debug("Login request data: " + JSON.stringify(req.body, null, 2))`.
 * Three routes funnel through that handler, so the line wrote a plaintext
 * password, a TOTP code, or a WebAuthn assertion -- plus the CAPTCHA token --
 * to stdout, to the recent-log ring buffer the support bundle reads back, and
 * to the telemetry exporter, on every login attempt made while DEBUG was on.
 *
 * These tests drive the REAL handlers with the REAL logger at DEBUG, with the
 * sentinel values a login carries, and assert none of them reaches any sink.
 * Mocking the logger would assert the mock.
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

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

interface EmittedRecord {
  body: string;
  attributes?: Record<string, unknown> | undefined;
}

const emitted: Array<EmittedRecord> = [];

// The telemetry sink, captured rather than exported.
jest.mock("Common/Server/Utils/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getLogger: (): unknown => {
        return {
          emit: (record: EmittedRecord): void => {
            emitted.push(record);
          },
        };
      },
    },
  };
});

const userFindOneBy: jest.Mock = jest.fn();
const verifyHashedColumnValue: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      verifyHashedColumnValue: (...args: Array<unknown>): unknown => {
        return verifyHashedColumnValue(...args);
      },
      updateOneBy: jest.fn(),
      updateOneById: jest.fn(),
      updateOneByIdAndFetch: jest.fn(),
      create: jest.fn(),
      createUserOnSignup: jest.fn(),
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
  };
});

const totpFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
      },
      findOneBy: (...args: Array<unknown>): unknown => {
        return totpFindOneBy(...args);
      },
    },
  };
});

const verifyWebAuthnAuthentication: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
      },
      verifyAuthentication: (...args: Array<unknown>): unknown => {
        return verifyWebAuthnAuthentication(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: jest.fn(),
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (): Promise<void> => {
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

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: { sendVerificationEmail: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

// The real logger, deliberately: this suite is about what it writes.
import logger from "Common/Server/Utils/Logger";

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const PASSWORD_SENTINEL: string = "sentinel-password-a1b2c3d4";
const TOTP_SENTINEL: string = "907351";
const WEBAUTHN_SENTINEL: string = "sentinel-webauthn-assertion-e5f6a7b8";
const CAPTCHA_SENTINEL: string = "sentinel-captcha-token-c9d0e1f2";

type LogMethod = "info" | "error" | "warn" | "debug" | "trace";

const ALL_LEVELS: Array<LogMethod> = [
  "info",
  "error",
  "warn",
  "debug",
  "trace",
];

interface ConsoleSpy {
  mock: { calls: Array<Array<unknown>> };
}

type ConsoleSpies = Record<LogMethod, ConsoleSpy>;

let consoleSpies: ConsoleSpies;

type CollectSinkTextFunction = () => string;

// stdout + recent-log ring buffer + telemetry, as one blob to search.
const collectSinkText: CollectSinkTextFunction = (): string => {
  const parts: Array<string> = [];

  for (const level of ALL_LEVELS) {
    for (const call of consoleSpies[level].mock.calls) {
      for (const argument of call) {
        if (typeof argument === "string") {
          parts.push(argument);
        } else if (argument instanceof Error) {
          parts.push(`${argument.message} ${argument.stack || ""}`);
        } else {
          try {
            parts.push(JSON.stringify(argument));
          } catch {
            parts.push(String(argument));
          }
        }
      }
    }
  }

  for (const entry of logger.getRecentLogs()) {
    parts.push(entry.message);
  }

  for (const record of emitted) {
    parts.push(record.body);
    parts.push(JSON.stringify(record.attributes || {}));
  }

  return parts.join("\n");
};

type InvokeFunction = (uri: string, body: unknown) => Promise<void>;

const invoke: InvokeFunction = async (
  uri: string,
  body: unknown,
): Promise<void> => {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body);
  const res: ExpressResponse = buildResponse();
  const next: NextFunction = ((): void => {}) as unknown as NextFunction;

  /*
   * The mocked services make some of these paths bail out; where they land is
   * not the point. The point is what was written on the way there.
   */
  try {
    await handler(req, res, next);
  } catch {
    // Intentionally ignored -- see above.
  }
};

describe("Identity login handlers do not log credentials", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emitted.length = 0;

    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.DEBUG);

    consoleSpies = {
      info: jest.spyOn(console, "info").mockImplementation(() => {}),
      error: jest.spyOn(console, "error").mockImplementation(() => {}),
      warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
      debug: jest.spyOn(console, "debug").mockImplementation(() => {}),
      trace: jest.spyOn(console, "trace").mockImplementation(() => {}),
    } as unknown as ConsoleSpies;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not log the password on /login", async () => {
    await invoke("/login", {
      data: { email: "user@example.com", password: PASSWORD_SENTINEL },
      miscDataProps: { captchaToken: CAPTCHA_SENTINEL },
    });

    const output: string = collectSinkText();

    // The handler ran and did log -- this is not passing on silence.
    expect(output).toContain("Login request received");
    expect(output).not.toContain(PASSWORD_SENTINEL);
    expect(output).not.toContain(CAPTCHA_SENTINEL);

    /*
     * Redaction is the safety net; the fix is that the body is not serialized
     * into a log line at all. `miscDataProps` is a body-only key that carries
     * no secret of its own, so it would survive redaction -- seeing it here
     * would mean the body is being dumped again.
     */
    expect(output).not.toContain("miscDataProps");
  });

  it("does not log the password when the account exists and the password is wrong", async () => {
    userFindOneBy.mockResolvedValue({
      id: {
        toString: (): string => {
          return "user-id";
        },
      },
      password: {
        toString: (): string => {
          return "hashed";
        },
      },
      email: {
        toString: (): string => {
          return "user@example.com";
        },
      },
      isEmailVerified: true,
      enableTwoFactorAuth: false,
    });
    verifyHashedColumnValue.mockResolvedValue(false);

    await invoke("/login", {
      data: { email: "user@example.com", password: PASSWORD_SENTINEL },
    });

    expect(collectSinkText()).not.toContain(PASSWORD_SENTINEL);
  });

  it("does not log the TOTP code on /verify-totp-auth", async () => {
    userFindOneBy.mockResolvedValue({
      id: {
        toString: (): string => {
          return "user-id";
        },
      },
      password: {
        toString: (): string => {
          return "hashed";
        },
      },
      email: {
        toString: (): string => {
          return "user@example.com";
        },
      },
      isEmailVerified: true,
      enableTwoFactorAuth: true,
    });
    verifyHashedColumnValue.mockResolvedValue(true);
    totpFindOneBy.mockResolvedValue(null);

    await invoke("/verify-totp-auth", {
      data: {
        email: "user@example.com",
        password: PASSWORD_SENTINEL,
        code: TOTP_SENTINEL,
        twoFactorAuthId: "6543210987654321",
      },
    });

    const output: string = collectSinkText();

    expect(output).toContain("Login request received");
    expect(output).not.toContain(TOTP_SENTINEL);
    expect(output).not.toContain(PASSWORD_SENTINEL);
  });

  it("does not log WebAuthn assertion material on /verify-webauthn-auth", async () => {
    userFindOneBy.mockResolvedValue({
      id: {
        toString: (): string => {
          return "user-id";
        },
      },
      password: {
        toString: (): string => {
          return "hashed";
        },
      },
      email: {
        toString: (): string => {
          return "user@example.com";
        },
      },
      isEmailVerified: true,
      enableTwoFactorAuth: true,
    });
    verifyHashedColumnValue.mockResolvedValue(true);
    verifyWebAuthnAuthentication.mockRejectedValue(
      new Error("verification failed") as never,
    );

    await invoke("/verify-webauthn-auth", {
      data: {
        email: "user@example.com",
        password: PASSWORD_SENTINEL,
        credential: {
          id: "credential-id",
          rawId: WEBAUTHN_SENTINEL,
          response: {
            clientDataJSON: WEBAUTHN_SENTINEL,
            authenticatorData: WEBAUTHN_SENTINEL,
            signature: WEBAUTHN_SENTINEL,
            userHandle: WEBAUTHN_SENTINEL,
          },
        },
      },
    });

    const output: string = collectSinkText();

    expect(output).toContain("Login request received");
    expect(output).not.toContain(WEBAUTHN_SENTINEL);
    expect(output).not.toContain(PASSWORD_SENTINEL);
  });

  it("does not log the reset-password link, which carries a live reset token", async () => {
    const resetToken: string = "sentinel-reset-token-b3c4d5e6";

    userFindOneBy.mockResolvedValue({
      id: {
        toString: (): string => {
          return "user-id";
        },
      },
      email: {
        toString: (): string => {
          return "user@example.com";
        },
      },
      name: {
        toString: (): string => {
          return "User";
        },
      },
      resetPasswordToken: resetToken,
    });

    await invoke("/forgot-password", {
      data: { email: "user@example.com" },
    });

    expect(collectSinkText()).not.toContain(resetToken);
  });
});
