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
 * log, written as Meta accepted the message (notification.delivery.duration).
 * On the installation's own WhatsApp Business account, as every message
 * is, and as an on-call page when its log names the page it was sent for,
 * as notification.send.count said it.
 *
 * The database is stood in for by rows the route reads and writes the way
 * Postgres would. The metrics SDK is stood in for, and keeps what it is
 * given.
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

jest.mock("../../FeatureSet/Notification/Services/WhatsAppService", () => {
  return { __esModule: true, default: { sendWhatsApp: jest.fn() } };
});

import WhatsAppAuthorization from "Common/Server/Middleware/WhatsAppAuthorization";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import {
  isStaleWhatsAppStatus,
  MAX_STATUS_WRITE_ATTEMPTS,
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

const findByMessageId: jest.Mock = WhatsAppLogService.findOneBy as jest.Mock;
const findById: jest.Mock = WhatsAppLogService.findOneById as jest.Mock;
const writeLog: jest.Mock =
  WhatsAppLogService.compareAndSetColumnsByIdWithoutHooks as jest.Mock;
const sendEmptySuccess: jest.Mock =
  Response.sendEmptySuccessResponse as jest.Mock;
const warn: jest.Mock = logger.warn as jest.Mock;

function rowById(id: ObjectID): StoredLog | undefined {
  return Array.from(stored.values()).find((row: StoredLog): boolean => {
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
    sendStatus: jest.fn(),
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

  // An on-call page's message, logged Sent as Meta accepted it (WhatsAppService).
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

  findByMessageId.mockImplementation(((input: {
    query: { whatsAppMessageId: string };
  }) => {
    return Promise.resolve(snapshot(stored.get(input.query.whatsAppMessageId)));
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
  });
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
