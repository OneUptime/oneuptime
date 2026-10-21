import BillingAPI from "../../../Server/API/BillingAPI";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { PROJECT_CUSTOMER_BALANCE_READ_PERMISSIONS } from "../../../Utils/Project/ProjectBilling";
import { mockRouter } from "./Helpers";
import { permissionRow, tenantPermissionsFor } from "./PermissionRows";

/*
 * GET /billing/customer-balance: the credit the payment provider holds for
 * the project, shown on Settings > Billing. Reading it is billing, so it is
 * the billing roles' as well as a project owner's and Manage Billing's
 * (Utils/Project/ProjectBilling) - Billing Viewer reads every billing page.
 * Anyone else, a project admin included, is refused, as before.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
  };
});
jest.mock("../../../Server/Services/BillingService", () => {
  return {
    __esModule: true,
    default: { getCustomerBalance: jest.fn() },
  };
});
jest.mock("../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});
jest.mock("../../../Server/Services/PayAsYouGoBillingService", () => {
  return { __esModule: true, default: { canUsePayAsYouGo: jest.fn() } };
});
jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});
jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { __esModule: true, default: { sendJsonObjectResponse: jest.fn() } };
});

describe("GET /billing/customer-balance: who reads it", () => {
  const projectId: ObjectID = ObjectID.generate();
  let req: OneUptimeRequest;
  let res: OneUptimeResponse;
  let next: jest.Mock;

  const requestBalance: () => Promise<void> = async (): Promise<void> => {
    await mockRouter
      .match("get", "/billing/customer-balance")
      .handlerFunction(req, res, next as unknown as NextFunction);
  };

  const holding: (
    rows: Parameters<typeof tenantPermissionsFor>[1],
  ) => OneUptimeRequest = (
    rows: Parameters<typeof tenantPermissionsFor>[1],
  ): OneUptimeRequest => {
    return {
      tenantId: projectId,
      userTenantAccessPermission: tenantPermissionsFor(projectId, rows),
    } as OneUptimeRequest;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    new BillingAPI();
    res = {} as OneUptimeResponse;
    next = jest.fn();
    jest.mocked(ProjectService.findOneById).mockResolvedValue(
      Object.assign(new Project(), {
        _id: projectId.toString(),
        paymentProviderCustomerId: "cus_balance_project",
      }),
    );
    jest.mocked(BillingService.getCustomerBalance).mockResolvedValue(-1250);
  });

  test("the route asks the shared list: owners, Manage Billing and the three billing roles", () => {
    expect([...PROJECT_CUSTOMER_BALANCE_READ_PERMISSIONS].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ManageProjectBilling,
        Permission.BillingAdmin,
        Permission.BillingMember,
        Permission.BillingViewer,
      ].sort(),
    );
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ManageProjectBilling,
    Permission.BillingAdmin,
    Permission.BillingMember,
    Permission.BillingViewer,
  ])("answers a member holding %s", async (permission: Permission) => {
    req = holding([Permission.ProjectUser, permission]);

    await requestBalance();

    expect(next).not.toHaveBeenCalled();
    expect(BillingService.getCustomerBalance).toHaveBeenCalledWith(
      "cus_balance_project",
    );
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, {
      balance: -1250,
    });
  });

  test.each([
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
  ])("refuses a member holding only %s", async (permission: Permission) => {
    req = holding([Permission.ProjectUser, permission]);

    await requestBalance();

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "You need Project Owner, Manage Billing or a billing role to view the billing balance.",
      }),
    );
    expect(BillingService.getCustomerBalance).not.toHaveBeenCalled();
  });

  test("a team's block on Billing Viewer, with no labels, takes it away", async () => {
    req = holding([
      Permission.ProjectUser,
      Permission.BillingViewer,
      permissionRow(Permission.BillingViewer, { isBlock: true }),
    ]);

    await requestBalance();

    expect(next).toHaveBeenCalled();
    expect(BillingService.getCustomerBalance).not.toHaveBeenCalled();
  });

  test("a block row alone is no grant", async () => {
    req = holding([
      Permission.ProjectUser,
      permissionRow(Permission.BillingMember, { isBlock: true }),
    ]);

    await requestBalance();

    expect(next).toHaveBeenCalled();
    expect(BillingService.getCustomerBalance).not.toHaveBeenCalled();
  });
});
