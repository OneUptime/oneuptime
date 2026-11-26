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

import UserAPI from "../../../Server/API/UserAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import { ExpressRouter } from "../../../Server/Utils/Express";
import LocalSignInClearing from "../../../Server/Utils/LocalSignInClearing";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import {
  CLEAR_LOCAL_SIGN_IN_ACTION,
  ClearLocalSignInAnswer,
  readClearLocalSignInAnswer,
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
import { confirmEverySession } from "../TestingUtils/ReauthenticationConfirmed";

/*
 * A master admin's change to how someone signs in waits until the session confirms it's its
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
 * CLEARING ONE PERSON'S SIGN-IN SETTINGS, OVER HTTP (#9762).
 *
 * POST /user/:userId/clear-local-sign-in through the real router and the
 * real middleware in front of it, with only the session and the clear stood
 * in: a master admin signed in clears the person in the path, as themselves
 * - the session's person, which the middleware in front of the route has to
 * make known to it. Someone who is not a master admin, or not signed in, is
 * refused, and nothing is cleared.
 */

interface HttpResult {
  status: number;
  raw: string;
  body: JSONObject | null;
}

function request(data: {
  port: number;
  path: string;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: `/api${data.path}`,
          method: "POST",
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

            resolve({ status: response.statusCode || 0, raw, body });
          });
        },
      );

      outgoing.on("error", reject);
      outgoing.write(JSON.stringify(data.body || {}));
      outgoing.end();
    },
  );
}

const ADMIN_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000ad");
const PERSON_ID: string = "00000000-0000-4000-8000-000000000001";
const PATH: string = `/user/${PERSON_ID}/${CLEAR_LOCAL_SIGN_IN_ACTION}`;

const ANSWER: ClearLocalSignInAnswer = {
  cleared: {
    hasPassword: true,
    hasPasswordResetLink: true,
    isTwoFactorAuthEnabled: false,
    authenticatorAppCount: 0,
    passkeyAndSecurityKeyCount: 1,
    backupCodeCount: 0,
  },
  sessionsEnded: 1,
};

function session(isMasterAdmin: boolean): JSONWebTokenData {
  return {
    userId: ADMIN_ID,
    email: new Email("admin@example.com"),
    isMasterAdmin: isMasterAdmin,
    isGlobalLogin: true,
  } as JSONWebTokenData;
}

describe("clearing one person's sign-in settings, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let clearForPerson: ReturnType<typeof jest.spyOn>;

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(express.json());
    const router: ExpressRouter = express.Router();
    router.use(new UserAPI().getRouter());
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
    clearForPerson = jest
      .spyOn(LocalSignInClearing, "clearForPerson")
      .mockResolvedValue(ANSWER);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function signedInAs(isMasterAdmin: boolean): void {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "user", session: session(isMasterAdmin) });
  }

  test("a master admin clears the person in the path, as themselves", async () => {
    signedInAs(true);

    const result: HttpResult = await request({
      port,
      path: PATH,
      // Nobody named in the body is the master admin recorded.
      body: { clearedByUserId: ObjectID.generate().toString() },
    });

    expect(result.status).toBe(200);
    expect(readClearLocalSignInAnswer(result.body)).toEqual(ANSWER);
    expect(clearForPerson).toHaveBeenCalledTimes(1);

    const argument: {
      userId: ObjectID;
      clearedByUserId: ObjectID;
      isMasterAdminConfirmed: boolean;
    } = clearForPerson.mock.calls[0]![0] as {
      userId: ObjectID;
      clearedByUserId: ObjectID;
      isMasterAdminConfirmed: boolean;
    };

    expect(argument.userId.toString()).toBe(PERSON_ID);
    expect(argument.clearedByUserId.toString()).toBe(ADMIN_ID.toString());
    expect(argument.isMasterAdminConfirmed).toBe(false);
  });

  test("a master admin's is asked for with an exact true", async () => {
    signedInAs(true);

    const result: HttpResult = await request({
      port,
      path: PATH,
      body: { isMasterAdminConfirmed: true },
    });

    expect(result.status).toBe(200);
    expect(
      (clearForPerson.mock.calls[0]![0] as { isMasterAdminConfirmed: boolean })
        .isMasterAdminConfirmed,
    ).toBe(true);
  });

  test("a confirmation that is not true or false is refused, and nothing is cleared", async () => {
    signedInAs(true);

    const result: HttpResult = await request({
      port,
      path: PATH,
      body: { isMasterAdminConfirmed: "true" },
    });

    expect(result.status).toBe(400);
    expect(clearForPerson).not.toHaveBeenCalled();
  });

  test("someone who is not a master admin is refused, and nothing is cleared", async () => {
    signedInAs(false);

    const result: HttpResult = await request({ port, path: PATH });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(result.raw).toContain("Only master admins can perform this action.");
    expect(clearForPerson).not.toHaveBeenCalled();
  });

  test("a request with no session is refused, and nothing is cleared", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "none" });

    const result: HttpResult = await request({ port, path: PATH });

    expect(result.status).toBe(401);
    expect(clearForPerson).not.toHaveBeenCalled();
  });
});
