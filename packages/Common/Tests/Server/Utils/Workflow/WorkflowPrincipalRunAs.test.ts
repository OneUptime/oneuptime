import ApiKey from "../../../../Models/DatabaseModels/ApiKey";
import ProjectSmtpConfig from "../../../../Models/DatabaseModels/ProjectSmtpConfig";
import ProjectService from "../../../../Server/Services/ProjectService";
import TeamPermissionService from "../../../../Server/Services/TeamPermissionService";
import RelationListPermission from "../../../../Server/Types/Database/Permissions/RelationListPermission";
import { shouldBypassRecordPrivacy } from "../../../../Server/Utils/PrivacyFilterUtil";
import UserPermissionUtil from "../../../../Server/Utils/UserPermission/UserPermission";
import WorkflowPrincipal, {
  WorkflowRunAsGrant,
} from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { WorkflowRunAs } from "../../../../Types/Workflow/WorkflowRunAs";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT A STEP ACTS WITH, BY WHAT ITS WORKFLOW RUNS AS (#9695,
 * WorkflowPrincipal).
 *
 *   - Default: exactly the props a step had before Run As existed - a
 *     member's defaults, ProjectUser and Project Admin, and no mark - so
 *     every existing workflow acts as it did.
 *   - Project Owner: the same with Project Owner in place of Project Admin,
 *     marked so its steps may change teams and roles.
 *   - A custom role: the same with the role's rows in place of Project
 *     Admin - fresh copies, each step's own.
 *
 * Whatever it runs as, a step is no person, never root, still lent no read
 * of a setting that holds credentials, and sees no private record.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "99950000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "99950000-0000-4000-8000-000000000002",
);
const LABEL_ID: ObjectID = new ObjectID("99950000-0000-4000-8000-0000000000d1");

// The props a step acted with before Run As existed, built here by hand.
function propsBeforeRunAs(): DatabaseCommonInteractionProps {
  const member: UserTenantAccessPermission =
    UserPermissionUtil.withProjectUserPermission(
      UserPermissionUtil.getDefaultUserTenantAccessPermission(PROJECT_ID),
    );

  return {
    tenantId: PROJECT_ID,
    userType: UserType.Workflow,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
      ],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        ...member,
        permissions: [
          ...member.permissions,
          {
            permission: Permission.ProjectAdmin,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          },
        ],
      },
    },
    workflowId: WORKFLOW_ID,
    workflowName: "Close stale incidents",
  };
}

function principal(
  runAs?: WorkflowRunAsGrant | undefined,
): DatabaseCommonInteractionProps {
  return WorkflowPrincipal.getPropsWithoutPlan({
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
    workflowName: "Close stale incidents",
    runAs: runAs,
  });
}

function rowsOf(props: DatabaseCommonInteractionProps): Array<UserPermission> {
  return props.userTenantAccessPermission![PROJECT_ID.toString()]!.permissions;
}

function allowed(props: DatabaseCommonInteractionProps): Array<string> {
  return DatabaseCommonInteractionPropsUtil.getUserPermissions(
    props,
    PermissionType.Allow,
  ).map((row: UserPermission): string => {
    return row.permission;
  });
}

const ROLE_RUN: WorkflowRunAsGrant = {
  runAs: WorkflowRunAs.CustomRole,
  customRoleId: ObjectID.generate(),
  customRoleName: "Team Provisioner",
  rolePermissions: [
    {
      _type: "UserPermission",
      permission: Permission.EditProjectTeamPermissions,
      labelIds: [],
      scope: PermissionScope.All,
      isBlockPermission: false,
    },
    {
      _type: "UserPermission",
      permission: Permission.IncidentMember,
      labelIds: [LABEL_ID],
      scope: PermissionScope.Labels,
      isBlockPermission: false,
    },
  ],
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Default: exactly as before Run As existed", () => {
  test("no Run As, and Run As Default, give the very props a step had", () => {
    expect(principal()).toEqual(propsBeforeRunAs());
    expect(principal({ runAs: WorkflowRunAs.Default })).toEqual(
      propsBeforeRunAs(),
    );
  });

  test("they carry no mark, so the access rule reads them as Default", () => {
    expect("workflowRunAs" in principal()).toBe(false);
    expect("workflowRunAs" in principal({ runAs: WorkflowRunAs.Default })).toBe(
      false,
    );
  });

  test("Project Admin is the one role, and no Project Owner", () => {
    expect(allowed(principal())).toContain(Permission.ProjectAdmin);
    expect(allowed(principal())).not.toContain(Permission.ProjectOwner);
    expect(WorkflowPrincipal.PERMISSION).toBe(Permission.ProjectAdmin);
  });
});

describe("Project Owner", () => {
  const owner: () => DatabaseCommonInteractionProps =
    (): DatabaseCommonInteractionProps => {
      return principal({ runAs: WorkflowRunAs.ProjectOwner });
    };

  test("holds Project Owner for the whole project in place of Project Admin, with the member's defaults", () => {
    const rows: Array<UserPermission> = rowsOf(owner());
    const defaults: Array<UserPermission> = rowsOf(principal()).slice(0, -1);

    expect(rows.slice(0, -1)).toEqual(defaults);
    expect(rows[rows.length - 1]).toEqual({
      permission: Permission.ProjectOwner,
      labelIds: [],
      isBlockPermission: false,
      _type: "UserPermission",
    });
    expect(allowed(owner())).not.toContain(Permission.ProjectAdmin);
  });

  test("is marked, and may hand on any permission, as a Project Owner may", () => {
    expect(owner().workflowRunAs).toBe(WorkflowRunAs.ProjectOwner);
    expect(TeamPermissionService.canGrantEveryPermission(owner())).toBe(true);
  });
});

describe("a custom role", () => {
  test("holds the role's rows in place of Project Admin, at their scope and labels, and nothing more", () => {
    const rows: Array<UserPermission> = rowsOf(principal(ROLE_RUN));
    const defaults: Array<UserPermission> = rowsOf(principal()).slice(0, -1);

    expect(rows.slice(0, defaults.length)).toEqual(defaults);
    expect(rows.slice(defaults.length)).toEqual(ROLE_RUN.rolePermissions);
    expect(allowed(principal(ROLE_RUN))).not.toContain(Permission.ProjectAdmin);
    expect(principal(ROLE_RUN).workflowRunAs).toBe(WorkflowRunAs.CustomRole);
  });

  test("hands on only what the role holds", () => {
    expect(
      TeamPermissionService.canGrantEveryPermission(principal(ROLE_RUN)),
    ).toBe(false);
    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.ProjectAdmin,
        scope: PermissionScope.All,
        props: principal(ROLE_RUN),
      });
    }).toThrow(
      "This workflow cannot grant Project Admin because the permissions it runs with do not include that permission at an equal or broader scope.",
    );
  });

  test("each step gets its own copies: one step's change reaches neither the next nor the run's grant", () => {
    const first: Array<UserPermission> = rowsOf(principal(ROLE_RUN));
    first[first.length - 1]!.permission = Permission.ProjectOwner;
    first[first.length - 1]!.labelIds.push(ObjectID.generate());

    const second: Array<UserPermission> = rowsOf(principal(ROLE_RUN));

    expect(second[second.length - 1]!.permission).toBe(
      Permission.IncidentMember,
    );
    expect(second[second.length - 1]!.labelIds).toHaveLength(1);
    expect(ROLE_RUN.rolePermissions![1]!.permission).toBe(
      Permission.IncidentMember,
    );
  });

  test("a role that gives a workflow nothing gives its steps only the member's defaults", () => {
    const bare: DatabaseCommonInteractionProps = principal({
      runAs: WorkflowRunAs.CustomRole,
      rolePermissions: [],
    });

    expect(rowsOf(bare)).toEqual(rowsOf(principal()).slice(0, -1));
  });
});

describe("whatever it runs as", () => {
  const RUNS: Array<[string, WorkflowRunAsGrant | undefined]> = [
    ["Default", undefined],
    ["Project Owner", { runAs: WorkflowRunAs.ProjectOwner }],
    ["a custom role", ROLE_RUN],
  ];

  test.each(RUNS)(
    "%s: a step is no person, never root nor a server admin, in its own project only",
    (_name: string, runAs: WorkflowRunAsGrant | undefined) => {
      const props: DatabaseCommonInteractionProps = principal(runAs);

      expect(props.userType).toBe(UserType.Workflow);
      expect(props.userId).toBeUndefined();
      expect(props.isRoot).toBeUndefined();
      expect(props.isMasterAdmin).toBeUndefined();
      expect(props.tenantId).toBe(PROJECT_ID);
      expect(Object.keys(props.userTenantAccessPermission || {})).toEqual([
        PROJECT_ID.toString(),
      ]);
      expect(WorkflowPrincipal.isWorkflow(props)).toBe(true);
    },
  );

  test.each(RUNS)(
    "%s: a step is still lent no read of a setting that holds credentials",
    (_name: string, runAs: WorkflowRunAsGrant | undefined) => {
      for (const modelType of [ApiKey, ProjectSmtpConfig]) {
        expect(
          RelationListPermission.isReadWithheldFromWorkflow(
            modelType,
            principal(runAs),
          ),
        ).toBe(true);
      }
    },
  );

  test.each(RUNS)(
    "%s: a step still sees no private incident, alert or episode",
    (_name: string, runAs: WorkflowRunAsGrant | undefined) => {
      expect(shouldBypassRecordPrivacy(principal(runAs))).toBe(false);
    },
  );

  test("the project's plan is read for it, and what it runs as is kept", async () => {
    getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
    });

    const props: DatabaseCommonInteractionProps =
      await WorkflowPrincipal.getProps({
        projectId: PROJECT_ID,
        workflowId: WORKFLOW_ID,
        runAs: { runAs: WorkflowRunAs.ProjectOwner },
      });

    expect(props.workflowRunAs).toBe(WorkflowRunAs.ProjectOwner);
    expect(allowed(props)).toContain(Permission.ProjectOwner);
  });

  test("Default and anything that cannot be read are not raised", () => {
    expect(WorkflowPrincipal.isRaised(undefined)).toBe(false);
    expect(WorkflowPrincipal.isRaised(WorkflowRunAs.Default)).toBe(false);
    expect(WorkflowPrincipal.isRaised("Root")).toBe(false);
    expect(WorkflowPrincipal.isRaised(WorkflowRunAs.ProjectOwner)).toBe(true);
    expect(WorkflowPrincipal.isRaised(WorkflowRunAs.CustomRole)).toBe(true);
  });
});
