jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
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

import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import {
  END_SESSIONS_WITHOUT_SSO_ROUTE,
  readSessionsWithoutSsoAnswer,
  SESSIONS_WITHOUT_SSO_ROUTE,
  SIGN_OUT_WITHOUT_SSO_NEEDS_SSO_REQUIRED_MESSAGE,
} from "../../../Types/SSO/SessionsWithoutSso";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * PEOPLE SIGNED IN WITHOUT SSO, OVER HTTP (#6116).
 *
 * While the whole server requires SSO, the Require SSO card says how many
 * people are still signed in without it (GET /global-config/sessions-without-
 * sso) and a master admin can sign them all out (POST .../end). Both are a
 * master admin's only; signing out is refused while SSO is not required
 * (they would sign in again with a password at once), and when the rule
 * cannot be read. Nothing is ended for anyone refused.
 */

interface HttpResult {
  status: number;
  raw: string;
  body: JSONObject | null;
  cacheControl: string | undefined;
}

function request(data: {
  port: number;
  path: string;
  method: "GET" | "POST";
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: `/api${data.path}`,
          method: data.method,
          headers: { "content-type": "application/json" },
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
              body = null;
            }

            resolve({
              status: response.statusCode || 0,
              raw,
              body,
              cacheControl: response.headers["cache-control"] as
                | string
                | undefined,
            });
          });
        },
      );

      outgoing.on("error", reject);

      if (data.method === "POST") {
        outgoing.write("{}");
      }

      outgoing.end();
    },
  );
}

function session(isMasterAdmin: boolean): JSONWebTokenData {
  return {
    userId: ObjectID.generate(),
    email: new Email("admin@example.com"),
    isMasterAdmin: isMasterAdmin,
    isGlobalLogin: true,
  } as JSONWebTokenData;
}

describe("people signed in without SSO, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let countPeople: ReturnType<typeof jest.spyOn>;
  let endSessions: ReturnType<typeof jest.spyOn>;

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(express.json());
    const router: ExpressRouter = express.Router();
    router.use(new GlobalConfigAPI().getRouter());
    app.use("/api", router);
    app.use(expressErrorHandler);

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
    countPeople = jest
      .spyOn(UserSessionService, "countPeopleSignedInWithoutSso")
      .mockResolvedValue(4);
    endSessions = jest
      .spyOn(UserSessionService, "endSessionsSignedInWithoutSso")
      .mockResolvedValue(6);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function signedInAs(isMasterAdmin: boolean): void {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "user", session: session(isMasterAdmin) });
  }

  function ssoRequired(answer: boolean | Error): void {
    const spy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      GlobalConfigService,
      "getRequireSsoForLogin",
    );

    if (answer instanceof Error) {
      spy.mockRejectedValue(answer);
    } else {
      spy.mockResolvedValue(answer);
    }
  }

  test("are the routes the Admin Dashboard asks", () => {
    expect(SESSIONS_WITHOUT_SSO_ROUTE).toBe(
      "/global-config/sessions-without-sso",
    );
    expect(END_SESSIONS_WITHOUT_SSO_ROUTE).toBe(
      "/global-config/sessions-without-sso/end",
    );
  });

  describe("how many people", () => {
    test("a master admin is told, and the answer is never cached", async () => {
      signedInAs(true);

      const result: HttpResult = await request({
        port,
        path: SESSIONS_WITHOUT_SSO_ROUTE,
        method: "GET",
      });

      expect(result.status).toBe(200);
      expect(readSessionsWithoutSsoAnswer(result.body)).toEqual({
        peopleCount: 4,
      });
      expect(result.cacheControl).toContain("no-store");
      expect(countPeople).toHaveBeenCalledTimes(1);
    });

    test("someone who is not a master admin is refused, and told nothing", async () => {
      signedInAs(false);

      const result: HttpResult = await request({
        port,
        path: SESSIONS_WITHOUT_SSO_ROUTE,
        method: "GET",
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(result.raw).toContain(
        "Only master admins can perform this action.",
      );
      expect(result.raw).not.toContain("peopleCount");
      expect(countPeople).not.toHaveBeenCalled();
    });

    test("a request with no session is refused", async () => {
      jest
        .spyOn(UserMiddleware, "readRequestSession")
        .mockResolvedValue({ kind: "none" });

      const result: HttpResult = await request({
        port,
        path: SESSIONS_WITHOUT_SSO_ROUTE,
        method: "GET",
      });

      expect(result.status).toBe(401);
      expect(countPeople).not.toHaveBeenCalled();
    });
  });

  describe("signing them out", () => {
    test("a master admin signs them out while SSO is required", async () => {
      signedInAs(true);
      ssoRequired(true);

      const result: HttpResult = await request({
        port,
        path: END_SESSIONS_WITHOUT_SSO_ROUTE,
        method: "POST",
      });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ sessionsEnded: 6 });
      expect(endSessions).toHaveBeenCalledTimes(1);
    });

    test("is refused while SSO is not required, and ends nothing", async () => {
      signedInAs(true);
      ssoRequired(false);

      const result: HttpResult = await request({
        port,
        path: END_SESSIONS_WITHOUT_SSO_ROUTE,
        method: "POST",
      });

      expect(result.status).toBe(400);
      expect(result.raw).toContain(
        SIGN_OUT_WITHOUT_SSO_NEEDS_SSO_REQUIRED_MESSAGE,
      );
      expect(endSessions).not.toHaveBeenCalled();
    });

    test("is refused when the rule cannot be read, and ends nothing", async () => {
      signedInAs(true);
      ssoRequired(new Error("connection pool is full"));

      const result: HttpResult = await request({
        port,
        path: END_SESSIONS_WITHOUT_SSO_ROUTE,
        method: "POST",
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(endSessions).not.toHaveBeenCalled();
    });

    test("someone who is not a master admin is refused, and ends nothing", async () => {
      signedInAs(false);
      ssoRequired(true);

      const result: HttpResult = await request({
        port,
        path: END_SESSIONS_WITHOUT_SSO_ROUTE,
        method: "POST",
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(endSessions).not.toHaveBeenCalled();
    });

    test("a GET never signs anyone out", async () => {
      signedInAs(true);
      ssoRequired(true);

      const result: HttpResult = await request({
        port,
        path: END_SESSIONS_WITHOUT_SSO_ROUTE,
        method: "GET",
      });

      expect(result.status).not.toBe(200);
      expect(endSessions).not.toHaveBeenCalled();
    });
  });
});

describe("the count route's answer, as the card reads it", () => {
  test("is read when it is a whole number of people", () => {
    expect(readSessionsWithoutSsoAnswer({ peopleCount: 0 })).toEqual({
      peopleCount: 0,
    });
    expect(readSessionsWithoutSsoAnswer({ peopleCount: 12 })).toEqual({
      peopleCount: 12,
    });
  });

  test.each([
    [null],
    [[]],
    [{}],
    [{ peopleCount: "3" }],
    [{ peopleCount: -1 }],
    [{ peopleCount: 1.5 }],
  ])("anything else is no answer: %j", (answer: unknown) => {
    expect(readSessionsWithoutSsoAnswer(answer)).toBeNull();
  });
});
