import UserPushAPI from "../../../Server/API/UserPushAPI";
import UserPushService from "../../../Server/Services/UserPushService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
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
 * A browser's push subscription does not last forever: the push service
 * expires or rotates it, and notifications blocked and allowed again give the
 * browser a new one. The browser then fires pushsubscriptionchange in the
 * Dashboard's service worker, which used to re-subscribe without the server's
 * key (refused by every browser) and PUT the result to /api/push-subscription,
 * a route that never existed. The devices kept the dead subscription, and
 * every notification to them failed at the push service.
 *
 * The worker now reports the old subscription and the new one here, and every
 * device of the caller registered with the old one carries the new one.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000021");
const SOMEONE_ELSE: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000022",
);
const PROJECT_ONE: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000023",
);
const PROJECT_TWO: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000024",
);
const LEFT_PROJECT: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000025",
);

function subscription(name: string): string {
  return JSON.stringify({
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    expirationTime: null,
    keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
  });
}

const OLD_SUBSCRIPTION: string = subscription("old");
const NEW_SUBSCRIPTION: string = subscription("new");

interface Device {
  _id: string;
  userId: ObjectID;
  projectId: ObjectID;
  deviceToken: string;
  deviceType: PushDeviceType;
  isVerified: boolean;
}

let devices: Array<Device>;
let memberProjectIds: Array<ObjectID>;

function device(data: {
  id: string;
  projectId: ObjectID;
  deviceToken?: string;
  userId?: ObjectID;
  deviceType?: PushDeviceType;
  isVerified?: boolean;
}): Device {
  return {
    _id: data.id,
    userId: data.userId || USER_ID,
    projectId: data.projectId,
    deviceToken: data.deviceToken || OLD_SUBSCRIPTION,
    deviceType: data.deviceType || PushDeviceType.Web,
    isVerified: data.isVerified === undefined ? true : data.isVerified,
  };
}

function find(id: string): Device {
  return devices.find((candidate: Device): boolean => {
    return candidate._id === id;
  })!;
}

// What the query builder would select: every column the query names, equal.
function matches(row: Device, query: Record<string, unknown>): boolean {
  return Object.keys(query).every((column: string): boolean => {
    return (
      String((row as unknown as Record<string, unknown>)[column]) ===
      String(query[column])
    );
  });
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

async function changeSubscription(req: OneUptimeRequest): Promise<Answer> {
  (Response.sendErrorResponse as jest.Mock).mockClear();
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("POST", "/user-push/subscription-change")
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

describe("POST /user-push/subscription-change", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserPushAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    devices = [];
    memberProjectIds = [PROJECT_ONE, PROJECT_TWO];

    jest
      .spyOn(ProjectMembership, "getMemberProjectIds")
      .mockImplementation(
        async (data: { userId: ObjectID }): Promise<Array<ObjectID>> => {
          return data.userId.toString() === USER_ID.toString()
            ? memberProjectIds
            : [];
        },
      );

    jest.spyOn(UserPushService, "findBy").mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }) => {
      return devices.filter((row: Device): boolean => {
        return matches(row, findBy.query);
      });
    }) as never);

    jest
      .spyOn(UserPushService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: Record<string, unknown>;
      }) => {
        return (
          devices.find((row: Device): boolean => {
            return matches(row, findOneBy.query);
          }) || null
        );
      }) as never);

    const update: (updateBy: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      limit?: number;
    }) => Promise<number> = async (updateBy: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      limit?: number;
    }): Promise<number> => {
      const rows: Array<Device> = devices
        .filter((row: Device): boolean => {
          return matches(row, updateBy.query);
        })
        .slice(0, updateBy.limit === undefined ? 1 : updateBy.limit);

      for (const row of rows) {
        Object.assign(row, updateBy.data);
      }

      return rows.length;
    };

    jest
      .spyOn(UserPushService, "updateOneBy")
      .mockImplementation(update as never);
    jest.spyOn(UserPushService, "updateBy").mockImplementation(update as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a new subscription", () => {
    test("every device the caller registered with the old one carries the new one, one per project", async () => {
      devices = [
        device({ id: "phone-one", projectId: PROJECT_ONE }),
        device({ id: "phone-two", projectId: PROJECT_TWO }),
      ];

      const answer: Answer = await changeSubscription(
        signedIn({
          oldDeviceToken: OLD_SUBSCRIPTION,
          newDeviceToken: NEW_SUBSCRIPTION,
        }),
      );

      expect(answer).toEqual({ json: { success: true, devicesUpdated: 2 } });
      expect(find("phone-one").deviceToken).toBe(NEW_SUBSCRIPTION);
      expect(find("phone-two").deviceToken).toBe(NEW_SUBSCRIPTION);
    });

    test("a device that stopped receiving notifications when the old one died receives them again", async () => {
      devices = [
        device({ id: "browser", projectId: PROJECT_ONE, isVerified: false }),
      ];

      await changeSubscription(
        signedIn({
          oldDeviceToken: OLD_SUBSCRIPTION,
          newDeviceToken: NEW_SUBSCRIPTION,
        }),
      );

      expect(find("browser")).toMatchObject({
        deviceToken: NEW_SUBSCRIPTION,
        isVerified: true,
      });
    });

    test("only the caller's own devices change: somebody else who registered the same browser keeps theirs", async () => {
      devices = [
        device({ id: "mine", projectId: PROJECT_ONE }),
        device({
          id: "theirs",
          projectId: PROJECT_ONE,
          userId: SOMEONE_ELSE,
        }),
      ];

      await changeSubscription(
        signedIn({
          oldDeviceToken: OLD_SUBSCRIPTION,
          newDeviceToken: NEW_SUBSCRIPTION,
        }),
      );

      expect(find("mine").deviceToken).toBe(NEW_SUBSCRIPTION);
      expect(find("theirs").deviceToken).toBe(OLD_SUBSCRIPTION);
    });

    test("only browsers: a phone whose push token happens to be the same text is not touched", async () => {
      devices = [
        device({
          id: "phone",
          projectId: PROJECT_ONE,
          deviceType: PushDeviceType.iOS,
        }),
      ];

      const answer: Answer = await changeSubscription(
        signedIn({
          oldDeviceToken: OLD_SUBSCRIPTION,
          newDeviceToken: NEW_SUBSCRIPTION,
        }),
      );

      expect(answer).toEqual({ json: { success: true, devicesUpdated: 0 } });
      expect(find("phone").deviceToken).toBe(OLD_SUBSCRIPTION);
    });

    test("a device of a project the caller has left is left as it is", async () => {
      devices = [
        device({ id: "member", projectId: PROJECT_ONE }),
        device({ id: "left", projectId: LEFT_PROJECT, isVerified: false }),
      ];

      const answer: Answer = await changeSubscription(
        signedIn({
          oldDeviceToken: OLD_SUBSCRIPTION,
          newDeviceToken: NEW_SUBSCRIPTION,
        }),
      );

      expect(answer).toEqual({ json: { success: true, devicesUpdated: 1 } });
      expect(find("left")).toMatchObject({
        deviceToken: OLD_SUBSCRIPTION,
        isVerified: false,
      });
    });

    test("a project where the browser was registered again with the new subscription keeps that device, and the old one stops receiving instead of doubling every notification", async () => {
      devices = [
        device({ id: "old-in-one", projectId: PROJECT_ONE }),
        device({
          id: "registered-again",
          projectId: PROJECT_ONE,
          deviceToken: NEW_SUBSCRIPTION,
        }),
        device({ id: "old-in-two", projectId: PROJECT_TWO }),
      ];

      const answer: Answer = await changeSubscription(
        signedIn({
          oldDeviceToken: OLD_SUBSCRIPTION,
          newDeviceToken: NEW_SUBSCRIPTION,
        }),
      );

      expect(answer).toEqual({ json: { success: true, devicesUpdated: 1 } });
      expect(find("old-in-one")).toMatchObject({
        deviceToken: OLD_SUBSCRIPTION,
        isVerified: false,
      });
      expect(find("registered-again")).toMatchObject({
        deviceToken: NEW_SUBSCRIPTION,
        isVerified: true,
      });
      expect(find("old-in-two")).toMatchObject({
        deviceToken: NEW_SUBSCRIPTION,
        isVerified: true,
      });
    });

    test("an old subscription no device of the caller has - already replaced, or never registered - changes nothing", async () => {
      devices = [
        device({
          id: "renewed",
          projectId: PROJECT_ONE,
          deviceToken: NEW_SUBSCRIPTION,
        }),
      ];

      const answer: Answer = await changeSubscription(
        signedIn({
          oldDeviceToken: OLD_SUBSCRIPTION,
          newDeviceToken: NEW_SUBSCRIPTION,
        }),
      );

      expect(answer).toEqual({ json: { success: true, devicesUpdated: 0 } });
      expect(find("renewed")).toMatchObject({
        deviceToken: NEW_SUBSCRIPTION,
        isVerified: true,
      });
    });

    test("the same subscription reported as old and new changes nothing", async () => {
      devices = [device({ id: "browser", projectId: PROJECT_ONE })];

      const answer: Answer = await changeSubscription(
        signedIn({
          oldDeviceToken: OLD_SUBSCRIPTION,
          newDeviceToken: OLD_SUBSCRIPTION,
        }),
      );

      expect(answer).toEqual({ json: { success: true, devicesUpdated: 0 } });
      expect(find("browser")).toMatchObject({
        deviceToken: OLD_SUBSCRIPTION,
        isVerified: true,
      });
      expect(UserPushService.updateOneBy).not.toHaveBeenCalled();
    });
  });

  describe("no subscription any more", () => {
    test("null: the caller's devices registered with the old one stop being verified now, not at the next page that fails", async () => {
      devices = [
        device({ id: "mine-one", projectId: PROJECT_ONE }),
        device({ id: "mine-two", projectId: PROJECT_TWO }),
        device({
          id: "theirs",
          projectId: PROJECT_ONE,
          userId: SOMEONE_ELSE,
        }),
        device({
          id: "phone",
          projectId: PROJECT_ONE,
          deviceType: PushDeviceType.Android,
        }),
      ];

      const answer: Answer = await changeSubscription(
        signedIn({ oldDeviceToken: OLD_SUBSCRIPTION, newDeviceToken: null }),
      );

      expect(answer).toEqual({ json: { success: true, devicesUpdated: 2 } });
      expect(find("mine-one").isVerified).toBe(false);
      expect(find("mine-two").isVerified).toBe(false);
      expect(find("theirs").isVerified).toBe(true);
      expect(find("phone").isVerified).toBe(true);
      // Kept, with their rules, for the browser to renew.
      expect(devices).toHaveLength(4);
    });
  });

  describe("what is refused", () => {
    test("somebody who is not signed in", async () => {
      const req: OneUptimeRequest = signedIn({
        oldDeviceToken: OLD_SUBSCRIPTION,
        newDeviceToken: NEW_SUBSCRIPTION,
      });
      delete (req as { userAuthorization?: unknown }).userAuthorization;

      const answer: Answer = await changeSubscription(req);

      expect(answer).toBeInstanceOf(NotAuthenticatedException);
      expect(UserPushService.findBy).not.toHaveBeenCalled();
    });

    test.each([
      ["no old subscription", { newDeviceToken: NEW_SUBSCRIPTION }],
      [
        "an old subscription that is not text",
        { oldDeviceToken: { endpoint: "x" }, newDeviceToken: NEW_SUBSCRIPTION },
      ],
    ])("%s", async (_name: string, body: JSONObject) => {
      const answer: Answer = await changeSubscription(signedIn(body));

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe("oldDeviceToken is required");
      expect(UserPushService.findBy).not.toHaveBeenCalled();
    });

    test("a new subscription left out, rather than null", async () => {
      const answer: Answer = await changeSubscription(
        signedIn({ oldDeviceToken: OLD_SUBSCRIPTION }),
      );

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toMatch(/^newDeviceToken is required/);
      expect(UserPushService.updateBy).not.toHaveBeenCalled();
    });

    test.each([
      ["is not JSON", "not-a-subscription"],
      ["is JSON but not a subscription", "[1, 2]"],
      [
        "names an endpoint that is not a browser push service",
        JSON.stringify({
          endpoint: "https://169.254.169.254/latest/meta-data/",
          keys: { p256dh: "p256dh", auth: "auth" },
        }),
      ],
      [
        "names a push service over plain http",
        JSON.stringify({
          endpoint: "http://fcm.googleapis.com/fcm/send/new",
          keys: { p256dh: "p256dh", auth: "auth" },
        }),
      ],
      [
        "has no keys to encrypt a notification with",
        JSON.stringify({
          endpoint: "https://fcm.googleapis.com/fcm/send/new",
        }),
      ],
      [
        "has only one of the keys",
        JSON.stringify({
          endpoint: "https://fcm.googleapis.com/fcm/send/new",
          keys: { p256dh: "p256dh" },
        }),
      ],
      ["is empty", ""],
    ])(
      "a new subscription that %s, before any device is read",
      async (_name: string, newDeviceToken: string) => {
        devices = [device({ id: "browser", projectId: PROJECT_ONE })];

        const answer: Answer = await changeSubscription(
          signedIn({
            oldDeviceToken: OLD_SUBSCRIPTION,
            newDeviceToken: newDeviceToken,
          }),
        );

        expect(answer).toBeInstanceOf(BadDataException);
        expect(UserPushService.findBy).not.toHaveBeenCalled();
        expect(find("browser")).toMatchObject({
          deviceToken: OLD_SUBSCRIPTION,
          isVerified: true,
        });
      },
    );
  });
});
