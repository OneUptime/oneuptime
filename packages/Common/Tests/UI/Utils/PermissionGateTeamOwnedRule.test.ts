import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A RULE TEAMS OWN, LOCKED FOR WHOEVER THE SERVER WOULD REFUSE.
 *
 * PermissionGate.checkTeamOwnedRule is what a rule list asks before it
 * offers a row's Edit, Delete and Enable / Disable (RuleOwningTeams): the
 * reader's own permissions first, then - on a rule some teams own - only
 * the permissions of their teams that own it (TeamOwnedRuleHeld). A reader
 * on none of those teams holds nothing on the rule at all, which the plain
 * gate would take for a snapshot not loaded yet and say nothing about; this
 * one says which teams own the rule.
 */

let isMasterAdminForTest: boolean = false;
let rowsForTest: Array<unknown> = [];

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return (rowsForTest as Array<{ permission: unknown }>).map(
          (row: { permission: unknown }): unknown => {
            return row.permission;
          },
        );
      },
      getProjectPermissions: (): { permissions: Array<unknown> } => {
        return { permissions: rowsForTest };
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";

const OVERSIGHT: string = "3d4e5f6a-7b8c-4d9e-8f1a-2b3c4d5e6f7a";
const PLATFORM: string = "4e5f6a7b-8c9d-4e0f-9a2b-3c4d5e6f7a8b";

const REASON: string =
  "This rule belongs to Oversight: only its members, with its permissions, and project admins can change it.";

function row(permission: Permission, teamId?: string): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
    ...(teamId ? { teamId: new ObjectID(teamId) } : {}),
  };
}

function check(
  action: ModelAction.Update | ModelAction.Delete,
  owningTeamIds: Array<string>,
): PermissionGateResult {
  return PermissionGate.checkTeamOwnedRule(new IncidentOnCallRule(), action, {
    owningTeamIds: owningTeamIds,
    reason: REASON,
  });
}

afterEach(() => {
  isMasterAdminForTest = false;
  rowsForTest = [];
});

describe("PermissionGate.checkTeamOwnedRule", () => {
  test("a rule no team owns is changed by everyone whose permissions allow it", () => {
    rowsForTest = [
      row(Permission.ReadIncidentOnCallRule, PLATFORM),
      row(Permission.EditIncidentOnCallRule, PLATFORM),
    ];

    expect(check(ModelAction.Update, []).isAllowed).toBe(true);
  });

  test("a member of the team that owns it changes it with that team's permission", () => {
    rowsForTest = [
      row(Permission.ReadIncidentOnCallRule, OVERSIGHT),
      row(Permission.EditIncidentOnCallRule, OVERSIGHT),
    ];

    expect(check(ModelAction.Update, [OVERSIGHT]).isAllowed).toBe(true);
  });

  test("a member of another team sees it locked, told which team owns it", () => {
    rowsForTest = [
      row(Permission.ReadIncidentOnCallRule, PLATFORM),
      row(Permission.EditIncidentOnCallRule, PLATFORM),
      row(Permission.DeleteIncidentOnCallRule, PLATFORM),
    ];

    for (const action of [ModelAction.Update, ModelAction.Delete] as Array<
      ModelAction.Update | ModelAction.Delete
    >) {
      const result: PermissionGateResult = check(action, [OVERSIGHT]);

      expect(result.isAllowed).toBe(false);
      expect(result.disabledReason).toMatch(/^You do not have permission/);
      expect(result.disabledReason).toContain(REASON);
    }
  });

  test("a member of the owning team who may only read it there is locked, whatever another team allows", () => {
    rowsForTest = [
      row(Permission.ReadIncidentOnCallRule, OVERSIGHT),
      row(Permission.EditIncidentOnCallRule, PLATFORM),
    ];

    const result: PermissionGateResult = check(ModelAction.Update, [OVERSIGHT]);

    expect(result.isAllowed).toBe(false);
    expect(result.disabledReason).toContain(REASON);
  });

  test("a Project Admin, and a master admin, change every rule", () => {
    rowsForTest = [row(Permission.ProjectAdmin, PLATFORM)];
    expect(check(ModelAction.Update, [OVERSIGHT]).isAllowed).toBe(true);

    rowsForTest = [];
    isMasterAdminForTest = true;
    expect(check(ModelAction.Delete, [OVERSIGHT]).isAllowed).toBe(true);
  });

  test("a reader who may not change rules at all is told what the plain gate says", () => {
    rowsForTest = [row(Permission.ReadIncidentOnCallRule, OVERSIGHT)];

    const result: PermissionGateResult = check(ModelAction.Update, [OVERSIGHT]);

    expect(result).toEqual(
      PermissionGate.check(new IncidentOnCallRule(), ModelAction.Update),
    );
    expect(result.disabledReason || "").not.toContain(REASON);
  });
});
