import UserPushAPI from "../../../Server/API/UserPushAPI";
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
 * A push device is registered for one project and pages its owner on that
 * project's behalf. Registering one - or turning one back on - is for
 * members of that project only: the project named in the request is
 * checked against the person's memberships, not trusted, so somebody who
 * has left cannot give themselves a way to be paged by it again.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000001");
const SOMEONE_ELSE: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000003",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000004",
);

type Answer = "ok" | Error;

function signedIn(data: {
  body?: Record<string, unknown>;
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

async function call(uri: string, req: OneUptimeRequest): Promise<Answer> {
  (Response.sendErrorResponse as jest.Mock).mockClear();

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

  return failure || "ok";
}

describe("push devices are for members of the project", () => {
  let members: Set<string>;
  let membershipReads: Array<{ projectId: string; userIds: Array<string> }>;

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
          const asked: Array<string> = data.userIds.map(
            (userId: ObjectID | string): string => {
              return userId.toString();
            },
          );

          membershipReads.push({
            projectId: data.projectId.toString(),
            userIds: asked,
          });

          return new Set<string>(
            asked.filter((userId: string): boolean => {
              return members.has(userId);
            }),
          );
        },
      );

    jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /user-push/register", () => {
    const registration: Record<string, unknown> = {
      deviceToken: "push-token",
      deviceType: PushDeviceType.Android,
      deviceName: "Pixel",
      projectId: PROJECT_ID.toString(),
    };

    test("a member registers a device for the project", async () => {
      jest.spyOn(UserPushService, "findOneBy").mockResolvedValue(null);
      const create: SpyInstance<typeof UserPushService.create> = jest
        .spyOn(UserPushService, "create")
        .mockImplementation((async (data: {
          data: { projectId: ObjectID };
        }) => {
          return { ...data.data, _id: DEVICE_ID.toString(), id: DEVICE_ID };
        }) as never);

      expect(
        await call("/user-push/register", signedIn({ body: registration })),
      ).toBe("ok");

      expect(membershipReads).toEqual([
        { projectId: PROJECT_ID.toString(), userIds: [USER_ID.toString()] },
      ]);
      expect(create).toHaveBeenCalledTimes(1);
      expect(
        (
          create.mock.calls[0]![0].data as { projectId: ObjectID }
        ).projectId.toString(),
      ).toBe(PROJECT_ID.toString());
    });

    test("somebody who is not a member of the project is refused, and nothing is saved", async () => {
      members.clear();
      const lookup: SpyInstance<typeof UserPushService.findOneBy> = jest
        .spyOn(UserPushService, "findOneBy")
        .mockResolvedValue(null);
      const create: SpyInstance<typeof UserPushService.create> = jest.spyOn(
        UserPushService,
        "create",
      );

      const answer: Answer = await call(
        "/user-push/register",
        signedIn({ body: registration }),
      );

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect(lookup).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    test("a project id that is not an id is refused before anything is read", async () => {
      const create: SpyInstance<typeof UserPushService.create> = jest.spyOn(
        UserPushService,
        "create",
      );

      const answer: Answer = await call(
        "/user-push/register",
        signedIn({ body: { ...registration, projectId: "not-a-project" } }),
      );

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe("Project ID is invalid");
      expect(membershipReads).toEqual([]);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("POST /user-push/:deviceId/verify", () => {
    function stubDevice(device: Record<string, unknown> | null): void {
      jest
        .spyOn(UserPushService, "findOneById")
        .mockResolvedValue(device as never);
    }

    const request: OneUptimeRequest = signedIn({
      params: { deviceId: DEVICE_ID.toString() },
    });

    test("a member turns their device back on", async () => {
      stubDevice({
        _id: DEVICE_ID.toString(),
        id: DEVICE_ID,
        userId: USER_ID,
        projectId: PROJECT_ID,
      });
      const verify: SpyInstance<typeof UserPushService.verifyDevice> = jest
        .spyOn(UserPushService, "verifyDevice")
        .mockResolvedValue();

      expect(await call("/user-push/:deviceId/verify", request)).toBe("ok");
      expect(verify).toHaveBeenCalledTimes(1);
      expect(membershipReads).toEqual([
        { projectId: PROJECT_ID.toString(), userIds: [USER_ID.toString()] },
      ]);
    });

    test("their own device, of a project they have left: refused and left off", async () => {
      members.clear();
      stubDevice({
        _id: DEVICE_ID.toString(),
        id: DEVICE_ID,
        userId: USER_ID,
        projectId: PROJECT_ID,
      });
      const verify: SpyInstance<typeof UserPushService.verifyDevice> = jest
        .spyOn(UserPushService, "verifyDevice")
        .mockResolvedValue();

      const answer: Answer = await call("/user-push/:deviceId/verify", request);

      expect(answer).toBeInstanceOf(NotAuthorizedException);
      expect(verify).not.toHaveBeenCalled();
    });

    test("somebody else's device is refused before membership is asked", async () => {
      stubDevice({
        _id: DEVICE_ID.toString(),
        id: DEVICE_ID,
        userId: SOMEONE_ELSE,
        projectId: PROJECT_ID,
      });
      const verify: SpyInstance<typeof UserPushService.verifyDevice> = jest
        .spyOn(UserPushService, "verifyDevice")
        .mockResolvedValue();

      const answer: Answer = await call("/user-push/:deviceId/verify", request);

      expect(answer).toBeInstanceOf(BadDataException);
      expect(verify).not.toHaveBeenCalled();
      expect(membershipReads).toEqual([]);
    });

    test("a device with no project pages for nobody, and is not turned on", async () => {
      stubDevice({
        _id: DEVICE_ID.toString(),
        id: DEVICE_ID,
        userId: USER_ID,
        projectId: undefined,
      });
      const verify: SpyInstance<typeof UserPushService.verifyDevice> = jest
        .spyOn(UserPushService, "verifyDevice")
        .mockResolvedValue();

      const answer: Answer = await call("/user-push/:deviceId/verify", request);

      expect(answer).toBeInstanceOf(BadDataException);
      expect((answer as Error).message).toBe("Device not found");
      expect(verify).not.toHaveBeenCalled();
    });
  });
});
