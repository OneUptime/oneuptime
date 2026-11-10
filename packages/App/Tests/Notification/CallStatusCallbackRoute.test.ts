import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
import CallStatus from "Common/Types/Call/CallStatus";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * POST /notification/call/status-callback/:callLogId/:token - HOW A CALL
 * ENDED, AS TWILIO TELLS IT (#6586).
 *
 * Every call CallService places through Twilio for a project names this
 * route as its status callback, with the call's log id and a token only
 * that log holds. When the call ends, Twilio posts its final status here:
 * the call's log moves on from Success - Missed Call, Busy, Error - and the
 * on-call notification it was made for, while it is only sent, becomes Not
 * Answered or Error, whose own hooks tell the record's feed ("Nitin did not
 * answer the phone call"). The route is a public webhook: no sign-in, no
 * cluster key, the token is its lock. A call ends once - a callback Twilio
 * sends twice, or two at once, writes once - and the person's answer, an
 * escalation or a skip is never written over.
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

jest.mock("Common/Server/Services/CallLogService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Notification/Services/CallService", () => {
  return { __esModule: true, default: { makeCall: jest.fn() } };
});

import CallLogService from "Common/Server/Services/CallLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import "../../FeatureSet/Notification/API/Call";

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

const ROUTE: RegisteredRoute | undefined = (
  mockRouter.routes as unknown as Array<RegisteredRoute>
).find((route: RegisteredRoute): boolean => {
  return (
    route.method === "POST" &&
    route.uri === "/status-callback/:callLogId/:token"
  );
});

const CALL_LOG_ID: ObjectID = new ObjectID(
  "6c0e0000-0000-4000-8000-0000000000a1",
);
const NOTIFICATION_ID: ObjectID = new ObjectID(
  "6c0e0000-0000-4000-8000-0000000000a2",
);
const TOKEN: string = "6c0e0000-0000-4000-8000-0000000000f1";
const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";

const findCallLog: jest.Mock =
  CallLogService.findOneById as unknown as jest.Mock;
const writeCallLog: jest.Mock =
  CallLogService.compareAndSetColumnsByIdWithoutHooks as unknown as jest.Mock;
const findNotification: jest.Mock =
  UserOnCallLogTimelineService.findOneById as unknown as jest.Mock;
const updateNotification: jest.Mock =
  UserOnCallLogTimelineService.updateOneById as unknown as jest.Mock;
const sendEmptySuccess: jest.Mock =
  Response.sendEmptySuccessResponse as unknown as jest.Mock;
const sendError: jest.Mock = Response.sendErrorResponse as unknown as jest.Mock;

let callLog: CallLog | null;
let notification: UserOnCallLogTimeline | null;

interface Answer {
  status: jest.Mock;
  send: jest.Mock;
  next: jest.Mock;
}

async function callback(
  body: JSONObject,
  params: { callLogId?: string; token?: string } = {},
): Promise<Answer> {
  const req: ExpressRequest = {
    params: {
      callLogId: params.callLogId ?? CALL_LOG_ID.toString(),
      token: params.token ?? TOKEN,
    },
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const send: jest.Mock = jest.fn();
  const status: jest.Mock = jest.fn();
  const res: ExpressResponse = {
    send: send,
    json: jest.fn(),
    status: status,
  } as unknown as ExpressResponse;
  status.mockReturnValue(res);

  const next: jest.Mock = jest.fn();

  await ROUTE!.handlerFunction(req, res, next as unknown as NextFunction);

  return { status: status, send: send, next: next };
}

function ended(callStatus: string, more: JSONObject = {}): JSONObject {
  return { CallSid: CALL_SID, CallStatus: callStatus, ...more };
}

function logWrite(): Record<string, unknown> {
  return writeCallLog.mock.calls[0]![0] as Record<string, unknown>;
}

function notificationUpdate(): Record<string, unknown> {
  return updateNotification.mock.calls[0]![0] as Record<string, unknown>;
}

function expectNothingWritten(): void {
  expect(writeCallLog).not.toHaveBeenCalled();
  expect(updateNotification).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();

  callLog = new CallLog();
  callLog.id = CALL_LOG_ID;
  callLog.status = CallStatus.Success;
  callLog.statusCallbackToken = TOKEN;
  callLog.userOnCallLogTimelineId = NOTIFICATION_ID;

  notification = new UserOnCallLogTimeline();
  notification.id = NOTIFICATION_ID;
  notification.status = UserNotificationStatus.Sent;

  findCallLog.mockImplementation((async () => {
    return callLog;
  }) as never);
  writeCallLog.mockResolvedValue(true as never);
  findNotification.mockImplementation((async () => {
    return notification;
  }) as never);
  updateNotification.mockResolvedValue(undefined as never);
});

describe("the route", () => {
  test("is registered, with nothing in front of it: Twilio signs in as nobody", () => {
    expect(ROUTE).toBeDefined();
    expect(ROUTE!.middlewares).toEqual([]);
  });

  test("reads the call's log as root, with the token it holds - never more than how the call ended needs", async () => {
    await callback(ended("no-answer"));

    expect(findCallLog).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      select: {
        _id: true,
        status: true,
        statusCallbackToken: true,
        userOnCallLogTimelineId: true,
      },
      props: { isRoot: true },
    });
  });
});

describe("a call that was not answered", () => {
  test("rang out: the log becomes a missed call, the notification a call not answered", async () => {
    await callback(ended("no-answer"));

    const message: string = `Call ID: ${CALL_SID}. The call was not answered: it rang out.`;

    expect(logWrite()).toEqual({
      id: CALL_LOG_ID,
      data: { status: CallStatus.MissedCall, statusMessage: message },
      expectedData: { status: CallStatus.Success },
    });
    expect(notificationUpdate()).toEqual({
      id: NOTIFICATION_ID,
      data: {
        status: UserNotificationStatus.NotAnswered,
        statusMessage: message,
      },
      props: { isRoot: true },
    });
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("busy - or declined: the log says Busy, the notification a call not answered", async () => {
    await callback(ended("busy"));

    expect((logWrite()["data"] as JSONObject)["status"]).toBe(CallStatus.Busy);
    expect((notificationUpdate()["data"] as JSONObject)["status"]).toBe(
      UserNotificationStatus.NotAnswered,
    );
  });

  test("a notification still going out (Sending) is moved on too", async () => {
    notification!.status = UserNotificationStatus.Sending;

    await callback(ended("no-answer"));

    expect(updateNotification).toHaveBeenCalledTimes(1);
  });
});

describe("a call that could not be connected", () => {
  test("is an error on the log and on the notification: the page did not reach them", async () => {
    await callback(ended("failed"));

    expect(logWrite()["data"]).toEqual({
      status: CallStatus.Error,
      statusMessage: `Call ID: ${CALL_SID}. The call could not be connected.`,
    });
    expect((notificationUpdate()["data"] as JSONObject)["status"]).toBe(
      UserNotificationStatus.Error,
    );
  });
});

describe("a call that was answered", () => {
  test("stays Success, and its notification sent - only the message says how long it lasted", async () => {
    await callback(ended("completed", { CallDuration: "42" }));

    const message: string = `Call ID: ${CALL_SID}. The call was answered and lasted 42 seconds.`;

    expect(logWrite()).toEqual({
      id: CALL_LOG_ID,
      data: { statusMessage: message },
      expectedData: { status: CallStatus.Success },
    });
    expect(notificationUpdate()["data"]).toEqual({ statusMessage: message });
  });
});

describe("what is never written over", () => {
  test.each([
    UserNotificationStatus.Acknowledged,
    UserNotificationStatus.PassedOn,
    UserNotificationStatus.Skipped,
    UserNotificationStatus.Error,
    UserNotificationStatus.NotAnswered,
  ])(
    "a notification that is %s - the person pressed 1, escalated, or it says more already - keeps its status",
    async (status: UserNotificationStatus) => {
      notification!.status = status;

      await callback(ended("no-answer"));

      expect(writeCallLog).toHaveBeenCalledTimes(1);
      expect(updateNotification).not.toHaveBeenCalled();
    },
  );

  test("a call whose outcome is written already - Twilio sends a callback twice - changes nothing", async () => {
    callLog!.status = CallStatus.MissedCall;

    await callback(ended("no-answer"));

    expectNothingWritten();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("of two callbacks at once, the one whose write finds the log moved on stops there", async () => {
    writeCallLog.mockResolvedValue(false as never);

    await callback(ended("no-answer"));

    expect(findNotification).not.toHaveBeenCalled();
    expect(updateNotification).not.toHaveBeenCalled();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a call made for no on-call notification - a test call - writes its log alone", async () => {
    delete callLog!.userOnCallLogTimelineId;

    await callback(ended("busy"));

    expect(writeCallLog).toHaveBeenCalledTimes(1);
    expect(findNotification).not.toHaveBeenCalled();
    expect(updateNotification).not.toHaveBeenCalled();
  });

  test("a notification that is gone writes nothing more", async () => {
    notification = null;

    await callback(ended("busy"));

    expect(writeCallLog).toHaveBeenCalledTimes(1);
    expect(updateNotification).not.toHaveBeenCalled();
  });
});

describe("a status that is not how a call ended", () => {
  test.each(["queued", "ringing", "in-progress", "canceled", ""])(
    "'%s' is answered, and writes nothing",
    async (status: string) => {
      await callback(ended(status));

      expectNothingWritten();
      expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
    },
  );

  test("a callback with no body writes nothing", async () => {
    await callback(undefined as unknown as JSONObject);

    expectNothingWritten();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });
});

describe("the token is the route's lock", () => {
  test("a wrong token is refused with 403, and nothing is written", async () => {
    const answer: Answer = await callback(ended("no-answer"), {
      token: "6c0e0000-0000-4000-8000-0000000000f2",
    });

    expect(answer.status).toHaveBeenCalledWith(403);
    expect(answer.send).toHaveBeenCalledWith("Forbidden");
    expectNothingWritten();
    expect(sendEmptySuccess).not.toHaveBeenCalled();
  });

  test("a token of another length is refused the same way", async () => {
    const answer: Answer = await callback(ended("no-answer"), {
      token: "short",
    });

    expect(answer.status).toHaveBeenCalledWith(403);
    expectNothingWritten();
  });

  test("a log with no token - a call placed before calls named a callback - opens to no token", async () => {
    delete callLog!.statusCallbackToken;

    const answer: Answer = await callback(ended("no-answer"));

    expect(answer.status).toHaveBeenCalledWith(403);
    expectNothingWritten();
  });

  test("an unknown log is answered 200 - Twilio does not retry - and nothing is written", async () => {
    callLog = null;

    const answer: Answer = await callback(ended("no-answer"));

    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
    expect(answer.status).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  test("an id that is not one is a bad request, and nothing is read", async () => {
    await callback(ended("no-answer"), { callLogId: "not-an-id" });

    expect(findCallLog).not.toHaveBeenCalled();
    expect(sendError).toHaveBeenCalledTimes(1);

    const error: unknown = sendError.mock.calls[0]![2];

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(
      "Invalid status callback URL",
    );
  });

  test("an empty token is a bad request too", async () => {
    await callback(ended("no-answer"), { token: "" });

    expect(findCallLog).not.toHaveBeenCalled();
    expect(sendError).toHaveBeenCalledTimes(1);
  });
});

describe("a failure", () => {
  test("is handed to Express, and nothing is half written", async () => {
    findCallLog.mockRejectedValue(new Error("connection reset") as never);

    const answer: Answer = await callback(ended("no-answer"));

    expect(answer.next).toHaveBeenCalledTimes(1);
    expect((answer.next.mock.calls[0]![0] as Error).message).toBe(
      "connection reset",
    );
    expectNothingWritten();
  });
});
