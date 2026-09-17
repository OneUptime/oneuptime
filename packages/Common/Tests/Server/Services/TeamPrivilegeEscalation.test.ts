import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Regression coverage for the team-creator escalation chain:
 *
 *   CreateProjectTeam -> create editable team -> attach ProjectOwner -> add
 *   self as a pending member -> accept through CurrentUser -> owner.
 *
 * These tests deliberately cover every boundary in that chain. Metadata tests
 * pin the real CRUD ACL consumed by DatabaseService; hook tests pin the
 * tenant binding and grant ceiling; token tests pin the final permission
 * resolver so a malformed legacy row cannot cross a project boundary either.
 */

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TEAM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const MEMBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

type HookService = Record<
  string,
  (...args: Array<unknown>) => Promise<unknown>
>;

function callHook(
  service: unknown,
  hook: string,
  ...args: Array<unknown>
): Promise<unknown> {
  return (service as HookService)[hook]!.apply(service, args);
}

function grant(
  permission: Permission,
  data?: {
    labelIds?: Array<ObjectID> | undefined;
    scope?: PermissionScope | undefined;
  },
): UserPermission {
  return {
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: false,
    scope: data?.scope,
    _type: "UserPermission",
  };
}

function propsWith(
  permissions: Array<UserPermission>,
  tenantId: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: tenantId,
    permissions: permissions,
    _type: "UserTenantAccessPermission",
  };

  return {
    userId: USER_ID,
    tenantId: tenantId,
    userTenantAccessPermission: {
      [tenantId.toString()]: tenantPermission,
    },
  };
}

function makePermission(data?: {
  permission?: Permission | undefined;
  projectId?: ObjectID | undefined;
  teamId?: ObjectID | undefined;
  labels?: Array<Label> | undefined;
  scope?: PermissionScope | undefined;
}): TeamPermission {
  const permission: TeamPermission = new TeamPermission();
  permission.projectId = data?.projectId || PROJECT_ID;
  permission.teamId = data?.teamId || TEAM_ID;
  permission.permission = data?.permission || Permission.ProjectMember;
  if (data?.labels) {
    permission.labels = data.labels;
  }
  permission.scope = data?.scope || PermissionScope.All;
  return permission;
}

function makeTeamPermissionCreate(
  permission: Permission,
  props: DatabaseCommonInteractionProps,
): CreateBy<TeamPermission> {
  return {
    data: makePermission({ permission: permission }),
    props: props,
  };
}

function editableTeam(): Team {
  const team: Team = new Team(TEAM_ID);
  team.isPermissionsEditable = true;
  team.projectId = PROJECT_ID;
  return team;
}

function allColumnAccessControls(
  model: TeamPermission | TeamMember,
): Array<ColumnAccessControl> {
  return model
    .getTableColumns()
    .columns.map((column: string) => {
      return model.getColumnAccessControlFor(column);
    })
    .filter(
      (
        accessControl: ColumnAccessControl | null,
      ): accessControl is ColumnAccessControl => {
        return Boolean(accessControl);
      },
    );
}

describe("team delegation CRUD ACLs", () => {
  test("CreateProjectTeam can create a team but cannot create a permission row", () => {
    const model: TeamPermission = new TeamPermission();

    expect(model.createRecordPermissions).not.toContain(
      Permission.CreateProjectTeam,
    );
    expect(model.createRecordPermissions).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditProjectTeamPermissions,
      ]),
    );
  });

  test("no TeamPermission create column reintroduces CreateProjectTeam", () => {
    for (const accessControl of allColumnAccessControls(new TeamPermission())) {
      expect(accessControl.create || []).not.toContain(
        Permission.CreateProjectTeam,
      );
    }
  });

  test("CreateProjectTeam cannot add itself or an accomplice to a team", () => {
    const model: TeamMember = new TeamMember();

    expect(model.createRecordPermissions).not.toContain(
      Permission.CreateProjectTeam,
    );
    expect(model.createRecordPermissions).toEqual(
      expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.InviteProjectTeamMembers,
      ]),
    );
  });

  test("no TeamMember create column reintroduces CreateProjectTeam", () => {
    for (const accessControl of allColumnAccessControls(new TeamMember())) {
      expect(accessControl.create || []).not.toContain(
        Permission.CreateProjectTeam,
      );
    }
  });

  test("the invitee can still accept a legitimate pending invitation", () => {
    const model: TeamMember = new TeamMember();

    expect(model.updateRecordPermissions).toContain(Permission.CurrentUser);
    expect(
      model.getColumnAccessControlFor("hasAcceptedInvitation")?.update,
    ).toContain(Permission.CurrentUser);
    expect(
      model.getColumnAccessControlFor("invitationAcceptedAt")?.update,
    ).toContain(Permission.CurrentUser);
  });
});

describe("TeamMember acceptance transition safety", () => {
  function update(
    accepted: boolean | undefined,
    props: DatabaseCommonInteractionProps,
  ): UpdateBy<TeamMember> {
    const data: TeamMember = new TeamMember();

    if (accepted !== undefined) {
      data.hasAcceptedInvitation = accepted;
    }

    return {
      query: { _id: MEMBER_ID },
      data,
      props,
      skip: 0,
      limit: 1,
    } as unknown as UpdateBy<TeamMember>;
  }

  test("an ordinary member cannot unaccept membership and bypass leave cleanup", async () => {
    await expect(
      callHook(
        TeamMemberService,
        "onBeforeUpdate",
        update(false, propsWith([grant(Permission.CurrentUser)])),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("the invitee can still accept a pending membership", async () => {
    const updateBy: UpdateBy<TeamMember> = update(
      true,
      propsWith([grant(Permission.CurrentUser)]),
    );

    await expect(
      callHook(TeamMemberService, "onBeforeUpdate", updateBy),
    ).resolves.toEqual({ updateBy, carryForward: null });
  });

  test("an unrelated owner-scoped update is not mistaken for leaving", async () => {
    const updateBy: UpdateBy<TeamMember> = update(
      undefined,
      propsWith([grant(Permission.CurrentUser)]),
    );

    await expect(
      callHook(TeamMemberService, "onBeforeUpdate", updateBy),
    ).resolves.toEqual({ updateBy, carryForward: null });
  });

  test("root maintenance can still clear the flag explicitly", async () => {
    const updateBy: UpdateBy<TeamMember> = update(false, { isRoot: true });

    await expect(
      callHook(TeamMemberService, "onBeforeUpdate", updateBy),
    ).resolves.toEqual({ updateBy, carryForward: null });
  });

  test("master-admin maintenance can still clear the flag explicitly", async () => {
    const updateBy: UpdateBy<TeamMember> = update(false, {
      isMasterAdmin: true,
    });

    await expect(
      callHook(TeamMemberService, "onBeforeUpdate", updateBy),
    ).resolves.toEqual({ updateBy, carryForward: null });
  });
});

describe("TeamPermissionService grant ceiling", () => {
  beforeEach(() => {
    jest.spyOn(TeamService, "findOneBy").mockResolvedValue(editableTeam());
    jest.spyOn(TeamPermissionService, "findOneBy").mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      "owner delegates a lower role",
      Permission.ProjectOwner,
      Permission.ProjectMember,
    ],
    [
      "admin delegates the admin role it holds",
      Permission.ProjectAdmin,
      Permission.ProjectAdmin,
    ],
    [
      "granular permission editor delegates only its own authority",
      Permission.EditProjectTeamPermissions,
      Permission.EditProjectTeamPermissions,
    ],
  ])(
    "%s",
    async (
      _name: string,
      callerPermission: Permission,
      delegatedPermission: Permission,
    ) => {
      await expect(
        callHook(
          TeamPermissionService,
          "onBeforeCreate",
          makeTeamPermissionCreate(
            delegatedPermission,
            propsWith([grant(callerPermission)]),
          ),
        ),
      ).resolves.toBeDefined();
    },
  );

  test.each([
    [Permission.CreateProjectTeam],
    [Permission.ProjectAdmin],
    [Permission.EditProjectTeamPermissions],
    [Permission.InviteProjectTeamMembers],
  ])("%s cannot mint ProjectOwner", async (callerPermission: Permission) => {
    await expect(
      callHook(
        TeamPermissionService,
        "onBeforeCreate",
        makeTeamPermissionCreate(
          Permission.ProjectOwner,
          propsWith([grant(callerPermission)]),
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a permission editor cannot mint an unrelated granular capability", async () => {
    await expect(
      callHook(
        TeamPermissionService,
        "onBeforeCreate",
        makeTeamPermissionCreate(
          Permission.ManageProjectBilling,
          propsWith([grant(Permission.EditProjectTeamPermissions)]),
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test.each([Permission.DeleteProject, Permission.ManageProjectBilling])(
    "ProjectAdmin cannot mint withheld authority: %s",
    async (delegatedPermission: Permission) => {
      await expect(
        callHook(
          TeamPermissionService,
          "onBeforeCreate",
          makeTeamPermissionCreate(
            delegatedPermission,
            propsWith([grant(Permission.ProjectAdmin)]),
          ),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("root provisioning bypasses the grant ceiling", () => {
    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.ProjectOwner,
        props: { isRoot: true },
      });
    }).not.toThrow();
  });

  test("master-admin provisioning bypasses the grant ceiling", () => {
    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.ProjectOwner,
        props: { isMasterAdmin: true },
      });
    }).not.toThrow();
  });

  test("label-scoped authority can delegate the same labels", () => {
    const labelId: ObjectID = ObjectID.generate();

    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.ReadProjectMonitor,
        labelIds: [labelId],
        scope: PermissionScope.Labels,
        props: propsWith([
          grant(Permission.ReadProjectMonitor, {
            labelIds: [labelId],
            scope: PermissionScope.Labels,
          }),
        ]),
      });
    }).not.toThrow();
  });

  test("label-scoped authority cannot delegate an unheld label", () => {
    const heldLabelId: ObjectID = ObjectID.generate();
    const otherLabelId: ObjectID = ObjectID.generate();

    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.ReadProjectMonitor,
        labelIds: [otherLabelId],
        scope: PermissionScope.Labels,
        props: propsWith([
          grant(Permission.ReadProjectMonitor, {
            labelIds: [heldLabelId],
            scope: PermissionScope.Labels,
          }),
        ]),
      });
    }).toThrow(NotAuthorizedException);
  });

  test("label-scoped authority cannot widen itself to All", () => {
    const labelId: ObjectID = ObjectID.generate();

    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.ReadProjectMonitor,
        scope: PermissionScope.All,
        props: propsWith([
          grant(Permission.ReadProjectMonitor, {
            labelIds: [labelId],
            scope: PermissionScope.Labels,
          }),
        ]),
      });
    }).toThrow(NotAuthorizedException);
  });

  test("All authority may delegate a narrower label scope", () => {
    expect(() => {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.ReadProjectMonitor,
        labelIds: [ObjectID.generate()],
        scope: PermissionScope.Labels,
        props: propsWith([grant(Permission.ReadProjectMonitor)]),
      });
    }).not.toThrow();
  });

  test("a forged projectId different from the request tenant is rejected before lookup", async () => {
    const lookup: jest.SpyInstance = getJestSpyOn(TeamService, "findOneBy");
    const create: CreateBy<TeamPermission> = makeTeamPermissionCreate(
      Permission.ProjectAdmin,
      propsWith([grant(Permission.ProjectAdmin)]),
    );
    create.data.projectId = OTHER_PROJECT_ID;

    await expect(
      callHook(TeamPermissionService, "onBeforeCreate", create),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(lookup).not.toHaveBeenCalled();
  });

  test("a team ID is resolved together with its project ID", async () => {
    const lookup: jest.SpyInstance = getJestSpyOn(
      TeamService,
      "findOneBy",
    ).mockResolvedValue(null);

    await expect(
      callHook(
        TeamPermissionService,
        "onBeforeCreate",
        makeTeamPermissionCreate(
          Permission.ProjectAdmin,
          propsWith([grant(Permission.ProjectAdmin)]),
        ),
      ),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: TEAM_ID,
          projectId: PROJECT_ID,
        },
        props: { isRoot: true },
      }),
    );
  });

  test("changing an existing row to ProjectOwner is also ceiling-checked", async () => {
    const existing: TeamPermission = makePermission({
      permission: Permission.ProjectAdmin,
    });
    existing.team = editableTeam();
    jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([existing]);

    const updateBy: UpdateBy<TeamPermission> = {
      query: { _id: ObjectID.generate() },
      data: { permission: Permission.ProjectOwner },
      props: propsWith([grant(Permission.ProjectAdmin)]),
      skip: 0,
      limit: 1,
    } as unknown as UpdateBy<TeamPermission>;

    await expect(
      callHook(TeamPermissionService, "onBeforeUpdate", updateBy),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test.each([Permission.DeleteProject, Permission.ManageProjectBilling])(
    "ProjectAdmin cannot change an existing row into withheld authority: %s",
    async (delegatedPermission: Permission) => {
      const existing: TeamPermission = makePermission({
        permission: Permission.ProjectAdmin,
      });
      existing.team = editableTeam();
      jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([existing]);

      const updateBy: UpdateBy<TeamPermission> = {
        query: { _id: ObjectID.generate() },
        data: { permission: delegatedPermission },
        props: propsWith([grant(Permission.ProjectAdmin)]),
        skip: 0,
        limit: 1,
      } as unknown as UpdateBy<TeamPermission>;

      await expect(
        callHook(TeamPermissionService, "onBeforeUpdate", updateBy),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );
});

describe("membership delegation ceiling", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("permission resolution for a target team is project-scoped", async () => {
    const row: TeamPermission = makePermission({
      permission: Permission.ProjectAdmin,
    });
    const findBy: jest.SpyInstance = getJestSpyOn(
      TeamPermissionService,
      "findBy",
    ).mockResolvedValue([row]);

    await expect(
      TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        props: propsWith([grant(Permission.ProjectAdmin)]),
      }),
    ).resolves.toBeUndefined();

    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          teamId: TEAM_ID,
          projectId: PROJECT_ID,
        },
        props: { isRoot: true },
      }),
    );
  });

  test("an inviter cannot self-invite into a more privileged team", async () => {
    const ownerRow: TeamPermission = makePermission({
      permission: Permission.ProjectOwner,
    });
    jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([ownerRow]);

    await expect(
      TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        props: propsWith([grant(Permission.InviteProjectTeamMembers)]),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test.each([Permission.DeleteProject, Permission.ManageProjectBilling])(
    "ProjectAdmin cannot invite into a team carrying withheld authority: %s",
    async (delegatedPermission: Permission) => {
      jest
        .spyOn(TeamPermissionService, "findBy")
        .mockResolvedValue([
          makePermission({ permission: delegatedPermission }),
        ]);

      await expect(
        TeamPermissionService.assertCanGrantTeamPermissions({
          teamId: TEAM_ID,
          projectId: PROJECT_ID,
          props: propsWith([grant(Permission.ProjectAdmin)]),
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("a caller may invite into a team whose complete authority they hold", async () => {
    const editorRow: TeamPermission = makePermission({
      permission: Permission.EditProjectTeamPermissions,
    });
    jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([editorRow]);

    await expect(
      TeamPermissionService.assertCanGrantTeamPermissions({
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        props: propsWith([
          grant(Permission.InviteProjectTeamMembers),
          grant(Permission.EditProjectTeamPermissions),
        ]),
      }),
    ).resolves.toBeUndefined();
  });

  test("TeamMember create rejects a cross-project team ID", async () => {
    const lookup: jest.SpyInstance = getJestSpyOn(
      TeamService,
      "findOneBy",
    ).mockResolvedValue(null);
    const grantCheck: jest.SpyInstance = getJestSpyOn(
      TeamPermissionService,
      "assertCanGrantTeamPermissions",
    );

    const member: TeamMember = new TeamMember();
    member.projectId = PROJECT_ID;
    member.teamId = TEAM_ID;
    member.userId = USER_ID;

    await expect(
      callHook(TeamMemberService, "onBeforeCreate", {
        data: member,
        props: propsWith([grant(Permission.InviteProjectTeamMembers)]),
      } as CreateBy<TeamMember>),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: TEAM_ID,
          projectId: PROJECT_ID,
        },
      }),
    );
    expect(grantCheck).not.toHaveBeenCalled();
  });

  test("TeamMember create consults the delegation ceiling before invitation side effects", async () => {
    jest.spyOn(TeamService, "findOneBy").mockResolvedValue(editableTeam());
    const ceilingError: NotAuthorizedException = new NotAuthorizedException(
      "cannot delegate owner",
    );
    jest
      .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
      .mockRejectedValue(ceilingError);

    const member: TeamMember = new TeamMember();
    member.projectId = PROJECT_ID;
    member.teamId = TEAM_ID;
    member.userId = USER_ID;
    member.hasAcceptedInvitation = true;

    await expect(
      callHook(TeamMemberService, "onBeforeCreate", {
        data: member,
        props: propsWith([grant(Permission.InviteProjectTeamMembers)]),
      } as CreateBy<TeamMember>),
    ).rejects.toBe(ceilingError);

    // Rejection happens before the old coercion-to-pending-invitation path.
    expect(member.hasAcceptedInvitation).toBe(true);
  });
});

describe("project-scoped permission resolution and access refresh", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("AccessTokenService never resolves team permissions outside the requested project", async () => {
    const membership: TeamMember = new TeamMember(MEMBER_ID);
    membership.teamId = TEAM_ID;
    membership.projectId = PROJECT_ID;
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([membership]);

    const permissionLookup: jest.SpyInstance = getJestSpyOn(
      TeamPermissionService,
      "findBy",
    ).mockResolvedValue([
      makePermission({ permission: Permission.ProjectMember }),
    ]);
    jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined);

    await AccessTokenService.refreshUserTenantAccessPermission(
      USER_ID,
      PROJECT_ID,
    );

    expect(permissionLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: PROJECT_ID,
        }),
        props: { isRoot: true },
      }),
    );
  });

  test("creating a permission refreshes only members of that team and project", async () => {
    const member: TeamMember = new TeamMember(MEMBER_ID);
    member.userId = USER_ID;
    member.projectId = PROJECT_ID;
    member.teamId = TEAM_ID;

    const memberLookup: jest.SpyInstance = getJestSpyOn(
      TeamMemberService,
      "findBy",
    ).mockResolvedValue([member]);
    const refreshGlobal: jest.SpyInstance = getJestSpyOn(
      AccessTokenService,
      "refreshUserGlobalAccessPermission",
    ).mockResolvedValue({
      globalPermissions: [],
      projectIds: [],
      _type: "UserGlobalAccessPermission",
    });
    const refreshTenant: jest.SpyInstance = getJestSpyOn(
      AccessTokenService,
      "refreshUserTenantAccessPermission",
    ).mockResolvedValue(null);

    const createBy: CreateBy<TeamPermission> = {
      data: makePermission(),
      props: { isRoot: true },
    };
    const onCreate: OnCreate<TeamPermission> = {
      createBy: createBy,
      carryForward: null,
    };

    await callHook(
      TeamPermissionService,
      "onCreateSuccess",
      onCreate,
      makePermission(),
    );

    expect(memberLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          teamId: TEAM_ID,
          projectId: PROJECT_ID,
        },
      }),
    );
    expect(refreshGlobal).toHaveBeenCalledWith(USER_ID);
    expect(refreshTenant).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
  });

  test("updating a permission keeps refreshes bound to the permission row's project", async () => {
    const permission: TeamPermission = makePermission();
    const member: TeamMember = new TeamMember(MEMBER_ID);
    member.userId = USER_ID;
    member.projectId = PROJECT_ID;
    member.teamId = TEAM_ID;

    const memberLookup: jest.SpyInstance = getJestSpyOn(
      TeamMemberService,
      "findBy",
    ).mockResolvedValue([member]);
    jest
      .spyOn(AccessTokenService, "refreshUserGlobalAccessPermission")
      .mockResolvedValue({
        globalPermissions: [],
        projectIds: [],
        _type: "UserGlobalAccessPermission",
      });
    const refreshTenant: jest.SpyInstance = getJestSpyOn(
      AccessTokenService,
      "refreshUserTenantAccessPermission",
    ).mockResolvedValue(null);

    const updateBy: UpdateBy<TeamPermission> = {
      query: { _id: ObjectID.generate() },
      data: {},
      props: { isRoot: true },
      skip: 0,
      limit: 1,
    } as unknown as UpdateBy<TeamPermission>;
    const onUpdate: OnUpdate<TeamPermission> = {
      updateBy: updateBy,
      carryForward: [permission],
    };

    await callHook(TeamPermissionService, "onUpdateSuccess", onUpdate, []);

    expect(memberLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          teamId: TEAM_ID,
          projectId: PROJECT_ID,
        },
      }),
    );
    expect(refreshTenant).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
  });
});
