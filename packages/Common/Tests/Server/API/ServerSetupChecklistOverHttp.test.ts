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

/*
 * Master admins are named by the request's x-test-master-admin header and
 * the master API key by x-test-master-key: the session and the key are the
 * middleware's business, tested on their own. Anybody else is refused as
 * the real one refuses them.
 */
jest.mock("../../../Server/Middleware/MasterAdminAuthorization", () => {
  const NotAuthorizedExceptionType: new (message: string) => Error = (
    jest.requireActual("../../../Types/Exception/NotAuthorizedException") as {
      default: new (message: string) => Error;
    }
  ).default;
  const ResponseType: {
    sendErrorResponse: (req: unknown, res: unknown, err: Error) => void;
  } = (
    jest.requireActual("../../../Server/Utils/Response") as {
      default: {
        sendErrorResponse: (req: unknown, res: unknown, err: Error) => void;
      };
    }
  ).default;

  const refuse: (req: unknown, res: unknown) => void = (
    req: unknown,
    res: unknown,
  ): void => {
    ResponseType.sendErrorResponse(
      req,
      res,
      new NotAuthorizedExceptionType(
        "Unauthorized: Only master admins can perform this action.",
      ),
    );
  };

  return {
    __esModule: true,
    default: {
      isAuthorizedMasterAdminMiddleware: (
        req: { headers: Record<string, unknown> },
        res: unknown,
        next: () => void,
      ): void => {
        if (req.headers["x-test-master-admin"] === "true") {
          next();
          return;
        }
        refuse(req, res);
      },
      isAuthorizedMasterAdminOrMasterApiKeyMiddleware: (
        req: { headers: Record<string, unknown> },
        res: unknown,
        next: () => void,
      ): void => {
        if (
          req.headers["x-test-master-admin"] === "true" ||
          req.headers["x-test-master-key"] === "true"
        ) {
          next();
          return;
        }
        refuse(req, res);
      },
    },
  };
});

import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import UserMiddleware, {
  RequestSession,
} from "../../../Server/Middleware/UserAuthorization";
import ServerSetupChecklist from "../../../Server/Utils/ServerSetup/ServerSetupChecklist";
import { ExpressRequest, ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
  ServerSetupChoiceKind,
  ServerSetupStatus,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
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
 * THE SETUP CHECKLIST, AS THE BROWSER HEARS IT (#6824).
 *
 *   - GET /global-config/setup-checklist answers master admins, and the
 *     master API key (read-only, for `npm run doctor`, #6826), with every
 *     check, and whether the asking admin hid the card. Anybody else is
 *     refused, and nothing is read;
 *   - POST /global-config/setup-checklist/choice makes or undoes the one
 *     choice a check allows, in the name of the admin asking - never one a
 *     check does not allow, never for an unknown check, never for the key;
 *   - POST /global-config/setup-checklist/hide hides the card for the
 *     admin asking, and only a signed-in admin can.
 */

const ADA: string = "a1a1a1a1-0000-4000-8000-000000000001";

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

function send(data: {
  port: number;
  method: "GET" | "POST";
  path: string;
  body?: JSONObject | undefined;
  isMasterAdmin?: boolean | undefined;
  isMasterKey?: boolean | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        data.method === "POST" ? JSON.stringify(data.body || {}) : "";
      const headers: Record<string, string | number> = {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      };

      if (data.isMasterAdmin) {
        headers["x-test-master-admin"] = "true";
      }

      if (data.isMasterKey) {
        headers["x-test-master-key"] = "true";
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method,
          headers: headers,
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

// What the checklist answers, for a server whose email is set up and untested.
const ANSWER: ServerSetupChecklistAnswer = ServerSetupChecklistUtil.getAnswer({
  facts: {
    isHttpsSetUp: false,
    areSignupsClosed: false,
    email: {
      channel: "email" as never,
      state: "untested" as never,
      hasWorked: false,
      lastWorkedAt: null,
      failingSince: null,
      lastFailure: null,
      setUpProblem: null,
    },
    sms: {
      channel: "sms" as never,
      state: "not-set-up" as never,
      hasWorked: false,
      lastWorkedAt: null,
      failingSince: null,
      lastFailure: null,
      setUpProblem: "No Twilio account.",
    },
    call: {
      channel: "call" as never,
      state: "not-set-up" as never,
      hasWorked: false,
      lastWorkedAt: null,
      failingSince: null,
      lastFailure: null,
      setUpProblem: "No Twilio account.",
    },
    emailSentThrough: "smtp.example.com",
    smsSentThrough: "Twilio",
    callSentThrough: "Twilio",
    globalProbes: { total: 1, reporting: 1 },
    updateChecks: { isDisabled: false, lastCheckedAt: null, lastFailure: null },
    lastBackup: null,
    hasScheduledBackups: false,
    isBrowserPushSetUp: false,
    hasAiProvider: false,
    hasSingleSignOn: false,
    choices: { choices: {}, hiddenBy: {} },
  },
  readerUserId: null,
});

let server: http.Server;
let port: number;
let sessionUserId: string | null = ADA;

let getAnswer: ReturnType<typeof jest.spyOn>;
let choose: ReturnType<typeof jest.spyOn>;
let hideFor: ReturnType<typeof jest.spyOn>;

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
  sessionUserId = ADA;

  jest
    .spyOn(UserMiddleware, "readRequestSession")
    .mockImplementation(async (): Promise<RequestSession> => {
      if (!sessionUserId) {
        return { kind: "none" };
      }

      return {
        kind: "user",
        session: {
          userId: new ObjectID(sessionUserId),
          isMasterAdmin: true,
        } as never,
      };
    });

  getAnswer = jest
    .spyOn(ServerSetupChecklist, "getAnswer")
    .mockResolvedValue(ANSWER);
  choose = jest.spyOn(ServerSetupChecklist, "choose").mockResolvedValue();
  hideFor = jest.spyOn(ServerSetupChecklist, "hideFor").mockResolvedValue();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /global-config/setup-checklist", () => {
  test("answers a master admin with every check, read for them", async () => {
    const result: HttpResult = await send({
      port,
      method: "GET",
      path: "/api/global-config/setup-checklist",
      isMasterAdmin: true,
    });

    expect(result.status).toBe(200);

    const read: ServerSetupChecklistAnswer | null =
      ServerSetupChecklistUtil.parseAnswer(result.body);

    expect(read?.checks).toHaveLength(10);
    expect(read?.openRequired).toEqual([
      ServerSetupCheckId.Email,
      ServerSetupCheckId.Https,
      ServerSetupCheckId.Signups,
    ]);
    expect(
      ServerSetupChecklistUtil.getCheck(read!, ServerSetupCheckId.Email)
        ?.status,
    ).toBe(ServerSetupStatus.Untested);

    const asked: { readerUserId: ObjectID | null } = getAnswer.mock
      .calls[0]![0] as { readerUserId: ObjectID | null };

    expect(asked.readerUserId?.toString()).toBe(ADA);
  });

  test("answers the master API key too, read for nobody in particular", async () => {
    sessionUserId = null;

    const result: HttpResult = await send({
      port,
      method: "GET",
      path: "/api/global-config/setup-checklist",
      isMasterKey: true,
    });

    expect(result.status).toBe(200);
    expect(
      (getAnswer.mock.calls[0]![0] as { readerUserId: ObjectID | null })
        .readerUserId,
    ).toBeNull();
  });

  test("refuses anybody else, and reads nothing", async () => {
    const result: HttpResult = await send({
      port,
      method: "GET",
      path: "/api/global-config/setup-checklist",
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body?.["checks"]).toBeUndefined();
    expect(getAnswer).not.toHaveBeenCalled();
  });
});

describe("POST /global-config/setup-checklist/choice", () => {
  test("makes the one choice a check allows, in the asking admin's name, and answers the checklist", async () => {
    const result: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/global-config/setup-checklist/choice",
      body: {
        check: ServerSetupCheckId.SmsAndCalls,
        choice: ServerSetupChoiceKind.Skipped,
      },
      isMasterAdmin: true,
    });

    expect(result.status).toBe(200);
    expect(choose).toHaveBeenCalledTimes(1);

    const made: {
      check: ServerSetupCheckId;
      kind: ServerSetupChoiceKind | null;
      byUserId: ObjectID | null;
    } = choose.mock.calls[0]![0] as never;

    expect(made.check).toBe(ServerSetupCheckId.SmsAndCalls);
    expect(made.kind).toBe(ServerSetupChoiceKind.Skipped);
    expect(made.byUserId?.toString()).toBe(ADA);
    expect(ServerSetupChecklistUtil.parseAnswer(result.body)).not.toBeNull();
  });

  test("undoes it with null", async () => {
    const result: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/global-config/setup-checklist/choice",
      body: { check: ServerSetupCheckId.Backups, choice: null },
      isMasterAdmin: true,
    });

    expect(result.status).toBe(200);
    expect((choose.mock.calls[0]![0] as { kind: unknown }).kind).toBeNull();
  });

  test.each([
    ["email cannot be skipped", { check: "email", choice: "skipped" }],
    ["HTTPS cannot be confirmed", { check: "https", choice: "confirmed" }],
    ["backups cannot be skipped", { check: "backups", choice: "skipped" }],
    ["an unknown check", { check: "everything", choice: "skipped" }],
    ["no check", { choice: "skipped" }],
    ["a choice that is not one", { check: "sms-and-calls", choice: "yes" }],
    ["no choice at all", { check: "sms-and-calls" }],
  ])("%s is refused, and nothing is written", async (_name: string, body: JSONObject) => {
    const result: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/global-config/setup-checklist/choice",
      body: body,
      isMasterAdmin: true,
    });

    expect(result.status).toBe(400);
    expect(choose).not.toHaveBeenCalled();
  });

  test("refuses anybody but a master admin, the master API key included", async () => {
    for (const asWho of [{}, { isMasterKey: true }]) {
      const result: HttpResult = await send({
        port,
        method: "POST",
        path: "/api/global-config/setup-checklist/choice",
        body: {
          check: ServerSetupCheckId.SmsAndCalls,
          choice: ServerSetupChoiceKind.Skipped,
        },
        ...asWho,
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
    }

    expect(choose).not.toHaveBeenCalled();
  });
});

describe("POST /global-config/setup-checklist/hide", () => {
  test("hides the card for the asking admin, and answers the checklist", async () => {
    const result: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/global-config/setup-checklist/hide",
      isMasterAdmin: true,
    });

    expect(result.status).toBe(200);
    expect(hideFor).toHaveBeenCalledTimes(1);
    expect((hideFor.mock.calls[0]![0] as ObjectID).toString()).toBe(ADA);
  });

  test("needs a signed-in admin to hide it for", async () => {
    sessionUserId = null;

    const result: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/global-config/setup-checklist/hide",
      isMasterAdmin: true,
    });

    expect(result.status).toBe(400);
    expect(hideFor).not.toHaveBeenCalled();
  });

  test("refuses anybody else", async () => {
    const result: HttpResult = await send({
      port,
      method: "POST",
      path: "/api/global-config/setup-checklist/hide",
      isMasterKey: true,
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(hideFor).not.toHaveBeenCalled();
  });
});

describe("who is asking", () => {
  test("the session's person, or nobody", async () => {
    const req: ExpressRequest = {} as ExpressRequest;

    expect((await GlobalConfigAPI.getSessionUserId(req))?.toString()).toBe(ADA);

    sessionUserId = null;

    expect(await GlobalConfigAPI.getSessionUserId(req)).toBeNull();
  });
});
