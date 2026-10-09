import UserPushAPI, {
  readPreviousExpoPushToken,
  readProjectIdFromBody,
} from "../../../Server/API/UserPushAPI";
import ExpoPushReceiptQueue from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
 * A customer pressed Register Device, allowed notifications, and was told
 * "Project ID is invalid". The Dashboard posts the project as the ObjectID
 * itself, which goes over the wire as { _type: "ObjectID", value: "<id>" },
 * and the route read it with toString(): "[object Object]". The mobile app
 * posts a string, so phones kept registering and only browsers broke.
 *
 * Registering a browser that is already registered answered with an error
 * as well. It is now a success that names the device the caller already has.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000011");
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000013",
);
const NEW_DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000014",
);
const EXISTING_DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000015",
);

// What a browser's PushSubscription serializes to, and is stored as.
const BROWSER_SUBSCRIPTION: string = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  expirationTime: null,
  keys: { p256dh: "BNcR", auth: "tBHI" },
});

/*
 * The request body exactly as the Dashboard's API.post puts it on the wire:
 * axios JSON.stringifies the data, which runs ObjectID.toJSON, and express
 * parses it back into plain objects.
 */
function overTheWire(body: Record<string, unknown>): JSONObject {
  return JSON.parse(JSON.stringify(body)) as JSONObject;
}

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

describe("readProjectIdFromBody", () => {
  const id: string = PROJECT_ID.toString();

  test("a string id, as the mobile app sends it", () => {
    expect(readProjectIdFromBody(id)?.toString()).toBe(id);
  });

  test("a string id with whitespace around it", () => {
    expect(readProjectIdFromBody(`  ${id}\n`)?.toString()).toBe(id);
  });

  test("a serialized ObjectID, as the Dashboard sent it", () => {
    const sent: unknown = overTheWire({ projectId: new ObjectID(id) })[
      "projectId"
    ];

    expect(sent).toEqual({ _type: "ObjectID", value: id });
    expect(readProjectIdFromBody(sent)?.toString()).toBe(id);
  });

  test("an ObjectID instance", () => {
    expect(readProjectIdFromBody(new ObjectID(id))?.toString()).toBe(id);
  });

  test.each([
    ["the text toString() made of the serialized id", "[object Object]"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a string that is not an id", "not-a-project"],
    [
      "a serialized ObjectID whose value is not an id",
      {
        _type: "ObjectID",
        value: "not-a-project",
      },
    ],
    ["a serialized ObjectID with no value", { _type: "ObjectID" }],
    ["an object with an id but no _type", { value: id }],
    [
      "another serialized type carrying an id",
      {
        _type: "DateTime",
        value: id,
      },
    ],
    ["an ObjectID that is not an id", new ObjectID("not-a-project")],
    ["an array holding an id", [id]],
    ["a number", 42],
    ["a boolean", true],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_name: string, raw: unknown) => {
    expect(readProjectIdFromBody(raw)).toBeNull();
  });
});

describe("POST /user-push/register", () => {
  let members: Set<string>;
  let membershipReads: Array<string>;
  let lookup: SpyInstance<typeof UserPushService.findOneBy>;
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
    members = new Set<string>([USER_ID.toString()]);
    membershipReads = [];

    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          userIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          membershipReads.push(data.projectId.toString());

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

    lookup = jest.spyOn(UserPushService, "findOneBy").mockResolvedValue(null);

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

  const browserRegistration: Record<string, unknown> = {
    deviceToken: BROWSER_SUBSCRIPTION,
    deviceType: PushDeviceType.Web,
    deviceName: "Chrome on Windows",
  };

  test("a browser registers with the project the Dashboard sent as an ObjectID", async () => {
    const answer: Answer = await register(
      overTheWire({
        ...browserRegistration,
        projectId: new ObjectID(PROJECT_ID.toString()),
      }),
    );

    expect(answer).toEqual({
      json: {
        success: true,
        deviceId: NEW_DEVICE_ID.toString(),
        alreadyRegistered: false,
        isVerified: true,
      },
    });
    expect(membershipReads).toEqual([PROJECT_ID.toString()]);
    expect(create).toHaveBeenCalledTimes(1);

    const saved: {
      projectId: ObjectID;
      userId: ObjectID;
      deviceToken: string;
      deviceType: string;
      deviceName: string;
      isVerified: boolean;
    } = create.mock.calls[0]![0].data as never;

    expect(saved.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(saved.userId.toString()).toBe(USER_ID.toString());
    expect(saved.deviceToken).toBe(BROWSER_SUBSCRIPTION);
    expect(saved.deviceType).toBe(PushDeviceType.Web);
    expect(saved.deviceName).toBe("Chrome on Windows");
    expect(saved.isVerified).toBe(true);

    expect(defaultRules).toHaveBeenCalledTimes(1);
    expect(
      (
        defaultRules.mock.calls[0]![0] as { projectId: ObjectID }
      ).projectId.toString(),
    ).toBe(PROJECT_ID.toString());
  });

  test("a browser registers with the project sent as a string", async () => {
    const answer: Answer = await register(
      overTheWire({
        ...browserRegistration,
        projectId: PROJECT_ID.toString(),
      }),
    );

    expect(answer).toEqual({
      json: {
        success: true,
        deviceId: NEW_DEVICE_ID.toString(),
        alreadyRegistered: false,
        isVerified: true,
      },
    });
    expect(
      (
        create.mock.calls[0]![0].data as { projectId: ObjectID }
      ).projectId.toString(),
    ).toBe(PROJECT_ID.toString());
  });

  test("the existing-device lookup is the caller's own device, in that project, with that subscription", async () => {
    await register(
      overTheWire({
        ...browserRegistration,
        projectId: new ObjectID(PROJECT_ID.toString()),
      }),
    );

    expect(lookup).toHaveBeenCalledTimes(1);

    const query: {
      userId: ObjectID;
      projectId: ObjectID;
      deviceToken: string;
    } = lookup.mock.calls[0]![0].query as never;

    expect(query.userId.toString()).toBe(USER_ID.toString());
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(query.deviceToken).toBe(BROWSER_SUBSCRIPTION);
  });

  test("registering a browser that is already registered names the device it already has, and creates nothing", async () => {
    lookup.mockResolvedValue({
      _id: EXISTING_DEVICE_ID.toString(),
      id: EXISTING_DEVICE_ID,
      isVerified: true,
    } as never);

    const answer: Answer = await register(
      overTheWire({
        ...browserRegistration,
        projectId: new ObjectID(PROJECT_ID.toString()),
      }),
    );

    expect(answer).toEqual({
      json: {
        success: true,
        deviceId: EXISTING_DEVICE_ID.toString(),
        alreadyRegistered: true,
        isVerified: true,
      },
    });
    expect(create).not.toHaveBeenCalled();
    // The rules a person set up for the device are left as they are.
    expect(defaultRules).not.toHaveBeenCalled();
  });

  /*
   * The push service stopped accepting the subscription the browser still
   * holds, so its device no longer receives notifications. "Already
   * registered" alone sent the person away believing it worked; the
   * Dashboard is told, gets a new subscription, and renews the device.
   */
  test("a browser whose device no longer receives notifications is told so, and still nothing is created", async () => {
    lookup.mockResolvedValue({
      _id: EXISTING_DEVICE_ID.toString(),
      id: EXISTING_DEVICE_ID,
      isVerified: false,
    } as never);

    const answer: Answer = await register(
      overTheWire({
        ...browserRegistration,
        projectId: PROJECT_ID.toString(),
      }),
    );

    expect(answer).toEqual({
      json: {
        success: true,
        deviceId: EXISTING_DEVICE_ID.toString(),
        alreadyRegistered: true,
        isVerified: false,
      },
    });
    expect(
      (lookup.mock.calls[0]![0].select as Record<string, unknown>)[
        "isVerified"
      ],
    ).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(defaultRules).not.toHaveBeenCalled();
  });

  /*
   * A browser's gone subscription is gone for good, so registering it again
   * as it is must not bring the device back: the Dashboard renews it with a
   * new subscription instead (subscription-change).
   */
  test("a browser whose device no longer receives notifications is not verified again by registering the same subscription", async () => {
    lookup.mockResolvedValue({
      _id: EXISTING_DEVICE_ID.toString(),
      id: EXISTING_DEVICE_ID,
      isVerified: false,
      deviceType: PushDeviceType.Web,
    } as never);

    const verifyAgain: SpyInstance<
      typeof UserPushService.verifyExpoPushDeviceRegisteredAgain
    > = jest
      .spyOn(UserPushService, "verifyExpoPushDeviceRegisteredAgain")
      .mockResolvedValue(true);

    const answer: Answer = await register(
      overTheWire({
        ...browserRegistration,
        projectId: PROJECT_ID.toString(),
      }),
    );

    expect(verifyAgain).not.toHaveBeenCalled();
    expect((answer as { json: JSONObject }).json["isVerified"]).toBe(false);
  });

  describe("a phone registering the token Expo said was gone", () => {
    const PHONE_TOKEN: string = "ExponentPushToken[phone-token-000000001]";

    let verifyAgain: SpyInstance<
      typeof UserPushService.verifyExpoPushDeviceRegisteredAgain
    >;
    let reread: SpyInstance<typeof UserPushService.findOneById>;

    beforeEach(() => {
      verifyAgain = jest
        .spyOn(UserPushService, "verifyExpoPushDeviceRegisteredAgain")
        .mockResolvedValue(true);

      reread = jest
        .spyOn(UserPushService, "findOneById")
        .mockResolvedValue(null);
    });

    function phoneRegistration(
      deviceType: PushDeviceType,
    ): Record<string, unknown> {
      // As the mobile app sends it on every launch (MobileApp pushDevice.ts).
      return {
        deviceToken: PHONE_TOKEN,
        deviceType: deviceType,
        deviceName: "Pixel 8",
        projectId: PROJECT_ID.toString(),
        isCriticalAlertEnabled: true,
      };
    }

    /*
     * Expo said the token was gone, so its device stopped being verified
     * (UserPushService.markExpoPushTokenAsGone). The app asks Expo for its
     * token before every registration, which renews it there: the token it
     * registers is one Expo delivers to again. Before, the device stayed
     * marked however often the app registered, and only deleting it - and
     * its rules - brought the phone back.
     */
    test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
      "%s: receives notifications again, the device it already had and its rules",
      async (deviceType: PushDeviceType) => {
        lookup.mockResolvedValue({
          _id: EXISTING_DEVICE_ID.toString(),
          id: EXISTING_DEVICE_ID,
          isVerified: false,
          deviceType: deviceType,
        } as never);

        const answer: Answer = await register(
          overTheWire(phoneRegistration(deviceType)),
        );

        expect(answer).toEqual({
          json: {
            success: true,
            deviceId: EXISTING_DEVICE_ID.toString(),
            alreadyRegistered: true,
            isVerified: true,
          },
        });
        expect(verifyAgain).toHaveBeenCalledTimes(1);
        expect(verifyAgain.mock.calls[0]![0].toString()).toBe(
          EXISTING_DEVICE_ID.toString(),
        );
        // The device it had, not a new one with default rules.
        expect(create).not.toHaveBeenCalled();
        // The rules its owner set up survived the mark; none are added back.
        expect(defaultRules).not.toHaveBeenCalled();
      },
    );

    test("the lookup reads the device's type, which decides whether registering verifies it again", async () => {
      await register(overTheWire(phoneRegistration(PushDeviceType.iOS)));

      expect(
        (lookup.mock.calls[0]![0].select as Record<string, unknown>)[
          "deviceType"
        ],
      ).toBe(true);
      expect(
        (lookup.mock.calls[0]![0].select as Record<string, unknown>)[
          "isVerified"
        ],
      ).toBe(true);
    });

    test("a phone that still receives notifications is left as it is", async () => {
      lookup.mockResolvedValue({
        _id: EXISTING_DEVICE_ID.toString(),
        id: EXISTING_DEVICE_ID,
        isVerified: true,
        deviceType: PushDeviceType.iOS,
      } as never);

      const answer: Answer = await register(
        overTheWire(phoneRegistration(PushDeviceType.iOS)),
      );

      expect(verifyAgain).not.toHaveBeenCalled();
      expect((answer as { json: JSONObject }).json["isVerified"]).toBe(true);
      expect(create).not.toHaveBeenCalled();
    });

    test("verified a moment earlier by another registration: says it is verified", async () => {
      lookup.mockResolvedValue({
        _id: EXISTING_DEVICE_ID.toString(),
        id: EXISTING_DEVICE_ID,
        isVerified: false,
        deviceType: PushDeviceType.Android,
      } as never);
      verifyAgain.mockResolvedValue(false);
      reread.mockResolvedValue({ isVerified: true } as never);

      const answer: Answer = await register(
        overTheWire(phoneRegistration(PushDeviceType.Android)),
      );

      expect((answer as { json: JSONObject }).json["isVerified"]).toBe(true);
      expect(reread.mock.calls[0]![0].id.toString()).toBe(
        EXISTING_DEVICE_ID.toString(),
      );
    });

    test("gone in the meantime: says it is not verified", async () => {
      lookup.mockResolvedValue({
        _id: EXISTING_DEVICE_ID.toString(),
        id: EXISTING_DEVICE_ID,
        isVerified: false,
        deviceType: PushDeviceType.Android,
      } as never);
      verifyAgain.mockResolvedValue(false);
      reread.mockResolvedValue(null);

      const answer: Answer = await register(
        overTheWire(phoneRegistration(PushDeviceType.Android)),
      );

      expect((answer as { json: JSONObject }).json["isVerified"]).toBe(false);
    });

    test("somebody who is not a member of the project verifies nothing", async () => {
      members.clear();

      const answer: Answer = await register(
        overTheWire(phoneRegistration(PushDeviceType.iOS)),
      );

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect(lookup).not.toHaveBeenCalled();
      expect(verifyAgain).not.toHaveBeenCalled();
    });

    test("a phone registering a token it never registered gets a new device, as before", async () => {
      const answer: Answer = await register(
        overTheWire(phoneRegistration(PushDeviceType.iOS)),
      );

      expect(verifyAgain).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledTimes(1);
      expect(answer).toEqual({
        json: {
          success: true,
          deviceId: NEW_DEVICE_ID.toString(),
          alreadyRegistered: false,
          isVerified: true,
        },
      });
    });
  });

  test("somebody who is not a member learns nothing about devices that exist", async () => {
    members.clear();
    lookup.mockResolvedValue({
      _id: EXISTING_DEVICE_ID.toString(),
      id: EXISTING_DEVICE_ID,
    } as never);

    const answer: Answer = await register(
      overTheWire({
        ...browserRegistration,
        projectId: new ObjectID(PROJECT_ID.toString()),
      }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect(lookup).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("a registration that names no project is refused", async () => {
    const answer: Answer = await register(overTheWire(browserRegistration));

    expect(answer).toBeInstanceOf(BadDataException);
    expect((answer as Error).message).toBe("Project ID is required");
    expect(membershipReads).toEqual([]);
  });

  test.each([
    ["the text toString() made of the serialized id", "[object Object]"],
    ["a string that is not an id", "not-a-project"],
    [
      "a serialized ObjectID whose value is not an id",
      {
        _type: "ObjectID",
        value: "not-a-project",
      },
    ],
    ["an object with an id but no _type", { value: PROJECT_ID.toString() }],
    ["an array holding an id", [PROJECT_ID.toString()]],
    ["a number", 42],
  ])(
    "a project id that is %s is refused before anything is read",
    async (_name: string, projectId: unknown) => {
      const answer: Answer = await register(
        overTheWire({ ...browserRegistration, projectId: projectId }),
      );

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe("Project ID is invalid");
      expect(membershipReads).toEqual([]);
      expect(lookup).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  /*
   * A phone's registration is noted for its push receipts: the app asked
   * Expo for its token just before registering, which renews the token
   * there. A receipt for a push sent before then saying the token was gone
   * is about the token as it was, and does not mark the phone
   * (ExpoPushReceiptService) - an iPhone keeps its Expo push token through a
   * reinstall, so a page sent while the app was removed is refused in its
   * receipt after the app is back.
   */
  describe("a phone's registration is noted for its push receipts", () => {
    const PHONE_TOKEN: string = "ExponentPushToken[noted-phone-00000001]";

    let noted: SpyInstance<typeof ExpoPushReceiptQueue.noteTokenRegistered>;

    beforeEach(() => {
      noted = jest
        .spyOn(ExpoPushReceiptQueue, "noteTokenRegistered")
        .mockResolvedValue(undefined);
      jest
        .spyOn(UserPushService, "verifyExpoPushDeviceRegisteredAgain")
        .mockResolvedValue(true);
    });

    function phone(deviceType: PushDeviceType): JSONObject {
      return overTheWire({
        deviceToken: PHONE_TOKEN,
        deviceType: deviceType,
        deviceName: "iPhone 15",
        projectId: PROJECT_ID.toString(),
      });
    }

    test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
      "%s, registering for the first time",
      async (deviceType: PushDeviceType) => {
        await register(phone(deviceType));

        expect(noted).toHaveBeenCalledTimes(1);
        expect(noted.mock.calls[0]![0]).toBe(PHONE_TOKEN);
      },
    );

    test.each([
      ["still receiving notifications", true],
      ["marked as not receiving them", false],
    ])(
      "a phone already registered, %s",
      async (_name: string, isVerified: boolean) => {
        lookup.mockResolvedValue({
          _id: EXISTING_DEVICE_ID.toString(),
          id: EXISTING_DEVICE_ID,
          isVerified: isVerified,
          deviceType: PushDeviceType.iOS,
        } as never);

        await register(phone(PushDeviceType.iOS));

        expect(noted).toHaveBeenCalledTimes(1);
        expect(noted.mock.calls[0]![0]).toBe(PHONE_TOKEN);
      },
    );

    test("a browser has no Expo receipts: nothing is noted", async () => {
      await register(
        overTheWire({
          ...browserRegistration,
          projectId: PROJECT_ID.toString(),
        }),
      );

      expect(noted).not.toHaveBeenCalled();
    });

    test("somebody who is not a member notes nothing", async () => {
      members.clear();

      await register(phone(PushDeviceType.Android));

      expect(noted).not.toHaveBeenCalled();
    });
  });

  /*
   * Expo gave the app a new push token on a phone where the app kept its
   * data - a phone set up from a backup of the old one - and the app says
   * which token it had before. The person's device here registered with the
   * old token is this phone: it carries the new token from now on, with its
   * rules. Before, the new token got a new device with default rules, and
   * the old one stayed - paged until Expo said its token was gone, then "Not
   * receiving notifications" until somebody deleted it.
   */
  describe("a phone that says which token it had before", () => {
    const NEW_TOKEN: string = "ExponentPushToken[new-phone-token-00001]";
    const OLD_TOKEN: string = "ExponentPushToken[old-phone-token-00002]";

    let renew: SpyInstance<typeof UserPushService.renewExpoPushDevice>;

    beforeEach(() => {
      jest
        .spyOn(ExpoPushReceiptQueue, "noteTokenRegistered")
        .mockResolvedValue(undefined);

      renew = jest
        .spyOn(UserPushService, "renewExpoPushDevice")
        .mockResolvedValue({
          _id: EXISTING_DEVICE_ID.toString(),
          id: EXISTING_DEVICE_ID,
        } as never);
    });

    function phone(
      deviceType: PushDeviceType,
      extra: Record<string, unknown> = {},
    ): JSONObject {
      return overTheWire({
        deviceToken: NEW_TOKEN,
        deviceType: deviceType,
        deviceName: "iPhone 16",
        projectId: PROJECT_ID.toString(),
        isCriticalAlertEnabled: true,
        previousDeviceToken: OLD_TOKEN,
        ...extra,
      });
    }

    test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
      "%s: the device registered with the old token carries the new one, with its rules; nothing is created",
      async (deviceType: PushDeviceType) => {
        const answer: Answer = await register(phone(deviceType));

        expect(answer).toEqual({
          json: {
            success: true,
            deviceId: EXISTING_DEVICE_ID.toString(),
            alreadyRegistered: true,
            isVerified: true,
          },
        });

        expect(renew).toHaveBeenCalledTimes(1);

        const renewal: {
          userId: ObjectID;
          projectId: ObjectID;
          previousDeviceToken: string;
          deviceToken: string;
          deviceType: PushDeviceType;
          deviceName: string;
          isCriticalAlertEnabled: boolean;
        } = renew.mock.calls[0]![0];

        expect(renewal.userId.toString()).toBe(USER_ID.toString());
        expect(renewal.projectId.toString()).toBe(PROJECT_ID.toString());
        expect(renewal.previousDeviceToken).toBe(OLD_TOKEN);
        expect(renewal.deviceToken).toBe(NEW_TOKEN);
        expect(renewal.deviceType).toBe(deviceType);
        expect(renewal.deviceName).toBe("iPhone 16");
        expect(renewal.isCriticalAlertEnabled).toBe(true);

        expect(create).not.toHaveBeenCalled();
        // Its own rules came with it; none are added.
        expect(defaultRules).not.toHaveBeenCalled();
      },
    );

    test("the new token is looked up first: a phone already registered with it here keeps that device, and nothing is renewed", async () => {
      lookup.mockResolvedValue({
        _id: NEW_DEVICE_ID.toString(),
        id: NEW_DEVICE_ID,
        isVerified: true,
        deviceType: PushDeviceType.iOS,
      } as never);

      const answer: Answer = await register(phone(PushDeviceType.iOS));

      expect(renew).not.toHaveBeenCalled();
      expect((answer as { json: JSONObject }).json["deviceId"]).toBe(
        NEW_DEVICE_ID.toString(),
      );
      expect(
        (lookup.mock.calls[0]![0].query as { deviceToken: string }).deviceToken,
      ).toBe(NEW_TOKEN);
    });

    test("no device here with the old token: a new device, with default rules, as before", async () => {
      renew.mockResolvedValue(null);

      const answer: Answer = await register(phone(PushDeviceType.Android));

      expect(renew).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(defaultRules).toHaveBeenCalledTimes(1);
      expect(answer).toEqual({
        json: {
          success: true,
          deviceId: NEW_DEVICE_ID.toString(),
          alreadyRegistered: false,
          isVerified: true,
        },
      });
    });

    test("a phone that does not name its device keeps the name a registration gives it", async () => {
      await register(phone(PushDeviceType.iOS, { deviceName: undefined }));

      expect(renew.mock.calls[0]![0].deviceName).toBe("Unknown Device");
    });

    test("critical alerts the phone has off are off on the device it carries on with", async () => {
      await register(
        phone(PushDeviceType.iOS, { isCriticalAlertEnabled: undefined }),
      );

      expect(renew.mock.calls[0]![0].isCriticalAlertEnabled).toBe(false);
    });

    test.each([
      ["the token being registered", NEW_TOKEN],
      ["something that is not an Expo push token", "not-a-token"],
      ["a browser subscription", BROWSER_SUBSCRIPTION],
      ["empty", ""],
      ["a number", 42],
      ["an object", { token: OLD_TOKEN }],
    ])(
      "an old token that is %s is ignored: a new device, as before",
      async (_name: string, previousDeviceToken: unknown) => {
        const answer: Answer = await register(
          phone(PushDeviceType.iOS, { previousDeviceToken: previousDeviceToken }),
        );

        expect(renew).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalledTimes(1);
        expect((answer as { json: JSONObject }).json["alreadyRegistered"]).toBe(
          false,
        );
      },
    );

    test("a browser naming an old token renews nothing: browsers report a new subscription (subscription-change)", async () => {
      await register(
        overTheWire({
          ...browserRegistration,
          projectId: PROJECT_ID.toString(),
          previousDeviceToken: OLD_TOKEN,
        }),
      );

      expect(renew).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledTimes(1);
    });

    test("somebody who is not a member renews nothing", async () => {
      members.clear();

      const answer: Answer = await register(phone(PushDeviceType.iOS));

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect(renew).not.toHaveBeenCalled();
    });
  });
});

describe("readPreviousExpoPushToken", () => {
  const TOKEN: string = "ExponentPushToken[current-token-000001]";
  const PREVIOUS: string = "ExponentPushToken[previous-token-00001]";

  test.each([[PushDeviceType.iOS], [PushDeviceType.Android]])(
    "a %s phone's previous Expo push token",
    (deviceType: PushDeviceType) => {
      expect(
        readPreviousExpoPushToken({
          previousDeviceToken: PREVIOUS,
          deviceToken: TOKEN,
          deviceType: deviceType,
        }),
      ).toBe(PREVIOUS);
    },
  );

  test("the newer token format Expo also issues", () => {
    expect(
      readPreviousExpoPushToken({
        previousDeviceToken: "ExpoPushToken[previous-token-00001]",
        deviceToken: TOKEN,
        deviceType: PushDeviceType.iOS,
      }),
    ).toBe("ExpoPushToken[previous-token-00001]");
  });

  test.each([
    ["from a browser", PREVIOUS, PushDeviceType.Web],
    ["from a device of no known type", PREVIOUS, "watch"],
    ["the token itself", TOKEN, PushDeviceType.iOS],
    ["not an Expo push token", "abc", PushDeviceType.iOS],
    ["empty", "", PushDeviceType.iOS],
    ["missing", undefined, PushDeviceType.iOS],
    ["null", null, PushDeviceType.Android],
    ["a number", 7, PushDeviceType.Android],
    ["a list", [PREVIOUS], PushDeviceType.Android],
  ])(
    "none %s",
    (_name: string, previousDeviceToken: unknown, deviceType: unknown) => {
      expect(
        readPreviousExpoPushToken({
          previousDeviceToken: previousDeviceToken,
          deviceToken: TOKEN,
          deviceType: deviceType,
        }),
      ).toBeNull();
    },
  );
});
