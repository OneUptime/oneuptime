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

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../Server/Middleware/UserAuthorization",
  ) as { default: Record<string, unknown> };

  const ObjectIdType: new (id: string) => unknown = (
    jest.requireActual("../../../Types/ObjectID") as {
      default: new (id: string) => unknown;
    }
  ).default;

  /*
   * The signed-in person, named by the request's x-test-user-id header: the
   * session itself is the middleware's business, tested on its own.
   */
  actual.default["getUserMiddleware"] = (
    req: { headers: Record<string, unknown>; userAuthorization?: unknown },
    _res: unknown,
    next: () => void,
  ): void => {
    const userId: unknown = req.headers["x-test-user-id"];

    if (typeof userId === "string" && userId) {
      req.userAuthorization = {
        userId: new ObjectIdType(userId),
        isMasterAdmin: false,
      };
    }

    next();
  };

  return actual;
});

import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import TestSendAccess from "../../../Server/API/TestSendAccess";
import UserPushAPI from "../../../Server/API/UserPushAPI";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserPushService from "../../../Server/Services/UserPushService";
import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import { PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE } from "../../../Types/PushNotification/PushNotificationsTurnedOff";
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
 * WHETHER PUSH IS OFF, AS THE BROWSER AND THE PHONE HEAR IT.
 *
 * GET /global-config/vars is the server's public settings, read by every
 * Dashboard before anyone signs in: it says whether push notifications are
 * turned off for the whole server (disablePushNotifications), and the
 * Dashboard shows the notice in place of the push devices and offers none
 * in a rule. A server that never set the switch, or has no settings row
 * yet, says push is on.
 *
 * And the two routes that refuse while push is off answer as any refusal
 * does over HTTP - 400, with the shared words in `message` - which is what
 * the mobile app and the Dashboard show the person.
 */

const USER_ID: ObjectID = new ObjectID("c6000000-0000-4000-8000-000000000011");
const PROJECT_ID: ObjectID = new ObjectID(
  "c6000000-0000-4000-8000-000000000012",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "c6000000-0000-4000-8000-000000000013",
);

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

function send(data: {
  port: number;
  method: "GET" | "POST";
  path: string;
  body?: JSONObject | undefined;
  userId?: ObjectID | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        data.method === "POST" ? JSON.stringify(data.body || {}) : "";
      const headers: Record<string, string | number> = {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      };

      if (data.userId) {
        headers["x-test-user-id"] = data.userId.toString();
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

function settingsRow(columns: Record<string, unknown>): GlobalConfig {
  return columns as unknown as GlobalConfig;
}

let server: http.Server;
let port: number;

// Whether push is turned off, as the server reads it; an Error when the read fails.
let switchAnswer: boolean | Error = false;

beforeAll(async () => {
  const app: express.Express = express();
  app.use(express.json());
  const router: ExpressRouter = express.Router();
  router.use(new GlobalConfigAPI().getRouter());
  router.use(new UserPushAPI().getRouter());
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
  switchAnswer = false;

  jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockImplementation(async (): Promise<boolean> => {
      if (switchAnswer instanceof Error) {
        throw switchAnswer;
      }

      return switchAnswer;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /global-config/vars", () => {
  let settingsRead: jest.SpyInstance;

  function answerWith(row: GlobalConfig | null): void {
    settingsRead = jest
      .spyOn(GlobalConfigService, "findOneById")
      .mockResolvedValue(row);
  }

  async function vars(): Promise<HttpResult> {
    return await send({
      port: port,
      method: "GET",
      path: "/api/global-config/vars",
    });
  }

  test.each([
    [{ disablePushNotifications: true, disableUserProjectCreation: false }],
    [{ disablePushNotifications: false, disableUserProjectCreation: true }],
    [{ disablePushNotifications: true, disableUserProjectCreation: true }],
    [{ disablePushNotifications: false, disableUserProjectCreation: false }],
  ])("says each switch as it is stored: %j", async (row: JSONObject) => {
    answerWith(settingsRow(row));

    const result: HttpResult = await vars();

    expect(result.status).toBe(200);
    expect(result.body).toEqual(row);
  });

  test("is public: a browser with nobody signed in is answered", async () => {
    answerWith(settingsRow({ disablePushNotifications: true }));

    const result: HttpResult = await vars();

    expect(result.status).toBe(200);
    expect(result.body?.["disablePushNotifications"]).toBe(true);
  });

  test("says exactly these two things, and nothing else of the settings row", async () => {
    answerWith(
      settingsRow({
        disablePushNotifications: true,
        disableUserProjectCreation: true,
        twilioAuthToken: "should-never-leave",
        smtpPassword: "should-never-leave",
      }),
    );

    const result: HttpResult = await vars();

    expect(Object.keys(result.body || {}).sort()).toEqual(
      ["disablePushNotifications", "disableUserProjectCreation"].sort(),
    );
    expect(JSON.stringify(result.body)).not.toContain("should-never-leave");
  });

  test("reads the one settings row, those two columns only, as root", async () => {
    answerWith(settingsRow({ disablePushNotifications: false }));

    await vars();

    expect(settingsRead).toHaveBeenCalledTimes(1);

    const read: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = settingsRead.mock.calls[0]![0] as never;

    expect(read.id.toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(read.select).toEqual({
      disableUserProjectCreation: true,
      disablePushNotifications: true,
    });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("a server with no settings row yet says push is on", async () => {
    answerWith(null);

    const result: HttpResult = await vars();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      disableUserProjectCreation: false,
      disablePushNotifications: false,
    });
  });

  test.each([[null], [undefined]])(
    "a column the server never set (%p) says push is on, as a boolean",
    async (stored: null | undefined) => {
      answerWith(
        settingsRow({
          disablePushNotifications: stored,
          disableUserProjectCreation: stored,
        }),
      );

      const result: HttpResult = await vars();

      expect(result.body?.["disablePushNotifications"]).toBe(false);
      expect(result.body?.["disableUserProjectCreation"]).toBe(false);
    },
  );

  test("does not ask the push sender's copy of the switch: the row is read as it is", async () => {
    answerWith(settingsRow({ disablePushNotifications: true }));

    await vars();

    expect(
      GlobalConfigService.getPushNotificationsTurnedOff,
    ).not.toHaveBeenCalled();
  });

  test("a read that fails is a server error that says nothing of why", async () => {
    jest
      .spyOn(GlobalConfigService, "findOneById")
      .mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));

    const result: HttpResult = await vars();

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("ECONNREFUSED");
  });
});

describe("the routes that refuse while push is off, over HTTP", () => {
  beforeEach(() => {
    switchAnswer = true;
  });

  test("registering a device: 400, and the shared words are the message", async () => {
    const result: HttpResult = await send({
      port: port,
      method: "POST",
      path: "/api/user-push/register",
      userId: USER_ID,
      body: {
        deviceToken: "ExponentPushToken[push-off-over-http-0001]",
        deviceType: PushDeviceType.iOS,
        deviceName: "iPhone 15",
        projectId: PROJECT_ID.toString(),
      },
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      message: PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
    });
  });

  test("a test notification: 400, and the shared words are the message", async () => {
    jest.spyOn(TestSendAccess, "assertMaySendTestToSelf").mockResolvedValue({
      props: {
        userId: USER_ID,
        userGlobalAccessPermission: { projectIds: [PROJECT_ID] },
      },
      userId: USER_ID,
    } as never);

    const deviceRead: jest.SpyInstance = jest.spyOn(
      UserPushService,
      "findOneById",
    );

    const result: HttpResult = await send({
      port: port,
      method: "POST",
      path: `/api/user-push/${DEVICE_ID.toString()}/test-notification`,
      userId: USER_ID,
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      message: PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
    });
    expect(deviceRead).not.toHaveBeenCalled();
  });

  test("a switch that cannot be read: the registration is a server error, not a registration", async () => {
    switchAnswer = new Error("connect ECONNREFUSED 10.0.0.5:5432");

    const create: jest.SpyInstance = jest.spyOn(UserPushService, "create");

    const result: HttpResult = await send({
      port: port,
      method: "POST",
      path: "/api/user-push/register",
      userId: USER_ID,
      body: {
        deviceToken: "ExponentPushToken[push-off-over-http-0002]",
        deviceType: PushDeviceType.Android,
        deviceName: "Pixel 8",
        projectId: PROJECT_ID.toString(),
      },
    });

    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("ECONNREFUSED");
    expect(create).not.toHaveBeenCalled();
  });
});
