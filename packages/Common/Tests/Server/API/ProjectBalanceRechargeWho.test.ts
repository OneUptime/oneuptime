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
import "../../../Server/API/NotificationAPI";
import "../../../Server/API/AIBillingAPI";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
} from "../../../Types/Permission";
import {
  PROJECT_BALANCE_RECHARGE_PERMISSIONS,
  WHO_CAN_ADD_PROJECT_BALANCE,
} from "../../../Utils/Project/ProjectBalance";

/*
 * THE PEOPLE A LOW-BALANCE MESSAGE NAMES ARE THE PEOPLE THE RECHARGE ROUTES
 * LET IN.
 *
 * Every message that says a balance ran low names who can add to it - "a
 * project owner or someone with Manage Billing"
 * (Utils/Project/ProjectBalance's PROJECT_BALANCE_RECHARGE_PERMISSIONS).
 * That is only true while it is who POST /notification/recharge and
 * POST /ai/recharge actually let in. So this drives both routes with a
 * caller holding each permission a project can grant, one at a time: the
 * route must recharge for exactly the permissions the messages name, and
 * refuse every other one - Project Admin and the Billing Admin role
 * included. Change who may recharge and this fails until the words say so
 * too.
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

interface RechargeRoute {
  name: string;
  uri: string;
  rechargeBalance: MockFunction;
}

const ROUTES: Array<RechargeRoute> = [
  {
    name: "the balance for SMS, calls, WhatsApp and Telegram",
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

const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);

// Every permission a project can grant one of its teams.
const GRANTABLE: Array<Permission> = PermissionHelper.getTenantPermissionProps()
  .map((props: PermissionProps): Permission => {
    return props.permission;
  })
  .filter((permission: Permission, index: number, all: Array<Permission>) => {
    return all.indexOf(permission) === index;
  });

function grant(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
  } as unknown as UserPermission;
}

async function recharge(
  route: RechargeRoute,
  permissions: Array<Permission>,
): Promise<void> {
  const req: OneUptimeRequest = {
    body: {
      amount: 25,
      projectId: JSONFunctions.serializeValue(PROJECT_ID),
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(grant),
      },
    },
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [PROJECT_ID],
    },
  } as unknown as OneUptimeRequest;

  await mockRouter
    .match("post", route.uri)
    .handlerFunction(
      req,
      {} as OneUptimeResponse,
      jest.fn() as unknown as NextFunction,
    );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the people the messages name", () => {
  test("are a project owner and Manage Billing, in those words", () => {
    expect([...PROJECT_BALANCE_RECHARGE_PERMISSIONS]).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
    expect(WHO_CAN_ADD_PROJECT_BALANCE).toBe(
      "a project owner or someone with Manage Billing",
    );
    expect(PermissionHelper.getTitle(Permission.ManageProjectBilling)).toBe(
      "Manage Billing",
    );
  });

  test("can each be granted to a team", () => {
    for (const permission of PROJECT_BALANCE_RECHARGE_PERMISSIONS) {
      expect(GRANTABLE).toContain(permission);
    }
  });
});

describe.each(ROUTES)("adding to $name ($uri)", (route: RechargeRoute) => {
  test.each(
    PROJECT_BALANCE_RECHARGE_PERMISSIONS.map((permission: Permission) => {
      return [permission];
    }),
  )("%s recharges", async (permission: Permission) => {
    await recharge(route, [permission]);

    expect(route.rechargeBalance).toHaveBeenCalledTimes(1);
    expect(String(route.rechargeBalance.mock.calls[0]?.[0])).toBe(
      PROJECT_ID.toString(),
    );
    expect(route.rechargeBalance.mock.calls[0]?.[1]).toBe(25);
  });

  test("a project admin is refused: Project Admin leaves out billing", async () => {
    await recharge(route, [Permission.ProjectAdmin]);

    expect(route.rechargeBalance).not.toHaveBeenCalled();
  });

  test("the Billing Admin role is refused: it is not Manage Billing", async () => {
    await recharge(route, [Permission.BillingAdmin]);

    expect(route.rechargeBalance).not.toHaveBeenCalled();
  });

  test("every other permission a project can grant is refused, alone", async () => {
    const recharged: Array<Permission> = [];

    for (const permission of GRANTABLE) {
      if (PROJECT_BALANCE_RECHARGE_PERMISSIONS.includes(permission)) {
        continue;
      }

      route.rechargeBalance.mockClear();
      await recharge(route, [permission]);

      if (route.rechargeBalance.mock.calls.length > 0) {
        recharged.push(permission);
      }
    }

    // A permission here recharges, so the messages must name it too.
    expect(recharged).toEqual([]);
  });

  test("everything else a project can grant, all at once, is still refused", async () => {
    await recharge(
      route,
      GRANTABLE.filter((permission: Permission): boolean => {
        return !PROJECT_BALANCE_RECHARGE_PERMISSIONS.includes(permission);
      }),
    );

    expect(route.rechargeBalance).not.toHaveBeenCalled();
  });
});
