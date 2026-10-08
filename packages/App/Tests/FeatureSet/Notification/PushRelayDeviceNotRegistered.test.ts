import PushRelayRouter from "../../../FeatureSet/Notification/API/PushRelay";
import PushNotificationService from "Common/Server/Services/PushNotificationService";
import PushNotificationLogService from "Common/Server/Services/PushNotificationLogService";
import UserPushService from "Common/Server/Services/UserPushService";
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
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import API from "Common/Utils/API";
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

/*
 * The push relay is how a self-hosted OneUptime without its own
 * EXPO_ACCESS_TOKEN gets pages onto phones: it posts each page to
 * oneuptime.com's relay, which sends it with OneUptime's Expo credentials.
 * Neither side upgrades with the other: a new server relays through an old
 * relay, and an old server through the new one.
 *
 * When Expo said a token was gone (DeviceNotRegistered) the relay answered
 * like any failure, 500 "Server Error", so a self-hosted server could never
 * stop sending to the dead token. The relay now answers it 410 with Expo's
 * code, and a server that knows that answer stops sending to the token.
 *
 * Everything runs over real HTTP: the real relay router behind the real JSON
 * parser and error handler, and, for the server relaying through it, its own
 * copy of the product with no Expo credentials, posting to the relay with
 * the real API client. Only Expo and the database are stood in for.
 */

const RELAY_PATH: string = "/api/notification/push-relay";

const GONE_TOKEN: string = "ExponentPushToken[relay-gone-phone-00001]";
const WORKING_TOKEN: string = "ExponentPushToken[relay-working-phone-02]";

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000061",
);

/*
 * What the relay hands Expo and what Expo answers, as expo-server-sdk types
 * them (ExpoPushMessage, ExpoPushTicket). The SDK is Common's dependency,
 * not App's, so the relay's Expo client is reached through the service.
 */
interface ExpoPushMessage {
  to: string | Array<string>;
  [key: string]: unknown;
}

type ExpoPushTicket =
  | { status: "ok"; id: string }
  | {
      status: "error";
      message: string;
      details?: { error?: string; expoPushToken?: string };
    };

interface ExpoClient {
  sendPushNotificationsAsync: (
    messages: Array<ExpoPushMessage>,
  ) => Promise<Array<ExpoPushTicket>>;
}

function expoClientOf(service: typeof PushNotificationService): ExpoClient {
  return (service as unknown as { expoClient: ExpoClient }).expoClient;
}

// The ticket Expo answers a gone token with, its message naming the token.
function deviceNotRegistered(token: string): ExpoPushTicket {
  return {
    status: "error",
    message: `"${token}" is not a registered push notification recipient`,
    details: { error: "DeviceNotRegistered", expoPushToken: token },
  };
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

// What the relay is told to send, as a server posts it (sendViaRelay).
function relayRequest(token: string, extra: JSONObject = {}): JSONObject {
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

/*
 * A self-hosted server: another copy of the product in this process, with
 * its own configuration - no Expo credentials, so it relays - and its own
 * services, which the relay copy above knows nothing of.
 */
interface SelfHostedServer {
  environment: Record<string, unknown>;
  PushNotificationService: typeof PushNotificationService;
  UserPushService: typeof UserPushService;
  PushNotificationLogService: typeof PushNotificationLogService;
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

    loaded = {
      environment: environment,
      PushNotificationService:
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("Common/Server/Services/PushNotificationService").default,
      UserPushService:
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("Common/Server/Services/UserPushService").default,
      PushNotificationLogService:
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("Common/Server/Services/PushNotificationLogService").default,
    };
  });

  jest.dontMock("Common/Server/EnvironmentConfig");

  return loaded!;
}

let relay: Server;
let relayUrl: string;
let olderRelay: Server;
let olderRelayUrl: string;
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
   * A relay older than this. It sent what it was given and, when Expo
   * refused it, threw - DeviceNotRegistered or not - into the error
   * handler, which answers an Error that is not an Exception with 500
   * "Server Error".
   */
  const olderRelayApp: ExpressApplication = createExpressApp();
  olderRelayApp.use(ExpressJson());
  olderRelayApp.post(
    `${RELAY_PATH}/send`,
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      const token: string = (req.body as JSONObject)["to"] as string;

      if (token === GONE_TOKEN) {
        return next(
          new Error(
            `Failed to send push notification: "${token}" is not a registered push notification recipient`,
          ),
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

let expoSends: Array<ExpoPushMessage>;
let expoAnswers: Map<string, ExpoPushTicket>;

beforeEach(() => {
  expoSends = [];
  expoAnswers = new Map<string, ExpoPushTicket>();

  // The relay holds Expo credentials.
  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockReturnValue(true);

  jest
    .spyOn(expoClientOf(PushNotificationService), "sendPushNotificationsAsync")
    .mockImplementation((async (messages: Array<ExpoPushMessage>) => {
      expoSends.push(messages[0]!);

      return [
        expoAnswers.get(messages[0]!.to as string) || {
          status: "ok",
          id: "receipt-1",
        },
      ];
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function postToRelay(
  url: string,
  body: JSONObject,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return await API.post<JSONObject>({
    url: URL.fromString(url),
    data: body,
  });
}

describe("the relay (POST /api/notification/push-relay/send)", () => {
  test("a token Expo says is gone is answered 410, with Expo's code and a sentence", async () => {
    expoAnswers.set(GONE_TOKEN, deviceNotRegistered(GONE_TOKEN));

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await postToRelay(relayUrl, relayRequest(GONE_TOKEN));

    expect(answer).toBeInstanceOf(HTTPErrorResponse);
    expect(answer.statusCode).toBe(410);
    expect(answer.jsonData).toEqual({
      message:
        "Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid.",
      details: { error: "DeviceNotRegistered" },
    });
    expect(
      PushNotificationService.isRelayDeviceNotRegisteredAnswer(
        answer as HTTPErrorResponse,
      ),
    ).toBe(true);
    // The relay is unauthenticated: it repeats nothing about the token.
    expect(JSON.stringify(answer.jsonData)).not.toContain(GONE_TOKEN);
  });

  test("any other refusal from Expo is the server error it always was", async () => {
    expoAnswers.set(GONE_TOKEN, {
      status: "error",
      message: "Message too big",
      details: { error: "MessageTooBig" },
    });

    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await postToRelay(relayUrl, relayRequest(GONE_TOKEN));

    expect(answer.statusCode).toBe(500);
    expect(answer.jsonData).toEqual({ error: "Server Error" });
  });

  test("a page Expo accepts is answered as it always was", async () => {
    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await postToRelay(
        relayUrl,
        relayRequest(WORKING_TOKEN, {
          sound: { critical: true, name: "default", volume: 1 },
          interruptionLevel: "critical",
          channelId: "oncall_critical",
        }),
      );

    expect(answer).not.toBeInstanceOf(HTTPErrorResponse);
    expect(answer.statusCode).toBe(200);
    expect(answer.jsonData).toEqual({ success: true });
    // The page's whole delivery shape still reaches Expo.
    expect(expoSends[0]).toEqual({
      to: WORKING_TOKEN,
      title: "Incident #42: Checkout is down",
      body: "A new incident has been created.",
      data: {},
      sound: { critical: true, name: "default", volume: 1 },
      priority: "high",
      channelId: "oncall_critical",
      interruptionLevel: "critical",
    });
  });

  test("a request with no Expo push token is refused as it always was, and Expo is not asked", async () => {
    const answer: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await postToRelay(relayUrl, relayRequest("not-a-push-token"));

    expect(answer.statusCode).toBe(400);
    expect(expoSends).toHaveLength(0);
  });
});

describe("a self-hosted server relaying through it", () => {
  let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;
  let logs: Array<{ status: unknown; statusMessage: unknown }>;

  beforeEach(() => {
    logs = [];
    selfHosted.environment["PushNotificationRelayUrl"] = relayUrl;

    markAsGone = jest
      .spyOn(selfHosted.UserPushService, "markExpoPushTokenAsGone")
      .mockResolvedValue(1);

    jest
      .spyOn(selfHosted.PushNotificationLogService, "create")
      .mockImplementation((async (createBy: {
        data: { status: unknown; statusMessage: unknown };
      }) => {
        logs.push({
          status: createBy.data.status,
          statusMessage: createBy.data.statusMessage,
        });
        return createBy.data;
      }) as never);
  });

  async function selfHostedSend(
    token: string,
    deviceType: PushDeviceType = PushDeviceType.iOS,
  ): Promise<unknown> {
    try {
      await selfHosted.PushNotificationService.sendPushNotification(
        {
          devices: [{ token: token, name: "iPhone 15" }],
          message: {
            title: "Incident #42: Checkout is down",
            body: "A new incident has been created.",
          },
          deviceType: deviceType,
        },
        { projectId: PROJECT_ID },
      );

      return null;
    } catch (error) {
      return error;
    }
  }

  test("is a server with no Expo credentials of its own", () => {
    expect(selfHosted.PushNotificationService.hasExpoAccessToken()).toBe(false);
    // A copy of its own, not the relay's.
    expect(selfHosted.PushNotificationService).not.toBe(
      PushNotificationService,
    );
  });

  test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
    "%s: stops sending to a token Expo says is gone, and the send says what to do",
    async (deviceType: PushDeviceType) => {
      expoAnswers.set(GONE_TOKEN, deviceNotRegistered(GONE_TOKEN));

      const failure: unknown = await selfHostedSend(GONE_TOKEN, deviceType);

      // The relay sent it, with its Expo credentials.
      expect(expoSends).toHaveLength(1);
      expect(expoSends[0]!.to).toBe(GONE_TOKEN);

      expect(markAsGone).toHaveBeenCalledTimes(1);
      expect(markAsGone.mock.calls[0]![0]).toEqual({ deviceToken: GONE_TOKEN });
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid. The device is marked as not receiving notifications; open the mobile app on it to register it again.",
      );
      expect(logs).toEqual([
        {
          status: "Error",
          statusMessage: (failure as Error).message,
        },
      ]);
    },
  );

  test("a token Expo accepts is delivered, and nothing is marked", async () => {
    const failure: unknown = await selfHostedSend(WORKING_TOKEN);

    expect(failure).toBeNull();
    expect(markAsGone).not.toHaveBeenCalled();
    expect(logs).toEqual([
      { status: "Success", statusMessage: "Push notification sent" },
    ]);
  });

  test("any other refusal fails the send, and nothing is marked", async () => {
    expoAnswers.set(GONE_TOKEN, {
      status: "error",
      message: "Message too big",
      details: { error: "MessageTooBig" },
    });

    const failure: unknown = await selfHostedSend(GONE_TOKEN);

    expect(markAsGone).not.toHaveBeenCalled();
    expect((failure as Error).message).toBe(
      'Push relay error: {"error":"Server Error"}',
    );
  });
});

describe("across versions", () => {
  /*
   * A self-hosted server older than this, as its sendViaRelay was: any
   * answer that is not a success fails the send, and its body is logged.
   */
  async function olderServerSendViaRelay(token: string): Promise<void> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(relayUrl),
        data: relayRequest(token),
      });

    if (response instanceof HTTPErrorResponse) {
      throw new Error(`Push relay error: ${JSON.stringify(response.jsonData)}`);
    }
  }

  test("a server older than this, relaying through this relay: a gone token still fails its send, and its log now says why", async () => {
    expoAnswers.set(GONE_TOKEN, deviceNotRegistered(GONE_TOKEN));

    let failure: unknown = null;

    try {
      await olderServerSendViaRelay(GONE_TOKEN);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Push relay error: {"message":"Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid.","details":{"error":"DeviceNotRegistered"}}',
    );
  });

  test("a server older than this, relaying through this relay: a page Expo accepts is delivered as before", async () => {
    await expect(olderServerSendViaRelay(WORKING_TOKEN)).resolves.toBe(
      undefined,
    );
  });

  describe("this server, relaying through a relay older than this", () => {
    let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;

    beforeEach(() => {
      selfHosted.environment["PushNotificationRelayUrl"] = olderRelayUrl;

      markAsGone = jest
        .spyOn(selfHosted.UserPushService, "markExpoPushTokenAsGone")
        .mockResolvedValue(1);

      jest
        .spyOn(selfHosted.PushNotificationLogService, "create")
        .mockImplementation((async (createBy: { data: unknown }) => {
          return createBy.data;
        }) as never);
    });

    afterEach(() => {
      selfHosted.environment["PushNotificationRelayUrl"] = relayUrl;
    });

    async function send(token: string): Promise<unknown> {
      try {
        await selfHosted.PushNotificationService.sendPushNotification(
          {
            devices: [{ token: token }],
            message: { title: "Incident #42", body: "Checkout is down" },
            deviceType: PushDeviceType.Android,
          },
          { projectId: PROJECT_ID },
        );

        return null;
      } catch (error) {
        return error;
      }
    }

    test("a gone token fails the send as it always did, and nothing is marked on an answer that does not say so", async () => {
      const failure: unknown = await send(GONE_TOKEN);

      expect(markAsGone).not.toHaveBeenCalled();
      expect((failure as Error).message).toBe(
        'Push relay error: {"error":"Server Error"}',
      );
    });

    test("a page it accepts is delivered", async () => {
      expect(await send(WORKING_TOKEN)).toBeNull();
      expect(markAsGone).not.toHaveBeenCalled();
    });
  });
});
