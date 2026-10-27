import UserPushAPI from "../../../Server/API/UserPushAPI";
import TestSendAccess from "../../../Server/API/TestSendAccess";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import { PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE } from "../../../Types/PushNotification/PushNotificationsTurnedOff";
import UserType from "../../../Types/UserType";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

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
 * NO DEVICE IS REGISTERED, AND NO TEST IS PUSHED, WHILE PUSH IS OFF.
 *
 * While a master admin has push notifications turned off for the whole
 * server, nothing pushed would reach a device, so UserPushAPI says so in
 * place of registering one (/user-push/register) or of sending a test to
 * one (/user-push/:deviceId/test-notification): a 400 BadDataException with
 * PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE, the words the Dashboard shows too.
 * The mobile app takes the refusal as it takes any other, and asks again the
 * next time it starts.
 *
 * Who is asking is settled first - the signed-in person for a registration,
 * the test-to-yourself rule for a test - and only then the switch; a switch
 * that cannot be read fails the request rather than letting it through.
 * Taking a device away pushes nothing, so it goes on working.
 */

const USER_ID: ObjectID = new ObjectID("c5000000-0000-4000-8000-000000000011");
const PROJECT_ID: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-000000000012",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-000000000013",
);

const BROWSER_SUBSCRIPTION: string = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/push-turned-off-route",
  expirationTime: null,
  keys: { p256dh: "BNcR", auth: "tBHI" },
});

const PHONE_TOKEN: string = "ExponentPushToken[push-off-route-0000001]";

type Answer = { json: JSONObject } | Error;

// Whether push is turned off, as the server reads it; an Error when the read fails.
let switchAnswer: boolean | Error = false;
let readSwitch: jest.SpyInstance;

function signedIn(data: {
  body?: JSONObject;
  params?: Record<string, string>;
}): OneUptimeRequest {
  return {
    params: data.params || {},
    body: data.body || {},
    headers: {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID, isMasterAdmin: false },
  } as unknown as OneUptimeRequest;
}

// A request with no session: the user middleware let it through with nobody on it.
function signedOut(body: JSONObject): OneUptimeRequest {
  return {
    params: {},
    body: body,
    headers: {},
    query: {},
  } as unknown as OneUptimeRequest;
}

// The route's answer: the JSON it sent, or the error it sent or passed on.
async function call(uri: string, req: OneUptimeRequest): Promise<Answer> {
  (Response.sendErrorResponse as jest.Mock).mockClear();
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("POST", uri)
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

  const jsonCalls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(jsonCalls).toHaveLength(1);

  return { json: jsonCalls[0]![2] as JSONObject };
}

// Refused because push is off: a 400, in the shared words.
function expectPushTurnedOff(answer: Answer): void {
  expect(answer).toBeInstanceOf(BadDataException);
  expect((answer as BadDataException).code).toBe(400);
  expect((answer as BadDataException).message).toBe(
    PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
  );
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserPushAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  switchAnswer = false;

  readSwitch = jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockImplementation(async (): Promise<boolean> => {
      if (switchAnswer instanceof Error) {
        throw switchAnswer;
      }

      return switchAnswer;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /user-push/register", () => {
  const URI: string = "/user-push/register";

  let membershipRead: jest.SpyInstance;
  let lookup: jest.SpyInstance;
  let create: jest.SpyInstance;
  let defaultRules: jest.SpyInstance;

  const REGISTRATIONS: Array<[string, JSONObject]> = [
    [
      "a browser",
      {
        deviceToken: BROWSER_SUBSCRIPTION,
        deviceType: PushDeviceType.Web,
        deviceName: "Chrome on Windows",
        projectId: PROJECT_ID.toString(),
      },
    ],
    [
      "an iPhone",
      {
        deviceToken: PHONE_TOKEN,
        deviceType: PushDeviceType.iOS,
        deviceName: "iPhone 15",
        projectId: PROJECT_ID.toString(),
      },
    ],
    [
      "an Android phone",
      {
        deviceToken: PHONE_TOKEN,
        deviceType: PushDeviceType.Android,
        deviceName: "Pixel 8",
        projectId: PROJECT_ID.toString(),
      },
    ],
  ];

  beforeEach(() => {
    membershipRead = jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockResolvedValue(new Set<string>([USER_ID.toString()]));

    lookup = jest.spyOn(UserPushService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(UserPushService, "updateOneBy").mockResolvedValue(1);

    create = jest
      .spyOn(UserPushService, "create")
      .mockImplementation((async (data: { data: JSONObject }) => {
        return {
          ...data.data,
          _id: DEVICE_ID.toString(),
          id: DEVICE_ID,
        };
      }) as never);

    defaultRules = jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined as never);
  });

  test.each(REGISTRATIONS)(
    "push off: %s is not registered - a 400 in the shared words, and nothing is looked up, created or set up",
    async (_name: string, body: JSONObject) => {
      switchAnswer = true;

      expectPushTurnedOff(await call(URI, signedIn({ body })));

      expect(membershipRead).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(defaultRules).not.toHaveBeenCalled();
    },
  );

  test("push off: said before the body is read - a registration with no token hears that push is off", async () => {
    switchAnswer = true;

    expectPushTurnedOff(await call(URI, signedIn({ body: {} })));
  });

  test("push off: a device already registered is not answered as registered", async () => {
    switchAnswer = true;
    lookup.mockResolvedValue({
      _id: DEVICE_ID.toString(),
      id: DEVICE_ID,
      isVerified: true,
    } as never);

    expectPushTurnedOff(
      await call(URI, signedIn({ body: REGISTRATIONS[0]![1] })),
    );
  });

  test("push off: a caller who is not signed in is told so first, and the switch is not read", async () => {
    switchAnswer = true;

    const answer: Answer = await call(URI, signedOut(REGISTRATIONS[0]![1]));

    expect(answer).toBeInstanceOf(NotAuthenticatedException);
    expect(readSwitch).not.toHaveBeenCalled();
  });

  test("push on: a browser registers as it always did", async () => {
    const answer: Answer = await call(
      URI,
      signedIn({ body: REGISTRATIONS[0]![1] }),
    );

    expect(answer).toEqual({
      json: {
        success: true,
        deviceId: DEVICE_ID.toString(),
        alreadyRegistered: false,
        isVerified: true,
      },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(defaultRules).toHaveBeenCalledTimes(1);
  });

  test("push on: the switch is asked once, before anything is written", async () => {
    await call(URI, signedIn({ body: REGISTRATIONS[0]![1] }));

    expect(readSwitch).toHaveBeenCalledTimes(1);
    expect(readSwitch.mock.invocationCallOrder[0]!).toBeLessThan(
      create.mock.invocationCallOrder[0]!,
    );
  });

  test("push on: a body's own mistake is named as it always was", async () => {
    const answer: Answer = await call(URI, signedIn({ body: {} }));

    expect(answer).toBeInstanceOf(BadDataException);
    expect((answer as Error).message).toBe("Device token is required");
  });

  test("a switch that cannot be read fails the registration, and nothing is created", async () => {
    switchAnswer = new Error("database unavailable");

    const answer: Answer = await call(
      URI,
      signedIn({ body: REGISTRATIONS[1]![1] }),
    );

    expect(answer).toBeInstanceOf(Error);
    expect((answer as Error).message).toBe("database unavailable");
    expect(answer).not.toBeInstanceOf(BadDataException);
    expect(lookup).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /user-push/:deviceId/test-notification", () => {
  const URI: string = "/user-push/:deviceId/test-notification";

  let mayTest: jest.SpyInstance;
  let deviceRead: jest.SpyInstance;
  let send: jest.SpyInstance;

  function testRequest(): OneUptimeRequest {
    return signedIn({ params: { deviceId: DEVICE_ID.toString() } });
  }

  beforeEach(() => {
    mayTest = jest
      .spyOn(TestSendAccess, "assertMaySendTestToSelf")
      .mockResolvedValue({
        props: {
          userId: USER_ID,
          userGlobalAccessPermission: { projectIds: [PROJECT_ID] },
        },
        userId: USER_ID,
      } as never);

    deviceRead = jest
      .spyOn(UserPushService, "findOneById")
      .mockImplementation((async () => {
        return {
          _id: DEVICE_ID.toString(),
          userId: USER_ID,
          projectId: PROJECT_ID,
          deviceName: "Pixel 8",
          deviceToken: PHONE_TOKEN,
          deviceType: PushDeviceType.Android,
          isVerified: true,
          isCriticalAlertEnabled: false,
        };
      }) as never);

    send = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockResolvedValue(undefined);
  });

  test("push off: no test is pushed - a 400 in the shared words, and the device is not even read", async () => {
    switchAnswer = true;

    expectPushTurnedOff(await call(URI, testRequest()));

    expect(deviceRead).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  test("push off: a device id that matches nothing hears that push is off, not that it is missing", async () => {
    switchAnswer = true;
    deviceRead.mockResolvedValue(null as never);

    expectPushTurnedOff(await call(URI, testRequest()));
  });

  test("push off: the test-to-yourself rule is asked first - a caller it refuses hears that, and the switch is not read", async () => {
    switchAnswer = true;
    mayTest.mockRejectedValue(
      new NotAuthorizedException(
        "A read-only credential cannot send a test notification.",
      ),
    );

    const answer: Answer = await call(URI, testRequest());

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect(readSwitch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  test("push off: a caller allowed to test is refused once the rule has passed", async () => {
    switchAnswer = true;

    await call(URI, testRequest());

    expect(mayTest).toHaveBeenCalledTimes(1);
    expect(readSwitch).toHaveBeenCalledTimes(1);
    expect(mayTest.mock.invocationCallOrder[0]!).toBeLessThan(
      readSwitch.mock.invocationCallOrder[0]!,
    );
  });

  test("push on: the test is sent to the device, as it always was", async () => {
    const answer: Answer = await call(URI, testRequest());

    expect(answer).toEqual({
      json: {
        success: true,
        message: "Test notification sent successfully",
        isCriticalAlert: false,
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("a switch that cannot be read fails the test, and nothing is sent", async () => {
    switchAnswer = new Error("database unavailable");

    const answer: Answer = await call(URI, testRequest());

    expect((answer as Error).message).toBe("database unavailable");
    expect(answer).not.toBeInstanceOf(BadDataException);
    expect(deviceRead).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("a route that pushes nothing", () => {
  test("taking a device away goes on working while push is off, and does not ask the switch", async () => {
    switchAnswer = true;

    const removed: jest.SpyInstance = jest
      .spyOn(UserPushService, "deleteBy")
      .mockResolvedValue(1 as never);

    const answer: Answer = await call(
      "/user-push/unregister",
      signedIn({ body: { deviceToken: PHONE_TOKEN } }),
    );

    expect(answer).toEqual({
      json: { success: true, message: "Device unregistered successfully" },
    });
    expect(removed).toHaveBeenCalledTimes(1);
    expect(readSwitch).not.toHaveBeenCalled();
  });
});
