import CommonAPI from "../../../Server/API/CommonAPI";
import WorkspaceUserGroupAPI, {
  USER_GROUP_PERMISSION_MESSAGE,
} from "../../../Server/API/WorkspaceUserGroupAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import BillingPermissions from "../../../Server/Types/Database/Permissions/BillingPermission";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import WorkspaceUserGroupManager from "../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupManager";
import WorkspaceUserGroup from "../../../Models/DatabaseModels/WorkspaceUserGroup";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceUserGroupView } from "../../../Types/Workspace/WorkspaceUserGroup";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * THE ROUTES THE SCHEDULE PAGE'S USER GROUP CARD CALLS
 * (WorkspaceUserGroupAPI), as Express runs them: who may call each, and
 * what reaches WorkspaceUserGroupManager. Each is mounted behind the user
 * middleware and requireUserAuthentication, answers somebody with no
 * credentials 401 (so the Dashboard refreshes an expired session), and
 * works for one project only: the caller's, with their permissions. The
 * three that change a group in Slack or Microsoft Teams - and the list the
 * Connect form reads before it does - ask what creating a group asks.
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
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "a1000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("a1000000-0000-4000-8000-000000000002");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "a1000000-0000-4000-8000-000000000003",
);
const GROUP_ID: ObjectID = new ObjectID("a1000000-0000-4000-8000-000000000004");

const VIEW: WorkspaceUserGroupView = {
  workspaceUserGroupId: GROUP_ID.toString(),
  workspaceType: WorkspaceType.Slack,
  name: "Payments on-call",
  handle: "payments-oncall",
  teamName: null,
  schedules: [],
  members: [],
  leftOut: [],
  isTurnedOff: false,
  problem: null,
  problemDetail: null,
  syncedAt: null,
  checkedAt: null,
};

function propsWith(permission: Permission): DatabaseCommonInteractionProps {
  const granted: UserPermission = {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
  };

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [granted],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[PROJECT_ID.toString()] = tenantPermission;

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: permissionMap,
  };
}

interface RouteResult {
  thrown: unknown;
}

async function call(data: {
  method: "GET" | "POST";
  uri: string;
  params?: Dictionary<string> | undefined;
  query?: JSONObject | undefined;
  body?: JSONObject | undefined;
}): Promise<RouteResult> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: data.query || {},
    body: data.body || {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match(data.method, data.uri)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return { thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined };
}

function callerIs(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

const ROUTES: Array<{ method: "GET" | "POST"; uri: string }> = [
  { method: "GET", uri: "/workspace-user-group/schedule/:scheduleId" },
  { method: "GET", uri: "/workspace-user-group/available" },
  { method: "POST", uri: "/workspace-user-group/connect" },
  { method: "POST", uri: "/workspace-user-group/disconnect" },
  { method: "POST", uri: "/workspace-user-group/sync/:workspaceUserGroupId" },
];

describe("the on-call user group routes", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new WorkspaceUserGroupAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("each is mounted behind the user middleware and requireUserAuthentication", () => {
    for (const route of ROUTES) {
      expect(mockRouter.match(route.method, route.uri).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    }
  });

  test("somebody with no credentials is told to sign in (401), and nothing is read", async () => {
    callerIs({ tenantId: PROJECT_ID } as DatabaseCommonInteractionProps);
    const views: jest.SpyInstance = jest.spyOn(
      WorkspaceUserGroupManager,
      "getViewsForSchedule",
    );

    for (const route of ROUTES) {
      const result: RouteResult = await call({
        method: route.method,
        uri: route.uri,
        params: {
          scheduleId: SCHEDULE_ID.toString(),
          workspaceUserGroupId: GROUP_ID.toString(),
        },
        query: { workspaceType: WorkspaceType.Slack },
      });

      expect(result.thrown).toBeInstanceOf(NotAuthenticatedException);
    }

    expect(views).not.toHaveBeenCalled();
  });

  test("the card's groups: read with the caller's props, in their project only", async () => {
    callerIs(propsWith(Permission.Viewer));
    const views: jest.SpyInstance = jest
      .spyOn(WorkspaceUserGroupManager, "getViewsForSchedule")
      .mockResolvedValue([VIEW]);

    const result: RouteResult = await call({
      method: "GET",
      uri: "/workspace-user-group/schedule/:scheduleId",
      params: { scheduleId: SCHEDULE_ID.toString() },
    });

    expect(result.thrown).toBeUndefined();
    expect(views).toHaveBeenCalledTimes(1);

    const asked: {
      scheduleId: ObjectID;
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = views.mock.calls[0]![0];

    expect(asked.scheduleId.toString()).toBe(SCHEDULE_ID.toString());
    expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(asked.props.userId?.toString()).toBe(USER_ID.toString());
    expect(asked.props.isMultiTenantRequest).toBe(false);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { userGroups: [VIEW] },
    );
  });

  test("a schedule id that is not one is refused", async () => {
    callerIs(propsWith(Permission.Viewer));

    const result: RouteResult = await call({
      method: "GET",
      uri: "/workspace-user-group/schedule/:scheduleId",
      params: { scheduleId: "not-an-id" },
    });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect((result.thrown as Error).message).toBe(
      "A valid scheduleId is required.",
    );
  });

  test("a viewer may see the groups but not change them, nor list the workspace's groups", async () => {
    callerIs(propsWith(Permission.Viewer));
    const connect: jest.SpyInstance = jest.spyOn(
      WorkspaceUserGroupManager,
      "connect",
    );

    for (const route of ROUTES.slice(1)) {
      const result: RouteResult = await call({
        method: route.method,
        uri: route.uri,
        params: { workspaceUserGroupId: GROUP_ID.toString() },
        query: { workspaceType: WorkspaceType.Slack },
        body: {
          onCallDutyPolicyScheduleId: SCHEDULE_ID.toString(),
          workspaceType: WorkspaceType.Slack,
          workspaceUserGroupId: GROUP_ID.toString(),
        },
      });

      expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrown as Error).message).toBe(
        USER_GROUP_PERMISSION_MESSAGE,
      );
    }

    expect(connect).not.toHaveBeenCalled();
  });

  test("those that change a group ask the plan creating one is on", async () => {
    callerIs(propsWith(Permission.ProjectMember));
    const plan: jest.SpyInstance = jest.spyOn(
      BillingPermissions,
      "checkFeatureIsOnPlan",
    );
    jest
      .spyOn(WorkspaceUserGroupManager, "connect")
      .mockResolvedValue(VIEW);

    await call({
      method: "POST",
      uri: "/workspace-user-group/connect",
      body: {
        onCallDutyPolicyScheduleId: SCHEDULE_ID.toString(),
        workspaceType: WorkspaceType.Slack,
        workspaceGroupId: "S0604QSJC",
      },
    });

    expect(plan).toHaveBeenCalledWith(
      WorkspaceUserGroup,
      expect.objectContaining({ tenantId: PROJECT_ID }),
      DatabaseRequestType.Create,
    );
  });

  test("Connect: what the form sent - only what it may send, trimmed - reaches the manager", async () => {
    callerIs(propsWith(Permission.ProjectMember));
    const connect: jest.SpyInstance = jest
      .spyOn(WorkspaceUserGroupManager, "connect")
      .mockResolvedValue(VIEW);

    const result: RouteResult = await call({
      method: "POST",
      uri: "/workspace-user-group/connect",
      body: {
        onCallDutyPolicyScheduleId: ` ${SCHEDULE_ID.toString()} `,
        workspaceType: WorkspaceType.Slack,
        newGroupName: " Payments on-call ",
        newGroupHandle: "payments-oncall",
        workspaceGroupId: "",
        projectId: "a1000000-0000-4000-8000-0000000000ff",
        isRoot: true,
      },
    });

    expect(result.thrown).toBeUndefined();
    expect(connect.mock.calls[0]![0].request).toEqual({
      onCallDutyPolicyScheduleId: SCHEDULE_ID.toString(),
      workspaceType: WorkspaceType.Slack,
      newGroupName: "Payments on-call",
      newGroupHandle: "payments-oncall",
    });
    expect(connect.mock.calls[0]![0].projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { userGroup: VIEW },
    );
  });

  test("Connect: a workspace that is not Slack or Microsoft Teams is refused", async () => {
    callerIs(propsWith(Permission.ProjectMember));

    const result: RouteResult = await call({
      method: "POST",
      uri: "/workspace-user-group/connect",
      body: {
        onCallDutyPolicyScheduleId: SCHEDULE_ID.toString(),
        workspaceType: "Discord",
      },
    });

    expect((result.thrown as Error).message).toBe(
      "workspaceType must be Slack or MicrosoftTeams.",
    );
  });

  test("the Connect form's list: for the workspace asked, and a team when one is picked", async () => {
    callerIs(propsWith(Permission.OnCallMember));
    const available: jest.SpyInstance = jest
      .spyOn(WorkspaceUserGroupManager, "getAvailable")
      .mockResolvedValue({ groups: [], teams: [] });

    await call({
      method: "GET",
      uri: "/workspace-user-group/available",
      query: {
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: "team-1",
      },
    });

    expect(available.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: "team-1",
      }),
    );
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { groups: [], teams: [] },
    );
  });

  test("Disconnect: needs both ids, then reaches the manager", async () => {
    callerIs(propsWith(Permission.EditProjectOnCallDutyPolicySchedule));
    const disconnect: jest.SpyInstance = jest
      .spyOn(WorkspaceUserGroupManager, "disconnect")
      .mockResolvedValue(undefined);

    const refused: RouteResult = await call({
      method: "POST",
      uri: "/workspace-user-group/disconnect",
      body: { onCallDutyPolicyScheduleId: SCHEDULE_ID.toString() },
    });

    expect((refused.thrown as Error).message).toBe(
      "A valid workspaceUserGroupId is required.",
    );

    const result: RouteResult = await call({
      method: "POST",
      uri: "/workspace-user-group/disconnect",
      body: {
        onCallDutyPolicyScheduleId: SCHEDULE_ID.toString(),
        workspaceUserGroupId: GROUP_ID.toString(),
      },
    });

    expect(result.thrown).toBeUndefined();
    expect(disconnect.mock.calls[0]![0].workspaceUserGroupId.toString()).toBe(
      GROUP_ID.toString(),
    );
    expect(disconnect.mock.calls[0]![0].scheduleId.toString()).toBe(
      SCHEDULE_ID.toString(),
    );
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  test("Try again: the group in the path, the card's schedule when it sent one", async () => {
    callerIs(propsWith(Permission.OnCallAdmin));
    const syncAgain: jest.SpyInstance = jest
      .spyOn(WorkspaceUserGroupManager, "syncAgain")
      .mockResolvedValue(VIEW);

    await call({
      method: "POST",
      uri: "/workspace-user-group/sync/:workspaceUserGroupId",
      params: { workspaceUserGroupId: GROUP_ID.toString() },
      body: { onCallDutyPolicyScheduleId: SCHEDULE_ID.toString() },
    });

    await call({
      method: "POST",
      uri: "/workspace-user-group/sync/:workspaceUserGroupId",
      params: { workspaceUserGroupId: GROUP_ID.toString() },
      body: { onCallDutyPolicyScheduleId: "nope" },
    });

    expect(syncAgain.mock.calls[0]![0].scheduleId.toString()).toBe(
      SCHEDULE_ID.toString(),
    );
    expect(syncAgain.mock.calls[1]![0].scheduleId).toBeNull();
  });
});
