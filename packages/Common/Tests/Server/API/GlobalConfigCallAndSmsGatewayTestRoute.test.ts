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
import CallAndSmsGatewayTest from "../../../Server/Utils/CallAndSmsGatewayTest";
import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
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
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
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
 * POST /global-config/call-and-sms-gateway/test, over HTTP: Send Test on
 * Admin Dashboard > Settings > Call and SMS.
 *
 * A master admin's only - it makes the Notification service post to the
 * installation's own gateway - so a request with no session, or a session
 * that is not a master admin's, is refused before anything is sent. A
 * master admin gets how the test went, delivered or not, in the words the
 * card shows: ok, the gateway's status when it answered, and a message.
 */

const ROUTE: string = "/api/global-config/call-and-sms-gateway/test";

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

function request(data: {
  port: number;
  path: string;
  method?: "GET" | "POST" | undefined;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(data.body || {});
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method || "POST",
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

            resolve({ status: response.statusCode || 0, body });
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
  return {
    userId: ObjectID.generate(),
    email: new Email("admin@example.com"),
    isMasterAdmin: isMasterAdmin,
    isGlobalLogin: true,
  } as JSONWebTokenData;
}

describe("Send Test for the server's SMS and call gateway, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let gatewayTest: jest.SpyInstance;

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
    gatewayTest = jest.spyOn(CallAndSmsGatewayTest, "send").mockResolvedValue({
      ok: true,
      statusCode: 200,
      message: "Sent to the SMS and call gateway (HTTP 200).",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a request with no session is refused, and nothing is sent", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "none" });

    const result: HttpResult = await request({ port: port, path: ROUTE });

    expect(result.status).toBe(401);
    expect(gatewayTest).not.toHaveBeenCalled();
  });

  test("a session that cannot be read is refused, and nothing is sent", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "invalid", error: new Error("expired") });

    const result: HttpResult = await request({ port: port, path: ROUTE });

    expect(result.status).toBe(401);
    expect(gatewayTest).not.toHaveBeenCalled();
  });

  test("a signed-in person who is not a master admin is refused, and nothing is sent", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "user", session: session(false) });

    const result: HttpResult = await request({ port: port, path: ROUTE });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(JSON.stringify(result.body)).toContain(
      "Only master admins can perform this action.",
    );
    expect(gatewayTest).not.toHaveBeenCalled();
  });

  test("a blocked master admin is refused", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "blocked", session: session(true) });

    const result: HttpResult = await request({ port: port, path: ROUTE });

    expect(result.status).toBe(401);
    expect(gatewayTest).not.toHaveBeenCalled();
  });

  describe("for a master admin", () => {
    beforeEach(() => {
      jest
        .spyOn(UserMiddleware, "readRequestSession")
        .mockResolvedValue({ kind: "user", session: session(true) });
    });

    test("sends one test and answers how it went", async () => {
      const result: HttpResult = await request({ port: port, path: ROUTE });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        ok: true,
        responseStatusCode: 200,
        statusMessage: "Sent to the SMS and call gateway (HTTP 200).",
      });
      expect(gatewayTest).toHaveBeenCalledTimes(1);
    });

    test("a test the gateway refused is answered 200 too: the card says why", async () => {
      gatewayTest.mockResolvedValue({
        ok: false,
        statusCode: 401,
        message: "Not delivered: the SMS and call gateway answered HTTP 401.",
      });

      const result: HttpResult = await request({ port: port, path: ROUTE });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        ok: false,
        responseStatusCode: 401,
        statusMessage:
          "Not delivered: the SMS and call gateway answered HTTP 401.",
      });
    });

    test("a gateway that never answered has no status: null, not a missing key", async () => {
      gatewayTest.mockResolvedValue({
        ok: false,
        message:
          "Not delivered: the SMS and call gateway could not be reached (tried 3 times).",
      });

      const result: HttpResult = await request({ port: port, path: ROUTE });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        ok: false,
        responseStatusCode: null,
        statusMessage:
          "Not delivered: the SMS and call gateway could not be reached (tried 3 times).",
      });
    });

    test("a server that sends through Twilio says so", async () => {
      gatewayTest.mockResolvedValue({
        ok: false,
        message:
          "Not sent: this server sends SMS and calls through Twilio. Choose your own gateway, add its Gateway URL and save, then send a test.",
      });

      const result: HttpResult = await request({ port: port, path: ROUTE });

      expect(result.body?.["ok"]).toBe(false);
      expect(result.body?.["statusMessage"]).toContain("through Twilio");
    });

    test("a test that fails to run is answered as an error, not as a test that went", async () => {
      gatewayTest.mockRejectedValue(new Error("The test could not run."));

      const result: HttpResult = await request({ port: port, path: ROUTE });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.body?.["ok"]).toBeUndefined();
    });

    test("what the request carries is not read: the test is of the gateway as saved", async () => {
      await request({
        port: port,
        path: ROUTE,
        body: {
          url: "http://169.254.169.254/latest/meta-data",
          projectId: ObjectID.generate().toString(),
        },
      });

      expect(gatewayTest).toHaveBeenCalledTimes(1);
      expect(gatewayTest.mock.calls[0]).toEqual([]);
    });

    test("answers a POST only", async () => {
      const result: HttpResult = await request({
        port: port,
        path: ROUTE,
        method: "GET",
      });

      expect(result.status).toBe(404);
      expect(gatewayTest).not.toHaveBeenCalled();
    });
  });
});

describe("the route as the Admin Dashboard calls it", () => {
  test("is the address the card posts to", () => {
    const card: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/CallAndSmsGatewayCard.tsx",
      ),
      "utf8",
    );

    expect(card).toContain('"/global-config/call-and-sms-gateway/test"');
    expect(ROUTE).toBe(`/api${"/global-config/call-and-sms-gateway/test"}`);
  });
});
