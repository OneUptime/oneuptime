import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import CallStatus from "Common/Types/Call/CallStatus";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import { isErrorSentence } from "Common/Types/Exception/ErrorMessageRule";
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
 * POST /notification/call/amd-callback/:callLogId/:token - WHO ANSWERED AN
 * ON-CALL CALL, AS TWILIO'S ANSWERING MACHINE DETECTION TELLS IT (#6594).
 *
 * Every on-call call of a project that detects voicemail asks Twilio, in
 * the background, who answered it, and Twilio posts AnsweredBy here:
 *
 *   - the route is locked twice: the call's own token in its URL, as the
 *     status callback's is, and Twilio's signature, made with the auth token
 *     of the account the call went out on - the project's own Twilio config
 *     or the OneUptime server's. Signatures here are Twilio's own algorithm
 *     (getExpectedTwilioSignature) over the public URL Twilio was given,
 *     checked by the real TwilioWebhookSignature behind the ingress's
 *     rewrite, and a refusal is logged with why, nothing secret in it;
 *   - a person, or Twilio could not tell: nothing is written;
 *   - a voicemail at the end of its greeting: the live call is turned to the
 *     message kept for it, through the same account, and it ends - "a
 *     message was left", or "no message was left" when the call had ended;
 *     the call's log says Voicemail, and its on-call notification Not
 *     Answered, counted once as not answered;
 *   - a voicemail at the start of its greeting, or a fax machine: not
 *     answered, and nothing left;
 *   - once, and never over a person who pressed 1 or 2 on the call, nor over
 *     a call that ended otherwise;
 *   - in either order with the call's status callback, whose real route is
 *     driven here too.
 *
 * The database - the server's own Twilio settings among it - the metrics
 * SDK and Twilio's REST client are stood in for.
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

// The TwiML a voicemail is left with, as CallService builds it.
jest.mock("../../FeatureSet/Notification/Services/CallService", () => {
  return {
    __esModule: true,
    default: {
      makeCall: jest.fn(),
      generateVoicemailTwiml: (message: string): string => {
        return `<Response><Say>${message}</Say><Hangup/></Response>`;
      },
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

/*
 * Twilio's REST client is stood in for; its webhook signatures are its own.
 * TwilioCallProvider builds a real client to check a signature with.
 */
jest.mock("twilio", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "twilio",
  ) as Record<string, unknown>;
  const client: ((...args: Array<unknown>) => unknown) &
    Record<string, unknown> = jest.fn() as unknown as ((
    ...args: Array<unknown>
  ) => unknown) &
    Record<string, unknown>;
  client["Twilio"] = actual["Twilio"];
  client["twiml"] = actual["twiml"];

  return {
    __esModule: true,
    default: client,
    validateRequest: actual["validateRequest"],
    getExpectedTwilioSignature: actual["getExpectedTwilioSignature"],
  };
});

import CallLogService from "Common/Server/Services/CallLogService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import { serverTwilioRow } from "Common/Tests/Server/TestingUtils/TwilioSignedRequests";
import Twilio, { getExpectedTwilioSignature } from "twilio";
import "../../FeatureSet/Notification/API/Call";

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

function routeAt(uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((registered: RegisteredRoute): boolean => {
    return registered.method === "POST" && registered.uri === uri;
  });

  expect(route).toBeDefined();

  return route!;
}

const VOICEMAIL_ROUTE: RegisteredRoute = routeAt(
  "/amd-callback/:callLogId/:token",
);
const STATUS_ROUTE: RegisteredRoute = routeAt(
  "/status-callback/:callLogId/:token",
);

const PUBLIC_ORIGIN: string = "https://oneuptime.example.com";
const PROJECT_ID: ObjectID = new ObjectID(
  "6c0e0000-0000-4000-8000-0000000000e0",
);
const CALL_LOG_ID: ObjectID = new ObjectID(
  "6c0e0000-0000-4000-8000-0000000000e1",
);
const NOTIFICATION_ID: ObjectID = new ObjectID(
  "6c0e0000-0000-4000-8000-0000000000e2",
);
const TOKEN: string = "6c0e0000-0000-4000-8000-0000000000f1";
const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";

const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "server-auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const PROJECT_ACCOUNT: TwilioConfig = {
  accountSid: "AC22222222222222222222222222222222",
  authToken: "project-auth-token",
  primaryPhoneNumber: new Phone("+14155550199"),
  secondaryPhoneNumbers: [],
};

// What the call's log says once Twilio accepted the call (CallService).
const PLACED_MESSAGE: string = `Call ID: ${CALL_SID}`;

const KEPT_MESSAGE: string =
  "This is a call from One Uptime. A new incident has been created. Incident number 42, API is down. Open One Uptime to respond. Good bye.";

const LEFT: string = `Call ID: ${CALL_SID}. The call was not answered: it went to voicemail, and a message was left.`;
const NOT_LEFT: string = `Call ID: ${CALL_SID}. The call was not answered: it went to voicemail, and no message was left.`;
const FAX: string = `Call ID: ${CALL_SID}. The call was not answered: a fax machine picked up.`;

// "Now", and the call placed half a minute before it.
const NOW: number = Date.UTC(2026, 10, 19, 12, 0, 0);
const PLACED_AGO_MS: number = 30 * 1000;

interface StoredLog {
  status: CallStatus;
  statusMessage: string;
  callData: JSONObject;
}

let storedLog: StoredLog | null;
let timeline: OnCallTimelineRows;
let projectConfigs: Array<{ row: ProjectCallSMSConfig; account: TwilioConfig }>;
let callUpdates: Array<{
  accountSid: string;
  authToken: string;
  callSid: string;
  twiml: string;
}>;
// What jest.fn() from @jest/globals makes: jest-mock's Mock.
let updateCall: Mock;
// Something written between this route's read of the log and its write.
let onNextLogRead: ((log: StoredLog) => void) | null;

const findCallLog: jest.Mock = CallLogService.findOneById as jest.Mock;
const writeCallLog: jest.Mock =
  CallLogService.compareAndSetColumnsByIdWithoutHooks as jest.Mock;
const findConfigs: jest.Mock = ProjectCallSMSConfigService.findBy as jest.Mock;
const findGlobalConfig: jest.Mock = GlobalConfigService.findOneBy as jest.Mock;
const warn: jest.Mock = (
  jest.requireMock("Common/Server/Utils/Logger") as {
    default: { warn: jest.Mock };
  }
).default.warn;
const toTwilioConfig: jest.Mock =
  ProjectCallSMSConfigService.toTwilioConfig as jest.Mock;
const sendEmptySuccess: jest.Mock =
  Response.sendEmptySuccessResponse as jest.Mock;
const sendError: jest.Mock = Response.sendErrorResponse as jest.Mock;

interface Answer {
  status: Mock;
  send: Mock;
  next: Mock;
}

function readLog(): CallLog | null {
  if (!storedLog) {
    return null;
  }

  const log: CallLog = new CallLog();
  log.id = CALL_LOG_ID;
  log.projectId = PROJECT_ID;
  log.status = storedLog.status;
  log.statusMessage = storedLog.statusMessage;
  log.statusCallbackToken = TOKEN;
  log.userOnCallLogTimelineId = NOTIFICATION_ID;
  log.callData = { ...storedLog.callData } as never;
  log.createdAt = new Date(NOW - PLACED_AGO_MS);

  const change: ((log: StoredLog) => void) | null = onNextLogRead;
  onNextLogRead = null;

  if (change) {
    change(storedLog);
  }

  return log;
}

// The two callbacks' public addresses, as CallService gives them to Twilio.
function publicPath(
  route: "amd-callback" | "status-callback",
  params: { callLogId?: string; token?: string } = {},
): string {
  return `/notification/call/${route}/${params.callLogId ?? CALL_LOG_ID.toString()}/${params.token ?? TOKEN}`;
}

/*
 * A request as it reaches the route: Twilio posted it to the public URL it
 * was given, signed over that URL and every parameter, and the ingress
 * rewrote /notification to /api/notification and forwarded the public
 * scheme and host.
 */
function twilioRequest(data: {
  route: "amd-callback" | "status-callback";
  body: Record<string, string>;
  query?: Record<string, string> | undefined;
  params?: { callLogId?: string; token?: string } | undefined;
  signedWith?: string | null | undefined;
  signedBody?: Record<string, string> | undefined;
}): ExpressRequest {
  const query: Record<string, string> = data.query || {};
  const search: string = Object.keys(query).length
    ? `?${new URLSearchParams(query).toString()}`
    : "";
  const path: string = publicPath(data.route, data.params);
  const publicUrl: string = `${PUBLIC_ORIGIN}${path}${search}`;
  const signedWith: string | null =
    data.signedWith === undefined ? SERVER_ACCOUNT.authToken : data.signedWith;

  const headers: Record<string, string> = {
    host: "app:3002",
    "x-forwarded-proto": "https",
    "x-forwarded-host": "oneuptime.example.com",
    ...(signedWith !== null
      ? {
          "x-twilio-signature": getExpectedTwilioSignature(
            signedWith,
            publicUrl,
            data.signedBody || data.body,
          ),
        }
      : {}),
  };

  return {
    params: {
      callLogId: data.params?.callLogId ?? CALL_LOG_ID.toString(),
      token: data.params?.token ?? TOKEN,
    },
    query: query,
    body: data.body,
    headers: headers,
    protocol: "http",
    originalUrl: `/api${path}${search}`,
    url: `${path}${search}`,
    get: (name: string): string | undefined => {
      return headers[name.toLowerCase()];
    },
  } as unknown as ExpressRequest;
}

async function call(
  route: RegisteredRoute,
  req: ExpressRequest,
): Promise<Answer> {
  const send: Mock = jest.fn();
  const status: Mock = jest.fn();
  const res: ExpressResponse = {
    send: send,
    json: jest.fn(),
    status: status,
  } as unknown as ExpressResponse;
  status.mockReturnValue(res);

  const next: Mock = jest.fn();

  await route.handlerFunction(req, res, next as unknown as NextFunction);

  return { status: status, send: send, next: next };
}

// Twilio's answering machine verdict, on the server's account unless said.
async function answeredBy(
  value: string,
  more: {
    account?: TwilioConfig | undefined;
    query?: Record<string, string> | undefined;
    callSid?: string | undefined;
  } = {},
): Promise<Answer> {
  const account: TwilioConfig = more.account || SERVER_ACCOUNT;

  return await call(
    VOICEMAIL_ROUTE,
    twilioRequest({
      route: "amd-callback",
      query: more.query,
      signedWith: account.authToken,
      body: {
        AccountSid: account.accountSid,
        CallSid: more.callSid ?? CALL_SID,
        AnsweredBy: value,
        MachineDetectionDuration: "4210",
      },
    }),
  );
}

// How the call ended, as the status callback hears it.
async function ended(callStatus: string, duration?: string): Promise<Answer> {
  return await call(
    STATUS_ROUTE,
    twilioRequest({
      route: "status-callback",
      body: {
        AccountSid: SERVER_ACCOUNT.accountSid,
        CallSid: CALL_SID,
        CallStatus: callStatus,
        ...(duration !== undefined ? { CallDuration: duration } : {}),
      },
    }),
  );
}

function expectAccepted(answer: Answer): void {
  expect(answer.status).not.toHaveBeenCalled();
  expect(answer.next).not.toHaveBeenCalled();
  expect(sendEmptySuccess).toHaveBeenCalled();
}

function expectRefused(answer: Answer): void {
  expect(answer.status).toHaveBeenCalledWith(403);
  expect(answer.send).toHaveBeenCalledWith("Forbidden");
  expect(sendEmptySuccess).not.toHaveBeenCalled();
}

function expectNothingWritten(): void {
  expect(writeCallLog).not.toHaveBeenCalled();
  expect(timeline.writes).toEqual([]);
  expect(callUpdates).toEqual([]);
  expect(deliveryCounterCalls).toEqual([]);
}

function onlyDelivery(): Record<string, string> {
  expect(deliveryCounterCalls).toHaveLength(1);
  expect(deliveryCounterCalls[0]!.value).toBe(1);

  return deliveryCounterCalls[0]!.attributes;
}

beforeEach(() => {
  jest.clearAllMocks();
  deliveryCounterCalls.length = 0;
  deliveryDurationCalls.length = 0;

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

  storedLog = {
    status: CallStatus.Success,
    statusMessage: PLACED_MESSAGE,
    callData: {
      message:
        "This is a call from One Uptime A new incident has been created Incident number 42, API is down To acknowledge this incident, press 1.",
      voicemailMessage: KEPT_MESSAGE,
    },
  };
  onNextLogRead = null;

  findCallLog.mockImplementation(() => {
    return Promise.resolve(readLog());
  });

  writeCallLog.mockImplementation(((data: {
    id: ObjectID;
    data: { status?: CallStatus; statusMessage: string };
    expectedData: { status: CallStatus; statusMessage: string | null };
  }) => {
    if (
      !storedLog ||
      data.id.toString() !== CALL_LOG_ID.toString() ||
      storedLog.status !== data.expectedData.status ||
      storedLog.statusMessage !== data.expectedData.statusMessage
    ) {
      return Promise.resolve(false);
    }

    if (data.data.status) {
      storedLog.status = data.data.status;
    }

    storedLog.statusMessage = data.data.statusMessage;

    return Promise.resolve(true);
  }) as never);

  // The on-call notification the call was made for: placed, so Sent.
  timeline = new OnCallTimelineRows();
  timeline.add(NOTIFICATION_ID, UserNotificationStatus.Sent, {
    statusMessage: PLACED_MESSAGE,
  });
  timeline.standIn(UserOnCallLogTimelineService);

  findGlobalConfig.mockResolvedValue(serverTwilioRow(SERVER_ACCOUNT) as never);

  projectConfigs = [];
  findConfigs.mockImplementation((() => {
    return Promise.resolve(
      projectConfigs.map(
        (config: { row: ProjectCallSMSConfig }): ProjectCallSMSConfig => {
          return config.row;
        },
      ),
    );
  }) as never);
  toTwilioConfig.mockImplementation(((row: ProjectCallSMSConfig) => {
    return projectConfigs.find(
      (config: { row: ProjectCallSMSConfig }): boolean => {
        return config.row === row;
      },
    )?.account;
  }) as never);

  callUpdates = [];
  updateCall = jest.fn();
  (Twilio as unknown as jest.Mock).mockImplementation(((
    accountSid: string,
    authToken: string,
  ) => {
    return {
      calls: (callSid: string) => {
        return {
          update: (params: { twiml: string }): Promise<unknown> => {
            callUpdates.push({
              accountSid: accountSid,
              authToken: authToken,
              callSid: callSid,
              twiml: params.twiml,
            });
            return updateCall() as Promise<unknown>;
          },
        };
      },
    };
  }) as never);
  updateCall.mockResolvedValue({} as never);
});

afterEach(() => {
  jest.useRealTimers();
});

// A project's own Twilio config on an account.
function addProjectConfig(account: TwilioConfig): void {
  const row: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  row.id = ObjectID.generate();
  row.projectId = PROJECT_ID;
  row.twilioAccountSID = account.accountSid;
  projectConfigs.push({ row: row, account: account });
}

describe("the route", () => {
  test("is registered beside the status callback, with no sign-in", () => {
    expect(VOICEMAIL_ROUTE.uri).toBe("/amd-callback/:callLogId/:token");
    expect(STATUS_ROUTE.uri).toBe("/status-callback/:callLogId/:token");
  });
});

describe("the call's token and Twilio's signature lock it", () => {
  test("a URL that names no log is refused, and nothing is read", async () => {
    const answer: Answer = await call(
      VOICEMAIL_ROUTE,
      twilioRequest({
        route: "amd-callback",
        params: { callLogId: "not-a-log" },
        body: {
          AccountSid: SERVER_ACCOUNT.accountSid,
          CallSid: CALL_SID,
          AnsweredBy: "machine_end_beep",
        },
      }),
    );

    expect(sendError).toHaveBeenCalledTimes(1);
    // Said as a sentence, as Docs/ux/README.md#errors asks (ErrorMessagesGuard).
    const refusal: Error = sendError.mock.calls[0]?.[2] as Error;
    expect(isErrorSentence(refusal.message)).toBe(true);
    expect(answer.next).not.toHaveBeenCalled();
    expect(findCallLog).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  test("an unknown log - forged, or pruned - is answered 200, so Twilio does not retry, and not acted on", async () => {
    storedLog = null;

    const answer: Answer = await answeredBy("machine_end_beep");

    expectAccepted(answer);
    expectNothingWritten();
  });

  test("a wrong token is refused, before Twilio's signature is looked at", async () => {
    const answer: Answer = await call(
      VOICEMAIL_ROUTE,
      twilioRequest({
        route: "amd-callback",
        params: { token: "6c0e0000-0000-4000-8000-0000000000ff" },
        body: {
          AccountSid: SERVER_ACCOUNT.accountSid,
          CallSid: CALL_SID,
          AnsweredBy: "machine_end_beep",
        },
      }),
    );

    expectRefused(answer);
    expectNothingWritten();
    expect(findConfigs).not.toHaveBeenCalled();
    expect(findGlobalConfig).not.toHaveBeenCalled();
  });

  test("the right token without Twilio's signature is refused", async () => {
    const answer: Answer = await call(
      VOICEMAIL_ROUTE,
      twilioRequest({
        route: "amd-callback",
        signedWith: null,
        body: {
          AccountSid: SERVER_ACCOUNT.accountSid,
          CallSid: CALL_SID,
          AnsweredBy: "machine_end_beep",
        },
      }),
    );

    expectRefused(answer);
    expectNothingWritten();
  });

  test("the right token, signed with another auth token, is refused", async () => {
    const answer: Answer = await call(
      VOICEMAIL_ROUTE,
      twilioRequest({
        route: "amd-callback",
        signedWith: "an-auth-token-nobody-here-holds",
        body: {
          AccountSid: SERVER_ACCOUNT.accountSid,
          CallSid: CALL_SID,
          AnsweredBy: "machine_end_beep",
        },
      }),
    );

    expectRefused(answer);
    expectNothingWritten();
  });

  test("a body changed on the way - the verdict - no longer matches the signature, and is refused", async () => {
    const answer: Answer = await call(
      VOICEMAIL_ROUTE,
      twilioRequest({
        route: "amd-callback",
        signedBody: {
          AccountSid: SERVER_ACCOUNT.accountSid,
          CallSid: CALL_SID,
          AnsweredBy: "human",
        },
        body: {
          AccountSid: SERVER_ACCOUNT.accountSid,
          CallSid: CALL_SID,
          AnsweredBy: "machine_end_beep",
        },
      }),
    );

    expectRefused(answer);
    expectNothingWritten();
  });

  test("an account that placed none of this project's calls is refused, even signed with its own token", async () => {
    const stranger: TwilioConfig = {
      ...PROJECT_ACCOUNT,
      accountSid: "AC33333333333333333333333333333333",
      authToken: "a-stranger's-auth-token",
    };

    const answer: Answer = await answeredBy("machine_end_beep", {
      account: stranger,
    });

    expectRefused(answer);
    expectNothingWritten();
  });

  test("a refusal is logged with why - the account and the URL it was checked at - and never the token, the auth token or the whole account SID", async () => {
    const answer: Answer = await call(
      VOICEMAIL_ROUTE,
      twilioRequest({
        route: "amd-callback",
        signedWith: "an-auth-token-nobody-here-holds",
        body: {
          AccountSid: SERVER_ACCOUNT.accountSid,
          CallSid: CALL_SID,
          AnsweredBy: "machine_end_beep",
        },
      }),
    );

    expectRefused(answer);

    const logged: string = JSON.stringify(warn.mock.calls);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `Twilio callback refused: the call answering machine callback for log ${CALL_LOG_ID.toString()}. Its X-Twilio-Signature does not match the one Twilio account AC…1111 makes for https://oneuptime.example.com/notification/call/amd-callback/${CALL_LOG_ID.toString()}/…`,
      ),
    );
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(SERVER_ACCOUNT.authToken);
    expect(logged).not.toContain(SERVER_ACCOUNT.accountSid);
  });

  test("a project's config is looked for among the call's own project's only", async () => {
    await answeredBy("machine_end_beep");

    expect(findConfigs).toHaveBeenCalledTimes(1);
    expect(
      ((findConfigs.mock.calls[0]![0] as JSONObject)["query"] as JSONObject)[
        "projectId"
      ],
    ).toEqual(PROJECT_ID);
  });

  test("signed by the server's own account: accepted, and the message is left through it", async () => {
    const answer: Answer = await answeredBy("machine_end_beep");

    expectAccepted(answer);
    expect(callUpdates).toHaveLength(1);
    expect(callUpdates[0]!.accountSid).toBe(SERVER_ACCOUNT.accountSid);
    expect(callUpdates[0]!.authToken).toBe(SERVER_ACCOUNT.authToken);
  });

  test("signed by the project's own Twilio config: accepted, and the message is left through that account", async () => {
    addProjectConfig(PROJECT_ACCOUNT);

    const answer: Answer = await answeredBy("machine_end_beep", {
      account: PROJECT_ACCOUNT,
      query: { providerConfig: "project" },
    });

    expectAccepted(answer);
    expect(callUpdates).toHaveLength(1);
    expect(callUpdates[0]!.accountSid).toBe(PROJECT_ACCOUNT.accountSid);
    expect(callUpdates[0]!.authToken).toBe(PROJECT_ACCOUNT.authToken);
    expect(storedLog!.statusMessage).toBe(LEFT);
    // Counted as the project's account's call, as its send was.
    expect(onlyDelivery()["notification.provider.config"]).toBe("project");
  });

  test("a server whose own settings cannot be read still takes a callback on the project's own config", async () => {
    addProjectConfig(PROJECT_ACCOUNT);
    findGlobalConfig.mockRejectedValue(
      new Error("Global Config not found") as never,
    );

    const answer: Answer = await answeredBy("machine_end_beep", {
      account: PROJECT_ACCOUNT,
      query: { providerConfig: "project" },
    });

    expectAccepted(answer);
    expect(storedLog!.statusMessage).toBe(LEFT);
  });

  test("a project config that cannot be read as an account is passed over, not thrown on", async () => {
    addProjectConfig(PROJECT_ACCOUNT);
    toTwilioConfig.mockImplementation(() => {
      throw new Error(
        "Project Call and SMS Config twilio auth token is not set",
      );
    });

    const answer: Answer = await answeredBy("machine_end_beep", {
      account: PROJECT_ACCOUNT,
    });

    expectRefused(answer);
    expectNothingWritten();
  });
});

describe("a person answered, or Twilio could not tell", () => {
  test.each(["human", "unknown", "", "something-new"])(
    "AnsweredBy %p: nothing is written, nothing is left - the status callback says how it ended",
    async (value: string) => {
      const answer: Answer = await answeredBy(value);

      expectAccepted(answer);
      expectNothingWritten();
      expect(storedLog).toEqual(
        expect.objectContaining({
          status: CallStatus.Success,
          statusMessage: PLACED_MESSAGE,
        }),
      );
      expect(timeline.get(NOTIFICATION_ID)!.status).toBe(
        UserNotificationStatus.Sent,
      );
    },
  );
});

describe("voicemail answered, at the end of its greeting", () => {
  test.each(["machine_end_beep", "machine_end_silence", "machine_end_other"])(
    "%s: the call is turned to the kept message, and counts as not answered",
    async (value: string) => {
      const answer: Answer = await answeredBy(value);

      expectAccepted(answer);

      // The live call is turned to the message, which voicemail records.
      expect(callUpdates).toEqual([
        {
          accountSid: SERVER_ACCOUNT.accountSid,
          authToken: SERVER_ACCOUNT.authToken,
          callSid: CALL_SID,
          twiml: `<Response><Say>${KEPT_MESSAGE}</Say><Hangup/></Response>`,
        },
      ]);

      // The log: Voicemail, and that a message was left.
      expect(storedLog).toEqual(
        expect.objectContaining({
          status: CallStatus.Voicemail,
          statusMessage: LEFT,
        }),
      );

      // The notification: Not Answered, in the same words.
      expect(timeline.get(NOTIFICATION_ID)).toMatchObject({
        status: UserNotificationStatus.NotAnswered,
        statusMessage: LEFT,
      });
      expect(timeline.writes).toHaveLength(1);
    },
  );

  test("counted once, as an on-call call not answered, on the server's account, half a minute after it was placed", async () => {
    await answeredBy("machine_end_beep");

    expect(onlyDelivery()).toEqual({
      "notification.channel": "call",
      "notification.provider": "twilio",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "not_answered",
    });
    // Timed to the verdict: a call not answered is timed to its end.
    expect(deliveryDurationCalls).toHaveLength(1);
    expect(deliveryDurationCalls[0]!.attributes).toEqual(onlyDelivery());
    expect(deliveryDurationCalls[0]!.value).toBe(PLACED_AGO_MS);
  });

  test("when the message cannot be left - the call had ended - it says so, and still counts as not answered", async () => {
    updateCall.mockRejectedValue(
      Object.assign(
        new Error(
          `Call is not in-progress. Cannot redirect. /Accounts/${SERVER_ACCOUNT.accountSid}/Calls/${CALL_SID}.json`,
        ),
        { code: 21220, status: 400 },
      ) as never,
    );

    const answer: Answer = await answeredBy("machine_end_beep");

    expectAccepted(answer);
    expect(callUpdates).toHaveLength(1);
    expect(storedLog).toEqual(
      expect.objectContaining({
        status: CallStatus.Voicemail,
        statusMessage: NOT_LEFT,
      }),
    );
    expect(timeline.get(NOTIFICATION_ID)).toMatchObject({
      status: UserNotificationStatus.NotAnswered,
      statusMessage: NOT_LEFT,
    });
    expect(onlyDelivery()["outcome"]).toBe("not_answered");
  });

  test("Twilio's refusal is logged by its code alone: never the account SID its words carry", async () => {
    const warn: jest.Mock = (
      jest.requireMock("Common/Server/Utils/Logger") as {
        default: { warn: jest.Mock };
      }
    ).default.warn;

    updateCall.mockRejectedValue(
      Object.assign(
        new Error(
          `The requested resource /2010-04-01/Accounts/${SERVER_ACCOUNT.accountSid}/Calls/${CALL_SID}.json was not found`,
        ),
        { code: 20404, status: 404 },
      ) as never,
    );

    await answeredBy("machine_end_beep");

    const logged: string = JSON.stringify(warn.mock.calls);

    expect(logged).toContain("20404");
    expect(logged).not.toContain(SERVER_ACCOUNT.accountSid);
    expect(logged).not.toContain(SERVER_ACCOUNT.authToken);
  });

  test("a call whose words were not kept leaves who called and what to do", async () => {
    storedLog!.callData = {
      message: "This call is sensitive and is not logged",
    };

    await answeredBy("machine_end_beep");

    expect(callUpdates).toHaveLength(1);
    expect(callUpdates[0]!.twiml).toBe(
      "<Response><Say>This is a call from One Uptime about an on-call page. Open One Uptime to respond. Good bye.</Say><Hangup/></Response>",
    );
    expect(storedLog!.statusMessage).toBe(LEFT);
  });

  test("a call id that is not Twilio's leaves nothing, and the log names no id", async () => {
    const answer: Answer = await answeredBy("machine_end_beep", {
      callSid: "not-a-call",
    });

    expectAccepted(answer);
    expect(callUpdates).toEqual([]);
    expect(storedLog).toEqual(
      expect.objectContaining({
        status: CallStatus.Voicemail,
        statusMessage:
          "The call was not answered: it went to voicemail, and no message was left.",
      }),
    );
  });
});

describe("voicemail at the start of its greeting, and a fax machine", () => {
  test("machine_start: not answered, and no message is left over the greeting", async () => {
    const answer: Answer = await answeredBy("machine_start");

    expectAccepted(answer);
    expect(callUpdates).toEqual([]);
    expect(storedLog).toEqual(
      expect.objectContaining({
        status: CallStatus.Voicemail,
        statusMessage: NOT_LEFT,
      }),
    );
    expect(timeline.get(NOTIFICATION_ID)).toMatchObject({
      status: UserNotificationStatus.NotAnswered,
      statusMessage: NOT_LEFT,
    });
  });

  test("fax: a missed call, said as a fax machine, with nothing left", async () => {
    const answer: Answer = await answeredBy("fax");

    expectAccepted(answer);
    expect(callUpdates).toEqual([]);
    expect(storedLog).toEqual(
      expect.objectContaining({
        status: CallStatus.MissedCall,
        statusMessage: FAX,
      }),
    );
    expect(timeline.get(NOTIFICATION_ID)).toMatchObject({
      status: UserNotificationStatus.NotAnswered,
      statusMessage: FAX,
    });
    expect(onlyDelivery()["outcome"]).toBe("not_answered");
  });

  test("AnsweredBy is read whatever its case, and with spaces around it", async () => {
    await answeredBy("  MACHINE_END_BEEP ");

    expect(storedLog!.status).toBe(CallStatus.Voicemail);
  });
});

describe("once, and never over a person's answer", () => {
  test("sent again once it wrote: nothing more is written, left or counted", async () => {
    await answeredBy("machine_end_beep");

    jest.clearAllMocks();
    deliveryCounterCalls.length = 0;
    callUpdates.length = 0;
    timeline.writes.length = 0;

    const answer: Answer = await answeredBy("machine_end_beep");

    expectAccepted(answer);
    expectNothingWritten();
    expect(storedLog!.statusMessage).toBe(LEFT);
  });

  test("sent again after the first stopped before the notification: the notification is corrected, nothing else", async () => {
    // The first wrote the log, then the database failed.
    storedLog!.status = CallStatus.Voicemail;
    storedLog!.statusMessage = LEFT;

    const answer: Answer = await answeredBy("machine_end_beep");

    expectAccepted(answer);
    expect(writeCallLog).not.toHaveBeenCalled();
    expect(callUpdates).toEqual([]);
    expect(deliveryCounterCalls).toEqual([]);
    expect(timeline.get(NOTIFICATION_ID)).toMatchObject({
      status: UserNotificationStatus.NotAnswered,
      statusMessage: LEFT,
    });
  });

  test.each([
    [UserNotificationStatus.Acknowledged, "pressed 1"],
    [UserNotificationStatus.PassedOn, "pressed 2"],
  ])(
    "the person %s on this call: they were on the line - nothing is written or left",
    async (status: UserNotificationStatus) => {
      timeline.get(NOTIFICATION_ID)!.status = status;

      const answer: Answer = await answeredBy("machine_end_beep");

      expectAccepted(answer);
      expectNothingWritten();
      expect(storedLog!.status).toBe(CallStatus.Success);
      expect(timeline.get(NOTIFICATION_ID)!.status).toBe(status);
    },
  );

  test("a notification skipped, or already not answered, is not written over - the log still says voicemail", async () => {
    timeline.get(NOTIFICATION_ID)!.status = UserNotificationStatus.Skipped;

    await answeredBy("machine_end_beep");

    expect(storedLog!.status).toBe(CallStatus.Voicemail);
    expect(timeline.get(NOTIFICATION_ID)!.status).toBe(
      UserNotificationStatus.Skipped,
    );
    expect(timeline.writes).toEqual([]);
  });

  test.each([
    [CallStatus.MissedCall, "rang out"],
    [CallStatus.Busy, "busy"],
    [CallStatus.Error, "failed"],
  ])(
    "a call that ended %s first is left as it ended",
    async (status: CallStatus) => {
      storedLog!.status = status;
      storedLog!.statusMessage = `Call ID: ${CALL_SID}. The call ended otherwise.`;

      const answer: Answer = await answeredBy("machine_end_beep");

      expectAccepted(answer);
      expectNothingWritten();
      expect(storedLog!.status).toBe(status);
    },
  );

  test("a failure of the database is handed to Express - answered 500, so Twilio sends it again", async () => {
    writeCallLog.mockRejectedValue(new Error("connection reset") as never);

    const answer: Answer = await answeredBy("machine_end_beep");

    expect(answer.next).toHaveBeenCalledTimes(1);
    expect(sendEmptySuccess).not.toHaveBeenCalled();
  });
});

describe("in either order with the call's status callback", () => {
  test("voicemail first, then the call ends: the status callback finds it written, and writes nothing", async () => {
    await answeredBy("machine_end_beep");
    await ended("completed", "41");

    expect(storedLog).toEqual(
      expect.objectContaining({
        status: CallStatus.Voicemail,
        statusMessage: LEFT,
      }),
    );
    expect(timeline.get(NOTIFICATION_ID)).toMatchObject({
      status: UserNotificationStatus.NotAnswered,
      statusMessage: LEFT,
    });
    // Counted once: not answered.
    expect(onlyDelivery()["outcome"]).toBe("not_answered");
  });

  test("the call ends first, as answered: the voicemail still moves it to not answered, and it is not counted twice", async () => {
    await ended("completed", "12");

    expect(storedLog).toEqual(
      expect.objectContaining({
        status: CallStatus.Success,
        statusMessage: `Call ID: ${CALL_SID}. The call was answered and lasted 12 seconds.`,
      }),
    );
    expect(onlyDelivery()["outcome"]).toBe("answered");

    // The call has ended: Twilio turns no call that is over.
    updateCall.mockRejectedValue(
      Object.assign(new Error("Call is not in-progress. Cannot redirect."), {
        code: 21220,
        status: 400,
      }) as never,
    );

    await answeredBy("machine_end_beep");

    expect(callUpdates).toHaveLength(1);
    expect(storedLog).toEqual(
      expect.objectContaining({
        status: CallStatus.Voicemail,
        statusMessage: NOT_LEFT,
      }),
    );
    expect(timeline.get(NOTIFICATION_ID)).toMatchObject({
      status: UserNotificationStatus.NotAnswered,
      statusMessage: NOT_LEFT,
    });
    // Its end was counted by the status callback: once.
    expect(deliveryCounterCalls).toHaveLength(1);
  });

  test("the status callback landing between this route's read and its write: read again, and written over", async () => {
    onNextLogRead = (log: StoredLog): void => {
      log.statusMessage = `Call ID: ${CALL_SID}. The call was answered and lasted 9 seconds.`;
    };

    const answer: Answer = await answeredBy("machine_end_beep");

    expectAccepted(answer);
    expect(writeCallLog).toHaveBeenCalledTimes(2);
    expect(storedLog).toEqual(
      expect.objectContaining({
        status: CallStatus.Voicemail,
        statusMessage: LEFT,
      }),
    );
    // The status callback counted the call's end: not again.
    expect(deliveryCounterCalls).toEqual([]);
  });

  test("a status callback that wrote rang-out meanwhile is left", async () => {
    onNextLogRead = (log: StoredLog): void => {
      log.status = CallStatus.MissedCall;
      log.statusMessage = `Call ID: ${CALL_SID}. The call was not answered: it rang out.`;
    };

    await answeredBy("machine_end_beep");

    expect(storedLog!.status).toBe(CallStatus.MissedCall);
    expect(timeline.writes).toEqual([]);
    expect(deliveryCounterCalls).toEqual([]);
  });
});
