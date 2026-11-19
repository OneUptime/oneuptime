import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";

/*
 * POST /notification/sms/status-callback/:smsLogId/:token - HOW AN SMS
 * ENDED, AS TWILIO TELLS IT, FOR THE PLATFORM'S OPERATOR (issue #6648).
 *
 * Twilio calls each SMS's status callback as the message moves on - queued,
 * sent, then delivered, undelivered or failed - sometimes twice, sometimes
 * out of order, sometimes two at once. The route writes the status on the
 * SMS's own log, only while the log still says what the callback read (a
 * compare-and-set: one that finds it changed reads it again and decides
 * again), and never lets a status still on the way overwrite a final one.
 *
 * The log is the record of truth: the moment it moves into a final status
 * is when the SMS is counted, once - notification.delivery.count, delivered,
 * undelivered or failed - and timed from the log being written, just before
 * Twilio accepted it (notification.delivery.duration). On the account it
 * went out on (the callback's ?providerConfig) and as an on-call page when
 * its log names one, as notification.send.count said them.
 *
 * An on-call page's SMS that Twilio could not deliver says so on the
 * person's on-call timeline: its notification becomes an Error, with
 * Twilio's words - only while it still says Sent or Sending, checked in the
 * same statement as the write (OnCallNotificationStatus), so an
 * acknowledgement or a skip is never written over (issue #6683).
 *
 * The route is a public webhook, held to two locks (#9979): the SMS's own
 * token in its URL, which says which SMS it is about, and Twilio's
 * signature, made with the auth token of the account the SMS went out on -
 * the project's own Twilio config or the OneUptime server's - by Twilio's own
 * algorithm (getExpectedTwilioSignature) over the public URL Twilio was
 * given, behind the ingress's rewrite. A request that fails either leaves
 * the log, the page and the count as they were, and is logged with why -
 * never the token, an auth token or a whole account SID.
 *
 * The database is stood in for by one row the route reads and writes the
 * way Postgres would: a read is a snapshot, a write only lands while the
 * row still holds what it expects. The page's notification likewise
 * (OnCallTimelineRows). The metrics SDK is stood in for, and keeps what it
 * is given.
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
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(),
      toTwilioConfig: jest.fn(),
    },
  };
});

// The server's own Twilio account, as its settings hold it (TwilioWebhookSignature).
jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/SmsLogService", () => {
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

import SmsLogService from "Common/Server/Services/SmsLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import Phone from "Common/Types/Phone";
import {
  serverTwilioRow,
  signedTwilioRequest,
} from "Common/Tests/Server/TestingUtils/TwilioSignedRequests";
import {
  isStaleSmsStatus,
  MAX_STATUS_WRITE_ATTEMPTS,
  SMS_LOG_STATUS_CALLBACK_SELECT,
} from "../../FeatureSet/Notification/API/SMS";

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
    route.method === "POST" && route.uri === "/status-callback/:smsLogId/:token"
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "5e5e0000-0000-4000-8000-0000000000a0",
);
const SMS_LOG_ID: ObjectID = new ObjectID(
  "5e5e0000-0000-4000-8000-0000000000a1",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "5e5e0000-0000-4000-8000-0000000000a2",
);
const TOKEN: string = "5e5e0000-0000-4000-8000-0000000000f1";
const MESSAGE_SID: string = "SM0123456789abcdef0123456789abcdef";
const TO_NUMBER: string = "+15555550123";

// The OneUptime server's own Twilio account, which sends an SMS unless the project has its own.
const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "server-auth-token-0000000000000001",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

// The project's own Twilio config.
const PROJECT_ACCOUNT: TwilioConfig = {
  accountSid: "AC22222222222222222222222222222222",
  authToken: "project-auth-token-000000000000002",
  primaryPhoneNumber: new Phone("+14155550199"),
  secondaryPhoneNumbers: [],
};

// "Now", and the log written two and a half seconds before it.
const NOW: number = Date.UTC(2026, 10, 10, 12, 0, 0);
const WRITTEN_AGO_MS: number = 2500;

// The SMS log as the database holds it.
interface StoredLog {
  status: SmsStatus | null;
  statusMessage?: string | undefined;
  errorCode?: string | undefined;
  statusCallbackToken?: string | undefined;
  userOnCallLogTimelineId?: ObjectID | undefined;
  createdAt?: Date | undefined;
}

let stored: StoredLog | null;

const findSmsLog: jest.Mock = SmsLogService.findOneById as jest.Mock;
const writeSmsLog: jest.Mock =
  SmsLogService.compareAndSetColumnsByIdWithoutHooks as jest.Mock;
const findTimeline: jest.Mock =
  UserOnCallLogTimelineService.findOneById as jest.Mock;
const updateTimeline: jest.Mock =
  UserOnCallLogTimelineService.updateOneBy as jest.Mock;
const sendEmptySuccess: jest.Mock =
  Response.sendEmptySuccessResponse as jest.Mock;
const warn: jest.Mock = logger.warn as jest.Mock;
const findConfigs: jest.Mock = ProjectCallSMSConfigService.findBy as jest.Mock;
const toTwilioConfig: jest.Mock =
  ProjectCallSMSConfigService.toTwilioConfig as jest.Mock;
const findGlobalConfig: jest.Mock = GlobalConfigService.findOneBy as jest.Mock;

// The project's own Twilio configs, each with the account it reads as.
let projectConfigs: Array<{ row: ProjectCallSMSConfig; account: TwilioConfig }>;

// A project's own Twilio config on an account.
function addProjectConfig(account: TwilioConfig): void {
  const row: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  row.id = ObjectID.generate();
  row.projectId = PROJECT_ID;
  row.twilioAccountSID = account.accountSid;
  projectConfigs.push({ row: row, account: account });
}

// The page's notification, as the person's on-call timeline holds it.
let timeline: OnCallTimelineRows;

// A read: the row as it is now, as the route's select returns it.
function snapshot(): SmsLog | null {
  if (!stored) {
    return null;
  }

  const log: SmsLog = new SmsLog();
  log.id = SMS_LOG_ID;
  log.projectId = PROJECT_ID;

  if (stored.status !== null) {
    log.status = stored.status;
  }

  if (stored.statusCallbackToken) {
    log.statusCallbackToken = stored.statusCallbackToken;
  }

  if (stored.userOnCallLogTimelineId) {
    log.userOnCallLogTimelineId = stored.userOnCallLogTimelineId;
  }

  if (stored.createdAt) {
    log.createdAt = stored.createdAt;
  }

  return log;
}

// A write that lands only while the row holds what it expects, as Postgres's would.
function compareAndSet(input: {
  id: ObjectID;
  data: Partial<StoredLog>;
  expectedData: { status: SmsStatus | null };
}): boolean {
  if (!stored || stored.status !== input.expectedData.status) {
    return false;
  }

  stored = { ...stored, ...input.data };

  return true;
}

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

// How Twilio signs a callback: on the server's account, over what it posted, unless said.
interface Signing {
  // The account whose SID the request names.
  account?: TwilioConfig | undefined;
  // The auth token it is signed with - the account's unless said - or null for none.
  signedWith?: string | null | undefined;
  // What Twilio signed, when the body changed on the way.
  signedBody?: JSONObject | undefined;
}

// Twilio's parameters as it posts them: text, with the account they are about.
function posted(
  account: TwilioConfig,
  body: JSONObject,
): Record<string, string> {
  const parameters: Record<string, string> = {
    AccountSid: account.accountSid,
  };

  for (const [key, value] of Object.entries(body)) {
    parameters[key] = String(value);
  }

  return parameters;
}

/*
 * Twilio calling the SMS's status callback: posted to the public URL it was
 * given - the log's id and token, the query - and signed over it.
 */
async function callback(
  body: JSONObject,
  query: JSONObject = {},
  params: { smsLogId?: string; token?: string } = {},
  signing: Signing = {},
): Promise<Answer> {
  const account: TwilioConfig = signing.account || SERVER_ACCOUNT;
  const smsLogId: string = params.smsLogId ?? SMS_LOG_ID.toString();
  const token: string = params.token ?? TOKEN;
  const search: string = Object.keys(query).length
    ? `?${new URLSearchParams(query as Record<string, string>).toString()}`
    : "";

  const req: ExpressRequest = signedTwilioRequest({
    publicUrl: `/notification/sms/status-callback/${smsLogId}/${token}${search}`,
    body: posted(account, body),
    signedWith:
      signing.signedWith === undefined ? account.authToken : signing.signedWith,
    signedBody: signing.signedBody
      ? posted(account, signing.signedBody)
      : undefined,
    params: { smsLogId: smsLogId, token: token },
  }) as unknown as ExpressRequest;

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

function twilio(messageStatus: string, more: JSONObject = {}): JSONObject {
  return {
    MessageSid: MESSAGE_SID,
    MessageStatus: messageStatus,
    To: TO_NUMBER,
    ...more,
  };
}

function expectNothingCounted(): void {
  expect(deliveryCounterCalls).toEqual([]);
  expect(deliveryDurationCalls).toEqual([]);
}

function onlyDelivery(): Record<string, string> {
  expect(deliveryCounterCalls).toHaveLength(1);
  expect(deliveryCounterCalls[0]!.value).toBe(1);

  return deliveryCounterCalls[0]!.attributes;
}

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

  // An on-call page's SMS, written as it was handed to Twilio (SmsService).
  stored = {
    status: SmsStatus.Sending,
    statusCallbackToken: TOKEN,
    userOnCallLogTimelineId: TIMELINE_ID,
    createdAt: new Date(NOW - WRITTEN_AGO_MS),
  };

  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sent);

  findSmsLog.mockImplementation((() => {
    return Promise.resolve(snapshot());
  }) as never);
  writeSmsLog.mockImplementation(((input: {
    id: ObjectID;
    data: Partial<StoredLog>;
    expectedData: { status: SmsStatus | null };
  }) => {
    return Promise.resolve(compareAndSet(input));
  }) as never);
  timeline.standIn(UserOnCallLogTimelineService);

  findGlobalConfig.mockResolvedValue(serverTwilioRow(SERVER_ACCOUNT) as never);
  projectConfigs = [];
  findConfigs.mockImplementation((async () => {
    return projectConfigs.map(
      (config: { row: ProjectCallSMSConfig }): ProjectCallSMSConfig => {
        return config.row;
      },
    );
  }) as never);
  toTwilioConfig.mockImplementation(((row: ProjectCallSMSConfig) => {
    return projectConfigs.find(
      (config: { row: ProjectCallSMSConfig }): boolean => {
        return config.row === row;
      },
    )?.account;
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the route", () => {
  test("is registered, with nothing in front of it: Twilio signs in as nobody", () => {
    expect(ROUTE).toBeDefined();
    expect(ROUTE!.middlewares).toEqual([]);
  });

  test("reads the log as root, with what deciding and counting the status needs - nothing more", async () => {
    await callback(twilio("delivered"));

    expect(SMS_LOG_STATUS_CALLBACK_SELECT).toEqual({
      _id: true,
      // Whose Twilio configs may have signed the callback.
      projectId: true,
      status: true,
      statusCallbackToken: true,
      userOnCallLogTimelineId: true,
      createdAt: true,
    });
    expect(findSmsLog).toHaveBeenCalledWith({
      id: SMS_LOG_ID,
      select: SMS_LOG_STATUS_CALLBACK_SELECT,
      props: { isRoot: true },
    });
  });

  test("writes the status only while the log still says what was read", async () => {
    await callback(twilio("delivered", { ErrorCode: "" }));

    expect(writeSmsLog).toHaveBeenCalledTimes(1);
    expect(writeSmsLog.mock.calls[0]![0]).toEqual({
      id: SMS_LOG_ID,
      data: {
        status: SmsStatus.Delivered,
        statusMessage: `Delivery status: ${SmsStatus.Delivered}. Message ID: ${MESSAGE_SID}.`,
      },
      expectedData: { status: SmsStatus.Sending },
    });
    expect(stored!.status).toBe(SmsStatus.Delivered);
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a log with no status yet is expected to have none still", async () => {
    stored!.status = null;

    await callback(twilio("sent"));

    expect(writeSmsLog.mock.calls[0]![0]).toMatchObject({
      expectedData: { status: null },
    });
    expect(stored!.status).toBe(SmsStatus.Sent);
  });

  test("tries a write at most three times", () => {
    expect(MAX_STATUS_WRITE_ATTEMPTS).toBe(3);
  });
});

describe("the token and Twilio's signature lock the route (#9979)", () => {
  // What a refused callback leaves: the log, the page and the count as they were.
  function expectRefusedAsItWas(answer: Answer): void {
    expect(answer.status).toHaveBeenCalledWith(403);
    expect(answer.send).toHaveBeenCalledWith("Forbidden");
    expect(answer.next).not.toHaveBeenCalled();
    expect(sendEmptySuccess).not.toHaveBeenCalled();
    expect(writeSmsLog).not.toHaveBeenCalled();
    expect(stored!.status).toBe(SmsStatus.Sending);
    expect(stored!.statusMessage).toBeUndefined();
    expect(timeline.writes).toEqual([]);
    expect(timeline.get(TIMELINE_ID)!.status).toBe(UserNotificationStatus.Sent);
    expectNothingCounted();
  }

  test("the right token without Twilio's signature is refused", async () => {
    expectRefusedAsItWas(
      await callback(twilio("undelivered"), {}, {}, { signedWith: null }),
    );
  });

  test("the right token, signed with another auth token, is refused", async () => {
    expectRefusedAsItWas(
      await callback(
        twilio("undelivered"),
        {},
        {},
        { signedWith: "an-auth-token-nobody-here-holds" },
      ),
    );
  });

  test("a body changed on the way - delivered made undelivered - no longer matches the signature, and is refused", async () => {
    expectRefusedAsItWas(
      await callback(
        twilio("undelivered", { ErrorCode: "30003" }),
        {},
        {},
        { signedBody: twilio("delivered") },
      ),
    );
  });

  test("an account that sent none of this project's SMS is refused, even signed with its own auth token", async () => {
    addProjectConfig(PROJECT_ACCOUNT);

    const stranger: TwilioConfig = {
      ...PROJECT_ACCOUNT,
      accountSid: "AC33333333333333333333333333333333",
      authToken: "a-strangers-auth-token-00000000003",
    };

    expectRefusedAsItWas(
      await callback(twilio("undelivered"), {}, {}, { account: stranger }),
    );
  });

  test("the accounts tried are the SMS's own project's configs, read as root, and the server's", async () => {
    await callback(twilio("delivered"));

    expect(findConfigs).toHaveBeenCalledTimes(1);
    expect(
      ((findConfigs.mock.calls[0]![0] as JSONObject)["query"] as JSONObject)[
        "projectId"
      ],
    ).toEqual(PROJECT_ID);
    expect(
      (findConfigs.mock.calls[0]![0] as JSONObject)["props"] as JSONObject,
    ).toEqual({ isRoot: true });
  });

  test("signed by the server's own account: accepted, and the status written", async () => {
    const answer: Answer = await callback(twilio("delivered"));

    expect(answer.status).not.toHaveBeenCalled();
    expect(stored!.status).toBe(SmsStatus.Delivered);
    expect(onlyDelivery()["notification.provider.config"]).toBe("global");
  });

  test("signed by the project's own Twilio config: accepted, written, and counted as the project's", async () => {
    addProjectConfig(PROJECT_ACCOUNT);

    const answer: Answer = await callback(
      twilio("undelivered", { ErrorCode: "30003" }),
      { providerConfig: "project" },
      {},
      { account: PROJECT_ACCOUNT },
    );

    expect(answer.status).not.toHaveBeenCalled();
    expect(stored!.status).toBe(SmsStatus.Undelivered);
    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Error,
    );
    expect(onlyDelivery()["notification.provider.config"]).toBe("project");
    // The project's own config signed: the server's settings are not read.
    expect(findGlobalConfig).not.toHaveBeenCalled();
  });

  test("a refusal is logged with why - and never the token, an auth token or the whole account SID", async () => {
    await callback(
      twilio("undelivered"),
      { providerConfig: "project" },
      {},
      { signedWith: "an-auth-token-nobody-here-holds" },
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `Twilio callback refused: the SMS status callback for log ${SMS_LOG_ID.toString()}. Its X-Twilio-Signature does not match the one Twilio account AC…1111 makes for https://oneuptime.example.com/notification/sms/status-callback/${SMS_LOG_ID.toString()}/…?providerConfig=…`,
      ),
    );

    const logged: string = JSON.stringify(warn.mock.calls);

    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(SERVER_ACCOUNT.authToken);
    expect(logged).not.toContain(SERVER_ACCOUNT.accountSid);
  });
});

describe("how an SMS ended, for the platform's operator", () => {
  test("delivered: counted once, on the installation's account, as an on-call page - timed from its log", async () => {
    await callback(twilio("delivered"));

    expect(onlyDelivery()).toEqual({
      "notification.channel": "sms",
      "notification.provider": "twilio",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "delivered",
    });
    expect(onlyDeliveryTime()).toBe(WRITTEN_AGO_MS);
  });

  test.each([
    ["delivered", "delivered"],
    ["partially_delivered", "delivered"],
    ["undelivered", "undelivered"],
    ["failed", "failed"],
    ["canceled", "failed"],
    ["DELIVERED", "delivered"],
  ])(
    "Twilio's '%s' is counted as %s",
    async (twilioStatus: string, outcome: string) => {
      await callback(twilio(twilioStatus));

      expect(onlyDelivery()["outcome"]).toBe(outcome);
      expect(onlyDeliveryTime()).toBe(WRITTEN_AGO_MS);
    },
  );

  test("the status may come as SmsStatus, the field's older name", async () => {
    await callback({ MessageSid: MESSAGE_SID, SmsStatus: "undelivered" });

    expect(onlyDelivery()["outcome"]).toBe("undelivered");
  });

  test.each(["queued", "accepted", "scheduled", "sending", "sent"])(
    "'%s' - still on the way - is written, and not counted",
    async (twilioStatus: string) => {
      await callback(twilio(twilioStatus));

      expect(writeSmsLog).toHaveBeenCalledTimes(1);
      expectNothingCounted();
    },
  );

  test("a status not tracked (an inbound 'received') is neither written nor counted", async () => {
    await callback(twilio("received"));

    expect(writeSmsLog).not.toHaveBeenCalled();
    expectNothingCounted();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("an SMS on the project's own Twilio account - its callback says so - is the project's", async () => {
    await callback(twilio("delivered"), { providerConfig: "project" });

    expect(onlyDelivery()["notification.provider.config"]).toBe("project");
  });

  test.each(["global", "Project", "other", ""])(
    "a providerConfig of '%s' is the installation's",
    async (value: string) => {
      await callback(twilio("delivered"), { providerConfig: value });

      expect(onlyDelivery()["notification.provider.config"]).toBe("global");
    },
  );

  test("an SMS that was no on-call page - its log names none - says so", async () => {
    delete stored!.userOnCallLogTimelineId;

    await callback(twilio("delivered"));

    expect(onlyDelivery()["notification.on_call_page"]).toBe("false");
  });

  test("a log with no time it was written: counted, not timed", async () => {
    delete stored!.createdAt;

    await callback(twilio("delivered"));

    expect(onlyDelivery()["outcome"]).toBe("delivered");
    expect(deliveryDurationCalls).toEqual([]);
  });

  test("a log written 'after' its receipt - two clocks - is timed zero, never below", async () => {
    stored!.createdAt = new Date(NOW + 1000);

    await callback(twilio("delivered"));

    expect(onlyDeliveryTime()).toBe(0);
  });

  test("a log from before delivery receipts (Success) moving into a final status is counted", async () => {
    stored!.status = SmsStatus.Success;

    await callback(twilio("delivered"));

    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("never carries the number, the message's id, the log's, the token or the page's", async () => {
    await callback(twilio("undelivered", { ErrorCode: "30003" }));

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
      TO_NUMBER,
      MESSAGE_SID,
      SMS_LOG_ID.toString(),
      TIMELINE_ID.toString(),
      TOKEN,
      "30003",
    ]) {
      expect(values).not.toContain(value);
    }
  });
});

describe("each SMS is counted once - on its log's move into a final status", () => {
  test("Twilio's callback sent twice: written twice, counted once", async () => {
    await callback(twilio("delivered"));
    await callback(twilio("delivered"));

    expect(writeSmsLog).toHaveBeenCalledTimes(2);
    expect(stored!.status).toBe(SmsStatus.Delivered);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("sent, then delivered: counted once, when it was delivered", async () => {
    await callback(twilio("sent"));
    expectNothingCounted();

    await callback(twilio("delivered"));

    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("out of order - delivered, then sent: the late 'sent' is neither written nor counted", async () => {
    await callback(twilio("delivered"));
    await callback(twilio("sent"));

    expect(writeSmsLog).toHaveBeenCalledTimes(1);
    expect(stored!.status).toBe(SmsStatus.Delivered);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
    expect(sendEmptySuccess).toHaveBeenCalledTimes(2);
  });

  test("a final status after another - undelivered, then failed - is written, but the SMS was counted already", async () => {
    await callback(twilio("undelivered"));
    await callback(twilio("failed"));

    expect(stored!.status).toBe(SmsStatus.Failed);
    expect(onlyDelivery()["outcome"]).toBe("undelivered");
  });

  test("a log already final when the callback comes - Twilio's send said failed - is not counted again", async () => {
    stored!.status = SmsStatus.Failed;

    await callback(twilio("failed"));

    expectNothingCounted();
  });

  test("'delivered' and 'sent' at once: the delivered one counts, the other finds the log moved on and stops", async () => {
    await Promise.all([
      callback(twilio("delivered")),
      callback(twilio("sent")),
    ]);

    expect(stored!.status).toBe(SmsStatus.Delivered);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
    // The late one read the log again, and left it.
    expect(findSmsLog).toHaveBeenCalledTimes(3);
    expect(writeSmsLog).toHaveBeenCalledTimes(2);
  });

  test("'sent' and 'delivered' at once: the sent one lands first, the delivered one reads again, lands, and counts", async () => {
    await Promise.all([
      callback(twilio("sent")),
      callback(twilio("delivered")),
    ]);

    expect(stored!.status).toBe(SmsStatus.Delivered);
    expect(writeSmsLog).toHaveBeenCalledTimes(3);
    expect(writeSmsLog.mock.calls[2]![0]).toMatchObject({
      expectedData: { status: SmsStatus.Sent },
    });
    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("the same final status twice at once: one count", async () => {
    await Promise.all([
      callback(twilio("undelivered")),
      callback(twilio("undelivered")),
    ]);

    expect(stored!.status).toBe(SmsStatus.Undelivered);
    expect(onlyDelivery()["outcome"]).toBe("undelivered");
  });

  test("a log that keeps changing under every try: given up after three, answered 200, nothing counted", async () => {
    writeSmsLog.mockResolvedValue(false as never);

    await callback(twilio("delivered"));

    expect(writeSmsLog).toHaveBeenCalledTimes(MAX_STATUS_WRITE_ATTEMPTS);
    expect(findSmsLog).toHaveBeenCalledTimes(MAX_STATUS_WRITE_ATTEMPTS);
    expect(warn).toHaveBeenCalledWith(
      `SMS status callback could not write the delivery status of log ${SMS_LOG_ID.toString()}: it kept changing.`,
    );
    expectNothingCounted();
    expect(updateTimeline).not.toHaveBeenCalled();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a log gone when read again: answered 200, nothing more", async () => {
    writeSmsLog.mockImplementationOnce((() => {
      stored = null;
      return Promise.resolve(false);
    }) as never);

    await callback(twilio("undelivered"));

    expect(writeSmsLog).toHaveBeenCalledTimes(1);
    expectNothingCounted();
    expect(updateTimeline).not.toHaveBeenCalled();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a wrong token: refused with 403, nothing written or counted - even signed by Twilio, and before the signature is looked at", async () => {
    const answer: Answer = await callback(
      twilio("delivered"),
      {},
      { token: "5e5e0000-0000-4000-8000-0000000000f2" },
    );

    expect(answer.status).toHaveBeenCalledWith(403);
    expect(writeSmsLog).not.toHaveBeenCalled();
    expectNothingCounted();
    expect(findConfigs).not.toHaveBeenCalled();
    expect(findGlobalConfig).not.toHaveBeenCalled();
  });

  test("an unknown log: answered 200, nothing written or counted", async () => {
    stored = null;

    await callback(twilio("delivered"));

    expect(writeSmsLog).not.toHaveBeenCalled();
    expectNothingCounted();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });
});

describe("the on-call page an SMS was not delivered for", () => {
  test("still says so: the page's row becomes an error, after the SMS is counted", async () => {
    await callback(twilio("undelivered", { ErrorCode: "30003" }));

    expect(onlyDelivery()["outcome"]).toBe("undelivered");
    expect(timeline.writes).toEqual([
      {
        id: TIMELINE_ID.toString(),
        data: {
          status: UserNotificationStatus.Error,
          statusMessage: `Delivery status: ${SmsStatus.Undelivered}. Message ID: ${MESSAGE_SID}. Provider error code: 30003.`,
        },
      },
    ]);
  });

  test("written only while the page still says what was read: at its status and version", async () => {
    await callback(twilio("failed"));

    expect(findTimeline).toHaveBeenCalledWith({
      id: TIMELINE_ID,
      select: { _id: true, status: true, version: true },
      props: { isRoot: true },
    });
    expect(updateTimeline).toHaveBeenCalledTimes(1);
    expect(updateTimeline.mock.calls[0]![0]).toEqual({
      query: {
        _id: TIMELINE_ID.toString(),
        status: UserNotificationStatus.Sent,
        version: 1,
      },
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: `Delivery status: ${SmsStatus.Failed}. Message ID: ${MESSAGE_SID}.`,
      },
      props: { isRoot: true },
    });
  });

  test("a page still going out (Sending) is corrected too: the callback can land before the send's own write", async () => {
    timeline.get(TIMELINE_ID)!.status = UserNotificationStatus.Sending;

    await callback(twilio("failed"));

    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Error,
    );
  });

  test.each([
    UserNotificationStatus.Acknowledged,
    UserNotificationStatus.Skipped,
    UserNotificationStatus.PassedOn,
    UserNotificationStatus.Error,
  ])(
    "a page that is %s is never written over",
    async (status: UserNotificationStatus) => {
      timeline.get(TIMELINE_ID)!.status = status;

      await callback(twilio("failed"));

      expect(onlyDelivery()["outcome"]).toBe("failed");
      expect(updateTimeline).not.toHaveBeenCalled();
      expect(timeline.get(TIMELINE_ID)!.status).toBe(status);
    },
  );

  test("a page acknowledged between the read and the write stays acknowledged", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Acknowledged;
    });

    await callback(twilio("undelivered"));

    expect(timeline.writes).toEqual([]);
    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Acknowledged,
    );
    // It read the page again, found the acknowledgement, and stopped.
    expect(findTimeline).toHaveBeenCalledTimes(2);
  });

  test("a page written meanwhile with no news - its version moved, its status not - is read again and corrected", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.statusMessage = "Sent again.";
    });

    await callback(twilio("undelivered"));

    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Error,
    );
    expect(updateTimeline).toHaveBeenCalledTimes(2);
  });

  test("Twilio's failed callback sent twice: the page is written once", async () => {
    await callback(twilio("failed"));
    await callback(twilio("failed"));

    expect(timeline.writes).toHaveLength(1);
    expect(onlyDelivery()["outcome"]).toBe("failed");
  });

  test("undelivered, then failed: the page is written once, with the first", async () => {
    await callback(twilio("undelivered"));
    await callback(twilio("failed"));

    expect(timeline.writes).toHaveLength(1);
    expect(timeline.get(TIMELINE_ID)!.statusMessage).toBe(
      `Delivery status: ${SmsStatus.Undelivered}. Message ID: ${MESSAGE_SID}.`,
    );
  });

  test.each(["delivered", "sent", "queued"])(
    "'%s' changes no page",
    async (twilioStatus: string) => {
      await callback(twilio(twilioStatus));

      expect(findTimeline).not.toHaveBeenCalled();
      expect(timeline.writes).toEqual([]);
    },
  );

  test("an SMS of no page touches no notification", async () => {
    delete stored!.userOnCallLogTimelineId;

    await callback(twilio("failed"));

    expect(onlyDelivery()["notification.on_call_page"]).toBe("false");
    expect(findTimeline).not.toHaveBeenCalled();
  });

  test("a stale status the log refused leaves the page as it is", async () => {
    stored!.status = SmsStatus.Delivered;

    await callback(twilio("sent"));

    expect(findTimeline).not.toHaveBeenCalled();
    expect(updateTimeline).not.toHaveBeenCalled();
  });

  test("a page that cannot be written fails the callback after the SMS is counted", async () => {
    updateTimeline.mockRejectedValue(new Error("connection reset") as never);

    const answer: Answer = await callback(twilio("failed"));

    expect(onlyDelivery()["outcome"]).toBe("failed");
    expect(answer.next).toHaveBeenCalledTimes(1);
  });
});

describe("a callback Twilio sends again, after one the database failed for (issue #6874)", () => {
  /*
   * A failure is handed to Express, which answers 500, and the callback's
   * address asks Twilio to send it again on a 5xx (StatusCallbackRetry).
   * Sent again, it lands: the log is written by compare-and-set, the SMS is
   * counted once, and the page is corrected while it still says Sent.
   */
  const CONNECTION_RESET: Error = new Error("connection reset");

  test.each([
    [
      "reading the log",
      (): void => {
        findSmsLog.mockRejectedValueOnce(CONNECTION_RESET as never);
      },
    ],
    [
      "writing its status",
      (): void => {
        writeSmsLog.mockRejectedValueOnce(CONNECTION_RESET as never);
      },
    ],
  ])(
    "%s fails: the error goes to Express - nothing written or counted - and sent again, it lands once",
    async (_name: string, fail: () => void) => {
      fail();

      const first: Answer = await callback(twilio("delivered"));

      expect(first.next).toHaveBeenCalledTimes(1);
      expect(stored!.status).toBe(SmsStatus.Sending);
      expectNothingCounted();

      const second: Answer = await callback(twilio("delivered"));

      expect(second.next).not.toHaveBeenCalled();
      expect(stored!.status).toBe(SmsStatus.Delivered);
      expect(onlyDelivery()["outcome"]).toBe("delivered");
      expect(onlyDeliveryTime()).toBe(WRITTEN_AGO_MS);
      expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    [
      "writing it",
      (): void => {
        updateTimeline.mockRejectedValueOnce(CONNECTION_RESET as never);
      },
    ],
    [
      "reading it",
      (): void => {
        findTimeline.mockRejectedValueOnce(CONNECTION_RESET as never);
      },
    ],
  ])(
    "a failed page whose correction threw - %s - is corrected when Twilio sends the callback again, once, and the SMS counted once",
    async (_name: string, fail: () => void) => {
      fail();

      const first: Answer = await callback(
        twilio("undelivered", { ErrorCode: "30003" }),
      );

      expect(first.next).toHaveBeenCalledTimes(1);
      expect(stored!.status).toBe(SmsStatus.Undelivered);
      expect(timeline.get(TIMELINE_ID)!.status).toBe(
        UserNotificationStatus.Sent,
      );
      expect(onlyDelivery()["outcome"]).toBe("undelivered");

      const second: Answer = await callback(
        twilio("undelivered", { ErrorCode: "30003" }),
      );

      expect(second.next).not.toHaveBeenCalled();
      expect(timeline.writes).toEqual([
        {
          id: TIMELINE_ID.toString(),
          data: {
            status: UserNotificationStatus.Error,
            statusMessage: `Delivery status: ${SmsStatus.Undelivered}. Message ID: ${MESSAGE_SID}. Provider error code: 30003.`,
          },
        },
      ]);
      expect(onlyDelivery()["outcome"]).toBe("undelivered");

      // And Twilio's own duplicate after it: the page is corrected already.
      await callback(twilio("undelivered", { ErrorCode: "30003" }));

      expect(timeline.writes).toHaveLength(1);
      expect(onlyDelivery()["outcome"]).toBe("undelivered");
      expect(sendEmptySuccess).toHaveBeenCalledTimes(2);
    },
  );

  test("a page the person acknowledged before Twilio sent the callback again stays acknowledged", async () => {
    updateTimeline.mockRejectedValueOnce(CONNECTION_RESET as never);

    await callback(twilio("failed"));

    timeline.get(TIMELINE_ID)!.status = UserNotificationStatus.Acknowledged;

    const second: Answer = await callback(twilio("failed"));

    expect(second.next).not.toHaveBeenCalled();
    expect(timeline.writes).toEqual([]);
    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Acknowledged,
    );
  });
});

describe("isStaleSmsStatus", () => {
  const FINAL: Array<SmsStatus> = [
    SmsStatus.Delivered,
    SmsStatus.Undelivered,
    SmsStatus.Failed,
  ];
  const ON_THE_WAY: Array<SmsStatus> = [SmsStatus.Sending, SmsStatus.Sent];

  function pairs(
    currents: Array<SmsStatus>,
    nexts: Array<SmsStatus>,
  ): Array<[SmsStatus, SmsStatus]> {
    return currents.flatMap((current: SmsStatus) => {
      return nexts.map((next: SmsStatus): [SmsStatus, SmsStatus] => {
        return [current, next];
      });
    });
  }

  test.each(pairs(FINAL, ON_THE_WAY))(
    "%s, then %s: stale",
    (current: SmsStatus, next: SmsStatus) => {
      expect(isStaleSmsStatus({ current, next })).toBe(true);
    },
  );

  test.each(pairs(FINAL, FINAL))(
    "%s, then %s: written",
    (current: SmsStatus, next: SmsStatus) => {
      expect(isStaleSmsStatus({ current, next })).toBe(false);
    },
  );

  const NOTHING_FINAL_YET: Array<[SmsStatus | null | undefined, SmsStatus]> = [
    [null, SmsStatus.Sent],
    [undefined, SmsStatus.Delivered],
    [SmsStatus.Sending, SmsStatus.Sent],
    [SmsStatus.Sent, SmsStatus.Sending],
    [SmsStatus.Sent, SmsStatus.Delivered],
    [SmsStatus.Success, SmsStatus.Sent],
    [SmsStatus.Error, SmsStatus.Delivered],
  ];

  test.each(NOTHING_FINAL_YET)(
    "%s, then %s: not stale - the log said nothing final",
    (current: SmsStatus | null | undefined, next: SmsStatus) => {
      expect(isStaleSmsStatus({ current, next })).toBe(false);
    },
  );
});
