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
import UserService from "../../../Server/Services/UserService";
import { ExpressRouter } from "../../../Server/Utils/Express";
import LocalSignInClearing from "../../../Server/Utils/LocalSignInClearing";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import {
  CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
  CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
  readClearSavedSignInSettingsAnswer,
  readSavedSignInSettingsAnswer,
  SAVED_SIGN_IN_SETTINGS_ROUTE,
} from "../../../Types/SSO/LocalSignInClearing";
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
 * SIGN-IN SETTINGS SAVED BEFORE THE SERVER REQUIRED SSO, OVER HTTP (#9762).
 *
 * While the whole server requires SSO, the Require SSO card says how many
 * people it covers still have a password, passkeys, security keys, an
 * authenticator app, backup codes or two-factor authentication saved
 * (GET /global-config/saved-sign-in-settings) and a master admin can clear
 * them all (POST .../clear). Both are a master admin's only; the clear is
 * refused while SSO is not required (those settings still sign people in)
 * and when the rule cannot be read, and is made for the master admin on the
 * session. Nothing is cleared for anyone refused.
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
  body?: JSONObject | undefined;
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
        outgoing.write(JSON.stringify(data.body || {}));
      }

      outgoing.end();
    },
  );
}

const ADMIN_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000ad");

function session(isMasterAdmin: boolean): JSONWebTokenData {
  return {
    userId: ADMIN_ID,
    email: new Email("admin@example.com"),
    isMasterAdmin: isMasterAdmin,
    isGlobalLogin: true,
  } as JSONWebTokenData;
}

describe("sign-in settings saved before SSO was required, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let countPeople: ReturnType<typeof jest.spyOn>;
  let clearEveryone: ReturnType<typeof jest.spyOn>;

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
      .spyOn(LocalSignInClearing, "countPeopleCoveredBySsoRequirement")
      .mockResolvedValue(12);
    clearEveryone = jest
      .spyOn(LocalSignInClearing, "clearForEveryoneCoveredBySsoRequirement")
      .mockResolvedValue(12);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function signedInAs(isMasterAdmin: boolean): void {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "user", session: session(isMasterAdmin) });
  }

  test("are the routes the Admin Dashboard asks", () => {
    expect(SAVED_SIGN_IN_SETTINGS_ROUTE).toBe(
      "/global-config/saved-sign-in-settings",
    );
    expect(CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE).toBe(
      "/global-config/saved-sign-in-settings/clear",
    );
  });

  describe("how many people", () => {
    test("a master admin is told, and the answer is never cached", async () => {
      signedInAs(true);

      const result: HttpResult = await request({
        port,
        path: SAVED_SIGN_IN_SETTINGS_ROUTE,
        method: "GET",
      });

      expect(result.status).toBe(200);
      expect(readSavedSignInSettingsAnswer(result.body)).toEqual({
        peopleCount: 12,
      });
      expect(result.cacheControl).toContain("no-store");
      expect(countPeople).toHaveBeenCalledTimes(1);
      expect(clearEveryone).not.toHaveBeenCalled();
    });

    test("someone who is not a master admin is refused, and told nothing", async () => {
      signedInAs(false);

      const result: HttpResult = await request({
        port,
        path: SAVED_SIGN_IN_SETTINGS_ROUTE,
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
        path: SAVED_SIGN_IN_SETTINGS_ROUTE,
        method: "GET",
      });

      expect(result.status).toBe(401);
      expect(countPeople).not.toHaveBeenCalled();
    });

    test("a count that cannot be read is an error, never a number", async () => {
      signedInAs(true);
      countPeople.mockRejectedValue(new Error("statement timeout"));

      const result: HttpResult = await request({
        port,
        path: SAVED_SIGN_IN_SETTINGS_ROUTE,
        method: "GET",
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(readSavedSignInSettingsAnswer(result.body)).toBeNull();
    });
  });

  describe("clearing them", () => {
    test("a master admin clears them, as themselves, and is told how many people", async () => {
      signedInAs(true);

      const result: HttpResult = await request({
        port,
        path: CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
        method: "POST",
        // A master admin named in the body is never the one recorded.
        body: { clearedByUserId: ObjectID.generate().toString() },
      });

      expect(result.status).toBe(200);
      expect(readClearSavedSignInSettingsAnswer(result.body)).toEqual({
        peopleCleared: 12,
      });
      expect(clearEveryone).toHaveBeenCalledTimes(1);
      expect(
        (
          clearEveryone.mock.calls[0]![0] as { clearedByUserId: ObjectID }
        ).clearedByUserId.toString(),
      ).toBe(ADMIN_ID.toString());
    });

    test("is refused while SSO is not required, and clears nothing", async () => {
      signedInAs(true);
      clearEveryone.mockRestore();
      jest
        .spyOn(GlobalConfigService, "getRequireSsoForLogin")
        .mockResolvedValue(false);
      const queryBuilder: ReturnType<typeof jest.spyOn> = jest.spyOn(
        UserService,
        "getQueryBuilder",
      );
      const updateBy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(UserService, "updateBy")
        .mockResolvedValue(0);

      const result: HttpResult = await request({
        port,
        path: CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
        method: "POST",
      });

      expect(result.status).toBe(400);
      expect(result.raw).toContain(
        CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
      );
      expect(queryBuilder).not.toHaveBeenCalled();
      expect(updateBy).not.toHaveBeenCalled();
    });

    test("is refused when the rule cannot be read, and clears nothing", async () => {
      signedInAs(true);
      clearEveryone.mockRestore();
      jest
        .spyOn(GlobalConfigService, "getRequireSsoForLogin")
        .mockRejectedValue(new Error("connection pool is full"));
      const updateBy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(UserService, "updateBy")
        .mockResolvedValue(0);

      const result: HttpResult = await request({
        port,
        path: CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
        method: "POST",
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(readClearSavedSignInSettingsAnswer(result.body)).toBeNull();
      expect(updateBy).not.toHaveBeenCalled();
    });

    test("someone who is not a master admin is refused, and clears nothing", async () => {
      signedInAs(false);

      const result: HttpResult = await request({
        port,
        path: CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
        method: "POST",
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(clearEveryone).not.toHaveBeenCalled();
    });

    test("a request with no session is refused, and clears nothing", async () => {
      jest
        .spyOn(UserMiddleware, "readRequestSession")
        .mockResolvedValue({ kind: "none" });

      const result: HttpResult = await request({
        port,
        path: CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
        method: "POST",
      });

      expect(result.status).toBe(401);
      expect(clearEveryone).not.toHaveBeenCalled();
    });

    test("a GET never clears anything", async () => {
      signedInAs(true);

      const result: HttpResult = await request({
        port,
        path: CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
        method: "GET",
      });

      expect(result.status).not.toBe(200);
      expect(clearEveryone).not.toHaveBeenCalled();
    });
  });
});
