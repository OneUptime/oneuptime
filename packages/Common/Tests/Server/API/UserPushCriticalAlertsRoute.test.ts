import UserPushAPI from "../../../Server/API/UserPushAPI";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
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
 * POST /user-push/critical-alerts is where the phone tells the server what
 * it will do with a critical page. The app used to call it only when the
 * responder moved the switch; now it also calls it whenever that changes
 * without them - critical alerts turned off in iOS Settings, Do Not Disturb
 * access taken away on Android - and after registrations an older server
 * may not have applied. So saying the same again has to be harmless, a
 * token with no device has to be refused in words the app recognises
 * (MobileApp notifications/criticalAlertsReport.ts, NO_REGISTERED_DEVICE_
 * MESSAGE), and every device of the phone has to follow.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000151");
const PHONE_TOKEN: string = "ExponentPushToken[route-phone-000000001]";

const PROJECT_ONE_DEVICE: string = "7f000000-0000-4000-8000-000000000152";
const PROJECT_TWO_DEVICE: string = "7f000000-0000-4000-8000-000000000153";

type Answer = { json: JSONObject } | Error;

async function report(
  body: Record<string, unknown>,
  options: { signedIn?: boolean } = {},
): Promise<Answer> {
  (Response.sendErrorResponse as jest.Mock).mockClear();
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const req: OneUptimeRequest = {
    params: {},
    body: JSON.parse(JSON.stringify(body)) as JSONObject,
    headers: {},
    query: {},
    userType: UserType.User,
    ...(options.signedIn === false
      ? {}
      : { userAuthorization: { userId: USER_ID, isMasterAdmin: false } }),
  } as unknown as OneUptimeRequest;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("POST", "/user-push/critical-alerts")
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

describe("POST /user-push/critical-alerts", () => {
  // The caller's devices with the token, by id: what the route finds.
  let devices: Array<{ _id: string; deviceType: PushDeviceType }>;
  // What each device holds, as the writes leave it.
  let stored: Map<string, boolean>;
  let find: SpyInstance<typeof UserPushService.findBy>;
  let update: SpyInstance<typeof UserPushService.updateOneBy>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserPushAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    devices = [
      { _id: PROJECT_ONE_DEVICE, deviceType: PushDeviceType.iOS },
      { _id: PROJECT_TWO_DEVICE, deviceType: PushDeviceType.iOS },
    ];
    stored = new Map<string, boolean>([
      [PROJECT_ONE_DEVICE, true],
      [PROJECT_TWO_DEVICE, true],
    ]);

    find = jest
      .spyOn(UserPushService, "findBy")
      .mockImplementation((async () => {
        return devices;
      }) as never);

    update = jest
      .spyOn(UserPushService, "updateOneBy")
      .mockImplementation((async (updateBy: {
        query: { _id: string };
        data: { isCriticalAlertEnabled?: boolean };
      }) => {
        stored.set(
          updateBy.query._id,
          Boolean(updateBy.data.isCriticalAlertEnabled),
        );
        return 1;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the phone says critical alerts are off: every device of it, in every project, is turned off", async () => {
    const answer: Answer = await report({
      deviceToken: PHONE_TOKEN,
      isEnabled: false,
    });

    expect(answer).toEqual({
      json: {
        success: true,
        isCriticalAlertEnabled: false,
        devicesUpdated: 2,
      },
    });
    expect(Array.from(stored.values())).toEqual([false, false]);

    // Only the caller's own devices with this token are looked for.
    const query: { userId: ObjectID; deviceToken: string } = find.mock
      .calls[0]![0].query as never;

    expect(query.userId.toString()).toBe(USER_ID.toString());
    expect(query.deviceToken).toBe(PHONE_TOKEN);
  });

  test("and on again", async () => {
    stored.set(PROJECT_ONE_DEVICE, false);
    stored.set(PROJECT_TWO_DEVICE, false);

    const answer: Answer = await report({
      deviceToken: PHONE_TOKEN,
      isEnabled: true,
    });

    expect(
      (answer as { json: JSONObject }).json["isCriticalAlertEnabled"],
    ).toBe(true);
    expect(Array.from(stored.values())).toEqual([true, true]);
  });

  test("saying the same again is harmless: the same answer, the same devices", async () => {
    const first: Answer = await report({
      deviceToken: PHONE_TOKEN,
      isEnabled: false,
    });
    const second: Answer = await report({
      deviceToken: PHONE_TOKEN,
      isEnabled: false,
    });

    expect(second).toEqual(first);
    expect(Array.from(stored.values())).toEqual([false, false]);
  });

  test("as a form posts it: the string false", async () => {
    await report({ deviceToken: PHONE_TOKEN, isEnabled: "false" });

    expect(Array.from(stored.values())).toEqual([false, false]);
  });

  /*
   * The app recognises these words (MobileApp criticalAlertsReport.ts) and
   * leaves the phone's state to its next registration, which makes the
   * device. Change them and the app shows "Could not save this setting"
   * instead.
   */
  test("a token with no device is refused, in the words the app recognises", async () => {
    devices = [];

    const answer: Answer = await report({
      deviceToken: PHONE_TOKEN,
      isEnabled: false,
    });

    expect(answer).toBeInstanceOf(BadDataException);
    expect((answer as Error).message).toBe(
      "No registered device was found for this device token.",
    );
    expect(update).not.toHaveBeenCalled();
  });

  test("a browser's subscription is refused: no browser can ring through silent mode", async () => {
    devices = [{ _id: PROJECT_ONE_DEVICE, deviceType: PushDeviceType.Web }];

    const answer: Answer = await report({
      deviceToken: "a browser subscription",
      isEnabled: true,
    });

    expect((answer as Error).message).toBe(
      "Critical alerts are only available on iOS and Android devices.",
    );
    expect(update).not.toHaveBeenCalled();
  });

  test.each([
    ["no token", { isEnabled: false }, "Device token is required"],
    ["no state", { deviceToken: PHONE_TOKEN }, "isEnabled is required"],
    [
      "a null state",
      { deviceToken: PHONE_TOKEN, isEnabled: null },
      "isEnabled is required",
    ],
    [
      "a state that is neither",
      { deviceToken: PHONE_TOKEN, isEnabled: "maybe" },
      "isEnabled must be either true or false.",
    ],
  ])(
    "%s is refused, and nothing changes",
    async (_name: string, body: Record<string, unknown>, message: string) => {
      const answer: Answer = await report(body);

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe(message);
      expect(update).not.toHaveBeenCalled();
    },
  );

  test("nobody signed in changes nothing", async () => {
    const answer: Answer = await report(
      { deviceToken: PHONE_TOKEN, isEnabled: false },
      { signedIn: false },
    );

    expect(answer).toBeInstanceOf(NotAuthenticatedException);
    expect(find).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
