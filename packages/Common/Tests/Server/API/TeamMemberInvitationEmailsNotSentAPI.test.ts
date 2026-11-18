import CommonAPI from "../../../Server/API/CommonAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import InvitationEmailsNotSent from "../../../Server/Utils/TeamMember/InvitationEmailsNotSent";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  INVITATION_EMAILS_NOT_SENT_ROUTE,
  MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
} from "../../../Types/Team/InvitationEmailsNotSent";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * POST /team-member/invitation-emails-not-sent (#9511): of the pending
 * people on a page of the Users list, a person's Teams or a team's
 * Members, the ones whose latest invitation email was not sent, with the
 * mail service's answer. Read from the project's Email Logs with the
 * caller's own permissions, in the request's project, never as OneUptime:
 * a page says Email Not Sent only to someone who could read it under
 * Notification Logs > Email.
 */

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
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "95140000-0000-4000-8000-000000000001",
);
const CALLER_ID: ObjectID = new ObjectID(
  "95140000-0000-4000-8000-000000000002",
);
const GRACE: ObjectID = new ObjectID("95150000-0000-4000-8000-000000000001");
const ALAN: ObjectID = new ObjectID("95150000-0000-4000-8000-000000000002");

function callerProps(): DatabaseCommonInteractionProps {
  const memberPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: [],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [memberPermission],
    },
  };

  return {
    tenantId: PROJECT_ID,
    userId: CALLER_ID,
    userTenantAccessPermission: permissionMap,
  };
}

async function callRoute(body: unknown): Promise<{ thrownToNext: unknown }> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: Mock = jest.fn();

  await mockRouter
    .match("POST", INVITATION_EMAILS_NOT_SENT_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
  };
}

// What the route answered, as it sent it.
function answered(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
}

describe("POST /team-member/invitation-emails-not-sent", () => {
  let readSpy: SpyInstance<typeof InvitationEmailsNotSent.read>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new TeamMemberAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(callerProps());

    readSpy = jest.spyOn(InvitationEmailsNotSent, "read").mockResolvedValue([
      {
        userId: GRACE.toString(),
        statusMessage: "535 5.7.8 Authentication failed",
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered behind the user middleware, for anyone in the project - not only a master admin", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      INVITATION_EMAILS_NOT_SENT_ROUTE,
    );

    expect(route.middlewares).toContain(UserMiddleware.getUserMiddleware);
    expect(route.middlewares).not.toContain(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("names whose latest invitation email was not sent, with the Email Log's reason", async () => {
    await callRoute({ userIds: [GRACE.toString(), ALAN.toString()] });

    expect(answered()).toEqual({
      people: [
        {
          userId: GRACE.toString(),
          statusMessage: "535 5.7.8 Authentication failed",
        },
      ],
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  test("reads with the caller's own permissions, in the request's project, about the people named, each once", async () => {
    await callRoute({
      userIds: [GRACE.toString(), ALAN.toString(), GRACE.toString()],
      projectId: ObjectID.generate().toString(),
    });

    expect(readSpy).toHaveBeenCalledTimes(1);

    const asked: {
      projectId: ObjectID;
      userIds: Array<ObjectID>;
      props: DatabaseCommonInteractionProps;
    } = readSpy.mock.calls[0]![0] as {
      projectId: ObjectID;
      userIds: Array<ObjectID>;
      props: DatabaseCommonInteractionProps;
    };

    expect(
      asked.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([GRACE.toString(), ALAN.toString()]);
    // The tenant's, never a project the body names.
    expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(asked.props.isRoot).toBeFalsy();
    expect(asked.props.userId?.toString()).toBe(CALLER_ID.toString());
  });

  test("answers nobody when nobody's latest invitation email failed, or the caller may not read the Email Logs", async () => {
    readSpy.mockResolvedValue([]);

    await callRoute({ userIds: [GRACE.toString()] });

    expect(answered()).toEqual({ people: [] });
  });

  test.each([
    ["no list", {}],
    ["a list of something else", { userIds: [42] }],
    ["an id that is not one", { userIds: ["'; DROP TABLE EmailLog; --"] }],
    [
      "more people than a page holds",
      {
        userIds: Array.from(
          { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ + 1 },
          (): string => {
            return ObjectID.generate().toString();
          },
        ),
      },
    ],
  ])(
    "refuses %s, reading nothing",
    async (_case: string, body: Dictionary<unknown>) => {
      const result: { thrownToNext: unknown } = await callRoute(body);

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(readSpy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test("refuses a caller who is no member of the request's project, reading nothing", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        tenantId: PROJECT_ID,
        userId: CALLER_ID,
        userTenantAccessPermission: {},
      });

    const result: { thrownToNext: unknown } = await callRoute({
      userIds: [GRACE.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("refuses a request that names no project, reading nothing", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        userId: CALLER_ID,
        userTenantAccessPermission: {},
      });

    const result: { thrownToNext: unknown } = await callRoute({
      userIds: [GRACE.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("passes on a failure it cannot explain", async () => {
    const failure: Error = new Error("The database went away.");
    readSpy.mockRejectedValue(failure as never);

    const result: { thrownToNext: unknown } = await callRoute({
      userIds: [GRACE.toString()],
    });

    expect(result.thrownToNext).toBe(failure);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
