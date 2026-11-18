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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE,
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
 * POST /team-member/invitation-emails-not-sent-in-projects (#9518): the
 * Admin Dashboard's question of whose latest invitation email was not
 * sent, each pending row's person in the row's own project. Master admins
 * only - the Admin Dashboard works in no project, and only they read
 * every project's Email Logs - read with their own props, once a page.
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

const PROJECT_ID: string = "95210000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "95210000-0000-4000-8000-000000000002";
const GRACE: string = "95210000-0000-4000-8000-000000000003";
const ALAN: string = "95210000-0000-4000-8000-000000000004";
const ADMIN_ID: ObjectID = new ObjectID(
  "95210000-0000-4000-8000-000000000005",
);

function masterAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: ADMIN_ID,
    userType: UserType.MasterAdmin,
    isMasterAdmin: true,
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
    .match("POST", INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
  };
}

function answered(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
}

type InProjectsAsked = {
  invitees: Array<{ projectId: ObjectID; userId: ObjectID }>;
  props: DatabaseCommonInteractionProps;
};

describe("POST /team-member/invitation-emails-not-sent-in-projects", () => {
  let readSpy: SpyInstance<typeof InvitationEmailsNotSent.readInProjects>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new TeamMemberAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(masterAdminProps());

    readSpy = jest
      .spyOn(InvitationEmailsNotSent, "readInProjects")
      .mockResolvedValue([
        {
          projectId: PROJECT_ID,
          userId: GRACE,
          statusMessage: "535 5.7.8 Authentication failed",
        },
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is the Admin Dashboard's own route, for master admins only, who are read as themselves", () => {
    expect(INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE).toBe(
      "/team-member/invitation-emails-not-sent-in-projects",
    );

    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE,
    );

    expect(route.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    ]);
  });

  test("names, with their project, the people whose latest invitation email to it was not sent", async () => {
    await callRoute({
      invitees: [
        { projectId: PROJECT_ID, userId: GRACE },
        { projectId: PROJECT_ID, userId: ALAN },
      ],
    });

    expect(answered()).toEqual({
      invitees: [
        {
          projectId: PROJECT_ID,
          userId: GRACE,
          statusMessage: "535 5.7.8 Authentication failed",
        },
      ],
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  test("reads each pair once, in whatever projects the rows are in, with the master admin's own props", async () => {
    await callRoute({
      invitees: [
        { projectId: PROJECT_ID, userId: GRACE },
        { projectId: OTHER_PROJECT_ID, userId: GRACE },
        { projectId: PROJECT_ID.toUpperCase(), userId: GRACE },
      ],
    });

    expect(readSpy).toHaveBeenCalledTimes(1);

    const asked: InProjectsAsked = readSpy.mock.calls[0]![0] as InProjectsAsked;

    expect(
      asked.invitees.map(
        (invitee: { projectId: ObjectID; userId: ObjectID }): string => {
          return `${invitee.projectId.toString()}/${invitee.userId.toString()}`;
        },
      ),
    ).toEqual([`${PROJECT_ID}/${GRACE}`, `${OTHER_PROJECT_ID}/${GRACE}`]);
    expect(asked.props.isMasterAdmin).toBe(true);
    expect(asked.props.isRoot).toBeFalsy();
    expect(asked.props.userId?.toString()).toBe(ADMIN_ID.toString());
  });

  test.each([
    ["no list", {}],
    ["a list of user ids alone", { invitees: [GRACE] }],
    ["an invitee with no project", { invitees: [{ userId: GRACE }] }],
    [
      "an id that is not one",
      { invitees: [{ projectId: "'; DROP TABLE EmailLog; --", userId: GRACE }] },
    ],
    [
      "more people than a page holds",
      {
        invitees: Array.from(
          { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ + 1 },
          (): Dictionary<string> => {
            return {
              projectId: PROJECT_ID,
              userId: ObjectID.generate().toString(),
            };
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

  test("passes on a failure it cannot explain", async () => {
    const failure: Error = new Error("The database went away.");
    readSpy.mockRejectedValue(failure as never);

    const result: { thrownToNext: unknown } = await callRoute({
      invitees: [{ projectId: PROJECT_ID, userId: GRACE }],
    });

    expect(result.thrownToNext).toBe(failure);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
