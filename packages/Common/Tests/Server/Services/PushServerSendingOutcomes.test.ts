import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHETHER THE SERVER'S OWN PUSHES GO OUT (#6881).
 *
 * Push read "untested" forever: PushNotificationService told nobody how its
 * pushes went, so a self-hosted server that cannot reach the push relay -
 * an air-gapped one - sent no phone a page and said nothing. Each push now
 * reports how it went, as MailService, SmsService and CallService report
 * theirs (ServerSendingOutcomes): one outcome per push, a failure only when
 * it is the server's - the relay, Expo or a browser's push service cannot
 * be reached or refuses the server's own keys - never a device that is
 * gone, a stale browser or a message too big.
 *
 * PushNotificationService runs as it is; the relay, Expo, web push, the
 * GlobalConfig row and the metrics SDK are stood in for.
 */

let storedConfig: Record<string, unknown> | null = null;
let pushTurnedOff: boolean = false;
const writeServerSendingHealth: MockFunction = getJestMockFunction();

jest.mock("../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: async (): Promise<unknown> => {
        return storedConfig ? { ...storedConfig } : null;
      },
      writeServerSendingHealth: (...args: Array<unknown>): unknown => {
        return writeServerSendingHealth(...args);
      },
      forgetServerSendingHealthOf: async (): Promise<void> => {},
      getPushNotificationsTurnedOff: async (): Promise<boolean> => {
        return pushTurnedOff;
      },
    },
  };
});

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: (): void => {} };
      },
      getNotificationDuration: () => {
        return { record: (): void => {} };
      },
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
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

import ExpoPushReceiptQueue from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import ProjectService from "../../../Server/Services/ProjectService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import PushNotificationService, {
  ExpoPushRefusedError,
  PushFailureOwner,
  PushSendFailure,
} from "../../../Server/Services/PushNotificationService";
import UserPushService from "../../../Server/Services/UserPushService";
import ServerSendingOutcomes, {
  ServerSendingOutcome,
} from "../../../Server/Utils/ServerSending/ServerSendingOutcomes";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import PushNotificationLog from "../../../Models/DatabaseModels/PushNotificationLog";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import APIException from "../../../Types/Exception/ApiException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingFailureScope,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import API from "../../../Utils/API";
import { Expo } from "expo-server-sdk";
import webpush from "web-push";

const PHONE_TOKEN: string = "ExponentPushToken[server-outcomes-0001]";
const OTHER_PHONE_TOKEN: string = "ExponentPushToken[server-outcomes-0002]";

const BROWSER_SUBSCRIPTION: string = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/server-outcomes-0001",
  expirationTime: null,
  keys: { p256dh: "BNcR", auth: "tBHI" },
});

const MESSAGE: PushNotificationMessage = {
  title: "Incident #12: Checkout API is down",
  body: "A new incident has been created.",
};

const RELAY_DOWN: string =
  "Request failed to https://oneuptime.com/api/notification/push-relay/send. Connection refused";

let hasExpoToken: boolean;
let outcomes: Array<ServerSendingOutcome>;
let webPushSend: jest.SpiedFunction<typeof webpush.sendNotification>;
let expoSend: jest.SpiedFunction<
  typeof Expo.prototype.sendPushNotificationsAsync
>;
let relayPost: jest.SpiedFunction<typeof API.post>;

function phones(tokens: Array<string>): PushNotificationRequest {
  return {
    devices: tokens.map((token: string, index: number) => {
      return { token: token, name: `Phone ${index + 1}` };
    }),
    message: MESSAGE,
    deviceType: PushDeviceType.iOS,
  };
}

function browser(): PushNotificationRequest {
  return {
    devices: [{ token: BROWSER_SUBSCRIPTION, name: "Laptop" }],
    message: MESSAGE,
    deviceType: PushDeviceType.Web,
  };
}

// Sends, and keeps going whatever the push's own answer: the outcome is what is read.
async function send(
  request: PushNotificationRequest,
  options: { projectId?: ObjectID } = {},
): Promise<void> {
  try {
    await PushNotificationService.sendPushNotification(request, options);
  } catch {
    // A push none of its devices took throws; what was recorded is the test.
  }
}

function relayAnswers(status: number, body: JSONObject): void {
  relayPost.mockResolvedValue(new HTTPErrorResponse(status, body, {}) as never);
}

function webPushRefuses(
  statusCode?: number,
  message: string = "Refused",
): void {
  webPushSend.mockRejectedValue(
    Object.assign(
      new Error(message),
      statusCode === undefined ? {} : { statusCode: statusCode },
    ) as never,
  );
}

function expoTicket(code: string, message: string): void {
  expoSend.mockResolvedValue([
    { status: "error", message: message, details: { error: code } },
  ] as never);
}

const SUCCEEDED: ServerSendingOutcome = {
  channel: ServerSendingChannel.Push,
  succeeded: true,
};

function failed(
  reason: string,
  scope: ServerSendingFailureScope = ServerSendingFailureScope.Server,
): ServerSendingOutcome {
  return {
    channel: ServerSendingChannel.Push,
    succeeded: false,
    reason: reason,
    scope: scope,
  };
}

beforeEach(() => {
  outcomes = [];
  hasExpoToken = false;
  pushTurnedOff = false;
  storedConfig = null;
  writeServerSendingHealth.mockReset();

  // What each push reported, as the Notification service's recorder would hear it.
  ServerSendingOutcomes.register(
    async (outcome: ServerSendingOutcome): Promise<void> => {
      outcomes.push(outcome);
    },
  );

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

  PushNotificationService.isWebPushInitialized = true;
  webPushSend = jest
    .spyOn(webpush, "sendNotification")
    .mockResolvedValue({ statusCode: 201, body: "", headers: {} } as never);

  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockImplementation((): boolean => {
      return hasExpoToken;
    });

  expoSend = jest
    .spyOn(Expo.prototype, "sendPushNotificationsAsync")
    .mockResolvedValue([{ status: "ok", id: "receipt-1" }] as never);

  relayPost = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { success: true }, {}) as never,
    );

  jest.spyOn(ExpoPushReceiptQueue, "add").mockResolvedValue(0 as never);
  jest
    .spyOn(PushNotificationLogService, "create")
    .mockImplementation((async (createBy: { data: PushNotificationLog }) => {
      return createBy.data;
    }) as never);
  jest
    .spyOn(UserPushService, "markExpoPushTokenAsGone")
    .mockResolvedValue(0 as never);
  jest
    .spyOn(UserPushService, "markWebPushSubscriptionAsGone")
    .mockResolvedValue(0 as never);
});

afterEach(() => {
  ServerSendingOutcomes.register(null);
  ServerSendingStatus.clearCache();
  PushNotificationService.isWebPushInitialized = false;
  jest.restoreAllMocks();
});

describe("through the push relay, a self-hosted server's default", () => {
  test("the relay took it: the server's push went out", async () => {
    await send(phones([PHONE_TOKEN]));

    expect(relayPost).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([SUCCEEDED]);
  });

  test("the relay cannot be reached - an air-gapped server: the server's pushes fail, and why", async () => {
    relayPost.mockRejectedValue(new APIException(RELAY_DOWN) as never);

    await send(phones([PHONE_TOKEN]));

    expect(outcomes).toEqual([failed(RELAY_DOWN)]);
  });

  test("the relay failed, or is not there at that address: the server's", async () => {
    for (const status of [500, 502, 404, 401]) {
      outcomes = [];
      relayAnswers(status, { error: "Server Error" });

      await send(phones([PHONE_TOKEN]));

      expect({ status, outcomes }).toEqual({
        status,
        outcomes: [failed('Push relay error: {"error":"Server Error"}')],
      });
    }
  });

  test("the relay asks to slow down: a throttle, not yet a failure", async () => {
    relayAnswers(429, { error: "Too many requests" });

    await send(phones([PHONE_TOKEN]));

    expect(outcomes).toEqual([
      failed(
        'Push relay error: {"error":"Too many requests"}',
        ServerSendingFailureScope.Throttled,
      ),
    ]);
  });

  test("a phone that is gone is the phone's: nothing is said of the server's pushes", async () => {
    relayAnswers(
      PushNotificationService.RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE,
      PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
    );

    await send(phones([PHONE_TOKEN]));

    expect(outcomes).toEqual([]);
  });

  test("Expo's refusal through the relay: the app's credentials are the server's, a message too big or a phone sent to too often are not", async () => {
    const refusals: Array<[string, boolean]> = [
      ["InvalidCredentials", true],
      ["MismatchSenderId", true],
      ["MessageTooBig", false],
      ["MessageRateExceeded", false],
    ];

    for (const [code, isTheServers] of refusals) {
      outcomes = [];
      relayAnswers(
        PushNotificationService.RELAY_EXPO_REFUSAL_STATUS_CODE,
        PushNotificationService.getRelayExpoRefusalAnswer(
          new ExpoPushRefusedError({
            code: code,
            expoMessage: `Expo refused it: ${code}`,
          }),
        ),
      );

      await send(phones([PHONE_TOKEN]));

      expect({ code, recorded: outcomes.length }).toEqual({
        code,
        recorded: isTheServers ? 1 : 0,
      });

      if (isTheServers) {
        expect(outcomes[0]!.succeeded).toBe(false);
        expect(outcomes[0]!.scope).toBe(ServerSendingFailureScope.Server);
      }
    }
  });
});

describe("with this server's own Expo access token", () => {
  beforeEach(() => {
    hasExpoToken = true;
  });

  test("Expo took it: the server's push went out", async () => {
    await send(phones([PHONE_TOKEN]));

    expect(expoSend).toHaveBeenCalledTimes(1);
    expect(relayPost).not.toHaveBeenCalled();
    expect(outcomes).toEqual([SUCCEEDED]);
  });

  test("a phone that is gone (DeviceNotRegistered) is never the server's failure", async () => {
    expoTicket("DeviceNotRegistered", "The device is not registered.");

    await send(phones([PHONE_TOKEN]));

    expect(outcomes).toEqual([]);
  });

  test("Expo refusing the app's credentials is the server's", async () => {
    expoTicket("InvalidCredentials", "The push credentials are invalid.");

    await send(phones([PHONE_TOKEN]));

    expect(outcomes).toEqual([
      failed(
        "Expo push notification failed: The push credentials are invalid.",
      ),
    ]);
  });

  test("Expo cannot be reached, or refuses the access token: the server's; asked to slow down: a throttle", async () => {
    expoSend.mockRejectedValue(new Error("getaddrinfo ENOTFOUND exp.host"));

    await send(phones([PHONE_TOKEN]));

    expect(outcomes).toEqual([failed("getaddrinfo ENOTFOUND exp.host")]);

    outcomes = [];
    expoSend.mockRejectedValue(
      Object.assign(new Error("Too Many Requests"), { statusCode: 429 }),
    );

    await send(phones([PHONE_TOKEN]));

    expect(outcomes).toEqual([
      failed("Too Many Requests", ServerSendingFailureScope.Throttled),
    ]);
  });

  test("a token that is not one is that phone's", async () => {
    await send(phones(["not-a-push-token"]));

    expect(expoSend).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });
});

describe("to a browser, with the server's VAPID keys", () => {
  test("its push service took it: the server's push went out", async () => {
    await send(browser());

    expect(webPushSend).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([SUCCEEDED]);
  });

  test("a subscription that is gone (404, 410) or not taken (400, 403) is the browser's", async () => {
    for (const statusCode of [404, 410, 400, 403]) {
      outcomes = [];
      webPushRefuses(statusCode);

      await send(browser());

      expect({ statusCode, outcomes }).toEqual({ statusCode, outcomes: [] });
    }
  });

  test("a message too big is the message's", async () => {
    webPushRefuses(413, "Payload Too Large");

    await send(browser());

    expect(outcomes).toEqual([]);
  });

  test("its VAPID keys refused (401), the push service failing (5xx) or out of reach: the server's", async () => {
    for (const statusCode of [401, 500, 503, undefined]) {
      outcomes = [];
      webPushRefuses(statusCode, `Push service said ${statusCode}`);

      await send(browser());

      expect({ statusCode, outcomes }).toEqual({
        statusCode,
        outcomes: [failed(`Push service said ${statusCode}`)],
      });
    }
  });

  test("asked to slow down: a throttle", async () => {
    webPushRefuses(429, "Too Many Requests");

    await send(browser());

    expect(outcomes).toEqual([
      failed("Too Many Requests", ServerSendingFailureScope.Throttled),
    ]);
  });

  test("a server with no VAPID keys pushes no browser: not set up, which Server Setup says, never failing", async () => {
    PushNotificationService.isWebPushInitialized = false;
    jest
      .spyOn(PushNotificationService, "initializeWebPush")
      .mockImplementation((): void => {});

    await send(browser());

    expect(webPushSend).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });

  test("a subscription at an address that is no push service is the browser's", async () => {
    await send({
      ...browser(),
      devices: [
        {
          token: JSON.stringify({
            endpoint: "https://evil.example.com/push",
            keys: { p256dh: "BNcR", auth: "tBHI" },
          }),
          name: "Laptop",
        },
      ],
    });

    expect(webPushSend).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });
});

describe("one outcome per push, never one per device", () => {
  test("a push any device took went out, whatever the others said", async () => {
    relayPost
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          PushNotificationService.RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE,
          PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
          {},
        ) as never,
      )
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(200, { success: true }, {}) as never,
      );

    await send(phones([PHONE_TOKEN, OTHER_PHONE_TOKEN]));

    expect(relayPost).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual([SUCCEEDED]);
  });

  test("none took it: the server's reason, once, even beside a phone that is gone", async () => {
    relayPost
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          PushNotificationService.RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE,
          PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
          {},
        ) as never,
      )
      .mockRejectedValueOnce(new APIException(RELAY_DOWN) as never);

    await send(phones([PHONE_TOKEN, OTHER_PHONE_TOKEN]));

    expect(outcomes).toEqual([failed(RELAY_DOWN)]);
  });

  test("nothing pushed - push turned off, a blocked project - reports nothing", async () => {
    pushTurnedOff = true;

    await send(phones([PHONE_TOKEN]));

    expect(relayPost).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);

    pushTurnedOff = false;
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(true);

    await send(phones([PHONE_TOKEN]), { projectId: ObjectID.generate() });

    expect(outcomes).toEqual([]);
  });

  test("a push token the relay's answer names is never kept", async () => {
    relayAnswers(500, { error: `Could not send to ${PHONE_TOKEN}` });

    await send(phones([PHONE_TOKEN]));

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.reason).not.toContain(PHONE_TOKEN);
    expect(outcomes[0]!.reason).not.toContain("server-outcomes-0001");
  });
});

describe("whose a failure is", () => {
  test("what each path throws it as; anything else is the server's", () => {
    expect(
      PushNotificationService.getFailureOwner(
        new PushSendFailure("gone", PushFailureOwner.Device),
      ),
    ).toBe(PushFailureOwner.Device);
    expect(PushNotificationService.getFailureOwner(new Error("boom"))).toBe(
      PushFailureOwner.Server,
    );
    expect(PushNotificationService.getFailureOwner("boom")).toBe(
      PushFailureOwner.Server,
    );
  });

  test("Expo's codes: the app's credentials and codes this version does not know are the server's", () => {
    expect(
      PushNotificationService.getExpoRefusalOwner("InvalidCredentials"),
    ).toBe(PushFailureOwner.Server);
    expect(
      PushNotificationService.getExpoRefusalOwner("InvalidProviderToken"),
    ).toBe(PushFailureOwner.Server);
    expect(PushNotificationService.getExpoRefusalOwner(undefined)).toBe(
      PushFailureOwner.Server,
    );
    expect(
      PushNotificationService.getExpoRefusalOwner("DeviceNotRegistered"),
    ).toBe(PushFailureOwner.Device);
    expect(PushNotificationService.getExpoRefusalOwner("MessageTooBig")).toBe(
      PushFailureOwner.Message,
    );
  });
});

/*
 * What a master admin reads (GET /api/global-config/sending-status): push
 * failing with why while the relay cannot be reached, working again once a
 * push goes out - each written once, as news, as the other channels' are.
 */
describe("what the server's sending status reads", () => {
  beforeEach(() => {
    storedConfig = {};
    writeServerSendingHealth.mockImplementation(
      async (health: unknown): Promise<void> => {
        storedConfig = { ...(storedConfig || {}), serverSendingHealth: health };
      },
    );
    ServerSendingStatus.clearCache();
    ServerSendingStatus.startRecordingOutcomes();
  });

  test("the relay out of reach: push is failing, since when, and why; then working again", async () => {
    relayPost.mockRejectedValue(new APIException(RELAY_DOWN) as never);

    await send(phones([PHONE_TOKEN]));

    let push: ServerChannelStatus = await ServerSendingStatus.getStatus(
      ServerSendingChannel.Push,
    );

    expect(push.state).toBe(ServerSendingState.Failing);
    expect(push.lastFailure).toBe(RELAY_DOWN);
    expect(push.failingSince).not.toBeNull();
    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);

    // The same failure again is no news: no write.
    await send(phones([PHONE_TOKEN]));
    await send(phones([PHONE_TOKEN]));

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);

    relayPost.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { success: true }, {}) as never,
    );

    await send(phones([PHONE_TOKEN]));

    push = await ServerSendingStatus.getStatus(ServerSendingChannel.Push);

    expect(push.state).toBe(ServerSendingState.Working);
    expect(push.failingSince).toBeNull();
    expect(writeServerSendingHealth).toHaveBeenCalledTimes(2);

    // Working, and working again within the hour: no write.
    await send(phones([PHONE_TOKEN]));

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(2);
  });

  test("a phone that is gone leaves push as it was", async () => {
    relayAnswers(
      PushNotificationService.RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE,
      PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
    );

    await send(phones([PHONE_TOKEN]));

    expect(
      (await ServerSendingStatus.getStatus(ServerSendingChannel.Push)).state,
    ).toBe(ServerSendingState.Untested);
    expect(writeServerSendingHealth).not.toHaveBeenCalled();
  });
});
