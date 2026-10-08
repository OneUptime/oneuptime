import UserPushAPI from "../../../Server/API/UserPushAPI";
import TestSendAccess from "../../../Server/API/TestSendAccess";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import API from "../../../Utils/API";
import { mockRouter } from "./Helpers";
import { Expo, ExpoPushTicket } from "expo-server-sdk";
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
 * Test Notification is where a person checks a device, and where they land
 * after the device list says it no longer receives notifications. For a
 * phone Expo said was gone, both answers say what to do on the phone: open
 * the mobile app, which registers it again.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000051");
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000052",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000053",
);

const PHONE_TOKEN: string = "ExponentPushToken[test-phone-0000000001]";

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

describe("POST /user-push/:deviceId/test-notification to a device that no longer receives notifications", () => {
  let device: Record<string, unknown>;
  let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserPushAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    device = {
      _id: DEVICE_ID.toString(),
      userId: USER_ID,
      projectId: PROJECT_ID,
      deviceName: "Pixel 8",
      deviceToken: PHONE_TOKEN,
      deviceType: PushDeviceType.Android,
      isVerified: true,
      isCriticalAlertEnabled: false,
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

    markAsGone = jest
      .spyOn(UserPushService, "markExpoPushTokenAsGone")
      .mockResolvedValue(1);

    jest
      .spyOn(PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: unknown }) => {
        return createBy.data;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
    "%s, marked as not receiving: says to open the mobile app on it, and sends nothing",
    async (deviceType: PushDeviceType) => {
      device["deviceType"] = deviceType;
      device["isVerified"] = false;

      const send: SpyInstance<typeof PushNotificationService.sendPushNotification> =
        jest.spyOn(PushNotificationService, "sendPushNotification");

      const answer: Answer = await sendTestNotification();

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe(
        "This device no longer receives push notifications. Open the mobile app on it to register it again.",
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  test("a browser, marked as not receiving: says to register it again, as it did", async () => {
    device["deviceType"] = PushDeviceType.Web;
    device["isVerified"] = false;

    const answer: Answer = await sendTestNotification();

    expect((answer as Error).message).toBe(
      "This device no longer receives push notifications. Register it again from the browser or app it belongs to.",
    );
  });

  test("a phone Expo says is gone: the test fails with what happened and what to do, and the phone is marked", async () => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);
    jest
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation((async () => {
        const ticket: ExpoPushTicket = {
          status: "error",
          message: `"${PHONE_TOKEN}" is not a registered push notification recipient`,
          details: { error: "DeviceNotRegistered" },
        };
        return [ticket];
      }) as never);

    const answer: Answer = await sendTestNotification();

    expect(answer).toBeInstanceOf(BadDataException);
    expect((answer as Error).message).toBe(
      `Failed to send test notification: ${PushNotificationService.EXPO_PUSH_TOKEN_GONE_MESSAGE}`,
    );
    expect((answer as Error).message).not.toContain(PHONE_TOKEN);
    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(markAsGone.mock.calls[0]![0]).toEqual({ deviceToken: PHONE_TOKEN });
  });

  test("a phone the relay says is gone: the same, on a server without Expo credentials", async () => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);
    jest.spyOn(API, "post").mockImplementation((async () => {
      return new HTTPErrorResponse(
        PushNotificationService.RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE,
        PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
        {},
      );
    }) as never);

    const answer: Answer = await sendTestNotification();

    expect((answer as Error).message).toBe(
      `Failed to send test notification: ${PushNotificationService.EXPO_PUSH_TOKEN_GONE_MESSAGE}`,
    );
    expect(markAsGone).toHaveBeenCalledTimes(1);
  });
});
