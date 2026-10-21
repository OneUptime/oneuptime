import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import ActiveMonitorLimit from "../../../Server/Utils/Billing/ActiveMonitorLimit";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

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
    setNoCacheHeaders: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

// The refusal below is deliberate; @CaptureSpan logs its stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * POST /monitor - THE PUBLIC API'S CREATE, AND SO TERRAFORM'S AND THE MCP
 * SERVER'S - AT THE PROJECT'S ACTIVE MONITOR LIMIT.
 *
 * The support report: a project with a plan of 500 active monitors (bought
 * from a reseller) had 2,881. The API's create goes through the same
 * MonitorService.create as the dashboard's form, so it is refused there in
 * the limit's own words, which the API hands back as its error (a 400 Bad
 * Data, the message as written) for a script, `terraform apply` or an MCP
 * client to show. Nothing is written.
 */

const ROUTE: string = "/monitor";

function adminProps(projectId: ObjectID): DatabaseCommonInteractionProps {
  const grant: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectAdmin,
    labelIds: [],
    isBlockPermission: false,
  };

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [grant],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[projectId.toString()] = tenantPermission;

  return {
    tenantId: projectId,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

describe("POST /monitor at the project's active monitor limit", () => {
  let projectId: ObjectID;
  let monitors: ReturnType<typeof useInMemoryTable>;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new MonitorAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setTestBillingEnabled(true);

    projectId = ObjectID.generate();
    monitors = useInMemoryTable(MonitorService, []);

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(adminProps(projectId));
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      activeMonitorsLimit: 500,
    });
    jest
      .spyOn(ActiveMonitorLimit, "countActiveMonitors")
      .mockResolvedValue(500);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true);
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(MonitorService, "validateDependencyConfiguration")
      .mockResolvedValue(undefined);
    const status: MonitorStatus = new MonitorStatus();
    status.id = ObjectID.generate();
    jest.spyOn(MonitorStatusService, "findOneBy").mockResolvedValue(status);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setTestBillingEnabled(false);
  });

  async function post(monitorType: MonitorType): Promise<unknown> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      headers: {},
      body: {
        data: {
          name: "Checkout API",
          monitorType: monitorType,
        },
      },
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    const next: jest.Mock = jest.fn();

    await mockRouter
      .match("POST", ROUTE)
      .handlerFunction(req, res, next as unknown as NextFunction);

    return next.mock.calls[0] ? next.mock.calls[0][0] : undefined;
  }

  test("an active monitor is refused with a 400 in the limit's own words, and nothing is written", async () => {
    const error: unknown = await post(MonitorType.Website);

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).code).toBe(400);
    expect((error as BadDataException).message).toBe(
      "This project has reached its plan's limit of 500 active monitors, so no more can be added. Delete monitors you no longer need, or change the plan in Project Settings > Billing and Invoices > Billing. Manual monitors do not count towards the limit; monitors that are turned off or archived do.",
    );
    expect(Response.sendEntityResponse).not.toHaveBeenCalled();
    expect(monitors.inserts).toEqual([]);
  });

  test("the count is the project the request names as its tenant", async () => {
    await post(MonitorType.Website);

    expect(ActiveMonitorLimit.countActiveMonitors).toHaveBeenCalledWith({
      projectId: projectId,
    });
  });

  test("a Manual monitor is not held to the limit: nothing is counted for it", async () => {
    await post(MonitorType.Manual);

    expect(ActiveMonitorLimit.countActiveMonitors).not.toHaveBeenCalled();
  });
});
