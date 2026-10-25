import MarketplaceAPI from "../../../../Server/CloudMarketplace/API/MarketplaceAPI";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "Common/Server/Utils/Express";
import MarketplaceUsageSummarizer from "../../../../Server/CloudMarketplace/MarketplaceUsageSummarizer";
import Response from "Common/Server/Utils/Response";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import {
  MARKETPLACE_USAGE_ROUTE,
  MarketplaceUsageSummary,
} from "Common/Types/Marketplace/MarketplaceUsageSummary";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { PROJECT_USAGE_READ_PERMISSIONS } from "Common/Utils/Project/ProjectBilling";
import { mockRouter } from "Common/Tests/Server/API/Helpers";
import {
  permissionRow,
  tenantPermissionsFor,
} from "Common/Tests/Server/API/PermissionRows";

/*
 * GET /marketplace/usage: what a marketplace-billed project's marketplace
 * bill was made of, month by month, on Settings > Billing. Reading it is
 * reading the project's usage, so it is let in by exactly the permissions
 * that read the usage history (PROJECT_USAGE_READ_PERMISSIONS) - project
 * owners and admins, Manage Billing and the three billing roles. The
 * reports it sums stay master-admin only.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
  };
});
jest.mock(
  "../../../../Server/CloudMarketplace/MarketplaceUsageSummarizer",
  () => {
    return { __esModule: true, default: { getSummary: jest.fn() } };
  },
);
jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
      getPublicRouteUserMiddleware: jest.fn(),
    },
  };
});
jest.mock("Common/Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});
jest.mock("Common/Server/Utils/Response", () => {
  return { __esModule: true, default: { sendJsonObjectResponse: jest.fn() } };
});

const SUMMARY: MarketplaceUsageSummary = {
  marketplace: CloudMarketplace.AWS,
  usageUnitInUSD: 0.01,
  months: [
    {
      month: "2026-10",
      billedUnits: 2200,
      pendingUnits: 30,
      usersInUSD: 20,
      activeMonitorsInUSD: 2,
      telemetryInUSD: 0.3,
      smsOrCallBalanceInUSD: 0,
      aiBalanceInUSD: 0,
    },
  ],
};

describe("GET /marketplace/usage: who reads it", () => {
  const projectId: ObjectID = ObjectID.generate();
  let req: OneUptimeRequest;
  let res: OneUptimeResponse;
  let next: jest.Mock;

  const requestUsage: () => Promise<void> = async (): Promise<void> => {
    await mockRouter
      .match("get", MARKETPLACE_USAGE_ROUTE)
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
    mockRouter.routes = [];
    new MarketplaceAPI();
    res = {} as OneUptimeResponse;
    next = jest.fn();
    jest
      .mocked(MarketplaceUsageSummarizer.getSummary)
      .mockResolvedValue(SUMMARY);
  });

  test("is the route the Billing page asks", () => {
    expect(MARKETPLACE_USAGE_ROUTE).toBe("/marketplace/usage");
    expect(() => {
      return mockRouter.match("get", MARKETPLACE_USAGE_ROUTE);
    }).not.toThrow();
  });

  test("asks the usage history's list: owners, admins, Manage Billing and the billing roles", () => {
    expect([...PROJECT_USAGE_READ_PERMISSIONS].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ManageProjectBilling,
        Permission.BillingAdmin,
        Permission.BillingMember,
        Permission.BillingViewer,
      ].sort(),
    );
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ManageProjectBilling,
    Permission.BillingAdmin,
    Permission.BillingMember,
    Permission.BillingViewer,
  ])(
    "answers a member holding %s with the project's summary",
    async (permission: Permission) => {
      req = holding([Permission.ProjectUser, permission]);

      await requestUsage();

      expect(next).not.toHaveBeenCalled();
      expect(MarketplaceUsageSummarizer.getSummary).toHaveBeenCalledWith(
        projectId,
      );
      expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
        req,
        res,
        SUMMARY,
      );
    },
  );

  test.each([
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.ReadInvoices,
  ])("refuses a member holding only %s", async (permission: Permission) => {
    req = holding([Permission.ProjectUser, permission]);

    await requestUsage();

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "You need Project Owner, Project Admin, Manage Billing or a billing role to view the project's marketplace usage.",
      }),
    );
    expect(MarketplaceUsageSummarizer.getSummary).not.toHaveBeenCalled();
  });

  test("a team's block on the role, with no labels, takes it away", async () => {
    req = holding([
      Permission.ProjectUser,
      Permission.BillingViewer,
      permissionRow(Permission.BillingViewer, { isBlock: true }),
    ]);

    await requestUsage();

    expect(next).toHaveBeenCalled();
    expect(MarketplaceUsageSummarizer.getSummary).not.toHaveBeenCalled();
  });

  test("a master admin reads any project's", async () => {
    req = {
      tenantId: projectId,
      userAuthorization: { isMasterAdmin: true },
    } as unknown as OneUptimeRequest;

    await requestUsage();

    expect(next).not.toHaveBeenCalled();
    expect(MarketplaceUsageSummarizer.getSummary).toHaveBeenCalledWith(
      projectId,
    );
  });
});
