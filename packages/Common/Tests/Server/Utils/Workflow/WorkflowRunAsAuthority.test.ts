import CustomRole from "../../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../../Models/DatabaseModels/Label";
import User from "../../../../Models/DatabaseModels/User";
import ApiKey from "../../../../Models/DatabaseModels/ApiKey";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ApiKeyPermissionService, {
  ApiKeyPermissionRow,
} from "../../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../../Server/Services/ApiKeyService";
import CustomRolePermissionService from "../../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../../Server/Services/CustomRoleService";
import UserService from "../../../../Server/Services/UserService";
import WorkflowPrincipal, {
  WorkflowRunAsGrant,
} from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import WorkflowRunAsAuthority, {
  WorkflowRunAsAction,
  WorkflowRunAsGiverKind,
  WorkflowRunAsRefusedException,
  WorkflowRunAsRole,
} from "../../../../Server/Utils/Workflow/WorkflowRunAsAuthority";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import Email from "../../../../Types/Email";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE,
  WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE,
  WORKFLOW_RUN_AS_ROLE_DELETED_MESSAGE,
  WORKFLOW_RUN_AS_ROLE_MISSING_MESSAGE,
  WORKFLOW_RUN_AS_ROLE_NOT_FOUND_MESSAGE,
  WORKFLOW_RUN_AS_UNKNOWN_MESSAGE,
  WORKFLOW_RUN_AS_UNREADABLE_MESSAGE,
  WorkflowRunAs,
} from "../../../../Types/Workflow/WorkflowRunAs";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHO MAY GIVE A WORKFLOW ITS PERMISSIONS, WHO MAY ACT ON ONE THAT HAS
 * THEM, AND WHAT EACH RUN ACTS AS (#9695, WorkflowRunAsAuthority).
 *
 * One question decides each: could the holder give a team those
 * permissions themselves - the grant ceiling of TeamPermissionService,
 * which runs here for real. Only the reads are stubbed: the custom role
 * and its permissions, the person or the project API key (#9765) who gave
 * a workflow its permissions, and their permissions in the project as they
 * are now.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "95950000-0000-4000-8000-000000000001",
);
const ROLE_ID: ObjectID = new ObjectID("95950000-0000-4000-8000-0000000000c1");
const GIVER_ID: ObjectID = new ObjectID("95950000-0000-4000-8000-0000000000a1");
const LABEL_A: ObjectID = new ObjectID("95950000-0000-4000-8000-0000000000d1");
const LABEL_B: ObjectID = new ObjectID("95950000-0000-4000-8000-0000000000d2");

interface RowOptions {
  labelIds?: Array<ObjectID> | undefined;
  scope?: PermissionScope | undefined;
  isBlockPermission?: boolean | undefined;
}

function row(permission: Permission, options?: RowOptions): UserPermission {
  const made: UserPermission = {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelIds || [],
    isBlockPermission: Boolean(options?.isBlockPermission),
  };

  if (options?.scope) {
    made.scope = options.scope;
  }

  return made;
}

// A person signed in to the project with these rows.
function person(
  rows: Array<UserPermission>,
  extra?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...extra,
  };
}

const OWNER: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return person([row(Permission.ProjectOwner)]);
  };

const ADMIN: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return person([row(Permission.ProjectAdmin)]);
  };

const KEY_ID: ObjectID = new ObjectID("95950000-0000-4000-8000-0000000000b1");

/*
 * A request one of the project's API keys made (ProjectMiddleware): no
 * person, its own rows, its id and its name.
 */
function apiKey(
  rows: Array<UserPermission>,
  extra?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.API,
    apiKeyId: KEY_ID,
    apiKeyName: "Terraform",
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...extra,
  };
}

/*
 * A request the server's master API key made: the master admin, named as
 * the key (ProjectMiddleware.MASTER_API_KEY_AUDIT_NAME), with no key of a
 * project - whatever rows its master admin holds in the project.
 */
function masterKey(
  rows: Array<UserPermission> = [row(Permission.ProjectOwner)],
): DatabaseCommonInteractionProps {
  return person(rows, {
    userType: UserType.MasterAdmin,
    isMasterAdmin: true,
    apiKeyName: "Master API Key",
  });
}

// A workflow's step, of a workflow that runs as Project Owner.
function ownerStep(): DatabaseCommonInteractionProps {
  return WorkflowPrincipal.getPropsWithoutPlan({
    projectId: PROJECT_ID,
    workflowId: ObjectID.generate(),
    runAs: { runAs: WorkflowRunAs.ProjectOwner },
  });
}

function rolePermission(
  permission: Permission,
  options?: { scope?: PermissionScope; labelIds?: Array<ObjectID> },
): CustomRolePermission {
  const model: CustomRolePermission = new CustomRolePermission();
  model.id = ObjectID.generate();
  model.permission = permission;

  if (options?.scope) {
    model.scope = options.scope;
  }

  model.labels = (options?.labelIds || []).map((labelId: ObjectID): Label => {
    const label: Label = new Label();
    label.id = labelId;
    return label;
  });

  return model;
}

// The project's custom role ROLE_ID, holding these permissions.
function givenRole(
  permissions: Array<CustomRolePermission>,
  name: string = "Team Provisioner",
): void {
  const role: CustomRole = new CustomRole();
  role.id = ROLE_ID;
  role.name = name;

  getJestSpyOn(CustomRoleService, "findOneBy").mockResolvedValue(role);
  getJestSpyOn(
    CustomRolePermissionService,
    "findPermissionsOfRole",
  ).mockResolvedValue(permissions);
}

function noRole(): void {
  getJestSpyOn(CustomRoleService, "findOneBy").mockResolvedValue(null);
  getJestSpyOn(
    CustomRolePermissionService,
    "findPermissionsOfRole",
  ).mockResolvedValue([]);
}

// The person who gave a workflow its permissions, as they are now.
function givenGiver(data: {
  rows: Array<UserPermission> | null;
  isBlocked?: boolean;
  exists?: boolean;
  extra?: Partial<DatabaseCommonInteractionProps>;
}): void {
  const user: User = new User();
  user.id = GIVER_ID;
  user.name = new Name("Jane Doe");
  user.email = new Email("jane@example.com");
  user.isBlocked = Boolean(data.isBlocked);
  user.isDisabled = false;

  getJestSpyOn(UserService, "findOneById").mockResolvedValue(
    data.exists === false ? null : user,
  );

  getJestSpyOn(
    AccessTokenService,
    "getDatabaseCommonInteractionPropsByUserAndProject",
  ).mockResolvedValue({
    userId: GIVER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: data.rows
        ? {
            _type: "UserTenantAccessPermission",
            projectId: PROJECT_ID,
            permissions: data.rows,
          }
        : (null as never),
    },
    ...data.extra,
  } as DatabaseCommonInteractionProps);
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("It was not refused.");
}

beforeEach(() => {
  noRole();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who is a person", () => {
  test("someone signed in as themselves, a master admin among them, or through a tool they authorized", () => {
    expect(WorkflowRunAsAuthority.isPerson(OWNER())).toBe(true);
    expect(
      WorkflowRunAsAuthority.isPerson(
        person([], { userType: UserType.MasterAdmin }),
      ),
    ).toBe(true);
    expect(
      WorkflowRunAsAuthority.isPerson(
        person([], { mcpOAuthGrantId: ObjectID.generate() }),
      ),
    ).toBe(true);
  });

  test("never an API key - the master key included - a workflow, OneUptime or nobody", () => {
    expect(
      WorkflowRunAsAuthority.isPerson(
        person([], {
          userType: UserType.API,
          userId: undefined,
          apiKeyId: ObjectID.generate(),
        }),
      ),
    ).toBe(false);
    expect(
      WorkflowRunAsAuthority.isPerson(
        person([], {
          userType: UserType.MasterAdmin,
          apiKeyName: "Master API Key",
        }),
      ),
    ).toBe(false);
    expect(
      WorkflowRunAsAuthority.isPerson(
        WorkflowPrincipal.getPropsWithoutPlan({
          projectId: PROJECT_ID,
          workflowId: ObjectID.generate(),
          runAs: { runAs: WorkflowRunAs.ProjectOwner },
        }),
      ),
    ).toBe(false);
    expect(WorkflowRunAsAuthority.isPerson(person([], { isRoot: true }))).toBe(
      false,
    );
    expect(WorkflowRunAsAuthority.isPerson({ userType: UserType.Public })).toBe(
      false,
    );
  });
});

describe("the rows a custom role gives a workflow", () => {
  test("every permission at the role's scope, labels only where the scope is Labels, and none limited to what someone owns", () => {
    const rows: Array<UserPermission> = WorkflowRunAsAuthority.getRoleRows([
      rolePermission(Permission.EditProjectTeamPermissions),
      rolePermission(Permission.IncidentAdmin, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_A],
      }),
      rolePermission(Permission.MonitorAdmin, {
        scope: PermissionScope.All,
        labelIds: [LABEL_B],
      }),
      rolePermission(Permission.AlertAdmin, { scope: PermissionScope.Owned }),
    ]);

    expect(
      rows.map((made: UserPermission) => {
        return {
          permission: made.permission,
          scope: made.scope,
          labels: made.labelIds.map((id: ObjectID): string => {
            return id.toString();
          }),
          block: made.isBlockPermission,
        };
      }),
    ).toEqual([
      {
        permission: Permission.EditProjectTeamPermissions,
        scope: PermissionScope.All,
        labels: [],
        block: false,
      },
      {
        permission: Permission.IncidentAdmin,
        scope: PermissionScope.Labels,
        labels: [LABEL_A.toString()],
        block: false,
      },
      {
        permission: Permission.MonitorAdmin,
        scope: PermissionScope.All,
        labels: [],
        block: false,
      },
    ]);
  });

  test("the role is read in the workflow's own project, and one that is not there is none", async () => {
    const findOneBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      CustomRoleService,
      "findOneBy",
    ).mockResolvedValue(null);

    expect(
      await WorkflowRunAsAuthority.readRole({
        customRoleId: ROLE_ID,
        projectId: PROJECT_ID,
      }),
    ).toBeNull();

    const query: Record<string, unknown> = (
      findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["_id"]).toBe(ROLE_ID);
    expect(query["projectId"]).toBe(PROJECT_ID);
  });
});

describe("what a holder lacks to give a workflow what it runs as", () => {
  function missing(
    runAs: WorkflowRunAs,
    holderRows: Array<UserPermission>,
    roleRows?: Array<UserPermission>,
  ): Permission | null {
    const role: WorkflowRunAsRole | null = roleRows
      ? { id: ROLE_ID, name: "Team Provisioner", rows: roleRows }
      : null;

    return WorkflowRunAsAuthority.findMissingPermission({
      runAs: runAs,
      role: role,
      holderProps: person(holderRows),
    });
  }

  test("Default takes nothing", () => {
    expect(missing(WorkflowRunAs.Default, [])).toBeNull();
  });

  test("Project Owner takes an unblocked Project Owner for the whole project", () => {
    expect(
      missing(WorkflowRunAs.ProjectOwner, [row(Permission.ProjectOwner)]),
    ).toBeNull();
    expect(
      missing(WorkflowRunAs.ProjectOwner, [row(Permission.ProjectAdmin)]),
    ).toBe(Permission.ProjectOwner);
    expect(
      missing(WorkflowRunAs.ProjectOwner, [
        row(Permission.ProjectOwner),
        row(Permission.ProjectOwner, { isBlockPermission: true }),
      ]),
    ).toBe(Permission.ProjectOwner);
    expect(
      missing(WorkflowRunAs.ProjectOwner, [
        row(Permission.ProjectOwner, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_A],
        }),
      ]),
    ).toBe(Permission.ProjectOwner);
    expect(missing(WorkflowRunAs.ProjectOwner, [])).toBe(
      Permission.ProjectOwner,
    );
  });

  test("a custom role takes each of its rows, as giving it to a team does", () => {
    const roleRows: Array<UserPermission> = [
      row(Permission.EditProjectTeamPermissions, {
        scope: PermissionScope.All,
      }),
      row(Permission.IncidentAdmin, { scope: PermissionScope.All }),
    ];

    // Holds both, project-wide.
    expect(
      missing(
        WorkflowRunAs.CustomRole,
        [
          row(Permission.EditProjectTeamPermissions),
          row(Permission.IncidentAdmin),
        ],
        roleRows,
      ),
    ).toBeNull();

    // A Project Admin does not hold Incident Admin, which the role gives.
    expect(
      missing(
        WorkflowRunAs.CustomRole,
        [row(Permission.ProjectAdmin)],
        roleRows,
      ),
    ).toBe(Permission.EditProjectTeamPermissions);
    expect(
      missing(
        WorkflowRunAs.CustomRole,
        [row(Permission.EditProjectTeamPermissions)],
        roleRows,
      ),
    ).toBe(Permission.IncidentAdmin);

    // A Project Owner gives any role.
    expect(
      missing(
        WorkflowRunAs.CustomRole,
        [row(Permission.ProjectOwner)],
        roleRows,
      ),
    ).toBeNull();
  });

  test("a row limited to labels is covered by the same permission on those labels, never by a narrower one", () => {
    const labelled: Array<UserPermission> = [
      row(Permission.IncidentAdmin, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_A],
      }),
    ];

    expect(
      missing(
        WorkflowRunAs.CustomRole,
        [
          row(Permission.IncidentAdmin, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_A, LABEL_B],
          }),
        ],
        labelled,
      ),
    ).toBeNull();

    // A project-wide row of the role is not covered by a labelled one.
    expect(
      missing(
        WorkflowRunAs.CustomRole,
        [
          row(Permission.IncidentAdmin, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_A],
          }),
        ],
        [row(Permission.IncidentAdmin, { scope: PermissionScope.All })],
      ),
    ).toBe(Permission.IncidentAdmin);
  });

  test("a block on the permission takes it away", () => {
    expect(
      missing(
        WorkflowRunAs.CustomRole,
        [
          row(Permission.IncidentAdmin),
          row(Permission.IncidentAdmin, { isBlockPermission: true }),
        ],
        [row(Permission.IncidentAdmin, { scope: PermissionScope.All })],
      ),
    ).toBe(Permission.IncidentAdmin);
  });

  test("a role with nothing, or a role that is gone, takes nothing", () => {
    expect(missing(WorkflowRunAs.CustomRole, [], [])).toBeNull();
    expect(missing(WorkflowRunAs.CustomRole, [])).toBeNull();
  });
});

describe("choosing what a workflow runs as", () => {
  test("Default is anyone's, as it always was - an API key's too", async () => {
    for (const props of [
      ADMIN(),
      person([row(Permission.ProjectMember)]),
      person([], {
        userType: UserType.API,
        userId: undefined,
        apiKeyId: ObjectID.generate(),
      }),
    ]) {
      expect(
        await WorkflowRunAsAuthority.assertMayGive({
          setting: { runAs: WorkflowRunAs.Default },
          projectId: PROJECT_ID,
          props: props,
        }),
      ).toBeNull();
    }
  });

  test("Project Owner is a Project Owner's to give", async () => {
    await WorkflowRunAsAuthority.assertMayGive({
      setting: { runAs: WorkflowRunAs.ProjectOwner },
      projectId: PROJECT_ID,
      props: OWNER(),
    });

    for (const props of [
      ADMIN(),
      person([row(Permission.WorkflowAdmin)]),
      person([row(Permission.ProjectMember)]),
    ]) {
      const error: Error = await refusal(
        WorkflowRunAsAuthority.assertMayGive({
          setting: { runAs: WorkflowRunAs.ProjectOwner },
          projectId: PROJECT_ID,
          props: props,
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE);
    }
  });

  test("a master admin's pass is no Project Owner of the project: their own permissions there decide", async () => {
    const error: Error = await refusal(
      WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: WorkflowRunAs.ProjectOwner },
        projectId: PROJECT_ID,
        props: person([], {
          isMasterAdmin: true,
          userType: UserType.MasterAdmin,
        }),
      }),
    );

    expect(error.message).toBe(WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE);

    await WorkflowRunAsAuthority.assertMayGive({
      setting: { runAs: WorkflowRunAs.ProjectOwner },
      projectId: PROJECT_ID,
      props: person([row(Permission.ProjectOwner)], {
        isMasterAdmin: true,
        userType: UserType.MasterAdmin,
      }),
    });
  });

  test("a workflow running as Project Owner, and the master API key, may not give it: neither has permissions of its own to read again", async () => {
    for (const props of [ownerStep(), masterKey()]) {
      const error: Error = await refusal(
        WorkflowRunAsAuthority.assertMayGive({
          setting: { runAs: WorkflowRunAs.ProjectOwner },
          projectId: PROJECT_ID,
          props: props,
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE);
    }
  });

  test("a custom role is given only by someone who could give it to a team, and the refusal names the permission", async () => {
    givenRole([
      rolePermission(Permission.EditProjectTeamPermissions),
      rolePermission(Permission.IncidentAdmin),
    ]);

    const role: WorkflowRunAsRole | null =
      await WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID },
        projectId: PROJECT_ID,
        props: person([
          row(Permission.EditProjectTeamPermissions),
          row(Permission.IncidentAdmin),
        ]),
      });

    expect(role?.name).toBe("Team Provisioner");
    expect(role?.rows).toHaveLength(2);

    const error: Error = await refusal(
      WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID },
        projectId: PROJECT_ID,
        props: person([row(Permission.EditProjectTeamPermissions)]),
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(
      `You can't let this workflow run as "Team Provisioner": the role has Incident Admin, and your own access doesn't include that permission at the same or a broader scope.`,
    );
  });

  test("a custom role must be named, and be the project's", async () => {
    const unnamed: Error = await refusal(
      WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: WorkflowRunAs.CustomRole },
        projectId: PROJECT_ID,
        props: OWNER(),
      }),
    );

    expect(unnamed).toBeInstanceOf(BadDataException);
    expect(unnamed.message).toBe(WORKFLOW_RUN_AS_ROLE_MISSING_MESSAGE);

    noRole();

    const elsewhere: Error = await refusal(
      WorkflowRunAsAuthority.assertMayGive({
        setting: {
          runAs: WorkflowRunAs.CustomRole,
          customRoleId: ObjectID.generate(),
        },
        projectId: PROJECT_ID,
        props: OWNER(),
      }),
    );

    expect(elsewhere.message).toBe(WORKFLOW_RUN_AS_ROLE_NOT_FOUND_MESSAGE);
  });

  test("a Run As that is none of the values is refused with them", async () => {
    const error: Error = await refusal(
      WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: "ProjectAdmin" },
        projectId: PROJECT_ID,
        props: OWNER(),
      }),
    );

    expect(error.message).toBe(WORKFLOW_RUN_AS_UNKNOWN_MESSAGE);
  });
});

describe("acting on a workflow that runs as more than Default", () => {
  const ownerSetting: { runAs: WorkflowRunAs } = {
    runAs: WorkflowRunAs.ProjectOwner,
  };

  test("a workflow that runs as Default is anyone's to act on, as before", async () => {
    for (const action of Object.values(WorkflowRunAsAction)) {
      await WorkflowRunAsAuthority.assertMayAct({
        setting: { runAs: WorkflowRunAs.Default },
        projectId: PROJECT_ID,
        props: person([row(Permission.WorkflowMember)]),
        action: action,
      });
    }
  });

  test("a Project Owner workflow is changed, run by hand and given variables only by a Project Owner", async () => {
    for (const action of Object.values(WorkflowRunAsAction)) {
      await WorkflowRunAsAuthority.assertMayAct({
        setting: ownerSetting,
        projectId: PROJECT_ID,
        props: OWNER(),
        action: action,
      });
    }

    const expected: Record<WorkflowRunAsAction, string> = {
      [WorkflowRunAsAction.Change]:
        "This workflow runs as Project Owner, so only Project Owners can change it. You can still turn it off.",
      [WorkflowRunAsAction.Run]:
        "This workflow runs as Project Owner, so only Project Owners can run it by hand.",
      [WorkflowRunAsAction.ChangeVariable]:
        "This variable belongs to a workflow that runs as Project Owner, so only Project Owners can change it.",
    };

    for (const action of Object.values(WorkflowRunAsAction)) {
      for (const props of [
        ADMIN(),
        person([row(Permission.WorkflowAdmin)]),
        person([row(Permission.EditWorkflow)]),
        person([row(Permission.WorkflowMember)]),
      ]) {
        const error: Error = await refusal(
          WorkflowRunAsAuthority.assertMayAct({
            setting: ownerSetting,
            projectId: PROJECT_ID,
            props: props,
            action: action,
          }),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(error.message).toBe(expected[action]);
      }
    }
  });

  test("the master API key and a workflow's step may not act on one, whatever they hold, and are told why", async () => {
    for (const props of [masterKey(), ownerStep()]) {
      const error: Error = await refusal(
        WorkflowRunAsAuthority.assertMayAct({
          setting: ownerSetting,
          projectId: PROJECT_ID,
          props: props,
          action: WorkflowRunAsAction.Change,
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(
        `This workflow runs as Project Owner, so only Project Owners can change it. You can still turn it off. ${WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE}`,
      );
    }
  });

  test("a custom role workflow is acted on by who could give the role", async () => {
    givenRole([rolePermission(Permission.IncidentAdmin)]);

    await WorkflowRunAsAuthority.assertMayAct({
      setting: { runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID },
      projectId: PROJECT_ID,
      props: person([row(Permission.IncidentAdmin)]),
      action: WorkflowRunAsAction.Change,
    });

    expect(
      await WorkflowRunAsAuthority.mayAct({
        setting: { runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID },
        projectId: PROJECT_ID,
        props: ADMIN(),
        action: WorkflowRunAsAction.Change,
      }),
    ).toBe(false);
  });

  test("one whose custom role is gone runs nothing, and any editor may choose what it runs as now", async () => {
    noRole();

    expect(
      await WorkflowRunAsAuthority.mayAct({
        setting: { runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID },
        projectId: PROJECT_ID,
        props: person([row(Permission.WorkflowAdmin)]),
        action: WorkflowRunAsAction.Change,
      }),
    ).toBe(true);
    expect(
      await WorkflowRunAsAuthority.mayAct({
        setting: { runAs: WorkflowRunAs.CustomRole },
        projectId: PROJECT_ID,
        props: person([row(Permission.WorkflowAdmin)]),
        action: WorkflowRunAsAction.Change,
      }),
    ).toBe(true);
  });

  test("one whose Run As cannot be read is held to Project Owner", async () => {
    expect(
      await WorkflowRunAsAuthority.mayAct({
        setting: { runAs: "ProjectAdmin" },
        projectId: PROJECT_ID,
        props: ADMIN(),
        action: WorkflowRunAsAction.Change,
      }),
    ).toBe(false);
    expect(
      await WorkflowRunAsAuthority.mayAct({
        setting: { runAs: "ProjectAdmin" },
        projectId: PROJECT_ID,
        props: OWNER(),
        action: WorkflowRunAsAction.Change,
      }),
    ).toBe(true);
  });

  test("OneUptime's own writes are its business", async () => {
    await WorkflowRunAsAuthority.assertMayAct({
      setting: ownerSetting,
      projectId: PROJECT_ID,
      props: { isRoot: true },
      action: WorkflowRunAsAction.Change,
    });
  });
});

describe("what a run acts as", () => {
  async function resolve(
    setting: { runAs: unknown; customRoleId?: ObjectID },
    givenByUserId: ObjectID | null = GIVER_ID,
  ): Promise<WorkflowRunAsGrant> {
    return await WorkflowRunAsAuthority.resolveForRun({
      projectId: PROJECT_ID,
      setting: setting,
      givenByUserId: givenByUserId,
    });
  }

  test("Default, with nothing read: every existing workflow runs as it did", async () => {
    const findUser: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      UserService,
      "findOneById",
    );

    expect(await resolve({ runAs: WorkflowRunAs.Default }, null)).toEqual({
      runAs: WorkflowRunAs.Default,
    });
    expect(await resolve({ runAs: undefined }, null)).toEqual({
      runAs: WorkflowRunAs.Default,
    });
    expect(findUser).not.toHaveBeenCalled();
  });

  test("Project Owner, while the person who gave it is a Project Owner", async () => {
    givenGiver({ rows: [row(Permission.ProjectOwner)] });

    expect(await resolve({ runAs: WorkflowRunAs.ProjectOwner })).toEqual({
      runAs: WorkflowRunAs.ProjectOwner,
      givenByUserId: GIVER_ID,
      givenByName: "Jane Doe",
    });
  });

  test("not when nobody is recorded as having given it, or they are gone", async () => {
    givenGiver({ rows: [row(Permission.ProjectOwner)] });

    const nobody: Error = await refusal(
      resolve({ runAs: WorkflowRunAs.ProjectOwner }, null),
    );

    expect(nobody).toBeInstanceOf(WorkflowRunAsRefusedException);
    expect(nobody.message).toContain(
      "the person who gave it those permissions is no longer in this project",
    );

    givenGiver({ rows: [row(Permission.ProjectOwner)], exists: false });

    const deleted: Error = await refusal(
      resolve({ runAs: WorkflowRunAs.ProjectOwner }),
    );

    expect(deleted.message).toContain(
      "the person who gave it those permissions is no longer in this project",
    );
  });

  test("not once they left the project", async () => {
    givenGiver({ rows: null });

    const error: Error = await refusal(
      resolve({ runAs: WorkflowRunAs.ProjectOwner }),
    );

    expect(error.message).toBe(
      "This workflow didn't run: it runs as Project Owner, which Jane Doe gave it, and Jane Doe is no longer in this project. One of the Project Owners needs to open the workflow's Settings and choose Run As again.",
    );
  });

  test("not once they are no longer a Project Owner, a master admin's pass notwithstanding", async () => {
    givenGiver({
      rows: [row(Permission.ProjectAdmin)],
      extra: { isMasterAdmin: true },
    });

    const error: Error = await refusal(
      resolve({ runAs: WorkflowRunAs.ProjectOwner }),
    );

    expect(error.message).toContain(
      "Jane Doe is no longer a Project Owner of this project",
    );
  });

  test("not while their account is turned off", async () => {
    givenGiver({ rows: [row(Permission.ProjectOwner)], isBlocked: true });

    const error: Error = await refusal(
      resolve({ runAs: WorkflowRunAs.ProjectOwner }),
    );

    expect(error.message).toContain("Jane Doe's account is turned off");
  });

  test("a custom role: its rows, while the person who gave it could give it now", async () => {
    givenRole([
      rolePermission(Permission.EditProjectTeamPermissions),
      rolePermission(Permission.IncidentAdmin, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_A],
      }),
    ]);
    givenGiver({
      rows: [
        row(Permission.EditProjectTeamPermissions),
        row(Permission.IncidentAdmin),
      ],
    });

    const grant: WorkflowRunAsGrant = await resolve({
      runAs: WorkflowRunAs.CustomRole,
      customRoleId: ROLE_ID,
    });

    expect(grant.runAs).toBe(WorkflowRunAs.CustomRole);
    expect(grant.customRoleId?.toString()).toBe(ROLE_ID.toString());
    expect(grant.customRoleName).toBe("Team Provisioner");
    expect(grant.givenByUserId?.toString()).toBe(GIVER_ID.toString());
    expect(
      grant.rolePermissions?.map((made: UserPermission): string => {
        return made.permission;
      }),
    ).toEqual([
      Permission.EditProjectTeamPermissions,
      Permission.IncidentAdmin,
    ]);
  });

  test("not once the role holds a permission its giver does not: a role that grew", async () => {
    givenRole([
      rolePermission(Permission.EditProjectTeamPermissions),
      rolePermission(Permission.MonitorAdmin),
    ]);
    givenGiver({ rows: [row(Permission.EditProjectTeamPermissions)] });

    const error: Error = await refusal(
      resolve({ runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID }),
    );

    expect(error.message).toContain(
      "Jane Doe can't give that role any more: it has Monitor Admin, which Jane Doe's own access doesn't include",
    );
  });

  test("not once its custom role is deleted, nor when its Run As cannot be read", async () => {
    noRole();

    expect(
      (
        await refusal(
          resolve({ runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID }),
        )
      ).message,
    ).toBe(WORKFLOW_RUN_AS_ROLE_DELETED_MESSAGE);

    expect(
      (await refusal(resolve({ runAs: WorkflowRunAs.CustomRole }))).message,
    ).toBe(WORKFLOW_RUN_AS_ROLE_DELETED_MESSAGE);

    expect((await refusal(resolve({ runAs: "Root" }))).message).toBe(
      WORKFLOW_RUN_AS_UNREADABLE_MESSAGE,
    );
  });
});

describe("another workflow starting one that runs as more than Default", () => {
  async function mayStart(
    parent: WorkflowRunAsGrant | undefined,
    child: { runAs: unknown; customRoleId?: ObjectID },
  ): Promise<string | null> {
    try {
      await WorkflowRunAsAuthority.assertMayStart({
        projectId: PROJECT_ID,
        parent: parent,
        child: child,
        childName: "Onboard teams",
      });

      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }

  test("one that runs as Default is started by any workflow, as before", async () => {
    expect(
      await mayStart(undefined, { runAs: WorkflowRunAs.Default }),
    ).toBeNull();
  });

  test("a Project Owner workflow, only by one that runs as Project Owner", async () => {
    expect(
      await mayStart(undefined, { runAs: WorkflowRunAs.ProjectOwner }),
    ).toBe(
      `"Onboard teams" runs as Project Owner, which this workflow's own permissions don't include, so this workflow can't start it. Start it from a workflow that runs with the same permissions or more.`,
    );
    expect(
      await mayStart(
        { runAs: WorkflowRunAs.ProjectOwner },
        { runAs: WorkflowRunAs.ProjectOwner },
      ),
    ).toBeNull();
  });

  test("a custom role workflow, only by one whose permissions include the role's", async () => {
    givenRole([rolePermission(Permission.IncidentAdmin)]);

    const child: { runAs: WorkflowRunAs; customRoleId: ObjectID } = {
      runAs: WorkflowRunAs.CustomRole,
      customRoleId: ROLE_ID,
    };

    // The default permissions hold Project Admin, not Incident Admin.
    expect(await mayStart(undefined, child)).toContain(
      `"Onboard teams" runs as the custom role "Team Provisioner"`,
    );
    expect(
      await mayStart(
        {
          runAs: WorkflowRunAs.CustomRole,
          rolePermissions: [row(Permission.IncidentAdmin)],
        },
        child,
      ),
    ).toBeNull();
    expect(
      await mayStart({ runAs: WorkflowRunAs.ProjectOwner }, child),
    ).toBeNull();
  });

  /*
   * The default permissions hold a Project Admin row, which the grant
   * ceiling would weigh as covering a role of Project Admin alone. But
   * anyone who may edit workflows steers a Default parent - a Project
   * Member included - so it starts nothing that runs as more than Default.
   */
  test("a custom role of Project Admin alone, not by one that runs as Default", async () => {
    givenRole([rolePermission(Permission.ProjectAdmin)]);

    const child: { runAs: WorkflowRunAs; customRoleId: ObjectID } = {
      runAs: WorkflowRunAs.CustomRole,
      customRoleId: ROLE_ID,
    };

    for (const parent of [undefined, { runAs: WorkflowRunAs.Default }] as Array<
      WorkflowRunAsGrant | undefined
    >) {
      expect(await mayStart(parent, child)).toBe(
        `"Onboard teams" runs as the custom role "Team Provisioner", which this workflow's own permissions don't include, so this workflow can't start it. Start it from a workflow that runs with the same permissions or more.`,
      );
    }

    expect(
      await mayStart(
        {
          runAs: WorkflowRunAs.CustomRole,
          rolePermissions: [row(Permission.ProjectAdmin)],
        },
        child,
      ),
    ).toBeNull();
    expect(
      await mayStart({ runAs: WorkflowRunAs.ProjectOwner }, child),
    ).toBeNull();
  });

  test("one whose Run As cannot be read is started only by a Project Owner workflow", async () => {
    expect(await mayStart(undefined, { runAs: "Root" })).not.toBeNull();
    expect(
      await mayStart({ runAs: WorkflowRunAs.ProjectOwner }, { runAs: "Root" }),
    ).toBeNull();
  });
});

/*
 * AN API KEY GIVES A WORKFLOW ITS RUN AS (#9765), held to its own
 * permissions exactly as a person is held to theirs, and read again as
 * every run starts.
 */

// The project API key KEY_ID as a run reads it: its row, and its permissions now.
function givenKey(data: {
  rows: Array<ApiKeyPermissionRow>;
  exists?: boolean | undefined;
  expiresAt?: Date | undefined;
  name?: string | undefined;
}): void {
  const key: ApiKey = new ApiKey();
  key.id = KEY_ID;
  key.name = data.name ?? "Terraform";
  key.expiresAt =
    data.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue(
    data.exists === false ? null : key,
  );
  getJestSpyOn(
    ApiKeyPermissionService,
    "findPermissionsByApiKeyId",
  ).mockResolvedValue(data.rows);
}

function keyRow(
  permission: Permission,
  options?: { labelIds?: Array<ObjectID>; isBlockPermission?: boolean },
): ApiKeyPermissionRow {
  return {
    permission: permission,
    labelIds: options?.labelIds || [],
    isBlockPermission: Boolean(options?.isBlockPermission),
  };
}

describe("who may give a workflow its permissions", () => {
  test("a person, by their id", () => {
    const owner: DatabaseCommonInteractionProps = OWNER();

    expect(WorkflowRunAsAuthority.getGiver(owner)).toEqual({
      kind: WorkflowRunAsGiverKind.Person,
      id: owner.userId,
    });
  });

  test("one of the project's API keys, by its id and its name", () => {
    expect(WorkflowRunAsAuthority.isProjectApiKey(apiKey([]))).toBe(true);
    expect(WorkflowRunAsAuthority.getGiver(apiKey([]))).toEqual({
      kind: WorkflowRunAsGiverKind.ApiKey,
      id: KEY_ID,
      name: "Terraform",
    });
    expect(
      WorkflowRunAsAuthority.getGiver(apiKey([], { apiKeyName: undefined })),
    ).toEqual({ kind: WorkflowRunAsGiverKind.ApiKey, id: KEY_ID });
  });

  test("never the master API key, a workflow's step, OneUptime, or a key that names a person", () => {
    for (const props of [
      masterKey(),
      ownerStep(),
      apiKey([], { isRoot: true }),
      apiKey([], { isMasterAdmin: true }),
      apiKey([], { userId: ObjectID.generate() }),
      apiKey([], { userType: UserType.Workflow }),
      { isRoot: true },
      { userType: UserType.Public },
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(WorkflowRunAsAuthority.getGiver(props)).toBeNull();
    }
  });

  test("a workflow names one giver: the giver's column, and the other cleared", () => {
    expect(
      WorkflowRunAsAuthority.getGivenByColumns({
        kind: WorkflowRunAsGiverKind.ApiKey,
        id: KEY_ID,
      }),
    ).toEqual({ runAsGivenByUserId: null, runAsGivenByApiKeyId: KEY_ID });
    expect(
      WorkflowRunAsAuthority.getGivenByColumns({
        kind: WorkflowRunAsGiverKind.Person,
        id: GIVER_ID,
      }),
    ).toEqual({ runAsGivenByUserId: GIVER_ID, runAsGivenByApiKeyId: null });
  });
});

describe("an API key choosing what a workflow runs as", () => {
  test("a key holding Project Owner for the whole project gives Project Owner", async () => {
    expect(
      await WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: WorkflowRunAs.ProjectOwner },
        projectId: PROJECT_ID,
        props: apiKey([row(Permission.ProjectOwner)]),
      }),
    ).toBeNull();
  });

  test("a key that holds less, or Project Owner on some labels, or blocked from it, may not: it never raises a workflow beyond itself", async () => {
    for (const props of [
      apiKey([]),
      apiKey([row(Permission.ProjectAdmin)]),
      apiKey([row(Permission.WorkflowAdmin), row(Permission.EditWorkflow)]),
      apiKey([row(Permission.ProjectOwner, { labelIds: [LABEL_A] })]),
      apiKey([
        row(Permission.ProjectOwner),
        row(Permission.ProjectOwner, { isBlockPermission: true }),
      ]),
    ]) {
      const error: Error = await refusal(
        WorkflowRunAsAuthority.assertMayGive({
          setting: { runAs: WorkflowRunAs.ProjectOwner },
          projectId: PROJECT_ID,
          props: props,
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE);
    }
  });

  test("a key gives a custom role whose every permission it holds at the same or a broader scope", async () => {
    givenRole([
      rolePermission(Permission.EditProjectTeamPermissions),
      rolePermission(Permission.IncidentAdmin, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_A],
      }),
    ]);

    const role: WorkflowRunAsRole | null =
      await WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID },
        projectId: PROJECT_ID,
        props: apiKey([
          row(Permission.EditProjectTeamPermissions),
          row(Permission.IncidentAdmin, { labelIds: [LABEL_A, LABEL_B] }),
        ]),
      });

    expect(role?.name).toBe("Team Provisioner");
  });

  test("not one with a permission the key lacks, or holds only on fewer labels: the refusal names it", async () => {
    givenRole([
      rolePermission(Permission.EditProjectTeamPermissions),
      rolePermission(Permission.IncidentAdmin, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_A, LABEL_B],
      }),
    ]);

    const lacking: Error = await refusal(
      WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID },
        projectId: PROJECT_ID,
        props: apiKey([row(Permission.IncidentAdmin)]),
      }),
    );

    expect(lacking.message).toBe(
      "You can't let this workflow run as \"Team Provisioner\": the role has Edit Team Permissions, and your own access doesn't include that permission at the same or a broader scope.",
    );

    const narrower: Error = await refusal(
      WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: WorkflowRunAs.CustomRole, customRoleId: ROLE_ID },
        projectId: PROJECT_ID,
        props: apiKey([
          row(Permission.EditProjectTeamPermissions),
          row(Permission.IncidentAdmin, { labelIds: [LABEL_A] }),
        ]),
      }),
    );

    expect(narrower.message).toContain("the role has Incident Admin");
  });

  test("a key holds nothing in a project that is not its own", async () => {
    const error: Error = await refusal(
      WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: WorkflowRunAs.ProjectOwner },
        projectId: ObjectID.generate(),
        props: apiKey([row(Permission.ProjectOwner)]),
      }),
    );

    expect(error.message).toBe(WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE);
  });
});

describe("an API key acting on a workflow that runs as more than Default", () => {
  test("a key holding Project Owner changes, runs and edits the variables of a Project Owner workflow", async () => {
    for (const action of Object.values(WorkflowRunAsAction)) {
      await WorkflowRunAsAuthority.assertMayAct({
        setting: { runAs: WorkflowRunAs.ProjectOwner },
        projectId: PROJECT_ID,
        props: apiKey([row(Permission.ProjectOwner)]),
        action: action,
      });
    }
  });

  test("a key holding less is refused as a person holding less is", async () => {
    const error: Error = await refusal(
      WorkflowRunAsAuthority.assertMayAct({
        setting: { runAs: WorkflowRunAs.ProjectOwner },
        projectId: PROJECT_ID,
        props: apiKey([
          row(Permission.ProjectAdmin),
          row(Permission.EditWorkflow),
        ]),
        action: WorkflowRunAsAction.Change,
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(
      "This workflow runs as Project Owner, so only Project Owners can change it. You can still turn it off.",
    );
  });

  test("a custom role workflow is acted on by a key that could give the role, and no other", async () => {
    givenRole([rolePermission(Permission.IncidentAdmin)]);

    const setting: { runAs: WorkflowRunAs; customRoleId: ObjectID } = {
      runAs: WorkflowRunAs.CustomRole,
      customRoleId: ROLE_ID,
    };

    await WorkflowRunAsAuthority.assertMayAct({
      setting: setting,
      projectId: PROJECT_ID,
      props: apiKey([row(Permission.IncidentAdmin)]),
      action: WorkflowRunAsAction.Run,
    });

    expect(
      await WorkflowRunAsAuthority.mayAct({
        setting: setting,
        projectId: PROJECT_ID,
        props: apiKey([row(Permission.IncidentMember)]),
        action: WorkflowRunAsAction.ChangeVariable,
      }),
    ).toBe(false);
  });
});

describe("what a run acts as, when an API key gave it", () => {
  async function resolveForKey(
    setting: { runAs: unknown; customRoleId?: ObjectID },
    givenByUserId: ObjectID | null = null,
  ): Promise<WorkflowRunAsGrant> {
    return await WorkflowRunAsAuthority.resolveForRun({
      projectId: PROJECT_ID,
      setting: setting,
      givenByUserId: givenByUserId,
      givenByApiKeyId: KEY_ID,
    });
  }

  test("Project Owner, while the key still holds it: the grant names the key, not a person", async () => {
    givenKey({ rows: [keyRow(Permission.ProjectOwner)] });

    expect(await resolveForKey({ runAs: WorkflowRunAs.ProjectOwner })).toEqual({
      runAs: WorkflowRunAs.ProjectOwner,
      givenByApiKeyId: KEY_ID,
      givenByName: "Terraform",
    });
  });

  test("the key is read again as the run starts: in the workflow's project, with its permissions as a request it made would have them", async () => {
    givenKey({ rows: [keyRow(Permission.ProjectOwner)] });

    await resolveForKey({ runAs: WorkflowRunAs.ProjectOwner });

    const query: { _id: ObjectID; projectId: ObjectID } = (
      getJestSpyOn(ApiKeyService, "findOneBy").mock.calls[0]![0] as {
        query: { _id: ObjectID; projectId: ObjectID };
      }
    ).query;

    expect(query._id.toString()).toBe(KEY_ID.toString());
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(
      getJestSpyOn(ApiKeyPermissionService, "findPermissionsByApiKeyId"),
    ).toHaveBeenCalledWith(KEY_ID, PROJECT_ID);
  });

  test("a key is the one asked when a workflow names both a key and a person", async () => {
    givenKey({ rows: [] });
    givenGiver({ rows: [row(Permission.ProjectOwner)] });

    const error: Error = await refusal(
      resolveForKey({ runAs: WorkflowRunAs.ProjectOwner }, GIVER_ID),
    );

    expect(error.message).toContain("that key no longer has Project Owner");
  });

  test("not once the key is deleted (revoked), or is another project's", async () => {
    givenKey({ rows: [keyRow(Permission.ProjectOwner)], exists: false });

    const error: Error = await refusal(
      resolveForKey({ runAs: WorkflowRunAs.ProjectOwner }),
    );

    expect(error).toBeInstanceOf(WorkflowRunAsRefusedException);
    expect(error.message).toBe(
      "This workflow didn't run: it runs as Project Owner, and the API key that gave it those permissions was deleted. One of the Project Owners needs to open the workflow's Settings and choose Run As again.",
    );
  });

  test("not once the key has expired", async () => {
    givenKey({
      rows: [keyRow(Permission.ProjectOwner)],
      expiresAt: new Date(Date.now() - 1000),
    });

    const error: Error = await refusal(
      resolveForKey({ runAs: WorkflowRunAs.ProjectOwner }),
    );

    expect(error).toBeInstanceOf(WorkflowRunAsRefusedException);
    expect(error.message).toBe(
      "This workflow didn't run: it runs as Project Owner, which the API key \"Terraform\" gave it, and that key has expired. One of the Project Owners needs to open the workflow's Settings and choose Run As again.",
    );
  });

  test("not once the key is narrowed: Project Owner taken away, blocked, or held on some labels only", async () => {
    for (const rows of [
      [keyRow(Permission.ProjectAdmin)],
      [
        keyRow(Permission.ProjectOwner),
        keyRow(Permission.ProjectOwner, { isBlockPermission: true }),
      ],
      [keyRow(Permission.ProjectOwner, { labelIds: [LABEL_A] })],
    ]) {
      givenKey({ rows: rows });

      const error: Error = await refusal(
        resolveForKey({ runAs: WorkflowRunAs.ProjectOwner }),
      );

      expect(error).toBeInstanceOf(WorkflowRunAsRefusedException);
      expect(error.message).toBe(
        "This workflow didn't run: it runs as Project Owner, which the API key \"Terraform\" gave it, and that key no longer has Project Owner. One of the Project Owners needs to open the workflow's Settings and choose Run As again.",
      );
    }
  });

  test("a custom role: its rows, while the key could give it now", async () => {
    givenRole([
      rolePermission(Permission.EditProjectTeamPermissions),
      rolePermission(Permission.IncidentAdmin, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_A],
      }),
    ]);
    givenKey({
      rows: [
        keyRow(Permission.EditProjectTeamPermissions),
        keyRow(Permission.IncidentAdmin, { labelIds: [LABEL_A] }),
      ],
    });

    const grant: WorkflowRunAsGrant = await resolveForKey({
      runAs: WorkflowRunAs.CustomRole,
      customRoleId: ROLE_ID,
    });

    expect(grant.runAs).toBe(WorkflowRunAs.CustomRole);
    expect(grant.customRoleName).toBe("Team Provisioner");
    expect(grant.givenByApiKeyId?.toString()).toBe(KEY_ID.toString());
    expect(grant.givenByUserId).toBeUndefined();
    expect(grant.givenByName).toBe("Terraform");
    expect(
      grant.rolePermissions?.map((made: UserPermission): string => {
        return made.permission;
      }),
    ).toEqual([
      Permission.EditProjectTeamPermissions,
      Permission.IncidentAdmin,
    ]);
  });

  test("not once the role holds a permission the key does not: a role that grew, or a key narrowed", async () => {
    givenRole([
      rolePermission(Permission.EditProjectTeamPermissions),
      rolePermission(Permission.MonitorAdmin),
    ]);
    givenKey({ rows: [keyRow(Permission.EditProjectTeamPermissions)] });

    const error: Error = await refusal(
      resolveForKey({
        runAs: WorkflowRunAs.CustomRole,
        customRoleId: ROLE_ID,
      }),
    );

    expect(error.message).toBe(
      'This workflow didn\'t run: it runs as the custom role "Team Provisioner", which the API key "Terraform" gave it, and that key can\'t give that role any more: it has Monitor Admin, which the key\'s own permissions don\'t include. One of the people who have every permission in "Team Provisioner" needs to open the workflow\'s Settings and choose Run As again.',
    );
  });

  test("a key with no name is called an API key", async () => {
    givenKey({ rows: [], name: "" });

    const error: Error = await refusal(
      resolveForKey({ runAs: WorkflowRunAs.ProjectOwner }),
    );

    expect(error.message).toContain(
      "which an API key gave it, and that key no longer has Project Owner",
    );
  });

  test("Default reads no key", async () => {
    givenKey({ rows: [keyRow(Permission.ProjectOwner)] });

    expect(await resolveForKey({ runAs: WorkflowRunAs.Default })).toEqual({
      runAs: WorkflowRunAs.Default,
    });
    expect(getJestSpyOn(ApiKeyService, "findOneBy")).not.toHaveBeenCalled();
  });
});
