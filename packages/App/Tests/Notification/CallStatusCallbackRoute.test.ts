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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

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
 *
 * How it ended is counted for the platform's operator, too (#6648):
 * notification.delivery.count - answered, not answered or failed - and
 * notification.delivery.duration, from Twilio accepting the call to the
 * moment it was picked up, or to its end when nobody did. Once a call: only
 * the callback that wrote the log's outcome counts it. On the account the
 * call went out on (the callback's ?providerConfig) and as an on-call page
 * when its log names one, as notification.send.count said them. The
 * metrics SDK is stood in for, and keeps what it is given.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const deliveryCounterCalls: Array<RecordedCall> = [];
const deliveryDurationCalls: Array<RecordedCall> = [];

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationDeliveryCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            deliveryCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDeliveryDuration: () => {
        return {
          record: (value: number, attributes: Record<string, string>): void => {
            deliveryDurationCalls.push({ value, attributes });
          },
        };
      },
    },
  };
});

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
    default: { findOneById: jest.fn(), updateOneBy: jest.fn() },
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
const CALLED_NUMBER: string = "+15555550142";

// What the call's log says once Twilio accepted the call (CallService).
const PLACED_MESSAGE: string = `Call ID: ${CALL_SID}`;

// "Now", and the call placed a minute and a half before it.
const NOW: number = Date.UTC(2026, 10, 10, 12, 0, 0);
const PLACED_AGO_MS: number = 90 * 1000;

const findCallLog: jest.Mock = CallLogService.findOneById as jest.Mock;
const writeCallLog: jest.Mock =
  CallLogService.compareAndSetColumnsByIdWithoutHooks as jest.Mock;
const findNotification: jest.Mock =
  UserOnCallLogTimelineService.findOneById as jest.Mock;
/*
 * The notification is written only while it still says what was read, at
 * the version read (OnCallNotificationStatus): an update that names it so.
 */
const updateNotification: jest.Mock =
  UserOnCallLogTimelineService.updateOneBy as jest.Mock;
const sendEmptySuccess: jest.Mock =
  Response.sendEmptySuccessResponse as jest.Mock;
const sendError: jest.Mock = Response.sendErrorResponse as jest.Mock;

let callLog: CallLog | null;
let notification: UserOnCallLogTimeline | null;

/*
 * Typed as what jest.fn() from @jest/globals makes (jest-mock's Mock): the
 * global jest.Mock App's tsc reads is @types/jest 29's, with members
 * jest-mock 28's Mock lacks.
 */
interface Answer {
  status: Mock;
  send: Mock;
  next: Mock;
}

async function callback(
  body: JSONObject,
  params: { callLogId?: string; token?: string } = {},
  query: JSONObject = {},
): Promise<Answer> {
  const req: ExpressRequest = {
    params: {
      callLogId: params.callLogId ?? CALL_LOG_ID.toString(),
      token: params.token ?? TOKEN,
    },
    query: query,
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const send: Mock = jest.fn();
  const status: Mock = jest.fn();
  const res: ExpressResponse = {
    send: send,
    json: jest.fn(),
    status: status,
  } as unknown as ExpressResponse;
  status.mockReturnValue(res);

  const next: Mock = jest.fn();

  await ROUTE!.handlerFunction(req, res, next as unknown as NextFunction);

  return { status: status, send: send, next: next };
}

function ended(callStatus: string, more: JSONObject = {}): JSONObject {
  return {
    CallSid: CALL_SID,
    CallStatus: callStatus,
    To: CALLED_NUMBER,
    ...more,
  };
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

function expectNothingCounted(): void {
  expect(deliveryCounterCalls).toEqual([]);
  expect(deliveryDurationCalls).toEqual([]);
}

// The one final status counted, with its attributes.
function onlyDelivery(): Record<string, string> {
  expect(deliveryCounterCalls).toHaveLength(1);
  expect(deliveryCounterCalls[0]!.value).toBe(1);

  return deliveryCounterCalls[0]!.attributes;
}

// The one time recorded, under the same attributes as its count.
function onlyDeliveryTime(): number {
  expect(deliveryDurationCalls).toHaveLength(1);
  expect(deliveryDurationCalls[0]!.attributes).toEqual(onlyDelivery());

  return deliveryDurationCalls[0]!.value;
}

beforeEach(() => {
  jest.clearAllMocks();
  deliveryCounterCalls.length = 0;
  deliveryDurationCalls.length = 0;

  // Only Date is stood in for: the route's promises run as they do.
  jest.useFakeTimers({
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  jest.setSystemTime(NOW);

  callLog = new CallLog();
  callLog.id = CALL_LOG_ID;
  callLog.status = CallStatus.Success;
  callLog.statusMessage = PLACED_MESSAGE;
  callLog.statusCallbackToken = TOKEN;
  callLog.userOnCallLogTimelineId = NOTIFICATION_ID;
  callLog.createdAt = new Date(NOW - PLACED_AGO_MS);

  notification = new UserOnCallLogTimeline();
  notification.id = NOTIFICATION_ID;
  notification.status = UserNotificationStatus.Sent;
  notification.version = 7;

  findCallLog.mockImplementation((async () => {
    return callLog;
  }) as never);
  writeCallLog.mockResolvedValue(true as never);
  findNotification.mockImplementation((async () => {
    return notification;
  }) as never);
  updateNotification.mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.useRealTimers();
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
        statusMessage: true,
        statusCallbackToken: true,
        userOnCallLogTimelineId: true,
        createdAt: true,
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
      expectedData: {
        status: CallStatus.Success,
        statusMessage: PLACED_MESSAGE,
      },
    });
    expect(notificationUpdate()).toEqual({
      query: {
        _id: NOTIFICATION_ID.toString(),
        status: UserNotificationStatus.Sent,
        version: 7,
      },
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

  test("written only while the notification still says what was read: at its status and version", async () => {
    await callback(ended("no-answer"));

    expect(notificationUpdate()["query"]).toEqual({
      _id: NOTIFICATION_ID.toString(),
      status: UserNotificationStatus.Sent,
      version: 7,
    });
    expect(notificationUpdate()["props"]).toEqual({ isRoot: true });
  });

  test("an answer - pressing 1 - landing between the read and the write stays: read again, and left", async () => {
    const answered: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    answered.id = NOTIFICATION_ID;
    answered.status = UserNotificationStatus.Acknowledged;
    answered.version = 8;

    findNotification
      .mockResolvedValueOnce(notification as never)
      .mockResolvedValueOnce(answered as never);
    // The version read moved on: the update names no row.
    updateNotification.mockResolvedValueOnce(0 as never);

    await callback(ended("no-answer"));

    expect(findNotification).toHaveBeenCalledTimes(2);
    expect(updateNotification).toHaveBeenCalledTimes(1);
    expect(onlyDelivery()["outcome"]).toBe("not_answered");
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
      expectedData: {
        status: CallStatus.Success,
        statusMessage: PLACED_MESSAGE,
      },
    });
    expect(notificationUpdate()["data"]).toEqual({ statusMessage: message });
  });

  test("a log placed with no message is expected to have none still", async () => {
    delete callLog!.statusMessage;

    await callback(ended("completed", { CallDuration: "42" }));

    expect(logWrite()["expectedData"]).toEqual({
      status: CallStatus.Success,
      statusMessage: null,
    });
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

  test("an answered call's callback sent twice finds its end written already, and changes nothing", async () => {
    callLog!.statusMessage = `Call ID: ${CALL_SID}. The call was answered and lasted 42 seconds.`;

    await callback(ended("completed", { CallDuration: "42" }));

    expectNothingWritten();
    expect(findNotification).not.toHaveBeenCalled();
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
    expectNothingCounted();
  });
});

describe("how the call ended, for the platform's operator (#6648)", () => {
  test("rang out: not answered, on-call page, the installation's account - timed to its end", async () => {
    await callback(ended("no-answer"));

    expect(onlyDelivery()).toEqual({
      "notification.channel": "call",
      "notification.provider": "twilio",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "not_answered",
    });
    expect(onlyDeliveryTime()).toBe(PLACED_AGO_MS);
  });

  test("busy - or declined: not answered", async () => {
    await callback(ended("busy"));

    expect(onlyDelivery()["outcome"]).toBe("not_answered");
    expect(onlyDeliveryTime()).toBe(PLACED_AGO_MS);
  });

  test("could not be connected: failed", async () => {
    await callback(ended("failed"));

    expect(onlyDelivery()["outcome"]).toBe("failed");
    expect(onlyDeliveryTime()).toBe(PLACED_AGO_MS);
  });

  test("answered: timed to the moment it was picked up - its end, less how long it lasted", async () => {
    await callback(ended("completed", { CallDuration: "42" }));

    expect(onlyDelivery()["outcome"]).toBe("answered");
    expect(onlyDeliveryTime()).toBe(PLACED_AGO_MS - 42 * 1000);
  });

  test("answered, with no duration Twilio said: counted, not timed - when it was picked up is not known", async () => {
    await callback(ended("completed"));

    expect(onlyDelivery()["outcome"]).toBe("answered");
    expect(deliveryDurationCalls).toEqual([]);
  });

  test("answered, lasting longer than the log says it was placed ago - two clocks - is timed zero, never below", async () => {
    await callback(ended("completed", { CallDuration: "600" }));

    expect(onlyDeliveryTime()).toBe(0);
  });

  test("a log with no time it was written: counted, not timed", async () => {
    delete callLog!.createdAt;

    await callback(ended("no-answer"));

    expect(onlyDelivery()["outcome"]).toBe("not_answered");
    expect(deliveryDurationCalls).toEqual([]);
  });

  test("a call on the project's own Twilio account - its callback says so - is the project's", async () => {
    await callback(
      ended("no-answer"),
      {},
      {
        providerConfig: "project",
      },
    );

    expect(onlyDelivery()["notification.provider.config"]).toBe("project");
  });

  test.each(["global", "PROJECT", "anything", ""])(
    "a providerConfig of '%s' is the installation's",
    async (value: string) => {
      await callback(ended("no-answer"), {}, { providerConfig: value });

      expect(onlyDelivery()["notification.provider.config"]).toBe("global");
    },
  );

  test("a call made for no on-call notification - a test call - is not an on-call page", async () => {
    delete callLog!.userOnCallLogTimelineId;

    await callback(ended("busy"));

    expect(onlyDelivery()["notification.on_call_page"]).toBe("false");
  });

  test("counted with the log written, before the notification is read - a notification that cannot be read still leaves it counted", async () => {
    findNotification.mockRejectedValue(new Error("connection reset") as never);

    const answer: Answer = await callback(ended("no-answer"));

    expect(answer.next).toHaveBeenCalledTimes(1);
    expect(onlyDelivery()["outcome"]).toBe("not_answered");
  });

  test("never carries the number called, the call's id, its log's or its notification's", async () => {
    await callback(ended("completed", { CallDuration: "42" }));

    const attributes: Record<string, string> = onlyDelivery();

    expect(Object.keys(attributes).sort()).toEqual([
      "notification.channel",
      "notification.on_call_page",
      "notification.provider",
      "notification.provider.config",
      "outcome",
    ]);

    const values: string = JSON.stringify(attributes);

    for (const value of [
      CALLED_NUMBER,
      CALL_SID,
      CALL_LOG_ID.toString(),
      NOTIFICATION_ID.toString(),
      TOKEN,
    ]) {
      expect(values).not.toContain(value);
    }
  });
});

describe("each call is counted once", () => {
  test("a callback for a call whose outcome is written already counts nothing", async () => {
    callLog!.status = CallStatus.MissedCall;

    await callback(ended("no-answer"));

    expectNothingCounted();
  });

  test("an answered call's callback sent twice counts nothing the second time", async () => {
    callLog!.statusMessage = `Call ID: ${CALL_SID}. The call was answered and lasted 42 seconds.`;

    await callback(ended("completed", { CallDuration: "42" }));

    expectNothingCounted();
  });

  test("the callback whose write finds the log moved on - another wrote first - counts nothing", async () => {
    writeCallLog.mockResolvedValue(false as never);

    await callback(ended("no-answer"));

    expectNothingCounted();
  });

  test("two callbacks at once: the one that wrote counts it, the other nothing", async () => {
    writeCallLog
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never);

    await Promise.all([
      callback(ended("completed", { CallDuration: "42" })),
      callback(ended("completed", { CallDuration: "42" })),
    ]);

    expect(writeCallLog).toHaveBeenCalledTimes(2);
    expect(onlyDelivery()["outcome"]).toBe("answered");
    expect(onlyDeliveryTime()).toBe(PLACED_AGO_MS - 42 * 1000);
  });

  test("the same callback twice, the log written between them: one count", async () => {
    await callback(ended("no-answer"));

    // What the first wrote, as the second reads it.
    callLog!.status = CallStatus.MissedCall;
    callLog!.statusMessage = `Call ID: ${CALL_SID}. The call was not answered: it rang out.`;

    await callback(ended("no-answer"));

    expect(writeCallLog).toHaveBeenCalledTimes(1);
    expect(onlyDelivery()["outcome"]).toBe("not_answered");
  });

  test.each(["queued", "ringing", "in-progress", "canceled", ""])(
    "'%s' - not how a call ended - counts nothing",
    async (status: string) => {
      await callback(ended(status));

      expectNothingCounted();
    },
  );

  test("a callback with a wrong token counts nothing", async () => {
    await callback(ended("no-answer"), {
      token: "6c0e0000-0000-4000-8000-0000000000f2",
    });

    expectNothingCounted();
  });

  test("a callback for an unknown log counts nothing", async () => {
    callLog = null;

    await callback(ended("no-answer"));

    expectNothingCounted();
  });
});
