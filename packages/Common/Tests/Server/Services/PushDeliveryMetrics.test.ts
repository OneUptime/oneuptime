import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * HOW EVERY PUSH WENT, FOR THE PLATFORM'S OPERATOR (issue #6600).
 *
 * A push is handed to its provider once for every device - a browser's push
 * service, Expo with this server's access token, or Expo through OneUptime's
 * push relay - and each can be accepted or refused on its own, so each is
 * recorded on its own (notification.send.count and .duration). A push not
 * sent because the server has push turned off, or the project is blocked,
 * is recorded as not sent, by no provider. PushNotificationService runs as
 * it is; Expo, web push, the relay, the database and the metrics SDK are
 * stood in for.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const sendDurationCalls: Array<RecordedCall> = [];

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return {
          record: (value: number, attributes: Record<string, string>): void => {
            sendDurationCalls.push({ value, attributes });
          },
        };
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
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserPushService from "../../../Server/Services/UserPushService";
import PushNotificationLog from "../../../Models/DatabaseModels/PushNotificationLog";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import API from "../../../Utils/API";
import OnCallTimelineRows from "../TestingUtils/OnCallTimelineRows";
import { Expo } from "expo-server-sdk";
import webpush from "web-push";

const PROJECT_ID: ObjectID = new ObjectID(
  "66001111-0000-4000-8000-0000000000a1",
);
const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "66001111-0000-4000-8000-0000000000b1",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66001111-0000-4000-8000-000000000001",
);

const BROWSER_SUBSCRIPTION: string = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/delivery-metrics-0001",
  expirationTime: null,
  keys: { p256dh: "BNcR", auth: "tBHI" },
});

const PHONE_TOKEN: string = "ExponentPushToken[delivery-metrics-001]";
const OTHER_PHONE_TOKEN: string = "ExponentPushToken[delivery-metrics-002]";

const MESSAGE: PushNotificationMessage = {
  title: "Incident #12: Checkout API is down",
  body: "A new incident has been created.",
};

let pushTurnedOff: boolean;
let hasExpoToken: boolean;
let webPushSend: jest.SpiedFunction<typeof webpush.sendNotification>;
let expoSend: jest.SpiedFunction<
  typeof Expo.prototype.sendPushNotificationsAsync
>;
let relayPost: jest.SpiedFunction<typeof API.post>;

function sends(): Array<string> {
  return sendCounterCalls.map((call: RecordedCall) => {
    return `${call.attributes["notification.provider"]}:${call.attributes["outcome"]}`;
  });
}

function phones(tokens: Array<string>): PushNotificationRequest {
  return {
    devices: tokens.map((token: string, index: number) => {
      return { token: token, name: `Phone ${index + 1}` };
    }),
    message: MESSAGE,
    deviceType: PushDeviceType.iOS,
  };
}

beforeEach(() => {
  sendCounterCalls.length = 0;
  sendDurationCalls.length = 0;
  pushTurnedOff = false;
  hasExpoToken = false;

  jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockImplementation(async (): Promise<boolean> => {
      return pushTurnedOff;
    });

  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
      return projectId.toString() === BLOCKED_PROJECT_ID.toString();
    });

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

  // The page's timeline row, as written when the page went out.
  const timeline: OnCallTimelineRows = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
  jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserPushService, "markExpoPushTokenAsGone")
    .mockResolvedValue(0 as never);
});

afterEach(() => {
  PushNotificationService.isWebPushInitialized = false;
  jest.restoreAllMocks();
});

describe("a push to a browser", () => {
  test("its push service accepted it: a success through web_push", async () => {
    await PushNotificationService.sendPushNotification(
      {
        devices: [{ token: BROWSER_SUBSCRIPTION, name: "Laptop" }],
        message: MESSAGE,
        deviceType: PushDeviceType.Web,
      },
      { projectId: PROJECT_ID },
    );

    expect(webPushSend).toHaveBeenCalledTimes(1);
    expect(sendCounterCalls).toEqual([
      {
        value: 1,
        attributes: {
          "notification.channel": "push",
          "notification.provider": "web_push",
          "notification.provider.config": "global",
          "notification.on_call_page": "false",
          outcome: "success",
        },
      },
    ]);
    expect(sendDurationCalls).toHaveLength(1);
  });

  test("its push service refused it: a failure through web_push", async () => {
    webPushSend.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { statusCode: 403 }) as never,
    );

    await expect(
      PushNotificationService.sendPushNotification(
        {
          devices: [{ token: BROWSER_SUBSCRIPTION, name: "Laptop" }],
          message: MESSAGE,
          deviceType: PushDeviceType.Web,
        },
        { projectId: PROJECT_ID },
      ),
    ).rejects.toThrow();

    expect(sends()).toEqual(["web_push:failure"]);
  });
});

describe("a push to a phone", () => {
  test("with this server's Expo access token: counted under expo", async () => {
    hasExpoToken = true;

    await PushNotificationService.sendPushNotification(phones([PHONE_TOKEN]), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(expoSend).toHaveBeenCalledTimes(1);
    expect(relayPost).not.toHaveBeenCalled();
    expect(sendCounterCalls[0]!.attributes).toEqual({
      "notification.channel": "push",
      "notification.provider": "expo",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "success",
    });
  });

  test("without one, through OneUptime's push relay: counted under push_relay", async () => {
    await PushNotificationService.sendPushNotification(phones([PHONE_TOKEN]), {
      projectId: PROJECT_ID,
    });

    expect(relayPost).toHaveBeenCalledTimes(1);
    expect(expoSend).not.toHaveBeenCalled();
    expect(sends()).toEqual(["push_relay:success"]);
  });

  test("Expo refused it: a failure through expo", async () => {
    hasExpoToken = true;
    expoSend.mockResolvedValue([
      { status: "error", message: "The message was too big." },
    ] as never);

    await expect(
      PushNotificationService.sendPushNotification(phones([PHONE_TOKEN]), {
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow();

    expect(sends()).toEqual(["expo:failure"]);
  });

  test("the relay refused it: a failure through push_relay", async () => {
    relayPost.mockResolvedValue(
      new HTTPErrorResponse(502, { message: "relay down" }, {}) as never,
    );

    await expect(
      PushNotificationService.sendPushNotification(phones([PHONE_TOKEN]), {
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow();

    expect(sends()).toEqual(["push_relay:failure"]);
  });

  test("to two phones, one accepted and one refused: each counted on its own", async () => {
    hasExpoToken = true;
    expoSend.mockImplementation((async (
      messages: Array<{ to: string }>,
    ): Promise<unknown> => {
      return messages[0]!.to === PHONE_TOKEN
        ? [{ status: "ok", id: "receipt-1" }]
        : [{ status: "error", message: "Rate exceeded." }];
    }) as never);

    // One device reached: the push as a whole went out, and does not throw.
    await PushNotificationService.sendPushNotification(
      phones([PHONE_TOKEN, OTHER_PHONE_TOKEN]),
      { projectId: PROJECT_ID },
    );

    expect(sends().sort()).toEqual(["expo:failure", "expo:success"]);
    expect(sendDurationCalls).toHaveLength(2);
  });
});

describe("a push not sent", () => {
  test("while the server has push turned off: not sent, by no provider, and nothing else", async () => {
    pushTurnedOff = true;

    await PushNotificationService.sendPushNotification(phones([PHONE_TOKEN]), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(expoSend).not.toHaveBeenCalled();
    expect(relayPost).not.toHaveBeenCalled();
    expect(sendCounterCalls).toEqual([
      {
        value: 1,
        attributes: {
          "notification.channel": "push",
          "notification.provider": "none",
          "notification.provider.config": "global",
          "notification.on_call_page": "true",
          outcome: "not_sent",
        },
      },
    ]);
    expect(sendDurationCalls).toHaveLength(0);
  });

  test("to a person, while push is turned off: counted once, before any device is read", async () => {
    pushTurnedOff = true;

    await PushNotificationService.sendPushNotificationToUser(
      new ObjectID("66001111-0000-4000-8000-0000000000c1"),
      PROJECT_ID,
      MESSAGE,
    );

    expect(sends()).toEqual(["none:not_sent"]);
  });

  test("for a project a master admin blocked: not sent", async () => {
    await PushNotificationService.sendPushNotification(phones([PHONE_TOKEN]), {
      projectId: BLOCKED_PROJECT_ID,
    });

    expect(expoSend).not.toHaveBeenCalled();
    expect(relayPost).not.toHaveBeenCalled();
    expect(sends()).toEqual(["none:not_sent"]);
    expect(sendCounterCalls[0]!.attributes["notification.channel"]).toBe(
      "push",
    );
  });
});
