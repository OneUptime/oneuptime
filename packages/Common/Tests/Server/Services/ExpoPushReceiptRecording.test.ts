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
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS,
  ExpoPushReceiptQueue,
  PendingExpoPushReceipt,
} from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import PushNotificationLog from "../../../Models/DatabaseModels/PushNotificationLog";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import API, { APIRequestOptions } from "../../../Utils/API";
import FakeSortedSetRedis from "../TestingUtils/Redis/FakeSortedSetRedis";
import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";

/*
 * Every push Expo accepts is kept, for its receipt to be read about 15
 * minutes later (ExpoPushReceiptService): its receipt id, the token it was
 * sent to, how it was sent, and the rows that say it was sent - its push log
 * and, for a page to one device, the page's on-call timeline row.
 *
 * Pinned here: what is kept, for which sends, on both paths (this
 * deployment's own Expo access token, and the push relay); that a send Expo
 * refused, or whose ticket names no receipt, keeps nothing; that a relay
 * older than receipts - it answers without a receipt id - keeps nothing; and
 * that a Redis that is down never fails a page.
 */

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

const MINUTE: number = 60 * 1000;

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000401",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000402",
);

const PHONE_TOKEN: string = "ExponentPushToken[recorded-phone-000001]";
const TABLET_TOKEN: string = "ExponentPushToken[recorded-tablet-00002]";

const PENDING_KEY: string = "expo-push-receipts:pending";

function receiptIdOf(index: number): string {
  return `5b0a1f3e-7c2d-4e8f-9a1b-${String(index).padStart(12, "0")}`;
}

let redis: FakeSortedSetRedis;
let tickets: Map<string, ExpoPushTicket | Error>;
let createdLogs: Array<PushNotificationLog>;
let timelineUpdates: Array<{ status: unknown; statusMessage: unknown }>;
let logIds: Array<string>;

function kept(): Array<[PendingExpoPushReceipt, number]> {
  return redis
    .ordered(PENDING_KEY)
    .map((entry: [string, number]): [PendingExpoPushReceipt, number] => {
      return [ExpoPushReceiptQueue.parse(entry[0])!, entry[1]];
    });
}

async function send(
  tokens: Array<string>,
  options: {
    deviceType?: PushDeviceType;
    userOnCallLogTimelineId?: ObjectID;
    projectId?: ObjectID | undefined;
  } = {},
): Promise<unknown> {
  try {
    await PushNotificationService.sendPushNotification(
      {
        devices: tokens.map((token: string) => {
          return { token: token, name: "iPhone 15" };
        }),
        message: {
          title: "Incident #7: Payments are down",
          body: "A new incident has been created.",
        },
        deviceType: options.deviceType || PushDeviceType.iOS,
      },
      {
        projectId: "projectId" in options ? options.projectId : PROJECT_ID,
        ...(options.userOnCallLogTimelineId
          ? { userOnCallLogTimelineId: options.userOnCallLogTimelineId }
          : {}),
      },
    );

    return null;
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  jest.clearAllMocks();

  redis = new FakeSortedSetRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);

  tickets = new Map<string, ExpoPushTicket | Error>([
    [PHONE_TOKEN, { status: "ok", id: receiptIdOf(1) }],
    [TABLET_TOKEN, { status: "ok", id: receiptIdOf(2) }],
  ]);

  createdLogs = [];
  timelineUpdates = [];
  logIds = [
    "7f000000-0000-4000-8000-000000000411",
    "7f000000-0000-4000-8000-000000000412",
  ];

  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockReturnValue(true);

  jest
    .spyOn(Expo.prototype, "sendPushNotificationsAsync")
    .mockImplementation((async (messages: Array<ExpoPushMessage>) => {
      const ticket: ExpoPushTicket | Error | undefined = tickets.get(
        messages[0]!.to as string,
      );

      if (ticket instanceof Error) {
        throw ticket;
      }

      return [ticket || { status: "ok", id: receiptIdOf(99) }];
    }) as never);

  jest
    .spyOn(PushNotificationLogService, "create")
    .mockImplementation((async (createBy: { data: PushNotificationLog }) => {
      const log: PushNotificationLog = createBy.data;
      log.id = new ObjectID(logIds[createdLogs.length]!);
      createdLogs.push(log);
      return log;
    }) as never);

  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockImplementation((async (updateBy: {
      data: { status: unknown; statusMessage: unknown };
    }) => {
      timelineUpdates.push(updateBy.data);
      return 1;
    }) as never);

  jest.spyOn(UserPushService, "markExpoPushTokenAsGone").mockResolvedValue(1);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a push Expo accepts, sent with this deployment's Expo access token", () => {
  test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
    "%s: an on-call page is kept with its receipt id, its token, its push log and its timeline row, to be read 15 minutes on",
    async (deviceType: PushDeviceType) => {
      const before: number = Date.now();

      const failure: unknown = await send([PHONE_TOKEN], {
        deviceType: deviceType,
        userOnCallLogTimelineId: TIMELINE_ID,
      });

      const after: number = Date.now();

      expect(failure).toBeNull();

      const entries: Array<[PendingExpoPushReceipt, number]> = kept();

      expect(entries).toHaveLength(1);

      const [entry, checkAt] = entries[0]!;

      expect(entry).toEqual({
        receiptId: receiptIdOf(1),
        deviceToken: PHONE_TOKEN,
        via: "expo",
        sentAt: entry.sentAt,
        attempts: 0,
        pushNotificationLogId: logIds[0],
        userOnCallLogTimelineId: TIMELINE_ID.toString(),
      });
      expect(entry.sentAt).toBeGreaterThanOrEqual(before);
      expect(entry.sentAt).toBeLessThanOrEqual(after);
      expect(checkAt).toBe(
        entry.sentAt + EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS,
      );
      expect(EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS).toBe(15 * MINUTE);

      // The page itself is reported as it always was.
      expect(timelineUpdates).toEqual([
        {
          status: UserNotificationStatus.Sent,
          statusMessage: "Push notification sent successfully",
        },
      ]);
    },
  );

  test("a send to several devices keeps each with its own push log, and none with the timeline row another device answered for", async () => {
    await send([PHONE_TOKEN, TABLET_TOKEN], {
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    const entries: Array<PendingExpoPushReceipt> = kept().map(
      (entry: [PendingExpoPushReceipt, number]) => {
        return entry[0];
      },
    );

    expect(entries).toHaveLength(2);
    expect(
      entries.map((entry: PendingExpoPushReceipt) => {
        return [
          entry.receiptId,
          entry.deviceToken,
          entry.pushNotificationLogId,
        ];
      }),
    ).toEqual(
      expect.arrayContaining([
        [receiptIdOf(1), PHONE_TOKEN, logIds[0]],
        [receiptIdOf(2), TABLET_TOKEN, logIds[1]],
      ]),
    );
    expect(
      entries.every((entry: PendingExpoPushReceipt) => {
        return entry.userOnCallLogTimelineId === undefined;
      }),
    ).toBe(true);
    // One round trip for the whole send.
    expect(
      redis.calls.filter((call: string) => {
        return call === "exec";
      }),
    ).toHaveLength(1);
  });

  test("a send that writes no push log (no project) keeps the receipt without one", async () => {
    await send([PHONE_TOKEN], { projectId: undefined });

    expect(createdLogs).toHaveLength(0);
    expect(kept()[0]![0].pushNotificationLogId).toBeUndefined();
    expect(kept()[0]![0].receiptId).toBe(receiptIdOf(1));
  });

  test("a push log written without an id (as some callers' stand-ins answer) is simply not kept with it", async () => {
    jest
      .spyOn(PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: PushNotificationLog }) => {
        return createBy.data;
      }) as never);

    await send([PHONE_TOKEN]);

    expect(kept()[0]![0].pushNotificationLogId).toBeUndefined();
  });

  test.each([
    [
      "DeviceNotRegistered",
      {
        status: "error",
        message: "not registered",
        details: { error: "DeviceNotRegistered" },
      },
    ],
    [
      "MessageTooBig",
      {
        status: "error",
        message: "too big",
        details: { error: "MessageTooBig" },
      },
    ],
    ["an error with no code", { status: "error", message: "nope" }],
  ])(
    "a push Expo refused (%s) keeps nothing: there is no receipt to read",
    async (_name: string, ticket: unknown) => {
      tickets.set(PHONE_TOKEN, ticket as ExpoPushTicket);

      await send([PHONE_TOKEN]);

      expect(kept()).toEqual([]);
    },
  );

  test.each([
    ["no id", { status: "ok" }],
    ["an empty id", { status: "ok", id: "" }],
    ["an id that is not a receipt id", { status: "ok", id: "../../etc" }],
  ])(
    "an accepted ticket with %s keeps nothing",
    async (_name: string, ticket: unknown) => {
      tickets.set(PHONE_TOKEN, ticket as ExpoPushTicket);

      const failure: unknown = await send([PHONE_TOKEN]);

      expect(failure).toBeNull();
      expect(kept()).toEqual([]);
    },
  );

  test("a request Expo did not answer keeps nothing", async () => {
    tickets.set(PHONE_TOKEN, new Error("ECONNRESET"));

    await send([PHONE_TOKEN]);

    expect(kept()).toEqual([]);
  });

  test("in a send where one device was refused, the accepted one is kept", async () => {
    tickets.set(PHONE_TOKEN, {
      status: "error",
      message: "not registered",
      details: { error: "DeviceNotRegistered" },
    });

    await send([PHONE_TOKEN, TABLET_TOKEN]);

    expect(
      kept().map((entry: [PendingExpoPushReceipt, number]) => {
        return entry[0].deviceToken;
      }),
    ).toEqual([TABLET_TOKEN]);
  });

  test("a browser's push has no Expo receipt: nothing is kept", async () => {
    jest
      .spyOn(
        PushNotificationService as unknown as {
          sendWebPushNotification: () => Promise<void>;
        },
        "sendWebPushNotification",
      )
      .mockResolvedValue(undefined);

    await send(['{"endpoint":"https://fcm.googleapis.com/fcm/send/x"}'], {
      deviceType: PushDeviceType.Web,
    });

    expect(kept()).toEqual([]);
    expect(redis.calls).toEqual([]);
  });

  test("Redis not connected: the page still goes out and is reported sent", async () => {
    isConnectedMock.mockReturnValue(false);

    const failure: unknown = await send([PHONE_TOKEN], {
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(failure).toBeNull();
    expect(timelineUpdates).toEqual([
      {
        status: UserNotificationStatus.Sent,
        statusMessage: "Push notification sent successfully",
      },
    ]);
    expect(redis.calls).toEqual([]);
  });

  test("a Redis that fails mid-way never fails the page", async () => {
    redis.failing.add("exec");

    const failure: unknown = await send([PHONE_TOKEN], {
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(failure).toBeNull();
    expect(createdLogs[0]!.status).toBe("Success");
  });
});

describe("a push sent through the push relay (no Expo access token on this server)", () => {
  let relayAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;
  let posts: Array<APIRequestOptions>;
  let expoSend: SpyInstance<typeof Expo.prototype.sendPushNotificationsAsync>;

  beforeEach(() => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);

    expoSend = jest.spyOn(Expo.prototype, "sendPushNotificationsAsync");

    posts = [];
    relayAnswer = new HTTPResponse<JSONObject>(
      200,
      { success: true, receiptId: receiptIdOf(7) },
      {},
    );

    jest.spyOn(API, "post").mockImplementation((async (
      options: APIRequestOptions,
    ) => {
      posts.push(options);
      return relayAnswer;
    }) as never);
  });

  test("is kept with the receipt id the relay answered, to be read from the relay", async () => {
    await send([PHONE_TOKEN], { userOnCallLogTimelineId: TIMELINE_ID });

    expect(expoSend).not.toHaveBeenCalled();
    expect(
      kept().map((entry: [PendingExpoPushReceipt, number]) => {
        return entry[0];
      }),
    ).toEqual([
      expect.objectContaining({
        receiptId: receiptIdOf(7),
        deviceToken: PHONE_TOKEN,
        via: "relay",
        attempts: 0,
        pushNotificationLogId: logIds[0],
        userOnCallLogTimelineId: TIMELINE_ID.toString(),
      }),
    ]);
  });

  /*
   * A relay older than this answers { success: true } and nothing more. It
   * has no receipts to give, so nothing is kept to ask it for.
   */
  test("a relay older than receipts names none: nothing is kept, and the page is sent as before", async () => {
    relayAnswer = new HTTPResponse<JSONObject>(200, { success: true }, {});

    const failure: unknown = await send([PHONE_TOKEN]);

    expect(failure).toBeNull();
    expect(kept()).toEqual([]);
  });

  test.each([
    ["a number", 42],
    ["a path", "../../receipts"],
    ["an object", { id: receiptIdOf(7) }],
    ["an empty string", ""],
  ])(
    "a receipt id that is %s is not one: nothing is kept",
    async (_name: string, receiptId: unknown) => {
      relayAnswer = new HTTPResponse<JSONObject>(
        200,
        { success: true, receiptId: receiptId as never },
        {},
      );

      await send([PHONE_TOKEN]);

      expect(kept()).toEqual([]);
    },
  );

  test("a relay whose address does not say where its receipts are: nothing is kept", async () => {
    jest
      .spyOn(PushNotificationService, "getRelayReceiptsUrl")
      .mockReturnValue(null);

    await send([PHONE_TOKEN]);

    expect(kept()).toEqual([]);
  });

  test("a relayed push the relay refused keeps nothing", async () => {
    relayAnswer = new HTTPErrorResponse(
      410,
      PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
      {},
    );

    await send([PHONE_TOKEN]);

    expect(kept()).toEqual([]);
  });
});
