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
import logger from "../../../Server/Utils/Logger";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import PushNotificationLog from "../../../Models/DatabaseModels/PushNotificationLog";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import PushNotificationRequest from "../../../Types/PushNotification/PushNotificationRequest";
import { PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON } from "../../../Types/PushNotification/PushNotificationsTurnedOff";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import API from "../../../Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { Expo } from "expo-server-sdk";
import webpush from "web-push";

/*
 * NOTHING IS PUSHED WHILE THE SERVER HAS PUSH TURNED OFF.
 *
 * A master admin can turn push notifications off for the whole server
 * (Admin Dashboard > Settings > Push Notifications). Then the push sender
 * sends nothing - not to a browser's push service, not to Expo, not to the
 * push relay - and writes no push log. A push asked for meanwhile says why
 * on the person's on-call log row, in the shared words
 * (PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON), rather than "Sending" for
 * ever. sendPushNotificationToUser does not even read the person's devices.
 *
 * A switch that cannot be read refuses too: the send throws, and its caller
 * records the failure as it records any push that failed. With push on,
 * everything is sent as it always was.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-0000000000a1",
);
const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-0000000000b1",
);
const USER_ID: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000c1");
const TIMELINE_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000001",
);

// What a browser's PushSubscription serializes to, and is stored as.
const BROWSER_SUBSCRIPTION: string = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/push-turned-off-0001",
  expirationTime: null,
  keys: { p256dh: "BNcR", auth: "tBHI" },
});

const PHONE_TOKEN: string = "ExponentPushToken[push-turned-off-00001]";

const MESSAGE: PushNotificationMessage = {
  title: "Incident #12: Checkout API is down",
  body: "A new incident has been created.",
};

// The token a device of each type is pushed to.
const TOKENS: Record<PushDeviceType, string> = {
  [PushDeviceType.Web]: BROWSER_SUBSCRIPTION,
  [PushDeviceType.iOS]: PHONE_TOKEN,
  [PushDeviceType.Android]: PHONE_TOKEN,
};

function requestFor(
  deviceType: PushDeviceType,
  message: PushNotificationMessage = MESSAGE,
): PushNotificationRequest {
  return {
    devices: [{ token: TOKENS[deviceType], name: "On-call device" }],
    message: message,
    deviceType: deviceType,
  };
}

// Whether push is turned off, as the server reads it; an Error when the read fails.
let switchAnswer: boolean | Error = false;

let readSwitch: jest.SpyInstance;
let isProjectBlocked: jest.SpyInstance;
let webPushSend: jest.SpyInstance;
let expoSend: jest.SpyInstance;
let relayPost: jest.SpyInstance;
let pushLogCreate: jest.SpyInstance;
let receiptQueueAdd: jest.SpyInstance;
let timelineUpdate: jest.SpyInstance;

// Everything a push leaves the server through.
function expectNothingPushed(): void {
  expect(webPushSend).not.toHaveBeenCalled();
  expect(expoSend).not.toHaveBeenCalled();
  expect(relayPost).not.toHaveBeenCalled();
  expect(receiptQueueAdd).not.toHaveBeenCalled();
  // A push log says a push was sent or failed; a push never tried has none.
  expect(pushLogCreate).not.toHaveBeenCalled();
}

beforeEach(() => {
  switchAnswer = false;

  readSwitch = jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockImplementation(async (): Promise<boolean> => {
      if (switchAnswer instanceof Error) {
        throw switchAnswer;
      }

      return switchAnswer;
    });

  isProjectBlocked = jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
      return projectId.toString() === BLOCKED_PROJECT_ID.toString();
    });

  // A browser's push service, with VAPID keys this test does not need.
  PushNotificationService.isWebPushInitialized = true;
  webPushSend = jest
    .spyOn(webpush, "sendNotification")
    .mockResolvedValue({ statusCode: 201, body: "", headers: {} } as never);

  // Phones go through the push relay: this server has no Expo access token.
  jest
    .spyOn(PushNotificationService, "hasExpoAccessToken")
    .mockReturnValue(false);
  expoSend = jest
    .spyOn(Expo.prototype, "sendPushNotificationsAsync")
    .mockResolvedValue([] as never);
  relayPost = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { success: true }, {}) as never,
    );
  receiptQueueAdd = jest
    .spyOn(ExpoPushReceiptQueue, "add")
    .mockResolvedValue(0 as never);

  pushLogCreate = jest
    .spyOn(PushNotificationLogService, "create")
    .mockImplementation((async (createBy: { data: PushNotificationLog }) => {
      return createBy.data;
    }) as never);

  timelineUpdate = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  PushNotificationService.isWebPushInitialized = false;
  jest.restoreAllMocks();
});

describe("PushNotificationService.isRefusedWhilePushIsTurnedOff", () => {
  test("push on: not refused, and the on-call log is left alone", async () => {
    const markNotSent: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "markNotSent")
      .mockResolvedValue(undefined);

    await expect(
      PushNotificationService.isRefusedWhilePushIsTurnedOff({
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ).resolves.toBe(false);

    expect(readSwitch).toHaveBeenCalledTimes(1);
    expect(markNotSent).not.toHaveBeenCalled();
  });

  test("push off: refused, and the on-call log row says why, in the shared words", async () => {
    switchAnswer = true;

    const markNotSent: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "markNotSent")
      .mockResolvedValue(undefined);

    await expect(
      PushNotificationService.isRefusedWhilePushIsTurnedOff({
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ).resolves.toBe(true);

    expect(markNotSent).toHaveBeenCalledTimes(1);
    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,
    });
  });

  test("push off, with no on-call log row - a test, an owner notification: refused, and nothing is written", async () => {
    switchAnswer = true;

    await expect(
      PushNotificationService.isRefusedWhilePushIsTurnedOff({
        projectId: PROJECT_ID,
      }),
    ).resolves.toBe(true);

    expect(timelineUpdate).not.toHaveBeenCalled();
  });

  test("asked with no options at all, it answers the same", async () => {
    switchAnswer = true;

    await expect(
      PushNotificationService.isRefusedWhilePushIsTurnedOff(),
    ).resolves.toBe(true);

    switchAnswer = false;

    await expect(
      PushNotificationService.isRefusedWhilePushIsTurnedOff(),
    ).resolves.toBe(false);
  });

  test("says why in the server's log too", async () => {
    switchAnswer = true;

    await PushNotificationService.isRefusedWhilePushIsTurnedOff({});

    expect(logger.debug).toHaveBeenCalledWith(
      PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,
    );
  });

  test("a switch that cannot be read refuses by throwing: it is never taken for push being on", async () => {
    switchAnswer = new Error("database unavailable");

    const markNotSent: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "markNotSent")
      .mockResolvedValue(undefined);

    await expect(
      PushNotificationService.isRefusedWhilePushIsTurnedOff({
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ).rejects.toThrow("database unavailable");

    expect(markNotSent).not.toHaveBeenCalled();
  });
});

describe("sendPushNotification while push is off", () => {
  beforeEach(() => {
    switchAnswer = true;
  });

  test.each([
    [PushDeviceType.Web],
    [PushDeviceType.iOS],
    [PushDeviceType.Android],
  ])(
    "a push to a %s device is not sent: no push service, no relay, no push log",
    async (deviceType: PushDeviceType) => {
      await expect(
        PushNotificationService.sendPushNotification(requestFor(deviceType), {
          projectId: PROJECT_ID,
          userOnCallLogTimelineId: TIMELINE_ID,
        }),
      ).resolves.toBeUndefined();

      expectNothingPushed();
    },
  );

  test("the on-call log row says why: an error, in the shared words, whole", async () => {
    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.iOS),
      { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
    );

    // Written once, by UserOnCallLogTimelineService.markNotSent - never "Sent" after it.
    expect(timelineUpdate).toHaveBeenCalledTimes(1);
    expect(timelineUpdate).toHaveBeenCalledWith({
      id: TIMELINE_ID,
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,
      },
      props: { isRoot: true },
    });
  });

  test("a push with no on-call log row is refused without writing anything", async () => {
    await expect(
      PushNotificationService.sendPushNotification(
        requestFor(PushDeviceType.Web),
        { projectId: PROJECT_ID },
      ),
    ).resolves.toBeUndefined();

    expect(timelineUpdate).not.toHaveBeenCalled();
    expectNothingPushed();
  });

  test("a push with no devices is refused before it could fail for having none", async () => {
    await expect(
      PushNotificationService.sendPushNotification(
        { devices: [], message: MESSAGE, deviceType: PushDeviceType.iOS },
        { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      ),
    ).resolves.toBeUndefined();

    expect(timelineUpdate).toHaveBeenCalledTimes(1);
  });

  test("a critical on-call page is not pushed either: the switch is for every push", async () => {
    await expect(
      PushNotificationService.sendPushNotification(
        requestFor(PushDeviceType.iOS, { ...MESSAGE, isCriticalAlert: true }),
        { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      ),
    ).resolves.toBeUndefined();

    expectNothingPushed();
  });

  test("a push to several devices at once sends to none of them", async () => {
    await PushNotificationService.sendPushNotification(
      {
        devices: [
          { token: PHONE_TOKEN, name: "Pixel 8" },
          { token: "ExponentPushToken[push-turned-off-00002]", name: "iPad" },
        ],
        message: MESSAGE,
        deviceType: PushDeviceType.Android,
      },
      { projectId: PROJECT_ID },
    );

    expectNothingPushed();
  });

  test("a project a master admin blocked says so first, and the switch is not read", async () => {
    const markNotSent: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "markNotSent")
      .mockResolvedValue(undefined);

    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.Web),
      { projectId: BLOCKED_PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
    );

    expect(markNotSent).toHaveBeenCalledTimes(1);
    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: `Push notification not sent: ${ExceptionMessages.ProjectBlocked}`,
    });
    expect(readSwitch).not.toHaveBeenCalled();
    expectNothingPushed();
  });

  test("a project that is not blocked hears that push is off", async () => {
    const markNotSent: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "markNotSent")
      .mockResolvedValue(undefined);

    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.Web),
      { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
    );

    expect(isProjectBlocked).toHaveBeenCalledTimes(1);
    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,
    });
  });

  test("a push that names no project - an account notification - is refused too", async () => {
    await expect(
      PushNotificationService.sendPushNotification(
        requestFor(PushDeviceType.Android),
      ),
    ).resolves.toBeUndefined();

    expect(isProjectBlocked).not.toHaveBeenCalled();
    expectNothingPushed();
  });
});

describe("sendPushNotification while push is on", () => {
  test("a browser push is sent, logged, and its on-call log row marked sent", async () => {
    const markNotSent: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "markNotSent",
    );

    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.Web),
      { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
    );

    expect(webPushSend).toHaveBeenCalledTimes(1);
    expect(pushLogCreate).toHaveBeenCalledTimes(1);
    expect(markNotSent).not.toHaveBeenCalled();
    expect(timelineUpdate).toHaveBeenCalledWith({
      id: TIMELINE_ID,
      data: {
        status: UserNotificationStatus.Sent,
        statusMessage: "Push notification sent successfully",
      },
      props: { isRoot: true },
    });
  });

  test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
    "a push to a %s phone goes out through the relay",
    async (deviceType: PushDeviceType) => {
      await PushNotificationService.sendPushNotification(
        requestFor(deviceType),
        { projectId: PROJECT_ID },
      );

      expect(relayPost).toHaveBeenCalledTimes(1);
      expect(pushLogCreate).toHaveBeenCalledTimes(1);
      expect(webPushSend).not.toHaveBeenCalled();
    },
  );

  test("each send asks whether push is off", async () => {
    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.Web),
      { projectId: PROJECT_ID },
    );
    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.iOS),
      { projectId: PROJECT_ID },
    );

    expect(readSwitch).toHaveBeenCalledTimes(2);
  });

  test("turned off between two sends, the second is not pushed", async () => {
    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.Web),
      { projectId: PROJECT_ID },
    );

    switchAnswer = true;

    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.Web),
      { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
    );

    expect(webPushSend).toHaveBeenCalledTimes(1);
    expect(timelineUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: UserNotificationStatus.Error,
          statusMessage: PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,
        },
      }),
    );
  });
});

describe("sendPushNotification when the switch cannot be read", () => {
  beforeEach(() => {
    switchAnswer = new Error("database unavailable");
  });

  test("the send throws the failure, and nothing is pushed", async () => {
    await expect(
      PushNotificationService.sendPushNotification(
        requestFor(PushDeviceType.iOS),
        { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      ),
    ).rejects.toThrow("database unavailable");

    expectNothingPushed();
  });

  test("the on-call log row is not marked 'not sent': the caller records the failure", async () => {
    const markNotSent: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "markNotSent",
    );

    await expect(
      PushNotificationService.sendPushNotification(
        requestFor(PushDeviceType.Web),
        { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      ),
    ).rejects.toThrow("database unavailable");

    expect(markNotSent).not.toHaveBeenCalled();
    expect(timelineUpdate).not.toHaveBeenCalled();
  });
});

describe("sendPushNotificationToUser", () => {
  let devicesRead: jest.SpyInstance;

  function device(type: PushDeviceType, name: string): UserPush {
    const row: UserPush = new UserPush();
    row._id = ObjectID.generate().toString();
    row.deviceType = type;
    row.deviceToken = TOKENS[type];
    row.deviceName = name;
    return row;
  }

  beforeEach(() => {
    devicesRead = jest
      .spyOn(UserPushService, "findBy")
      .mockResolvedValue([
        device(PushDeviceType.Web, "Chrome on Windows"),
        device(PushDeviceType.iOS, "iPhone 15"),
      ] as never);
  });

  test("push off: not even the devices are read, and the on-call log says why once", async () => {
    switchAnswer = true;

    const send: jest.SpyInstance = jest.spyOn(
      PushNotificationService,
      "sendPushNotification",
    );
    const markNotSent: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "markNotSent")
      .mockResolvedValue(undefined);

    await expect(
      PushNotificationService.sendPushNotificationToUser(
        USER_ID,
        PROJECT_ID,
        MESSAGE,
        { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      ),
    ).resolves.toBeUndefined();

    expect(devicesRead).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(markNotSent).toHaveBeenCalledTimes(1);
    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,
    });
    expectNothingPushed();
  });

  test("push on: the person's verified devices in the project are read, and pushed to by type", async () => {
    const send: jest.SpyInstance = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined);

    await PushNotificationService.sendPushNotificationToUser(
      USER_ID,
      PROJECT_ID,
      MESSAGE,
      { projectId: PROJECT_ID },
    );

    expect(devicesRead).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = (
      devicesRead.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["userId"]).toBe(USER_ID);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["isVerified"]).toBe(true);

    expect(
      send.mock.calls
        .map((call: Array<unknown>): string => {
          return (call[0] as PushNotificationRequest).deviceType;
        })
        .sort(),
    ).toEqual([PushDeviceType.iOS, PushDeviceType.Web].sort());
  });

  test("push on, with no devices: nothing is pushed", async () => {
    devicesRead.mockResolvedValue([] as never);

    const send: jest.SpyInstance = jest.spyOn(
      PushNotificationService,
      "sendPushNotification",
    );

    await PushNotificationService.sendPushNotificationToUser(
      USER_ID,
      PROJECT_ID,
      MESSAGE,
    );

    expect(send).not.toHaveBeenCalled();
    expectNothingPushed();
  });

  test("a switch that cannot be read: it throws, and no device is read", async () => {
    switchAnswer = new Error("database unavailable");

    await expect(
      PushNotificationService.sendPushNotificationToUser(
        USER_ID,
        PROJECT_ID,
        MESSAGE,
        { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      ),
    ).rejects.toThrow("database unavailable");

    expect(devicesRead).not.toHaveBeenCalled();
    expectNothingPushed();
  });

  test("turned off once the devices are read, each device's send still refuses", async () => {
    readSwitch.mockResolvedValueOnce(false).mockResolvedValue(true);

    await PushNotificationService.sendPushNotificationToUser(
      USER_ID,
      PROJECT_ID,
      MESSAGE,
      { projectId: PROJECT_ID },
    );

    expect(devicesRead).toHaveBeenCalledTimes(1);
    expectNothingPushed();
  });
});

describe("the server's copy of the switch, as the sender asks it", () => {
  let settingsReads: jest.SpyInstance;

  beforeEach(() => {
    // The real GlobalConfigService, over a settings row that has push off.
    readSwitch.mockRestore();
    GlobalConfigService.forgetPushNotificationsTurnedOff();

    settingsReads = jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue({
        disablePushNotifications: true,
      } as unknown as GlobalConfig);
  });

  afterEach(() => {
    GlobalConfigService.forgetPushNotificationsTurnedOff();
  });

  test("a burst of pages while push is off asks the database once, and each is refused", async () => {
    const markNotSent: jest.SpyInstance = jest
      .spyOn(UserOnCallLogTimelineService, "markNotSent")
      .mockResolvedValue(undefined);

    for (let page: number = 0; page < 5; page++) {
      await PushNotificationService.sendPushNotification(
        requestFor(PushDeviceType.iOS),
        { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      );
    }

    expect(settingsReads).toHaveBeenCalledTimes(1);
    expect(markNotSent).toHaveBeenCalledTimes(5);
    expectNothingPushed();
  });

  test("turned back on and written on this server, the next push goes out", async () => {
    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.Web),
      { projectId: PROJECT_ID },
    );

    expect(webPushSend).not.toHaveBeenCalled();

    // What GlobalConfigService.onUpdateSuccess does once the switch is written.
    settingsReads.mockResolvedValue({
      disablePushNotifications: false,
    } as unknown as GlobalConfig);
    GlobalConfigService.forgetPushNotificationsTurnedOff();

    await PushNotificationService.sendPushNotification(
      requestFor(PushDeviceType.Web),
      { projectId: PROJECT_ID },
    );

    expect(webPushSend).toHaveBeenCalledTimes(1);
    expect(settingsReads).toHaveBeenCalledTimes(2);
  });
});
