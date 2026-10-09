import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

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
import logger from "../../../Server/Utils/Logger";
import ExpoPushReceiptService, {
  EXPO_PUSH_RECEIPT_CHECK_JOB_NAME,
  EXPO_PUSH_RECEIPT_CHECK_TIME_BUDGET_MS,
  EXPO_PUSH_RECEIPT_CHECK_TIMEOUT_MS,
  ExpoPushReceiptCheckSummary,
  MAX_EXPO_PUSH_RECEIPTS_PER_RUN,
} from "../../../Server/Services/ExpoPushReceiptService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpoPushReceiptQueue,
  PendingExpoPushReceipt,
} from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import APIException from "../../../Types/Exception/ApiException";
import { JSONObject } from "../../../Types/JSON";
import PushStatus from "../../../Types/PushNotification/PushStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import API, { APIRequestOptions } from "../../../Utils/API";
import FakeSortedSetRedis from "../TestingUtils/Redis/FakeSortedSetRedis";
import { Expo, ExpoPushReceipt } from "expo-server-sdk";

/*
 * Reading the receipts of pushes Expo accepted (ExpoPushReceiptService),
 * about 15 minutes after each was sent.
 *
 * Expo usually says a phone is gone (DeviceNotRegistered) in a push's
 * receipt, not its ticket: APNs and FCM report an uninstalled app only when
 * they are handed a notification for it. OneUptime read only tickets, so
 * the first page to such a phone was lost without a word: its push log and
 * its on-call timeline row said it was sent, and the phone stayed verified
 * until a later push happened to be refused in its ticket.
 *
 * Pinned here, for receipts read from Expo (this deployment's own access
 * token) and from the push relay (self-hosted servers):
 *  - a receipt saying DeviceNotRegistered marks the token's devices, as a
 *    refused ticket does - unless the app registered the token again after
 *    the push was sent;
 *  - any receipt error turns the push log and the page's timeline row from
 *    "sent" to "not delivered", with the reason, and leaves a phone that is
 *    not gone alone;
 *  - receipts are read 300 a request, at most 9,000 a run, within a time
 *    budget; one that is not ready, or could not be fetched, is looked for
 *    again later until Expo has cleared it; one that cannot be asked for at
 *    all is dropped;
 *  - the push token reaches no log line and no row.
 *
 * Expo, the relay and the database are stood in for; the queue is the real
 * one, on an in-memory Redis (FakeSortedSetRedis).
 */

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const SENT_AT: number = Date.UTC(2026, 9, 8, 3, 0, 0);

const GONE_TOKEN: string = "ExponentPushToken[receipt-gone-00000001]";
const OTHER_TOKEN: string = "ExponentPushToken[receipt-other-0000002]";

const LOG_ID: string = "7f000000-0000-4000-8000-000000000201";
const TIMELINE_ID: string = "7f000000-0000-4000-8000-000000000202";

const GONE_MESSAGE: string =
  "Push notification not delivered. Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid. The device is marked as not receiving notifications; open the mobile app on it to register it again.";

const REGISTERED_AGAIN_MESSAGE: string =
  "Push notification not delivered. Expo said this device was not registered for push notifications when it was sent (DeviceNotRegistered). The mobile app has registered the device again since then, so it still receives notifications.";

const RELAY_RECEIPTS_URL: string =
  "https://oneuptime.com/api/notification/push-relay/receipts";

function receiptIdOf(index: number): string {
  return `8e3c2a52-4d8e-4b4f-9a39-${String(index).padStart(12, "0")}`;
}

function pendingReceipt(
  index: number,
  overrides: Partial<PendingExpoPushReceipt> = {},
): PendingExpoPushReceipt {
  return {
    receiptId: receiptIdOf(index),
    deviceToken: GONE_TOKEN,
    via: "expo",
    sentAt: SENT_AT,
    attempts: 0,
    ...overrides,
  };
}

// The receipt Expo writes for a gone token, its message naming the token.
function deviceNotRegistered(token: string): ExpoPushReceipt {
  return {
    status: "error",
    message: `"${token}" is not a registered push notification recipient`,
    details: { error: "DeviceNotRegistered", expoPushToken: token },
  };
}

type OtherReceiptError =
  | "MessageTooBig"
  | "MessageRateExceeded"
  | "MismatchSenderId"
  | "InvalidCredentials"
  | "DeveloperError"
  | "ExpoError"
  | "ProviderError";

const OTHER_RECEIPT_ERRORS: Array<[OtherReceiptError, string]> = [
  ["MessageTooBig", "The notification was over 4096 bytes"],
  ["MessageRateExceeded", "Too many notifications to this device"],
  ["MismatchSenderId", "The FCM sender id does not match"],
  ["InvalidCredentials", "The push credentials are not valid"],
  ["DeveloperError", "The message is malformed"],
  ["ExpoError", "Expo failed"],
  ["ProviderError", "APNs failed"],
];

let redis: FakeSortedSetRedis;
let queue: ExpoPushReceiptQueue;
let now: number;

// What Expo answers for each receipt id; absent is "not ready yet".
let expoReceipts: Map<string, ExpoPushReceipt>;
let expoRequests: Array<Array<string>>;
let expoFailure: Error | null;
let expoAsk: SpyInstance<typeof Expo.prototype.getPushNotificationReceiptsAsync>;
let afterEachExpoRequest: () => void;

let relayPosts: Array<APIRequestOptions>;
let relayAnswer: (
  ids: Array<string>,
) => HTTPResponse<JSONObject> | HTTPErrorResponse | Error;

let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;
let logUpdates: Array<{
  query: Record<string, unknown>;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}>;
let timelineUpdates: Array<{
  query: Record<string, unknown>;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}>;

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

function waiting(): Array<[PendingExpoPushReceipt, number]> {
  return redis
    .ordered(queue.getPendingKey())
    .map((entry: [string, number]): [PendingExpoPushReceipt, number] => {
      return [ExpoPushReceiptQueue.parse(entry[0])!, entry[1]];
    });
}

function everythingWritten(): string {
  const logged: Array<unknown> = [];

  for (const level of ["debug", "info", "warn", "error"] as const) {
    logged.push(
      ...(logger[level] as unknown as MockedFn).mock.calls.map(
        (call: Array<unknown>) => {
          return String(call[0]);
        },
      ),
    );
  }

  return JSON.stringify({
    logged: logged,
    logUpdates: logUpdates,
    timelineUpdates: timelineUpdates,
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  redis = new FakeSortedSetRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);

  queue = new ExpoPushReceiptQueue({ keyPrefix: "receipt-service-test" });
  now = SENT_AT + 15 * MINUTE;

  expoReceipts = new Map<string, ExpoPushReceipt>();
  expoRequests = [];
  expoFailure = null;
  afterEachExpoRequest = (): void => {};

  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockReturnValue(true);

  expoAsk = jest
    .spyOn(Expo.prototype, "getPushNotificationReceiptsAsync")
    .mockImplementation((async (ids: Array<string>) => {
      expoRequests.push([...ids]);
      afterEachExpoRequest();

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

  relayPosts = [];
  relayAnswer = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, { receipts: {} }, {});
  };

  jest.spyOn(API, "post").mockImplementation((async (
    options: APIRequestOptions,
  ) => {
    relayPosts.push(options);

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error =
      relayAnswer(((options.data as JSONObject)["ids"] as Array<string>) || []);

    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  }) as never);

  markAsGone = jest
    .spyOn(UserPushService, "markExpoPushTokenAsGone")
    .mockResolvedValue(1);

  logUpdates = [];
  jest
    .spyOn(PushNotificationLogService, "updateOneBy")
    .mockImplementation((async (updateBy: (typeof logUpdates)[number]) => {
      logUpdates.push(updateBy);
      return 1;
    }) as never);

  timelineUpdates = [];
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneBy")
    .mockImplementation((async (updateBy: (typeof timelineUpdates)[number]) => {
      timelineUpdates.push(updateBy);
      return 1;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the job's numbers", () => {
  test("one job, a run of at most 9,000 receipts within three minutes, a four-minute timeout", () => {
    expect(EXPO_PUSH_RECEIPT_CHECK_JOB_NAME).toBe(
      "PushNotification:CheckExpoPushReceipts",
    );
    expect(MAX_EXPO_PUSH_RECEIPTS_PER_RUN).toBe(9000);
    expect(EXPO_PUSH_RECEIPT_CHECK_TIME_BUDGET_MS).toBe(3 * MINUTE);
    expect(EXPO_PUSH_RECEIPT_CHECK_TIMEOUT_MS).toBe(4 * MINUTE);
    // The budget always ends a run before its job's timeout would.
    expect(EXPO_PUSH_RECEIPT_CHECK_TIME_BUDGET_MS).toBeLessThan(
      EXPO_PUSH_RECEIPT_CHECK_TIMEOUT_MS,
    );
  });
});

describe("receipts of pushes sent with this deployment's Expo access token", () => {
  test("nothing due: one read of Redis, nobody asked", async () => {
    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary).toEqual(ExpoPushReceiptService.createSummary());
    expect(expoAsk).not.toHaveBeenCalled();
    expect(relayPosts).toHaveLength(0);
    expect(redis.calls).toEqual(["zrangebyscore"]);
  });

  test("a push Apple or Google took: nothing changes, and its receipt is not looked for again", async () => {
    await keep([pendingReceipt(1, { pushNotificationLogId: LOG_ID })]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.checked).toBe(1);
    expect(summary.delivered).toBe(1);
    expect(expoRequests).toEqual([[receiptIdOf(1)]]);
    expect(markAsGone).not.toHaveBeenCalled();
    expect(logUpdates).toHaveLength(0);
    expect(timelineUpdates).toHaveLength(0);
    expect(waiting()).toEqual([]);
  });

  test("DeviceNotRegistered: the token's devices stop being verified, and the push log and the page's timeline row say it was not delivered, and what to do", async () => {
    await keep([
      pendingReceipt(1, {
        pushNotificationLogId: LOG_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ]);
    expoReceipts.set(receiptIdOf(1), deviceNotRegistered(GONE_TOKEN));

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary).toEqual({
      ...ExpoPushReceiptService.createSummary(),
      checked: 1,
      notDelivered: 1,
      tokensMarkedGone: 1,
    });

    // Every account's devices with the token, as a refused ticket marks them.
    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(markAsGone.mock.calls[0]![0]).toEqual({ deviceToken: GONE_TOKEN });

    expect(logUpdates).toEqual([
      {
        query: { _id: LOG_ID, status: PushStatus.Success },
        data: { status: PushStatus.Error, statusMessage: GONE_MESSAGE },
        props: { isRoot: true },
      },
    ]);
    expect(timelineUpdates).toEqual([
      {
        query: { _id: TIMELINE_ID, status: UserNotificationStatus.Sent },
        data: {
          status: UserNotificationStatus.Error,
          statusMessage: GONE_MESSAGE,
        },
        props: { isRoot: true },
      },
    ]);
    expect(GONE_MESSAGE).toBe(
      `Push notification not delivered. ${PushNotificationService.EXPO_PUSH_TOKEN_GONE_MESSAGE}`,
    );
    expect(waiting()).toEqual([]);
  });

  test("a phone paged three times before its receipts were read is marked once, and each page says it was not delivered", async () => {
    await keep([1, 2, 3].map((index: number) => {
      return pendingReceipt(index, {
        pushNotificationLogId: `7f000000-0000-4000-8000-00000000030${index}`,
      });
    }));

    for (const index of [1, 2, 3]) {
      expoReceipts.set(receiptIdOf(index), deviceNotRegistered(GONE_TOKEN));
    }

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(summary.tokensMarkedGone).toBe(1);
    expect(summary.notDelivered).toBe(3);
    expect(logUpdates).toHaveLength(3);
  });

  /*
   * An iPhone keeps its Expo push token through a reinstall: a page sent
   * while the app was removed is refused in its receipt after the app is
   * back and has registered the token again, which renewed it with Expo.
   * Marking the phone then would silence it until the app was next opened.
   */
  test("the app registered the token again after the push was sent: the phone is not marked, and the page still says it was not delivered", async () => {
    await keep([
      pendingReceipt(1, {
        pushNotificationLogId: LOG_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ]);
    expoReceipts.set(receiptIdOf(1), deviceNotRegistered(GONE_TOKEN));
    await queue.noteTokenRegistered(GONE_TOKEN, SENT_AT + 5 * MINUTE);

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(markAsGone).not.toHaveBeenCalled();
    expect(summary.tokensMarkedGone).toBe(0);
    expect(summary.notDelivered).toBe(1);
    expect(logUpdates[0]!.data["statusMessage"]).toBe(
      REGISTERED_AGAIN_MESSAGE,
    );
    expect(timelineUpdates[0]!.data["statusMessage"]).toBe(
      REGISTERED_AGAIN_MESSAGE,
    );
  });

  test.each([
    ["before the push was sent", -5 * MINUTE],
    ["the moment it was sent", 0],
  ])(
    "the app last registered the token %s: the phone is marked",
    async (_name: string, offset: number) => {
      await keep([pendingReceipt(1)]);
      expoReceipts.set(receiptIdOf(1), deviceNotRegistered(GONE_TOKEN));
      await queue.noteTokenRegistered(GONE_TOKEN, SENT_AT + offset);

      await check();

      expect(markAsGone).toHaveBeenCalledTimes(1);
    },
  );

  test("when the time a token registered cannot be read, the phone is marked, as a refused ticket marks it", async () => {
    await keep([pendingReceipt(1)]);
    expoReceipts.set(receiptIdOf(1), deviceNotRegistered(GONE_TOKEN));
    jest
      .spyOn(queue, "getTokenRegisteredAt")
      .mockRejectedValue(new Error("Redis read failed"));

    await check();

    expect(markAsGone).toHaveBeenCalledTimes(1);
  });

  test.each(OTHER_RECEIPT_ERRORS)(
    "%s (%s): the page says it was not delivered, in Expo's words; the phone is left as it is",
    async (code: OtherReceiptError, message: string) => {
      await keep([
        pendingReceipt(1, {
          pushNotificationLogId: LOG_ID,
          userOnCallLogTimelineId: TIMELINE_ID,
        }),
      ]);
      expoReceipts.set(receiptIdOf(1), {
        status: "error",
        message: message,
        details: { error: code },
      });

      const summary: ExpoPushReceiptCheckSummary = await check();

      const expected: string = `Push notification not delivered. Expo could not deliver it to the device (${code}): ${message}`;

      expect(markAsGone).not.toHaveBeenCalled();
      expect(summary.notDelivered).toBe(1);
      expect(summary.tokensMarkedGone).toBe(0);
      expect(logUpdates[0]!.data).toEqual({
        status: PushStatus.Error,
        statusMessage: expected,
      });
      expect(timelineUpdates[0]!.data).toEqual({
        status: UserNotificationStatus.Error,
        statusMessage: expected,
      });
      // For whoever runs the deployment: InvalidCredentials is theirs to fix.
      expect(logger.error).toHaveBeenCalledWith(
        `Expo push receipts: a push Expo accepted was not delivered (${code}): ${message}`,
      );
    },
  );

  test("an error receipt that names no code says what Expo said", async () => {
    await keep([pendingReceipt(1, { pushNotificationLogId: LOG_ID })]);
    expoReceipts.set(receiptIdOf(1), {
      status: "error",
      message: "Something went wrong",
    });

    await check();

    expect(markAsGone).not.toHaveBeenCalled();
    expect(logUpdates[0]!.data["statusMessage"]).toBe(
      "Push notification not delivered. Expo could not deliver it to the device: Something went wrong",
    );
  });

  test("an error receipt with no words says only that it was not delivered", async () => {
    await keep([pendingReceipt(1, { pushNotificationLogId: LOG_ID })]);
    expoReceipts.set(receiptIdOf(1), {
      status: "error",
      message: "",
      details: { error: "MessageTooBig" },
    });

    await check();

    expect(logUpdates[0]!.data["statusMessage"]).toBe(
      "Push notification not delivered. Expo could not deliver it to the device (MessageTooBig).",
    );
  });

  test("the push token reaches no log line and no row, whatever Expo's receipt says", async () => {
    await keep([
      pendingReceipt(1, {
        pushNotificationLogId: LOG_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
      pendingReceipt(2, {
        deviceToken: OTHER_TOKEN,
        pushNotificationLogId: LOG_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ]);
    expoReceipts.set(receiptIdOf(1), deviceNotRegistered(GONE_TOKEN));
    expoReceipts.set(receiptIdOf(2), {
      status: "error",
      // Another token than the one sent to, as a relay might name.
      message: `Too many messages to ${OTHER_TOKEN} and ExpoPushToken[someone-else]`,
      details: { error: "MessageRateExceeded" },
    });

    await check();

    const written: string = everythingWritten();

    expect(written).not.toContain(GONE_TOKEN);
    expect(written).not.toContain(OTHER_TOKEN);
    expect(written).not.toContain("someone-else");
    expect(logUpdates[1]!.data["statusMessage"]).toBe(
      "Push notification not delivered. Expo could not deliver it to the device (MessageRateExceeded): Too many messages to [push token] and [push token]",
    );
  });

  test("a status message is held to the 500 characters its columns take", async () => {
    await keep([
      pendingReceipt(1, {
        pushNotificationLogId: LOG_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ]);
    expoReceipts.set(receiptIdOf(1), {
      status: "error",
      message: "x".repeat(2000),
      details: { error: "ProviderError" },
    });

    await check();

    expect(String(logUpdates[0]!.data["statusMessage"])).toHaveLength(500);
    expect(String(timelineUpdates[0]!.data["statusMessage"])).toHaveLength(500);
  });

  test("a push that was not a page to one device changes no timeline row; one without a log changes no log", async () => {
    await keep([
      pendingReceipt(1, { pushNotificationLogId: LOG_ID }),
      pendingReceipt(2),
    ]);
    expoReceipts.set(receiptIdOf(1), deviceNotRegistered(GONE_TOKEN));
    expoReceipts.set(receiptIdOf(2), deviceNotRegistered(GONE_TOKEN));

    await check();

    expect(logUpdates).toHaveLength(1);
    expect(timelineUpdates).toHaveLength(0);
    // The token is still marked, for the push with no rows of its own too.
    expect(markAsGone).toHaveBeenCalledTimes(1);
  });

  test("a row that cannot be written is logged; the other row, and the rest of the run, still are", async () => {
    await keep([
      pendingReceipt(1, {
        pushNotificationLogId: LOG_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
      pendingReceipt(2, {
        deviceToken: OTHER_TOKEN,
        userOnCallLogTimelineId: "7f000000-0000-4000-8000-000000000299",
      }),
    ]);
    expoReceipts.set(receiptIdOf(1), deviceNotRegistered(GONE_TOKEN));
    expoReceipts.set(receiptIdOf(2), deviceNotRegistered(OTHER_TOKEN));

    jest
      .spyOn(PushNotificationLogService, "updateOneBy")
      .mockRejectedValue(new Error("database unavailable"));

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.notDelivered).toBe(2);
    expect(timelineUpdates).toHaveLength(2);
    expect(markAsGone).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not record on push log ${LOG_ID} that its push was not delivered`,
      ),
    );
  });

  test("a failure to mark the devices does not stop the page saying it was not delivered", async () => {
    await keep([pendingReceipt(1, { userOnCallLogTimelineId: TIMELINE_ID })]);
    expoReceipts.set(receiptIdOf(1), deviceNotRegistered(GONE_TOKEN));
    markAsGone.mockRejectedValue(new Error("database unavailable"));

    await check();

    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(timelineUpdates[0]!.data["statusMessage"]).toBe(GONE_MESSAGE);
  });

  test("a receipt that is not ready yet is looked for again later, one look more", async () => {
    await keep([pendingReceipt(1, { pushNotificationLogId: LOG_ID })]);

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.notReadyYet).toBe(1);
    expect(summary.gaveUp).toBe(0);
    expect(waiting()).toEqual([
      [
        pendingReceipt(1, { pushNotificationLogId: LOG_ID, attempts: 1 }),
        SENT_AT + 30 * MINUTE,
      ],
    ]);
    expect(logUpdates).toHaveLength(0);
  });

  test("ready by the next look: acted on then", async () => {
    await keep([pendingReceipt(1, { pushNotificationLogId: LOG_ID })]);

    await check();

    now = SENT_AT + 30 * MINUTE;
    expoReceipts.set(receiptIdOf(1), deviceNotRegistered(GONE_TOKEN));

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.notDelivered).toBe(1);
    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(waiting()).toEqual([]);
  });

  test("not there by the last look before Expo clears it: given up", async () => {
    await queue.add([pendingReceipt(1, { attempts: 6 })], SENT_AT);
    now = SENT_AT + 16 * HOUR;
    // Due now: put back where a sixth look would have left it.
    await redis.zadd(
      queue.getPendingKey(),
      now,
      ExpoPushReceiptQueue.serialize(pendingReceipt(1, { attempts: 6 })),
    );

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.gaveUp).toBe(1);
    expect(summary.notReadyYet).toBe(0);
    expect(waiting()).toEqual([]);
  });

  test("Expo cannot be asked: the receipts are looked for again later", async () => {
    await keep([pendingReceipt(1), pendingReceipt(2)]);
    expoFailure = new Error("request to https://exp.host failed, ECONNRESET");

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.couldNotFetch).toBe(2);
    expect(summary.notDelivered).toBe(0);
    expect(markAsGone).not.toHaveBeenCalled();
    expect(
      waiting().map((entry: [PendingExpoPushReceipt, number]) => {
        return entry[0].attempts;
      }),
    ).toEqual([1, 1]);
  });

  test("receipts are asked for 300 at a time, Expo's chunk size", async () => {
    await keep(
      Array.from({ length: 650 }, (_value: unknown, index: number) => {
        return pendingReceipt(index + 1);
      }),
    );

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(Expo.pushNotificationReceiptChunkSizeLimit).toBe(300);
    expect(
      expoRequests.map((ids: Array<string>) => {
        return ids.length;
      }),
    ).toEqual([300, 300, 50]);
    expect(summary.checked).toBe(650);
    expect(summary.notReadyYet).toBe(650);
  });

  test("a run reads at most 9,000; the rest wait for the next run, the longest due first", async () => {
    await keep(
      Array.from({ length: 9100 }, (_value: unknown, index: number) => {
        return pendingReceipt(index + 1, { sentAt: SENT_AT + index });
      }),
    );
    now = SENT_AT + HOUR;

    for (let index: number = 1; index <= 9100; index++) {
      expoReceipts.set(receiptIdOf(index), { status: "ok" });
    }

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.checked).toBe(9000);
    expect(summary.delivered).toBe(9000);
    expect(expoRequests).toHaveLength(30);
    expect(waiting()).toHaveLength(100);
    expect(waiting()[0]![0].receiptId).toBe(receiptIdOf(9001));
  });

  test("a run stops taking receipts when its time is up; the rest wait", async () => {
    await keep(
      Array.from({ length: 1500 }, (_value: unknown, index: number) => {
        return pendingReceipt(index + 1);
      }),
    );

    for (let index: number = 1; index <= 1500; index++) {
      expoReceipts.set(receiptIdOf(index), { status: "ok" });
    }

    // Expo takes just over a minute a request.
    afterEachExpoRequest = (): void => {
      now += MINUTE + 1000;
    };

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(expoRequests).toHaveLength(3);
    expect(summary.checked).toBe(900);
    expect(waiting()).toHaveLength(600);
  });

  test("a receipt not due yet is not read", async () => {
    await keep([
      pendingReceipt(1),
      pendingReceipt(2, { sentAt: SENT_AT + 10 * MINUTE }),
    ]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.checked).toBe(1);
    expect(expoRequests).toEqual([[receiptIdOf(1)]]);
    expect(waiting()).toEqual([
      [
        pendingReceipt(2, { sentAt: SENT_AT + 10 * MINUTE }),
        SENT_AT + 25 * MINUTE,
      ],
    ]);
  });

  test("this server no longer has the Expo access token they were sent with: they are dropped, and that is said", async () => {
    await keep([pendingReceipt(1), pendingReceipt(2)]);
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.dropped).toBe(2);
    expect(expoAsk).not.toHaveBeenCalled();
    expect(waiting()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("what a run found is logged once", async () => {
    await keep([pendingReceipt(1), pendingReceipt(2)]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });
    expoReceipts.set(receiptIdOf(2), deviceNotRegistered(GONE_TOKEN));

    await check();

    expect(logger.info).toHaveBeenCalledWith(
      "Expo push receipts: read 2; 1 delivered, 1 not delivered (1 gone token(s) marked), 0 not ready yet, 0 could not be fetched, 0 given up, 0 dropped.",
    );
  });

  test("the product's queue is the one read by default", async () => {
    const productQueue: ExpoPushReceiptQueue = new ExpoPushReceiptQueue();

    await productQueue.add([pendingReceipt(1)], SENT_AT);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });

    const summary: ExpoPushReceiptCheckSummary =
      await ExpoPushReceiptService.checkDueReceipts({
        now: () => {
          return now;
        },
      });

    expect(summary.delivered).toBe(1);
    expect(redis.zcard("expo-push-receipts:pending")).toBe(0);
  });
});

describe("receipts of pushes sent through the push relay", () => {
  function relayed(
    index: number,
    overrides: Partial<PendingExpoPushReceipt> = {},
  ): PendingExpoPushReceipt {
    return pendingReceipt(index, { via: "relay", ...overrides });
  }

  function relayReceipts(receipts: JSONObject): void {
    relayAnswer = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(200, { receipts: receipts }, {});
    };
  }

  test("are asked of the relay, at its /receipts address, with their ids - never of Expo", async () => {
    await keep([relayed(1), relayed(2)]);

    await check();

    expect(relayPosts).toHaveLength(1);
    expect(relayPosts[0]!.url.toString()).toBe(RELAY_RECEIPTS_URL);
    expect(relayPosts[0]!.data).toEqual({
      ids: [receiptIdOf(1), receiptIdOf(2)],
    });
    // This server holds no Expo credentials to ask with.
    expect(expoAsk).not.toHaveBeenCalled();
  });

  test("DeviceNotRegistered from the relay: marked, and the page says it was not delivered, as from Expo", async () => {
    await keep([
      relayed(1, {
        pushNotificationLogId: LOG_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ]);
    relayReceipts({
      [receiptIdOf(1)]: {
        status: "error",
        message: "[push token] is not a registered push notification recipient",
        details: { error: "DeviceNotRegistered" },
      },
    });

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(markAsGone.mock.calls[0]![0]).toEqual({ deviceToken: GONE_TOKEN });
    expect(summary.tokensMarkedGone).toBe(1);
    expect(logUpdates[0]!.data["statusMessage"]).toBe(GONE_MESSAGE);
    expect(timelineUpdates[0]!.data["statusMessage"]).toBe(GONE_MESSAGE);
  });

  test("delivered, and another refusal, as from Expo", async () => {
    await keep([
      relayed(1, { pushNotificationLogId: LOG_ID }),
      relayed(2, { pushNotificationLogId: LOG_ID }),
    ]);
    relayReceipts({
      [receiptIdOf(1)]: { status: "ok" },
      [receiptIdOf(2)]: {
        status: "error",
        message: "Message too big",
        details: { error: "MessageTooBig" },
      },
    });

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.delivered).toBe(1);
    expect(summary.notDelivered).toBe(1);
    expect(markAsGone).not.toHaveBeenCalled();
    expect(logUpdates).toHaveLength(1);
    expect(logUpdates[0]!.data["statusMessage"]).toBe(
      "Push notification not delivered. Expo could not deliver it to the device (MessageTooBig): Message too big",
    );
  });

  test("a receipt the relay does not have yet is looked for again later; one it was not asked about is ignored", async () => {
    await keep([relayed(1)]);
    relayReceipts({
      [receiptIdOf(99)]: {
        status: "error",
        message: "x",
        details: { error: "DeviceNotRegistered" },
      },
    });

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(summary.notReadyYet).toBe(1);
    expect(markAsGone).not.toHaveBeenCalled();
    expect(waiting()[0]![0].attempts).toBe(1);
  });

  test.each([
    ["404", 404],
    ["405", 405],
  ])(
    "a relay older than receipts (%s): they are dropped, and the relay is not asked again in the run",
    async (_name: string, statusCode: number) => {
      await keep(
        Array.from({ length: 600 }, (_value: unknown, index: number) => {
          return relayed(index + 1);
        }),
      );
      relayAnswer = (): HTTPErrorResponse => {
        return new HTTPErrorResponse(statusCode, { error: "Not Found" }, {});
      };

      const summary: ExpoPushReceiptCheckSummary = await check();

      expect(relayPosts).toHaveLength(1);
      expect(summary.dropped).toBe(600);
      expect(waiting()).toEqual([]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    [
      "an error",
      (): HTTPErrorResponse => {
        return new HTTPErrorResponse(500, { error: "Server Error" }, {});
      },
    ],
    [
      "its rate limit",
      (): HTTPErrorResponse => {
        return new HTTPErrorResponse(
          429,
          { message: "Rate limit exceeded. Please try again later." },
          {},
        );
      },
    ],
    [
      "that it is not configured",
      (): HTTPErrorResponse => {
        return new HTTPErrorResponse(
          400,
          {
            message:
              "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
          },
          {},
        );
      },
    ],
    [
      "nothing at all (it cannot be reached)",
      (): APIException => {
        return new APIException("Connection refused");
      },
    ],
    [
      "a success with no receipts in it",
      (): HTTPResponse<JSONObject> => {
        return new HTTPResponse<JSONObject>(200, { success: true }, {});
      },
    ],
  ])(
    "a relay that answers %s: looked for again later",
    async (
      _name: string,
      answer: () => HTTPResponse<JSONObject> | HTTPErrorResponse | Error,
    ) => {
      await keep([relayed(1), relayed(2)]);
      relayAnswer = answer;

      const summary: ExpoPushReceiptCheckSummary = await check();

      expect(summary.couldNotFetch).toBe(2);
      expect(summary.dropped).toBe(0);
      expect(
        waiting().map((entry: [PendingExpoPushReceipt, number]) => {
          return entry[0].attempts;
        }),
      ).toEqual([1, 1]);
    },
  );

  test("a relay whose address does not say where its receipts are: they are dropped", async () => {
    await keep([relayed(1)]);
    jest
      .spyOn(PushNotificationService, "getRelayReceiptsUrl")
      .mockReturnValue(null);

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(relayPosts).toHaveLength(0);
    expect(summary.dropped).toBe(1);
  });

  test("a batch of both kinds asks each where it was sent", async () => {
    await keep([pendingReceipt(1), relayed(2), pendingReceipt(3), relayed(4)]);
    expoReceipts.set(receiptIdOf(1), { status: "ok" });
    expoReceipts.set(receiptIdOf(3), { status: "ok" });
    relayReceipts({
      [receiptIdOf(2)]: { status: "ok" },
      [receiptIdOf(4)]: { status: "ok" },
    });

    const summary: ExpoPushReceiptCheckSummary = await check();

    expect(expoRequests).toEqual([[receiptIdOf(1), receiptIdOf(3)]]);
    expect(relayPosts[0]!.data).toEqual({
      ids: [receiptIdOf(2), receiptIdOf(4)],
    });
    expect(summary.delivered).toBe(4);
  });
});
