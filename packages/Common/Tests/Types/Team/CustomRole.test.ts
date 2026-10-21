import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import {
  CUSTOM_ROLE_NAME_MAX_LENGTH,
  CUSTOM_ROLE_NAME_REQUIRED_MESSAGE,
  getBuiltInRoleNamed,
  getCustomRoleDuplicatePermissionMessage,
  getCustomRoleGrantRefusedMessage,
  getCustomRoleNameKey,
  getCustomRoleNameProblem,
  getCustomRoleNameTakenMessage,
  getCustomRolePermissionProblem,
  getPermissionPropsAllowedInCustomRole,
  getPermissionTitleForSentence,
  getRoleCopyChangeRefusedMessage,
  isPermissionAllowedInCustomRole,
  LABELS_NEED_THE_LABELS_SCOPE_MESSAGE,
  LABELS_SCOPE_NEEDS_A_LABEL_MESSAGE,
  normalizeCustomRoleName,
  PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
  PROJECT_OWNER_NOT_IN_A_CUSTOM_ROLE_MESSAGE,
  UNKNOWN_SCOPE_MESSAGE,
} from "../../../Types/Team/CustomRole";
import { describe, expect, test } from "@jest/globals";

/*
 * What a custom role may hold and be called - the rules the server refuses
 * by (CustomRoleService, CustomRolePermissionService) and the Dashboard's
 * pickers offer by. One module for both, so they never disagree.
 */

const LABEL: string = "5b0b3f7e-0c2a-4d6e-9f1a-2b3c4d5e6f70";

describe("what a custom role may hold", () => {
  test("every permission a team may be given, but Project Owner", () => {
    const allowed: Array<Permission> =
      getPermissionPropsAllowedInCustomRole().map(
        (props: PermissionProps): Permission => {
          return props.permission;
        },
      );
    const teamPermissions: Array<Permission> =
      PermissionHelper.getTenantPermissionProps().map(
        (props: PermissionProps): Permission => {
          return props.permission;
        },
      );

    expect(PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE).toEqual([
      Permission.ProjectOwner,
    ]);
    expect(allowed).not.toContain(Permission.ProjectOwner);
    expect(allowed).toEqual(
      teamPermissions.filter((permission: Permission): boolean => {
        return permission !== Permission.ProjectOwner;
      }),
    );
    // Project Admin and the narrow roles are there.
    expect(allowed).toEqual(
      expect.arrayContaining([
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.IncidentMember,
        Permission.CreateProjectIncident,
      ]),
    );
  });

  test.each([
    [Permission.ProjectOwner, false],
    [Permission.ProjectAdmin, true],
    [Permission.IncidentMember, true],
    [Permission.ReadProjectMonitor, true],
    // Never given to a team: held by everyone, or by nobody in a project.
    [Permission.Public, false],
    [Permission.User, false],
    [Permission.CurrentUser, false],
    ["NotAPermission", false],
    ["", false],
    [undefined, false],
    [null, false],
  ] as Array<[string | undefined | null, boolean]>)(
    "isPermissionAllowedInCustomRole(%s) is %s",
    (permission: string | undefined | null, allowed: boolean) => {
      expect(isPermissionAllowedInCustomRole(permission)).toBe(allowed);
    },
  );

  test("a permission takes All, Owned or Labels, as on a team", () => {
    expect(
      getCustomRolePermissionProblem({
        permission: Permission.IncidentMember,
        scope: PermissionScope.All,
      }),
    ).toBeNull();
    expect(
      getCustomRolePermissionProblem({
        permission: Permission.IncidentMember,
        scope: PermissionScope.Owned,
      }),
    ).toBeNull();
    expect(
      getCustomRolePermissionProblem({
        permission: Permission.IncidentMember,
        scope: PermissionScope.Labels,
        labelIds: [LABEL],
      }),
    ).toBeNull();
    // No scope is All.
    expect(
      getCustomRolePermissionProblem({
        permission: Permission.IncidentMember,
      }),
    ).toBeNull();
    expect(
      getCustomRolePermissionProblem({
        permission: Permission.IncidentMember,
        scope: "Everything",
      }),
    ).toBe(UNKNOWN_SCOPE_MESSAGE);
  });

  test("labels go only with the scope Labels, and the scope Labels needs one", () => {
    expect(
      getCustomRolePermissionProblem({
        permission: Permission.MonitorViewer,
        scope: PermissionScope.All,
        labelIds: [LABEL],
      }),
    ).toBe(LABELS_NEED_THE_LABELS_SCOPE_MESSAGE);
    expect(
      getCustomRolePermissionProblem({
        permission: Permission.MonitorViewer,
        scope: PermissionScope.Owned,
        labelIds: [LABEL],
      }),
    ).toBe(LABELS_NEED_THE_LABELS_SCOPE_MESSAGE);
    expect(
      getCustomRolePermissionProblem({
        permission: Permission.MonitorViewer,
        scope: PermissionScope.Labels,
        labelIds: [],
      }),
    ).toBe(LABELS_SCOPE_NEEDS_A_LABEL_MESSAGE);
  });

  test("the roles that reach the whole project by definition take All only", () => {
    const unscoped: Array<Permission> =
      PermissionHelper.getRolePermissionProps()
        .map((props: PermissionProps): Permission => {
          return props.permission;
        })
        .filter((permission: Permission): boolean => {
          return (
            !PermissionHelper.isScopeApplicable(permission) &&
            permission !== Permission.ProjectOwner
          );
        });

    expect(unscoped).toEqual(
      expect.arrayContaining([
        Permission.ProjectAdmin,
        Permission.SettingsAdmin,
        Permission.BillingViewer,
      ]),
    );

    for (const permission of unscoped) {
      expect(
        getCustomRolePermissionProblem({
          permission: permission,
          scope: PermissionScope.All,
        }),
      ).toBeNull();

      for (const scope of [PermissionScope.Owned, PermissionScope.Labels]) {
        expect(
          getCustomRolePermissionProblem({
            permission: permission,
            scope: scope,
            labelIds: scope === PermissionScope.Labels ? [LABEL] : [],
          }),
        ).toBe(
          `${PermissionHelper.getTitle(permission)} reaches the whole project and can't be limited. Pick the scope All.`,
        );
      }
    }
  });

  test("Project Owner is refused in its own words, whatever its scope", () => {
    for (const scope of Object.values(PermissionScope)) {
      expect(
        getCustomRolePermissionProblem({
          permission: Permission.ProjectOwner,
          scope: scope,
        }),
      ).toBe(PROJECT_OWNER_NOT_IN_A_CUSTOM_ROLE_MESSAGE);
    }
  });

  test("a permission no team may be given, and none at all, are refused by name", () => {
    expect(
      getCustomRolePermissionProblem({ permission: Permission.Public }),
    ).toBe(
      "Public can't be given to a team, so it can't be part of a custom role.",
    );
    expect(getCustomRolePermissionProblem({ permission: "Nope" })).toBe(
      "Nope can't be given to a team, so it can't be part of a custom role.",
    );
    expect(getCustomRolePermissionProblem({ permission: undefined })).toBe(
      "Pick a permission.",
    );
  });
});

describe("a custom role's name", () => {
  test.each([
    ["Incident Responder", "Incident Responder"],
    ["  Incident   Responder  ", "Incident Responder"],
    ["Team\tLead\n", "Team Lead"],
    ["", ""],
    [undefined, ""],
    [null, ""],
  ] as Array<[string | undefined | null, string]>)(
    "normalizeCustomRoleName(%j) is %j",
    (name: string | undefined | null, normalized: string) => {
      expect(normalizeCustomRoleName(name)).toBe(normalized);
    },
  );

  test("two names are the same whatever their case and spacing", () => {
    expect(getCustomRoleNameKey("  INCIDENT  responder ")).toBe(
      getCustomRoleNameKey("Incident Responder"),
    );
    expect(getCustomRoleNameKey("Incident Responders")).not.toBe(
      getCustomRoleNameKey("Incident Responder"),
    );
  });

  test("a name is given", () => {
    for (const name of ["", "   ", "\n\t", undefined, null]) {
      expect(getCustomRoleNameProblem(name)).toBe(
        CUSTOM_ROLE_NAME_REQUIRED_MESSAGE,
      );
    }
  });

  test("a name fits the column", () => {
    expect(
      getCustomRoleNameProblem("R".repeat(CUSTOM_ROLE_NAME_MAX_LENGTH)),
    ).toBeNull();
    expect(
      getCustomRoleNameProblem("R".repeat(CUSTOM_ROLE_NAME_MAX_LENGTH + 1)),
    ).toBe(
      `A role's name can be at most ${CUSTOM_ROLE_NAME_MAX_LENGTH} characters long.`,
    );
  });

  test("a name is never a built-in role's, whatever its case and spacing", () => {
    for (const props of PermissionHelper.getRolePermissionProps()) {
      for (const name of [
        props.title,
        props.title.toUpperCase(),
        `  ${props.title.toLowerCase()} `,
      ]) {
        expect(getBuiltInRoleNamed(name)?.permission).toBe(props.permission);
        expect(getCustomRoleNameProblem(name)).toBe(
          `${props.title} is a built-in role. Pick another name for your role.`,
        );
      }
    }

    expect(getBuiltInRoleNamed("Incident Responder")).toBeNull();
    expect(getCustomRoleNameProblem("Incident Responder")).toBeNull();
    expect(getCustomRoleNameProblem("Project Admins")).toBeNull();
  });

  test("names in other alphabets are names", () => {
    for (const name of [
      "Ответственный за инциденты",
      "インシデント対応",
      "مسئول حادثه",
    ]) {
      expect(getCustomRoleNameProblem(name)).toBeNull();
      expect(normalizeCustomRoleName(` ${name} `)).toBe(name);
    }
  });
});

describe("the sentences", () => {
  test("say the role and the permission in words", () => {
    expect(getPermissionTitleForSentence(Permission.IncidentMember)).toBe(
      "Incident Member",
    );
    expect(getPermissionTitleForSentence("Unknown")).toBe("Unknown");
    expect(getCustomRoleNameTakenMessage("  Team   Lead ")).toBe(
      "There is already a role called Team Lead in this project. Pick another name.",
    );
    expect(
      getCustomRoleDuplicatePermissionMessage({
        roleName: "Incident Responder",
        permission: Permission.IncidentMember,
      }),
    ).toBe("Incident Responder already has Incident Member.");
    expect(
      getCustomRoleGrantRefusedMessage({
        roleName: "Admins",
        permission: Permission.ProjectAdmin,
      }),
    ).toBe(
      "You can't give Admins: it has Project Admin, and your own access doesn't include that permission at the same or a broader scope.",
    );
    expect(
      getRoleCopyChangeRefusedMessage({
        roleName: "Incident Responder",
        permission: Permission.IncidentMember,
      }),
    ).toBe(
      "Incident Member comes with the custom role Incident Responder. Change the role, or take the role away from the team.",
    );
    expect(
      getRoleCopyChangeRefusedMessage({
        permission: Permission.IncidentMember,
      }),
    ).toBe(
      "Incident Member comes with a custom role. Change the role, or take the role away from the team.",
    );
  });
});
