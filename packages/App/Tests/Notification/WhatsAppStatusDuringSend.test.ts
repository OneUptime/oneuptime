import { mockRouter } from "Common/Tests/Server/API/Helpers";
import WhatsAppService from "../../FeatureSet/Notification/Services/WhatsAppService";
import Project from "Common/Models/DatabaseModels/Project";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import { WhatsAppTemplateIds } from "Common/Types/WhatsApp/WhatsAppTemplates";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import API from "Common/Utils/API";
import { rowMatchesWhere } from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";

/*
 * A STATUS META REPORTS BEFORE THE SEND'S RESULT IS WRITTEN (issue #6684),
 * AND A PAGE META COULD NOT DELIVER (issue #6683).
 *
 * A WhatsApp message's log is written Queued, with no message id, just
 * before the message is handed to Meta, and gets Meta's id with the send's
 * result. Meta's status webhook finds the log by that id - and can come
 * before it is written. While a send is on its way, a recent status of a
 * message no log has yet is answered 503: Meta sends the webhook again, and
 * the status lands on the log once it has the id - counted once. No log
 * line names the recipient's phone number.
 *
 * A page Meta could not deliver says so on the person's on-call timeline,
 * with Meta's words: once, and over Sent or Sending only - the send's own
 * write, which comes later when Meta's report lands first, does not put
 * Sent back.
 *
 * WhatsAppService and Meta's webhook route (API/WhatsApp.ts) run as they
 * are. Meta's API is stood in for by a send the test answers when it says,
 * so a status can come while the message is being handed to Meta. The
 * WhatsApp logs are rows in memory that both read and write the way
 * Postgres would, the page's notification likewise (OnCallTimelineRows).
 * The metrics SDK is stood in for, and keeps what it is given.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const deliveryCounterCalls: Array<RecordedCall> = [];

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: (): void => {} };
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
        return { record: (): void => {} };
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

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    WhatsAppTextDefaultCostInCents: 1,
    getMetaWhatsAppConfig: jest.fn(),
  };
});

jest.mock("Common/Server/Middleware/WhatsAppAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedWhatsAppRequest: jest.fn() },
  };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedServiceMiddleware: jest.fn() },
  };
});

jest.mock("Common/Server/Middleware/MasterAdminAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedMasterAdminMiddleware: jest.fn() },
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NotificationService", () => {
  return {
    __esModule: true,
    default: { rechargeIfBalanceIsLow: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      sendEmailToProjectOwners: jest.fn(),
      updateOneById: jest.fn(),
      claimSmsOrCallLowBalanceNotice: jest.fn(),
      deductSmsOrCallBalanceInUSDCents: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/WhatsAppLogService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
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

import Response from "Common/Server/Utils/Response";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import { getMetaWhatsAppConfig } from "../../FeatureSet/Notification/Config";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
// Meta's webhook route, registered on the router stood in for.
import "../../FeatureSet/Notification/API/WhatsApp";

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
  return route.method === "POST" && route.uri === "/webhook";
});

const PROJECT_ID: ObjectID = new ObjectID(
  "7a7a0000-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "7a7a0000-0000-4000-8000-000000000002",
);
const META_MESSAGE_ID: string = "wamid.HBgLMTU1NTU1NTAxMjMVAgARGBI3";
const OTHER_MESSAGE_ID: string = "wamid.HBgLMTU1NTU1NTAxMjMVAgARGBI4";
// The recipient, as the send is given it and as Meta's statuses name it.
const RECIPIENT: string = "+15555550123";
const RECIPIENT_DIGITS: string = "15555550123";

// The WhatsApp log as the database holds it.
interface StoredLog {
  id: ObjectID;
  status: WhatsAppStatus | null;
  statusMessage?: string | undefined;
  whatsAppMessageId?: string | undefined;
  whatsAppCostInUSDCents?: number | undefined;
  userOnCallLogTimelineId?: ObjectID | undefined;
  createdAt: Date;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>((done: (value: T) => void) => {
    resolve = done;
  });
  return { promise: promise, resolve: resolve };
}

let logs: Array<StoredLog>;
let timeline: OnCallTimelineRows;

// The message has reached Meta's API, which has not answered yet.
let handedToMeta: Deferred<void>;
// Meta's answer, when the test gives it.
let metaAnswers: Deferred<HTTPResponse<JSONObject> | HTTPErrorResponse>;
// Runs right after the send's result is written on the log, before the page's notification.
let afterSendResultWritten: (() => Promise<void>) | null;

const sendEmptySuccess: Mock =
  Response.sendEmptySuccessResponse as unknown as Mock;

function onlyLog(): StoredLog {
  expect(logs).toHaveLength(1);
  return logs[0]!;
}

function rowById(id: ObjectID): StoredLog | undefined {
  return logs.find((row: StoredLog): boolean => {
    return row.id.toString() === id.toString();
  });
}

// A read: the row as it is now, as the route's select returns it.
function snapshot(row: StoredLog | undefined): WhatsAppLog | null {
  if (!row) {
    return null;
  }

  const log: WhatsAppLog = new WhatsAppLog();
  log.id = row.id;

  if (row.status !== null) {
    log.status = row.status;
  }

  if (row.userOnCallLogTimelineId) {
    log.userOnCallLogTimelineId = row.userOnCallLogTimelineId;
  }

  log.createdAt = row.createdAt;

  return log;
}

function message(): WhatsAppMessage {
  return {
    to: new Phone(RECIPIENT),
    body: "",
    templateKey: WhatsAppTemplateIds.AlertCreated,
    templateVariables: {
      alert_number: "12",
      alert_title: "Checkout API is down",
      project_name: "Example project",
      acknowledge_url: "https://oneuptime.example.com/a",
      alert_link: "https://oneuptime.example.com/b",
    },
  } as WhatsAppMessage;
}

// A page's message, handed to Meta: resolves once the send is done.
function sendPage(): Promise<void> {
  return WhatsAppService.sendWhatsApp(message(), {
    projectId: PROJECT_ID,
    userOnCallLogTimelineId: TIMELINE_ID,
  });
}

function metaAccepts(): void {
  metaAnswers.resolve(
    new HTTPResponse<JSONObject>(
      200,
      { messages: [{ id: META_MESSAGE_ID }] },
      {},
    ),
  );
}

// One of Meta's statuses, as it happened just now.
function status(
  metaStatus: string,
  more: JSONObject = {},
  messageId: string = META_MESSAGE_ID,
): JSONObject {
  return {
    id: messageId,
    status: metaStatus,
    timestamp: String(Math.floor(Date.now() / 1000)),
    recipient_id: RECIPIENT_DIGITS,
    ...more,
  };
}

const UNDELIVERABLE: JSONObject = {
  errors: [
    {
      code: 131026,
      title: "Message undeliverable",
      error_data: { details: "Message undeliverable." },
    },
  ],
};

const FAILED_PAGE_MESSAGE: string = `Delivery status: Failed. Message ID: ${META_MESSAGE_ID}. Provider error: Message undeliverable (code 131026).`;

// Meta's webhook, carrying the statuses: what the route answered it with.
async function metaReports(...items: Array<JSONObject>): Promise<number> {
  let answeredWith: number | null = null;

  const req: ExpressRequest = {
    params: {},
    query: {},
    body: {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "102290129340398",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: "1234567890" },
                statuses: items,
              },
            },
          ],
        },
      ],
    },
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn(),
    sendStatus: (code: number): void => {
      answeredWith = code;
    },
  } as unknown as ExpressResponse;

  const next: Mock = jest.fn();
  const answeredBefore: number = sendEmptySuccess.mock.calls.length;

  await ROUTE!.handlerFunction(req, res, next as unknown as NextFunction);

  expect(next).not.toHaveBeenCalled();

  if (answeredWith !== null) {
    expect(sendEmptySuccess.mock.calls.length).toBe(answeredBefore);
    return answeredWith;
  }

  expect(sendEmptySuccess.mock.calls.length).toBe(answeredBefore + 1);
  return 200;
}

function deliveries(): Array<string> {
  return deliveryCounterCalls.map((call: RecordedCall): string => {
    expect(call.value).toBe(1);
    return call.attributes["outcome"] || "";
  });
}

// Everything logged, as text.
function loggedText(): string {
  return JSON.stringify(
    [logger.debug, logger.info, logger.warn, logger.error].map(
      (method: unknown) => {
        return (method as Mock).mock.calls;
      },
    ),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  deliveryCounterCalls.length = 0;
  setTestBillingEnabled(true);

  logs = [];
  handedToMeta = deferred<void>();
  metaAnswers = deferred<HTTPResponse<JSONObject> | HTTPErrorResponse>();
  afterSendResultWritten = null;

  (getMetaWhatsAppConfig as unknown as Mock).mockResolvedValue({
    accessToken: "meta-access-token",
    phoneNumberId: "1234567890",
    apiVersion: "v21.0",
  } as never);

  // Meta's API: answers when the test says.
  jest.spyOn(API, "post").mockImplementation((() => {
    handedToMeta.resolve();
    return metaAnswers.promise;
  }) as never);

  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.name = "Example project";
  project.smsOrCallCurrentBalanceInUSDCents = 10_000;
  project.lowCallAndSMSBalanceNotificationSentToOwners = true;
  project.notEnabledSmsOrCallNotificationSentToOwners = true;

  (ProjectService.findOneById as unknown as Mock).mockResolvedValue(
    project as never,
  );
  (
    NotificationService.rechargeIfBalanceIsLow as unknown as Mock
  ).mockResolvedValue(10_000 as never);

  // The WhatsApp logs: written by the send, read and written by the webhook.
  (WhatsAppLogService.create as unknown as Mock).mockImplementation(((input: {
    data: WhatsAppLog;
  }) => {
    const row: StoredLog = {
      id: ObjectID.generate(),
      status: input.data.status || null,
      statusMessage: input.data.statusMessage,
      whatsAppMessageId: input.data.whatsAppMessageId,
      whatsAppCostInUSDCents: input.data.whatsAppCostInUSDCents,
      userOnCallLogTimelineId: input.data.userOnCallLogTimelineId,
      createdAt: new Date(),
    };
    logs.push(row);

    const created: WhatsAppLog = new WhatsAppLog();
    created.id = row.id;
    return Promise.resolve(created);
  }) as never);

  (
    WhatsAppLogService.updateColumnsByIdWithoutHooks as unknown as Mock
  ).mockImplementation((async (input: {
    id: ObjectID;
    data: Partial<StoredLog>;
  }) => {
    const row: StoredLog | undefined = rowById(input.id);

    if (row) {
      Object.assign(row, input.data);
    }

    if (afterSendResultWritten) {
      await afterSendResultWritten();
    }
  }) as never);

  // A read by query - Meta's id, or a send on its way - as Postgres runs it.
  (WhatsAppLogService.findOneBy as unknown as Mock).mockImplementation(
    ((input: { query: Record<string, unknown> }) => {
      const found: StoredLog | undefined = logs.find(
        (row: StoredLog): boolean => {
          return rowMatchesWhere(
            {
              _id: row.id.toString(),
              whatsAppMessageId: row.whatsAppMessageId ?? null,
              status: row.status,
              createdAt: row.createdAt,
            },
            input.query,
          );
        },
      );

      return Promise.resolve(snapshot(found));
    }) as never,
  );

  (WhatsAppLogService.findOneById as unknown as Mock).mockImplementation(
    ((input: { id: ObjectID }) => {
      return Promise.resolve(snapshot(rowById(input.id)));
    }) as never,
  );

  // Lands only while the row holds the status it expects, as Postgres would.
  (
    WhatsAppLogService.compareAndSetColumnsByIdWithoutHooks as unknown as Mock
  ).mockImplementation(((input: {
    id: ObjectID;
    data: Partial<StoredLog>;
    expectedData: { status: WhatsAppStatus | null };
  }) => {
    const row: StoredLog | undefined = rowById(input.id);

    if (!row || row.status !== (input.expectedData.status ?? null)) {
      return Promise.resolve(false);
    }

    Object.assign(row, input.data);
    return Promise.resolve(true);
  }) as never);

  // The page's notification, written Sending as its page went out.
  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("while the message is being handed to Meta", () => {
  test("its log is written already: Queued, with no message id, naming the page", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;

    expect(onlyLog()).toMatchObject({
      status: WhatsAppStatus.Queued,
      userOnCallLogTimelineId: TIMELINE_ID,
    });
    expect(onlyLog().whatsAppMessageId).toBeUndefined();

    metaAccepts();
    await sending;

    expect(onlyLog()).toMatchObject({
      status: WhatsAppStatus.Sent,
      whatsAppMessageId: META_MESSAGE_ID,
      statusMessage: `Message ID: ${META_MESSAGE_ID}`,
      whatsAppCostInUSDCents: 1,
    });
  });

  test("a status Meta reports then is asked for again - 503 - and nothing is written or counted", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;

    expect(await metaReports(status("delivered"))).toBe(503);

    expect(onlyLog().status).toBe(WhatsAppStatus.Queued);
    expect(deliveries()).toEqual([]);

    metaAccepts();
    await sending;
  });

  test("sent again once the send's result is written, it lands on the log - counted once", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;

    expect(await metaReports(status("delivered"))).toBe(503);

    metaAccepts();
    await sending;

    // Meta sends the webhook again.
    expect(await metaReports(status("delivered"))).toBe(200);
    expect(onlyLog().status).toBe(WhatsAppStatus.Delivered);
    expect(deliveries()).toEqual(["delivered"]);

    // And again: nothing more.
    expect(await metaReports(status("delivered"))).toBe(200);
    expect(deliveries()).toEqual(["delivered"]);
  });

  test("a webhook of several statuses - sent, delivered, read - is asked for again as a whole, and lands once", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;

    const all: Array<JSONObject> = [
      status("sent"),
      status("delivered"),
      status("read"),
    ];

    expect(await metaReports(...all)).toBe(503);

    metaAccepts();
    await sending;

    expect(await metaReports(...all)).toBe(200);
    expect(onlyLog().status).toBe(WhatsAppStatus.Read);
    expect(deliveries()).toEqual(["delivered"]);

    expect(await metaReports(...all)).toBe(200);
    expect(deliveries()).toEqual(["delivered"]);
  });

  test("no log line of the send or of the webhook names the recipient's number", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;

    await metaReports(status("delivered"));
    await metaReports(status("delivered", {}, OTHER_MESSAGE_ID));

    metaAccepts();
    await sending;

    await metaReports(status("failed", UNDELIVERABLE));
    await metaReports(status("delivered", {}, OTHER_MESSAGE_ID));
    await metaReports({ status: "delivered", recipient_id: RECIPIENT_DIGITS });

    expect(loggedText()).toContain(META_MESSAGE_ID);
    expect(loggedText()).not.toContain(RECIPIENT_DIGITS);
  });
});

describe("once nothing is being sent", () => {
  test("a status of a message no log has is answered 200, and warned of by its id", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;
    metaAccepts();
    await sending;

    expect(await metaReports(status("delivered", {}, OTHER_MESSAGE_ID))).toBe(
      200,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      `[Meta WhatsApp Webhook] No WhatsApp log found for message id ${OTHER_MESSAGE_ID} (status: delivered).`,
      {},
    );
    expect(deliveries()).toEqual([]);
  });

  test("a send Meta refused leaves no send on its way: its log is an Error, and a status of no log is answered 200", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;

    metaAnswers.resolve(
      new HTTPErrorResponse(
        400,
        { error: { message: "Template name does not exist" } },
        {},
      ),
    );
    await expect(sending).rejects.toThrow("Template name does not exist");

    expect(onlyLog()).toMatchObject({
      status: WhatsAppStatus.Error,
      statusMessage: "Template name does not exist",
      whatsAppCostInUSDCents: 0,
    });
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "Template name does not exist",
    });

    expect(await metaReports(status("delivered", {}, OTHER_MESSAGE_ID))).toBe(
      200,
    );
  });
});

describe("a page Meta could not deliver (issue #6683)", () => {
  test("reported after the send's result: the page's notification moves from Sent to Error, with Meta's words", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;
    metaAccepts();
    await sending;

    expect(timeline.get(TIMELINE_ID)!.status).toBe(UserNotificationStatus.Sent);

    expect(await metaReports(status("failed", UNDELIVERABLE))).toBe(200);

    expect(onlyLog().status).toBe(WhatsAppStatus.Failed);
    expect(deliveries()).toEqual(["failed"]);
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: FAILED_PAGE_MESSAGE,
    });
  });

  test("reported while the message was being handed to Meta: asked for again, and corrects the page once it lands", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;

    expect(await metaReports(status("failed", UNDELIVERABLE))).toBe(503);
    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Sending,
    );

    metaAccepts();
    await sending;

    expect(await metaReports(status("failed", UNDELIVERABLE))).toBe(200);

    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: FAILED_PAGE_MESSAGE,
    });
    expect(deliveries()).toEqual(["failed"]);
  });

  test("reported between the log's write and the page's: the page keeps Error - the send does not put Sent back", async () => {
    afterSendResultWritten = async (): Promise<void> => {
      afterSendResultWritten = null;
      expect(await metaReports(status("failed", UNDELIVERABLE))).toBe(200);
    };

    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;
    metaAccepts();
    await sending;

    expect(onlyLog().status).toBe(WhatsAppStatus.Failed);
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: FAILED_PAGE_MESSAGE,
    });
    // One write: Meta's report's.
    expect(timeline.writes).toHaveLength(1);
  });

  test("Meta repeating it writes the page's notification no more, and counts nothing more", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;
    metaAccepts();
    await sending;

    await metaReports(status("failed", UNDELIVERABLE));
    await metaReports(status("failed", UNDELIVERABLE));
    await metaReports(status("failed", UNDELIVERABLE));

    // Sending -> Sent by the send, Sent -> Error by Meta's report.
    expect(timeline.writes).toHaveLength(2);
    expect(deliveries()).toEqual(["failed"]);
  });

  test("a page the person acknowledged meanwhile stays acknowledged", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;
    metaAccepts();
    await sending;

    timeline.get(TIMELINE_ID)!.status = UserNotificationStatus.Acknowledged;

    await metaReports(status("failed", UNDELIVERABLE));

    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Acknowledged,
    );
    expect(onlyLog().status).toBe(WhatsAppStatus.Failed);
  });

  test("a message delivered changes nothing on the page's notification", async () => {
    const sending: Promise<void> = sendPage();
    await handedToMeta.promise;
    metaAccepts();
    await sending;

    const writesBefore: number = timeline.writes.length;

    await metaReports(status("delivered"));
    await metaReports(status("read"));

    expect(timeline.writes).toHaveLength(writesBefore);
    expect(timeline.get(TIMELINE_ID)!.status).toBe(UserNotificationStatus.Sent);
  });
});
