import { mockRouter } from "Common/Tests/Server/API/Helpers";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
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
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "./Fixtures/OnCallTimelineRows";

/*
 * POST /notification/whatsapp/webhook - HOW A WHATSAPP MESSAGE ENDED, AS
 * META TELLS IT, FOR THE PLATFORM'S OPERATOR (issue #6648).
 *
 * Meta's status webhooks say each message was sent, delivered, read or
 * failed - often out of order (read before delivered), sometimes twice,
 * and several in one request, which are handled at once. Each is written on
 * the message's own log only while the log still says what was read (a
 * compare-and-set: one that finds it changed reads it again and decides
 * again); once the message reached a final status - delivered, read,
 * failed - only "read" moves a delivered message on.
 *
 * The log is the record of truth: the moment it moves into a final status
 * is when the message is counted, once - notification.delivery.count,
 * delivered (a read message was delivered) or failed - and timed from the
 * log, written just before the message was handed to Meta
 * (notification.delivery.duration).
 * On the installation's own WhatsApp Business account, as every message
 * is, and as an on-call page when its log names the page it was sent for,
 * as notification.send.count said it.
 *
 * The log is written just before the message is handed to Meta - Queued,
 * with no message id - and gets the id with Meta's answer (WhatsAppService).
 * A status that comes in between names an id no log has yet: while a
 * message is being sent, and the status is recent, Meta is asked to send it
 * again (503), and it lands once the id is there - counted once, as every
 * write is a compare-and-set (issue #6684). The webhook's log lines name a
 * message's id and status, never the payload, which holds the recipient's
 * phone number.
 *
 * A page Meta reports failed says so on the person's on-call timeline, with
 * Meta's words: once, by the webhook that moved the log into Failed, and
 * only while the page still says Sent or Sending (issue #6683).
 *
 * The database is stood in for by rows the route reads and writes the way
 * Postgres would, the page's notification likewise (OnCallTimelineRows).
 * The metrics SDK is stood in for, and keeps what it is given.
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

jest.mock("Common/Server/Services/WhatsAppLogService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
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

jest.mock("../../FeatureSet/Notification/Services/WhatsAppService", () => {
  return { __esModule: true, default: { sendWhatsApp: jest.fn() } };
});

import WhatsAppAuthorization from "Common/Server/Middleware/WhatsAppAuthorization";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import {
  buildFailedDeliveryMessage,
  isRecentStatus,
  isStaleWhatsAppStatus,
  MAX_STATUS_WRITE_ATTEMPTS,
  SEND_ON_ITS_WAY_FOR_MS,
  STATUS_SENT_AGAIN_WITHIN_MS,
  WHATSAPP_LOG_STATUS_WEBHOOK_SELECT,
} from "../../FeatureSet/Notification/API/WhatsApp";

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
  return route.method === "POST" && route.uri === "/webhook";
});

const LOG_ID: ObjectID = new ObjectID("3a3a0000-0000-4000-8000-0000000000a1");
const OTHER_LOG_ID: ObjectID = new ObjectID(
  "3a3a0000-0000-4000-8000-0000000000a3",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "3a3a0000-0000-4000-8000-0000000000a2",
);
const MESSAGE_ID: string = "wamid.HBgLMTU1NTU1NTAxMjMVAgARGBI1";
const OTHER_MESSAGE_ID: string = "wamid.HBgLMTU1NTU1NTAxMjMVAgARGBI2";
const RECIPIENT: string = "15555550123";
const CONVERSATION_ID: string = "4f5d0a6b0e5c6d7e8f9a0b1c2d3e4f5a";

// "Now", and the log written forty seconds before it.
const NOW: number = Date.UTC(2026, 10, 10, 12, 0, 0);
const WRITTEN_AGO_MS: number = 40 * 1000;

// The WhatsApp logs as the database holds them, by Meta's message id.
interface StoredLog {
  id: ObjectID;
  status: WhatsAppStatus | null;
  statusMessage?: string | undefined;
  userOnCallLogTimelineId?: ObjectID | undefined;
  createdAt?: Date | undefined;
}

let stored: Map<string, StoredLog>;

// Logs of messages being sent: written Queued, with no message id yet.
let onTheirWay: Array<StoredLog>;

// What the route answered with a status of its own: 503 asks Meta to send again.
let sendStatusCalls: Array<number>;

// The page's notification, as the person's on-call timeline holds it.
let timeline: OnCallTimelineRows;

const findByMessageId: jest.Mock = WhatsAppLogService.findOneBy as jest.Mock;
const findById: jest.Mock = WhatsAppLogService.findOneById as jest.Mock;
const writeLog: jest.Mock =
  WhatsAppLogService.compareAndSetColumnsByIdWithoutHooks as jest.Mock;
const sendEmptySuccess: jest.Mock =
  Response.sendEmptySuccessResponse as jest.Mock;
const warn: jest.Mock = logger.warn as jest.Mock;
const findTimeline: jest.Mock =
  UserOnCallLogTimelineService.findOneById as jest.Mock;
const updateTimeline: jest.Mock =
  UserOnCallLogTimelineService.updateOneBy as jest.Mock;

function rowById(id: ObjectID): StoredLog | undefined {
  return [...Array.from(stored.values()), ...onTheirWay].find(
    (row: StoredLog): boolean => {
      return row.id.toString() === id.toString();
    },
  );
}

// Every log as the table holds it, with its message id - none while being sent.
function tableRows(): Array<Record<string, unknown>> {
  return [
    ...Array.from(stored.entries()).map(
      ([messageId, row]: [string, StoredLog]): Record<string, unknown> => {
        return {
          _id: row.id.toString(),
          whatsAppMessageId: messageId,
          status: row.status,
          createdAt: row.createdAt,
        };
      },
    ),
    ...onTheirWay.map((row: StoredLog): Record<string, unknown> => {
      return {
        _id: row.id.toString(),
        whatsAppMessageId: null,
        status: row.status,
        createdAt: row.createdAt,
      };
    }),
  ];
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

  if (row.createdAt) {
    log.createdAt = row.createdAt;
  }

  return log;
}

/*
 * Typed as what jest.fn() from @jest/globals makes (jest-mock's Mock): the
 * global jest.Mock App's tsc reads is @types/jest 29's, with members
 * jest-mock 28's Mock lacks.
 */
async function webhook(body: JSONObject): Promise<Mock> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn(),
    sendStatus: (code: number): void => {
      sendStatusCalls.push(code);
    },
  } as unknown as ExpressResponse;

  const next: Mock = jest.fn();

  await ROUTE!.handlerFunction(req, res, next as unknown as NextFunction);

  return next;
}

function status(
  metaStatus: string,
  more: JSONObject = {},
  messageId: string = MESSAGE_ID,
): JSONObject {
  return {
    id: messageId,
    status: metaStatus,
    timestamp: "1794340800",
    recipient_id: RECIPIENT,
    conversation: { id: CONVERSATION_ID, origin: { type: "utility" } },
    pricing: { billable: true, category: "utility" },
    ...more,
  };
}

// Meta's webhook body: one change carrying the statuses, in the order given.
function statuses(...items: Array<JSONObject>): JSONObject {
  return {
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

function storedStatus(messageId: string = MESSAGE_ID): WhatsAppStatus | null {
  return stored.get(messageId)!.status;
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

  // An on-call page's message, logged Sent with Meta's id once Meta accepted it (WhatsAppService).
  stored = new Map<string, StoredLog>([
    [
      MESSAGE_ID,
      {
        id: LOG_ID,
        status: WhatsAppStatus.Sent,
        userOnCallLogTimelineId: TIMELINE_ID,
        createdAt: new Date(NOW - WRITTEN_AGO_MS),
      },
    ],
  ]);

  onTheirWay = [];
  sendStatusCalls = [];

  // A read by query - Meta's id, or a send on its way - as Postgres runs it.
  findByMessageId.mockImplementation(((input: {
    query: Record<string, unknown>;
  }) => {
    const found: Record<string, unknown> | undefined = tableRows().find(
      (row: Record<string, unknown>): boolean => {
        return rowMatchesWhere(row, input.query);
      },
    );

    return Promise.resolve(
      found ? snapshot(rowById(new ObjectID(found["_id"] as string))) : null,
    );
  }) as never);
  findById.mockImplementation(((input: { id: ObjectID }) => {
    return Promise.resolve(snapshot(rowById(input.id)));
  }) as never);
  writeLog.mockImplementation(((input: {
    id: ObjectID;
    data: Partial<StoredLog>;
    expectedData: { status: WhatsAppStatus | null };
  }) => {
    const row: StoredLog | undefined = rowById(input.id);

    if (!row || row.status !== input.expectedData.status) {
      return Promise.resolve(false);
    }

    Object.assign(row, input.data);

    return Promise.resolve(true);
  }) as never);
});

beforeEach(() => {
  // The page the message was sent for, still only sent.
  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sent);
  timeline.standIn(UserOnCallLogTimelineService);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the webhook", () => {
  test("is registered behind Meta's signature check", () => {
    expect(ROUTE).toBeDefined();
    expect(ROUTE!.middlewares).toEqual([
      WhatsAppAuthorization.isAuthorizedWhatsAppRequest,
    ]);
  });

  test("reads the message's log as root, by Meta's id, with what deciding and counting its status needs", async () => {
    await webhook(statuses(status("delivered")));

    expect(WHATSAPP_LOG_STATUS_WEBHOOK_SELECT).toEqual({
      _id: true,
      status: true,
      userOnCallLogTimelineId: true,
      createdAt: true,
    });
    expect(findByMessageId).toHaveBeenCalledWith({
      query: { whatsAppMessageId: MESSAGE_ID },
      select: WHATSAPP_LOG_STATUS_WEBHOOK_SELECT,
      props: { isRoot: true },
    });
  });

  test("writes the status only while the log still says what was read", async () => {
    await webhook(statuses(status("delivered")));

    expect(writeLog).toHaveBeenCalledTimes(1);

    const write: Record<string, unknown> = writeLog.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(String(write["id"])).toBe(LOG_ID.toString());
    expect(write["expectedData"]).toEqual({ status: WhatsAppStatus.Sent });
    expect((write["data"] as JSONObject)["status"]).toBe(
      WhatsAppStatus.Delivered,
    );
    expect(storedStatus()).toBe(WhatsAppStatus.Delivered);
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a log with no status yet is expected to have none still", async () => {
    stored.get(MESSAGE_ID)!.status = null;

    await webhook(statuses(status("sent")));

    expect(writeLog.mock.calls[0]![0]).toMatchObject({
      expectedData: { status: null },
    });
  });

  test("tries a write at most three times", () => {
    expect(MAX_STATUS_WRITE_ATTEMPTS).toBe(3);
  });
});

describe("how a message ended, for the platform's operator", () => {
  test("delivered: counted once, through Meta, on the installation's account, as an on-call page - timed from its log", async () => {
    await webhook(statuses(status("delivered")));

    expect(onlyDelivery()).toEqual({
      "notification.channel": "whatsapp",
      "notification.provider": "meta_whatsapp",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "delivered",
    });
    expect(onlyDeliveryTime()).toBe(WRITTEN_AGO_MS);
  });

  test("read, before Meta said delivered: delivered - a read message reached the phone", async () => {
    await webhook(statuses(status("read")));

    expect(storedStatus()).toBe(WhatsAppStatus.Read);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
    expect(onlyDeliveryTime()).toBe(WRITTEN_AGO_MS);
  });

  test("failed: failed", async () => {
    await webhook(
      statuses(
        status("failed", {
          errors: [{ code: 131026, title: "Message undeliverable" }],
        }),
      ),
    );

    expect(storedStatus()).toBe(WhatsAppStatus.Failed);
    expect(onlyDelivery()["outcome"]).toBe("failed");
  });

  test.each(["sent", "queued", "warning", "deleted", "something-new"])(
    "'%s' - no final status - is written, and not counted",
    async (metaStatus: string) => {
      await webhook(statuses(status(metaStatus)));

      expect(writeLog).toHaveBeenCalledTimes(1);
      expectNothingCounted();
    },
  );

  test("a message that was no on-call page - its log names none - says so", async () => {
    delete stored.get(MESSAGE_ID)!.userOnCallLogTimelineId;

    await webhook(statuses(status("delivered")));

    expect(onlyDelivery()["notification.on_call_page"]).toBe("false");
  });

  test("a log with no time it was written: counted, not timed", async () => {
    delete stored.get(MESSAGE_ID)!.createdAt;

    await webhook(statuses(status("delivered")));

    expect(onlyDelivery()["outcome"]).toBe("delivered");
    expect(deliveryDurationCalls).toEqual([]);
  });

  test("never carries the number, the message's id, the conversation's, the log's or the page's", async () => {
    await webhook(statuses(status("delivered")));

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
      RECIPIENT,
      MESSAGE_ID,
      CONVERSATION_ID,
      LOG_ID.toString(),
      TIMELINE_ID.toString(),
    ]) {
      expect(values).not.toContain(value);
    }
  });
});

describe("each message is counted once - on its log's move into a final status", () => {
  test("delivered, then read: read is written, and the message is not counted again", async () => {
    await webhook(statuses(status("delivered")));
    await webhook(statuses(status("read")));

    expect(writeLog).toHaveBeenCalledTimes(2);
    expect(storedStatus()).toBe(WhatsAppStatus.Read);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("out of order - read, then delivered: the late 'delivered' is neither written nor counted", async () => {
    await webhook(statuses(status("read")));
    await webhook(statuses(status("delivered")));

    expect(writeLog).toHaveBeenCalledTimes(1);
    expect(storedStatus()).toBe(WhatsAppStatus.Read);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("out of order - delivered, then sent: the late 'sent' is neither written nor counted", async () => {
    await webhook(statuses(status("delivered")));
    await webhook(statuses(status("sent")));

    expect(writeLog).toHaveBeenCalledTimes(1);
    expect(storedStatus()).toBe(WhatsAppStatus.Delivered);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("Meta's webhook sent twice: one write, one count", async () => {
    await webhook(statuses(status("delivered")));
    await webhook(statuses(status("delivered")));

    expect(writeLog).toHaveBeenCalledTimes(1);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("failed, then delivered: a failed message stays failed, counted once", async () => {
    await webhook(statuses(status("failed")));
    await webhook(statuses(status("delivered")));

    expect(storedStatus()).toBe(WhatsAppStatus.Failed);
    expect(onlyDelivery()["outcome"]).toBe("failed");
  });

  test("delivered and read in one request, handled at once: one lands, the other reads again - one count", async () => {
    await webhook(statuses(status("delivered"), status("read")));

    expect(storedStatus()).toBe(WhatsAppStatus.Read);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("read and delivered in one request: read lands, the late 'delivered' stops - one count", async () => {
    await webhook(statuses(status("read"), status("delivered")));

    expect(storedStatus()).toBe(WhatsAppStatus.Read);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
    // The late one read the log again, and left it.
    expect(findById).toHaveBeenCalledTimes(1);
  });

  test("sent and delivered in one request: both land in order, one count", async () => {
    await webhook(statuses(status("sent"), status("delivered")));

    expect(storedStatus()).toBe(WhatsAppStatus.Delivered);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("two messages' statuses in one request: each counted once, on its own log", async () => {
    stored.set(OTHER_MESSAGE_ID, {
      id: OTHER_LOG_ID,
      status: WhatsAppStatus.Sent,
      createdAt: new Date(NOW - 5000),
    });

    await webhook(
      statuses(
        status("delivered"),
        status("failed", {}, OTHER_MESSAGE_ID),
        status("read"),
      ),
    );

    expect(storedStatus()).toBe(WhatsAppStatus.Read);
    expect(storedStatus(OTHER_MESSAGE_ID)).toBe(WhatsAppStatus.Failed);
    expect(
      deliveryCounterCalls.map((call: RecordedCall) => {
        return [
          call.attributes["outcome"],
          call.attributes["notification.on_call_page"],
        ];
      }),
    ).toEqual([
      ["delivered", "true"],
      ["failed", "false"],
    ]);
    expect(
      deliveryDurationCalls.map((call: RecordedCall) => {
        return call.value;
      }),
    ).toEqual([WRITTEN_AGO_MS, 5000]);
  });

  test("a log that keeps changing under every try: given up after three, nothing counted", async () => {
    writeLog.mockResolvedValue(false as never);

    await webhook(statuses(status("delivered")));

    expect(writeLog).toHaveBeenCalledTimes(MAX_STATUS_WRITE_ATTEMPTS);
    expect(findById).toHaveBeenCalledTimes(MAX_STATUS_WRITE_ATTEMPTS - 1);
    expect(warn).toHaveBeenCalledWith(
      `[Meta WhatsApp Webhook] Could not write the status of the WhatsApp log for message id ${MESSAGE_ID}: it kept changing.`,
      {},
    );
    expectNothingCounted();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a log gone when read again: nothing more", async () => {
    writeLog.mockImplementationOnce((() => {
      stored.delete(MESSAGE_ID);
      return Promise.resolve(false);
    }) as never);

    await webhook(statuses(status("delivered")));

    expect(writeLog).toHaveBeenCalledTimes(1);
    expectNothingCounted();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a message OneUptime keeps no log of: nothing written or counted", async () => {
    await webhook(statuses(status("delivered", {}, OTHER_MESSAGE_ID)));

    expect(writeLog).not.toHaveBeenCalled();
    expectNothingCounted();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `[Meta WhatsApp Webhook] No WhatsApp log found for message id ${OTHER_MESSAGE_ID} (status: delivered).`,
      {},
    );
  });

  test("a status with no message id: nothing read, written or counted", async () => {
    await webhook(statuses({ status: "delivered" }));

    expect(findByMessageId).not.toHaveBeenCalled();
    expectNothingCounted();
  });

  test("an event of another kind of account: nothing read, written or counted", async () => {
    await webhook({ ...statuses(status("delivered")), object: "page" });

    expect(findByMessageId).not.toHaveBeenCalled();
    expectNothingCounted();
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a status that cannot be handled leaves the others handled, and the request answered", async () => {
    stored.set(OTHER_MESSAGE_ID, {
      id: OTHER_LOG_ID,
      status: WhatsAppStatus.Sent,
    });
    findByMessageId.mockImplementationOnce((() => {
      return Promise.reject(new Error("connection reset"));
    }) as never);

    const next: Mock = await webhook(
      statuses(status("delivered"), status("delivered", {}, OTHER_MESSAGE_ID)),
    );

    expect(next).not.toHaveBeenCalled();
    expect(storedStatus()).toBe(WhatsAppStatus.Sent);
    expect(storedStatus(OTHER_MESSAGE_ID)).toBe(WhatsAppStatus.Delivered);
    expect(onlyDelivery()["notification.on_call_page"]).toBe("false");
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
    expect(sendStatusCalls).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("a status that comes before its message's log has the message's id (issue #6684)", () => {
  /*
   * WhatsAppService writes the log Queued, with no message id, just before
   * it hands the message to Meta, and writes the id with Meta's answer. A
   * status Meta reports in between names an id no log has yet.
   */
  const EARLY_LOG_ID: ObjectID = new ObjectID(
    "3a3a0000-0000-4000-8000-0000000000a4",
  );

  function sendOnItsWay(writtenAgoMs: number = 2000): StoredLog {
    const row: StoredLog = {
      id: EARLY_LOG_ID,
      status: WhatsAppStatus.Queued,
      userOnCallLogTimelineId: TIMELINE_ID,
      createdAt: new Date(NOW - writtenAgoMs),
    };

    onTheirWay.push(row);

    return row;
  }

  // The send's result lands: the log has the message's id, and says Sent.
  function sendsResultWritten(row: StoredLog): void {
    onTheirWay.splice(onTheirWay.indexOf(row), 1);
    row.status = WhatsAppStatus.Sent;
    stored.set(OTHER_MESSAGE_ID, row);
  }

  // Meta's time of a status, `agoMs` before now, in its seconds.
  function at(agoMs: number): JSONObject {
    return { timestamp: String(Math.floor((NOW - agoMs) / 1000)) };
  }

  test("a recent status while a message is being sent: Meta is asked to send it again (503) - nothing written or counted", async () => {
    sendOnItsWay();

    const next: Mock = await webhook(
      statuses(status("delivered", at(1000), OTHER_MESSAGE_ID)),
    );

    expect(sendStatusCalls).toEqual([503]);
    expect(sendEmptySuccess).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(writeLog).not.toHaveBeenCalled();
    expectNothingCounted();
  });

  test("asks whether a send is on its way: a log Queued, with no message id, written in the last five minutes", async () => {
    sendOnItsWay();

    await webhook(statuses(status("delivered", at(1000), OTHER_MESSAGE_ID)));

    expect(SEND_ON_ITS_WAY_FOR_MS).toBe(5 * 60 * 1000);

    const asked: { query: Record<string, unknown> } = findByMessageId.mock
      .calls[1]![0] as { query: Record<string, unknown> };

    expect(Object.keys(asked.query).sort()).toEqual([
      "createdAt",
      "status",
      "whatsAppMessageId",
    ]);
    expect(asked.query["status"]).toBe(WhatsAppStatus.Queued);
    expect(asked).toMatchObject({ props: { isRoot: true } });
  });

  test("sent again once the log has the id: written, and counted once - timed from the log written before the send", async () => {
    const row: StoredLog = sendOnItsWay(3000);

    await webhook(statuses(status("delivered", at(1000), OTHER_MESSAGE_ID)));
    expectNothingCounted();

    sendsResultWritten(row);

    await webhook(statuses(status("delivered", at(1000), OTHER_MESSAGE_ID)));

    expect(sendStatusCalls).toEqual([503]);
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
    expect(storedStatus(OTHER_MESSAGE_ID)).toBe(WhatsAppStatus.Delivered);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
    expect(onlyDeliveryTime()).toBe(3000);
  });

  test("sent again, and again: still counted once", async () => {
    const row: StoredLog = sendOnItsWay();

    await webhook(statuses(status("failed", at(1000), OTHER_MESSAGE_ID)));
    sendsResultWritten(row);
    await webhook(statuses(status("failed", at(1000), OTHER_MESSAGE_ID)));
    await webhook(statuses(status("failed", at(1000), OTHER_MESSAGE_ID)));

    expect(storedStatus(OTHER_MESSAGE_ID)).toBe(WhatsAppStatus.Failed);
    expect(onlyDelivery()["outcome"]).toBe("failed");
    // The page it was sent for is corrected once.
    expect(timeline.writes).toHaveLength(1);
  });

  test("the statuses of other messages in the same request are handled now; sent again with it, they change nothing", async () => {
    const row: StoredLog = sendOnItsWay();
    const body: JSONObject = statuses(
      status("delivered"),
      status("read", at(1000), OTHER_MESSAGE_ID),
    );

    await webhook(body);

    expect(sendStatusCalls).toEqual([503]);
    expect(storedStatus()).toBe(WhatsAppStatus.Delivered);
    expect(deliveryCounterCalls).toHaveLength(1);

    sendsResultWritten(row);
    await webhook(body);

    expect(storedStatus()).toBe(WhatsAppStatus.Delivered);
    expect(storedStatus(OTHER_MESSAGE_ID)).toBe(WhatsAppStatus.Read);
    expect(
      deliveryCounterCalls.map((call: RecordedCall) => {
        return call.attributes["outcome"];
      }),
    ).toEqual(["delivered", "delivered"]);
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("the id written between the first look and the check for a send on its way: found on a second look, written and counted", async () => {
    const row: StoredLog = sendOnItsWay();
    const find: (input: { query: Record<string, unknown> }) => unknown =
      findByMessageId.getMockImplementation() as (input: {
        query: Record<string, unknown>;
      }) => unknown;

    findByMessageId.mockImplementationOnce(((input: {
      query: Record<string, unknown>;
    }) => {
      const found: unknown = find(input);
      // The send's result lands right after the first look.
      sendsResultWritten(row);
      return found;
    }) as never);

    await webhook(statuses(status("delivered", at(1000), OTHER_MESSAGE_ID)));

    expect(sendStatusCalls).toEqual([]);
    expect(findByMessageId).toHaveBeenCalledTimes(3);
    expect(storedStatus(OTHER_MESSAGE_ID)).toBe(WhatsAppStatus.Delivered);
    expect(onlyDelivery()["outcome"]).toBe("delivered");
  });

  test("an old status - by Meta's time - is not asked for again, even while a message is being sent: answered 200, with a warning", async () => {
    sendOnItsWay();

    expect(STATUS_SENT_AGAIN_WITHIN_MS).toBe(10 * 60 * 1000);

    await webhook(
      statuses(
        status(
          "delivered",
          at(STATUS_SENT_AGAIN_WITHIN_MS + 1000),
          OTHER_MESSAGE_ID,
        ),
      ),
    );

    expect(sendStatusCalls).toEqual([]);
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `[Meta WhatsApp Webhook] No WhatsApp log found for message id ${OTHER_MESSAGE_ID} (status: delivered).`,
      {},
    );
    expectNothingCounted();
  });

  test.each([
    ["no time", { timestamp: undefined }],
    ["a time that cannot be read", { timestamp: "yesterday" }],
    ["an empty time", { timestamp: " " }],
  ])(
    "a status with %s is not asked for again: answered 200",
    async (_name: string, more: JSONObject) => {
      sendOnItsWay();

      await webhook(statuses(status("delivered", more, OTHER_MESSAGE_ID)));

      expect(sendStatusCalls).toEqual([]);
      expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
    },
  );

  test("a recent status while nothing is being sent - another app's message, a test from the Admin Dashboard: answered 200, with a warning", async () => {
    await webhook(statuses(status("delivered", at(1000), OTHER_MESSAGE_ID)));

    expect(sendStatusCalls).toEqual([]);
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `[Meta WhatsApp Webhook] No WhatsApp log found for message id ${OTHER_MESSAGE_ID} (status: delivered).`,
      {},
    );
  });

  test("a send on its way for longer than five minutes never finished: not waited for", async () => {
    sendOnItsWay(SEND_ON_ITS_WAY_FOR_MS + 1000);

    await webhook(statuses(status("delivered", at(1000), OTHER_MESSAGE_ID)));

    expect(sendStatusCalls).toEqual([]);
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a log Queued that has its message's id - Meta said queued - is no send on its way", async () => {
    stored.set(MESSAGE_ID, {
      id: LOG_ID,
      status: WhatsAppStatus.Queued,
      createdAt: new Date(NOW - 1000),
    });

    await webhook(statuses(status("delivered", at(1000), OTHER_MESSAGE_ID)));

    expect(sendStatusCalls).toEqual([]);
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });

  test("a log of a send that failed - Error, no id - is no send on its way", async () => {
    sendOnItsWay().status = WhatsAppStatus.Error;

    await webhook(statuses(status("delivered", at(1000), OTHER_MESSAGE_ID)));

    expect(sendStatusCalls).toEqual([]);
  });
});

describe("what the webhook's log lines say: a message's id and status, never its recipient's number (issue #6684)", () => {
  function everyLogLine(): string {
    return JSON.stringify([
      warn.mock.calls,
      (logger.debug as unknown as jest.Mock).mock.calls,
      (logger.error as unknown as jest.Mock).mock.calls,
      (logger.info as unknown as jest.Mock).mock.calls,
    ]);
  }

  test("a status of a message no log has", async () => {
    await webhook(statuses(status("failed", {}, OTHER_MESSAGE_ID)));

    expect(everyLogLine()).toContain(OTHER_MESSAGE_ID);
    expect(everyLogLine()).not.toContain(RECIPIENT);
    expect(everyLogLine()).not.toContain(CONVERSATION_ID);
  });

  test("a status asked for again", async () => {
    onTheirWay.push({
      id: OTHER_LOG_ID,
      status: WhatsAppStatus.Queued,
      createdAt: new Date(NOW - 1000),
    });

    await webhook(
      statuses(
        status(
          "delivered",
          { timestamp: String(Math.floor(NOW / 1000)) },
          OTHER_MESSAGE_ID,
        ),
      ),
    );

    expect(sendStatusCalls).toEqual([503]);
    expect(everyLogLine()).toContain(OTHER_MESSAGE_ID);
    expect(everyLogLine()).not.toContain(RECIPIENT);
  });

  test("a status with no message id: a warning with its status only", async () => {
    await webhook(statuses({ status: "delivered", recipient_id: RECIPIENT }));

    expect(warn).toHaveBeenCalledWith(
      "[Meta WhatsApp Webhook] Received a status without a message id (status: delivered).",
      {},
    );
    expect(everyLogLine()).not.toContain(RECIPIENT);
  });

  test("an event of another kind of account: its kind only", async () => {
    await webhook({
      ...statuses(status("delivered")),
      object: "page",
    });

    expect(everyLogLine()).toContain("page");
    expect(everyLogLine()).not.toContain(RECIPIENT);
  });

  test("a body with no entries: no body in the line", async () => {
    await webhook({
      object: "whatsapp_business_account",
      contacts: [{ wa_id: RECIPIENT }],
    });

    expect(warn).toHaveBeenCalledWith(
      "[Meta WhatsApp Webhook] Payload did not include entries array.",
      {},
    );
    expect(everyLogLine()).not.toContain(RECIPIENT);
  });

  test("a status that could not be handled: its message's id and the error", async () => {
    findByMessageId.mockImplementationOnce((() => {
      return Promise.reject(new Error("connection reset"));
    }) as never);

    await webhook(statuses(status("delivered")));

    expect(logger.error).toHaveBeenCalledWith(
      `[Meta WhatsApp Webhook] Could not handle the status of message id ${MESSAGE_ID}: Error: connection reset`,
      {},
    );
    expect(everyLogLine()).not.toContain(RECIPIENT);
  });
});

describe("the on-call page Meta could not deliver (issue #6683)", () => {
  const UNDELIVERABLE: JSONObject = {
    errors: [
      {
        code: 131026,
        title: "Message undeliverable",
        message: "Message undeliverable",
        error_data: { details: "Message Undeliverable." },
      },
    ],
  };

  test("a failed page: Sent becomes Error, with Meta's words - after the message is counted", async () => {
    await webhook(statuses(status("failed", UNDELIVERABLE)));

    expect(onlyDelivery()["outcome"]).toBe("failed");
    expect(timeline.writes).toEqual([
      {
        id: TIMELINE_ID.toString(),
        data: {
          status: UserNotificationStatus.Error,
          statusMessage: `Delivery status: Failed. Message ID: ${MESSAGE_ID}. Provider error: Message undeliverable (code 131026).`,
        },
      },
    ]);
  });

  test("written only while the page still says what was read: at its status and version", async () => {
    await webhook(statuses(status("failed", UNDELIVERABLE)));

    expect(updateTimeline.mock.calls[0]![0]).toMatchObject({
      query: {
        _id: TIMELINE_ID.toString(),
        status: UserNotificationStatus.Sent,
        version: 1,
      },
      props: { isRoot: true },
    });
  });

  test("a page still going out (Sending) is corrected too: Meta's report can land before the send's own write", async () => {
    timeline.get(TIMELINE_ID)!.status = UserNotificationStatus.Sending;

    await webhook(statuses(status("failed", UNDELIVERABLE)));

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
    "a page that is %s stays as it is",
    async (pageStatus: UserNotificationStatus) => {
      timeline.get(TIMELINE_ID)!.status = pageStatus;

      await webhook(statuses(status("failed", UNDELIVERABLE)));

      expect(onlyDelivery()["outcome"]).toBe("failed");
      expect(updateTimeline).not.toHaveBeenCalled();
      expect(timeline.get(TIMELINE_ID)!.status).toBe(pageStatus);
    },
  );

  test("a page acknowledged between the read and the write stays acknowledged", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Acknowledged;
    });

    await webhook(statuses(status("failed", UNDELIVERABLE)));

    expect(timeline.writes).toEqual([]);
    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Acknowledged,
    );
  });

  test("Meta's webhook sent twice: the page is written once", async () => {
    await webhook(statuses(status("failed", UNDELIVERABLE)));
    await webhook(statuses(status("failed", UNDELIVERABLE)));

    expect(timeline.writes).toHaveLength(1);
    expect(onlyDelivery()["outcome"]).toBe("failed");
  });

  test("failed twice in one request, handled at once: the page is written once", async () => {
    await webhook(
      statuses(
        status("failed", UNDELIVERABLE),
        status("failed", UNDELIVERABLE),
      ),
    );

    expect(timeline.writes).toHaveLength(1);
    expect(onlyDelivery()["outcome"]).toBe("failed");
  });

  test("the page written back to Sent after the correction - no news since - is not corrected again by a repeat", async () => {
    await webhook(statuses(status("failed", UNDELIVERABLE)));
    timeline.get(TIMELINE_ID)!.status = UserNotificationStatus.Sent;

    await webhook(statuses(status("failed", UNDELIVERABLE)));

    // Only the move into Failed corrects the page.
    expect(timeline.writes).toHaveLength(1);
  });

  test.each(["delivered", "read", "sent", "queued", "warning", "deleted"])(
    "'%s' changes no page",
    async (metaStatus: string) => {
      await webhook(statuses(status(metaStatus)));

      expect(findTimeline).not.toHaveBeenCalled();
      expect(timeline.writes).toEqual([]);
    },
  );

  test("failed after delivered - a stale status - changes no page", async () => {
    await webhook(statuses(status("delivered")));
    await webhook(statuses(status("failed", UNDELIVERABLE)));

    expect(storedStatus()).toBe(WhatsAppStatus.Delivered);
    expect(findTimeline).not.toHaveBeenCalled();
  });

  test("a message that was not a page touches no timeline", async () => {
    delete stored.get(MESSAGE_ID)!.userOnCallLogTimelineId;

    await webhook(statuses(status("failed", UNDELIVERABLE)));

    expect(onlyDelivery()["notification.on_call_page"]).toBe("false");
    expect(findTimeline).not.toHaveBeenCalled();
  });

  test("a page that cannot be written leaves the message counted, the error logged, and the request answered", async () => {
    updateTimeline.mockRejectedValue(new Error("connection reset") as never);

    const next: Mock = await webhook(statuses(status("failed", UNDELIVERABLE)));

    expect(next).not.toHaveBeenCalled();
    expect(storedStatus()).toBe(WhatsAppStatus.Failed);
    expect(onlyDelivery()["outcome"]).toBe("failed");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(sendEmptySuccess).toHaveBeenCalledTimes(1);
  });
});

describe("buildFailedDeliveryMessage: Meta's words for a failed page", () => {
  function words(more: JSONObject): string {
    return buildFailedDeliveryMessage({
      messageId: MESSAGE_ID,
      statusPayload: status("failed", more),
    });
  }

  const STATUS_PART: string = `Delivery status: Failed. Message ID: ${MESSAGE_ID}.`;

  test("no error given: the status and the message's id", () => {
    expect(words({})).toBe(STATUS_PART);
    expect(words({ errors: [] })).toBe(STATUS_PART);
  });

  test("a title and a code", () => {
    expect(
      words({
        errors: [{ code: 131049, title: "Message not delivered" }],
      }),
    ).toBe(
      `${STATUS_PART} Provider error: Message not delivered (code 131049).`,
    );
  });

  test("details that say more than the title follow it", () => {
    expect(
      words({
        errors: [
          {
            code: 131047,
            title: "Re-engagement message",
            error_data: {
              details:
                "Message failed to send because more than 24 hours have passed since the customer last replied.",
            },
          },
        ],
      }),
    ).toBe(
      `${STATUS_PART} Provider error: Re-engagement message (code 131047): Message failed to send because more than 24 hours have passed since the customer last replied.`,
    );
  });

  test("details that only say the title again are left out", () => {
    expect(
      words({
        errors: [
          {
            code: 131026,
            title: "Message undeliverable",
            error_data: { details: "Message Undeliverable." },
          },
        ],
      }),
    ).toBe(
      `${STATUS_PART} Provider error: Message undeliverable (code 131026).`,
    );
  });

  test("Meta's older payload - a detail, no error_data - and a message where there is no title", () => {
    expect(
      words({
        errors: [{ code: 470, message: "Message failed", detail: "Expired" }],
      }),
    ).toBe(
      `${STATUS_PART} Provider error: Message failed (code 470): Expired.`,
    );
  });

  test("a code alone", () => {
    expect(words({ errors: [{ code: 1 }] })).toBe(
      `${STATUS_PART} Provider error: code 1.`,
    );
  });

  test("names no recipient: the payload's number is not part of it", () => {
    expect(words({ errors: [{ code: 1, title: "x" }] })).not.toContain(
      RECIPIENT,
    );
  });
});

describe("isRecentStatus", () => {
  function at(seconds: unknown): JSONObject {
    return {
      id: MESSAGE_ID,
      status: "delivered",
      timestamp: seconds as JSONObject["timestamp"],
    };
  }

  const NOW_IN_SECONDS: number = Math.floor(NOW / 1000);

  test.each([
    ["now", NOW_IN_SECONDS, true],
    ["a minute ago", NOW_IN_SECONDS - 60, true],
    ["ten minutes ago", NOW_IN_SECONDS - 600, true],
    ["ten minutes and a second ago", NOW_IN_SECONDS - 601, false],
    ["a day ago", NOW_IN_SECONDS - 86400, false],
    ["a minute ahead - two clocks", NOW_IN_SECONDS + 60, true],
    ["as text", String(NOW_IN_SECONDS - 60), true],
  ])(
    "%s: %p is recent - %p",
    (_name: string, value: unknown, recent: boolean) => {
      expect(isRecentStatus(at(value))).toBe(recent);
    },
  );

  test.each([[undefined], [null], [""], ["  "], ["soon"], [Number.NaN]])(
    "%p cannot be read: not recent",
    (value: unknown) => {
      expect(isRecentStatus(at(value))).toBe(false);
    },
  );
});

describe("isStaleWhatsAppStatus", () => {
  const ALL: Array<WhatsAppStatus> = Object.values(WhatsAppStatus);

  test("once delivered, only read moves the message on", () => {
    for (const next of ALL) {
      expect(
        isStaleWhatsAppStatus({ current: WhatsAppStatus.Delivered, next }),
      ).toBe(next !== WhatsAppStatus.Read);
    }
  });

  test.each([WhatsAppStatus.Read, WhatsAppStatus.Failed])(
    "once %s, nothing moves the message on",
    (current: WhatsAppStatus) => {
      for (const next of ALL) {
        expect(isStaleWhatsAppStatus({ current, next })).toBe(true);
      }
    },
  );

  const NOTHING_FINAL_YET: Array<WhatsAppStatus | null | undefined> = [
    null,
    undefined,
    WhatsAppStatus.Sent,
    WhatsAppStatus.Queued,
    WhatsAppStatus.Warning,
    WhatsAppStatus.Error,
    WhatsAppStatus.Deleted,
    WhatsAppStatus.Unknown,
  ];

  test.each(NOTHING_FINAL_YET)(
    "a log at %s takes any status",
    (current: WhatsAppStatus | null | undefined) => {
      for (const next of ALL) {
        expect(isStaleWhatsAppStatus({ current, next })).toBe(false);
      }
    },
  );
});
