import PushNotificationService, {
  EXPO_DEVICE_NOT_REGISTERED,
  ExpoDeviceNotRegisteredError,
} from "../../../Server/Services/PushNotificationService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  EXPO_PUSH_DEVICE_TYPES,
  isExpoPushDeviceType,
} from "../../../Types/PushNotification/ExpoPushDeviceType";
import { PushNotificationRelayUrl } from "../../../Server/EnvironmentConfig";
import PushNotificationLog from "../../../Models/DatabaseModels/PushNotificationLog";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import APIException from "../../../Types/Exception/ApiException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushStatus from "../../../Types/PushNotification/PushStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import API, { APIRequestOptions } from "../../../Utils/API";
import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * Expo answers a send to a push token it can no longer deliver to - the
 * mobile app was removed from the phone, or the phone's push token is no
 * longer valid - with a DeviceNotRegistered ticket. The direct send path
 * logged "Expo push token is no longer valid (DeviceNotRegistered)" and did
 * nothing else: the phone stayed verified, every later page went to the dead
 * token and failed at Expo, and the device list, readiness and the on-call
 * timeline all kept treating it as reachable. Through the push relay (a
 * server without EXPO_ACCESS_TOKEN) nobody could even tell: the relay
 * answered a gone token like any failure, 500 "Server Error".
 *
 * Its devices now stop being verified, on both paths, exactly as a gone web
 * push subscription's do (WebPushGoneSubscription.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000041",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000042",
);

const GONE_TOKEN: string = "ExponentPushToken[gone-phone-0000000001]";
const WORKING_TOKEN: string = "ExponentPushToken[working-phone-000002]";

const GONE_MESSAGE: string =
  "Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid. The device is marked as not receiving notifications; open the mobile app on it to register it again.";

// The ticket Expo answers a gone token with, its message naming the token.
function deviceNotRegistered(token: string): ExpoPushTicket {
  return {
    status: "error",
    message: `"${token}" is not a registered push notification recipient`,
    details: { error: "DeviceNotRegistered", expoPushToken: token },
  };
}

// Expo's other error codes, none of which says the token is gone.
type OtherExpoError =
  | "DeveloperError"
  | "ExpoError"
  | "InvalidCredentials"
  | "MessageRateExceeded"
  | "MessageTooBig"
  | "ProviderError";

function expoError(error: OtherExpoError, message: string): ExpoPushTicket {
  return { status: "error", message: message, details: { error: error } };
}

const OTHER_EXPO_ERRORS: Array<[OtherExpoError, string]> = [
  ["MessageTooBig", "the payload is over 4096 bytes"],
  ["MessageRateExceeded", "too many messages to the device"],
  ["InvalidCredentials", "the push credentials are not valid"],
  ["DeveloperError", "the message is malformed"],
  ["ProviderError", "APNs or FCM failed"],
  ["ExpoError", "Expo failed"],
];

async function sendTo(
  tokens: Array<string>,
  deviceType: PushDeviceType,
  options: { userOnCallLogTimelineId?: ObjectID } = {},
): Promise<unknown> {
  try {
    await PushNotificationService.sendPushNotification(
      {
        devices: tokens.map((token: string) => {
          return { token: token, name: "Pixel 8" };
        }),
        message: {
          title: "Incident #42: Checkout is down",
          body: "A new incident has been created.",
        },
        deviceType: deviceType,
      },
      { projectId: PROJECT_ID, ...options },
    );

    return null;
  } catch (error) {
    return error;
  }
}

function messageOf(failure: unknown): string {
  expect(failure).toBeInstanceOf(Error);
  return (failure as Error).message;
}

describe("an Expo push token Expo says is gone, sent with the deployment's own Expo access token", () => {
  let send: SpyInstance<typeof Expo.prototype.sendPushNotificationsAsync>;
  let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;
  let markWebAsGone: SpyInstance<
    typeof UserPushService.markWebPushSubscriptionAsGone
  >;
  let relayPosts: Array<APIRequestOptions>;
  let logs: Array<PushNotificationLog>;
  let timelineUpdates: Array<{ status: unknown; statusMessage: unknown }>;

  // Expo's answer to each token; anything else is accepted.
  let answers: Map<string, ExpoPushTicket | Error>;

  beforeEach(() => {
    answers = new Map<string, ExpoPushTicket | Error>();
    logs = [];
    timelineUpdates = [];
    relayPosts = [];

    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    send = jest
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation((async (messages: Array<ExpoPushMessage>) => {
        const answer: ExpoPushTicket | Error | undefined = answers.get(
          messages[0]!.to as string,
        );

        if (answer instanceof Error) {
          throw answer;
        }

        return [answer || { status: "ok", id: "receipt-1" }];
      }) as never);

    markAsGone = jest
      .spyOn(UserPushService, "markExpoPushTokenAsGone")
      .mockResolvedValue(1);

    markWebAsGone = jest
      .spyOn(UserPushService, "markWebPushSubscriptionAsGone")
      .mockResolvedValue(0);

    // The direct path never goes near the relay.
    jest.spyOn(API, "post").mockImplementation((async (
      options: APIRequestOptions,
    ) => {
      relayPosts.push(options);
      throw new Error("The direct path sent to the relay.");
    }) as never);

    jest
      .spyOn(PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: PushNotificationLog }) => {
        logs.push(createBy.data);
        return createBy.data;
      }) as never);

    jest
      .spyOn(UserOnCallLogTimelineService, "updateOneById")
      .mockImplementation((async (updateBy: {
        data: { status: unknown; statusMessage: unknown };
      }) => {
        timelineUpdates.push(updateBy.data);
        return 1;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [PushDeviceType.iOS, "an iPhone"],
    [PushDeviceType.Android, "an Android phone"],
  ])(
    "%s (%s): the devices registered with the token stop being verified",
    async (deviceType: PushDeviceType) => {
      answers.set(GONE_TOKEN, deviceNotRegistered(GONE_TOKEN));

      await sendTo([GONE_TOKEN], deviceType);

      expect(send).toHaveBeenCalledTimes(1);
      expect(markAsGone).toHaveBeenCalledTimes(1);
      /*
       * Every account that registered the phone: the token is gone for all
       * of them alike.
       */
      expect(markAsGone.mock.calls[0]![0]).toEqual({
        deviceToken: GONE_TOKEN,
      });
      // A phone's token is never a browser's subscription.
      expect(markWebAsGone).not.toHaveBeenCalled();
      expect(relayPosts).toHaveLength(0);
    },
  );

  test("the send still fails, and its log says what happened and what to do", async () => {
    answers.set(GONE_TOKEN, deviceNotRegistered(GONE_TOKEN));

    const failure: unknown = await sendTo([GONE_TOKEN], PushDeviceType.iOS);

    expect(messageOf(failure)).toBe(GONE_MESSAGE);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe(PushStatus.Error);
    expect(logs[0]!.statusMessage).toBe(GONE_MESSAGE);
    expect(GONE_MESSAGE).toBe(
      PushNotificationService.EXPO_PUSH_TOKEN_GONE_MESSAGE,
    );
  });

  /*
   * The on-call path sends to one device and hands the timeline row it made
   * to the send. That row said "Failed to send push notification: 1 errors",
   * and the caller then overwrote it with the thrown "Failed to send push
   * notification to all 1 devices": nothing on-call could act on.
   */
  test("the on-call timeline row says why the page did not reach the phone, and how to bring it back", async () => {
    answers.set(GONE_TOKEN, deviceNotRegistered(GONE_TOKEN));

    const failure: unknown = await sendTo([GONE_TOKEN], PushDeviceType.iOS, {
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(timelineUpdates).toEqual([
      { status: UserNotificationStatus.Error, statusMessage: GONE_MESSAGE },
    ]);
    // What the caller writes to the same row when the send rejects.
    expect(messageOf(failure)).toBe(GONE_MESSAGE);
  });

  test("a device that still works in the same send is delivered to, and left alone", async () => {
    answers.set(GONE_TOKEN, deviceNotRegistered(GONE_TOKEN));

    const failure: unknown = await sendTo(
      [GONE_TOKEN, WORKING_TOKEN],
      PushDeviceType.Android,
      { userOnCallLogTimelineId: TIMELINE_ID },
    );

    // One device got it, so the send as a whole did not fail.
    expect(failure).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(markAsGone.mock.calls[0]![0]).toEqual({ deviceToken: GONE_TOKEN });
    expect(
      logs.map((log: PushNotificationLog) => {
        return log.status;
      }),
    ).toEqual([PushStatus.Error, PushStatus.Success]);
    expect(timelineUpdates).toEqual([
      {
        status: UserNotificationStatus.Sent,
        statusMessage: "Push notification sent successfully",
      },
    ]);
  });

  test.each(OTHER_EXPO_ERRORS)(
    "%s (%s) says nothing about the token: the devices stay as they are",
    async (error: OtherExpoError, description: string) => {
      answers.set(GONE_TOKEN, expoError(error, description));

      const failure: unknown = await sendTo([GONE_TOKEN], PushDeviceType.iOS);

      expect(markAsGone).not.toHaveBeenCalled();
      expect(messageOf(failure)).toBe(
        `Expo push notification failed: ${description}`,
      );
      expect(logs[0]!.statusMessage).toBe(
        `Expo push notification failed: ${description}`,
      );
    },
  );

  test("an error ticket that names no error says nothing about the token", async () => {
    answers.set(GONE_TOKEN, {
      status: "error",
      message: "Something went wrong",
    });

    await sendTo([GONE_TOKEN], PushDeviceType.iOS);

    expect(markAsGone).not.toHaveBeenCalled();
  });

  test("Expo failing the whole request - no ticket at all - leaves the devices as they are", async () => {
    answers.set(
      GONE_TOKEN,
      new Error("request to https://exp.host failed, reason: ECONNRESET"),
    );

    const failure: unknown = await sendTo([GONE_TOKEN], PushDeviceType.iOS);

    expect(markAsGone).not.toHaveBeenCalled();
    expect(messageOf(failure)).toBe(
      "request to https://exp.host failed, reason: ECONNRESET",
    );
  });

  test("a failure to mark the devices does not hide that the send failed, nor why", async () => {
    answers.set(GONE_TOKEN, deviceNotRegistered(GONE_TOKEN));
    markAsGone.mockRejectedValue(new Error("database unavailable"));

    const failure: unknown = await sendTo([GONE_TOKEN], PushDeviceType.iOS);

    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(messageOf(failure)).toBe(GONE_MESSAGE);
    expect(logs[0]!.statusMessage).toBe(GONE_MESSAGE);
  });

  /*
   * The token is the address that pushes to the person's phone. Expo writes
   * it into its error messages, and the push log is read by every member of
   * the project.
   */
  test("the token never reaches the push log or the timeline, whatever Expo's message says", async () => {
    answers.set(GONE_TOKEN, deviceNotRegistered(GONE_TOKEN));
    answers.set(
      WORKING_TOKEN,
      expoError("MessageRateExceeded", `Too many messages to ${WORKING_TOKEN}`),
    );

    const failure: unknown = await sendTo(
      [GONE_TOKEN, WORKING_TOKEN],
      PushDeviceType.iOS,
      { userOnCallLogTimelineId: TIMELINE_ID },
    );

    const written: string = JSON.stringify({
      failure: messageOf(failure),
      logs: logs.map((log: PushNotificationLog) => {
        return log.statusMessage;
      }),
      timeline: timelineUpdates,
    });

    expect(written).not.toContain(GONE_TOKEN);
    expect(written).not.toContain(WORKING_TOKEN);
    expect(logs[1]!.statusMessage).toBe(
      "Expo push notification failed: Too many messages to [push token]",
    );
  });

  test("a token that is not an Expo push token is refused before Expo is asked, without being repeated", async () => {
    const notAToken: string = '{"endpoint":"https://fcm.googleapis.com/x"}';

    const failure: unknown = await sendTo([notAToken], PushDeviceType.iOS);

    expect(send).not.toHaveBeenCalled();
    expect(markAsGone).not.toHaveBeenCalled();
    expect(messageOf(failure)).toBe("Invalid Expo push token for ios device.");
    expect(logs[0]!.statusMessage).not.toContain(notAToken);
  });

  test("a token Expo accepts is left alone", async () => {
    const failure: unknown = await sendTo(
      [WORKING_TOKEN],
      PushDeviceType.Android,
      { userOnCallLogTimelineId: TIMELINE_ID },
    );

    expect(failure).toBeNull();
    expect(markAsGone).not.toHaveBeenCalled();
    expect(logs[0]!.status).toBe(PushStatus.Success);
    expect(timelineUpdates).toEqual([
      {
        status: UserNotificationStatus.Sent,
        statusMessage: "Push notification sent successfully",
      },
    ]);
  });
});

describe("an Expo push token Expo says is gone, sent through the push relay", () => {
  let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;
  let expoSend: SpyInstance<typeof Expo.prototype.sendPushNotificationsAsync>;
  let posts: Array<APIRequestOptions>;
  let logs: Array<PushNotificationLog>;

  // What the relay answers, or throws when it cannot be reached.
  let relayAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error;

  beforeEach(() => {
    posts = [];
    logs = [];
    relayAnswer = new HTTPResponse<JSONObject>(200, { success: true }, {});

    // No EXPO_ACCESS_TOKEN: a self-hosted server relays its pages.
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);

    jest.spyOn(API, "post").mockImplementation((async (
      options: APIRequestOptions,
    ) => {
      posts.push(options);

      if (relayAnswer instanceof Error) {
        throw relayAnswer;
      }

      return relayAnswer;
    }) as never);

    expoSend = jest.spyOn(Expo.prototype, "sendPushNotificationsAsync");

    markAsGone = jest
      .spyOn(UserPushService, "markExpoPushTokenAsGone")
      .mockResolvedValue(2);

    jest
      .spyOn(PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: PushNotificationLog }) => {
        logs.push(createBy.data);
        return createBy.data;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function relayAnswers(statusCode: number, body: JSONObject): void {
    relayAnswer = new HTTPErrorResponse(statusCode, body, {});
  }

  test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
    "%s: the relay's answer that the token is gone stops the devices being verified",
    async (deviceType: PushDeviceType) => {
      relayAnswers(
        410,
        PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
      );

      const failure: unknown = await sendTo([GONE_TOKEN], deviceType);

      expect(markAsGone).toHaveBeenCalledTimes(1);
      expect(markAsGone.mock.calls[0]![0]).toEqual({ deviceToken: GONE_TOKEN });
      expect(messageOf(failure)).toBe(GONE_MESSAGE);
      expect(logs[0]!.statusMessage).toBe(GONE_MESSAGE);
      // The relay sends; this server holds no Expo credentials to try with.
      expect(expoSend).not.toHaveBeenCalled();
    },
  );

  test("what is sent to the relay is what it always was", async () => {
    await sendTo([WORKING_TOKEN], PushDeviceType.Android);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.url.toString()).toBe(PushNotificationRelayUrl);
    expect(posts[0]!.data).toEqual({
      to: WORKING_TOKEN,
      title: "Incident #42: Checkout is down",
      body: "A new incident has been created.",
      data: {},
      sound: "default",
      priority: "high",
      channelId: "oncall_high",
    });
    expect(markAsGone).not.toHaveBeenCalled();
    expect(logs[0]!.status).toBe(PushStatus.Success);
  });

  /*
   * A relay older than this answers a gone token like any failure. This
   * server cannot tell, and does what it always did: the send fails, and the
   * devices are left as they are.
   */
  test("an older relay's answer to a gone token - 500 Server Error - leaves the devices as they are", async () => {
    relayAnswers(500, { error: "Server Error" });

    const failure: unknown = await sendTo([GONE_TOKEN], PushDeviceType.iOS);

    expect(markAsGone).not.toHaveBeenCalled();
    expect(messageOf(failure)).toBe(
      'Push relay error: {"error":"Server Error"}',
    );
  });

  test.each([
    ["a 410 with no body worth reading", 410, {}],
    ["a 410 from a proxy, as text", 410, { data: "<html>Gone</html>" }],
    ["a 410 naming another Expo error", 410, { details: { error: "ExpoError" } }],
    [
      "a 410 whose code is spelled differently",
      410,
      { details: { error: "devicenotregistered" } },
    ],
    ["a 410 whose details are not an object", 410, { details: "x" }],
    [
      "a 410 whose details are a list",
      410,
      { details: [{ error: EXPO_DEVICE_NOT_REGISTERED }] },
    ],
    ["a 410 with Expo's code at the top level", 410, { error: EXPO_DEVICE_NOT_REGISTERED }],
    [
      "Expo's code in a 400",
      400,
      { details: { error: EXPO_DEVICE_NOT_REGISTERED } },
    ],
    [
      "Expo's code in a 500",
      500,
      { details: { error: EXPO_DEVICE_NOT_REGISTERED } },
    ],
    [
      "Expo's code in a 404",
      404,
      { details: { error: EXPO_DEVICE_NOT_REGISTERED } },
    ],
    [
      "a refusal of the request itself",
      400,
      {
        message:
          "Invalid or missing push token. Must be a valid Expo push token.",
      },
    ],
    ["the relay's rate limit", 429, { message: "Rate limit exceeded." }],
  ])(
    "%s says nothing about the token: the devices stay as they are",
    async (_name: string, statusCode: number, body: JSONObject) => {
      relayAnswers(statusCode, body);

      const failure: unknown = await sendTo([GONE_TOKEN], PushDeviceType.iOS);

      expect(markAsGone).not.toHaveBeenCalled();
      expect(messageOf(failure)).toMatch(/^Push relay error: /);
    },
  );

  test("a relay that cannot be reached leaves the devices as they are", async () => {
    relayAnswer = new APIException(
      "Request failed to https://oneuptime.com/api/notification/push-relay/send. Connection refused",
    );

    const failure: unknown = await sendTo([GONE_TOKEN], PushDeviceType.iOS);

    expect(markAsGone).not.toHaveBeenCalled();
    expect(messageOf(failure)).toMatch(/Connection refused$/);
  });

  test("a failure to mark the devices does not hide that the send failed, nor why", async () => {
    relayAnswers(
      410,
      PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
    );
    markAsGone.mockRejectedValue(new Error("database unavailable"));

    const failure: unknown = await sendTo([GONE_TOKEN], PushDeviceType.iOS);

    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(messageOf(failure)).toBe(GONE_MESSAGE);
  });
});

describe("the relay's own send (sendRelayPushNotification)", () => {
  let answer: ExpoPushTicket;
  let markAsGone: SpyInstance<typeof UserPushService.markExpoPushTokenAsGone>;
  let updateBy: SpyInstance<typeof UserPushService.updateBy>;

  beforeEach(() => {
    answer = { status: "ok", id: "receipt-1" };

    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    jest
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockImplementation((async () => {
        return [answer];
      }) as never);

    markAsGone = jest.spyOn(UserPushService, "markExpoPushTokenAsGone");
    updateBy = jest.spyOn(UserPushService, "updateBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function relaySend(): Promise<unknown> {
    try {
      await PushNotificationService.sendRelayPushNotification({
        to: GONE_TOKEN,
        title: "Incident #42",
        body: "Checkout is down",
      });
      return null;
    } catch (error) {
      return error;
    }
  }

  test("a gone token is a failure of its own kind, so the route can say so", async () => {
    answer = deviceNotRegistered(GONE_TOKEN) as ExpoPushTicket;

    const failure: unknown = await relaySend();

    expect(failure).toBeInstanceOf(ExpoDeviceNotRegisteredError);
    expect((failure as Error).message).toBe(
      "Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid.",
    );
    expect((failure as Error).message).not.toContain(GONE_TOKEN);
  });

  /*
   * The token belongs to a device of the server that relayed the page, not
   * to one of the relay's own. What to do about it is that server's call.
   */
  test("the relay marks nothing of its own", async () => {
    answer = deviceNotRegistered(GONE_TOKEN) as ExpoPushTicket;

    await relaySend();

    expect(markAsGone).not.toHaveBeenCalled();
    expect(updateBy).not.toHaveBeenCalled();
  });

  test("any other refusal stays the failure it was", async () => {
    answer = expoError("MessageTooBig", "Message too big");

    const failure: unknown = await relaySend();

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ExpoDeviceNotRegisteredError);
    expect((failure as Error).message).toBe(
      "Failed to send push notification: Message too big",
    );
  });

  test("an accepted send succeeds", async () => {
    expect(await relaySend()).toBeNull();
  });

  test("a server without Expo credentials refuses to relay", async () => {
    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(false);

    const failure: unknown = await relaySend();

    expect((failure as Error).message).toBe(
      "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
    );
  });
});

describe("the relay's answer for a gone token", () => {
  test("410 Gone, with Expo's code where Expo's own error ticket has it, and a sentence", () => {
    expect(PushNotificationService.RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE).toBe(
      410,
    );
    expect(PushNotificationService.getRelayDeviceNotRegisteredAnswer()).toEqual(
      {
        message:
          "Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid.",
        details: { error: "DeviceNotRegistered" },
      },
    );
  });

  test("is recognised as exactly that", () => {
    expect(
      PushNotificationService.isRelayDeviceNotRegisteredAnswer(
        new HTTPErrorResponse(
          410,
          PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
          {},
        ),
      ),
    ).toBe(true);
  });

  /*
   * A server older than this treats every answer that is not a success as a
   * failed send and logs its body: "Push relay error: <body>". It marks
   * nothing - so the answer only says what Expo said, not what to do about
   * a device that server never marked.
   */
  test("tells a server older than this why the send failed, in the words it logs", () => {
    const olderServerLog: string = `Push relay error: ${JSON.stringify(
      new HTTPErrorResponse(
        410,
        PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
        {},
      ).jsonData,
    )}`;

    expect(olderServerLog).toContain("DeviceNotRegistered");
    expect(olderServerLog).toContain(
      "no longer registered for push notifications",
    );
    expect(olderServerLog).not.toContain("register it again");
    expect(olderServerLog).not.toContain("marked");
  });

  test("an older server reads its message the way it reads every relay error", () => {
    expect(
      new HTTPErrorResponse(
        410,
        PushNotificationService.getRelayDeviceNotRegisteredAnswer(),
        {},
      ).message,
    ).toBe(
      "Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid.",
    );
  });
});

describe("UserPushService.markExpoPushTokenAsGone", () => {
  let updates: Array<{
    query: Record<string, unknown>;
    data: Record<string, unknown>;
    props: Record<string, unknown>;
    limit: unknown;
  }>;

  beforeEach(() => {
    updates = [];

    jest
      .spyOn(UserPushService, "updateBy")
      .mockImplementation((async (updateBy: {
        query: Record<string, unknown>;
        data: Record<string, unknown>;
        props: Record<string, unknown>;
        limit: unknown;
      }) => {
        updates.push(updateBy);
        return 3;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("marks the verified phones and tablets registered with the token, as root, and keeps them", async () => {
    const marked: number = await UserPushService.markExpoPushTokenAsGone({
      deviceToken: GONE_TOKEN,
    });

    expect(marked).toBe(3);
    expect(updates).toHaveLength(1);

    const query: Record<string, unknown> = updates[0]!.query;

    expect(Object.keys(query).sort()).toEqual(
      ["deviceToken", "deviceType", "isVerified"].sort(),
    );
    expect(query["deviceToken"]).toBe(GONE_TOKEN);
    expect(query["isVerified"]).toBe(true);
    expect(query["deviceType"]).toBeInstanceOf(Includes);
    expect((query["deviceType"] as Includes).values).toEqual([
      PushDeviceType.iOS,
      PushDeviceType.Android,
    ]);
    // Never a browser: its token is a push subscription, not an Expo token.
    expect((query["deviceType"] as Includes).values).not.toContain(
      PushDeviceType.Web,
    );
    // Marked, not deleted: the rules on the device survive.
    expect(updates[0]!.data).toEqual({ isVerified: false });
    // UserPush grants update to nobody: every write to it runs as root.
    expect(updates[0]!.props).toEqual({ isRoot: true });
    // Every account that registered the phone, in every project.
    expect(updates[0]!.limit).toBe(LIMIT_MAX);
  });

  test("for one person, only that person's devices", async () => {
    const userId: ObjectID = new ObjectID(
      "7f000000-0000-4000-8000-000000000043",
    );

    await UserPushService.markExpoPushTokenAsGone({
      deviceToken: GONE_TOKEN,
      userId: userId,
    });

    expect(updates[0]!.query["userId"]).toBe(userId);
  });
});

describe("UserPushService.verifyExpoPushDeviceRegisteredAgain", () => {
  const DEVICE_ID: ObjectID = new ObjectID(
    "7f000000-0000-4000-8000-000000000044",
  );

  let updates: Array<{
    query: Record<string, unknown>;
    data: Record<string, unknown>;
    props: Record<string, unknown>;
  }>;
  let matched: number;

  beforeEach(() => {
    updates = [];
    matched = 1;

    jest
      .spyOn(UserPushService, "updateOneBy")
      .mockImplementation((async (updateBy: {
        query: Record<string, unknown>;
        data: Record<string, unknown>;
        props: Record<string, unknown>;
      }) => {
        updates.push(updateBy);
        return matched;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("verifies the phone again, as root, and only a phone that is not verified", async () => {
    expect(
      await UserPushService.verifyExpoPushDeviceRegisteredAgain(DEVICE_ID),
    ).toBe(true);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.query["_id"]).toBe(DEVICE_ID.toString());
    expect(updates[0]!.query["isVerified"]).toBe(false);
    expect((updates[0]!.query["deviceType"] as Includes).values).toEqual([
      PushDeviceType.iOS,
      PushDeviceType.Android,
    ]);
    expect(updates[0]!.data).toEqual({ isVerified: true });
    expect(updates[0]!.props).toEqual({ isRoot: true });
  });

  test("says so when there was nothing to verify again", async () => {
    matched = 0;

    expect(
      await UserPushService.verifyExpoPushDeviceRegisteredAgain(DEVICE_ID),
    ).toBe(false);
  });
});

describe("which devices have an Expo push token", () => {
  test("the mobile app's: iOS and Android, never a browser", () => {
    expect([...EXPO_PUSH_DEVICE_TYPES]).toEqual([
      PushDeviceType.iOS,
      PushDeviceType.Android,
    ]);
    expect(isExpoPushDeviceType(PushDeviceType.iOS)).toBe(true);
    expect(isExpoPushDeviceType(PushDeviceType.Android)).toBe(true);
    expect(isExpoPushDeviceType(PushDeviceType.Web)).toBe(false);
  });

  test.each([[undefined], [null], [""], ["iOS"], ["Android"], [42]])(
    "not %p",
    (deviceType: unknown) => {
      expect(isExpoPushDeviceType(deviceType)).toBe(false);
    },
  );
});

describe("what a failed send says", () => {
  test("one device: that device's own reason", () => {
    expect(
      PushNotificationService.describeFailedSend({
        errorCount: 1,
        failureReasons: [GONE_MESSAGE],
      }),
    ).toBe(GONE_MESSAGE);
  });

  test("several: how many, and each reason once", () => {
    expect(
      PushNotificationService.describeFailedSend({
        errorCount: 3,
        failureReasons: [GONE_MESSAGE, "Expo push notification failed: x"],
      }),
    ).toBe(
      `Failed to send push notification to all 3 devices: ${GONE_MESSAGE}; Expo push notification failed: x`,
    );
  });

  test("no reason at all", () => {
    expect(
      PushNotificationService.describeFailedSend({
        errorCount: 0,
        failureReasons: [],
      }),
    ).toBe("Failed to send push notification.");
  });

  test.each([
    ["an Error", new Error("boom"), "boom"],
    ["a string", "plain words", "plain words"],
    ["an Error with no message", new Error(""), "Error"],
    ["nothing", undefined, "Failed to send push notification"],
    ["null", null, "Failed to send push notification"],
  ])("a device's reason from %s", (_name: string, reason: unknown, said: string) => {
    expect(PushNotificationService.getFailureReason(reason)).toBe(said);
  });

  test("the push token is taken out of a message about a send to it, wherever it appears", () => {
    expect(
      PushNotificationService.withoutPushToken(
        `"${GONE_TOKEN}" is not a registered push notification recipient (${GONE_TOKEN})`,
        GONE_TOKEN,
      ),
    ).toBe(
      '"[push token]" is not a registered push notification recipient ([push token])',
    );
    expect(PushNotificationService.withoutPushToken("no token here", "")).toBe(
      "no token here",
    );
  });
});

describe("a page not pushed to a device that is not verified", () => {
  test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
    "%s: open the mobile app on it to register it again",
    (deviceType: PushDeviceType) => {
      expect(
        PushNotificationService.getNotSentToUnverifiedDeviceMessage(deviceType),
      ).toBe(
        "Push notification not sent: this device no longer receives push notifications. Open the mobile app on it to register it again.",
      );
    },
  );

  test("a browser: register it again from that browser", () => {
    expect(
      PushNotificationService.getNotSentToUnverifiedDeviceMessage(
        PushDeviceType.Web,
      ),
    ).toBe(
      "Push notification not sent: this browser no longer receives push notifications. Register it again from User Settings > Notification Methods in that browser.",
    );
  });

  test("a test notification to a phone that is not verified says the same", () => {
    expect(PushNotificationService.EXPO_DEVICE_NOT_RECEIVING_MESSAGE).toBe(
      "This device no longer receives push notifications. Open the mobile app on it to register it again.",
    );
  });
});
