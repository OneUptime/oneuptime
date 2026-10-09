import PushRelayRouter, {
  parseRelayReceiptIds,
  RelayRateLimiter,
} from "../../../FeatureSet/Notification/API/PushRelay";
import PushNotificationService from "Common/Server/Services/PushNotificationService";
import type PushNotificationLogService from "Common/Server/Services/PushNotificationLogService";
import type UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import type UserPushService from "Common/Server/Services/UserPushService";
import type ExpoPushReceiptService from "Common/Server/Services/ExpoPushReceiptService";
import type { ExpoPushReceiptCheckSummary } from "Common/Server/Services/ExpoPushReceiptService";
import type {
  ExpoPushReceiptQueue,
  PendingExpoPushReceipt,
} from "Common/Server/Infrastructure/ExpoPushReceiptQueue";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import API from "Common/Utils/API";
import FakeSortedSetRedis from "Common/Tests/Server/TestingUtils/Redis/FakeSortedSetRedis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

/*
 * Expo usually says a phone is gone (DeviceNotRegistered) in a push's
 * receipt, about 15 minutes after the send, not in its ticket. A self-hosted
 * OneUptime without its own EXPO_ACCESS_TOKEN sends its pages through
 * oneuptime.com's push relay, and has no credentials to read receipts with.
 *
 * So the relay names the receipt of each push it sent ({ success: true,
 * receiptId }), and answers receipts (POST /receipts) from Expo with its own
 * credentials. It keeps nothing: each server keeps its own receipt ids, and
 * asks about them when they are due (its workers' ExpoPushReceiptService).
 * The relay also answers Expo's other refusals with Expo's code and words
 * (502) instead of 500 "Server Error".
 *
 * Neither side upgrades with the other, and both directions are run here:
 *  - an older server relaying through this relay sends as before, ignores
 *    the receipt id, and logs Expo's reason for a refusal;
 *  - this server relaying through an older relay sends as before, keeps no
 *    receipt it cannot ask for, and gives up on a relay with no /receipts.
 *
 * Everything runs over real HTTP: the real relay router behind the real JSON
 * parser and error handler, and a self-hosted server - its own copy of the
 * product, with no Expo credentials - posting with the real API client and
 * reading its receipts with its real receipt check, on an in-memory Redis.
 * Only Expo and the database are stood in for.
 */

const RELAY_PATH: string = "/api/notification/push-relay";

const PHONE_TOKEN: string = "ExponentPushToken[relay-receipt-phone-01]";

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000701",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000702",
);
const LOG_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000703");

const RECEIPT_ID: string = "4a5b6c7d-1e2f-4a3b-8c4d-000000000001";

const MINUTE: number = 60 * 1000;

const GONE_PAGE_MESSAGE: string =
  "Push notification not delivered. Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid. The device is marked as not receiving notifications; open the mobile app on it to register it again.";

/*
 * What the relay hands Expo and what Expo answers, as expo-server-sdk types
 * them. The SDK is Common's dependency, not App's, so the relay's Expo client
 * is reached through the service.
 */
interface ExpoPushMessage {
  to: string | Array<string>;
  [key: string]: unknown;
}

type ExpoTicketOrReceipt =
  | { status: "ok"; id?: string }
  | {
      status: "error";
      message: string;
      details?: { error?: string; expoPushToken?: string };
      __debug?: unknown;
    };

interface ExpoClient {
  sendPushNotificationsAsync: (
    messages: Array<ExpoPushMessage>,
  ) => Promise<Array<ExpoTicketOrReceipt>>;
  getPushNotificationReceiptsAsync: (
    ids: Array<string>,
  ) => Promise<{ [id: string]: ExpoTicketOrReceipt }>;
}

function expoClientOf(service: typeof PushNotificationService): ExpoClient {
  return (service as unknown as { expoClient: ExpoClient }).expoClient;
}

async function listen(app: ExpressApplication): Promise<Server> {
  const server: Server = createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return server;
}

function originOf(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
}

interface RedisMock {
  getClient: jest.Mock;
  isConnected: jest.Mock;
}

/*
 * A self-hosted server: another copy of the product in this process, with
 * its own configuration - no Expo credentials, so it relays - and its own
 * services and receipt queue, which the relay copy knows nothing of.
 */
interface SelfHostedServer {
  environment: Record<string, unknown>;
  PushNotificationService: typeof PushNotificationService;
  UserPushService: typeof UserPushService;
  PushNotificationLogService: typeof PushNotificationLogService;
  UserOnCallLogTimelineService: typeof UserOnCallLogTimelineService;
  ExpoPushReceiptService: typeof ExpoPushReceiptService;
  queue: ExpoPushReceiptQueue;
  redis: RedisMock;
}

function loadSelfHostedServer(): SelfHostedServer {
  const environment: Record<string, unknown> = {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    ExpoAccessToken: undefined,
    PushNotificationRelayUrl: "",
  };

  let loaded: SelfHostedServer | null = null;

  jest.isolateModules(() => {
    jest.doMock("Common/Server/EnvironmentConfig", () => {
      return environment;
    });

    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    loaded = {
      environment: environment,
      PushNotificationService:
        require("Common/Server/Services/PushNotificationService").default,
      UserPushService: require("Common/Server/Services/UserPushService")
        .default,
      PushNotificationLogService:
        require("Common/Server/Services/PushNotificationLogService").default,
      UserOnCallLogTimelineService:
        require("Common/Server/Services/UserOnCallLogTimelineService").default,
      ExpoPushReceiptService:
        require("Common/Server/Services/ExpoPushReceiptService").default,
      queue: require("Common/Server/Infrastructure/ExpoPushReceiptQueue")
        .default,
      redis: require("Common/Server/Infrastructure/Redis").default,
    };
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  jest.dontMock("Common/Server/EnvironmentConfig");

  return loaded!;
}

let relay: Server;
let relayUrl: string;
let olderRelay: Server;
let olderRelayUrl: string;
let olderRelayRequests: Array<string>;
let selfHosted: SelfHostedServer;

beforeAll(async () => {
  // oneuptime.com's relay, as the Notification feature set mounts it.
  const relayApp: ExpressApplication = createExpressApp();
  relayApp.use(ExpressJson());
  relayApp.use(RELAY_PATH, PushRelayRouter);
  relayApp.use(expressErrorHandler);
  relay = await listen(relayApp);
  relayUrl = `${originOf(relay)}${RELAY_PATH}/send`;

  /*
   * A relay older than this: it sends what it is given and answers
   * { success: true }, with no receipt id; Expo's refusals reach the error
   * handler as 500 "Server Error"; and it has no /receipts route.
   */
  olderRelayRequests = [];
  const olderRelayApp: ExpressApplication = createExpressApp();
  olderRelayApp.use(ExpressJson());
  olderRelayApp.use(
    (req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
      olderRelayRequests.push(`${req.method} ${req.path}`);
      next();
    },
  );
  olderRelayApp.post(
    `${RELAY_PATH}/send`,
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if ((req.body as JSONObject)["title"] === "Too big") {
        return next(
          new Error("Failed to send push notification: Message too big"),
        );
      }

      res.json({ success: true });
      return undefined;
    },
  );
  olderRelayApp.use(expressErrorHandler);
  olderRelay = await listen(olderRelayApp);
  olderRelayUrl = `${originOf(olderRelay)}${RELAY_PATH}/send`;

  selfHosted = loadSelfHostedServer();
});

afterAll(async () => {
  await close(relay);
  await close(olderRelay);
});

let redis: FakeSortedSetRedis;
let expoSends: Array<ExpoPushMessage>;
let expoTickets: Map<string, ExpoTicketOrReceipt>;
let expoReceipts: Map<string, ExpoTicketOrReceipt>;
let expoReceiptRequests: Array<Array<string>>;
let expoReceiptFailure: Error | null;

beforeEach(() => {
  redis = new FakeSortedSetRedis();
  selfHosted.redis.getClient.mockReturnValue(redis);
  selfHosted.redis.isConnected.mockReturnValue(true);
  selfHosted.environment["PushNotificationRelayUrl"] = relayUrl;

  expoSends = [];
  expoTickets = new Map<string, ExpoTicketOrReceipt>();
  expoReceipts = new Map<string, ExpoTicketOrReceipt>();
  expoReceiptRequests = [];
  expoReceiptFailure = null;
  olderRelayRequests.length = 0;

  // The relay holds Expo credentials.
  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockReturnValue(true);

  jest
    .spyOn(expoClientOf(PushNotificationService), "sendPushNotificationsAsync")
    .mockImplementation((async (messages: Array<ExpoPushMessage>) => {
      expoSends.push(messages[0]!);

      return [
        expoTickets.get(messages[0]!.to as string) || {
          status: "ok",
          id: RECEIPT_ID,
        },
      ];
    }) as never);

  jest
    .spyOn(
      expoClientOf(PushNotificationService),
      "getPushNotificationReceiptsAsync",
    )
    .mockImplementation((async (ids: Array<string>) => {
      expoReceiptRequests.push([...ids]);

      if (expoReceiptFailure) {
        throw expoReceiptFailure;
      }

      const answer: { [id: string]: ExpoTicketOrReceipt } = {};

      for (const id of ids) {
        const receipt: ExpoTicketOrReceipt | undefined = expoReceipts.get(id);

        if (receipt) {
          answer[id] = receipt;
        }
      }

      return answer;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function post(
  url: string,
  body: JSONObject,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return await API.post<JSONObject>({
    url: URL.fromString(url),
    data: body,
  });
}

function receiptsUrlOf(sendUrl: string): string {
  return sendUrl.replace("/send", "/receipts");
}

function sendRequest(token: string, extra: JSONObject = {}): JSONObject {
  return {
    to: token,
    title: "Incident #42: Checkout is down",
    body: "A new incident has been created.",
    data: {},
    sound: "default",
    priority: "high",
    channelId: "oncall_high",
    ...extra,
  };
}

describe("the relay names the receipt of each push it sent (POST /send)", () => {
  test("{ success: true, receiptId }: the id Expo's ticket gave the push", async () => {
    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      relayUrl,
      sendRequest(PHONE_TOKEN),
    );

    expect(answer.statusCode).toBe(200);
    expect(answer.jsonData).toEqual({ success: true, receiptId: RECEIPT_ID });
  });

  test("a ticket with no receipt id: { success: true }, as before", async () => {
    expoTickets.set(PHONE_TOKEN, { status: "ok" });

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      relayUrl,
      sendRequest(PHONE_TOKEN),
    );

    expect(answer.jsonData).toEqual({ success: true });
  });

  test.each([
    ["MessageTooBig", "Message too big"],
    ["MessageRateExceeded", "Too many messages to the device"],
    ["InvalidCredentials", "The push credentials are not valid"],
    ["MismatchSenderId", "The FCM sender id does not match"],
    ["ProviderError", "APNs failed"],
  ])(
    "Expo's %s refusal is answered 502 with Expo's code and words, never the token",
    async (code: string, message: string) => {
      expoTickets.set(PHONE_TOKEN, {
        status: "error",
        message: `${message} (${PHONE_TOKEN})`,
        details: { error: code, expoPushToken: PHONE_TOKEN },
      });

      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
        relayUrl,
        sendRequest(PHONE_TOKEN),
      );

      expect(answer).toBeInstanceOf(HTTPErrorResponse);
      expect(answer.statusCode).toBe(502);
      expect(answer.jsonData).toEqual({
        message: `${message} ([push token])`,
        details: { error: code },
      });
      expect(JSON.stringify(answer.jsonData)).not.toContain(PHONE_TOKEN);
    },
  );

  test("an error ticket with no code is answered 502 with its words alone", async () => {
    expoTickets.set(PHONE_TOKEN, {
      status: "error",
      message: "Something went wrong",
    });

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      relayUrl,
      sendRequest(PHONE_TOKEN),
    );

    expect(answer.statusCode).toBe(502);
    expect(answer.jsonData).toEqual({ message: "Something went wrong" });
  });
});

describe("the relay answers receipts (POST /receipts)", () => {
  const OTHER_RECEIPT_ID: string = "4a5b6c7d-1e2f-4a3b-8c4d-000000000002";
  const NOT_READY_RECEIPT_ID: string = "4a5b6c7d-1e2f-4a3b-8c4d-000000000003";

  test("each receipt's status, Expo's code and words - never a token - and none for a receipt not ready yet", async () => {
    expoReceipts.set(RECEIPT_ID, { status: "ok" });
    expoReceipts.set(OTHER_RECEIPT_ID, {
      status: "error",
      message: `"${PHONE_TOKEN}" is not a registered push notification recipient`,
      details: { error: "DeviceNotRegistered", expoPushToken: PHONE_TOKEN },
      __debug: { internal: "yes" },
    });

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      receiptsUrlOf(relayUrl),
      { ids: [RECEIPT_ID, OTHER_RECEIPT_ID, NOT_READY_RECEIPT_ID] },
    );

    expect(answer.statusCode).toBe(200);
    expect(answer.jsonData).toEqual({
      receipts: {
        [RECEIPT_ID]: { status: "ok" },
        [OTHER_RECEIPT_ID]: {
          status: "error",
          message:
            '"[push token]" is not a registered push notification recipient',
          details: { error: "DeviceNotRegistered" },
        },
      },
    });
    expect(JSON.stringify(answer.jsonData)).not.toContain(PHONE_TOKEN);
    expect(expoReceiptRequests).toEqual([
      [RECEIPT_ID, OTHER_RECEIPT_ID, NOT_READY_RECEIPT_ID],
    ]);
  });

  test("an id asked twice is asked of Expo once", async () => {
    await post(receiptsUrlOf(relayUrl), { ids: [RECEIPT_ID, RECEIPT_ID] });

    expect(expoReceiptRequests).toEqual([[RECEIPT_ID]]);
  });

  test.each([
    ["no ids", {}],
    ["ids that are not a list", { ids: RECEIPT_ID }],
    ["an empty list", { ids: [] }],
    ["an id that is not a receipt id", { ids: [RECEIPT_ID, "../send"] }],
    ["an id that is not text", { ids: [42] }],
    [
      "more ids than one request to Expo takes",
      {
        ids: Array.from({ length: 301 }, (_value: unknown, index: number) => {
          return `4a5b6c7d-1e2f-4a3b-8c4d-${String(index).padStart(12, "0")}`;
        }),
      },
    ],
  ])(
    "%s: refused, and Expo is not asked",
    async (_name: string, body: JSONObject) => {
      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
        receiptsUrlOf(relayUrl),
        body,
      );

      expect(answer.statusCode).toBe(400);
      expect(expoReceiptRequests).toEqual([]);
    },
  );

  test("a relay without Expo credentials has no receipts to give", async () => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      receiptsUrlOf(relayUrl),
      { ids: [RECEIPT_ID] },
    );

    expect(answer.statusCode).toBe(400);
    expect((answer as HTTPErrorResponse).message).toBe(
      "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
    );
    expect(expoReceiptRequests).toEqual([]);
  });

  test("Expo cannot be asked: a server error, for the server to ask again later", async () => {
    expoReceiptFailure = new Error("request to https://exp.host failed");

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      receiptsUrlOf(relayUrl),
      { ids: [RECEIPT_ID] },
    );

    expect(answer.statusCode).toBe(500);
  });
});

describe("a self-hosted server relaying through it", () => {
  let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;
  let logUpdates: Array<{ query: JSONObject; data: JSONObject }>;
  let timelineUpdates: Array<{ query: JSONObject; data: JSONObject }>;

  beforeEach(() => {
    markAsGone = jest
      .spyOn(selfHosted.UserPushService, "markExpoPushTokenAsGone")
      .mockResolvedValue(1);

    jest
      .spyOn(selfHosted.PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: { id?: ObjectID } }) => {
        createBy.data.id = LOG_ID;
        return createBy.data;
      }) as never);

    jest
      .spyOn(selfHosted.UserOnCallLogTimelineService, "updateOneById")
      .mockResolvedValue(1 as never);

    logUpdates = [];
    jest
      .spyOn(selfHosted.PushNotificationLogService, "updateOneBy")
      .mockImplementation((async (updateBy: {
        query: JSONObject;
        data: JSONObject;
      }) => {
        logUpdates.push({ query: updateBy.query, data: updateBy.data });
        return 1;
      }) as never);

    timelineUpdates = [];
    jest
      .spyOn(selfHosted.UserOnCallLogTimelineService, "updateOneBy")
      .mockImplementation((async (updateBy: {
        query: JSONObject;
        data: JSONObject;
      }) => {
        timelineUpdates.push({ query: updateBy.query, data: updateBy.data });
        return 1;
      }) as never);
  });

  async function page(
    deviceType: PushDeviceType = PushDeviceType.iOS,
  ): Promise<unknown> {
    try {
      await selfHosted.PushNotificationService.sendPushNotification(
        {
          devices: [{ token: PHONE_TOKEN, name: "iPhone 15" }],
          message: {
            title: "Incident #42: Checkout is down",
            body: "A new incident has been created.",
          },
          deviceType: deviceType,
        },
        { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      );

      return null;
    } catch (error) {
      return error;
    }
  }

  function kept(): Array<PendingExpoPushReceipt> {
    return redis
      .ordered(selfHosted.queue.getPendingKey())
      .map((entry: [string, number]) => {
        return JSON.parse(entry[0]) as PendingExpoPushReceipt;
      });
  }

  async function readReceipts(
    afterMs: number,
  ): Promise<ExpoPushReceiptCheckSummary> {
    const sentAt: number = kept()[0]?.sentAt || Date.now();

    return await selfHosted.ExpoPushReceiptService.checkDueReceipts({
      now: () => {
        return sentAt + afterMs;
      },
    });
  }

  test("is a server with no Expo credentials of its own", () => {
    expect(selfHosted.PushNotificationService.hasExpoAccessToken()).toBe(false);
    expect(selfHosted.PushNotificationService).not.toBe(
      PushNotificationService,
    );
    expect(selfHosted.PushNotificationService.getRelayReceiptsUrl()).toBe(
      receiptsUrlOf(relayUrl),
    );
  });

  test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
    "%s: a page whose receipt says the phone is gone marks it, 15 minutes on, and the page says it was not delivered",
    async (deviceType: PushDeviceType) => {
      expect(await page(deviceType)).toBeNull();

      // Sent by the relay, which named its receipt; kept to ask about.
      expect(expoSends).toHaveLength(1);
      expect(kept()).toEqual([
        expect.objectContaining({
          receiptId: RECEIPT_ID,
          deviceToken: PHONE_TOKEN,
          via: "relay",
          pushNotificationLogId: LOG_ID.toString(),
          userOnCallLogTimelineId: TIMELINE_ID.toString(),
        }),
      ]);

      expoReceipts.set(RECEIPT_ID, {
        status: "error",
        message: `"${PHONE_TOKEN}" is not a registered push notification recipient`,
        details: { error: "DeviceNotRegistered", expoPushToken: PHONE_TOKEN },
      });

      // Not before 15 minutes.
      expect((await readReceipts(14 * MINUTE)).checked).toBe(0);
      expect(expoReceiptRequests).toEqual([]);

      const summary: ExpoPushReceiptCheckSummary = await readReceipts(
        15 * MINUTE,
      );

      // The relay asked Expo, with its credentials, for exactly that receipt.
      expect(expoReceiptRequests).toEqual([[RECEIPT_ID]]);
      expect(summary.notDelivered).toBe(1);
      expect(markAsGone).toHaveBeenCalledTimes(1);
      expect(markAsGone.mock.calls[0]![0]).toEqual({
        deviceToken: PHONE_TOKEN,
      });
      expect(logUpdates).toEqual([
        {
          query: { _id: LOG_ID.toString(), status: "Success" },
          data: { status: "Error", statusMessage: GONE_PAGE_MESSAGE },
        },
      ]);
      expect(timelineUpdates).toEqual([
        {
          query: { _id: TIMELINE_ID.toString(), status: "Sent" },
          data: { status: "Error", statusMessage: GONE_PAGE_MESSAGE },
        },
      ]);
      expect(kept()).toEqual([]);
    },
  );

  test("a page that was delivered changes nothing", async () => {
    await page();
    expoReceipts.set(RECEIPT_ID, { status: "ok" });

    const summary: ExpoPushReceiptCheckSummary = await readReceipts(
      16 * MINUTE,
    );

    expect(summary.delivered).toBe(1);
    expect(markAsGone).not.toHaveBeenCalled();
    expect(logUpdates).toEqual([]);
    expect(timelineUpdates).toEqual([]);
  });

  test("another refusal in the receipt: the page says so in Expo's words, and the phone is left as it is", async () => {
    await page();
    expoReceipts.set(RECEIPT_ID, {
      status: "error",
      message: "Too many notifications to this device",
      details: { error: "MessageRateExceeded" },
    });

    await readReceipts(16 * MINUTE);

    expect(markAsGone).not.toHaveBeenCalled();
    expect(timelineUpdates[0]!.data).toEqual({
      status: "Error",
      statusMessage:
        "Push notification not delivered. Expo could not deliver it to the device (MessageRateExceeded): Too many notifications to this device",
    });
  });

  test("a receipt not ready yet is asked about again later", async () => {
    await page();

    const summary: ExpoPushReceiptCheckSummary = await readReceipts(
      16 * MINUTE,
    );

    expect(summary.notReadyYet).toBe(1);
    expect(kept()).toEqual([
      expect.objectContaining({ receiptId: RECEIPT_ID, attempts: 1 }),
    ]);
  });

  test("Expo's other refusal at the send is said as a direct send says it", async () => {
    expoTickets.set(PHONE_TOKEN, {
      status: "error",
      message: "Message too big",
      details: { error: "MessageTooBig" },
    });

    const failure: unknown = await page();

    expect((failure as Error).message).toBe(
      "Expo push notification failed: Message too big",
    );
    expect(kept()).toEqual([]);
    expect(markAsGone).not.toHaveBeenCalled();
  });
});

describe("across versions", () => {
  /*
   * A self-hosted server older than this, as its sendViaRelay was: any
   * answer that is not a success fails the send and its body is logged; a
   * success is a success, whatever else it says.
   */
  async function olderServerSendViaRelay(body: JSONObject): Promise<void> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(relayUrl),
        data: body,
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(`Push relay error: ${JSON.stringify(response.jsonData)}`);
    }
  }

  test("a server older than this, relaying through this relay: a page is delivered as before, the receipt id unread", async () => {
    await expect(
      olderServerSendViaRelay(sendRequest(PHONE_TOKEN)),
    ).resolves.toBe(undefined);
    expect(expoSends).toHaveLength(1);
  });

  test("a server older than this, relaying through this relay: Expo's other refusal still fails its send, and its log now says why", async () => {
    expoTickets.set(PHONE_TOKEN, {
      status: "error",
      message: "Message too big",
      details: { error: "MessageTooBig" },
    });

    let failure: unknown = null;

    try {
      await olderServerSendViaRelay(sendRequest(PHONE_TOKEN));
    } catch (error) {
      failure = error;
    }

    expect((failure as Error).message).toBe(
      'Push relay error: {"message":"Message too big","details":{"error":"MessageTooBig"}}',
    );
  });

  describe("this server, relaying through a relay older than this", () => {
    beforeEach(() => {
      selfHosted.environment["PushNotificationRelayUrl"] = olderRelayUrl;

      jest
        .spyOn(selfHosted.PushNotificationLogService, "create")
        .mockImplementation((async (createBy: { data: unknown }) => {
          return createBy.data;
        }) as never);
    });

    afterEach(() => {
      selfHosted.environment["PushNotificationRelayUrl"] = relayUrl;
    });

    async function send(title: string): Promise<unknown> {
      try {
        await selfHosted.PushNotificationService.sendPushNotification(
          {
            devices: [{ token: PHONE_TOKEN }],
            message: { title: title, body: "Checkout is down" },
            deviceType: PushDeviceType.Android,
          },
          { projectId: PROJECT_ID },
        );

        return null;
      } catch (error) {
        return error;
      }
    }

    test("a page is delivered as before, and with no receipt id, nothing is kept - nor asked about", async () => {
      expect(await send("Incident #42")).toBeNull();

      expect(redis.zcard(selfHosted.queue.getPendingKey())).toBe(0);

      const summary: ExpoPushReceiptCheckSummary =
        await selfHosted.ExpoPushReceiptService.checkDueReceipts({
          now: () => {
            return Date.now() + 20 * MINUTE;
          },
        });

      expect(summary.checked).toBe(0);
      expect(olderRelayRequests).toEqual([`POST ${RELAY_PATH}/send`]);
    });

    test("Expo's other refusal fails the send as it always did", async () => {
      const failure: unknown = await send("Too big");

      expect((failure as Error).message).toBe(
        'Push relay error: {"error":"Server Error"}',
      );
    });

    /*
     * Receipts kept while the relay offered them (it was another one, or a
     * newer one since rolled back). The older relay has no /receipts: they
     * are given up at the first 404, and it is asked once, not once a batch.
     */
    test("receipts kept for a relay that no longer offers them are given up at its first 404", async () => {
      const sentAt: number = Date.now() - 20 * MINUTE;

      await selfHosted.queue.add(
        Array.from({ length: 450 }, (_value: unknown, index: number) => {
          return {
            receiptId: `4a5b6c7d-1e2f-4a3b-8c4d-${String(index).padStart(12, "0")}`,
            deviceToken: PHONE_TOKEN,
            via: "relay" as const,
            sentAt: sentAt,
            attempts: 0,
          };
        }),
        sentAt,
      );

      const summary: ExpoPushReceiptCheckSummary =
        await selfHosted.ExpoPushReceiptService.checkDueReceipts();

      expect(summary.dropped).toBe(450);
      expect(olderRelayRequests).toEqual([`POST ${RELAY_PATH}/receipts`]);
      expect(redis.zcard(selfHosted.queue.getPendingKey())).toBe(0);
    });
  });
});

describe("the receipt ids a server may ask about (parseRelayReceiptIds)", () => {
  test("a list of receipt ids, each once, in order", () => {
    expect(parseRelayReceiptIds(["a-1", "b-2", "a-1"])).toEqual(["a-1", "b-2"]);
  });

  test("up to 300, Expo's own chunk size", () => {
    const ids: Array<string> = Array.from(
      { length: 300 },
      (_value: unknown, index: number) => {
        return `id-${index}`;
      },
    );

    expect(parseRelayReceiptIds(ids)).toHaveLength(300);
    expect(() => {
      return parseRelayReceiptIds([...ids, "id-300"]);
    }).toThrow(BadDataException);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "a-1"],
    ["an object", { ids: ["a-1"] }],
    ["an empty list", []],
    ["a list with a path in it", ["a-1", "../send"]],
    ["a list with a number in it", ["a-1", 7]],
    ["a list with __proto__ in it", ["__proto__"]],
  ])("refuses %s", (_name: string, raw: unknown) => {
    expect(() => {
      return parseRelayReceiptIds(raw);
    }).toThrow(BadDataException);
  });
});

/*
 * Each route counts its own requests: the receipts a server asks about
 * must never use up the requests its pages are sent with - a page refused
 * for the relay's rate limit is not delivered.
 */
describe("the relay's rate limits", () => {
  test("60 requests a minute from one address, then 429 until the minute is over", () => {
    const limiter: RelayRateLimiter = new RelayRateLimiter();
    const start: number = Date.UTC(2026, 9, 8, 12, 0, 0);

    for (let request: number = 1; request <= 60; request++) {
      expect(limiter.isRateLimited("203.0.113.7", start + request)).toBe(false);
    }

    expect(limiter.isRateLimited("203.0.113.7", start + 61)).toBe(true);
    // Another address has its own count.
    expect(limiter.isRateLimited("203.0.113.8", start + 62)).toBe(false);
    // A new minute starts a new count.
    expect(limiter.isRateLimited("203.0.113.7", start + 60 * 1000 + 2)).toBe(
      false,
    );
  });

  test("forgets an address whose minute is over", () => {
    const limiter: RelayRateLimiter = new RelayRateLimiter();
    const start: number = Date.UTC(2026, 9, 8, 12, 0, 0);

    for (let request: number = 1; request <= 61; request++) {
      limiter.isRateLimited("203.0.113.7", start);
    }

    limiter.prune(start + 60 * 1000 + 1);

    expect(limiter.isRateLimited("203.0.113.7", start + 60 * 1000 + 2)).toBe(
      false,
    );
  });

  // Last in this file: it uses up the receipts route's minute for this address.
  test("asking about receipts never uses up the requests pages are sent with", async () => {
    const minute: number = Date.now() + 10 * 60 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(minute);

    for (let request: number = 1; request <= 60; request++) {
      const answer: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
        receiptsUrlOf(relayUrl),
        { ids: [RECEIPT_ID] },
      );

      expect(answer.statusCode).toBe(200);
    }

    const limited: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      receiptsUrlOf(relayUrl),
      { ids: [RECEIPT_ID] },
    );

    expect(limited.statusCode).toBe(429);

    // The page still goes out.
    const page: HTTPResponse<JSONObject> | HTTPErrorResponse = await post(
      relayUrl,
      sendRequest(PHONE_TOKEN),
    );

    expect(page.statusCode).toBe(200);
  });
});
