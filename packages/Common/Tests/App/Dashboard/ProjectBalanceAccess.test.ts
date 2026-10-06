import {
  canAddProjectBalance,
  getProjectBalanceAccess,
  getProjectBalanceCardDescription,
  getRechargeBalanceButtons,
  getRechargeBalanceLockedReason,
  isKnownNotToAddProjectBalance,
  ProjectBalanceAccess,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceAccess";
import {
  ADD_AI_CREDITS_STEP,
  PROJECT_BALANCE_CARD_DESCRIPTIONS,
  WHO_CAN_ADD_AI_CREDITS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import {
  getProjectBalanceWhoCanAddSentence,
  PROJECT_BALANCE_SETTINGS_PATH,
  ProjectBalanceType,
} from "../../../Utils/Project/ProjectBalance";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Whether the signed-in person may add to a balance, as the dashboard
 * decides it (ProjectBalance/ProjectBalanceAccess): the same people the
 * recharge routes and the Auto Recharge columns let in - a project owner or
 * someone with Manage Billing - read from the permission snapshot the way
 * the notification channel switches are, three ways:
 *
 *   Yes     - the Recharge button and the links to the page are theirs;
 *   No      - they are told who can, and the button is locked with why;
 *   Unknown - the snapshot has not arrived: nothing is offered, nobody is
 *             accused of lacking a permission.
 */

const PROJECT_ID: string = "7a000000-0000-4000-8000-0000000000aa";

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];

const ALL_BALANCES: Array<ProjectBalanceType> = [
  ProjectBalanceType.SmsOrCall,
  ProjectBalanceType.AI,
];

function grant(permissions: Array<Permission>, isMasterAdmin?: boolean): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(Boolean(isMasterAdmin));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ALL_BALANCES)(
  "who may add to the %s balance",
  (balance: ProjectBalanceType) => {
    test.each([
      ["a project owner", [Permission.ProjectOwner]],
      ["someone with Manage Billing", [Permission.ManageProjectBilling]],
    ])("%s may", (_who: string, permissions: Array<Permission>) => {
      grant([...BASE_PERMISSIONS, ...permissions]);

      expect(getProjectBalanceAccess(balance)).toBe(ProjectBalanceAccess.Yes);
      expect(canAddProjectBalance(balance)).toBe(true);
      expect(isKnownNotToAddProjectBalance(balance)).toBe(false);
    });

    test.each([
      ["a project admin", [Permission.ProjectAdmin]],
      ["a member", [Permission.ProjectMember]],
      ["a viewer", [Permission.Viewer]],
      ["the Billing Admin role", [Permission.BillingAdmin]],
      ["Edit Project", [Permission.EditProject]],
    ])(
      "%s may not, and is known not to",
      (_who: string, permissions: Array<Permission>) => {
        grant([...BASE_PERMISSIONS, ...permissions]);

        expect(getProjectBalanceAccess(balance)).toBe(ProjectBalanceAccess.No);
        expect(canAddProjectBalance(balance)).toBe(false);
        expect(isKnownNotToAddProjectBalance(balance)).toBe(true);
      },
    );

    test("before the permission snapshot arrives, it is not known either way", () => {
      grant([]);

      expect(getProjectBalanceAccess(balance)).toBe(
        ProjectBalanceAccess.Unknown,
      );
      expect(canAddProjectBalance(balance)).toBe(false);
      expect(isKnownNotToAddProjectBalance(balance)).toBe(false);
    });

    test("a master admin may, even with an empty snapshot", () => {
      grant([], true);

      expect(getProjectBalanceAccess(balance)).toBe(ProjectBalanceAccess.Yes);
    });
  },
);

describe("the Current Balance card's description", () => {
  test.each(ALL_BALANCES)(
    "%s: asks someone who may to recharge it",
    (balance: ProjectBalanceType) => {
      expect(
        getProjectBalanceCardDescription(balance, ProjectBalanceAccess.Yes),
      ).toBe(PROJECT_BALANCE_CARD_DESCRIPTIONS[balance].forPeopleWhoMayAdd);
      expect(
        PROJECT_BALANCE_CARD_DESCRIPTIONS[balance].forPeopleWhoMayAdd,
      ).toContain("Recharge it, or turn on Auto Recharge");
    },
  );

  test.each(ALL_BALANCES)(
    "%s: tells everyone else - and anyone not yet known - who can",
    (balance: ProjectBalanceType) => {
      for (const access of [
        ProjectBalanceAccess.No,
        ProjectBalanceAccess.Unknown,
      ]) {
        const description: string = getProjectBalanceCardDescription(
          balance,
          access,
        );

        expect(description).toBe(
          PROJECT_BALANCE_CARD_DESCRIPTIONS[balance].forEveryoneElse,
        );
        expect(description).toContain(
          "A project owner or someone with Manage Billing can recharge it",
        );
        expect(description).not.toContain("Recharge it,");
      }
    },
  );

  test("both descriptions say what the balance pays for first", () => {
    expect(
      PROJECT_BALANCE_CARD_DESCRIPTIONS[ProjectBalanceType.SmsOrCall]
        .forEveryoneElse,
    ).toMatch(/^SMS, calls, WhatsApp and Telegram messages are paid/);
    expect(
      PROJECT_BALANCE_CARD_DESCRIPTIONS[ProjectBalanceType.AI].forEveryoneElse,
    ).toMatch(/^AI features are paid/);
  });
});

describe("the Recharge Balance button", () => {
  test("works for someone who may", () => {
    const onRecharge: jest.Mock = jest.fn();
    const buttons: Array<CardButtonSchema> = getRechargeBalanceButtons({
      access: ProjectBalanceAccess.Yes,
      onRecharge,
    });

    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.title).toBe("Recharge Balance");
    expect(buttons[0]!.disabled).toBeFalsy();

    buttons[0]!.onClick();

    expect(onRecharge).toHaveBeenCalledTimes(1);
  });

  test("is locked, saying why, for someone who may not - and pressing it opens nothing", () => {
    const onRecharge: jest.Mock = jest.fn();
    const buttons: Array<CardButtonSchema> = getRechargeBalanceButtons({
      access: ProjectBalanceAccess.No,
      onRecharge,
    });

    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({
      title: "Recharge Balance",
      disabled: true,
      tooltip:
        "Adding balance needs one of these permissions: Project Owner, Manage Billing.",
    });

    buttons[0]!.onClick();

    expect(onRecharge).not.toHaveBeenCalled();
  });

  test("is not there while the permissions are on their way", () => {
    expect(
      getRechargeBalanceButtons({
        access: ProjectBalanceAccess.Unknown,
        onRecharge: jest.fn(),
      }),
    ).toEqual([]);
  });

  test("the locked reason names the recharge permissions by their titles", () => {
    expect(getRechargeBalanceLockedReason()).toBe(
      "Adding balance needs one of these permissions: Project Owner, Manage Billing.",
    );
  });
});

describe("the AI agent pages' words for used-up credits", () => {
  test("the step says what to do, without auto-recharge", () => {
    expect(ADD_AI_CREDITS_STEP).toBe("Add AI credits to this project.");
    expect(ADD_AI_CREDITS_STEP).not.toMatch(/recharge/i);
  });

  test("everyone else is told who can add credits, in the server's words", () => {
    expect(WHO_CAN_ADD_AI_CREDITS).toBe(
      "A project owner or someone with Manage Billing can add AI credits.",
    );
    expect(getProjectBalanceWhoCanAddSentence(ProjectBalanceType.AI)).toContain(
      WHO_CAN_ADD_AI_CREDITS.replace(/\.$/, ""),
    );
  });
});

describe("the pages the messages name", () => {
  test("are the dashboard's own routes", () => {
    expect(
      RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS]!.toString(),
    ).toContain(
      `/${PROJECT_BALANCE_SETTINGS_PATH[ProjectBalanceType.SmsOrCall]}`,
    );
    expect(RouteMap[PageMap.SETTINGS_AI_CREDITS]!.toString()).toContain(
      `/${PROJECT_BALANCE_SETTINGS_PATH[ProjectBalanceType.AI]}`,
    );
  });
});
