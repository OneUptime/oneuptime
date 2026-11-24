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
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import { ExpressRouter } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import MasterApiKey from "../../../Server/Utils/MasterApiKey";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import {
  MASTER_API_KEY_ROUTE,
  MasterApiKeyState,
  parseCreatedMasterApiKey,
  parseMasterApiKeyState,
} from "../../../Types/MasterApiKey/MasterApiKeyAnswer";
import ObjectID from "../../../Types/ObjectID";
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
import { confirmEverySession } from "../TestingUtils/ReauthenticationConfirmed";

/*
 * A new master API key waits until the session confirms it's its
 * person's (Confirm It's You, #10216): every session here has confirmed.
 * The check itself, through the same hooks and routes, is pinned by
 * Tests/Server/Services/AdminReauthenticationGates.test.ts and
 * Tests/Server/API/AdminReauthenticationRoutes.test.ts.
 */
beforeEach(() => {
  confirmEverySession();
});

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * GET and POST /global-config/master-api-key, over HTTP: Admin Dashboard >
 * Settings > API Key (#7901).
 *
 * The master API key is stored hashed, so the page cannot read it back:
 *
 *   - GET says whether a key is set and whether it is on - never the key,
 *     nor its hash;
 *   - POST makes a new key, turned on, and answers it: the one time it is
 *     ever sent, with Cache-Control: no-store so no cache keeps it;
 *   - both are a signed-in master admin's only. POST is refused to the
 *     master API key itself - a leaked key must not replace itself - and
 *     the key is never even looked at for it.
 *
 * And which key is set (#8903): GET answers when it was made, by whom and
 * its hint, and POST records the master admin who made it.
 */

const ROUTE: string = `/api${MASTER_API_KEY_ROUTE}`;

const KEY: string = "8e1a3a52-6d64-4f1f-9a2e-5f0f9c1d2b34";
const NEW_KEY: string = "5f3b9c1e-7a2d-4e8f-b6c0-1d2e3f4a5b6c";
const MADE_AT: Date = new Date("2026-11-16T09:30:00.000Z");

// The master admin signed in, for the key they make.
let signedInUserId: ObjectID = ObjectID.generate();

interface HttpResult {
  status: number;
  body: JSONObject | null;
  text: string;
  headers: http.IncomingHttpHeaders;
}

function request(data: {
  port: number;
  method: "GET" | "POST";
  headers?: Record<string, string> | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = data.method === "POST" ? "{}" : "";
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: ROUTE,
          method: data.method,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            ...(data.headers || {}),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = text ? (JSON.parse(text) as JSONObject) : null;
            } catch {
              body = null;
            }

            resolve({
              status: response.statusCode || 0,
              body,
              text,
              headers: response.headers,
            });
          });
        },
      );

      outgoing.on("error", reject);
      outgoing.write(payload);
      outgoing.end();
    },
  );
}

function session(isMasterAdmin: boolean): JSONWebTokenData {
  signedInUserId = ObjectID.generate();

  return {
    userId: signedInUserId,
    email: new Email("admin@example.com"),
    isMasterAdmin: isMasterAdmin,
    isGlobalLogin: true,
  } as JSONWebTokenData;
}

function signIn(as: "master-admin" | "member" | "nobody" | "blocked"): void {
  if (as === "nobody") {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "none" });
    return;
  }

  if (as === "blocked") {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "blocked", session: session(true) });
    return;
  }

  jest.spyOn(UserMiddleware, "readRequestSession").mockResolvedValue({
    kind: "user",
    session: session(as === "master-admin"),
  });
}

describe("the master API key's routes, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let create: jest.SpyInstance;
  let state: jest.SpyInstance;
  let isMasterApiKey: jest.SpyInstance;
  let stored: MasterApiKeyState;

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
    stored = {
      isSet: true,
      isEnabled: false,
      createdAt: null,
      createdByName: null,
      hint: null,
    };

    create = jest
      .spyOn(GlobalConfigService, "createMasterApiKey")
      .mockImplementation(async (): Promise<string> => {
        stored = {
          isSet: true,
          isEnabled: true,
          createdAt: MADE_AT,
          createdByName: "Ada Lovelace",
          hint: "5b6c",
        };
        return NEW_KEY;
      });
    state = jest
      .spyOn(GlobalConfigService, "getMasterApiKeyState")
      .mockImplementation(async () => {
        return { ...stored };
      });
    isMasterApiKey = jest
      .spyOn(ProjectMiddleware, "isMasterApiKey")
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET", () => {
    test("a master admin reads whether a key is set and whether it is on, and nothing else", async () => {
      signIn("master-admin");

      const result: HttpResult = await request({ port, method: "GET" });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        isSet: true,
        isEnabled: false,
        createdAt: null,
        createdByName: null,
        hint: null,
      });
      expect(parseMasterApiKeyState(result.body)).toEqual({
        isSet: true,
        isEnabled: false,
        createdAt: null,
        createdByName: null,
        hint: null,
      });
      expect(state).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    });

    test("and which key is set: when it was made, by whom, and how it ends", async () => {
      signIn("master-admin");
      stored = {
        isSet: true,
        isEnabled: true,
        createdAt: MADE_AT,
        createdByName: "Ada Lovelace",
        hint: "2b34",
      };

      const result: HttpResult = await request({ port, method: "GET" });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        isSet: true,
        isEnabled: true,
        createdAt: "2026-11-16T09:30:00.000Z",
        createdByName: "Ada Lovelace",
        hint: "2b34",
      });
      expect(parseMasterApiKeyState(result.body)).toEqual(stored);
    });

    test("never answers the key, nor its hash", async () => {
      signIn("master-admin");

      const result: HttpResult = await request({ port, method: "GET" });

      expect(result.text).not.toContain(KEY);
      expect(result.text).not.toContain(MasterApiKey.hash(KEY));
      expect(Object.keys(result.body || {}).sort()).toEqual([
        "createdAt",
        "createdByName",
        "hint",
        "isEnabled",
        "isSet",
      ]);
    });

    test.each([
      ["no session", "nobody", 401],
      ["a blocked master admin", "blocked", 401],
    ] as Array<[string, "nobody" | "blocked", number]>)(
      "%s is refused",
      async (_label: string, as: "nobody" | "blocked", status: number) => {
        signIn(as);

        const result: HttpResult = await request({ port, method: "GET" });

        expect(result.status).toBe(status);
        expect(state).not.toHaveBeenCalled();
      },
    );

    test("someone signed in who is not a master admin is refused", async () => {
      signIn("member");

      const result: HttpResult = await request({ port, method: "GET" });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(result.text).toContain(
        "Only master admins can perform this action.",
      );
      expect(state).not.toHaveBeenCalled();
    });
  });

  describe("POST", () => {
    test("a master admin makes a new key, and gets it, turned on", async () => {
      signIn("master-admin");

      const result: HttpResult = await request({ port, method: "POST" });

      expect(result.status).toBe(200);
      expect(create).toHaveBeenCalledTimes(1);
      expect(result.body).toEqual({
        isSet: true,
        isEnabled: true,
        createdAt: "2026-11-16T09:30:00.000Z",
        createdByName: "Ada Lovelace",
        hint: "5b6c",
        masterApiKey: NEW_KEY,
      });
      expect(parseCreatedMasterApiKey(result.body)).toEqual({
        isSet: true,
        isEnabled: true,
        createdAt: MADE_AT,
        createdByName: "Ada Lovelace",
        hint: "5b6c",
        masterApiKey: NEW_KEY,
      });
    });

    test("records the master admin who made the key, from their session", async () => {
      signIn("master-admin");

      await request({ port, method: "POST" });

      expect(create).toHaveBeenCalledTimes(1);
      expect(
        (
          create.mock.calls[0]![0] as { createdByUserId: ObjectID }
        ).createdByUserId.toString(),
      ).toBe(signedInUserId.toString());
    });

    test("no cache may keep the answer that holds the key", async () => {
      signIn("master-admin");

      const result: HttpResult = await request({ port, method: "POST" });

      expect(result.headers["cache-control"]).toBe("no-store");
    });

    test("the key reaches no log", async () => {
      signIn("master-admin");

      await request({ port, method: "POST" });

      const logged: string = JSON.stringify(
        [logger.debug, logger.info, logger.warn, logger.error].map(
          (log: unknown): unknown => {
            return (log as jest.Mock).mock.calls;
          },
        ),
      );

      expect(logged).not.toContain(NEW_KEY);
    });

    test.each([
      ["no session", "nobody", 401],
      ["a blocked master admin", "blocked", 401],
    ] as Array<[string, "nobody" | "blocked", number]>)(
      "%s is refused, and no key is made",
      async (_label: string, as: "nobody" | "blocked", status: number) => {
        signIn(as);

        const result: HttpResult = await request({ port, method: "POST" });

        expect(result.status).toBe(status);
        expect(create).not.toHaveBeenCalled();
        expect(result.text).not.toContain(NEW_KEY);
      },
    );

    test("someone signed in who is not a master admin is refused, and no key is made", async () => {
      signIn("member");

      const result: HttpResult = await request({ port, method: "POST" });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(create).not.toHaveBeenCalled();
    });

    test("the master API key itself is refused: a leaked key cannot replace itself", async () => {
      signIn("nobody");

      const result: HttpResult = await request({
        port,
        method: "POST",
        headers: { apikey: KEY },
      });

      expect(result.status).toBe(401);
      expect(create).not.toHaveBeenCalled();
      // Not even asked whether it is the master key.
      expect(isMasterApiKey).not.toHaveBeenCalled();
    });

    test("a key that could not be made says why, and answers no key", async () => {
      signIn("master-admin");
      create.mockRejectedValue(new Error("connection terminated"));

      const result: HttpResult = await request({ port, method: "POST" });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.body?.["masterApiKey"]).toBeUndefined();
    });
  });
});
