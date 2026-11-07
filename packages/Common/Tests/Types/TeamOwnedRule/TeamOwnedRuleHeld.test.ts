import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import TeamOwnedRuleHeld from "../../../Types/TeamOwnedRule/TeamOwnedRuleHeld";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A PERSON HOLDS ON A RULE TEAMS OWN, as the dashboard locks a rule's
 * Edit, Delete and Enable / Disable with it - the server's rule
 * (TeamOwnedRulePermission) read off the person's permission snapshot.
 */

const TEAM_X: string = "3d4e5f6a-7b8c-4d9e-8f1a-2b3c4d5e6f7a";
const TEAM_Y: string = "4e5f6a7b-8c9d-4e0f-9a2b-3c4d5e6f7a8b";

function row(
  permission: Permission,
  data: {
    teamId?: string | undefined;
    isBlock?: boolean | undefined;
    labelIds?: Array<ObjectID> | undefined;
  } = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: Boolean(data.isBlock),
    scope: data.labelIds?.length ? PermissionScope.Labels : PermissionScope.All,
    ...(data.teamId ? { teamId: new ObjectID(data.teamId) } : {}),
  };
}

// Team Y may change on-call rules; Team X may only read them.
const ROWS: Array<UserPermission> = [
  row(Permission.EditIncidentOnCallRule, { teamId: TEAM_Y }),
  row(Permission.ReadIncidentOnCallRule, { teamId: TEAM_Y }),
  row(Permission.ReadIncidentOnCallRule, { teamId: TEAM_X }),
  // A default every member holds, granted by no team.
  row(Permission.ProjectUser),
];

function holds(held: HeldPermissions | null, permission: Permission): boolean {
  return Boolean(
    held &&
      HeldPermissionsUtil.holdsAnyOf(held, [permission], {
        projectWideOnly: false,
      }),
  );
}

describe("TeamOwnedRuleHeld.getHeldOnRule", () => {
  test("a rule no team owns: everything the person holds", () => {
    expect(
      TeamOwnedRuleHeld.getHeldOnRule({ rows: ROWS, owningTeamIds: [] }),
    ).toBeNull();
  });

  test("a rule their team owns: that team's permissions", () => {
    const held: HeldPermissions | null = TeamOwnedRuleHeld.getHeldOnRule({
      rows: ROWS,
      owningTeamIds: [TEAM_Y.toUpperCase()],
    });

    expect(holds(held, Permission.EditIncidentOnCallRule)).toBe(true);
  });

  test("a rule only their view-only team owns: none of the other team's permissions", () => {
    const held: HeldPermissions | null = TeamOwnedRuleHeld.getHeldOnRule({
      rows: ROWS,
      owningTeamIds: [TEAM_X],
    });

    expect(holds(held, Permission.EditIncidentOnCallRule)).toBe(false);
    expect(holds(held, Permission.ReadIncidentOnCallRule)).toBe(true);
    // Nor a permission no team grants.
    expect(holds(held, Permission.ProjectUser)).toBe(false);
  });

  test("a rule none of their teams owns: nothing but their blocks", () => {
    const held: HeldPermissions | null = TeamOwnedRuleHeld.getHeldOnRule({
      rows: [
        ...ROWS,
        row(Permission.DeleteIncidentOnCallRule, {
          teamId: TEAM_X,
          isBlock: true,
        }),
      ],
      owningTeamIds: ["5f6a7b8c-9d0e-4f1a-8b3c-4d5e6f7a8b9c"],
    });

    expect(held).not.toBeNull();
    expect(held!.allowed).toEqual([]);
    expect(held!.blocked).toContain(Permission.DeleteIncidentOnCallRule);
  });

  test("a Project Owner or Admin over the whole project: everything they hold", () => {
    for (const permission of [Permission.ProjectOwner, Permission.ProjectAdmin]) {
      expect(
        TeamOwnedRuleHeld.getHeldOnRule({
          rows: [row(permission, { teamId: TEAM_X })],
          owningTeamIds: [TEAM_Y],
        }),
      ).toBeNull();
    }
  });

  test("an admin role limited to labels holds only its teams' permissions on the rule", () => {
    const held: HeldPermissions | null = TeamOwnedRuleHeld.getHeldOnRule({
      rows: [
        row(Permission.ProjectAdmin, {
          teamId: TEAM_X,
          labelIds: [ObjectID.generate()],
        }),
      ],
      owningTeamIds: [TEAM_Y],
    });

    expect(held).not.toBeNull();
    expect(held!.allowed).toEqual([]);
  });

  test("reads a team's id however the snapshot stored it", () => {
    expect(TeamOwnedRuleHeld.getId(TEAM_X)).toBe(TEAM_X);
    expect(TeamOwnedRuleHeld.getId(new ObjectID(TEAM_X))).toBe(TEAM_X);
    expect(TeamOwnedRuleHeld.getId({ value: TEAM_X })).toBe(TEAM_X);
    expect(TeamOwnedRuleHeld.getId(undefined)).toBeNull();
    expect(TeamOwnedRuleHeld.getId({})).toBeNull();
  });
});
