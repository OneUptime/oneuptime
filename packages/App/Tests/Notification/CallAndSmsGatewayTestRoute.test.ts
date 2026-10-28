import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { CALL_AND_SMS_GATEWAY_TEST_ROUTE } from "Common/Server/Utils/CallAndSmsGatewayTest";
import { JSONObject } from "Common/Types/JSON";
import { beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * POST /api/notification/call-and-sms-gateway/test - the Notification
 * service's half of a master admin's Send test (CallAndSmsGatewayTest
 * calls it, with the cluster key). It reads the gateway as saved, posts one
 * test request to it and answers how it went - delivered or not, as JSON
 * the Admin Dashboard's card shows - so only a request that fails to run at
 * all is an error.
 *
 * ClusterKeyRoutesOverHttp and WrongClusterKeysOverHttp send it every
 * shipped and wrong key over HTTP; here its handler is run directly.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
    EXTERNAL_FAULT: {},
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedServiceMiddleware: jest.fn() },
  };
});

jest.mock(
  "../../FeatureSet/Notification/Services/CallAndSmsGatewayService",
  () => {
    return {
      __esModule: true,
      default: { sendTest: jest.fn(), send: jest.fn() },
    };
  },
);

import CallAndSmsGatewayService from "../../FeatureSet/Notification/Services/CallAndSmsGatewayService";
import "../../FeatureSet/Notification/API/CallAndSmsGateway";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouterFunction>;
  handlerFunction: RouterFunction;
}

const routes: Array<RegisteredRoute> = (
  mockRouter.routes as Array<RegisteredRoute>
).filter((route: RegisteredRoute): boolean => {
  return route.uri === "/test";
});

async function callRoute(body: JSONObject = {}): Promise<{
  req: ExpressRequest;
  res: ExpressResponse;
  next: jest.Mock;
}> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await routes[0]!.handlerFunction(req, res, next as unknown as NextFunction);

  return { req, res, next };
}

function answered(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
}

const sendTest: jest.Mock =
  CallAndSmsGatewayService.sendTest as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  sendTest.mockResolvedValue({
    ok: true,
    statusCode: 200,
    message: "Sent to the SMS and call gateway (HTTP 200).",
  });
});

describe("the route", () => {
  test("is one POST /test, behind the cluster key alone", () => {
    expect(routes).toHaveLength(1);
    expect(routes[0]!.method).toBe("POST");
    expect(routes[0]!.middlewares).toEqual([
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    ]);
  });

  test("is mounted where its caller calls it: /api/notification/call-and-sms-gateway", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "../../FeatureSet/Notification/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import CallAndSmsGatewayAPI from "./API/CallAndSmsGateway";',
    );
    expect(index).toContain(
      '[`/${APP_NAME}/call-and-sms-gateway`, "/call-and-sms-gateway"],\n      CallAndSmsGatewayAPI,',
    );
    expect(index).toContain('const APP_NAME: string = "api/notification";');
    expect(CALL_AND_SMS_GATEWAY_TEST_ROUTE).toBe(
      "/api/notification/call-and-sms-gateway/test",
    );
  });
});

describe("what it answers", () => {
  test("a delivered test, as JSON: ok, the gateway's status and the words for the admin", async () => {
    const { next } = await callRoute();

    expect(sendTest).toHaveBeenCalledTimes(1);
    expect(answered()).toEqual({
      ok: true,
      statusCode: 200,
      message: "Sent to the SMS and call gateway (HTTP 200).",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("a test the gateway refused is answered too, not thrown: the card says why", async () => {
    sendTest.mockResolvedValue({
      ok: false,
      statusCode: 403,
      message: "Not delivered: the SMS and call gateway answered HTTP 403.",
    });

    const { next } = await callRoute();

    expect(answered()).toEqual({
      ok: false,
      statusCode: 403,
      message: "Not delivered: the SMS and call gateway answered HTTP 403.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("a gateway that never answered has no status: null", async () => {
    sendTest.mockResolvedValue({
      ok: false,
      message:
        "Not delivered: the SMS and call gateway could not be reached (tried 3 times).",
    });

    await callRoute();

    expect(answered()).toEqual({
      ok: false,
      statusCode: null,
      message:
        "Not delivered: the SMS and call gateway could not be reached (tried 3 times).",
    });
  });

  test("a server that sends through Twilio says so", async () => {
    sendTest.mockResolvedValue({
      ok: false,
      message:
        "Not sent: this server sends SMS and calls through Twilio. Choose your own gateway, add its Gateway URL and save, then send a test.",
    });

    await callRoute();

    expect(answered()["ok"]).toBe(false);
    expect(answered()["statusCode"]).toBeNull();
  });

  test("a test that fails to run is handed to the error handler, and nothing is answered", async () => {
    const failure: Error = new Error("connection terminated");
    sendTest.mockRejectedValue(failure);

    const { next } = await callRoute();

    expect(next).toHaveBeenCalledWith(failure);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("what the request carries is not read: the gateway is tested as saved", async () => {
    await callRoute({
      url: "http://169.254.169.254/latest/meta-data",
      secret: "guessed",
      to: "+15555550123",
    });

    expect(sendTest).toHaveBeenCalledTimes(1);
    expect(sendTest.mock.calls[0]).toEqual([]);
    expect(CallAndSmsGatewayService.send).not.toHaveBeenCalled();
  });
});
