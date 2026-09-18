import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import WorkspaceNotificationRuleAPI from "../../../Server/API/WorkspaceNotificationRuleAPI";
import MonitorService from "../../../Server/Services/MonitorService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
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
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Both routes covered here are custom (non-CRUD) routes mounted with only
 * UserMiddleware.getUserMiddleware, which lets unauthenticated requests
 * through as "public" and takes the project from a caller-supplied
 * `tenantid` header. The work they trigger runs as root:
 *
 * - /workspace-notification-rule/test/:id loads the rule as root, takes the
 *   project from the rule itself, and posts a test message into that
 *   project's Slack / Teams channels (it can even create channels).
 * - /monitor/refresh-status/:id reads and writes the monitor as root.
 *
 * So each route has to prove two things itself: the caller is an
 * authenticated member of the project it claimed, AND the resource in the
 * path belongs to that same project. Checking only the first would let a
 * member of project A send their own tenant header while targeting project
 * B's resource id.
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
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const MONITOR_REFRESH_ROUTE: string = "/monitor/refresh-status/:monitorId";
const TEST_RULE_ROUTE: string =
  "/workspace-notification-rule/test/:workspaceNotifcationRuleId";

function buildMemberProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): DatabaseCommonInteractionProps {
  const memberPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: [],
  };

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: [memberPermission],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userTenantAccessPermission: permissionMap,
  };
}

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

async function callGetRoute(data: {
  uri: string;
  params: Dictionary<string>;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: data.params,
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
    .match("GET", data.uri)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

describe("Project-scoped custom routes require an authenticated member of the resource's project", () => {
  let callerProjectId: ObjectID;
  let otherProjectId: ObjectID;
  let callerUserId: ObjectID;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new MonitorAPI();
    new WorkspaceNotificationRuleAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    callerProjectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    callerUserId = ObjectID.generate();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("GET /monitor/refresh-status/:monitorId", () => {
    let monitorId: ObjectID;
    let refreshSpy: jest.SpyInstance;
    let findOneByIdSpy: jest.SpyInstance;

    function mockProps(props: DatabaseCommonInteractionProps): void {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(props);
    }

    function mockMonitorInProject(projectId: ObjectID | null): void {
      if (!projectId) {
        findOneByIdSpy.mockResolvedValue(null);
        return;
      }

      const monitor: Monitor = new Monitor();
      monitor.id = monitorId;
      monitor.projectId = projectId;
      findOneByIdSpy.mockResolvedValue(monitor);
    }

    beforeEach(() => {
      monitorId = ObjectID.generate();
      findOneByIdSpy = jest.spyOn(MonitorService, "findOneById");
      refreshSpy = jest
        .spyOn(MonitorService, "refreshMonitorCurrentStatus")
        .mockResolvedValue(undefined);
    });

    test("refreshes the monitor for a member of the monitor's own project", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockMonitorInProject(callerProjectId);

      const result: RouteCallResult = await callGetRoute({
        uri: MONITOR_REFRESH_ROUTE,
        params: { monitorId: monitorId.toString() },
      });

      expect(result.nextCallCount).toBe(0);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect((refreshSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
        monitorId.toString(),
      );
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    });

    /*
     * The owning project has to come off the monitor row, not off the
     * caller-supplied header — pin the read that derives it.
     */
    test("derives the owning project from the monitor row itself", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockMonitorInProject(callerProjectId);

      await callGetRoute({
        uri: MONITOR_REFRESH_ROUTE,
        params: { monitorId: monitorId.toString() },
      });

      expect(findOneByIdSpy).toHaveBeenCalledTimes(1);
      const readArgs: {
        id: ObjectID;
        select: Dictionary<boolean>;
        props: Dictionary<boolean>;
      } = findOneByIdSpy.mock.calls[0]![0] as {
        id: ObjectID;
        select: Dictionary<boolean>;
        props: Dictionary<boolean>;
      };
      expect(readArgs.id.toString()).toBe(monitorId.toString());
      expect(readArgs.select["projectId"]).toBe(true);
      expect(readArgs.props["isRoot"]).toBe(true);
    });

    test("rejects an unauthenticated caller with BadDataException and never reads the monitor", async () => {
      mockProps({});

      const result: RouteCallResult = await callGetRoute({
        uri: MONITOR_REFRESH_ROUTE,
        params: { monitorId: monitorId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    test("rejects a public caller that supplies a tenant header it is not a member of", async () => {
      mockProps({
        tenantId: callerProjectId,
        userId: undefined,
        userTenantAccessPermission: undefined,
      });

      const result: RouteCallResult = await callGetRoute({
        uri: MONITOR_REFRESH_ROUTE,
        params: { monitorId: monitorId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    test("rejects a member of one project targeting another project's monitor id", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockMonitorInProject(otherProjectId);

      const result: RouteCallResult = await callGetRoute({
        uri: MONITOR_REFRESH_ROUTE,
        params: { monitorId: monitorId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    test("rejects a monitor id that does not exist", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockMonitorInProject(null);

      const result: RouteCallResult = await callGetRoute({
        uri: MONITOR_REFRESH_ROUTE,
        params: { monitorId: monitorId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });

  describe("GET /workspace-notification-rule/test/:workspaceNotifcationRuleId", () => {
    let ruleId: ObjectID;
    let testRuleSpy: jest.SpyInstance;
    let findOneByIdSpy: jest.SpyInstance;

    function mockProps(props: DatabaseCommonInteractionProps): void {
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(props);
    }

    function mockRuleInProject(projectId: ObjectID | null): void {
      if (!projectId) {
        findOneByIdSpy.mockResolvedValue(null);
        return;
      }

      const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
      rule.id = ruleId;
      rule.projectId = projectId;
      findOneByIdSpy.mockResolvedValue(rule);
    }

    beforeEach(() => {
      ruleId = ObjectID.generate();
      findOneByIdSpy = jest.spyOn(
        WorkspaceNotificationRuleService,
        "findOneById",
      );
      testRuleSpy = jest
        .spyOn(WorkspaceNotificationRuleService, "testRule")
        .mockResolvedValue(undefined);
    });

    test("tests the rule for a member of the rule's own project", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockRuleInProject(callerProjectId);

      const result: RouteCallResult = await callGetRoute({
        uri: TEST_RULE_ROUTE,
        params: { workspaceNotifcationRuleId: ruleId.toString() },
      });

      expect(result.nextCallCount).toBe(0);
      expect(testRuleSpy).toHaveBeenCalledTimes(1);

      const testRuleArgs: {
        ruleId: ObjectID;
        projectId: ObjectID;
        testByUserId: ObjectID;
      } = testRuleSpy.mock.calls[0]![0] as {
        ruleId: ObjectID;
        projectId: ObjectID;
        testByUserId: ObjectID;
      };
      expect(testRuleArgs.ruleId.toString()).toBe(ruleId.toString());
      expect(testRuleArgs.projectId.toString()).toBe(
        callerProjectId.toString(),
      );
      expect(testRuleArgs.testByUserId.toString()).toBe(
        callerUserId.toString(),
      );
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    });

    test("rejects an unauthenticated caller with BadDataException and never reads the rule", async () => {
      mockProps({});

      const result: RouteCallResult = await callGetRoute({
        uri: TEST_RULE_ROUTE,
        params: { workspaceNotifcationRuleId: ruleId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(testRuleSpy).not.toHaveBeenCalled();
    });

    test("rejects a public caller that supplies a tenant header it is not a member of", async () => {
      mockProps({
        tenantId: callerProjectId,
        userId: undefined,
        userTenantAccessPermission: undefined,
      });

      const result: RouteCallResult = await callGetRoute({
        uri: TEST_RULE_ROUTE,
        params: { workspaceNotifcationRuleId: ruleId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(testRuleSpy).not.toHaveBeenCalled();
    });

    /*
     * testRule overwrites the project it is handed with the rule's own
     * projectId, so a member of project A targeting project B's rule id
     * would otherwise get a test message posted into project B's Slack /
     * Teams channels.
     */
    test("rejects a member of one project targeting another project's rule id", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockRuleInProject(otherProjectId);

      const result: RouteCallResult = await callGetRoute({
        uri: TEST_RULE_ROUTE,
        params: { workspaceNotifcationRuleId: ruleId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(testRuleSpy).not.toHaveBeenCalled();
    });

    test("rejects a rule id that does not exist", async () => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockRuleInProject(null);

      const result: RouteCallResult = await callGetRoute({
        uri: TEST_RULE_ROUTE,
        params: { workspaceNotifcationRuleId: ruleId.toString() },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(testRuleSpy).not.toHaveBeenCalled();
    });
  });
});
