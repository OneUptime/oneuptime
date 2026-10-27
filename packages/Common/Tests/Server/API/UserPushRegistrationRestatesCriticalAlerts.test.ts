import UserPushAPI, {
  readStatedCriticalAlertFlag,
} from "../../../Server/API/UserPushAPI";
import ExpoPushReceiptQueue from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CriticalAlertSound from "../../../Types/PushNotification/CriticalAlertSound";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import UserType from "../../../Types/UserType";
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
 * The maintainer turned critical alerts off on their iPhone. The app showed
 * them off; the Dashboard went on saying "On", and a test notification sent
 * from it claimed to ring through silent mode while the phone showed an
 * ordinary notification.
 *
 * One reason: the app restates its critical alert choices on every
 * registration - on every start, sign-in and return to it - but a device
 * that was already registered returned early and kept what it was created
 * with. A reinstalled app, or one whose choice changed while the server
 * missed it, never caught up. The register route now writes what the phone
 * restates onto the device it already has, and only what differs, so the
 * registrations the app makes every few minutes cost nothing while nothing
 * changes. This needs no app update: every app that knows critical alerts
 * restates them.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000121");
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000123",
);
const NEW_DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000124",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000125",
);

const PHONE_TOKEN: string = "ExponentPushToken[restate-phone-000001]";
const NEW_PHONE_TOKEN: string = "ExponentPushToken[restate-phone-000002]";

const BROWSER_SUBSCRIPTION: string = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/restate-browser",
  expirationTime: null,
  keys: { p256dh: "BNcR", auth: "tBHI" },
});

type Answer = { json: JSONObject } | Error;

function signedIn(body: JSONObject): OneUptimeRequest {
  return {
    params: {},
    body: body,
    headers: {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID, isMasterAdmin: false },
  } as unknown as OneUptimeRequest;
}

async function register(body: JSONObject): Promise<Answer> {
  (Response.sendErrorResponse as jest.Mock).mockClear();
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("POST", "/user-push/register")
    .handlerFunction(signedIn(body), res, (err?: unknown): void => {
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

  const jsonCalls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(jsonCalls).toHaveLength(1);

  return { json: jsonCalls[0]![2] as JSONObject };
}

// What the app sends on every launch (MobileApp api/pushDevice.ts).
function phoneRegistration(
  overrides: Record<string, unknown> = {},
): JSONObject {
  return JSON.parse(
    JSON.stringify({
      deviceToken: PHONE_TOKEN,
      deviceType: PushDeviceType.iOS,
      deviceName: "iPhone 14 Pro Max",
      projectId: PROJECT_ID.toString(),
      isCriticalAlertEnabled: false,
      criticalAlertSound: CriticalAlertSound.Default,
      criticalAlertVolume: 100,
      ...overrides,
    }),
  ) as JSONObject;
}

// The device the lookup finds: as stored.
function storedDevice(overrides: Record<string, unknown> = {}): unknown {
  return {
    _id: DEVICE_ID.toString(),
    id: DEVICE_ID,
    isVerified: true,
    deviceType: PushDeviceType.iOS,
    isCriticalAlertEnabled: true,
    criticalAlertSound: CriticalAlertSound.Default,
    criticalAlertVolume: 100,
    ...overrides,
  };
}

describe("readStatedCriticalAlertFlag - what a registration says about a device it already has", () => {
  test.each([
    ["true", true, true],
    ['"true"', "true", true],
    ["false", false, false],
    ['"false"', "false", false],
  ])("%s states %s", (_name: string, raw: unknown, expected: boolean) => {
    expect(readStatedCriticalAlertFlag(raw)).toBe(expected);
  });

  test.each([
    ["absent", undefined],
    ["null", null],
    ["an empty string", ""],
    ['"TRUE"', "TRUE"],
    ['"yes"', "yes"],
    ["1", 1],
    ["0", 0],
    ["an object", { isEnabled: false }],
    ["an array", [false]],
  ])(
    "%s states nothing, so the device keeps what it has",
    (_name: string, raw: unknown) => {
      expect(readStatedCriticalAlertFlag(raw)).toBeUndefined();
    },
  );
});

describe("POST /user-push/register restates a phone's critical alert choices", () => {
  let members: Set<string>;
  let lookup: SpyInstance<typeof UserPushService.findOneBy>;
  let update: SpyInstance<typeof UserPushService.updateOneBy>;
  let create: SpyInstance<typeof UserPushService.create>;
  let defaultRules: SpyInstance<
    typeof UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod
  >;

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
    members = new Set<string>([USER_ID.toString()]);

    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          userIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          return new Set<string>(
            data.userIds
              .map((userId: ObjectID | string): string => {
                return userId.toString();
              })
              .filter((userId: string): boolean => {
                return members.has(userId);
              }),
          );
        },
      );

    jest
      .spyOn(ExpoPushReceiptQueue, "noteTokenRegistered")
      .mockResolvedValue(undefined as never);

    lookup = jest
      .spyOn(UserPushService, "findOneBy")
      .mockResolvedValue(storedDevice() as never);

    update = jest.spyOn(UserPushService, "updateOneBy").mockResolvedValue(1);

    create = jest
      .spyOn(UserPushService, "create")
      .mockImplementation((async (data: { data: JSONObject }) => {
        return {
          ...data.data,
          _id: NEW_DEVICE_ID.toString(),
          id: NEW_DEVICE_ID,
        };
      }) as never);

    defaultRules = jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The writes the route made to the device, as data.
  function writes(): Array<Record<string, unknown>> {
    return update.mock.calls.map((call: Array<unknown>) => {
      const updateBy: {
        query: { _id: string };
        data: Record<string, unknown>;
        props: { isRoot?: boolean };
      } = call[0] as never;

      expect(updateBy.query._id).toBe(DEVICE_ID.toString());
      expect(updateBy.props.isRoot).toBe(true);

      return updateBy.data;
    });
  }

  test("the maintainer's phone: On on the server, off on the phone - the device takes off", async () => {
    const answer: Answer = await register(
      phoneRegistration({ isCriticalAlertEnabled: false }),
    );

    expect(writes()).toEqual([{ isCriticalAlertEnabled: false }]);
    expect(answer).toEqual({
      json: {
        success: true,
        deviceId: DEVICE_ID.toString(),
        alreadyRegistered: true,
        isVerified: true,
        isCriticalAlertEnabled: false,
      },
    });
    // The device it had: no second device, no default rules added back.
    expect(create).not.toHaveBeenCalled();
    expect(defaultRules).not.toHaveBeenCalled();
  });

  test("off on the server, on on the phone - the device takes on", async () => {
    lookup.mockResolvedValue(
      storedDevice({
        deviceType: PushDeviceType.Android,
        isCriticalAlertEnabled: false,
      }) as never,
    );

    const answer: Answer = await register(
      phoneRegistration({
        deviceType: PushDeviceType.Android,
        isCriticalAlertEnabled: true,
      }),
    );

    expect(writes()).toEqual([{ isCriticalAlertEnabled: true }]);
    expect(
      (answer as { json: JSONObject }).json["isCriticalAlertEnabled"],
    ).toBe(true);
  });

  test.each([[true], [false]])(
    "the same as stored (%s): nothing is written, and the answer says what the device holds",
    async (isEnabled: boolean) => {
      lookup.mockResolvedValue(
        storedDevice({ isCriticalAlertEnabled: isEnabled }) as never,
      );

      const answer: Answer = await register(
        phoneRegistration({ isCriticalAlertEnabled: isEnabled }),
      );

      expect(update).not.toHaveBeenCalled();
      expect(
        (answer as { json: JSONObject }).json["isCriticalAlertEnabled"],
      ).toBe(isEnabled);
    },
  );

  test("as a form posts it: the string false turns it off", async () => {
    await register(phoneRegistration({ isCriticalAlertEnabled: "false" }));

    expect(writes()).toEqual([{ isCriticalAlertEnabled: false }]);
  });

  test.each([
    ["left out", undefined],
    ["junk", "yes"],
    ["a number", 0],
  ])(
    "a registration that says nothing about them (%s) leaves the device's critical alerts as they are",
    async (_name: string, raw: unknown) => {
      const body: JSONObject = phoneRegistration();
      if (raw === undefined) {
        delete body["isCriticalAlertEnabled"];
      } else {
        body["isCriticalAlertEnabled"] = raw as never;
      }

      const answer: Answer = await register(body);

      expect(update).not.toHaveBeenCalled();
      // On it was, and on it stays.
      expect(
        (answer as { json: JSONObject }).json["isCriticalAlertEnabled"],
      ).toBe(true);
    },
  );

  /*
   * A registration reads the alarm and volume once, before it tells each
   * project in turn: restating them onto a device the phone already has
   * could put back an alarm the responder changed meanwhile. They are the
   * critical-alert-preferences route's to change.
   */
  test("the alarm and volume a registration names are not written onto a device the phone already has", async () => {
    await register(
      phoneRegistration({
        isCriticalAlertEnabled: true,
        criticalAlertSound: CriticalAlertSound.Siren,
        criticalAlertVolume: 50,
      }),
    );

    expect(update).not.toHaveBeenCalled();
  });

  test("a reinstalled app back on its defaults: only the switch is written", async () => {
    lookup.mockResolvedValue(
      storedDevice({
        isCriticalAlertEnabled: true,
        criticalAlertSound: CriticalAlertSound.Klaxon,
        criticalAlertVolume: 25,
      }) as never,
    );

    await register(
      phoneRegistration({
        isCriticalAlertEnabled: false,
        criticalAlertSound: CriticalAlertSound.Default,
        criticalAlertVolume: 100,
      }),
    );

    expect(writes()).toEqual([{ isCriticalAlertEnabled: false }]);
  });

  test("the lookup reads what the restating compares", async () => {
    await register(phoneRegistration());

    expect(lookup.mock.calls[0]![0].select).toEqual({
      _id: true,
      isVerified: true,
      deviceType: true,
      isCriticalAlertEnabled: true,
    });
  });

  /*
   * The restating is never in the way of the registration itself. A phone
   * Expo said was gone is verified again whatever happens to the write, and
   * the answer then says nothing about critical alerts - the app tells the
   * server outright when it does not.
   */
  test("a write that fails does not stop the registration: verified again, answered without the flag", async () => {
    lookup.mockResolvedValue(
      storedDevice({
        isVerified: false,
        isCriticalAlertEnabled: true,
      }) as never,
    );
    update.mockRejectedValue(new Error("Database not connected"));
    const verifyAgain: SpyInstance<
      typeof UserPushService.verifyExpoPushDeviceRegisteredAgain
    > = jest
      .spyOn(UserPushService, "verifyExpoPushDeviceRegisteredAgain")
      .mockResolvedValue(true);

    const answer: Answer = await register(
      phoneRegistration({ isCriticalAlertEnabled: false }),
    );

    expect(verifyAgain).toHaveBeenCalledTimes(1);
    expect(answer).toEqual({
      json: {
        success: true,
        deviceId: DEVICE_ID.toString(),
        alreadyRegistered: true,
        isVerified: true,
      },
    });
  });

  test("a phone Expo said was gone, registering again: received again, and its choices restated", async () => {
    lookup.mockResolvedValue(
      storedDevice({
        isVerified: false,
        isCriticalAlertEnabled: true,
      }) as never,
    );
    const verifyAgain: SpyInstance<
      typeof UserPushService.verifyExpoPushDeviceRegisteredAgain
    > = jest
      .spyOn(UserPushService, "verifyExpoPushDeviceRegisteredAgain")
      .mockResolvedValue(true);

    const answer: Answer = await register(
      phoneRegistration({ isCriticalAlertEnabled: false }),
    );

    expect(verifyAgain).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([{ isCriticalAlertEnabled: false }]);
    expect(answer).toEqual({
      json: {
        success: true,
        deviceId: DEVICE_ID.toString(),
        alreadyRegistered: true,
        isVerified: true,
        isCriticalAlertEnabled: false,
      },
    });
  });

  test("a browser registered again: nothing about critical alerts is written or said", async () => {
    lookup.mockResolvedValue(
      storedDevice({
        deviceType: PushDeviceType.Web,
        isCriticalAlertEnabled: true,
      }) as never,
    );

    const answer: Answer = await register(
      JSON.parse(
        JSON.stringify({
          deviceToken: BROWSER_SUBSCRIPTION,
          deviceType: PushDeviceType.Web,
          deviceName: "Chrome on Windows",
          projectId: PROJECT_ID.toString(),
          isCriticalAlertEnabled: false,
        }),
      ) as JSONObject,
    );

    expect(update).not.toHaveBeenCalled();
    expect(answer).toEqual({
      json: {
        success: true,
        deviceId: DEVICE_ID.toString(),
        alreadyRegistered: true,
        isVerified: true,
      },
    });
  });

  test("somebody who is not a member of the project changes nothing", async () => {
    members.clear();

    const answer: Answer = await register(
      phoneRegistration({ isCriticalAlertEnabled: false }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect(lookup).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  describe("a new device", () => {
    beforeEach(() => {
      lookup.mockResolvedValue(null);
    });

    test.each([[true], [false]])(
      "a phone is created with what it says (%s), and the answer says so",
      async (isEnabled: boolean) => {
        const answer: Answer = await register(
          phoneRegistration({ isCriticalAlertEnabled: isEnabled }),
        );

        expect(
          (create.mock.calls[0]![0].data as { isCriticalAlertEnabled: boolean })
            .isCriticalAlertEnabled,
        ).toBe(isEnabled);
        expect(answer).toEqual({
          json: {
            success: true,
            deviceId: NEW_DEVICE_ID.toString(),
            alreadyRegistered: false,
            isVerified: true,
            isCriticalAlertEnabled: isEnabled,
          },
        });
      },
    );

    test("a phone that says nothing is created with them off", async () => {
      const body: JSONObject = phoneRegistration();
      delete body["isCriticalAlertEnabled"];

      const answer: Answer = await register(body);

      expect(
        (create.mock.calls[0]![0].data as { isCriticalAlertEnabled: boolean })
          .isCriticalAlertEnabled,
      ).toBe(false);
      expect(
        (answer as { json: JSONObject }).json["isCriticalAlertEnabled"],
      ).toBe(false);
    });

    /*
     * No browser can ring through silent mode. A browser's device that said
     * "on" would read back as though it could, and a hand-made request is
     * all it takes.
     */
    test("a browser is never given critical alerts, whatever the request says", async () => {
      const answer: Answer = await register(
        JSON.parse(
          JSON.stringify({
            deviceToken: BROWSER_SUBSCRIPTION,
            deviceType: PushDeviceType.Web,
            deviceName: "Chrome on Windows",
            projectId: PROJECT_ID.toString(),
            isCriticalAlertEnabled: true,
          }),
        ) as JSONObject,
      );

      expect(
        (create.mock.calls[0]![0].data as { isCriticalAlertEnabled: boolean })
          .isCriticalAlertEnabled,
      ).toBe(false);
      expect(answer).toEqual({
        json: {
          success: true,
          deviceId: NEW_DEVICE_ID.toString(),
          alreadyRegistered: false,
          isVerified: true,
        },
      });
    });

    test("a phone that took over its old token's device says what the renewal wrote", async () => {
      jest.spyOn(UserPushService, "renewExpoPushDevice").mockResolvedValue({
        _id: DEVICE_ID.toString(),
        id: DEVICE_ID,
      } as never);

      const answer: Answer = await register(
        phoneRegistration({
          deviceToken: NEW_PHONE_TOKEN,
          previousDeviceToken: PHONE_TOKEN,
          isCriticalAlertEnabled: true,
        }),
      );

      expect(answer).toEqual({
        json: {
          success: true,
          deviceId: DEVICE_ID.toString(),
          alreadyRegistered: true,
          isVerified: true,
          isCriticalAlertEnabled: true,
        },
      });
      expect(create).not.toHaveBeenCalled();
    });
  });
});
