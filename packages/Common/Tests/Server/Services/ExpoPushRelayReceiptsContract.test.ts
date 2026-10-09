import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

import logger from "../../../Server/Utils/Logger";
import PushNotificationService, {
  ExpoDeviceNotRegisteredError,
  ExpoPushReceiptResult,
  ExpoPushRefusedError,
  MAX_EXPO_PUSH_RECEIPT_IDS_PER_REQUEST,
  RelayPushReceiptsResult,
} from "../../../Server/Services/PushNotificationService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import UserPushService from "../../../Server/Services/UserPushService";
import PushNotificationLog from "../../../Models/DatabaseModels/PushNotificationLog";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import APIException from "../../../Types/Exception/ApiException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import API, { APIRequestOptions } from "../../../Utils/API";
import {
  Expo,
  ExpoPushMessage,
  ExpoPushReceipt,
  ExpoPushTicket,
} from "expo-server-sdk";

/*
 * The push relay is how a self-hosted OneUptime without its own Expo access
 * token gets pages onto phones. Three things changed in what it says, and
 * each has to hold between servers and relays of different versions:
 *
 *  1. Its answer to a push Expo accepted names the push's receipt id
 *     ({ success: true, receiptId }). A server older than this reads
 *     `success` and nothing else; this server keeps the id to ask about.
 *  2. It answers receipts: POST /receipts with the ids, answered with each
 *     receipt's status, Expo's code and message - never a push token - read
 *     from Expo with the relay's access token, which the server has none of.
 *     Its address is the send address with /receipts in place of /send.
 *  3. Expo's refusals other than a gone token (MessageTooBig,
 *     MessageRateExceeded, InvalidCredentials...) are answered 502 with
 *     Expo's code and message, the shape of Expo's own error ticket. They
 *     were 500 "Server Error", and the server that relayed the page could
 *     only log that. A server older than this still fails the send, and now
 *     logs why; this one says it as a direct send says it.
 *
 * App/Tests/FeatureSet/Notification/PushRelayReceipts.test.ts runs these
 * over real HTTP, between real copies of the relay and of a self-hosted
 * server, in both version directions.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000501",
);

const TOKEN: string = "ExponentPushToken[contract-phone-000001]";

const RECEIPT_ID: string = "2d9b7c1e-6f3a-4b8d-8e2f-0a1b2c3d4e5f";
const OTHER_RECEIPT_ID: string = "2d9b7c1e-6f3a-4b8d-8e2f-0a1b2c3d4e60";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the relay's answer to Expo's other refusals", () => {
  test("502, Expo's message and its code, where Expo's own error ticket has them", () => {
    expect(PushNotificationService.RELAY_EXPO_REFUSAL_STATUS_CODE).toBe(502);
    expect(
      PushNotificationService.getRelayExpoRefusalAnswer(
        new ExpoPushRefusedError({
          code: "MessageTooBig",
          expoMessage: "Message too big",
        }),
      ),
    ).toEqual({
      message: "Message too big",
      details: { error: "MessageTooBig" },
    });
  });

  test("an error ticket that names no code is answered with its message alone", () => {
    expect(
      PushNotificationService.getRelayExpoRefusalAnswer(
        new ExpoPushRefusedError({ expoMessage: "Something went wrong" }),
      ),
    ).toEqual({ message: "Something went wrong" });
  });

  test("is recognised as exactly that", () => {
    expect(
      PushNotificationService.getRelayExpoRefusal(
        new HTTPErrorResponse(
          502,
          { message: "Message too big", details: { error: "MessageTooBig" } },
          {},
        ),
      ),
    ).toEqual({ code: "MessageTooBig", message: "Message too big" });
  });

  test.each([
    [
      "a gateway's own 502, with a JSON message and no code",
      502,
      { message: "Internal server error" },
    ],
    ["a 502 with no body worth reading", 502, {}],
    [
      "a 502 whose code is not text",
      502,
      { message: "x", details: { error: 42 } },
    ],
    [
      "a 502 whose code is empty",
      502,
      { message: "x", details: { error: "" } },
    ],
    [
      "a 502 whose details are a list",
      502,
      { message: "x", details: [{ error: "MessageTooBig" }] },
    ],
    [
      "a 502 whose details are text",
      502,
      { message: "x", details: "MessageTooBig" },
    ],
    [
      "a 502 with a code but no message",
      502,
      { details: { error: "MessageTooBig" } },
    ],
    [
      "Expo's code in an older relay's 500",
      500,
      { message: "x", details: { error: "MessageTooBig" } },
    ],
    [
      "Expo's code in a 400",
      400,
      { message: "x", details: { error: "MessageTooBig" } },
    ],
    [
      "the gone-token answer",
      410,
      PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
    ],
  ])("%s is not one", (_name: string, statusCode: number, body: JSONObject) => {
    expect(
      PushNotificationService.getRelayExpoRefusal(
        new HTTPErrorResponse(statusCode, body, {}),
      ),
    ).toBeNull();
  });

  /*
   * A server older than this treats every answer that is not a success as
   * a failed send and logs its body: "Push relay error: <body>".
   */
  test("tells a server older than this why the send failed, in the words it logs", () => {
    const olderServerLog: string = `Push relay error: ${JSON.stringify(
      new HTTPErrorResponse(
        502,
        PushNotificationService.getRelayExpoRefusalAnswer(
          new ExpoPushRefusedError({
            code: "MessageRateExceeded",
            expoMessage: "Too many messages to [push token]",
          }),
        ),
        {},
      ).jsonData,
    )}`;

    expect(olderServerLog).toBe(
      'Push relay error: {"message":"Too many messages to [push token]","details":{"error":"MessageRateExceeded"}}',
    );
  });
});

describe("the relay's own send (sendRelayPushNotification)", () => {
  let answer: ExpoPushTicket;

  beforeEach(() => {
    answer = { status: "ok", id: RECEIPT_ID };

    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    jest
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation((async () => {
        return [answer];
      }) as never);
  });

  async function relaySend(): Promise<unknown> {
    try {
      return await PushNotificationService.sendRelayPushNotification({
        to: TOKEN,
        title: "Incident #7",
        body: "Payments are down",
      });
    } catch (error) {
      return error;
    }
  }

  test("a push Expo accepted answers its receipt id", async () => {
    expect(await relaySend()).toBe(RECEIPT_ID);
  });

  test.each([
    ["no id", { status: "ok" }],
    ["an id that is not a receipt id", { status: "ok", id: "../x" }],
  ])(
    "a push Expo accepted with %s answers none",
    async (_name: string, ticket: unknown) => {
      answer = ticket as ExpoPushTicket;

      expect(await relaySend()).toBeUndefined();
    },
  );

  test.each([
    ["MessageTooBig", "Message too big"],
    ["MessageRateExceeded", "Too many messages"],
    ["InvalidCredentials", "The push credentials are not valid"],
    ["MismatchSenderId", "The FCM sender id does not match"],
    ["ProviderError", "APNs failed"],
  ])(
    "%s is a refusal of its own kind, with Expo's code and words",
    async (code: string, message: string) => {
      answer = {
        status: "error",
        message: message,
        details: { error: code as never },
      };

      const failure: unknown = await relaySend();

      expect(failure).toBeInstanceOf(ExpoPushRefusedError);
      expect(failure).not.toBeInstanceOf(ExpoDeviceNotRegisteredError);
      expect((failure as ExpoPushRefusedError).code).toBe(code);
      expect((failure as ExpoPushRefusedError).expoMessage).toBe(message);
      expect((failure as Error).message).toBe(
        `Failed to send push notification: ${message}`,
      );
    },
  );

  test("an error ticket with no code is still a refusal, without one", async () => {
    answer = { status: "error", message: "Something went wrong" };

    const failure: unknown = await relaySend();

    expect(failure).toBeInstanceOf(ExpoPushRefusedError);
    expect((failure as ExpoPushRefusedError).code).toBeUndefined();
  });

  test("a gone token is still the gone-token refusal", async () => {
    answer = {
      status: "error",
      message: `"${TOKEN}" is not a registered push notification recipient`,
      details: { error: "DeviceNotRegistered" },
    };

    expect(await relaySend()).toBeInstanceOf(ExpoDeviceNotRegisteredError);
  });

  /*
   * The token is the address that pages another installation's user. The
   * answer goes to whoever called the unauthenticated route, and the
   * relay's logs are read by the people who run it.
   */
  test("the token never reaches the answer or the relay's logs", async () => {
    answer = {
      status: "error",
      message: `Too many messages to "${TOKEN}" (and ExpoPushToken[another-one])`,
      details: { error: "MessageRateExceeded", expoPushToken: TOKEN },
    };

    const failure: unknown = await relaySend();

    expect((failure as ExpoPushRefusedError).expoMessage).toBe(
      'Too many messages to "[push token]" (and [push token])',
    );

    answer = { status: "ok", id: RECEIPT_ID };
    await relaySend();

    const logged: string = JSON.stringify([
      (logger.info as unknown as jest.Mock).mock.calls,
      (logger.error as unknown as jest.Mock).mock.calls,
    ]);

    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain("another-one");
  });
});

describe("the relay's answer to a server asking for receipts (getRelayPushReceipts)", () => {
  let expoAnswer: { [id: string]: ExpoPushReceipt };
  let asked: Array<Array<string>>;

  beforeEach(() => {
    asked = [];
    expoAnswer = {};

    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    jest
      .spyOn(Expo.prototype, "getPushNotificationReceiptsAsync")
      .mockImplementation((async (ids: Array<string>) => {
        asked.push(ids);
        return expoAnswer;
      }) as never);
  });

  test("each receipt's status, Expo's code and its message, the token taken out, and nothing else", async () => {
    expoAnswer = {
      [RECEIPT_ID]: {
        status: "ok",
        details: { something: 1 },
      } as ExpoPushReceipt,
      [OTHER_RECEIPT_ID]: {
        status: "error",
        message: `"${TOKEN}" is not a registered push notification recipient`,
        details: { error: "DeviceNotRegistered", expoPushToken: TOKEN },
        __debug: { internal: true },
      },
    };

    const answer: JSONObject =
      await PushNotificationService.getRelayPushReceipts([
        RECEIPT_ID,
        OTHER_RECEIPT_ID,
      ]);

    expect(asked).toEqual([[RECEIPT_ID, OTHER_RECEIPT_ID]]);
    expect(answer).toEqual({
      [RECEIPT_ID]: { status: "ok" },
      [OTHER_RECEIPT_ID]: {
        status: "error",
        message:
          '"[push token]" is not a registered push notification recipient',
        details: { error: "DeviceNotRegistered" },
      },
    });
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
  });

  test("a receipt that is not ready yet is left out, as Expo leaves it out", async () => {
    expoAnswer = { [RECEIPT_ID]: { status: "ok" } };

    expect(
      await PushNotificationService.getRelayPushReceipts([
        RECEIPT_ID,
        OTHER_RECEIPT_ID,
      ]),
    ).toEqual({ [RECEIPT_ID]: { status: "ok" } });
  });

  test("only the receipts asked about, whatever Expo adds", async () => {
    expoAnswer = {
      [RECEIPT_ID]: { status: "ok" },
      [OTHER_RECEIPT_ID]: { status: "ok" },
    };

    expect(
      await PushNotificationService.getRelayPushReceipts([RECEIPT_ID]),
    ).toEqual({ [RECEIPT_ID]: { status: "ok" } });
  });

  test("a relay without Expo credentials has none to give", async () => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);

    await expect(
      PushNotificationService.getRelayPushReceipts([RECEIPT_ID]),
    ).rejects.toThrow(
      "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
    );
    expect(asked).toEqual([]);
  });

  test("Expo cannot be asked: the failure is the caller's to see", async () => {
    jest
      .spyOn(Expo.prototype, "getPushNotificationReceiptsAsync")
      .mockRejectedValue(new Error("Expo is down"));

    await expect(
      PushNotificationService.getRelayPushReceipts([RECEIPT_ID]),
    ).rejects.toThrow("Expo is down");
  });
});

describe("reading receipts from Expo directly (getExpoPushReceipts)", () => {
  test("no ids, no request", async () => {
    const ask: SpyInstance<
      typeof Expo.prototype.getPushNotificationReceiptsAsync
    > = jest.spyOn(Expo.prototype, "getPushNotificationReceiptsAsync");

    expect(await PushNotificationService.getExpoPushReceipts([])).toEqual(
      new Map(),
    );
    expect(ask).not.toHaveBeenCalled();
  });

  test("only Expo's own answers count, never what every object inherits", async () => {
    jest
      .spyOn(Expo.prototype, "getPushNotificationReceiptsAsync")
      .mockResolvedValue({} as never);

    const receipts: Map<string, ExpoPushReceiptResult> =
      await PushNotificationService.getExpoPushReceipts([
        "constructor",
        "toString",
      ]);

    expect(receipts.size).toBe(0);
  });

  test("a receipt Expo wrote in a shape it does not use is not one", async () => {
    jest
      .spyOn(Expo.prototype, "getPushNotificationReceiptsAsync")
      .mockResolvedValue({
        [RECEIPT_ID]: { status: "pending" },
        [OTHER_RECEIPT_ID]: { status: "ok" },
      } as never);

    const receipts: Map<string, ExpoPushReceiptResult> =
      await PushNotificationService.getExpoPushReceipts([
        RECEIPT_ID,
        OTHER_RECEIPT_ID,
      ]);

    expect(Array.from(receipts.entries())).toEqual([
      [OTHER_RECEIPT_ID, { status: "ok" }],
    ]);
  });
});

describe("reading receipts through the relay (getExpoPushReceiptsThroughRelay)", () => {
  let posts: Array<APIRequestOptions>;
  let relayAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error;

  beforeEach(() => {
    posts = [];
    relayAnswer = new HTTPResponse<JSONObject>(200, { receipts: {} }, {});

    jest.spyOn(API, "post").mockImplementation((async (
      options: APIRequestOptions,
    ) => {
      posts.push(options);

      if (relayAnswer instanceof Error) {
        throw relayAnswer;
      }

      return relayAnswer;
    }) as never);
  });

  test("asks the relay at its /receipts address, with the ids", async () => {
    relayAnswer = new HTTPResponse<JSONObject>(
      200,
      {
        receipts: {
          [RECEIPT_ID]: { status: "ok" },
          [OTHER_RECEIPT_ID]: {
            status: "error",
            message: "Message too big",
            details: { error: "MessageTooBig" },
          },
        },
      },
      {},
    );

    const result: RelayPushReceiptsResult =
      await PushNotificationService.getExpoPushReceiptsThroughRelay([
        RECEIPT_ID,
        OTHER_RECEIPT_ID,
      ]);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.url.toString()).toBe(
      "https://oneuptime.com/api/notification/push-relay/receipts",
    );
    expect(posts[0]!.data).toEqual({ ids: [RECEIPT_ID, OTHER_RECEIPT_ID] });
    expect(result).toEqual({
      kind: "receipts",
      receipts: new Map<string, ExpoPushReceiptResult>([
        [RECEIPT_ID, { status: "ok" }],
        [
          OTHER_RECEIPT_ID,
          {
            status: "error",
            message: "Message too big",
            details: { error: "MessageTooBig" },
          },
        ],
      ]),
    });
  });

  test("receipts it was not asked about, and ones that are not receipts, are ignored", async () => {
    relayAnswer = new HTTPResponse<JSONObject>(
      200,
      {
        receipts: {
          [RECEIPT_ID]: "ok",
          "not-asked": { status: "ok" },
        },
      },
      {},
    );

    const result: RelayPushReceiptsResult =
      await PushNotificationService.getExpoPushReceiptsThroughRelay([
        RECEIPT_ID,
      ]);

    expect(result).toEqual({ kind: "receipts", receipts: new Map() });
  });

  test.each([[404], [405]])(
    "a relay older than receipts (%s) has none to give",
    async (statusCode: number) => {
      relayAnswer = new HTTPErrorResponse(statusCode, {}, {});

      expect(
        await PushNotificationService.getExpoPushReceiptsThroughRelay([
          RECEIPT_ID,
        ]),
      ).toEqual({ kind: "unavailable" });
    },
  );

  test.each([
    ["an error", new HTTPErrorResponse(500, { error: "Server Error" }, {})],
    [
      "its rate limit",
      new HTTPErrorResponse(429, { message: "slow down" }, {}),
    ],
    ["a refusal", new HTTPErrorResponse(400, { message: "bad ids" }, {})],
    [
      "a success with no receipts",
      new HTTPResponse<JSONObject>(200, { success: true }, {}),
    ],
    [
      "receipts that are a list",
      new HTTPResponse<JSONObject>(200, { receipts: [] as never }, {}),
    ],
    ["nothing (it cannot be reached)", new APIException("Connection refused")],
  ])(
    "a relay that answers %s fails, to be asked again later",
    async (
      _name: string,
      answer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error,
    ) => {
      relayAnswer = answer;

      await expect(
        PushNotificationService.getExpoPushReceiptsThroughRelay([RECEIPT_ID]),
      ).rejects.toThrow();
    },
  );

  test("no relay address to ask: none to give, and nothing is sent", async () => {
    jest
      .spyOn(PushNotificationService, "getRelayReceiptsUrl")
      .mockReturnValue(null);

    expect(
      await PushNotificationService.getExpoPushReceiptsThroughRelay([
        RECEIPT_ID,
      ]),
    ).toEqual({ kind: "unavailable" });
    expect(posts).toHaveLength(0);
  });
});

/*
 * Where a server asks its relay for receipts: the relay's send address
 * (PUSH_NOTIFICATION_RELAY_URL) with /receipts in place of /send. Read from
 * a copy of the product with its own configuration, changed per case.
 */
describe("the relay's receipts address (getRelayReceiptsUrl)", () => {
  let environment: Record<string, unknown>;
  let service: typeof PushNotificationService;

  beforeAll(() => {
    environment = {
      ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
        string,
        unknown
      >),
    };

    jest.isolateModules(() => {
      jest.doMock("../../../Server/EnvironmentConfig", () => {
        return environment;
      });

      service =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../../../Server/Services/PushNotificationService").default;
    });

    jest.dontMock("../../../Server/EnvironmentConfig");
  });

  test("the product's default relay", () => {
    expect(PushNotificationService.getRelayReceiptsUrl()).toBe(
      "https://oneuptime.com/api/notification/push-relay/receipts",
    );
  });

  test.each([
    [
      "https://oneuptime.com/api/notification/push-relay/send",
      "https://oneuptime.com/api/notification/push-relay/receipts",
    ],
    [
      "https://oneuptime.com/api/notification/push-relay/send/",
      "https://oneuptime.com/api/notification/push-relay/receipts",
    ],
    [
      "http://relay.internal:8080/api/notification/push-relay/send",
      "http://relay.internal:8080/api/notification/push-relay/receipts",
    ],
    [
      "https://relay.example.com/push-relay/send?region=eu",
      "https://relay.example.com/push-relay/receipts?region=eu",
    ],
  ])("%s answers receipts at %s", (sendUrl: string, receiptsUrl: string) => {
    environment["PushNotificationRelayUrl"] = sendUrl;

    expect(service.getRelayReceiptsUrl()).toBe(receiptsUrl);
  });

  test.each([
    ["no relay", ""],
    ["an address that is not one", "not a url"],
    ["an address that does not end in /send", "https://relay.example.com/push"],
    [
      "an address that only starts like one",
      "https://relay.example.com/sender",
    ],
    ["/send in the middle", "https://relay.example.com/send/push"],
  ])("%s: no receipts to ask for", (_name: string, sendUrl: string) => {
    environment["PushNotificationRelayUrl"] = sendUrl;

    expect(service.getRelayReceiptsUrl()).toBeNull();
  });
});

describe("a send through a relay that answers Expo's other refusals (sendViaRelay)", () => {
  let logs: Array<PushNotificationLog>;
  let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;
  let relayAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;

  beforeEach(() => {
    logs = [];
    relayAnswer = new HTTPResponse<JSONObject>(200, { success: true }, {});

    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);

    jest.spyOn(API, "post").mockImplementation((async () => {
      return relayAnswer;
    }) as never);

    markAsGone = jest
      .spyOn(UserPushService, "markExpoPushTokenAsGone")
      .mockResolvedValue(1);

    jest
      .spyOn(PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: PushNotificationLog }) => {
        logs.push(createBy.data);
        return createBy.data;
      }) as never);
  });

  async function relayedSend(): Promise<unknown> {
    try {
      await PushNotificationService.sendPushNotification(
        {
          devices: [{ token: TOKEN, name: "Pixel 8" }],
          message: { title: "Incident #7", body: "Payments are down" },
          deviceType: PushDeviceType.Android,
        },
        { projectId: PROJECT_ID },
      );
      return null;
    } catch (error) {
      return error;
    }
  }

  test.each([
    ["MessageTooBig", "Message too big"],
    ["MessageRateExceeded", "Too many messages to the device"],
    ["InvalidCredentials", "The push credentials are not valid"],
  ])(
    "%s: said as a direct send says it, and the phone is left as it is",
    async (code: string, message: string) => {
      relayAnswer = new HTTPErrorResponse(
        502,
        { message: message, details: { error: code } },
        {},
      );

      const failure: unknown = await relayedSend();

      expect((failure as Error).message).toBe(
        `Expo push notification failed: ${message}`,
      );
      expect(logs[0]!.statusMessage).toBe(
        `Expo push notification failed: ${message}`,
      );
      expect(markAsGone).not.toHaveBeenCalled();
    },
  );

  test("the same words as the same refusal sent directly", async () => {
    relayAnswer = new HTTPErrorResponse(
      502,
      { message: "Message too big", details: { error: "MessageTooBig" } },
      {},
    );

    const relayed: unknown = await relayedSend();

    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);
    jest
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation((async (_messages: Array<ExpoPushMessage>) => {
        return [
          {
            status: "error",
            message: "Message too big",
            details: { error: "MessageTooBig" },
          },
        ];
      }) as never);

    const direct: unknown = await relayedSend();

    expect((relayed as Error).message).toBe((direct as Error).message);
  });

  test("a relay that left the token in its words: it is taken out", async () => {
    relayAnswer = new HTTPErrorResponse(
      502,
      {
        message: `Too many messages to ${TOKEN}`,
        details: { error: "MessageRateExceeded" },
      },
      {},
    );

    const failure: unknown = await relayedSend();

    expect((failure as Error).message).toBe(
      "Expo push notification failed: Too many messages to [push token]",
    );
  });

  test("a gateway's own 502 is not Expo's refusal: said as the relay error it is", async () => {
    relayAnswer = new HTTPErrorResponse(
      502,
      { message: "Internal server error" },
      {},
    );

    const failure: unknown = await relayedSend();

    expect((failure as Error).message).toBe(
      'Push relay error: {"message":"Internal server error"}',
    );
  });

  test("an older relay's 500 is said as it always was", async () => {
    relayAnswer = new HTTPErrorResponse(500, { error: "Server Error" }, {});

    const failure: unknown = await relayedSend();

    expect((failure as Error).message).toBe(
      'Push relay error: {"error":"Server Error"}',
    );
  });
});

describe("what is said, and read, along the way", () => {
  test.each([
    ["a UUID, as Expo issues them", RECEIPT_ID, true],
    ["letters, digits and hyphens", "abc-123-XYZ", true],
    ["128 characters", "a".repeat(128), true],
    ["129 characters", "a".repeat(129), false],
    ["empty", "", false],
    ["with an underscore, as __proto__ has", "__proto__", false],
    ["a path", "../receipts", false],
    ["with spaces", "a b", false],
    ["a number", 42, false],
    ["nothing", undefined, false],
  ])(
    "a receipt id that is %s: %s",
    (_name: string, value: unknown, isOne: boolean) => {
      expect(PushNotificationService.isExpoPushReceiptId(value)).toBe(isOne);
    },
  );

  test("the most ids one request asks about is Expo's own chunk size", () => {
    expect(MAX_EXPO_PUSH_RECEIPT_IDS_PER_REQUEST).toBe(300);
  });

  test("every Expo push token is taken out of a message, in either spelling", () => {
    expect(
      PushNotificationService.withoutAnyPushToken(
        'Sent to "ExponentPushToken[abc]" and ExpoPushToken[def-123]; not to Token[x]',
      ),
    ).toBe('Sent to "[push token]" and [push token]; not to Token[x]');
  });

  test.each([
    ["ok", { status: "ok" }, { status: "ok" }],
    [
      "ok, with details it does not need",
      { status: "ok", details: { x: 1 } },
      { status: "ok" },
    ],
    [
      "an error with Expo's code",
      { status: "error", message: "m", details: { error: "MessageTooBig" } },
      { status: "error", message: "m", details: { error: "MessageTooBig" } },
    ],
    [
      "an error with no details",
      { status: "error", message: "m" },
      { status: "error", message: "m" },
    ],
    [
      "an error whose details are a list",
      { status: "error", message: "m", details: [{ error: "MessageTooBig" }] },
      { status: "error", message: "m" },
    ],
    [
      "an error whose message is not text",
      { status: "error", message: 42 },
      { status: "error", message: "" },
    ],
  ])("a receipt read: %s", (_name: string, raw: unknown, read: unknown) => {
    expect(PushNotificationService.readExpoPushReceipt(raw)).toEqual(read);
  });

  test.each([
    ["a status it does not use", { status: "pending" }],
    ["no status", { message: "m" }],
    ["text", "ok"],
    ["a list", [{ status: "ok" }]],
    ["nothing", null],
  ])("not a receipt: %s", (_name: string, raw: unknown) => {
    expect(PushNotificationService.readExpoPushReceipt(raw)).toBeNull();
  });

  test("a page Expo says never reached a gone phone", () => {
    expect(
      PushNotificationService.getUndeliveredExpoPushMessage({
        code: "DeviceNotRegistered",
      }),
    ).toBe(
      "Push notification not delivered. Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid. The device is marked as not receiving notifications; open the mobile app on it to register it again.",
    );
  });

  test("a page Expo says never reached a phone whose app has registered again since", () => {
    expect(
      PushNotificationService.getUndeliveredExpoPushMessage({
        code: "DeviceNotRegistered",
        registeredAgainSince: true,
      }),
    ).toBe(
      "Push notification not delivered. Expo said this device was not registered for push notifications when it was sent (DeviceNotRegistered). The mobile app has registered the device again since then, so it still receives notifications.",
    );
  });

  test.each([
    [
      "Expo's code and words",
      { code: "MessageRateExceeded", expoMessage: "Too many" },
      "Push notification not delivered. Expo could not deliver it to the device (MessageRateExceeded): Too many",
    ],
    [
      "Expo's code alone",
      { code: "MessageTooBig" },
      "Push notification not delivered. Expo could not deliver it to the device (MessageTooBig).",
    ],
    [
      "Expo's words alone",
      { expoMessage: "Something went wrong" },
      "Push notification not delivered. Expo could not deliver it to the device: Something went wrong",
    ],
    [
      "neither",
      {},
      "Push notification not delivered. Expo could not deliver it to the device.",
    ],
  ])(
    "any other page that never arrived: %s",
    (
      _name: string,
      data: { code?: string; expoMessage?: string },
      said: string,
    ) => {
      expect(PushNotificationService.getUndeliveredExpoPushMessage(data)).toBe(
        said,
      );
    },
  );

  test("a JSON object answer's field, and never one of a list", () => {
    expect(
      PushNotificationService.readAnswerField(
        new HTTPResponse<JSONObject>(200, { receiptId: RECEIPT_ID }, {}),
        "receiptId",
      ),
    ).toBe(RECEIPT_ID);
    expect(
      PushNotificationService.readAnswerField(
        new HTTPResponse<JSONObject>(
          200,
          [{ receiptId: RECEIPT_ID }] as never,
          {},
        ),
        "receiptId",
      ),
    ).toBeUndefined();
  });
});
