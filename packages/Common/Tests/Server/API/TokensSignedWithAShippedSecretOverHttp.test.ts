jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import {
  OPERATOR_ENCRYPTION_SECRET,
  SHIPPED_ENCRYPTION_SECRETS,
  ShippedEncryptionSecret,
  restoreEncryptionSecret,
  setEncryptionSecret,
} from "../TestingUtils/ShippedEncryptionSecrets";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import jwt from "jsonwebtoken";
import { AddressInfo } from "net";

/*
 * The same refusal as Tests/Server/Middleware/TokensSignedWithAShippedSecret,
 * over HTTP, on the routes a stranger with such a token would go for.
 *
 * Each installation below is a real Express app - cookie-parser, the JSON
 * body parser, the real UserAPI router and the production error handler -
 * booted afresh with one ENCRYPTION_SECRET a self-hosted installation can be
 * running with, on an ephemeral port. Requests are real HTTP requests
 * carrying a session signed with the value the server is configured with
 * (as it reads it, and as an operator reading config.env would type it),
 * for a user id that exists nowhere, claiming to be a master admin.
 *
 * Only the data layer is stubbed, and it records what reached it:
 *
 *   - POST /api/user/:userId/set-password sets anybody's password: with such
 *     a session it is a 401, and no password is set;
 *   - GET /api/user/:userId/authentication-status reads how anybody signs
 *     in: a 401, and nothing is read;
 *   - POST /api/user/get-list, a CRUD route behind the user middleware every
 *     authenticated route mounts: a 401, and no query runs as a master admin;
 *
 * whether the session comes as the dashboard's cookie or as a bearer token,
 * whichever HMAC algorithm signed it, unsigned, and for an ordinary user as
 * much as for a master admin. In the same installation a session the server
 * signed itself still gets through, so the refusal is the signature's, not
 * the route's. And an installation whose operator set ENCRYPTION_SECRET still
 * takes the sessions it signed before the upgrade.
 */

const VICTIM_USER_ID: string = "7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e";
const FORGED_USER_ID: string = "deadbeef-dead-4eef-8ead-beefdeadbeef";
const SESSION_ID: string = "00000000-0000-4000-8000-000000000000";

type AnyClass = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

interface Installation {
  port: number;
  server: http.Server;
  encryptionSecret: string;
  JSONWebToken: AnyClass;
  ObjectID: AnyClass;
  Email: AnyClass;
  Name: AnyClass;
  userTokenCookie: string;
  // Every call that reached the data layer, by what it was.
  reached: Array<string>;
  listProps: Array<JSONObject>;
}

function masterAdminClaims(): Record<string, unknown> {
  return {
    userId: FORGED_USER_ID,
    email: "nobody@example.com",
    name: "Nobody",
    isMasterAdmin: true,
    isGlobalLogin: true,
    sessionId: SESSION_ID,
  };
}

/*
 * The keys a token could be signed with by somebody who knows only what the
 * repository ships: the value as the server read it, and trimmed.
 */
function publicKeysOf(installation: Installation): Array<string> {
  return Array.from(
    new Set([
      installation.encryptionSecret,
      installation.encryptionSecret.trim(),
    ]),
  ).filter((key: string) => {
    return key.length > 0;
  });
}

// A master admin's session with "alg": "none" and no signature at all.
function unsignedToken(): string {
  const nowInSeconds: number = Math.floor(Date.now() / 1000);
  const encode: (part: Record<string, unknown>) => string = (
    part: Record<string, unknown>,
  ): string => {
    return Buffer.from(JSON.stringify(part), "utf8").toString("base64url");
  };

  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    ...masterAdminClaims(),
    iat: nowInSeconds,
    exp: nowInSeconds + 15 * 60,
  })}.`;
}

function genuineMasterAdminToken(installation: Installation): string {
  return installation.JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: new installation.ObjectID(FORGED_USER_ID),
      email: new installation.Email("admin@example.com"),
      name: new installation.Name("Admin"),
      timezone: null,
      isMasterAdmin: true,
      isGlobalLogin: true,
      sessionId: new installation.ObjectID(SESSION_ID),
    },
    expiresInSeconds: 15 * 60,
  });
}

/*
 * A real Express app with the real UserAPI router, booted with this
 * ENCRYPTION_SECRET: every module loaded afresh, and only what the routes
 * read from or write to the datastores stubbed.
 */
async function boot(
  encryptionSecret: string | undefined,
): Promise<Installation> {
  setEncryptionSecret(encryptionSecret);
  jest.resetModules();

  const config: { EncryptionSecret: { toString: () => string } } = await import(
    "../../../Server/EnvironmentConfig"
  );
  const express: AnyClass = (await import("express")).default;
  const CookieParser: AnyClass = (await import("cookie-parser")).default;
  const UserAPI: AnyClass = (await import("../../../Server/API/UserAPI"))
    .default;
  const UserService: AnyClass = (
    await import("../../../Server/Services/UserService")
  ).default;
  const AccessTokenService: AnyClass = (
    await import("../../../Server/Services/AccessTokenService")
  ).default;
  const ProjectService: AnyClass = (
    await import("../../../Server/Services/ProjectService")
  ).default;
  const CookieUtil: AnyClass = (await import("../../../Server/Utils/Cookie"))
    .default;
  const { expressErrorHandler } = await import(
    "../../../Server/Utils/StartServer"
  );

  const reached: Array<string> = [];
  const listProps: Array<JSONObject> = [];

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
  jest.spyOn(UserService, "setPassword").mockImplementation((async (data: {
    userId: { toString: () => string };
  }): Promise<void> => {
    reached.push(`set-password ${data.userId.toString()}`);
  }) as never);
  jest
    .spyOn(UserService, "getAuthenticationStatus")
    .mockImplementation((async (userId: {
      toString: () => string;
    }): Promise<JSONObject> => {
      reached.push(`authentication-status ${userId.toString()}`);
      return {
        hasPassword: true,
        isEmailVerified: true,
        isTwoFactorAuthEnabled: false,
        verifiedTwoFactorAuthMethodCount: 0,
        unusedTwoFactorBackupCodeCount: 0,
        hasPendingPasswordResetLink: false,
      };
    }) as never);
  jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Array<unknown>> => {
    reached.push("user list");
    listProps.push(data.props);
    return [];
  }) as never);
  jest.spyOn(UserService, "countBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<unknown> => {
    reached.push("user count");
    listProps.push(data.props);
    return 0;
  }) as never);

  const app: AnyClass = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", new UserAPI().getRouter());
  app.use(expressErrorHandler);

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    server,
    encryptionSecret: config.EncryptionSecret.toString(),
    JSONWebToken: (await import("../../../Server/Utils/JsonWebToken")).default,
    ObjectID: (await import("../../../Types/ObjectID")).default,
    Email: (await import("../../../Types/Email")).default,
    Name: (await import("../../../Types/Name")).default,
    userTokenCookie: CookieUtil.getUserTokenKey(),
    reached,
    listProps,
  };
}

async function shutDown(installation: Installation | null): Promise<void> {
  restoreEncryptionSecret();
  jest.restoreAllMocks();
  jest.resetModules();

  if (!installation) {
    return;
  }

  await new Promise<void>((resolve: () => void) => {
    installation.server.close(() => {
      resolve();
    });
  });
}

type Carrier = "cookie" | "bearer";

const CARRIERS: Array<Carrier> = ["cookie", "bearer"];

function send(data: {
  installation: Installation;
  method: "GET" | "POST";
  path: string;
  token: string;
  carrier: Carrier;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        data.method === "POST" ? JSON.stringify(data.body || {}) : "";

      const headers: http.OutgoingHttpHeaders = {};

      if (data.carrier === "cookie") {
        headers["cookie"] =
          `${data.installation.userTokenCookie}=${data.token}`;
      } else {
        headers["authorization"] = `Bearer ${data.token}`;
      }

      if (data.method === "POST") {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(payload);
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.installation.port,
          path: data.path,
          method: data.method,
          headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = { raw };
            }

            resolve({ status: response.statusCode || 0, body });
          });
        },
      );

      request.on("error", reject);

      if (payload) {
        request.write(payload);
      }

      request.end();
    },
  );
}

interface Route {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: JSONObject | undefined;
  // What the data layer records when a request gets through.
  reaches: Array<string>;
}

const ROUTES: Array<Route> = [
  {
    name: "set a user's password",
    method: "POST",
    path: `/api/user/${VICTIM_USER_ID}/set-password`,
    body: { password: "Taken-0ver-Passw0rd!" },
    reaches: [`set-password ${VICTIM_USER_ID}`],
  },
  {
    name: "read how a user signs in",
    method: "GET",
    path: `/api/user/${VICTIM_USER_ID}/authentication-status`,
    reaches: [`authentication-status ${VICTIM_USER_ID}`],
  },
  {
    name: "list every user through the CRUD API",
    method: "POST",
    path: "/api/user/get-list",
    body: { query: {}, select: { email: true } },
    reaches: ["user list", "user count"],
  },
];

describe.each(SHIPPED_ENCRYPTION_SECRETS)(
  "over HTTP, an installation whose ENCRYPTION_SECRET is $label",
  ({ value }: ShippedEncryptionSecret) => {
    let installation: Installation | null = null;

    beforeAll(async () => {
      installation = await boot(value);
    });

    afterAll(async () => {
      await shutDown(installation);
      installation = null;
    });

    function started(): Installation {
      if (!installation) {
        throw new Error("The installation did not start");
      }

      return installation;
    }

    beforeEach(() => {
      started().reached.length = 0;
      started().listProps.length = 0;
    });

    describe.each(ROUTES)("$method $path ($name)", (route: Route) => {
      test.each(CARRIERS)(
        "a master admin's session signed with that value, sent as a %s, is a 401 and reaches nothing",
        async (carrier: Carrier) => {
          const server: Installation = started();

          for (const key of publicKeysOf(server)) {
            const forged: string = jwt.sign(masterAdminClaims(), key, {
              expiresIn: 15 * 60,
            });

            const result: HttpResult = await send({
              installation: server,
              method: route.method,
              path: route.path,
              token: forged,
              carrier,
              body: route.body,
            });

            expect({ key, status: result.status }).toEqual({
              key,
              status: 401,
            });
          }

          expect(server.reached).toEqual([]);
        },
      );

      test.each(CARRIERS)(
        "a master admin's session the server signed itself, sent as a %s, still gets through",
        async (carrier: Carrier) => {
          const server: Installation = started();

          const result: HttpResult = await send({
            installation: server,
            method: route.method,
            path: route.path,
            token: genuineMasterAdminToken(server),
            carrier,
            body: route.body,
          });

          expect(result.status).toBe(200);
          expect([...server.reached].sort()).toEqual([...route.reaches].sort());
        },
      );
    });

    test("the CRUD route runs a genuine master admin's query as a master admin, and nobody else's", async () => {
      const server: Installation = started();

      for (const key of publicKeysOf(server)) {
        await send({
          installation: server,
          method: "POST",
          path: "/api/user/get-list",
          token: jwt.sign(masterAdminClaims(), key, { expiresIn: 15 * 60 }),
          carrier: "bearer",
          body: { query: {}, select: { email: true } },
        });
      }

      expect(server.listProps).toEqual([]);

      await send({
        installation: server,
        method: "POST",
        path: "/api/user/get-list",
        token: genuineMasterAdminToken(server),
        carrier: "bearer",
        body: { query: {}, select: { email: true } },
      });

      expect(server.listProps.length).toBeGreaterThan(0);

      for (const props of server.listProps) {
        expect(props["isMasterAdmin"]).toBe(true);
      }
    });

    test("whichever HMAC algorithm signed such a session, and with no signature at all, it is a 401", async () => {
      const server: Installation = started();

      const forgedTokens: Array<{ how: string; token: string }> = [];

      for (const key of publicKeysOf(server)) {
        for (const algorithm of ["HS256", "HS384", "HS512"] as const) {
          forgedTokens.push({
            how: `${algorithm} with ${JSON.stringify(key)}`,
            token: jwt.sign(masterAdminClaims(), key, {
              algorithm,
              expiresIn: 15 * 60,
            }),
          });
        }
      }

      forgedTokens.push({ how: "unsigned", token: unsignedToken() });

      for (const { how, token } of forgedTokens) {
        const result: HttpResult = await send({
          installation: server,
          method: "POST",
          path: `/api/user/${VICTIM_USER_ID}/set-password`,
          token,
          carrier: "bearer",
          body: { password: "Taken-0ver-Passw0rd!" },
        });

        expect({ how, status: result.status }).toEqual({ how, status: 401 });
      }

      expect(server.reached).toEqual([]);
    });

    test("an ordinary user's session signed with that value is a 401 too, and the server's own still works", async () => {
      const server: Installation = started();

      const ordinaryClaims: Record<string, unknown> = {
        ...masterAdminClaims(),
        isMasterAdmin: false,
      };

      for (const key of publicKeysOf(server)) {
        const result: HttpResult = await send({
          installation: server,
          method: "POST",
          path: "/api/user/get-list",
          token: jwt.sign(ordinaryClaims, key, { expiresIn: 15 * 60 }),
          carrier: "cookie",
          body: { query: {}, select: { email: true } },
        });

        expect({ key, status: result.status }).toEqual({ key, status: 401 });
      }

      expect(server.reached).toEqual([]);

      const genuine: HttpResult = await send({
        installation: server,
        method: "POST",
        path: "/api/user/get-list",
        token: server.JSONWebToken.signJsonPayload(ordinaryClaims, 15 * 60),
        carrier: "cookie",
        body: { query: {}, select: { email: true } },
      });

      expect(genuine.status).toBe(200);
      expect(server.listProps.length).toBeGreaterThan(0);

      for (const props of server.listProps) {
        expect(props["isMasterAdmin"]).not.toBe(true);
        expect(String(props["userId"])).toBe(FORGED_USER_ID);
      }
    });
  },
);

describe("over HTTP, an installation whose operator set ENCRYPTION_SECRET", () => {
  let installation: Installation | null = null;

  beforeAll(async () => {
    installation = await boot(OPERATOR_ENCRYPTION_SECRET);
  });

  afterAll(async () => {
    await shutDown(installation);
    installation = null;
  });

  function started(): Installation {
    if (!installation) {
      throw new Error("The installation did not start");
    }

    return installation;
  }

  beforeEach(() => {
    started().reached.length = 0;
  });

  test.each(CARRIERS)(
    "still takes a master admin's session an earlier release signed with that secret, sent as a %s",
    async (carrier: Carrier) => {
      const server: Installation = started();

      // What the release before this change signed every session with.
      const issuedBeforeTheUpgrade: string = jwt.sign(
        masterAdminClaims(),
        OPERATOR_ENCRYPTION_SECRET,
        { expiresIn: 15 * 60 },
      );

      const result: HttpResult = await send({
        installation: server,
        method: "GET",
        path: `/api/user/${VICTIM_USER_ID}/authentication-status`,
        token: issuedBeforeTheUpgrade,
        carrier,
      });

      expect(result.status).toBe(200);
      expect(server.reached).toEqual([
        `authentication-status ${VICTIM_USER_ID}`,
      ]);
    },
  );

  test("refuses one signed with any value the repository ships", async () => {
    const server: Installation = started();

    const shippedValues: Dictionary<string> = {};

    for (const shipped of SHIPPED_ENCRYPTION_SECRETS) {
      if (shipped.value && shipped.value.trim()) {
        shippedValues[shipped.value.trim()] = shipped.label;
      }
    }

    shippedValues["secret"] = "the code's fallback";

    for (const key of Object.keys(shippedValues)) {
      const result: HttpResult = await send({
        installation: server,
        method: "POST",
        path: `/api/user/${VICTIM_USER_ID}/set-password`,
        token: jwt.sign(masterAdminClaims(), key, { expiresIn: 15 * 60 }),
        carrier: "bearer",
        body: { password: "Taken-0ver-Passw0rd!" },
      });

      expect({ key, status: result.status }).toEqual({ key, status: 401 });
    }

    expect(server.reached).toEqual([]);
  });
});
