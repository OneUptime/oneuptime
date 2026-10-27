import UserPushAPI, {
  isTestNotificationCritical,
} from "../../../Server/API/UserPushAPI";
import TestSendAccess from "../../../Server/API/TestSendAccess";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CriticalAlertSound from "../../../Types/PushNotification/CriticalAlertSound";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import { mockRouter } from "./Helpers";
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

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * The maintainer's screenshot: "Test Notification Sent - Sent to iPhone 14
 * Pro Max as a critical alert: it rings even when the phone is on silent or
 * in Do Not Disturb" - while the phone had critical alerts off. The dialog
 * worded what the device list showed, which was read before the phone last
 * reported. The route now says whether the test it sent went as a critical
 * alert, and the Dashboard words that.
 *
 * It sends exactly what a page to the device would: a critical alert for a
 * phone whose critical alerts are on, as its app last reported them, and an
 * ordinary push for every other device.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000141");
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000142",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000143",
);

type Answer = { json: JSONObject } | Error;

async function sendTestNotification(): Promise<Answer> {
  (Response.sendErrorResponse as jest.Mock).mockClear();
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const req: OneUptimeRequest = {
    params: { deviceId: DEVICE_ID.toString() },
    body: {},
    headers: {},
    query: {},
  } as unknown as OneUptimeRequest;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("POST", "/user-push/:deviceId/test-notification")
    .handlerFunction(req, res, (err?: unknown): void => {
      failure = err as Error;
    });

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  if (!failure && errorCalls.length > 0) {
    failure = errorCalls[0]![2] as Error;
  }

  if (failure) {
    return failure;
  }

  return {
    json: (Response.sendJsonObjectResponse as jest.Mock).mock
      .calls[0]![2] as JSONObject,
  };
}

describe("isTestNotificationCritical", () => {
  test.each([
    [PushDeviceType.iOS, true, true],
    [PushDeviceType.Android, true, true],
    [PushDeviceType.iOS, false, false],
    [PushDeviceType.Android, false, false],
    [PushDeviceType.iOS, undefined, false],
    // A browser cannot ring through silent mode, whatever is stored for it.
    [PushDeviceType.Web, true, false],
    [PushDeviceType.Web, false, false],
    ["watch", true, false],
    [undefined, true, false],
  ])(
    "a %s device with critical alerts %s: critical = %s",
    (
      deviceType: unknown,
      isCriticalAlertEnabled: boolean | undefined,
      expected: boolean,
    ) => {
      expect(
        isTestNotificationCritical({
          deviceType: deviceType,
          isCriticalAlertEnabled: isCriticalAlertEnabled,
        }),
      ).toBe(expected);
    },
  );
});

describe("POST /user-push/:deviceId/test-notification says whether it went as a critical alert", () => {
  let device: Record<string, unknown>;
  let send: SpyInstance<typeof PushNotificationService.sendPushNotification>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserPushAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Push is on for the whole server (GlobalConfig.disablePushNotifications).
    jest
      .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
      .mockResolvedValue(false);

    device = {
      _id: DEVICE_ID.toString(),
      userId: USER_ID,
      projectId: PROJECT_ID,
      deviceName: "iPhone 14 Pro Max",
      deviceToken: "ExponentPushToken[test-answer-000000001]",
      deviceType: PushDeviceType.iOS,
      isVerified: true,
      isCriticalAlertEnabled: true,
      criticalAlertSound: CriticalAlertSound.Klaxon,
      criticalAlertVolume: 75,
    };

    jest.spyOn(TestSendAccess, "assertMaySendTestToSelf").mockResolvedValue({
      props: {
        userId: USER_ID,
        userGlobalAccessPermission: { projectIds: [PROJECT_ID] },
      },
      userId: USER_ID,
    } as never);

    jest.spyOn(UserPushService, "findOneById").mockImplementation((async () => {
      return device;
    }) as never);

    send = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function sent(): PushNotificationRequest {
    expect(send).toHaveBeenCalledTimes(1);
    return send.mock.calls[0]![0];
  }

  test("a phone whose app reported critical alerts on: a critical test, and the answer says so", async () => {
    const answer: Answer = await sendTestNotification();

    expect(answer).toEqual({
      json: {
        success: true,
        message: "Test notification sent successfully",
        isCriticalAlert: true,
      },
    });
    expect(sent().message.isCriticalAlert).toBe(true);
    expect(sent().message.title).toBe("Test Critical Alert from OneUptime");
    // With the alarm and volume a page would play.
    expect(sent().message.criticalAlertSound).toBe(CriticalAlertSound.Klaxon);
    expect(sent().message.criticalAlertVolume).toBe(75);
  });

  /*
   * The maintainer's phone, once its app has reported: critical alerts off
   * on the phone. The device list may still show On; the test goes as an
   * ordinary push, and the answer says it did.
   */
  test("a phone whose app reported critical alerts off: an ordinary test, and the answer says so", async () => {
    device["isCriticalAlertEnabled"] = false;

    const answer: Answer = await sendTestNotification();

    expect(answer).toEqual({
      json: {
        success: true,
        message: "Test notification sent successfully",
        isCriticalAlert: false,
      },
    });
    expect(sent().message.isCriticalAlert).toBe(false);
    expect(sent().message.title).toBe("Test Notification from OneUptime");
  });

  test("an Android phone with them on: critical", async () => {
    device["deviceType"] = PushDeviceType.Android;

    const answer: Answer = await sendTestNotification();

    expect((answer as { json: JSONObject }).json["isCriticalAlert"]).toBe(true);
    expect(sent().message.isCriticalAlert).toBe(true);
  });

  test("a browser is never sent a critical test, whatever is stored for it", async () => {
    device["deviceType"] = PushDeviceType.Web;
    device["deviceToken"] = JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/test-answer",
      keys: { p256dh: "BNcR", auth: "tBHI" },
    });

    const answer: Answer = await sendTestNotification();

    expect((answer as { json: JSONObject }).json["isCriticalAlert"]).toBe(
      false,
    );
    expect(sent().message.isCriticalAlert).toBe(false);
  });

  test("the answer is the device as it is when the test is sent: it is read for this test", async () => {
    let reads: number = 0;

    jest
      .spyOn(UserPushService, "findOneById")
      .mockImplementation((async (findBy: {
        select: Record<string, unknown>;
      }) => {
        reads++;
        expect(findBy.select["isCriticalAlertEnabled"]).toBe(true);
        expect(findBy.select["deviceType"]).toBe(true);
        // The app reported off a moment ago.
        return { ...device, isCriticalAlertEnabled: !(reads > 1) };
      }) as never);

    const first: Answer = await sendTestNotification();
    const second: Answer = await sendTestNotification();

    expect((first as { json: JSONObject }).json["isCriticalAlert"]).toBe(true);
    expect((second as { json: JSONObject }).json["isCriticalAlert"]).toBe(
      false,
    );
  });

  test("a test that could not be sent says why, and claims nothing about how it went", async () => {
    send.mockRejectedValue(new Error("Expo is unreachable"));

    const answer: Answer = await sendTestNotification();

    expect(answer).toBeInstanceOf(BadDataException);
    expect((answer as Error).message).toBe(
      "Failed to send test notification: Expo is unreachable",
    );
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
