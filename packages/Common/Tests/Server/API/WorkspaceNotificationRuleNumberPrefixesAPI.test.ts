import Project from "../../../Models/DatabaseModels/Project";
import CommonAPI from "../../../Server/API/CommonAPI";
import WorkspaceNotificationRuleAPI, {
  RULE_NUMBER_PREFIXES_PERMISSION_MESSAGE,
} from "../../../Server/API/WorkspaceNotificationRuleAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
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
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  NUMBER_PREFIX_COLUMN_BY_EVENT_TYPE,
  WorkspaceChannelNumberPrefixes,
} from "../../../Utils/Workspace/WorkspaceChannelName";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * GET /workspace-notification-rule/number-prefixes
 *
 * The rule form previews the name of the channel a rule creates - incident
 * INC-42's channel is inc-42, prod-inc-42 with a prefix - and needs the
 * project's number prefixes for it. A Settings Member edits rules without
 * reading the project's settings, so the route reads them as OneUptime,
 * after asking what the CRUD read of rules asks: an authenticated member of
 * the tenant who may read its notification rules, team blocks counted. It
 * answers only the tenant's own project, and is never cached.
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
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const ROUTE: string = "/workspace-notification-rule/number-prefixes";

function buildProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  blocks?: Array<Permission> | undefined;
}): DatabaseCommonInteractionProps {
  const grants: Array<UserPermission> = [
    ...data.permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
    ...(data.blocks || []).map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ];

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: grants,
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  res: ExpressResponse;
}

async function callRoute(): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("GET", ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

const PREFIXES: WorkspaceChannelNumberPrefixes = {
  [NotificationRuleEventType.Incident]: "INC-",
  [NotificationRuleEventType.Alert]: "ALT-",
  [NotificationRuleEventType.IncidentEpisode]: "IE-",
  [NotificationRuleEventType.AlertEpisode]: null,
  [NotificationRuleEventType.ScheduledMaintenance]: "SM-",
};

describe("GET /workspace-notification-rule/number-prefixes", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let propsSpy: jest.SpyInstance;
  let prefixesSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new WorkspaceNotificationRuleAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    prefixesSpy = jest
      .spyOn(WorkspaceNotificationRuleService, "getRecordNumberPrefixes")
      .mockResolvedValue(PREFIXES);

    mockCaller([Permission.SettingsMember]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockCaller(
    permissions: Array<Permission>,
    blocks?: Array<Permission>,
  ): void {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: userId,
        permissions: permissions,
        blocks: blocks,
      }),
    );
  }

  function sentBody(): JSONObject {
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    return (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]![2] as JSONObject;
  }

  function expectNothingRead(): void {
    expect(prefixesSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  test("is mounted behind getUserMiddleware", () => {
    expect(mockRouter.match("GET", ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  test("gives a Settings Member the tenant's number prefixes, uncached", async () => {
    const result: RouteCallResult = await callRoute();

    expect(result.nextCallCount).toBe(0);
    expect(prefixesSpy).toHaveBeenCalledTimes(1);
    expect((prefixesSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
    expect(sentBody()).toEqual({ numberPrefixes: PREFIXES });
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsViewer,
    Permission.ReadWorkspaceNotificationRule,
  ])("answers a %s", async (permission: Permission) => {
    mockCaller([permission]);

    const result: RouteCallResult = await callRoute();

    expect(result.nextCallCount).toBe(0);
    expect(prefixesSpy).toHaveBeenCalledTimes(1);
  });

  test("refuses an unauthenticated caller before reading anything", async () => {
    propsSpy.mockResolvedValue({});

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expectNothingRead();
  });

  test("refuses a caller with no project before reading anything", async () => {
    propsSpy.mockResolvedValue({ userId: userId, userType: UserType.User });

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Exception).message).toBe(
      "Project ID is required",
    );
    expectNothingRead();
  });

  test("refuses someone who is not a member of the project they named", async () => {
    const props: DatabaseCommonInteractionProps = buildProps({
      projectId: ObjectID.generate(),
      userId: userId,
      permissions: [Permission.ProjectOwner],
    });
    props.tenantId = projectId;
    propsSpy.mockResolvedValue(props);

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingRead();
  });

  test("refuses a member who may not read notification rules", async () => {
    mockCaller([Permission.ReadProjectIncident]);

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(
      RULE_NUMBER_PREFIXES_PERMISSION_MESSAGE,
    );
    expectNothingRead();
  });

  test("refuses a member whose team is blocked from reading notification rules", async () => {
    mockCaller(
      [Permission.ReadWorkspaceNotificationRule],
      [Permission.ReadWorkspaceNotificationRule],
    );

    const result: RouteCallResult = await callRoute();

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNothingRead();
  });
});

describe("WorkspaceNotificationRuleService.getRecordNumberPrefixes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the five prefix columns of the project as OneUptime, null for none", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const project: Project = new Project();
    project.incidentNumberPrefix = "INC-";
    project.alertNumberPrefix = "";
    project.incidentEpisodeNumberPrefix = "IE-";
    project.scheduledMaintenanceNumberPrefix = "SM-";

    const findSpy: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project);

    expect(
      await WorkspaceNotificationRuleService.getRecordNumberPrefixes(projectId),
    ).toEqual({
      [NotificationRuleEventType.Incident]: "INC-",
      [NotificationRuleEventType.Alert]: null,
      [NotificationRuleEventType.IncidentEpisode]: "IE-",
      [NotificationRuleEventType.AlertEpisode]: null,
      [NotificationRuleEventType.ScheduledMaintenance]: "SM-",
    });

    expect(findSpy).toHaveBeenCalledTimes(1);

    const call: {
      id: ObjectID;
      select: Record<string, boolean>;
      props: { isRoot?: boolean };
    } = findSpy.mock.calls[0]![0] as {
      id: ObjectID;
      select: Record<string, boolean>;
      props: { isRoot?: boolean };
    };

    expect(call.id.toString()).toBe(projectId.toString());
    expect(call.props).toEqual({ isRoot: true });
    expect(Object.keys(call.select).sort()).toEqual(
      Object.values(NUMBER_PREFIX_COLUMN_BY_EVENT_TYPE).sort(),
    );
  });

  test("a project that is gone is refused", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);

    await expect(
      WorkspaceNotificationRuleService.getRecordNumberPrefixes(
        ObjectID.generate(),
      ),
    ).rejects.toThrow("Project not found");
  });
});
