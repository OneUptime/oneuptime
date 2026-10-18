import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import User from "../../../Models/DatabaseModels/User";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * A SESSION THAT STARTED ON HTTPS NEVER TRAVELS OVER PLAIN HTTP.
 *
 * A cookie without the Secure attribute goes with every request to its host,
 * plain HTTP included (RFC 6265, section 5.4). OneUptime used to set none:
 * after an HTTPS sign-in, one http:// request to the same host - a typed
 * address, an old link, or a navigation someone on the network slips into
 * any plain-HTTP page the person visits (SameSite=Lax does not stop a
 * top-level navigation) - carried the access token, the refresh token, the
 * SSO tokens and a private status page's session in clear text, before any
 * redirect to HTTPS could answer. A real browser does exactly that; the
 * reproduction in the pull request shows Chromium, Firefox and WebKit doing
 * it against this code.
 *
 * Now every cookie is Secure whenever the browser is on HTTPS, by one rule
 * (RequestTransport.isHttps):
 *
 *   - the ingress forwarded the visitor's scheme as https (TLS ended at
 *     OneUptime's ingress, or at a proxy in front of it that said so); or
 *   - HTTP_PROTOCOL=https and the request is for the installation's own
 *     address, HOST.
 *
 * And a plain-HTTP installation signs people in as before: over plain HTTP
 * a browser drops a Secure cookie, so none is set there.
 *
 * Each case is a real HTTP request to a real Express app, with `trust proxy`
 * set the way StartServer sets it (TRUSTED_PROXY_HOPS, one by default) and
 * the real CookieUtil writing the cookies of every sign-in OneUptime has:
 * the dashboard's session (password, SSO, Global SSO), a private status
 * page's session and password, a dashboard's password, and the short-lived
 * cookies of a sign-in in progress. What the browser would then send over
 * plain HTTP is worked out from the Set-Cookie headers by the RFC 6265 rule.
 */

/*
 * A real Express app: an error that walks the routes registered after the
 * one that threw is deferred with setImmediate, which Common's jsdom
 * environment does not expose. Lend it Node's.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

type CookieEnv = {
  httpProtocol: string;
  host: string;
};

type CookieEnvGlobal = typeof globalThis & {
  __cookiesStayOnHttpsEnv: CookieEnv;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const envGlobal: CookieEnvGlobal = globalThis as CookieEnvGlobal;

  envGlobal.__cookiesStayOnHttpsEnv = {
    httpProtocol: "http://",
    host: "oneuptime.example.com",
  };

  for (const [name, key] of [
    ["HttpProtocol", "httpProtocol"],
    ["Host", "host"],
  ] as Array<[string, keyof CookieEnv]>) {
    Object.defineProperty(mocked, name, {
      configurable: true,
      enumerable: true,
      get: (): unknown => {
        return envGlobal.__cookiesStayOnHttpsEnv[key];
      },
    });
  }

  return mocked;
});

function setEnv(overrides: Partial<CookieEnv>): void {
  const envGlobal: CookieEnvGlobal = globalThis as CookieEnvGlobal;

  envGlobal.__cookiesStayOnHttpsEnv = {
    ...envGlobal.__cookiesStayOnHttpsEnv,
    ...overrides,
  };
}

const INSTALLATION_HOST: string = "oneuptime.example.com";
const STATUS_PAGE_DOMAIN: string = "status.customer.com";
const DASHBOARD_DOMAIN: string = "dashboard.customer.com";

const USER_ID: ObjectID = new ObjectID("7a000000-0000-4000-8000-0000000000a1");
const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-0000000000a2",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-0000000000a3",
);
const DASHBOARD_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-0000000000a4",
);
const PRIVATE_USER_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-0000000000a5",
);
const SSO_PROVIDER_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-0000000000a6",
);

const REFRESH_TOKEN: string = "refresh-token-of-the-dashboard-session";
const STATUS_PAGE_REFRESH_TOKEN: string = "refresh-token-of-the-status-page";

// The cookies a dashboard sign-in leaves, by name.
const DASHBOARD_SESSION_COOKIES: Array<string> = [
  "user-token",
  "user-refresh-token",
  "user-id",
  "user-email",
  "user-name",
  "user-timezone",
  "user-is-master-admin",
  `sso-${PROJECT_ID.toString()}`,
  "global-sso-token",
];

const STATUS_PAGE_SESSION_COOKIES: Array<string> = [
  `user-token-${STATUS_PAGE_ID.toString()}`,
  `user-refresh-token-${STATUS_PAGE_ID.toString()}`,
  `status-page-master-password-${STATUS_PAGE_ID.toString()}`,
];

const DASHBOARD_PASSWORD_COOKIE: string = `dashboard-master-password-${DASHBOARD_ID.toString()}`;

// A cookie of a sign-in in progress, set on the path that reads it.
const STATE_COOKIE: string = "oneuptime-sign-in-state";
const STATE_COOKIE_PATH: string = "/identity/state-callback";

function person(isMasterAdmin: boolean): User {
  const user: User = new User();
  user.id = USER_ID;
  user.email = new Email("person@example.com");
  user.name = new Name("A Person");
  user.timezone = "Europe/Oslo" as never;
  user.isMasterAdmin = isMasterAdmin;
  return user;
}

let server: http.Server;
let port: number = 0;
const app: express.Express = express();

beforeAll(async () => {
  app.set("trust proxy", 1);
  app.use(CookieParser());

  app.post("/identity/login", (_req: ExpressRequest, res: ExpressResponse) => {
    CookieUtil.setUserCookie({
      expressResponse: res,
      user: person(true),
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
      refreshToken: REFRESH_TOKEN,
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    CookieUtil.setSSOCookie({
      user: person(true),
      projectId: PROJECT_ID,
      expressResponse: res,
    });

    CookieUtil.setGlobalSSOCookie({
      user: person(true),
      expressResponse: res,
      ssoProviderId: SSO_PROVIDER_ID,
      ssoProviderType: SsoProviderType.GlobalSSO,
    });

    res.status(200).send("signed in");
  });

  app.post(
    "/status-page-identity-api/login",
    (_req: ExpressRequest, res: ExpressResponse) => {
      const viewer: StatusPagePrivateUser = new StatusPagePrivateUser();
      viewer.id = PRIVATE_USER_ID;
      viewer.email = new Email("viewer@customer.com");

      CookieUtil.setStatusPagePrivateUserCookie({
        expressResponse: res,
        user: viewer,
        statusPageId: STATUS_PAGE_ID,
        sessionId: ObjectID.generate(),
        refreshToken: STATUS_PAGE_REFRESH_TOKEN,
        refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      CookieUtil.setStatusPageMasterPasswordCookie({
        expressResponse: res,
        statusPageId: STATUS_PAGE_ID,
      });

      res.status(200).send("signed in");
    },
  );

  app.post(
    "/public-dashboard-api/unlock",
    (_req: ExpressRequest, res: ExpressResponse) => {
      CookieUtil.setDashboardMasterPasswordCookie({
        expressResponse: res,
        dashboardId: DASHBOARD_ID,
      });

      res.status(200).send("unlocked");
    },
  );

  // A caller that asks for a cookie that is not Secure.
  app.get(
    "/identity/state-start",
    (_req: ExpressRequest, res: ExpressResponse) => {
      CookieUtil.setCookie(res, STATE_COOKIE, "state-and-nonce", {
        path: STATE_COOKIE_PATH,
        maxAge: 10 * 60 * 1000,
        httpOnly: true,
        secure: false,
      });

      res.status(200).send("started");
    },
  );

  app.post("/identity/logout", (req: ExpressRequest, res: ExpressResponse) => {
    CookieUtil.removeAllCookies(req, res);
    CookieUtil.removeCookie(res, STATE_COOKIE, { path: STATE_COOKIE_PATH });
    res.status(200).send("signed out");
  });

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  app.set("trust proxy", 1);
  setEnv({ httpProtocol: "http://", host: INSTALLATION_HOST });
});

interface SetCookie {
  name: string;
  value: string;
  // Attribute names in lower case, with their values ("" for flags).
  attributes: Record<string, string>;
}

function parseSetCookie(line: string): SetCookie {
  const [pair, ...attributeParts] = line.split(";");
  const separator: number = (pair || "").indexOf("=");
  const attributes: Record<string, string> = {};

  for (const part of attributeParts) {
    const trimmed: string = part.trim();
    const equals: number = trimmed.indexOf("=");

    if (equals === -1) {
      attributes[trimmed.toLowerCase()] = "";
    } else {
      attributes[trimmed.slice(0, equals).toLowerCase()] = trimmed.slice(
        equals + 1,
      );
    }
  }

  return {
    name: (pair || "").slice(0, separator).trim(),
    value: (pair || "").slice(separator + 1).trim(),
    attributes,
  };
}

function isSecure(cookie: SetCookie): boolean {
  return Object.prototype.hasOwnProperty.call(cookie.attributes, "secure");
}

/*
 * RFC 6265, section 5.4: a browser attaches a cookie to a request for a URI
 * on a scheme that is not secure only if the cookie is not secure-only. So
 * these are the cookies that would cross the network in clear text on the
 * next http:// request to the host - deletions aside, which leave nothing.
 */
function sentOverPlainHttp(cookies: Array<SetCookie>): Array<string> {
  return cookies
    .filter((cookie: SetCookie) => {
      return cookie.value !== "" && !isSecure(cookie);
    })
    .map((cookie: SetCookie) => {
      return cookie.name;
    });
}

interface Answer {
  status: number;
  cookies: Array<SetCookie>;
}

async function send(data: {
  method: "GET" | "POST";
  path: string;
  host: string;
  forwardedProto?: string | undefined;
  cookie?: string | undefined;
}): Promise<Answer> {
  const headers: Record<string, string> = {
    Host: data.host,
    // What OneUptime's ingress appends for the visitor.
    "X-Forwarded-For": "203.0.113.7",
  };

  if (data.forwardedProto !== undefined) {
    headers["X-Forwarded-Proto"] = data.forwardedProto;
  }

  if (data.cookie !== undefined) {
    headers["Cookie"] = data.cookie;
  }

  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port,
          path: data.path,
          method: data.method,
          headers,
        },
        (response: http.IncomingMessage) => {
          response.resume();
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              cookies: (response.headers["set-cookie"] || []).map(
                parseSetCookie,
              ),
            });
          });
        },
      );

      request.on("error", reject);
      request.end();
    },
  );
}

function named(cookies: Array<SetCookie>, name: string): SetCookie {
  const cookie: SetCookie | undefined = cookies.find((candidate: SetCookie) => {
    return candidate.name === name;
  });

  if (!cookie) {
    throw new Error(
      `No Set-Cookie for ${name}; got ${cookies
        .map((candidate: SetCookie) => {
          return candidate.name;
        })
        .join(", ")}`,
    );
  }

  return cookie;
}

function expectAllSecure(cookies: Array<SetCookie>): void {
  expect(cookies.length).toBeGreaterThan(0);

  for (const cookie of cookies) {
    expect({ name: cookie.name, secure: isSecure(cookie) }).toEqual({
      name: cookie.name,
      secure: true,
    });
  }

  expect(sentOverPlainHttp(cookies)).toEqual([]);
}

function expectNoneSecure(cookies: Array<SetCookie>): void {
  expect(cookies.length).toBeGreaterThan(0);

  for (const cookie of cookies) {
    expect({ name: cookie.name, secure: isSecure(cookie) }).toEqual({
      name: cookie.name,
      secure: false,
    });
  }
}

describe("a sign-in over HTTPS leaves nothing a plain-HTTP request would carry", () => {
  test("the dashboard session, when the ingress ended TLS (X-Forwarded-Proto: https)", async () => {
    const answer: Answer = await send({
      method: "POST",
      path: "/identity/login",
      host: INSTALLATION_HOST,
      forwardedProto: "https",
    });

    expect(answer.status).toBe(200);

    for (const name of DASHBOARD_SESSION_COOKIES) {
      expect(isSecure(named(answer.cookies, name))).toBe(true);
    }

    expectAllSecure(answer.cookies);

    // What made the session a session still holds.
    expect(named(answer.cookies, "user-token").attributes).toHaveProperty(
      "httponly",
    );
    expect(
      named(answer.cookies, "user-refresh-token").attributes,
    ).toHaveProperty("httponly");
    expect(named(answer.cookies, "user-refresh-token").value).toBe(
      REFRESH_TOKEN,
    );
    expect(named(answer.cookies, "user-token").attributes["samesite"]).toBe(
      "Lax",
    );
    expect(named(answer.cookies, "user-token").attributes["path"]).toBe("/");
  });

  test("the dashboard session of an HTTPS installation whose proxy says nothing about the scheme", async () => {
    setEnv({ httpProtocol: "https://" });

    const answer: Answer = await send({
      method: "POST",
      path: "/identity/login",
      host: INSTALLATION_HOST,
    });

    expectAllSecure(answer.cookies);
  });

  test("the dashboard session of an HTTPS installation, even when the hop into the ingress says http", async () => {
    setEnv({ httpProtocol: "https://" });

    const answer: Answer = await send({
      method: "POST",
      path: "/identity/login",
      host: `${INSTALLATION_HOST}:443`,
      forwardedProto: "http",
    });

    expectAllSecure(answer.cookies);
  });

  test("a private status page's session and password on its custom domain, over TLS", async () => {
    for (const httpProtocol of ["http://", "https://"]) {
      setEnv({ httpProtocol });

      const answer: Answer = await send({
        method: "POST",
        path: "/status-page-identity-api/login",
        host: STATUS_PAGE_DOMAIN,
        forwardedProto: "https",
      });

      for (const name of STATUS_PAGE_SESSION_COOKIES) {
        expect(isSecure(named(answer.cookies, name))).toBe(true);
      }

      expectAllSecure(answer.cookies);
    }
  });

  test("a private status page on the installation's own address of an HTTPS installation", async () => {
    setEnv({ httpProtocol: "https://" });

    const answer: Answer = await send({
      method: "POST",
      path: "/status-page-identity-api/login",
      host: INSTALLATION_HOST,
    });

    expectAllSecure(answer.cookies);
  });

  test("a dashboard's password on its custom domain, over TLS", async () => {
    const answer: Answer = await send({
      method: "POST",
      path: "/public-dashboard-api/unlock",
      host: DASHBOARD_DOMAIN,
      forwardedProto: "https",
    });

    expect(isSecure(named(answer.cookies, DASHBOARD_PASSWORD_COOKIE))).toBe(
      true,
    );
    expectAllSecure(answer.cookies);
  });

  test("a caller that asks for secure: false still gets Secure over HTTPS, on its own path", async () => {
    const answer: Answer = await send({
      method: "GET",
      path: "/identity/state-start",
      host: INSTALLATION_HOST,
      forwardedProto: "https",
    });

    const state: SetCookie = named(answer.cookies, STATE_COOKIE);

    expect(isSecure(state)).toBe(true);
    expect(state.attributes["path"]).toBe(STATE_COOKIE_PATH);
    expect(state.attributes).toHaveProperty("httponly");
  });

  /*
   * OneUptime's ingress writes X-Forwarded-Proto itself, in lower case
   * ($visitor_scheme); Express reads the first value of a list, which is the
   * scheme of the hop nearest the visitor.
   */
  test("the scheme the ingress forwards, alone or first in a list", async () => {
    for (const forwardedProto of ["https", "https, http", "https,http"]) {
      const answer: Answer = await send({
        method: "POST",
        path: "/status-page-identity-api/login",
        host: STATUS_PAGE_DOMAIN,
        forwardedProto,
      });

      expectAllSecure(answer.cookies);
    }
  });
});

describe("plain HTTP keeps signing people in", () => {
  test("a plain-HTTP installation sets every cookie as before, so the browser keeps it", async () => {
    const login: Answer = await send({
      method: "POST",
      path: "/identity/login",
      host: INSTALLATION_HOST,
    });

    expectNoneSecure(login.cookies);
    expect(sentOverPlainHttp(login.cookies)).toEqual(
      expect.arrayContaining(["user-token", "user-refresh-token"]),
    );

    const statusPage: Answer = await send({
      method: "POST",
      path: "/status-page-identity-api/login",
      host: STATUS_PAGE_DOMAIN,
      forwardedProto: "http",
    });

    expectNoneSecure(statusPage.cookies);
  });

  test("a status page or dashboard custom domain an HTTPS installation serves over plain HTTP", async () => {
    setEnv({ httpProtocol: "https://" });

    const statusPage: Answer = await send({
      method: "POST",
      path: "/status-page-identity-api/login",
      host: STATUS_PAGE_DOMAIN,
      forwardedProto: "http",
    });

    expectNoneSecure(statusPage.cookies);

    const dashboard: Answer = await send({
      method: "POST",
      path: "/public-dashboard-api/unlock",
      host: DASHBOARD_DOMAIN,
    });

    expectNoneSecure(dashboard.cookies);
  });

  test("an address other than HOST, such as the server's IP, of an HTTPS installation", async () => {
    setEnv({ httpProtocol: "https://" });

    const answer: Answer = await send({
      method: "POST",
      path: "/identity/login",
      host: "10.0.0.5",
    });

    expectNoneSecure(answer.cookies);
  });

  test("with TRUSTED_PROXY_HOPS=0 a forwarded scheme is not taken from the caller", async () => {
    app.set("trust proxy", 0);

    const answer: Answer = await send({
      method: "POST",
      path: "/status-page-identity-api/login",
      host: STATUS_PAGE_DOMAIN,
      forwardedProto: "https",
    });

    expectNoneSecure(answer.cookies);
  });
});

describe("signing out clears the cookies with the attributes they were set with", () => {
  const signedInCookies: string = [
    "user-token=a",
    "user-refresh-token=b",
    `sso-${PROJECT_ID.toString()}=c`,
    "global-sso-token=d",
  ].join("; ");

  test("over HTTPS", async () => {
    const answer: Answer = await send({
      method: "POST",
      path: "/identity/logout",
      host: INSTALLATION_HOST,
      forwardedProto: "https",
      cookie: signedInCookies,
    });

    for (const name of [
      "user-token",
      "user-refresh-token",
      `sso-${PROJECT_ID.toString()}`,
      "global-sso-token",
      STATE_COOKIE,
    ]) {
      const cleared: SetCookie = named(answer.cookies, name);

      expect(cleared.value).toBe("");
      expect(isSecure(cleared)).toBe(true);
    }

    expect(named(answer.cookies, STATE_COOKIE).attributes["path"]).toBe(
      STATE_COOKIE_PATH,
    );
  });

  test("over plain HTTP", async () => {
    const answer: Answer = await send({
      method: "POST",
      path: "/identity/logout",
      host: INSTALLATION_HOST,
      cookie: signedInCookies,
    });

    expectNoneSecure(answer.cookies);

    for (const cleared of answer.cookies) {
      expect(cleared.value).toBe("");
    }
  });
});
