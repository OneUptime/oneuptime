import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * POST /api/notification/sms/send - the cluster-internal route every SMS the
 * app sends goes through (Common's SmsService posts to it). A caller that
 * counts what it delivered - the status page subscriber jobs - sends
 * failIfNotSent, so an SMS the Notification service deliberately does not
 * send (SMS turned off, too little balance) answers with an error instead of
 * success. The route passes it on, and only a real yes counts.
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
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedServiceMiddleware: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectCallSMSConfigService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), toTwilioConfig: jest.fn() },
  };
});

jest.mock("Common/Server/Services/SmsLogService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("../../FeatureSet/Notification/Services/SmsService", () => {
  return { __esModule: true, default: { sendSms: jest.fn() } };
});

import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import "../../FeatureSet/Notification/API/SMS";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

const sendRoute: RouterFunction | undefined = mockRouter.routes.find(
  (route: { method: string; uri: string }): boolean => {
    return route.method === "POST" && route.uri === "/send";
  },
)?.handlerFunction as RouterFunction | undefined;

async function post(body: JSONObject): Promise<{ next: jest.Mock }> {
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

  await sendRoute!(req, res, next as unknown as NextFunction);

  return { next };
}

function sentOptions(): JSONObject {
  return (SmsService.sendSms as unknown as jest.Mock).mock
    .calls[0]![2] as JSONObject;
}

describe("POST /sms/send passes failIfNotSent on", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SmsService.sendSms as unknown as jest.Mock).mockResolvedValue(
      undefined as never,
    );
  });

  test("the route is registered", () => {
    expect(sendRoute).toBeDefined();
  });

  test("true asks the service to fail an SMS it does not send", async () => {
    await post({
      to: "+15555550123",
      message: "Hello",
      failIfNotSent: true,
    });

    expect(sentOptions()["failIfNotSent"]).toBe(true);
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["left out", undefined],
    ["false", false],
    ["the string 'true'", "true"],
    ["1", 1],
  ])("%s does not", async (_label: string, value: unknown) => {
    await post({
      to: "+15555550123",
      message: "Hello",
      ...(value !== undefined ? { failIfNotSent: value as never } : {}),
    });

    expect(sentOptions()["failIfNotSent"]).toBe(false);
  });

  test("an SMS the service does not send answers with the error, not success", async () => {
    const refusal: BadDataException = new BadDataException(
      "SMS not sent: SMS notifications are not enabled for this project.",
    );
    (SmsService.sendSms as unknown as jest.Mock).mockRejectedValue(
      refusal as never,
    );

    const { next } = await post({
      to: "+15555550123",
      message: "Hello",
      failIfNotSent: true,
    });

    expect(next).toHaveBeenCalledWith(refusal);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });
});
