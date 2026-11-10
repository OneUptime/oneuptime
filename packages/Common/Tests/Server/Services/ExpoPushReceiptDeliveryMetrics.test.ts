import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PUSH'S RECEIPT, COUNTED FOR THE PLATFORM'S OPERATOR (issue #6648).
 *
 * About 15 minutes after a push Expo accepted, its receipt says whether
 * Apple or Google took it (ExpoPushReceiptService). Each receipt read is
 * counted once in notification.delivery.count: delivered; undelivered - the
 * phone's app is gone (DeviceNotRegistered); or failed - any other error. On
 * the way it was sent (Expo, with this installation's own access token, or
 * the push relay) and as an on-call page when it was one, as
 * notification.send.count said them. A receipt not ready yet, never found,
 * or that could not be asked for says nothing yet, and is not counted. No
 * receipt is timed: it says whether the push was taken, not when.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const deliveryCounterCalls: Array<RecordedCall> = [];
const deliveryDurationCalls: Array<RecordedCall> = [];
let failRecording: boolean = false;

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationDeliveryCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            if (failRecording) {
              throw new Error("The meter is gone.");
            }

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

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import Redis from "../../../Server/Infrastructure/Redis";
import ExpoPushReceiptService, {
  ExpoPushReceiptCheckSummary,
} from "../../../Server/Services/ExpoPushReceiptService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpoPushReceiptQueue,
  PendingExpoPushReceipt,
} from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API, { APIRequestOptions } from "../../../Utils/API";
import FakeSortedSetRedis from "../TestingUtils/Redis/FakeSortedSetRedis";
import { Expo, ExpoPushReceipt } from "expo-server-sdk";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const SENT_AT: number = Date.UTC(2026, 10, 10, 3, 0, 0);

const PHONE_TOKEN: string = "ExponentPushToken[delivery-phone-000001]";
const LOG_ID: string = "7f000000-0000-4000-8000-000000000601";
const TIMELINE_ID: string = "7f000000-0000-4000-8000-000000000602";

function receiptIdOf(index: number): string {
  return `9d4b3c61-5e9f-4c5a-8b4a-${String(index).padStart(12, "0")}`;
}

function pendingReceipt(
  index: number,
  overrides: Partial<PendingExpoPushReceipt> = {},
): PendingExpoPushReceipt {
  return {
    receiptId: receiptIdOf(index),
    deviceToken: PHONE_TOKEN,
    via: "expo",
    sentAt: SENT_AT,
    attempts: 0,
    pushNotificationLogId: LOG_ID,
    ...overrides,
  };
}

function refused(code: string | undefined): ExpoPushReceipt {
  return {
    status: "error",
    message: `"${PHONE_TOKEN}" could not be sent to`,
    ...(code ? { details: { error: code } } : {}),
  } as ExpoPushReceipt;
}

function delivery(
  provider: string,
  outcome: string,
  isOnCallPage: boolean = false,
): Record<string, string> {
  return {
    "notification.channel": "push",
    "notification.provider": provider,
    "notification.provider.config": "global",
    "notification.on_call_page": isOnCallPage ? "true" : "false",
    outcome: outcome,
  };
}

function counted(): Array<Record<string, string>> {
  return deliveryCounterCalls.map((call: RecordedCall) => {
    expect(call.value).toBe(1);
    return call.attributes;
  });
}

let redis: FakeSortedSetRedis;
let queue: ExpoPushReceiptQueue;
let now: number;

// What Expo and the relay answer for each receipt id; absent is "not ready yet".
let expoReceipts: Map<string, ExpoPushReceipt>;
let expoFailure: Error | null;
let relayReceipts: JSONObject;

async function check(): Promise<ExpoPushReceiptCheckSummary> {
  return await ExpoPushReceiptService.checkDueReceipts({
    queue: queue,
    now: () => {
      return now;
    },
  });
}

async function keep(receipts: Array<PendingExpoPushReceipt>): Promise<void> {
  await queue.add(receipts, SENT_AT);
}

beforeEach(() => {
  jest.clearAllMocks();

  deliveryCounterCalls.length = 0;
  deliveryDurationCalls.length = 0;
  failRecording = false;

  redis = new FakeSortedSetRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);

  queue = new ExpoPushReceiptQueue({ keyPrefix: "receipt-delivery-test" });
  now = SENT_AT + 15 * MINUTE;

  expoReceipts = new Map<string, ExpoPushReceipt>();
  expoFailure = null;
  relayReceipts = {};

  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockReturnValue(true);

  jest
    .spyOn(Expo.prototype, "getPushNotificationReceiptsAsync")
    .mockImplementation((async (ids: Array<string>) => {
      if (expoFailure) {
        throw expoFailure;
      }

      const answer: { [id: string]: ExpoPushReceipt } = {};

      for (const id of ids) {
        const receipt: ExpoPushReceipt | undefined = expoReceipts.get(id);

        if (receipt) {
          answer[id] = receipt;
        }
      }

      return answer;
    }) as never);

  jest.spyOn(API, "post").mockImplementation((async (
    _options: APIRequestOptions,
  ) => {
    return new HTTPResponse<JSONObject>(200, { receipts: relayReceipts }, {});
  }) as never);

  jest.spyOn(UserPushService, "markExpoPushTokenAsGone").mockResolvedValue(1);
  jest
    .spyOn(PushNotificationLogService, "updateOneBy")
    .mockResolvedValue(1 as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneBy")
    .mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("each receipt read, as Expo answered it", () => {
  test("a push Apple or Google took: delivered, through Expo, on the installation's own account - untimed", async () => {
    await keep([pendingReceipt(1)]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.delivered).toBe(1);
    expect(counted()).toEqual([delivery("expo", "delivered")]);
    expect(deliveryDurationCalls).toEqual([]);
  });

  test("DeviceNotRegistered - the phone's app is gone: undelivered", async () => {
    await keep([pendingReceipt(1)]);
    expoReceipts.set(receiptIdOf(1), refused("DeviceNotRegistered"));

    await check();

    expect(counted()).toEqual([delivery("expo", "undelivered")]);
  });

  test.each([
    "MessageTooBig",
    "MessageRateExceeded",
    "MismatchSenderId",
    "InvalidCredentials",
    "DeveloperError",
    "ExpoError",
    "ProviderError",
  ])("%s - Expo, Apple or Google could not send it: failed", async (code: string) => {
    await keep([pendingReceipt(1)]);
    expoReceipts.set(receiptIdOf(1), refused(code));

    await check();

    expect(counted()).toEqual([delivery("expo", "failed")]);
  });

  test("an error receipt that names no code: failed", async () => {
    await keep([pendingReceipt(1)]);
    expoReceipts.set(receiptIdOf(1), refused(undefined));

    await check();

    expect(counted()).toEqual([delivery("expo", "failed")]);
  });

  test("a run of several: one each, as each was answered", async () => {
    await keep([pendingReceipt(1), pendingReceipt(2), pendingReceipt(3)]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });
    expoReceipts.set(receiptIdOf(2), refused("DeviceNotRegistered"));
    expoReceipts.set(receiptIdOf(3), refused("MessageTooBig"));

    await check();

    expect(
      counted()
        .map((attributes: Record<string, string>): string => {
          return attributes["outcome"]!;
        })
        .sort(),
    ).toEqual(["delivered", "failed", "undelivered"]);
  });
});

describe("a push sent through the push relay", () => {
  beforeEach(() => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);
  });

  test.each([
    ["taken", "delivered", { status: "ok" }],
    ["DeviceNotRegistered", "undelivered", refused("DeviceNotRegistered")],
    ["MessageTooBig", "failed", refused("MessageTooBig")],
  ])(
    "its receipt, from the relay - %s: %s, through the push relay",
    async (_name: string, outcome: string, receipt: object) => {
      await keep([pendingReceipt(1, { via: "relay" })]);
      relayReceipts = { [receiptIdOf(1)]: receipt as JSONObject };

      await check();

      expect(counted()).toEqual([delivery("push_relay", outcome)]);
    },
  );
});

describe("an on-call page, as notification.send.count said it", () => {
  test("a page to one device - its timeline row kept with it - is a page", async () => {
    await keep([
      pendingReceipt(1, {
        userOnCallLogTimelineId: TIMELINE_ID,
        isOnCallPage: true,
      }),
    ]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });

    await check();

    expect(counted()).toEqual([delivery("expo", "delivered", true)]);
  });

  test("a page to several devices - no timeline row kept with any - is still a page, each", async () => {
    await keep([
      pendingReceipt(1, { isOnCallPage: true }),
      pendingReceipt(2, { isOnCallPage: true }),
    ]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });
    expoReceipts.set(receiptIdOf(2), refused("DeviceNotRegistered"));

    await check();

    expect(
      counted().map((attributes: Record<string, string>): string => {
        return attributes["notification.on_call_page"]!;
      }),
    ).toEqual(["true", "true"]);
  });

  test("an entry an older version kept says a page only by its timeline row: a page", async () => {
    await keep([pendingReceipt(1, { userOnCallLogTimelineId: TIMELINE_ID })]);
    expoReceipts.set(receiptIdOf(1), refused("DeviceNotRegistered"));

    await check();

    expect(counted()).toEqual([delivery("expo", "undelivered", true)]);
  });

  test("a push that was no page is no page", async () => {
    await keep([pendingReceipt(1)]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });

    await check();

    expect(counted()[0]!["notification.on_call_page"]).toBe("false");
  });
});

describe("each receipt is counted once", () => {
  test("read once: a second run finds it gone, and counts nothing more", async () => {
    await keep([pendingReceipt(1)]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });

    await check();

    now += HOUR;
    await check();

    expect(counted()).toEqual([delivery("expo", "delivered")]);
  });

  test("not ready yet: nothing counted - and counted once it is", async () => {
    await keep([pendingReceipt(1)]);

    const first: ExpoPushReceiptCheckSummary = await check();

    expect(first.notReadyYet).toBe(1);
    expect(deliveryCounterCalls).toEqual([]);

    expoReceipts.set(receiptIdOf(1), refused("DeviceNotRegistered"));
    now += 24 * HOUR;

    await check();
    await check();

    expect(counted()).toEqual([delivery("expo", "undelivered")]);
  });

  test("Expo could not be asked: nothing counted, the receipt is looked for again", async () => {
    await keep([pendingReceipt(1)]);
    expoFailure = new Error("socket hang up");

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.couldNotFetch).toBe(1);
    expect(deliveryCounterCalls).toEqual([]);
  });

  test("never found before Expo cleared it: given up, and nothing is known to count", async () => {
    await keep([pendingReceipt(1, { attempts: 7 })]);
    now = SENT_AT + 23 * HOUR;

    await check();

    expect(deliveryCounterCalls).toEqual([]);
  });

  test("this server can no longer ask for it - its Expo access token is gone: dropped, not counted", async () => {
    await keep([pendingReceipt(1)]);
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.dropped).toBe(1);
    expect(deliveryCounterCalls).toEqual([]);
  });
});

describe("what is counted, and what never is", () => {
  test("a metric that cannot be recorded changes nothing of the run: the page still says it was not delivered", async () => {
    failRecording = true;

    await keep([
      pendingReceipt(1, { userOnCallLogTimelineId: TIMELINE_ID }),
      pendingReceipt(2),
    ]);
    expoReceipts.set(receiptIdOf(1), refused("DeviceNotRegistered"));
    expoReceipts.set(receiptIdOf(2), { status: "ok" });

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.delivered).toBe(1);
    expect(summary.notDelivered).toBe(1);
    expect(UserOnCallLogTimelineService.updateOneBy).toHaveBeenCalledTimes(1);
    expect(PushNotificationLogService.updateOneBy).toHaveBeenCalledTimes(1);
  });

  test("no attribute names the phone, the receipt, the log or the page: only a few values each", async () => {
    await keep([
      pendingReceipt(1, {
        userOnCallLogTimelineId: TIMELINE_ID,
        isOnCallPage: true,
      }),
      pendingReceipt(2, { via: "relay" }),
    ]);
    expoReceipts.set(receiptIdOf(1), refused("DeviceNotRegistered"));
    relayReceipts = { [receiptIdOf(2)]: { status: "ok" } };

    await check();

    expect(deliveryCounterCalls).toHaveLength(2);

    const written: string = JSON.stringify(deliveryCounterCalls);

    for (const secret of [
      PHONE_TOKEN,
      receiptIdOf(1),
      receiptIdOf(2),
      LOG_ID,
      TIMELINE_ID,
    ]) {
      expect(written).not.toContain(secret);
    }

    for (const call of deliveryCounterCalls) {
      expect(Object.keys(call.attributes).sort()).toEqual(
        [
          "notification.channel",
          "notification.on_call_page",
          "notification.provider",
          "notification.provider.config",
          "outcome",
        ].sort(),
      );
    }
  });
});
