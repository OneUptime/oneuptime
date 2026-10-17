import {
  OPERATOR_ENCRYPTION_SECRET,
  SHIPPED_ENCRYPTION_SECRETS,
  ShippedEncryptionSecret,
  restoreEncryptionSecret,
  setEncryptionSecret,
} from "../TestingUtils/ShippedEncryptionSecrets";
import Exception from "../../../Types/Exception/Exception";
import JsonWebTokenPurpose from "../../../Types/JsonWebTokenPurpose";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import type { Mock } from "jest-mock";
import jwt from "jsonwebtoken";

/*
 * A token signed with a value this repository ships is nobody's session.
 *
 * Until this change an installation whose ENCRYPTION_SECRET was unset, or
 * still one of the placeholders the repository ships ("secret", or the
 * "please-change-this-to-random-value" config.example.env sets), signed every
 * token with that value - and the README's Docker Compose install runs with
 * exactly that unless the operator edits config.env. The value is public, so
 * a token anybody signed with it was taken for whoever it named, a master
 * admin included, by a user id that need not even exist.
 *
 * Each configuration below is a fresh module registry, so EnvironmentConfig
 * reads that ENCRYPTION_SECRET, and the real middleware runs on a request
 * carrying a token signed with the value the server is configured with (as
 * it reads it). Only the datastore lookups behind them are stubbed: nobody is
 * blocked, and nobody has any project. For every entry point:
 *
 *   - the master-admin gates (session, and session-or-master-API-key);
 *   - the user middleware every authenticated route mounts, the public-route
 *     variant, and readRequestSession that the realtime server shares;
 *   - the project SSO and global SSO tokens;
 *   - the bearer-token middleware and a phone call's keypad callback;
 *   - a status page private user's session;
 *   - the MCP delegation token and the MCP authorization-request token.
 *
 * Each has a control in the same configuration: the token the server signs
 * itself still works. And an installation whose operator set ENCRYPTION_SECRET
 * keeps accepting what it signs with it, and the SSO sign-ins it gave before
 * the upgrade; an access token from before tokens said what they were for is
 * renewed by the client, as one that expired.
 *
 * Every forged token says what it is for (JsonWebTokenPurpose), as the
 * server's own do, so the signature is the only thing wrong with it.
 */

jest.mock("../../../Server/Utils/Logger");

const USER_ID: string = "deadbeef-dead-4eef-8ead-beefdeadbeef";
const PROJECT_ID: string = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";
const STATUS_PAGE_ID: string = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";
const SSO_PROVIDER_ID: string = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";

const INVALID_ACCESS_TOKEN_MESSAGE: string =
  "AccessToken is invalid or expired. Please refresh your token.";

type AnyClass = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Server {
  encryptionSecret: string;
  TokenSigningKey: AnyClass;
  JSONWebToken: AnyClass;
  MasterAdminAuthorization: AnyClass;
  UserMiddleware: AnyClass;
  BearerTokenAuthorization: AnyClass;
  NotificationMiddleware: AnyClass;
  CookieUtil: AnyClass;
  McpDelegationToken: AnyClass;
  McpOAuthSignedToken: AnyClass;
  ObjectID: AnyClass;
  Email: AnyClass;
  Name: AnyClass;
  UserType: Record<string, string>;
  SsoProviderType: Record<string, string>;
  sentErrors: Array<Exception>;
}

/*
 * The server as it boots with this ENCRYPTION_SECRET: every module loaded
 * afresh, and only what the middleware reads from the datastores stubbed.
 */
async function serverWith(
  encryptionSecret: string | undefined,
): Promise<Server> {
  setEncryptionSecret(encryptionSecret);
  jest.resetModules();

  const config: { EncryptionSecret: { toString: () => string } } = await import(
    "../../../Server/EnvironmentConfig"
  );
  const UserService: AnyClass = (
    await import("../../../Server/Services/UserService")
  ).default;
  const AccessTokenService: AnyClass = (
    await import("../../../Server/Services/AccessTokenService")
  ).default;
  const ProjectService: AnyClass = (
    await import("../../../Server/Services/ProjectService")
  ).default;
  const Response: AnyClass = (await import("../../../Server/Utils/Response"))
    .default;

  const sentErrors: Array<Exception> = [];

  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false as never);
  jest
    .spyOn(UserService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockResolvedValue({
      _type: "UserGlobalAccessPermission",
      projectIds: [],
      globalPermissions: [],
    } as never);
  jest.spyOn(Response, "sendErrorResponse").mockImplementation(((
    _req: unknown,
    _res: unknown,
    error: Exception,
  ): void => {
    sentErrors.push(error);
  }) as never);
  jest.spyOn(Response, "sendXmlResponse").mockResolvedValue(undefined as never);

  return {
    encryptionSecret: config.EncryptionSecret.toString(),
    TokenSigningKey: (await import("../../../Server/Utils/TokenSigningKey"))
      .default,
    JSONWebToken: (await import("../../../Server/Utils/JsonWebToken")).default,
    MasterAdminAuthorization: (
      await import("../../../Server/Middleware/MasterAdminAuthorization")
    ).default,
    UserMiddleware: (
      await import("../../../Server/Middleware/UserAuthorization")
    ).default,
    BearerTokenAuthorization: (
      await import("../../../Server/Middleware/BearerTokenAuthorization")
    ).default,
    NotificationMiddleware: (
      await import("../../../Server/Middleware/NotificationMiddleware")
    ).default,
    CookieUtil: (await import("../../../Server/Utils/Cookie")).default,
    McpDelegationToken: (
      await import("../../../Server/Utils/Mcp/McpDelegationToken")
    ).default,
    McpOAuthSignedToken: (
      await import("../../../Server/Utils/Mcp/McpOAuthSignedToken")
    ).default,
    ObjectID: (await import("../../../Types/ObjectID")).default,
    Email: (await import("../../../Types/Email")).default,
    Name: (await import("../../../Types/Name")).default,
    UserType: (await import("../../../Types/UserType")).default as never,
    SsoProviderType: (await import("../../../Types/SSO/SsoProviderType"))
      .default as never,
    sentErrors,
  };
}

/*
 * The keys a token could be signed with by somebody who knows only what the
 * repository ships: the value as the server read it, and as an operator
 * reading config.env would type it.
 */
function publicKeysOf(server: Server): Array<string> {
  return Array.from(
    new Set([server.encryptionSecret, server.encryptionSecret.trim()]),
  ).filter((key: string) => {
    return key.length > 0;
  });
}

function masterAdminClaims(): Record<string, unknown> {
  return {
    ...masterAdminClaimsBeforeTheUpgrade(),
    purpose: JsonWebTokenPurpose.UserSession,
  };
}

// A master admin's access token as the releases before tokens said what they were for signed it.
function masterAdminClaimsBeforeTheUpgrade(): Record<string, unknown> {
  return {
    userId: USER_ID,
    email: "nobody@example.com",
    name: "Nobody",
    isMasterAdmin: true,
    isGlobalLogin: true,
    sessionId: "00000000-0000-4000-8000-000000000000",
  };
}

function signWith(key: string, claims: Record<string, unknown>): string {
  return jwt.sign(claims, key, { expiresIn: 15 * 60 });
}

function genuineMasterAdminToken(server: Server): string {
  return server.JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: new server.ObjectID(USER_ID),
      email: new server.Email("admin@example.com"),
      name: new server.Name("Admin"),
      timezone: null,
      isMasterAdmin: true,
      isGlobalLogin: true,
      sessionId: new server.ObjectID("00000000-0000-4000-8000-000000000000"),
    },
    expiresInSeconds: 15 * 60,
  });
}

type Request = Record<string, unknown> & {
  userType?: string;
  userAuthorization?: { isMasterAdmin?: boolean };
};

function bearerRequest(token: string): Request {
  return {
    params: {},
    query: {},
    body: {},
    cookies: {},
    headers: { authorization: `Bearer ${token}`, tenantid: "" },
  };
}

function cookieRequest(cookies: Record<string, string>): Request {
  return {
    params: {},
    query: {},
    body: {},
    cookies: cookies,
    headers: { tenantid: "" },
  };
}

type NextFunction = (error?: unknown) => void;

interface MiddlewareRun {
  nextCalls: Array<Array<unknown>>;
  sentErrors: Array<Exception>;
}

async function run(
  server: Server,
  middleware: (req: Request, res: unknown, next: unknown) => Promise<void>,
  req: Request,
): Promise<MiddlewareRun> {
  server.sentErrors.length = 0;
  const next: Mock<NextFunction> = jest.fn<NextFunction>();

  await middleware(req, { set: jest.fn() }, next);

  return {
    nextCalls: next.mock.calls as Array<Array<unknown>>,
    sentErrors: [...server.sentErrors],
  };
}

function expectRefusedAsSignedOut(result: MiddlewareRun): void {
  expect(result.nextCalls).toEqual([]);
  expect(result.sentErrors).toHaveLength(1);
  expect(result.sentErrors[0]?.code).toBe(401);
}

function expectPassed(result: MiddlewareRun): void {
  expect(result.sentErrors).toEqual([]);
  expect(result.nextCalls).toEqual([[]]);
}

// An MCP signed token, made the way McpOAuthSignedToken makes one, under `key`.
function signMcpToken(data: {
  key: string;
  label: string;
  claims: Record<string, unknown>;
}): string {
  const now: number = Date.now();
  const payloadB64: string = Buffer.from(
    JSON.stringify({ v: 1, c: data.claims, i: now, x: now + 60 * 1000 }),
    "utf8",
  ).toString("base64url");
  const derivedKey: Buffer = crypto
    .createHmac("sha256", data.key)
    .update(data.label)
    .digest();
  const signature: string = crypto
    .createHmac("sha256", derivedKey)
    .update(`v1.${payloadB64}`)
    .digest("base64url");

  return `v1.${payloadB64}.${signature}`;
}

const DELEGATION_LABEL: string = "oneuptime:mcp:oauth:api-delegation-token:v1";
const AUTHORIZATION_REQUEST_LABEL: string =
  "oneuptime:mcp:oauth:authorization-request:v1";

function delegationClaims(): Record<string, unknown> {
  return {
    u: USER_ID,
    e: "nobody@example.com",
    n: "Nobody",
    p: PROJECT_ID,
    g: "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
    ci: "client",
    cn: "Client",
    w: true,
  };
}

/*
 * One server per configuration, shared by its tests: loading every module
 * afresh is what costs the time, and nothing a test does changes the server.
 */
function useServer(encryptionSecret: string | undefined): () => Server {
  let server: Server | null = null;

  beforeAll(async () => {
    server = await serverWith(encryptionSecret);
  });

  afterAll(() => {
    restoreEncryptionSecret();
    jest.restoreAllMocks();
    jest.resetModules();
  });

  return (): Server => {
    if (!server) {
      throw new Error("The server did not start");
    }

    return server;
  };
}

describe.each(SHIPPED_ENCRYPTION_SECRETS)(
  "an installation whose ENCRYPTION_SECRET is $label",
  ({ value }: ShippedEncryptionSecret) => {
    const startedServer: () => Server = useServer(value);

    test("the master-admin gate refuses a master-admin session signed with that value, as a cookie or a bearer token", async () => {
      const server: Server = startedServer();

      for (const key of publicKeysOf(server)) {
        const forged: string = signWith(key, masterAdminClaims());

        for (const req of [
          bearerRequest(forged),
          cookieRequest({ [server.CookieUtil.getUserTokenKey()]: forged }),
        ]) {
          expectRefusedAsSignedOut(
            await run(
              server,
              server.MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
              req,
            ),
          );
          expectRefusedAsSignedOut(
            await run(
              server,
              server.MasterAdminAuthorization
                .isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
              req,
            ),
          );
        }
      }
    });

    test("the master-admin gate still lets a master admin it signed in through", async () => {
      const server: Server = startedServer();

      expectPassed(
        await run(
          server,
          server.MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
          bearerRequest(genuineMasterAdminToken(server)),
        ),
      );
    });

    test("an authenticated route refuses that session, and never takes the caller for a master admin", async () => {
      const server: Server = startedServer();

      for (const key of publicKeysOf(server)) {
        const req: Request = bearerRequest(signWith(key, masterAdminClaims()));
        const result: MiddlewareRun = await run(
          server,
          server.UserMiddleware.getUserMiddleware,
          req,
        );

        expectRefusedAsSignedOut(result);
        expect(result.sentErrors[0]?.message).toBe(
          INVALID_ACCESS_TOKEN_MESSAGE,
        );
        expect(req.userType).not.toBe(server.UserType["MasterAdmin"]);
        expect(req.userAuthorization).toBeUndefined();
      }
    });

    test("an authenticated route still takes a master admin it signed in for one", async () => {
      const server: Server = startedServer();
      const req: Request = bearerRequest(genuineMasterAdminToken(server));

      expectPassed(
        await run(server, server.UserMiddleware.getUserMiddleware, req),
      );
      expect(req.userType).toBe(server.UserType["MasterAdmin"]);
    });

    test("a public route serves that session as nobody at all", async () => {
      const server: Server = startedServer();

      for (const key of publicKeysOf(server)) {
        const req: Request = bearerRequest(signWith(key, masterAdminClaims()));

        expectPassed(
          await run(
            server,
            server.UserMiddleware.getPublicRouteUserMiddleware,
            req,
          ),
        );
        expect(req.userType).toBe(server.UserType["Public"]);
        expect(req.userAuthorization).toBeUndefined();
      }
    });

    test("the session the realtime server reads is no session", async () => {
      const server: Server = startedServer();

      for (const key of publicKeysOf(server)) {
        const session: { kind: string } =
          await server.UserMiddleware.readRequestSession(
            bearerRequest(signWith(key, masterAdminClaims())),
          );

        expect(session.kind).toBe("invalid");
      }

      const genuine: { kind: string } =
        await server.UserMiddleware.readRequestSession(
          bearerRequest(genuineMasterAdminToken(server)),
        );

      expect(genuine.kind).toBe("user");
    });

    test("a project SSO token or a global SSO token signed with that value proves no SSO sign-in", async () => {
      const server: Server = startedServer();
      const projectId: AnyClass = new server.ObjectID(PROJECT_ID);
      const userId: AnyClass = new server.ObjectID(USER_ID);

      for (const key of publicKeysOf(server)) {
        // As this release signs them, and as the releases before it did.
        for (const purpose of [JsonWebTokenPurpose.SsoSignIn, undefined]) {
          const projectToken: string = signWith(key, {
            userId: USER_ID,
            projectId: PROJECT_ID,
            email: "nobody@example.com",
            name: "Nobody",
            isMasterAdmin: false,
            ssoProviderId: SSO_PROVIDER_ID,
            ssoProviderType: server.SsoProviderType["ProjectSSO"],
            ...(purpose ? { purpose } : {}),
          });
          const globalToken: string = signWith(key, {
            userId: USER_ID,
            email: "nobody@example.com",
            name: "Nobody",
            isMasterAdmin: false,
            ssoProviderId: SSO_PROVIDER_ID,
            ssoProviderType: server.SsoProviderType["GlobalSSO"],
            ...(purpose ? { purpose } : {}),
          });

          expect(
            server.UserMiddleware.getStatelessValidProjectScopedSsoSignIn(
              cookieRequest({
                [server.CookieUtil.getUserSSOKey(projectId)]: projectToken,
              }),
              projectId,
              userId,
            ),
          ).toBeNull();
          expect(
            server.UserMiddleware.getGlobalSsoTokenData(
              cookieRequest({
                [server.CookieUtil.getGlobalSSOKey()]: globalToken,
              }),
            ),
          ).toBeNull();
        }
      }

      // The tokens the server signs itself still prove one.
      const user: AnyClass = {
        id: userId,
        name: new server.Name("Nobody"),
        email: new server.Email("nobody@example.com"),
      };

      expect(
        server.UserMiddleware.getStatelessValidProjectScopedSsoSignIn(
          cookieRequest({
            [server.CookieUtil.getUserSSOKey(projectId)]:
              server.CookieUtil.getSSOToken({
                user,
                projectId,
                ssoProviderId: new server.ObjectID(SSO_PROVIDER_ID),
                ssoProviderType: server.SsoProviderType["ProjectSSO"],
              }),
          }),
          projectId,
          userId,
        ),
      ).not.toBeNull();
      expect(
        server.UserMiddleware.getGlobalSsoTokenData(
          cookieRequest({
            [server.CookieUtil.getGlobalSSOKey()]:
              server.CookieUtil.getGlobalSSOToken({
                user,
                ssoProviderId: new server.ObjectID(SSO_PROVIDER_ID),
                ssoProviderType: server.SsoProviderType["GlobalSSO"],
              }),
          }),
        ),
      ).not.toBeNull();
    });

    test("the bearer-token middleware refuses a token signed with that value", async () => {
      const server: Server = startedServer();

      for (const key of publicKeysOf(server)) {
        const result: MiddlewareRun = await run(
          server,
          server.BearerTokenAuthorization.isAuthorizedBearerToken,
          bearerRequest(signWith(key, { anything: "at all" })),
        );

        expect(result.nextCalls).toHaveLength(1);
        expect(result.nextCalls[0]?.[0]).toBeInstanceOf(Error);
      }

      const genuine: MiddlewareRun = await run(
        server,
        server.BearerTokenAuthorization.isAuthorizedBearerToken,
        bearerRequest(
          server.JSONWebToken.signJsonPayload({ anything: "at all" }, 60),
        ),
      );

      expect(genuine.nextCalls).toEqual([[]]);
    });

    test("a phone call's keypad callback refuses a token signed with that value", async () => {
      const server: Server = startedServer();

      for (const key of publicKeysOf(server)) {
        const req: Request = {
          params: {},
          query: { token: signWith(key, { "1": { sayMessage: "x" } }) },
          body: { Digits: "1" },
          cookies: {},
          headers: {},
        };
        const result: MiddlewareRun = await run(
          server,
          server.NotificationMiddleware.isValidCallNotificationRequest,
          req,
        );

        expect(result.nextCalls).toEqual([]);
        expect(result.sentErrors[0]?.message).toBe("Invalid token");
      }

      const genuine: MiddlewareRun = await run(
        server,
        server.NotificationMiddleware.isValidCallNotificationRequest,
        {
          params: {},
          query: {
            token: server.JSONWebToken.signJsonPayload(
              { "1": { sayMessage: "x" } },
              60,
            ),
          },
          body: { Digits: "1" },
          cookies: {},
          headers: {},
        },
      );

      expect(genuine.nextCalls).toEqual([[]]);
    });

    test("a status page private user's session signed with that value does not decode", async () => {
      const server: Server = startedServer();
      const claims: Record<string, unknown> = {
        userId: USER_ID,
        email: "viewer@example.com",
        statusPageId: STATUS_PAGE_ID,
        sessionId: "00000000-0000-4000-8000-000000000000",
        purpose: JsonWebTokenPurpose.StatusPageSession,
      };

      for (const key of publicKeysOf(server)) {
        expect(() => {
          return server.JSONWebToken.decode(
            signWith(key, claims),
            JsonWebTokenPurpose.StatusPageSession,
          );
        }).toThrow("AccessToken is invalid or expired");
      }

      expect(
        server.JSONWebToken.decode(
          server.JSONWebToken.signJsonPayload(claims, 60),
          JsonWebTokenPurpose.StatusPageSession,
        ).statusPageId.toString(),
      ).toBe(STATUS_PAGE_ID);
    });

    test("an MCP delegation or authorization-request token signed under that value is refused", async () => {
      const server: Server = startedServer();

      for (const key of publicKeysOf(server)) {
        expect(
          server.McpDelegationToken.verify(
            signMcpToken({
              key,
              label: DELEGATION_LABEL,
              claims: delegationClaims(),
            }),
          ),
        ).toBeNull();
        expect(
          server.McpOAuthSignedToken.verify({
            purpose: {
              keyDerivationLabel: AUTHORIZATION_REQUEST_LABEL,
              maxLength: 6000,
            },
            token: signMcpToken({
              key,
              label: AUTHORIZATION_REQUEST_LABEL,
              claims: { note: "hello" },
            }),
          }),
        ).toBeNull();
      }

      // The control: the same token, signed under the key the server uses.
      expect(
        server.McpDelegationToken.verify(
          signMcpToken({
            key: server.TokenSigningKey.get(),
            label: DELEGATION_LABEL,
            claims: delegationClaims(),
          }),
        ),
      ).not.toBeNull();
    });
  },
);

describe("an installation whose operator set ENCRYPTION_SECRET", () => {
  const startedServer: () => Server = useServer(OPERATOR_ENCRYPTION_SECRET);

  test("keeps accepting the sessions it signs with that secret, so nobody is signed out", async () => {
    const server: Server = startedServer();
    const req: Request = bearerRequest(
      signWith(OPERATOR_ENCRYPTION_SECRET, masterAdminClaims()),
    );

    expectPassed(
      await run(server, server.UserMiddleware.getUserMiddleware, req),
    );
    expect(req.userType).toBe(server.UserType["MasterAdmin"]);
    expectPassed(
      await run(
        server,
        server.MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
        bearerRequest(
          signWith(OPERATOR_ENCRYPTION_SECRET, masterAdminClaims()),
        ),
      ),
    );
  });

  /*
   * An access token from before tokens said what they were for lived fifteen
   * minutes. It is answered 401, as one that expired, and the client renews
   * it with its refresh token, which the upgrade does not touch.
   */
  test("answers an access token it signed before the upgrade 401, so the client renews it", async () => {
    const server: Server = startedServer();
    const req: Request = bearerRequest(
      signWith(OPERATOR_ENCRYPTION_SECRET, masterAdminClaimsBeforeTheUpgrade()),
    );
    const result: MiddlewareRun = await run(
      server,
      server.UserMiddleware.getUserMiddleware,
      req,
    );

    expectRefusedAsSignedOut(result);
    expect(result.sentErrors[0]?.message).toBe(INVALID_ACCESS_TOKEN_MESSAGE);
    expect(req.userAuthorization).toBeUndefined();
  });

  test("keeps accepting the SSO sign-ins it gave before the upgrade, as SSO sign-ins", async () => {
    const server: Server = startedServer();
    const projectId: AnyClass = new server.ObjectID(PROJECT_ID);
    const userId: AnyClass = new server.ObjectID(USER_ID);

    const projectToken: string = signWith(OPERATOR_ENCRYPTION_SECRET, {
      userId: USER_ID,
      projectId: PROJECT_ID,
      email: "nobody@example.com",
      name: "Nobody",
      isMasterAdmin: false,
      isGeneralLogin: false,
      ssoProviderId: SSO_PROVIDER_ID,
      ssoProviderType: server.SsoProviderType["ProjectSSO"],
    });
    const globalToken: string = signWith(OPERATOR_ENCRYPTION_SECRET, {
      userId: USER_ID,
      projectId: "",
      email: "nobody@example.com",
      name: "Nobody",
      isMasterAdmin: false,
      isGeneralLogin: false,
      ssoProviderId: SSO_PROVIDER_ID,
      ssoProviderType: server.SsoProviderType["GlobalSSO"],
    });

    expect(
      server.UserMiddleware.getStatelessValidProjectScopedSsoSignIn(
        cookieRequest({
          [server.CookieUtil.getUserSSOKey(projectId)]: projectToken,
        }),
        projectId,
        userId,
      ),
    ).not.toBeNull();
    expect(
      server.UserMiddleware.getGlobalSsoTokenData(
        cookieRequest({ [server.CookieUtil.getGlobalSSOKey()]: globalToken }),
      ),
    ).not.toBeNull();

    // ...and as nothing more: neither is a session.
    for (const token of [projectToken, globalToken]) {
      expectRefusedAsSignedOut(
        await run(
          server,
          server.UserMiddleware.getUserMiddleware,
          bearerRequest(token),
        ),
      );
    }
  });

  test("keeps accepting the MCP tokens it signed before the upgrade", async () => {
    const server: Server = startedServer();

    expect(
      server.McpDelegationToken.verify(
        signMcpToken({
          key: OPERATOR_ENCRYPTION_SECRET,
          label: DELEGATION_LABEL,
          claims: delegationClaims(),
        }),
      ),
    ).not.toBeNull();
  });

  test("refuses a session signed with any value this repository ships", async () => {
    const server: Server = startedServer();

    for (const shipped of ["secret", "please-change-this-to-random-value"]) {
      expectRefusedAsSignedOut(
        await run(
          server,
          server.MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
          bearerRequest(signWith(shipped, masterAdminClaims())),
        ),
      );
    }
  });
});
