import UserPushAPI, {
  readProjectIdFromBody,
} from "../../../Server/API/UserPushAPI";
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
});
