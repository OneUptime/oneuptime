import { mockRouter } from "Common/Tests/Server/API/Helpers";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import CustomChannelActionToken from "Common/Server/Utils/OnCall/CustomChannelActionToken";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
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
import Twilio from "twilio";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";

/*
 * TWILIO'S DELIVERY CALLBACK LANDING BEFORE THE SEND'S OWN WRITE (issues
 * #6682, #6683).
 *
 * An SMS's log is written Sending just before the SMS is handed to Twilio,
 * and the send writes what Twilio answered once messages.create returns.
 * Twilio calls the SMS's status callback as the message moves on - and can
 * do so within milliseconds, before messages.create has returned. The send
 * writes the log only while it still says Sending, so what the callback
 * wrote first - Delivered, say - stays: the SMS is not shown as only sent,
 * nor counted again when Twilio repeats the callback. What the SMS cost is
 * the send's alone, and is written either way.
 *
 * The page's notification on the person's on-call timeline likewise: the
 * send writes Sent over Sending only, so a callback that wrote first that
 * the SMS was not delivered keeps saying so, with Twilio's words.
 *
 * SmsService and the status callback route (API/SMS.ts) run as they are.
 * Twilio's client is stood in for: its messages.create calls the status
 * callback URL it was given - the route - before it answers, when a test
 * says so. The SMS log is a row in memory that both read and write the way
 * Postgres would (a write that expects a status lands only while the row
 * holds it), the page's notification likewise (OnCallTimelineRows). The
 * metrics SDK is stood in for, and keeps what it is given.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const deliveryCounterCalls: Array<RecordedCall> = [];
const deliveryDurationCalls: Array<RecordedCall> = [];

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return { record: (): void => {} };
      },
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

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: jest.fn(),
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
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
    EXTERNAL_FAULT: {},
  };
});

// Billing per test, and a host Twilio calls back on.
jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  mocked["Host"] = "oneuptime.example.com";

  return mocked;
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    SMSDefaultCostInCents: 10,
    SMSHighRiskCostInCents: 10,
    getTwilioConfig: jest.fn(),
    getCallAndSmsGateway: jest.fn(),
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
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneBy: jest.fn(),
      markNotSent: jest.fn(),
    },
  };
});

import SmsLogService from "Common/Server/Services/SmsLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import {
  getCallAndSmsGateway,
  getTwilioConfig,
} from "../../FeatureSet/Notification/Config";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
// The status callback route, registered on the router stood in for.
import "../../FeatureSet/Notification/API/SMS";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  handlerFunction: RouterFunction;
}

const ROUTE: RegisteredRoute | undefined = (
  mockRouter.routes as unknown as Array<RegisteredRoute>
).find((route: RegisteredRoute): boolean => {
  return (
    route.method === "POST" && route.uri === "/status-callback/:smsLogId/:token"
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "5c5c0000-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "5c5c0000-0000-4000-8000-000000000002",
);
const MESSAGE_SID: string = "SM5c5c0000000000000000000000000001";
const TO: Phone = new Phone("+15555550123");
const MESSAGE: string = "Incident Checkout down (Critical) on Site 03.";

const SERVER_TWILIO: TwilioConfig = {
  accountSid: "AC-server",
  authToken: "server-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

// The SMS log as the database holds it.
interface StoredSmsLog {
  id: ObjectID;
  status: SmsStatus | null;
  statusMessage?: string | undefined;
  errorCode?: string | undefined;
  smsCostInUSDCents?: number | undefined;
  statusCallbackToken?: string | undefined;
  userOnCallLogTimelineId?: ObjectID | undefined;
  createdAt: Date;
}

let logs: Array<StoredSmsLog>;
let timeline: OnCallTimelineRows;

// What Twilio calls back with before it answers messages.create, in order.
let callbacksBeforeAnswer: Array<[string, JSONObject?]>;

// What Twilio answers messages.create with.
let twilioAnswerStatus: string;

// The status callback URL each SMS was handed to Twilio with.
let statusCallbackUrls: Array<string>;

const sendEmptySuccess: Mock = (
  jest.requireMock("Common/Server/Utils/Response") as {
    default: { sendEmptySuccessResponse: Mock };
  }
).default.sendEmptySuccessResponse;

function onlyLog(): StoredSmsLog {
  expect(logs).toHaveLength(1);
  return logs[0]!;
}

function rowById(id: ObjectID): StoredSmsLog | undefined {
  return logs.find((row: StoredSmsLog): boolean => {
    return row.id.toString() === id.toString();
  });
}

// A read: the row as it is now, as the route's select returns it.
function snapshot(row: StoredSmsLog | undefined): SmsLog | null {
  if (!row) {
    return null;
  }

  const log: SmsLog = new SmsLog();
  log.id = row.id;

  if (row.status !== null) {
    log.status = row.status;
  }

  if (row.statusCallbackToken) {
    log.statusCallbackToken = row.statusCallbackToken;
  }

  if (row.userOnCallLogTimelineId) {
    log.userOnCallLogTimelineId = row.userOnCallLogTimelineId;
  }

  log.createdAt = row.createdAt;

  return log;
}

// A status callback URL's path: the SMS log's id and token, then its query.
const STATUS_CALLBACK_PATH: RegExp =
  /\/notification\/sms\/status-callback\/([^/?]+)\/([^/?]+)(?:\?(.*))?$/;

/*
 * Twilio calling the status callback URL the SMS was handed to it with, as
 * the route receives it: the log's id and token in the path, the account
 * it went out on in the query.
 */
async function twilioCallsBack(
  messageStatus: string,
  more: JSONObject = {},
): Promise<void> {
  const url: string | undefined =
    statusCallbackUrls[statusCallbackUrls.length - 1];
  expect(url).toBeDefined();

  const match: RegExpExecArray | null = STATUS_CALLBACK_PATH.exec(url!);
  expect(match).not.toBeNull();

  const query: JSONObject = {};
  new URLSearchParams(match![3] || "").forEach(
    (value: string, key: string): void => {
      query[key] = value;
    },
  );

  const req: ExpressRequest = {
    params: { smsLogId: match![1], token: match![2] },
    query: query,
    body: {
      MessageSid: MESSAGE_SID,
      MessageStatus: messageStatus,
      To: TO.toString(),
      ...more,
    },
    headers: {},
  } as unknown as ExpressRequest;

  const status: Mock = jest.fn();
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: status,
  } as unknown as ExpressResponse;
  status.mockReturnValue(res);

  const next: Mock = jest.fn();
  const answeredBefore: number = sendEmptySuccess.mock.calls.length;

  await ROUTE!.handlerFunction(req, res, next as unknown as NextFunction);

  // Answered 200: Twilio does not call back again for it.
  expect(next).not.toHaveBeenCalled();
  expect(status).not.toHaveBeenCalled();
  expect(sendEmptySuccess.mock.calls.length).toBe(answeredBefore + 1);
}

async function sendPage(): Promise<void> {
  await SmsService.sendSms(TO, MESSAGE, {
    projectId: PROJECT_ID,
    userOnCallLogTimelineId: TIMELINE_ID,
  });
}

function deliveries(): Array<string> {
  expect(deliveryDurationCalls).toHaveLength(deliveryCounterCalls.length);

  return deliveryCounterCalls.map((call: RecordedCall): string => {
    expect(call.value).toBe(1);
    return call.attributes["outcome"] || "";
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  sendCounterCalls.length = 0;
  deliveryCounterCalls.length = 0;
  deliveryDurationCalls.length = 0;
  setTestBillingEnabled(false);

  logs = [];
  callbacksBeforeAnswer = [];
  twilioAnswerStatus = "queued";
  statusCallbackUrls = [];

  (getCallAndSmsGateway as unknown as Mock).mockResolvedValue(null as never);
  (getTwilioConfig as unknown as Mock).mockResolvedValue(
    SERVER_TWILIO as never,
  );

  // Twilio: the callbacks a test asks for land before it answers the send.
  const createMessage: Mock = jest.fn(async (input: unknown) => {
    const statusCallback: string | undefined = (
      input as { statusCallback?: string }
    ).statusCallback;

    if (statusCallback) {
      statusCallbackUrls.push(statusCallback);
    }

    for (const [messageStatus, more] of callbacksBeforeAnswer) {
      await twilioCallsBack(messageStatus, more || {});
    }

    return { status: twilioAnswerStatus, sid: MESSAGE_SID };
  });

  (Twilio as unknown as Mock).mockImplementation(() => {
    return { messages: { create: createMessage } };
  });

  // The SMS log: one row, written as the send and the callbacks write it.
  (SmsLogService.create as unknown as Mock).mockImplementation(((input: {
    data: SmsLog;
  }) => {
    const row: StoredSmsLog = {
      id: ObjectID.generate(),
      status: input.data.status || null,
      statusMessage: input.data.statusMessage,
      errorCode: input.data.errorCode,
      smsCostInUSDCents: input.data.smsCostInUSDCents,
      statusCallbackToken: input.data.statusCallbackToken,
      userOnCallLogTimelineId: input.data.userOnCallLogTimelineId,
      createdAt: new Date(),
    };
    logs.push(row);

    const created: SmsLog = new SmsLog();
    created.id = row.id;
    return Promise.resolve(created);
  }) as never);

  (SmsLogService.findOneById as unknown as Mock).mockImplementation(((input: {
    id: ObjectID;
  }) => {
    return Promise.resolve(snapshot(rowById(input.id)));
  }) as never);

  // Lands only while the row holds the status it expects, as Postgres would.
  (
    SmsLogService.compareAndSetColumnsByIdWithoutHooks as unknown as Mock
  ).mockImplementation(((input: {
    id: ObjectID;
    data: Partial<StoredSmsLog>;
    expectedData: { status: SmsStatus | null };
  }) => {
    const row: StoredSmsLog | undefined = rowById(input.id);

    if (!row || row.status !== (input.expectedData.status ?? null)) {
      return Promise.resolve(false);
    }

    Object.assign(row, input.data);
    return Promise.resolve(true);
  }) as never);

  (
    SmsLogService.updateColumnsByIdWithoutHooks as unknown as Mock
  ).mockImplementation(((input: {
    id: ObjectID;
    data: Partial<StoredSmsLog>;
  }) => {
    const row: StoredSmsLog | undefined = rowById(input.id);

    if (row) {
      Object.assign(row, input.data);
    }

    return Promise.resolve(undefined);
  }) as never);

  // The page's notification, written Sending as its page went out.
  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
  (
    UserOnCallLogTimelineService.markNotSent as unknown as Mock
  ).mockResolvedValue(undefined as never);

  // A project that sends SMS, with balance to pay for them.
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme";
  project.enableSmsNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;
  project.lowCallAndSMSBalanceNotificationSentToOwners = true;
  project.notEnabledSmsOrCallNotificationSentToOwners = true;

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project as never);
  jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1 as never);
  jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(NotificationService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(10000 as never);
  jest
    .spyOn(MessagingBalance, "shouldTellOwnersBalanceIsLow")
    .mockResolvedValue(false as never);
  jest
    .spyOn(MessagingBalance, "payForSentMessage")
    .mockResolvedValue(0 as never);
  jest
    .spyOn(CustomChannelActionToken, "getActionLinks")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the route and the send", () => {
  test("the status callback route is registered", () => {
    expect(ROUTE).toBeDefined();
  });

  test("the SMS is handed to Twilio with its log's status callback, once the log is written", async () => {
    await sendPage();

    expect(statusCallbackUrls).toHaveLength(1);
    expect(statusCallbackUrls[0]).toMatch(
      /^https?:\/\/oneuptime\.example\.com\/notification\/sms\/status-callback\//,
    );
    expect(
      statusCallbackUrls[0]!.endsWith(
        `/${onlyLog().id.toString()}/${onlyLog().statusCallbackToken}`,
      ),
    ).toBe(true);
  });
});

describe("the ordinary order: the send's write, then Twilio's callbacks", () => {
  test("the log says what Twilio answered, then sent, then delivered - counted once", async () => {
    await sendPage();

    expect(onlyLog()).toMatchObject({
      status: SmsStatus.Sending,
      statusMessage: `Message ID: ${MESSAGE_SID}`,
    });

    await twilioCallsBack("sent");
    await twilioCallsBack("delivered");

    expect(onlyLog()).toMatchObject({
      status: SmsStatus.Delivered,
      statusMessage: `Delivery status: Delivered. Message ID: ${MESSAGE_SID}.`,
    });
    expect(deliveries()).toEqual(["delivered"]);
    expect(deliveryCounterCalls[0]!.attributes).toMatchObject({
      "notification.channel": "sms",
      "notification.provider": "twilio",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
    });
  });

  test("the page's notification says Sent, with the send's message", async () => {
    await sendPage();
    await twilioCallsBack("delivered");

    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Sent,
      statusMessage: `Message ID: ${MESSAGE_SID}`,
    });
  });
});

describe("delivered, before Twilio answered the send (issue #6682)", () => {
  beforeEach(() => {
    callbacksBeforeAnswer = [["delivered"]];
  });

  test("the log stays Delivered: the send does not put what Twilio answered back", async () => {
    await sendPage();

    expect(onlyLog().status).toBe(SmsStatus.Delivered);
  });

  test("its message stays the callback's, which names the message's id too", async () => {
    await sendPage();

    expect(onlyLog().statusMessage).toBe(
      `Delivery status: Delivered. Message ID: ${MESSAGE_SID}.`,
    );
  });

  test("counted once, as delivered - and Twilio repeating the callback counts nothing more", async () => {
    await sendPage();

    expect(deliveries()).toEqual(["delivered"]);

    await twilioCallsBack("delivered");
    await twilioCallsBack("delivered");

    expect(deliveries()).toEqual(["delivered"]);
    expect(onlyLog().status).toBe(SmsStatus.Delivered);
  });

  test("a late 'sent' - out of order - does not move it back", async () => {
    await sendPage();
    await twilioCallsBack("sent");

    expect(onlyLog().status).toBe(SmsStatus.Delivered);
    expect(deliveries()).toEqual(["delivered"]);
  });

  test("what the SMS cost is still written: the send's alone", async () => {
    setTestBillingEnabled(true);

    await sendPage();

    expect(onlyLog()).toMatchObject({
      status: SmsStatus.Delivered,
      smsCostInUSDCents: 10,
    });
    expect(MessagingBalance.payForSentMessage).toHaveBeenCalledTimes(1);
  });

  test("the page's notification moves on from Sending to Sent, with the send's message", async () => {
    await sendPage();

    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Sent,
      statusMessage: `Message ID: ${MESSAGE_SID}`,
    });
  });

  test("the send is counted once, as accepted", async () => {
    await sendPage();

    expect(sendCounterCalls).toHaveLength(1);
    expect(sendCounterCalls[0]!.attributes).toMatchObject({
      "notification.channel": "sms",
      outcome: "success",
    });
  });
});

describe("sent, before Twilio answered the send", () => {
  beforeEach(() => {
    callbacksBeforeAnswer = [["sent"]];
  });

  test("the log stays Sent - not Sending again - and a later delivered is counted once", async () => {
    await sendPage();

    expect(onlyLog()).toMatchObject({
      status: SmsStatus.Sent,
      statusMessage: `Delivery status: Sent. Message ID: ${MESSAGE_SID}.`,
    });
    expect(deliveries()).toEqual([]);

    await twilioCallsBack("delivered");
    await twilioCallsBack("delivered");

    expect(onlyLog().status).toBe(SmsStatus.Delivered);
    expect(deliveries()).toEqual(["delivered"]);
  });
});

describe("not delivered, before Twilio answered the send (issues #6682, #6683)", () => {
  beforeEach(() => {
    callbacksBeforeAnswer = [["undelivered", { ErrorCode: "30003" }]];
  });

  test("the log stays Undelivered, with Twilio's error code", async () => {
    await sendPage();

    expect(onlyLog()).toMatchObject({
      status: SmsStatus.Undelivered,
      statusMessage: `Delivery status: Undelivered. Message ID: ${MESSAGE_SID}. Provider error code: 30003.`,
      errorCode: "30003",
    });
    expect(deliveries()).toEqual(["undelivered"]);
  });

  test("the page's notification keeps the Error the callback wrote: the send does not put Sent back", async () => {
    await sendPage();

    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: `Delivery status: Undelivered. Message ID: ${MESSAGE_SID}. Provider error code: 30003.`,
    });
    // One write: the callback's.
    expect(timeline.writes).toEqual([
      {
        id: TIMELINE_ID.toString(),
        data: {
          status: UserNotificationStatus.Error,
          statusMessage: `Delivery status: Undelivered. Message ID: ${MESSAGE_SID}. Provider error code: 30003.`,
        },
      },
    ]);
  });

  test("Twilio repeating it writes the page's notification no more, and counts nothing more", async () => {
    await sendPage();
    await twilioCallsBack("undelivered", { ErrorCode: "30003" });

    expect(timeline.writes).toHaveLength(1);
    expect(deliveries()).toEqual(["undelivered"]);
  });
});

describe("the person acknowledged the page before the send's write", () => {
  test("their acknowledgement stays", async () => {
    timeline.get(TIMELINE_ID)!.status = UserNotificationStatus.Acknowledged;

    await sendPage();

    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Acknowledged,
    );
    expect(timeline.writes).toEqual([]);
  });

  test("and a failed delivery after it does not write over it either", async () => {
    timeline.get(TIMELINE_ID)!.status = UserNotificationStatus.Acknowledged;

    await sendPage();
    await twilioCallsBack("failed", { ErrorCode: "30008" });

    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Acknowledged,
    );
    expect(onlyLog().status).toBe(SmsStatus.Failed);
  });
});

describe("Twilio refusing the send", () => {
  test("the log and the page's notification say Error, as before", async () => {
    (Twilio as unknown as Mock).mockImplementation(() => {
      return {
        messages: {
          create: jest.fn(() => {
            return Promise.reject(
              Object.assign(
                new Error("The 'To' number is not a valid phone number."),
                { code: 21211 },
              ),
            );
          }),
        },
      };
    });

    await expect(sendPage()).rejects.toThrow(
      "The 'To' number is not a valid phone number.",
    );

    expect(onlyLog()).toMatchObject({
      status: SmsStatus.Error,
      errorCode: "21211",
    });
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
    });
  });
});
