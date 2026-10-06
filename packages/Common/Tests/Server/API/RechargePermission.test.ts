import { MockFunction } from "../../MockType";
import { mockRouter } from "./Helpers";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import AIBillingService from "../../../Server/Services/AIBillingService";
import NotificationService from "../../../Server/Services/NotificationService";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { NOTIFICATION_RECHARGE_PERMISSIONS } from "../../../Server/API/NotificationAPI";
import { AI_RECHARGE_PERMISSIONS } from "../../../Server/API/AIBillingAPI";
import BadDataException from "../../../Types/Exception/BadDataException";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";

/*
 * Adding SMS / call balance and adding AI credits both charge the project's
 * card. Each route asks whether the caller holds Project Owner or Manage
 * Project Billing in the project the body names, by the rule every
 * permission check follows (CallerPermission): a team's block row is no
 * grant, a block with no labels on either takes the permission away, and a
 * block with labels - which restricts labelled records - does not refuse a
 * route that touches none.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
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
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
    },
  };
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
jest.mock("../../../Server/Services/NotificationService", () => {
  return { __esModule: true, default: { rechargeBalance: jest.fn() } };
});
jest.mock("../../../Server/Services/AIBillingService", () => {
  return { __esModule: true, default: { rechargeBalance: jest.fn() } };
});

const LABEL: ObjectID = new ObjectID("6f1d6c39-0a8e-4f4a-9e43-0d8d4fb0a003");

type RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [LABEL] : [],
    isBlockPermission: Boolean(options?.isBlock),
  };
};

interface RechargeRoute {
  name: string;
  uri: string;
  rechargeBalance: MockFunction;
}

const ROUTES: Array<RechargeRoute> = [
  {
    name: "SMS and call balance",
    uri: "/notification/recharge",
    rechargeBalance:
      NotificationService.rechargeBalance as unknown as MockFunction,
  },
  {
    name: "AI credits",
    uri: "/ai/recharge",
    rechargeBalance:
      AIBillingService.rechargeBalance as unknown as MockFunction,
  },
];

const sendErrorResponse: MockFunction =
  Response.sendErrorResponse as unknown as MockFunction;
const sendEmptySuccessResponse: MockFunction =
  Response.sendEmptySuccessResponse as unknown as MockFunction;

describe("Recharge routes: who may add balance", () => {
  const projectId: ObjectID = ObjectID.generate();

  type CallFunction = (
    route: RechargeRoute,
    rows: Array<UserPermission>,
    options?: { rowsForProject?: ObjectID },
  ) => Promise<void>;

  const call: CallFunction = async (
    route: RechargeRoute,
    rows: Array<UserPermission>,
    options?: { rowsForProject?: ObjectID },
  ): Promise<void> => {
    const rowsForProject: ObjectID = options?.rowsForProject || projectId;

    const req: OneUptimeRequest = {
      body: {
        amount: 25,
        projectId: JSONFunctions.serializeValue(projectId),
      },
      userTenantAccessPermission: {
        [rowsForProject.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: rowsForProject,
          permissions: rows,
        },
      },
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        globalPermissions: [Permission.Public, Permission.User],
        projectIds: [rowsForProject],
      },
    } as unknown as OneUptimeRequest;

    await mockRouter
      .match("post", route.uri)
      .handlerFunction(
        req,
        {} as OneUptimeResponse,
        jest.fn() as unknown as NextFunction,
      );
  };

  type RefusalFunction = () => string | undefined;

  const refusal: RefusalFunction = (): string | undefined => {
    const error: unknown = sendErrorResponse.mock.calls[0]?.[2];

    return error instanceof BadDataException ? error.message : undefined;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("both routes ask for Project Owner or Manage Project Billing", () => {
    expect(NOTIFICATION_RECHARGE_PERMISSIONS).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
    expect(AI_RECHARGE_PERMISSIONS).toEqual(NOTIFICATION_RECHARGE_PERMISSIONS);
  });

  describe.each(ROUTES)("$name ($uri)", (route: RechargeRoute) => {
    test("a grant of Manage Project Billing recharges", async () => {
      await call(route, [row(Permission.ManageProjectBilling)]);

      expect(route.rechargeBalance).toHaveBeenCalledTimes(1);
      expect(String(route.rechargeBalance.mock.calls[0]?.[0])).toBe(
        projectId.toString(),
      );
      expect(route.rechargeBalance.mock.calls[0]?.[1]).toBe(25);
      expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    });

    test("a grant of Project Owner recharges", async () => {
      await call(route, [row(Permission.ProjectOwner)]);

      expect(route.rechargeBalance).toHaveBeenCalledTimes(1);
    });

    test("a grantee whose only row is a block with no labels is refused", async () => {
      await call(route, [
        row(Permission.ManageProjectBilling, { isBlock: true }),
      ]);

      expect(route.rechargeBalance).not.toHaveBeenCalled();
      expect(refusal()).toContain("does not have permission to recharge");
    });

    test("a grantee whose only row is a block with labels is refused", async () => {
      await call(route, [
        row(Permission.ManageProjectBilling, {
          isBlock: true,
          labelled: true,
        }),
      ]);

      expect(route.rechargeBalance).not.toHaveBeenCalled();
      expect(refusal()).toContain("does not have permission to recharge");
    });

    test("a grant and a block with no labels from another team: refused", async () => {
      await call(route, [
        row(Permission.ManageProjectBilling),
        row(Permission.ManageProjectBilling, { isBlock: true }),
      ]);

      expect(route.rechargeBalance).not.toHaveBeenCalled();
      expect(refusal()).toContain("does not have permission to recharge");
    });

    test("a block with no labels on the other accepted permission refuses too", async () => {
      await call(route, [
        row(Permission.ManageProjectBilling),
        row(Permission.ProjectOwner, { isBlock: true }),
      ]);

      expect(route.rechargeBalance).not.toHaveBeenCalled();
    });

    test("a grant and a block with labels: the route touches no labelled record, so it recharges", async () => {
      await call(route, [
        row(Permission.ManageProjectBilling),
        row(Permission.ManageProjectBilling, {
          isBlock: true,
          labelled: true,
        }),
      ]);

      expect(route.rechargeBalance).toHaveBeenCalledTimes(1);
    });

    test("a grant and both kinds of block: refused", async () => {
      await call(route, [
        row(Permission.ManageProjectBilling),
        row(Permission.ManageProjectBilling, {
          isBlock: true,
          labelled: true,
        }),
        row(Permission.ManageProjectBilling, { isBlock: true }),
      ]);

      expect(route.rechargeBalance).not.toHaveBeenCalled();
    });

    test("rows for another project do not count for this one", async () => {
      await call(route, [row(Permission.ProjectOwner)], {
        rowsForProject: ObjectID.generate(),
      });

      expect(route.rechargeBalance).not.toHaveBeenCalled();
      expect(refusal()).toBe("Permission for this user not found");
    });
  });
});
