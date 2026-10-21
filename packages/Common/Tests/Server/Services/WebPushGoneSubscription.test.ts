import PushNotificationService from "../../../Server/Services/PushNotificationService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import UserPushService from "../../../Server/Services/UserPushService";
import PushNotificationLog from "../../../Models/DatabaseModels/PushNotificationLog";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushStatus from "../../../Types/PushNotification/PushStatus";
import webpush from "web-push";
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
 * A push service answers a send to a subscription that is gone for good with
 * 404 (expired, or never existed) or 410 (the browser unsubscribed, or its
 * notifications were blocked). The send path caught exactly that, and did
 * nothing: "You would implement removal logic here". The device stayed
 * verified, every page to it failed at the push service, and everything said
 * the device was fine.
 *
 * Its devices now stop being verified, so nothing more is sent to them and
 * every place that lists them can say they no longer receive notifications.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000031",
);

function subscription(name: string): string {
  return JSON.stringify({
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    expirationTime: null,
    keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
  });
}

const GONE_SUBSCRIPTION: string = subscription("gone");
const WORKING_SUBSCRIPTION: string = subscription("working");

function pushServiceAnswer(statusCode: number): webpush.WebPushError {
  return new webpush.WebPushError(
    "Received unexpected response code",
    statusCode,
    {},
    "",
    JSON.parse(GONE_SUBSCRIPTION).endpoint,
  );
}

describe("a web push subscription the push service says is gone", () => {
  let send: SpyInstance<typeof webpush.sendNotification>;
  let markAsGone: SpyInstance<
    typeof UserPushService.markWebPushSubscriptionAsGone
  >;
  let logs: Array<PushNotificationLog>;

  // The push service's answer to each subscription; anything else is delivered.
  let answers: Map<string, Error>;

  beforeEach(() => {
    answers = new Map<string, Error>();
    logs = [];

    // VAPID keys are the configuration's business, not this test's.
    PushNotificationService.isWebPushInitialized = true;

    send = jest.spyOn(webpush, "sendNotification").mockImplementation((async (
      pushSubscription: webpush.PushSubscription,
    ) => {
      const answer: Error | undefined = answers.get(pushSubscription.endpoint);

      if (answer) {
        throw answer;
      }

      return { statusCode: 201, body: "", headers: {} };
    }) as never);

    markAsGone = jest
      .spyOn(UserPushService, "markWebPushSubscriptionAsGone")
      .mockResolvedValue(1);

    jest
      .spyOn(PushNotificationLogService, "create")
      .mockImplementation((async (createBy: { data: PushNotificationLog }) => {
        logs.push(createBy.data);
        return createBy.data;
      }) as never);
  });

  afterEach(() => {
    PushNotificationService.isWebPushInitialized = false;
    jest.restoreAllMocks();
  });

  function answerWith(deviceToken: string, error: Error): void {
    answers.set(JSON.parse(deviceToken).endpoint, error);
  }

  async function sendTo(deviceTokens: Array<string>): Promise<unknown> {
    try {
      await PushNotificationService.sendPushNotification(
        {
          devices: deviceTokens.map((token: string) => {
            return { token: token, name: "Chrome on Windows" };
          }),
          message: {
            title: "Incident #42: Checkout is down",
            body: "A new incident has been created.",
          },
          deviceType: PushDeviceType.Web,
        },
        { projectId: PROJECT_ID },
      );

      return null;
    } catch (error) {
      return error;
    }
  }

  test.each([
    [410, "the browser unsubscribed, or notifications were blocked"],
    [404, "it expired"],
  ])(
    "%i (%s): the devices registered with it stop being verified",
    async (statusCode: number) => {
      answerWith(GONE_SUBSCRIPTION, pushServiceAnswer(statusCode));

      await sendTo([GONE_SUBSCRIPTION]);

      expect(send).toHaveBeenCalledTimes(1);
      expect(markAsGone).toHaveBeenCalledTimes(1);
      /*
       * Every account that registered the browser: the subscription is gone
       * for all of them alike.
       */
      expect(markAsGone.mock.calls[0]![0]).toEqual({
        deviceToken: GONE_SUBSCRIPTION,
      });
    },
  );

  test("the send still fails, and its log says why in words a person can act on", async () => {
    answerWith(GONE_SUBSCRIPTION, pushServiceAnswer(410));

    const failure: unknown = await sendTo([GONE_SUBSCRIPTION]);

    expect(failure).toBeInstanceOf(Error);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe(PushStatus.Error);
    expect(logs[0]!.statusMessage).toBe(
      "The push service no longer accepts this browser's subscription (HTTP 410): it expired or was revoked. The device is marked as not receiving notifications; register the browser again to receive them.",
    );
  });

  test("a device that still works in the same send is delivered to, and left alone", async () => {
    answerWith(GONE_SUBSCRIPTION, pushServiceAnswer(410));

    const failure: unknown = await sendTo([
      GONE_SUBSCRIPTION,
      WORKING_SUBSCRIPTION,
    ]);

    // One device got it, so the send as a whole did not fail.
    expect(failure).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(markAsGone.mock.calls[0]![0]).toEqual({
      deviceToken: GONE_SUBSCRIPTION,
    });
    expect(
      logs.map((log: PushNotificationLog) => {
        return log.status;
      }),
    ).toEqual([PushStatus.Error, PushStatus.Success]);
  });

  test.each([
    [403, "a subscription made with another VAPID key"],
    [413, "a payload too large"],
    [429, "too many requests"],
    [500, "the push service failing"],
    [503, "the push service unavailable"],
  ])(
    "%i (%s) says nothing about the subscription: the devices stay as they are",
    async (statusCode: number) => {
      const answer: webpush.WebPushError = pushServiceAnswer(statusCode);
      answerWith(GONE_SUBSCRIPTION, answer);

      await sendTo([GONE_SUBSCRIPTION]);

      expect(markAsGone).not.toHaveBeenCalled();
      expect(logs[0]!.statusMessage).toBe(answer.message);
    },
  );

  test("a network failure, with no answer at all, leaves the devices as they are", async () => {
    answerWith(
      GONE_SUBSCRIPTION,
      Object.assign(new Error("getaddrinfo ENOTFOUND fcm.googleapis.com"), {
        code: "ENOTFOUND",
      }),
    );

    await sendTo([GONE_SUBSCRIPTION]);

    expect(markAsGone).not.toHaveBeenCalled();
  });

  test("a failure to mark the devices does not hide that the send failed", async () => {
    answerWith(GONE_SUBSCRIPTION, pushServiceAnswer(410));
    markAsGone.mockRejectedValue(new Error("database unavailable"));

    const failure: unknown = await sendTo([GONE_SUBSCRIPTION]);

    expect(failure).toBeInstanceOf(Error);
    expect(markAsGone).toHaveBeenCalledTimes(1);
    expect(logs[0]!.statusMessage).toMatch(
      /^The push service no longer accepts this browser's subscription \(HTTP 410\)/,
    );
  });
});

describe("UserPushService.markWebPushSubscriptionAsGone", () => {
  let updates: Array<{
    query: Record<string, unknown>;
    data: Record<string, unknown>;
    props: Record<string, unknown>;
  }>;

  beforeEach(() => {
    updates = [];

    jest
      .spyOn(UserPushService, "updateBy")
      .mockImplementation((async (updateBy: {
        query: Record<string, unknown>;
        data: Record<string, unknown>;
        props: Record<string, unknown>;
      }) => {
        updates.push(updateBy);
        return 2;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("marks the verified browser devices registered with the subscription, as root, and keeps them", async () => {
    const marked: number = await UserPushService.markWebPushSubscriptionAsGone({
      deviceToken: GONE_SUBSCRIPTION,
    });

    expect(marked).toBe(2);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.query).toEqual({
      deviceToken: GONE_SUBSCRIPTION,
      deviceType: PushDeviceType.Web,
      isVerified: true,
    });
    expect(updates[0]!.data).toEqual({ isVerified: false });
    // UserPush grants update to nobody: every write to it runs as root.
    expect(updates[0]!.props).toEqual({ isRoot: true });
  });

  test("for one person, only that person's devices", async () => {
    const userId: ObjectID = new ObjectID(
      "7f000000-0000-4000-8000-000000000032",
    );

    await UserPushService.markWebPushSubscriptionAsGone({
      deviceToken: GONE_SUBSCRIPTION,
      userId: userId,
    });

    expect(updates[0]!.query).toEqual({
      deviceToken: GONE_SUBSCRIPTION,
      deviceType: PushDeviceType.Web,
      isVerified: true,
      userId: userId,
    });
  });
});

describe("what counts as a browser push subscription", () => {
  test("PushSubscription.toJSON(), as the Dashboard and its service worker send it", () => {
    expect(() => {
      PushNotificationService.assertIsWebPushSubscription(WORKING_SUBSCRIPTION);
    }).not.toThrow();
  });

  test.each([
    ["nothing", undefined],
    ["an empty string", ""],
    ["an object rather than its JSON", { endpoint: "x" }],
    ["text that is not JSON", "ExponentPushToken[abc]"],
    ["JSON that is not an object", "42"],
    ["an array", "[]"],
    [
      "a subscription to a host that is not a browser push service",
      JSON.stringify({
        endpoint: "https://attacker.example/push",
        keys: { p256dh: "p256dh", auth: "auth" },
      }),
    ],
    [
      "a subscription with no endpoint",
      JSON.stringify({ keys: { p256dh: "p256dh", auth: "auth" } }),
    ],
    [
      "a subscription with keys that are not text",
      JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/x",
        keys: { p256dh: 1, auth: 2 },
      }),
    ],
  ])("refuses %s", (_name: string, deviceToken: unknown) => {
    expect(() => {
      PushNotificationService.assertIsWebPushSubscription(deviceToken);
    }).toThrow(BadDataException);
  });
});
