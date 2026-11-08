import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A RULE TEAMS OWN, ON ITS OWN PAGE, WHILE THE PAGE READS WHO OWNS IT.
 *
 * A rule's list reads who owns its rows after drawing them; a rule's own
 * page reads who owns the rule as it opens (RuleOwningTeams'
 * viewRuleOwnership), and asks PermissionGate.checkTeamOwnedRule before it
 * knows: owningTeamIds undefined. Offering Edit and Delete for that moment
 * would hand a member outside the owning teams a change the page is about
 * to lock, so the gate holds the change back with nothing to say yet - as
 * every gate does while the permission snapshot loads - unless who owns the
 * rule cannot matter: the reader's own permissions refuse the change, which
 * it says as ever, or the reader changes every rule teams own.
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
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";

const OVERSIGHT: string = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const PLATFORM: string = "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e";

const REASON: string =
  "This rule belongs to Oversight: only its members, with its permissions, and project admins can change it.";

const ACTIONS: Array<ModelAction.Update | ModelAction.Delete> = [
  ModelAction.Update,
  ModelAction.Delete,
];

function row(
  permission: Permission,
  teamId?: string,
  labelIds?: Array<ObjectID>,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds || [],
    isBlockPermission: false,
    scope: labelIds?.length ? PermissionScope.Labels : PermissionScope.All,
    ...(teamId ? { teamId: new ObjectID(teamId) } : {}),
  };
}

// What the page asks: the teams that own the rule, or undefined while read.
function check(
  action: ModelAction.Update | ModelAction.Delete,
  owningTeamIds: Array<string> | undefined,
): PermissionGateResult {
  return PermissionGate.checkTeamOwnedRule(new IncidentOwnerRule(), action, {
    owningTeamIds: owningTeamIds,
    // The page names the teams once it has read them.
    reason: owningTeamIds ? REASON : "",
  });
}

// A member of Platform, which may change and delete incident owner rules.
const PLATFORM_EDITOR: () => Array<UserPermission> =
  (): Array<UserPermission> => {
    return [
      row(Permission.ReadIncidentOwnerRule, PLATFORM),
      row(Permission.EditIncidentOwnerRule, PLATFORM),
      row(Permission.DeleteIncidentOwnerRule, PLATFORM),
    ];
  };

afterEach(() => {
  isMasterAdminForTest = false;
  rowsForTest = [];
});

describe("PermissionGate.checkTeamOwnedRule while the page reads who owns the rule", () => {
  test("holds Edit and Delete back, with nothing to say yet, for a member who may change rules", () => {
    rowsForTest = PLATFORM_EDITOR();

    for (const action of ACTIONS) {
      // Not allowed, and no reason: the button waits rather than accusing.
      expect(check(action, undefined)).toEqual({ isAllowed: false });
    }
  });

  test("then locks them for a member outside the owning teams, naming the teams", () => {
    rowsForTest = PLATFORM_EDITOR();

    for (const action of ACTIONS) {
      const result: PermissionGateResult = check(action, [OVERSIGHT]);

      expect(result.isAllowed).toBe(false);
      expect(result.disabledReason).toMatch(/^You do not have permission/);
      expect(result.disabledReason).toContain(REASON);
    }
  });

  test("and offers them to a member of the owning team, and on a rule no team owns", () => {
    rowsForTest = PLATFORM_EDITOR();

    for (const action of ACTIONS) {
      expect(check(action, [PLATFORM]).isAllowed).toBe(true);
      expect(check(action, []).isAllowed).toBe(true);
    }
  });

  test("never holds them back from a Project Owner, a Project Admin or a master admin", () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]) {
      rowsForTest = [row(permission, PLATFORM)];

      for (const action of ACTIONS) {
        expect(check(action, undefined).isAllowed).toBe(true);
      }
    }

    rowsForTest = [];
    isMasterAdminForTest = true;

    for (const action of ACTIONS) {
      expect(check(action, undefined).isAllowed).toBe(true);
    }
  });

  test("says what the plain gate says to a reader who may not change rules at all", () => {
    rowsForTest = [row(Permission.ReadIncidentOwnerRule, PLATFORM)];

    for (const action of ACTIONS) {
      const result: PermissionGateResult = check(action, undefined);

      expect(result).toEqual(
        PermissionGate.check(new IncidentOwnerRule(), action),
      );
      expect(result.isAllowed).toBe(false);
      expect(result.disabledReason).toMatch(/^You do not have permission/);
    }
  });

  test("before the permission snapshot lands, says nothing either", () => {
    rowsForTest = [];

    for (const action of ACTIONS) {
      expect(check(action, undefined)).toEqual({ isAllowed: false });
    }
  });
});

describe("PermissionGate.actsOnEveryTeamOwnedRule", () => {
  test("is a Project Owner's, a Project Admin's and a master admin's", () => {
    rowsForTest = [row(Permission.ProjectOwner)];
    expect(PermissionGate.actsOnEveryTeamOwnedRule()).toBe(true);

    rowsForTest = [row(Permission.ProjectAdmin, PLATFORM)];
    expect(PermissionGate.actsOnEveryTeamOwnedRule()).toBe(true);

    rowsForTest = [];
    isMasterAdminForTest = true;
    expect(PermissionGate.actsOnEveryTeamOwnedRule()).toBe(true);
  });

  test("is not a member's, whatever their teams may change", () => {
    rowsForTest = [
      ...PLATFORM_EDITOR(),
      row(Permission.ProjectMember, PLATFORM),
    ];

    expect(PermissionGate.actsOnEveryTeamOwnedRule()).toBe(false);
  });

  test("is not an admin's whose role is limited to labels: it does not reach the whole project", () => {
    rowsForTest = [
      row(Permission.ProjectAdmin, PLATFORM, [ObjectID.generate()]),
    ];

    expect(PermissionGate.actsOnEveryTeamOwnedRule()).toBe(false);
  });

  test("is nobody's before the permission snapshot lands", () => {
    rowsForTest = [];

    expect(PermissionGate.actsOnEveryTeamOwnedRule()).toBe(false);
  });
});
