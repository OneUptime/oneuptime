import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import CustomRolePermissionService from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import WorkflowLabelRuleEngineService from "../../../Server/Services/WorkflowLabelRuleEngineService";
import WorkflowOwnerRuleEngineService from "../../../Server/Services/WorkflowOwnerRuleEngineService";
import WorkflowService from "../../../Server/Services/WorkflowService";
import WorkflowVersionService from "../../../Server/Services/WorkflowVersionService";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import logger from "../../../Server/Utils/Logger";
import WorkflowsOfDeletedRoles from "../../../Server/Utils/Workflow/WorkflowsOfDeletedRoles";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_DELETED_MESSAGE,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_MISSING_MESSAGE,
  WORKFLOWS_RUN_AS_INSTEAD_UNKNOWN_MESSAGE,
  WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE,
  WorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";
import API from "../../../Utils/API";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * DELETING A CUSTOM ROLE THAT WORKFLOWS RUN AS (#9767).
 *
 * Deleted, the role used to leave its workflows running nothing, and
 * nobody knew until someone read a run. Now a delete of such a role says
 * what they run as instead - Default, or another custom role the deleter
 * could give a team - and they are switched as the role goes; a delete
 * that does not say is refused, naming them. The deleter must be able to
 * edit the workflows, and give the other role. The real delete and update
 * pipelines run - hooks and permission checks - over tables in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9a670000-0000-4000-8000-000000000001",
);
const DELETED_ROLE_ID: string = "9a670000-0000-4000-8000-0000000000c1";
const OTHER_ROLE_ID: string = "9a670000-0000-4000-8000-0000000000c2";
const UNTOUCHED_ROLE_ID: string = "9a670000-0000-4000-8000-0000000000c3";
const UNUSED_ROLE_ID: string = "9a670000-0000-4000-8000-0000000000c4";
const ONBOARD_WORKFLOW_ID: string = "9a670000-0000-4000-8000-0000000000f1";
const SYNC_WORKFLOW_ID: string = "9a670000-0000-4000-8000-0000000000f2";
const OTHER_ROLE_WORKFLOW_ID: string = "9a670000-0000-4000-8000-0000000000f3";
const DEFAULT_WORKFLOW_ID: string = "9a670000-0000-4000-8000-0000000000f4";
const FIRST_GIVER_ID: string = "9a670000-0000-4000-8000-0000000000a1";

// What each role holds, as the Run As check reads it.
const ROLE_PERMISSIONS: Record<string, Permission> = {
  [DELETED_ROLE_ID]: Permission.IncidentMember,
  [OTHER_ROLE_ID]: Permission.IncidentAdmin,
  [UNTOUCHED_ROLE_ID]: Permission.MonitorAdmin,
  [UNUSED_ROLE_ID]: Permission.AlertMember,
};

function rows(permissions: Array<Permission>): Array<UserPermission> {
  return permissions.map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
    };
  });
}

// A person of the project holding `permissions`.
function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows(permissions),
      },
    },
  };
}

// An API key of the project holding `permissions`.
function apiKey(
  permissions: Array<Permission>,
  apiKeyId: ObjectID,
): DatabaseCommonInteractionProps {
  return {
    ...ON_HIGHEST_PLAN,
    tenantId: PROJECT_ID,
    userType: UserType.API,
    apiKeyId: apiKeyId,
    apiKeyName: "Terraform",
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows(permissions),
      },
    },
  };
}

// Deletes custom roles and edits workflows, holding `extra` besides.
function editor(extra: Array<Permission> = []): DatabaseCommonInteractionProps {
  return member([
    Permission.EditProjectTeamPermissions,
    Permission.EditWorkflow,
    Permission.ReadWorkflow,
    ...extra,
  ]);
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("It was not refused.");
}

describe("deleting a custom role that workflows run as", () => {
  let roles: InMemoryTable;
  let workflows: InMemoryTable;

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    stubProjectDirectory({});

    getJestSpyOn(CustomRoleSync, "getTeamIdsGivenRoles").mockResolvedValue([]);
    getJestSpyOn(CustomRoleSync, "refreshMembersOfTeams").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(
      ApiKeyPermissionService,
      "forgetPermissionsOfProjects",
    ).mockResolvedValue(undefined);

    getJestSpyOn(
      CustomRolePermissionService,
      "findPermissionsOfRole",
    ).mockImplementation((async (data: { customRoleId: ObjectID }) => {
      const permission: CustomRolePermission = new CustomRolePermission();
      permission.permission =
        ROLE_PERMISSIONS[data.customRoleId.toString().toLowerCase()]!;
      permission.scope = PermissionScope.All;
      permission.labels = [];
      return [permission];
    }) as never);

    getJestSpyOn(API, "post").mockResolvedValue({});
    getJestSpyOn(
      WorkflowLabelRuleEngineService,
      "applyRulesToWorkflow",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      WorkflowOwnerRuleEngineService,
      "applyRulesToWorkflow",
    ).mockResolvedValue(undefined);
    for (const method of [
      "recordCreated",
      "recordEarlierVersionIfNone",
      "recordGraphSave",
    ]) {
      getJestSpyOn(WorkflowVersionService, method).mockResolvedValue(undefined);
    }

    roles = useInMemoryTable(CustomRoleService, [
      {
        _id: DELETED_ROLE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Team Provisioner",
        slug: "team-provisioner",
        version: 1,
      },
      {
        _id: OTHER_ROLE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Incident Automation",
        slug: "incident-automation",
        version: 1,
      },
      {
        _id: UNTOUCHED_ROLE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Monitor Automation",
        slug: "monitor-automation",
        version: 1,
      },
      {
        _id: UNUSED_ROLE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Nobody's",
        slug: "nobodys",
        version: 1,
      },
    ]);

    const base: StoredRow = {
      projectId: PROJECT_ID.toString(),
      isEnabled: true,
      isArchived: false,
      graph: { nodes: [], edges: [] },
      graphRevision: 1,
      webhookSecretKey: "the-webhook-key",
      version: 1,
    };

    workflows = useInMemoryTable(WorkflowService, [
      {
        ...base,
        _id: ONBOARD_WORKFLOW_ID,
        name: "Onboard New Teams",
        slug: "onboard-new-teams",
        runAs: WorkflowRunAs.CustomRole,
        runAsCustomRoleId: DELETED_ROLE_ID,
        runAsGivenByUserId: FIRST_GIVER_ID,
        runAsGivenAt: new Date("2026-11-01T10:00:00.000Z"),
      },
      {
        ...base,
        _id: SYNC_WORKFLOW_ID,
        name: "Nightly Access Sync",
        slug: "nightly-access-sync",
        isArchived: true,
        runAs: WorkflowRunAs.CustomRole,
        runAsCustomRoleId: DELETED_ROLE_ID,
        runAsGivenByUserId: FIRST_GIVER_ID,
        runAsGivenAt: new Date("2026-11-01T10:00:00.000Z"),
      },
      {
        ...base,
        _id: OTHER_ROLE_WORKFLOW_ID,
        name: "Escalate Monitors",
        slug: "escalate-monitors",
        runAs: WorkflowRunAs.CustomRole,
        runAsCustomRoleId: UNTOUCHED_ROLE_ID,
        runAsGivenByUserId: FIRST_GIVER_ID,
        runAsGivenAt: new Date("2026-11-01T10:00:00.000Z"),
      },
      {
        ...base,
        _id: DEFAULT_WORKFLOW_ID,
        name: "Close stale incidents",
        slug: "close-stale-incidents",
        runAs: WorkflowRunAs.Default,
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function deleteRole(
    roleId: string,
    props: DatabaseCommonInteractionProps,
    miscDataProps?: JSONObject,
  ): Promise<number> {
    return await CustomRoleService.deleteOneById({
      id: new ObjectID(roleId),
      props: props,
      ...(miscDataProps ? { miscDataProps: miscDataProps } : {}),
    });
  }

  function isDeleted(roleId: string): boolean {
    return roles.deletes.some((id: string): boolean => {
      return id.toLowerCase() === roleId;
    });
  }

  function stored(workflowId: string, column: string): unknown {
    return workflows.get(workflowId)?.[column];
  }

  test("a role no workflow runs as is deleted as before, with nothing said", async () => {
    await deleteRole(UNUSED_ROLE_ID, editor());

    expect(isDeleted(UNUSED_ROLE_ID)).toBe(true);
    expect(workflows.updates).toEqual([]);
  });

  test("one that workflows run as is not deleted without saying what they run as instead: the refusal names them, and how", async () => {
    const error: Error = await refusal(deleteRole(DELETED_ROLE_ID, editor()));

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      'The workflows "Onboard New Teams" and "Nightly Access Sync" run as the custom role "Team Provisioner". Deleting the role would stop them until someone changes what they run as, so say what they run as instead: choose it as you delete the role in the Dashboard, or send miscDataProps.workflowsRunAs as "Default", or as "CustomRole" with miscDataProps.workflowsRunAsCustomRoleId naming another custom role you could give a team.',
    );
    expect(isDeleted(DELETED_ROLE_ID)).toBe(false);
    expect(workflows.updates).toEqual([]);
  });

  test("a deleter who may not read the workflows is told how many, not their names", async () => {
    const error: Error = await refusal(
      deleteRole(
        DELETED_ROLE_ID,
        member([Permission.EditProjectTeamPermissions]),
      ),
    );

    expect(error.message).toContain(
      '2 workflows run as the custom role "Team Provisioner".',
    );
    expect(error.message).not.toContain("Onboard New Teams");
  });

  test("Default: the role is deleted, and its workflows run with the default permissions, nobody's", async () => {
    const deleter: DatabaseCommonInteractionProps = editor();

    await deleteRole(DELETED_ROLE_ID, deleter, {
      [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default,
    });

    expect(isDeleted(DELETED_ROLE_ID)).toBe(true);

    for (const workflowId of [ONBOARD_WORKFLOW_ID, SYNC_WORKFLOW_ID]) {
      expect(stored(workflowId, "runAs")).toBe(WorkflowRunAs.Default);
      expect(stored(workflowId, "runAsCustomRoleId")).toBeNull();
      expect(stored(workflowId, "runAsGivenByUserId")).toBeNull();
      expect(stored(workflowId, "runAsGivenByApiKeyId")).toBeNull();
    }

    // The archived one too: it would run nothing once unarchived.
    expect(stored(SYNC_WORKFLOW_ID, "isArchived")).toBe(true);
  });

  test("a deleter who holds less than the deleted role still says what its workflows run as: with it gone, any editor may choose", async () => {
    // The role holds Incident Member; this deleter does not.
    await deleteRole(DELETED_ROLE_ID, editor(), {
      [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default,
    });

    expect(stored(ONBOARD_WORKFLOW_ID, "runAs")).toBe(WorkflowRunAs.Default);
  });

  test("another custom role the deleter could give: the workflows run as it, given by the deleter, with new trigger keys", async () => {
    const deleter: DatabaseCommonInteractionProps = editor([
      Permission.IncidentAdmin,
    ]);

    await deleteRole(DELETED_ROLE_ID, deleter, {
      [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
      [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
    });

    expect(isDeleted(DELETED_ROLE_ID)).toBe(true);

    for (const workflowId of [ONBOARD_WORKFLOW_ID, SYNC_WORKFLOW_ID]) {
      expect(stored(workflowId, "runAs")).toBe(WorkflowRunAs.CustomRole);
      expect(String(stored(workflowId, "runAsCustomRoleId"))).toBe(
        OTHER_ROLE_ID,
      );
      expect(String(stored(workflowId, "runAsGivenByUserId"))).toBe(
        deleter.userId!.toString(),
      );
      expect(stored(workflowId, "webhookSecretKey")).not.toBe(
        "the-webhook-key",
      );
    }
  });

  test("not another custom role the deleter could not give: refused, naming what they lack, and nothing deleted", async () => {
    const error: Error = await refusal(
      deleteRole(DELETED_ROLE_ID, editor(), {
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toContain("the role has Incident Admin");
    expect(isDeleted(DELETED_ROLE_ID)).toBe(false);
    expect(stored(ONBOARD_WORKFLOW_ID, "runAsCustomRoleId")).toBe(
      DELETED_ROLE_ID,
    );
  });

  test("not the role being deleted, nor a role of nothing, nor a choice that is none", async () => {
    const deleter: DatabaseCommonInteractionProps = editor([
      Permission.IncidentAdmin,
      Permission.IncidentMember,
    ]);

    expect(
      (
        await refusal(
          deleteRole(DELETED_ROLE_ID, deleter, {
            [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
            [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: DELETED_ROLE_ID,
          }),
        )
      ).message,
    ).toBe(WORKFLOWS_RUN_AS_INSTEAD_ROLE_DELETED_MESSAGE);

    expect(
      (
        await refusal(
          deleteRole(DELETED_ROLE_ID, deleter, {
            [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
          }),
        )
      ).message,
    ).toBe(WORKFLOWS_RUN_AS_INSTEAD_ROLE_MISSING_MESSAGE);

    for (const value of [WorkflowRunAs.ProjectOwner, "Root", 7]) {
      expect(
        (
          await refusal(
            deleteRole(DELETED_ROLE_ID, deleter, {
              [WORKFLOWS_RUN_AS_INSTEAD_KEY]: value,
            }),
          )
        ).message,
      ).toBe(WORKFLOWS_RUN_AS_INSTEAD_UNKNOWN_MESSAGE);
    }

    expect(isDeleted(DELETED_ROLE_ID)).toBe(false);
  });

  test("a deleter who may not edit the workflows may not delete the role, and is told who can", async () => {
    // May read workflows, but not edit them.
    const reader: DatabaseCommonInteractionProps = member([
      Permission.EditProjectTeamPermissions,
      Permission.ReadWorkflow,
    ]);

    const named: Error = await refusal(
      deleteRole(DELETED_ROLE_ID, reader, {
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default,
      }),
    );

    expect(named).toBeInstanceOf(NotAuthorizedException);
    expect(named.message).toBe(
      "You can't change what the workflow \"Onboard New Teams\" runs as, so this custom role can't be deleted yet: deleting it changes what every workflow that runs as it runs as. Ask someone who can edit that workflow to choose what it runs as in its Settings, or to delete the role.",
    );

    // May not even read them: none is named.
    const unnamed: Error = await refusal(
      deleteRole(
        DELETED_ROLE_ID,
        member([Permission.EditProjectTeamPermissions]),
        { [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default },
      ),
    );

    expect(unnamed.message).toContain(
      "You can't change what one of the workflows that run as this custom role runs as",
    );
    expect(isDeleted(DELETED_ROLE_ID)).toBe(false);
  });

  test("an API key that may delete roles and edit workflows switches them too, and gives them the other role as itself", async () => {
    const keyId: ObjectID = ObjectID.generate();

    await deleteRole(
      DELETED_ROLE_ID,
      apiKey(
        [
          Permission.EditProjectTeamPermissions,
          Permission.EditWorkflow,
          Permission.ReadWorkflow,
          Permission.IncidentAdmin,
        ],
        keyId,
      ),
      {
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
      },
    );

    expect(String(stored(ONBOARD_WORKFLOW_ID, "runAsGivenByApiKeyId"))).toBe(
      keyId.toString(),
    );
    expect(stored(ONBOARD_WORKFLOW_ID, "runAsGivenByUserId")).toBeNull();
  });

  test("the master API key may not give them another role", async () => {
    const error: Error = await refusal(
      deleteRole(
        DELETED_ROLE_ID,
        {
          ...editor([Permission.ProjectOwner]),
          userType: UserType.MasterAdmin,
          isMasterAdmin: true,
          apiKeyName: "Master API Key",
        },
        {
          [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
          [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: OTHER_ROLE_ID,
        },
      ),
    );

    expect(error.message).toBe(WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE);
    expect(isDeleted(DELETED_ROLE_ID)).toBe(false);
  });

  test("workflows of other roles, and Default ones, are left alone", async () => {
    await deleteRole(DELETED_ROLE_ID, editor(), {
      [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default,
    });

    expect(stored(OTHER_ROLE_WORKFLOW_ID, "runAs")).toBe(
      WorkflowRunAs.CustomRole,
    );
    expect(stored(OTHER_ROLE_WORKFLOW_ID, "runAsCustomRoleId")).toBe(
      UNTOUCHED_ROLE_ID,
    );
    expect(
      workflows.updates.filter(
        (update: { id: string; set: StoredRow }): boolean => {
          return [OTHER_ROLE_WORKFLOW_ID, DEFAULT_WORKFLOW_ID].includes(
            update.id.toLowerCase(),
          );
        },
      ),
    ).toEqual([]);
  });

  test("OneUptime's own delete asks nothing, as before", async () => {
    await deleteRole(DELETED_ROLE_ID, { isRoot: true });

    expect(isDeleted(DELETED_ROLE_ID)).toBe(true);
    expect(workflows.updates).toEqual([]);
  });
});

describe("what a delete says its workflows run as instead", () => {
  test("nothing said is none", () => {
    for (const miscDataProps of [
      undefined,
      null,
      {},
      { [WORKFLOWS_RUN_AS_INSTEAD_KEY]: "" },
      { [WORKFLOWS_RUN_AS_INSTEAD_KEY]: null },
    ]) {
      expect(
        WorkflowsOfDeletedRoles.readInstead(
          miscDataProps as JSONObject | undefined | null,
        ),
      ).toBeNull();
    }
  });

  test("Default, or a custom role by its id", () => {
    expect(
      WorkflowsOfDeletedRoles.readInstead({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.Default,
      }),
    ).toEqual({ runAs: WorkflowRunAs.Default });

    expect(
      WorkflowsOfDeletedRoles.readInstead({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: ` ${OTHER_ROLE_ID} `,
      }),
    ).toEqual({
      runAs: WorkflowRunAs.CustomRole,
      customRoleId: new ObjectID(OTHER_ROLE_ID),
    });
  });

  test("a role id that is no id is none, and refused", () => {
    expect(() => {
      return WorkflowsOfDeletedRoles.readInstead({
        [WORKFLOWS_RUN_AS_INSTEAD_KEY]: WorkflowRunAs.CustomRole,
        [WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY]: "not-a-role",
      });
    }).toThrow(WORKFLOWS_RUN_AS_INSTEAD_ROLE_MISSING_MESSAGE);
  });
});
