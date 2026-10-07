import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "Connect with GitHub App" on the Code Repositories page asks what the
 * server asks before it starts a connection and again when GitHub sends the
 * browser back (Common/Server/API/GitHubConnectAccess): on OneUptime Cloud the
 * plan code repositories are sold on, and permission to create code
 * repositories. For someone the dashboard knows may not connect, the card is
 * locked and says in one plain sentence what it takes - the plan first, as the
 * server asks it first. Someone it knows nothing about yet keeps the card, and
 * the server decides. A team's block row is never a grant, and a block with
 * no labels takes the permission away.
 */

let isMasterAdminForTest: boolean = false;
let billingEnabledForTest: boolean = false;
let currentPlanForTest: string | null = null;

const CLOUD_PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,priceMonthlyId1,priceYearlyId1,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH: "Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",
  SUBSCRIPTION_PLAN_SCALE: "Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,priceMonthlyId4,priceYearlyId4,-1,-1,4,14",
};

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  mocked["getAllEnvVars"] = (): Record<string, string> => {
    return CLOUD_PLAN_ENV;
  };

  return mocked;
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): string => {
        return "7e000000-0000-4000-8000-000000000001";
      },
      getCurrentPlan: (): string | null => {
        return currentPlanForTest;
      },
    },
  };
});

import {
  getGitHubConnectLock,
  GITHUB_CONNECT_PERMISSION_REASON,
  GITHUB_CONNECT_PLAN_REASON,
  GitHubConnectLock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CodeRepository/GitHubConnectLock";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);
const LABEL_ID: ObjectID = new ObjectID("7e000000-0000-4000-8000-000000000002");

const PERMISSION_LOCK: GitHubConnectLock = {
  isLocked: true,
  reason: GITHUB_CONNECT_PERMISSION_REASON,
};

// The Code Repositories page's create list: each may connect.
const MAY_CONNECT: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateCodeRepository,
];

// May see code repositories, and add none.
const MAY_NOT_CONNECT: Array<Permission> = [
  Permission.Viewer,
  Permission.SettingsViewer,
  Permission.ReadCodeRepository,
  Permission.EditCodeRepository,
  Permission.DeleteCodeRepository,
  Permission.IncidentMember,
];

// What the dashboard holds for someone signed in: these, and the automatic ones.
const lockFor: (permissions: Array<Permission>) => GitHubConnectLock = (
  permissions: Array<Permission>,
): GitHubConnectLock => {
  return getGitHubConnectLock({
    permissions: [Permission.CurrentUser, Permission.Public, ...permissions],
  });
};

const row: (
  permission: Permission,
  isBlockPermission: boolean,
  labelIds?: Array<ObjectID>,
) => UserPermission = (
  permission: Permission,
  isBlockPermission: boolean,
  labelIds?: Array<ObjectID>,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds || [],
    isBlockPermission: isBlockPermission,
  };
};

// What the API's permission headers leave in storage for this project.
const storeSnapshot: (rows: Array<UserPermission>) => void = (
  rows: Array<UserPermission>,
): void => {
  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    projectIds: [PROJECT_ID],
    globalPermissions: [Permission.Public, Permission.CurrentUser],
  });

  PermissionUtil.setProjectPermissions({
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  });
};

beforeEach(() => {
  isMasterAdminForTest = false;
  billingEnabledForTest = false;
  currentPlanForTest = null;
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe("Connect with GitHub App: who may connect", () => {
  test.each(MAY_CONNECT)("%s: the card works", (permission: Permission) => {
    expect(lockFor([permission])).toEqual({ isLocked: false });
  });

  test.each(MAY_NOT_CONNECT)(
    "%s: locked, and the card says what it takes",
    (permission: Permission) => {
      expect(lockFor([permission])).toEqual(PERMISSION_LOCK);
    },
  );

  test("the lock asks exactly the server's permission: every one the server accepts may connect", () => {
    const serverPermissions: Array<Permission> =
      new CodeRepository().getCreatePermissions();

    expect(serverPermissions.length).toBeGreaterThan(0);
    expect([...serverPermissions].sort()).toEqual([...MAY_CONNECT].sort());

    for (const permission of serverPermissions) {
      expect([permission, lockFor([permission]).isLocked]).toEqual([
        permission,
        false,
      ]);
    }
  });

  test("while the permissions are not loaded, nobody is told they may not: the server decides", () => {
    expect(getGitHubConnectLock({ permissions: [] })).toEqual({
      isLocked: false,
    });
  });

  test("a server admin may", () => {
    isMasterAdminForTest = true;

    expect(lockFor([])).toEqual({ isLocked: false });
  });

  test.each([Permission.CreateCodeRepository, Permission.ProjectMember])(
    "a team's block of %s with no labels: locked, as the server refuses",
    (blocked: Permission) => {
      storeSnapshot([
        row(Permission.ProjectOwner, false),
        row(Permission.ProjectMember, false),
        row(blocked, true),
      ]);

      expect(getGitHubConnectLock()).toEqual(PERMISSION_LOCK);
    },
  );

  test("a block row is no grant: someone who may only look, with a block on it, is locked", () => {
    storeSnapshot([
      row(Permission.Viewer, false),
      row(Permission.CreateCodeRepository, true, [LABEL_ID]),
    ]);

    expect(getGitHubConnectLock().isLocked).toBe(true);
  });

  test("a block limited to labels does not lock it, as it does not stop the server", () => {
    storeSnapshot([
      row(Permission.ProjectMember, false),
      row(Permission.CreateCodeRepository, true, [LABEL_ID]),
    ]);

    expect(getGitHubConnectLock()).toEqual({ isLocked: false });
  });

  test("a snapshot handed in is read the same way as the stored one", () => {
    expect(
      getGitHubConnectLock({
        held: HeldPermissionsUtil.fromRows({
          rows: [
            row(Permission.ProjectOwner, false),
            row(Permission.CreateCodeRepository, true),
          ],
          globalPermissions: [Permission.CurrentUser],
        }),
      }),
    ).toEqual(PERMISSION_LOCK);
  });
});

describe("Connect with GitHub App: the plan, on OneUptime Cloud", () => {
  test("below the plan code repositories are sold on: locked with the plan's name, before any permission is asked", () => {
    billingEnabledForTest = true;
    currentPlanForTest = PlanType.Free;

    const expected: GitHubConnectLock = {
      isLocked: true,
      reason: "Connecting GitHub needs the Growth plan.",
    };

    expect(lockFor([Permission.ProjectOwner])).toEqual(expected);

    // A Viewer below the plan is told the plan, as the server tells them.
    expect(lockFor([Permission.Viewer])).toEqual(expected);
  });

  test("the plan named is the one the server's create asks", () => {
    expect(new CodeRepository().getCreateBillingPlan()).toBe(PlanType.Growth);
    expect(GITHUB_CONNECT_PLAN_REASON).toContain("{{planName}}");
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on %s, the card works",
    (plan: PlanType) => {
      billingEnabledForTest = true;
      currentPlanForTest = plan;

      expect(lockFor([Permission.ProjectOwner])).toEqual({ isLocked: false });
    },
  );

  test("on the plan, someone without the permission is still locked by it", () => {
    billingEnabledForTest = true;
    currentPlanForTest = PlanType.Scale;

    expect(lockFor([Permission.Viewer])).toEqual(PERMISSION_LOCK);
  });

  test("a plan the dashboard does not know yet locks nothing: the server decides", () => {
    billingEnabledForTest = true;
    currentPlanForTest = null;

    expect(lockFor([Permission.ProjectOwner])).toEqual({ isLocked: false });
  });

  test("without billing (self-hosted), the plan never locks it", () => {
    billingEnabledForTest = false;
    currentPlanForTest = PlanType.Free;

    expect(lockFor([Permission.ProjectOwner])).toEqual({ isLocked: false });
  });
});
