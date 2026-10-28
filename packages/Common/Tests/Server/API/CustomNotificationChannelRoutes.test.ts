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

import CustomNotificationChannelAPI from "../../../Server/API/CustomNotificationChannelAPI";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import { ExpressRouter } from "../../../Server/Utils/Express";
import CustomChannelActionToken from "../../../Server/Utils/OnCall/CustomChannelActionToken";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
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
 * The routes a custom channel adds, over HTTP: what a channel's service
 * calls to act on a page - with no session, the token in its link the only
 * proof - and the routes that are a signed-in person's or a master admin's,
 * refused to anybody else.
 */

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: JSONObject | null;
}

function send(data: {
  port: number;
  path: string;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(data.body || {});
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
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
              headers: response.headers,
              body,
            });
          });
        },
      );

      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

function notification(id: ObjectID): UserOnCallLogTimeline {
  const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  row._id = id.toString();
  row.projectId = ObjectID.generate();
  row.userId = ObjectID.generate();
  row.isAcknowledged = false;
  row.customNotificationChannelId = ObjectID.generate();
  row.triggeredByIncidentId = ObjectID.generate();
  return row;
}

describe("custom channel routes over HTTP", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(express.json());
    const router: ExpressRouter = express.Router();
    router.use(new CustomNotificationChannelAPI().getRouter());
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubNotification(id: ObjectID): jest.SpyInstance {
    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValue(notification(id));

    return jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(undefined as never);
  }

  test("acknowledges a page with the token in its link, and answers in JSON", async () => {
    const id: ObjectID = ObjectID.generate();
    const update: jest.SpyInstance = stubNotification(id);
    const token: string = CustomChannelActionToken.sign({
      userOnCallLogTimelineId: id,
    });

    const result: HttpResult = await send({
      port: port,
      path: `/api/custom-notification-channel/page/${id.toString()}/acknowledge?token=${encodeURIComponent(token)}`,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      action: "acknowledge",
      result: "acknowledged",
      message: "Acknowledged.",
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(String(result.headers["cache-control"] || "")).toContain("no-store");
  });

  test("takes the token in the body as well", async () => {
    const id: ObjectID = ObjectID.generate();
    stubNotification(id);

    const result: HttpResult = await send({
      port: port,
      path: `/api/custom-notification-channel/page/${id.toString()}/acknowledge`,
      body: {
        token: CustomChannelActionToken.sign({ userOnCallLogTimelineId: id }),
      },
    });

    expect(result.status).toBe(200);
    expect(result.body?.["result"]).toBe("acknowledged");
  });

  test("a link without its token is refused, and nothing is changed", async () => {
    const id: ObjectID = ObjectID.generate();
    const update: jest.SpyInstance = stubNotification(id);

    const result: HttpResult = await send({
      port: port,
      path: `/api/custom-notification-channel/page/${id.toString()}/acknowledge`,
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(update).not.toHaveBeenCalled();
  });

  test("another notification's token is refused", async () => {
    const id: ObjectID = ObjectID.generate();
    const update: jest.SpyInstance = stubNotification(id);

    const result: HttpResult = await send({
      port: port,
      path: `/api/custom-notification-channel/page/${id.toString()}/acknowledge?token=${encodeURIComponent(
        CustomChannelActionToken.sign({
          userOnCallLogTimelineId: ObjectID.generate(),
        }),
      )}`,
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(update).not.toHaveBeenCalled();
  });

  test("an unknown action is refused", async () => {
    const id: ObjectID = ObjectID.generate();
    stubNotification(id);

    const result: HttpResult = await send({
      port: port,
      path: `/api/custom-notification-channel/page/${id.toString()}/delete?token=${encodeURIComponent(
        CustomChannelActionToken.sign({ userOnCallLogTimelineId: id }),
      )}`,
    });

    expect(result.status).toBe(400);
  });

  test("listing the channels needs a signed-in person", async () => {
    const result: HttpResult = await send({
      port: port,
      path: "/api/custom-notification-channel/available",
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  test("a person's own test needs a signed-in person", async () => {
    const result: HttpResult = await send({
      port: port,
      path: "/api/custom-notification-channel/test",
      body: { customNotificationChannelId: ObjectID.generate().toString() },
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  test("the admin's test needs a master admin", async () => {
    const result: HttpResult = await send({
      port: port,
      path: "/api/custom-notification-channel/instance/test",
      body: { customNotificationChannelId: ObjectID.generate().toString() },
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  test("the channels' own records are not listed to anybody without a session", async () => {
    const result: HttpResult = await send({
      port: port,
      path: "/api/custom-notification-channel/get-list",
      body: { query: {}, select: { webhookUrl: true, secret: true } },
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(result.body || {})).not.toContain(
      'webhookUrl":"http',
    );
  });
});
