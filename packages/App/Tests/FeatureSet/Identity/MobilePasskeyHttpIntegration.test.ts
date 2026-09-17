import AuthenticationRouter from "../../../FeatureSet/Identity/API/Authentication";
import User from "Common/Models/DatabaseModels/User";
import UserSession from "Common/Models/DatabaseModels/UserSession";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import Redis from "Common/Server/Infrastructure/Redis";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "Common/Server/Middleware/IdentityRateLimit";
import UserService from "Common/Server/Services/UserService";
import UserSessionService from "Common/Server/Services/UserSessionService";
import UserWebAuthnService from "Common/Server/Services/UserWebAuthnService";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import ResponseUtil from "Common/Server/Utils/Response";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import getTestRedisConnectionOptions from "Common/Tests/Server/TestingUtils/Redis/TestRedisOptions";
import MobilePasskeyUser from "Common/Tests/Fixtures/MobilePasskeyUser.json";
import {
  AssertionOverrides,
  CookieParser,
  createSignedPasskeyFixture,
  listenForPasskeyTest,
  SignedPasskeyFixture,
  TestRedisClient,
  TestRedisOptions,
} from "Common/Tests/Server/TestingUtils/PasskeyHttpIntegration";
import { createHash, generateKeyPairSync, randomBytes } from "crypto";
import { Server } from "http";

/*
 * Run the production Express router, cookie parser, limiter, Redis Lua,
 * WebAuthn verification, JWT signing and JSON serializer over HTTP. Only
 * database-backed dependencies and telemetry are replaced. The loopback
 * listener represents the application behind its HTTPS reverse proxy;
 * browser Origin/clientData and secure cookie attributes remain enforced.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    Host: "self-hosted.example:8443",
    HttpProtocol: "https://",
    EncryptionSecret: "mobile-passkey-http-integration-only-secret",
  };
});
jest.mock("Common/Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class {
      public findOneBy: jest.Mock = jest.fn();
      public updateOneById: jest.Mock = jest.fn();
    },
  };
});
jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});
jest.mock("Common/Server/Services/UserService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});
jest.mock("Common/Server/Services/UserSessionService", () => {
  return { __esModule: true, default: { createSession: jest.fn() } };
});
jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
  };
});
jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Services/TeamMemberService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Services/MailService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/DatabaseConfig", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Utils/TwoFactorBackupCodeNotification", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: () => {
      return {};
    },
  };
});

const ORIGIN: string = "https://self-hosted.example:8443";
const COOKIE: string = "oneuptime-passkey-login";
const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SESSION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const REFRESH_EXPIRES: Date = new Date("2099-01-01T00:00:00.000Z");
const redisUrl: string | undefined =
  process.env["MOBILE_PASSKEY_TEST_REDIS_URL"];

interface HttpResult {
  response: Response;
  body: Record<string, any>;
}

interface MobileAttempt {
  cookie: string;
  challengeId: string;
  challenge: string;
  verifier: string;
  state: string;
}

let server: Server;
let httpOrigin: string;
let client: TestRedisClient;
let namespace: string;
let user: User;
let passkey: SignedPasskeyFixture;

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.use(CookieParser());
  app.use("/identity", AuthenticationRouter);
  app.use(
    (
      error: Exception,
      req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      ResponseUtil.sendErrorResponse(req, res, error);
    },
  );
  ({ server, origin: httpOrigin } = await listenForPasskeyTest(app));
});

beforeEach(async () => {
  jest.clearAllMocks();
  namespace = `mobile-passkey-http-test:${randomBytes(16).toString("hex")}:`;
  const options: TestRedisOptions = {
    keyPrefix: namespace,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => {
      return null;
    },
  };
  client = redisUrl
    ? new TestRedisClient(redisUrl, options)
    : new TestRedisClient({ ...getTestRedisConnectionOptions(), ...options });
  await client.connect();
  jest.mocked(Redis.getClient).mockReturnValue(client);
  jest.mocked(Redis.isConnected).mockReturnValue(true);
  jest.spyOn(IdentityRateLimit, "getBucketConfig").mockReturnValue({
    windowSeconds: 900,
    perAccountLimit: 300,
    perIpLimit: 300,
  });
  user = new User();
  user.id = USER_ID;
  user.email = new Email("passkey@example.com");
  user.name = new Name("Passkey Tester");
  user.isEmailVerified = true;
  user.isBlocked = false;
  user.isMasterAdmin = false;
  jest.mocked(UserService.findOneById).mockResolvedValue(user);
  const session: UserSession = new UserSession();
  session.id = SESSION_ID;
  jest.mocked(UserSessionService.createSession).mockResolvedValue({
    session,
    refreshToken: "integration-refresh-token",
    refreshTokenExpiresAt: REFRESH_EXPIRES,
  });
  jest.mocked(AccessTokenService.refreshUserAllPermissions).mockResolvedValue();
  const credentialId: string = randomBytes(32).toString("base64url");
  passkey = createSignedPasskeyFixture({
    origin: ORIGIN,
    userId: USER_ID.toString(),
    credentialId,
  });
  const savedCredential: UserWebAuthn = new UserWebAuthn();
  savedCredential.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  savedCredential.userId = USER_ID;
  savedCredential.credentialId = credentialId;
  savedCredential.publicKey = passkey.publicKey;
  savedCredential.counter = "5";
  jest.mocked(UserWebAuthnService.findOneBy).mockResolvedValue(savedCredential);
  jest.mocked(UserWebAuthnService.updateOneById).mockResolvedValue(1);
});

afterEach(async () => {
  jest.restoreAllMocks();
  if (client?.status === "ready") {
    /*
     * SCAN is restricted to this random namespace. No shared keys or database
     * are deleted, including when the suite uses CI's shared Redis instance.
     */
    const ownedPrefix: string = namespace;
    let cursor: string = "0";
    do {
      const [next, keys] = await client.scan(
        cursor,
        "MATCH",
        `${ownedPrefix}*`,
        "COUNT",
        100,
      );
      cursor = next;
      if (keys.length > 0) {
        expect(
          keys.every((key: string) => {
            return key.startsWith(ownedPrefix);
          }),
        ).toBe(true);
        await client.del(
          ...keys.map((key: string) => {
            return key.slice(ownedPrefix.length);
          }),
        );
      }
    } while (cursor !== "0");
  }
  client?.disconnect();
});

afterAll(async () => {
  if (server) {
    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        server.close((error?: Error) => {
          return error ? reject(error) : resolve();
        });
      },
    );
  }
});

async function post(
  route: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  const response: Response = await fetch(`${httpOrigin}/identity/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: (await response.json()) as Record<string, any> };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function expectNoSession(result: HttpResult): void {
  expect(result.body["_miscData"]).toBeUndefined();
  expect(result.response.headers.get("set-cookie") || "").not.toMatch(
    /(?:^|,\s*)(?:user-token|user-id|user-refresh-token)=/,
  );
  expect(UserSessionService.createSession).not.toHaveBeenCalled();
  expect(AccessTokenService.refreshUserAllPermissions).not.toHaveBeenCalled();
}

function expectNoCache(result: HttpResult): void {
  expect(result.response.headers.get("cache-control")).toContain("no-store");
  expect(result.response.headers.get("pragma")).toBe("no-cache");
  expect(result.response.headers.get("expires")).toBe("0");
}

async function beginAttempt(mobile: boolean = true): Promise<MobileAttempt> {
  const verifier: string = randomBytes(32).toString("base64url");
  const state: string = randomBytes(32).toString("base64url");
  const result: HttpResult = await post(
    "passkey-login-options",
    mobile
      ? {
          mobileAuth: {
            state,
            codeChallenge: hash(verifier),
            codeChallengeMethod: "S256",
          },
        }
      : {},
    { Origin: ORIGIN },
  );
  expect(result.response.status).toBe(200);
  expectNoSession(result);
  const setCookie: string = result.response.headers.get("set-cookie")!;
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=Strict");
  expect(setCookie).toContain("Max-Age=300");
  const cookie: string = setCookie.split(";")[0]!;
  const challengeId: string = cookie
    .slice(`${COOKIE}=`.length)
    .replace(/^mobile\./, "");
  expect(challengeId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(result.body["options"]).toMatchObject({
    userVerification: "required",
    rpId: "self-hosted.example",
    allowCredentials: [],
  });
  return {
    cookie,
    challengeId,
    challenge: result.body["options"].challenge as string,
    verifier,
    state,
  };
}

async function prove(
  attempt: MobileAttempt,
  options: {
    cookie?: string;
    origin?: string;
    assertion?: AssertionOverrides;
  } = {},
): Promise<HttpResult> {
  return post(
    "passkey-login",
    {
      credential: passkey.assertion(attempt.challenge, options.assertion),
    },
    {
      Cookie: options.cookie ?? attempt.cookie,
      Origin: options.origin ?? ORIGIN,
    },
  );
}

async function issueCode(): Promise<MobileAttempt & { code: string }> {
  const attempt: MobileAttempt = await beginAttempt();
  const result: HttpResult = await prove(attempt);
  expect(result.response.status).toBe(200);
  expect(Object.keys(result.body)).toEqual(["mobileAuth"]);
  expectNoSession(result);
  expectNoCache(result);
  const callback: URL = new URL(
    result.body["mobileAuth"].callbackUrl as string,
  );
  expect(`${callback.protocol}//${callback.hostname}`).toBe(
    "oneuptime://passkey",
  );
  expect(callback.searchParams.get("state")).toBe(attempt.state);
  expect(callback.searchParams.get("serverOrigin")).toBe(ORIGIN);
  expect([...callback.searchParams.keys()].sort()).toEqual([
    "code",
    "serverOrigin",
    "state",
  ]);
  const code: string = callback.searchParams.get("code")!;
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { ...attempt, code };
}

async function exchange(
  attempt: MobileAttempt & { code: string },
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  return post(
    "mobile-passkey-exchange",
    {
      code: attempt.code,
      codeVerifier: attempt.verifier,
      state: attempt.state,
      ...overrides,
    },
    headers,
  );
}

describe("mobile passkey browser-to-app handoff over HTTP and real Redis", () => {
  it("verifies a signed assertion, returns only a code to the browser, and exchanges it for the real session wire format once", async () => {
    const attempt: MobileAttempt & { code: string } = await issueCode();
    expect(
      await client.get(`webauthn-passkey-login-${attempt.challengeId}`),
    ).toBeNull();
    expect(
      await client.get(`mobile-passkey-challenge-${hash(attempt.challengeId)}`),
    ).toBeNull();
    expect(
      await client.ttl(`mobile-passkey-code-${hash(attempt.code)}`),
    ).toBeGreaterThan(110);
    const result: HttpResult = await exchange(attempt);
    expect(result.response.status).toBe(200);
    expectNoCache(result);
    expect(result.response.headers.get("set-cookie")).toBeNull();
    // Response.sendEntityResponse puts user fields at the root, not in data.
    expect(result.body["data"]).toBeUndefined();
    const { _miscData, ...serializedUser } = result.body;
    expect(serializedUser).toEqual(MobilePasskeyUser);
    expect(_miscData).toBeDefined();
    expect(result.body).toMatchObject({
      _id: USER_ID.toString(),
      email: { _type: "Email", value: "passkey@example.com" },
      name: { _type: "Name", value: "Passkey Tester" },
      isMasterAdmin: false,
      _miscData: {
        refreshToken: "integration-refresh-token",
        refreshTokenExpiresAt: REFRESH_EXPIRES.toISOString(),
      },
    });
    const token: JSONObject = JSONWebToken.decodeJsonPayload(
      result.body["_miscData"].accessToken as string,
    );
    expect(token).toMatchObject({
      userId: USER_ID.toString(),
      sessionId: SESSION_ID.toString(),
      isGlobalLogin: true,
    });
    expect((token["exp"] as number) - (token["iat"] as number)).toBe(900);
    expect(UserSessionService.createSession).toHaveBeenCalledTimes(1);
    expect(UserSessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        isGlobalLogin: true,
        ipAddress: "127.0.0.1",
      }),
    );
    expect(AccessTokenService.refreshUserAllPermissions).toHaveBeenCalledWith(
      USER_ID,
    );
    const replay: HttpResult = await exchange(attempt);
    expect(replay.response.status).toBe(400);
    expectNoCache(replay);
    expect(replay.body["_miscData"]).toBeUndefined();
    expect(UserSessionService.createSession).toHaveBeenCalledTimes(1);
  });

  it.each(["codeVerifier", "state"])(
    "rejects the wrong %s without consuming the owner's code",
    async (field: string) => {
      const attempt: MobileAttempt & { code: string } = await issueCode();
      const rejected: HttpResult = await exchange(attempt, {
        [field]: randomBytes(32).toString("base64url"),
      });
      expect(rejected.response.status).toBe(400);
      expectNoCache(rejected);
      expectNoSession(rejected);
      expect((await exchange(attempt)).response.status).toBe(200);
    },
  );

  it("rejects another browser origin before consuming the assertion or code", async () => {
    for (const headers of [{}, { Origin: "https://other.example" }]) {
      const rejected: HttpResult = await post(
        "passkey-login-options",
        {},
        headers,
      );
      expect(rejected.response.status).toBe(400);
      expectNoSession(rejected);
      expect(rejected.response.headers.get("set-cookie")).toBeNull();
    }
    const attempt: MobileAttempt = await beginAttempt();
    const rejected: HttpResult = await prove(attempt, {
      origin: "https://other.example",
    });
    expect(rejected.response.status).toBe(400);
    expectNoSession(rejected);
    const valid: HttpResult = await prove(attempt);
    expect(valid.response.status).toBe(200);
    const code: string = new URL(
      valid.body["mobileAuth"].callbackUrl as string,
    ).searchParams.get("code")!;
    const foreignExchange: HttpResult = await exchange(
      { ...attempt, code },
      {},
      { Origin: "https://other.example" },
    );
    expect(foreignExchange.response.status).toBe(400);
    expectNoCache(foreignExchange);
    expectNoSession(foreignExchange);
    expect((await exchange({ ...attempt, code })).response.status).toBe(200);
  });

  it("does not replace the browser cookie with a body-supplied challenge ID", async () => {
    const attempt: MobileAttempt = await beginAttempt();
    const rejected: HttpResult = await post(
      "passkey-login",
      {
        challengeId: attempt.challengeId,
        credential: passkey.assertion(attempt.challenge),
      },
      { Origin: ORIGIN },
    );
    expect(rejected.response.status).toBe(400);
    expectNoSession(rejected);
    expect((await prove(attempt)).response.status).toBe(200);
  });

  it.each([true, false])(
    "rejects changing a %s mobile cookie into the other ceremony purpose",
    async (mobile: boolean) => {
      const attempt: MobileAttempt = await beginAttempt(mobile);
      const cookie: string = `${COOKIE}=${mobile ? "" : "mobile."}${attempt.challengeId}`;
      const rejected: HttpResult = await prove(attempt, { cookie });
      expect(rejected.response.status).toBe(400);
      expectNoSession(rejected);
      expect((await prove(attempt)).response.status).toBe(400);
    },
  );

  it.each(["missing", "expired"])(
    "fails closed when bound mobile metadata is %s",
    async (failure: string) => {
      const attempt: MobileAttempt = await beginAttempt();
      const key: string = `mobile-passkey-challenge-${hash(attempt.challengeId)}`;
      if (failure === "expired") {
        await client.pexpireat(key, Date.now() - 1);
      } else {
        await client.del(key);
      }
      const rejected: HttpResult = await prove(attempt);
      expect(rejected.response.status).toBe(400);
      expectNoSession(rejected);
    },
  );

  it.each(["blocked", "deleted", "unverified"])(
    "checks an account that became %s after issuing the code",
    async (failure: string) => {
      const attempt: MobileAttempt & { code: string } = await issueCode();
      if (failure === "deleted") {
        jest.mocked(UserService.findOneById).mockResolvedValue(null);
      } else if (failure === "blocked") {
        user.isBlocked = true;
      } else {
        user.isEmailVerified = false;
      }
      const rejected: HttpResult = await exchange(attempt);
      expect(rejected.response.status).toBe(400);
      expectNoSession(rejected);
      user.isBlocked = false;
      user.isEmailVerified = true;
      jest.mocked(UserService.findOneById).mockResolvedValue(user);
      expect((await exchange(attempt)).response.status).toBe(400);
      expect(UserSessionService.createSession).not.toHaveBeenCalled();
    },
  );

  it.each(["signature", "origin", "challenge", "user-verification"])(
    "rejects an invalid real WebAuthn %s proof before creating any code",
    async (failure: string) => {
      const attempt: MobileAttempt = await beginAttempt();
      const assertion: AssertionOverrides =
        failure === "signature"
          ? {
              signingKey: generateKeyPairSync("ec", {
                namedCurve: "prime256v1",
              }).privateKey,
            }
          : failure === "origin"
            ? { origin: "https://other.example" }
            : failure === "challenge"
              ? { challenge: randomBytes(32).toString("base64url") }
              : { flags: 0x01 };
      const rejected: HttpResult = await prove(attempt, { assertion });
      expect(rejected.response.status).toBe(400);
      expectNoSession(rejected);
      expect(UserWebAuthnService.updateOneById).not.toHaveBeenCalled();
      expect((await prove(attempt)).response.status).toBe(400);
    },
  );

  it("rejects an expired code after a successful browser proof", async () => {
    const attempt: MobileAttempt & { code: string } = await issueCode();
    await client.pexpireat(
      `mobile-passkey-code-${hash(attempt.code)}`,
      Date.now() - 1,
    );
    const rejected: HttpResult = await exchange(attempt);
    expect(rejected.response.status).toBe(400);
    expectNoSession(rejected);
  });

  it("requires the native flat exchange body, not a data envelope", async () => {
    const attempt: MobileAttempt & { code: string } = await issueCode();
    const rejected: HttpResult = await post("mobile-passkey-exchange", {
      data: {
        code: attempt.code,
        codeVerifier: attempt.verifier,
        state: attempt.state,
      },
    });
    expect(rejected.response.status).toBe(400);
    expectNoSession(rejected);
    expect((await exchange(attempt)).response.status).toBe(200);
  });

  it("counts successful and failed route attempts in the actual Redis limiter", async () => {
    const attempt: MobileAttempt & { code: string } = await issueCode();
    jest.spyOn(IdentityRateLimit, "getBucketConfig").mockReturnValue({
      windowSeconds: 900,
      perAccountLimit: 3,
      perIpLimit: 3,
    });
    expect(
      (
        await exchange(attempt, {
          state: randomBytes(32).toString("base64url"),
        })
      ).response.status,
    ).toBe(400);
    const limited: HttpResult = await exchange(attempt);
    expect(limited.response.status).toBe(429);
    expect(Number(limited.response.headers.get("retry-after"))).toBeGreaterThan(
      0,
    );
    expectNoSession(limited);
    expect(IdentityRateLimit.getBucketConfig).toHaveBeenCalledWith(
      IdentityRateLimitBucket.Passkey,
    );
    // Raising the test budget proves the limited request did not consume code.
    jest.spyOn(IdentityRateLimit, "getBucketConfig").mockReturnValue({
      windowSeconds: 900,
      perAccountLimit: 300,
      perIpLimit: 300,
    });
    expect((await exchange(attempt)).response.status).toBe(200);
  });

  it("refuses all credential routes while Redis is unavailable", async () => {
    jest.mocked(Redis.isConnected).mockReturnValue(false);
    for (const route of [
      "passkey-login-options",
      "passkey-login",
      "mobile-passkey-exchange",
    ]) {
      const rejected: HttpResult = await post(route, {}, { Origin: ORIGIN });
      expect(rejected.response.status).toBe(503);
      expectNoSession(rejected);
    }
    expect(UserWebAuthnService.findOneBy).not.toHaveBeenCalled();
  });

  it("does not return a usable cookie when mobile metadata persistence fails", async () => {
    const originalSet: TestRedisClient["set"] = client.set.bind(client);
    jest.spyOn(client, "set").mockImplementation(((
      ...args: Parameters<TestRedisClient["set"]>
    ) => {
      if (String(args[0]).startsWith("mobile-passkey-challenge-")) {
        return Promise.reject(new Error("Injected metadata write failure"));
      }
      return originalSet(...args);
    }) as TestRedisClient["set"]);
    const result: HttpResult = await post(
      "passkey-login-options",
      {
        mobileAuth: {
          state: randomBytes(32).toString("base64url"),
          codeChallenge: hash("verifier"),
          codeChallengeMethod: "S256",
        },
      },
      { Origin: ORIGIN },
    );
    expect(result.response.status).toBe(500);
    expect(result.response.headers.get("set-cookie")).toBeNull();
    expectNoSession(result);
  });

  it("does not mint a session when writing the authorization code fails", async () => {
    const attempt: MobileAttempt = await beginAttempt();
    jest
      .spyOn(client, "set")
      .mockRejectedValueOnce(new Error("Injected code write failure"));
    const result: HttpResult = await prove(attempt);
    expect(result.response.status).toBe(500);
    expectNoSession(result);
    expect((await prove(attempt)).response.status).toBe(400);
  });

  it("fails closed if the code store cannot execute its atomic exchange", async () => {
    const attempt: MobileAttempt & { code: string } = await issueCode();
    jest
      .spyOn(client, "eval")
      .mockRejectedValueOnce(new Error("Injected exchange failure"));
    const result: HttpResult = await exchange(attempt);
    expect(result.response.status).toBe(500);
    expectNoCache(result);
    expectNoSession(result);
    expect((await exchange(attempt)).response.status).toBe(200);
  });

  it("allows only one HTTP exchange to create a session during a race", async () => {
    const attempt: MobileAttempt & { code: string } = await issueCode();
    const results: Array<HttpResult> = await Promise.all([
      exchange(attempt),
      exchange(attempt),
    ]);
    expect(
      results
        .map((result: HttpResult) => {
          return result.response.status;
        })
        .sort(),
    ).toEqual([200, 400]);
    expect(UserSessionService.createSession).toHaveBeenCalledTimes(1);
    expect(AccessTokenService.refreshUserAllPermissions).toHaveBeenCalledTimes(
      1,
    );
    for (const result of results) {
      expectNoCache(result);
      expect(result.response.headers.get("set-cookie")).toBeNull();
    }
  });
});
