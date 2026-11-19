import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import Permission, { UserPermission } from "../../../../Types/Permission";
import { createTranslator } from "../../../../Types/Translator";
import {
  WorkflowRunAs,
  getWorkflowRunAsChangeRefusedMessage,
  getWorkflowRunAsRunRefusedMessage,
} from "../../../../Types/Workflow/WorkflowRunAs";
import {
  canGiveWorkflowRunAs,
  getWorkflowRunAsLockedReasons,
} from "../../../../UI/Components/Workflow/WorkflowRunAsGate";
import { PermissionRows } from "../../../../UI/Utils/GrantablePermission";
import { describe, expect, test } from "@jest/globals";

/*
 * THE DASHBOARD'S COPY OF WHO MAY GIVE, CHANGE AND RUN A WORKFLOW'S RUN AS
 * (#9695, WorkflowRunAsGate): never looser than the server
 * (WorkflowRunAsAuthority), and its locked buttons say what the server
 * would - word for word.
 */

function rows(
  allow: Array<UserPermission>,
  block: Array<UserPermission> = [],
): PermissionRows {
  return { allow, block };
}

function row(
  permission: Permission,
  options?: { labelIds?: Array<string>; scope?: PermissionScope },
): UserPermission {
  const made: UserPermission = {
    _type: "UserPermission",
    permission: permission,
    labelIds: (options?.labelIds || []) as never,
    isBlockPermission: false,
  };

  if (options?.scope) {
    made.scope = options.scope;
  }

  return made;
}

const LABEL: string = "a1a1a1a1-0000-4000-8000-000000000001";
const ENGLISH: ReturnType<typeof createTranslator> =
  createTranslator(undefined);

describe("who may give a workflow what it runs as", () => {
  test("Default is anyone's", () => {
    expect(
      canGiveWorkflowRunAs({
        state: { runAs: WorkflowRunAs.Default },
        rows: rows([]),
      }),
    ).toBe(true);
    expect(
      canGiveWorkflowRunAs({ state: { runAs: undefined }, rows: rows([]) }),
    ).toBe(true);
  });

  test("Project Owner is a Project Owner's, with nothing blocking it", () => {
    const owner: UserPermission = row(Permission.ProjectOwner);

    expect(
      canGiveWorkflowRunAs({
        state: { runAs: WorkflowRunAs.ProjectOwner },
        rows: rows([owner]),
      }),
    ).toBe(true);
    expect(
      canGiveWorkflowRunAs({
        state: { runAs: WorkflowRunAs.ProjectOwner },
        rows: rows([row(Permission.ProjectAdmin)]),
      }),
    ).toBe(false);
    expect(
      canGiveWorkflowRunAs({
        state: { runAs: WorkflowRunAs.ProjectOwner },
        rows: rows([owner], [row(Permission.ProjectOwner)]),
      }),
    ).toBe(false);
  });

  test("a custom role takes each of its permissions, at its scope and labels - but not one limited to what someone owns", () => {
    const grants: Array<{
      permission: Permission;
      scope?: PermissionScope;
      labelIds?: Array<string>;
    }> = [
      { permission: Permission.IncidentMember, scope: PermissionScope.All },
      {
        permission: Permission.MonitorAdmin,
        scope: PermissionScope.Labels,
        labelIds: [LABEL],
      },
      // Gives a workflow nothing, so it takes nothing either.
      { permission: Permission.AlertAdmin, scope: PermissionScope.Owned },
    ];

    expect(
      canGiveWorkflowRunAs({
        state: { runAs: WorkflowRunAs.CustomRole, roleGrants: grants },
        rows: rows([
          row(Permission.IncidentMember),
          row(Permission.MonitorAdmin, {
            labelIds: [LABEL],
            scope: PermissionScope.Labels,
          }),
        ]),
      }),
    ).toBe(true);
    expect(
      canGiveWorkflowRunAs({
        state: { runAs: WorkflowRunAs.CustomRole, roleGrants: grants },
        rows: rows([row(Permission.IncidentMember)]),
      }),
    ).toBe(false);
    expect(
      canGiveWorkflowRunAs({
        state: { runAs: WorkflowRunAs.CustomRole, roleGrants: grants },
        rows: rows([row(Permission.ProjectOwner)]),
      }),
    ).toBe(true);
  });

  test("a Run As that cannot be read is held to Project Owner", () => {
    expect(
      canGiveWorkflowRunAs({
        state: { runAs: "Root" },
        rows: rows([row(Permission.ProjectAdmin)]),
      }),
    ).toBe(false);
    expect(
      canGiveWorkflowRunAs({
        state: { runAs: "Root" },
        rows: rows([row(Permission.ProjectOwner)]),
      }),
    ).toBe(true);
  });
});

describe("what a locked button says", () => {
  test("nothing for Default, or for someone who may", () => {
    expect(
      getWorkflowRunAsLockedReasons({
        state: { runAs: WorkflowRunAs.Default },
        mayAct: false,
        translator: ENGLISH,
      }),
    ).toEqual({});
    expect(
      getWorkflowRunAsLockedReasons({
        state: { runAs: WorkflowRunAs.ProjectOwner },
        mayAct: true,
        translator: ENGLISH,
      }),
    ).toEqual({});
  });

  test("the server's own words, for Project Owner", () => {
    expect(
      getWorkflowRunAsLockedReasons({
        state: { runAs: WorkflowRunAs.ProjectOwner },
        mayAct: false,
        translator: ENGLISH,
      }),
    ).toEqual({
      change: getWorkflowRunAsChangeRefusedMessage({
        runAs: WorkflowRunAs.ProjectOwner,
      }),
      run: getWorkflowRunAsRunRefusedMessage({
        runAs: WorkflowRunAs.ProjectOwner,
      }),
    });
  });

  test("the server's own words, for a custom role by its name", () => {
    const choice: { runAs: WorkflowRunAs; customRoleName: string } = {
      runAs: WorkflowRunAs.CustomRole,
      customRoleName: "Team Provisioner",
    };

    expect(
      getWorkflowRunAsLockedReasons({
        state: {
          runAs: WorkflowRunAs.CustomRole,
          roleName: "Team Provisioner",
        },
        mayAct: false,
        translator: ENGLISH,
      }),
    ).toEqual({
      change: getWorkflowRunAsChangeRefusedMessage(choice),
      run: getWorkflowRunAsRunRefusedMessage(choice),
    });
  });
});
