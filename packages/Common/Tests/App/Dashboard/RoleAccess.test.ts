import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE ACCESS QUESTION A NEW API KEY OR TEAM IS CREATED WITH
 * (Dashboard/src/Components/Permission/RoleAccess): one helper for both.
 *
 *   - the cards: Project Admin, Project Member, Viewer, then Choose
 *     permissions later in the words of the key or the team;
 *   - who is offered what: only the roles the user may hand on, and nothing
 *     at all without the right to add permissions to that kind of record -
 *     a right that differs between keys and teams;
 *   - the field the create forms ask it with;
 *   - the row a role becomes: an allow row, for a team at scope All, through
 *     the endpoint the record's own Permissions card uses.
 */

let isMasterAdminForTest: boolean = false;
let projectPermissionsForTest: unknown = null;
let allPermissionsForTest: Array<string> = [];

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
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import {
  API_KEY_ACCESS_DESCRIPTION,
  API_KEY_ACCESS_LATER_OPTION,
  ROLE_ACCESS_FIELD_KEY,
  ROLE_ACCESS_LATER,
  ROLE_ACCESS_ROLES,
  RoleAccessHolder,
  TEAM_ACCESS_DESCRIPTION,
  TEAM_ACCESS_LATER_OPTION,
  buildApiKeyAccessPermission,
  buildTeamAccessPermission,
  getRoleAccessFormField,
  getRoleAccessLaterOption,
  getRoleAccessOptions,
  getRoleAccessOptionsForCurrentUser,
  getRoleAccessRole,
  giveRoleAccess,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleAccess";
import { getRoleIcon } from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleCardSelectOptions";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("0a000000-0000-4000-8000-000000000002");
const API_KEY_ID: ObjectID = new ObjectID(
  "0a000000-0000-4000-8000-000000000003",
);

const HOLDERS: Array<RoleAccessHolder> = [
  RoleAccessHolder.ApiKey,
  RoleAccessHolder.Team,
];

function holding(permissions: Array<Permission>): void {
  allPermissionsForTest = permissions;
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

function values(options: Array<CardSelectOption>): Array<string> {
  return options.map((option: CardSelectOption): string => {
    return option.value;
  });
}

const anyRole: (permission: Permission) => boolean = (): boolean => {
  return true;
};

interface CreateCall {
  model: unknown;
  modelType: unknown;
}

function recordingModelAPI(created: Array<CreateCall>): typeof ModelAPI {
  return {
    create: async (data: CreateCall): Promise<unknown> => {
      created.push(data);
      return { data: {} };
    },
  } as unknown as typeof ModelAPI;
}

beforeEach(() => {
  isMasterAdminForTest = false;
  holding([]);
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the cards", () => {
  test.each(HOLDERS)(
    "%s: Project Admin, Project Member and Viewer, then Choose permissions later",
    (holder: RoleAccessHolder) => {
      const options: Array<CardSelectOption> = getRoleAccessOptions({
        holder: holder,
        canGrant: anyRole,
        canAddPermissions: true,
      });

      expect(values(options)).toEqual([
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        ROLE_ACCESS_LATER,
      ]);
      expect(
        options.map((option: CardSelectOption): string => {
          return option.title;
        }),
      ).toEqual([
        "Project Admin",
        "Project Member",
        "Viewer",
        "Choose permissions later",
      ]);
    },
  );

  test("the roles read the same for a key and a team", () => {
    const forKey: Array<CardSelectOption> = getRoleAccessOptions({
      holder: RoleAccessHolder.ApiKey,
      canGrant: anyRole,
      canAddPermissions: true,
    });
    const forTeam: Array<CardSelectOption> = getRoleAccessOptions({
      holder: RoleAccessHolder.Team,
      canGrant: anyRole,
      canAddPermissions: true,
    });

    // The same three role cards - the same objects, even.
    expect(forTeam.slice(0, 3)).toEqual(forKey.slice(0, 3));

    expect(forTeam[0]!.description).toBe(
      "Create, change and delete anything, settings included. Billing and deleting the project are left out.",
    );
    expect(forTeam[1]!.description).toBe(
      "Create, change and delete monitors, incidents, status pages and other resources.",
    );
    expect(forTeam[2]!.description).toBe(
      "Read everything in the project. Change nothing.",
    );

    for (const option of forTeam.slice(0, 3)) {
      expect(option.icon).toBe(getRoleIcon(option.value as Permission));
    }
  });

  test("Choose permissions later says where the narrower roles are added: the key's page, or the team's", () => {
    expect(getRoleAccessLaterOption(RoleAccessHolder.ApiKey)).toBe(
      API_KEY_ACCESS_LATER_OPTION,
    );
    expect(getRoleAccessLaterOption(RoleAccessHolder.Team)).toBe(
      TEAM_ACCESS_LATER_OPTION,
    );

    expect(API_KEY_ACCESS_LATER_OPTION.description).toBe(
      "No access yet. Add a narrower role, such as Incident Member, or single permissions on the key's page.",
    );
    expect(TEAM_ACCESS_LATER_OPTION.description).toBe(
      "No access yet. Add a narrower role, such as Incident Member, or single permissions on the team's page.",
    );

    for (const option of [
      API_KEY_ACCESS_LATER_OPTION,
      TEAM_ACCESS_LATER_OPTION,
    ]) {
      expect(option.value).toBe(ROLE_ACCESS_LATER);
      expect(option.title).toBe("Choose permissions later");
      expect(option.icon).toBe(IconProp.Clock);
    }
  });

  test("never offer Project Owner: that is added on the record's page, on purpose", () => {
    expect(ROLE_ACCESS_ROLES).toEqual([
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]);
    expect(ROLE_ACCESS_ROLES).not.toContain(Permission.ProjectOwner);
  });

  test.each(HOLDERS)(
    "%s: only the roles the user may hand on",
    (holder: RoleAccessHolder) => {
      expect(
        values(
          getRoleAccessOptions({
            holder: holder,
            canGrant: (permission: Permission): boolean => {
              return permission !== Permission.ProjectAdmin;
            },
            canAddPermissions: true,
          }),
        ),
      ).toEqual([
        Permission.ProjectMember,
        Permission.Viewer,
        ROLE_ACCESS_LATER,
      ]);
    },
  );

  test.each(HOLDERS)(
    "%s: nothing at all without the right to add permissions",
    (holder: RoleAccessHolder) => {
      expect(
        getRoleAccessOptions({
          holder: holder,
          canGrant: anyRole,
          canAddPermissions: false,
        }),
      ).toEqual([]);
    },
  );

  test.each(HOLDERS)(
    "%s: nothing at all when no role may be handed on - there is nothing to choose",
    (holder: RoleAccessHolder) => {
      expect(
        getRoleAccessOptions({
          holder: holder,
          canGrant: (): boolean => {
            return false;
          },
          canAddPermissions: true,
        }),
      ).toEqual([]);
    },
  );
});

describe("the cards for the signed-in user", () => {
  /*
   * Who may add a permission differs: TeamPermission takes ProjectOwner,
   * ProjectAdmin or EditProjectTeamPermissions, ApiKeyPermission its own
   * editor permission. The grant ceiling is the same for both.
   */
  test.each<[string, Array<Permission>, Array<string>, Array<string>]>([
    [
      "a project owner",
      [Permission.ProjectOwner],
      [
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        ROLE_ACCESS_LATER,
      ],
      [
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        ROLE_ACCESS_LATER,
      ],
    ],
    [
      "a project admin: the role they hold, as the server allows",
      [Permission.ProjectAdmin],
      [Permission.ProjectAdmin, ROLE_ACCESS_LATER],
      [Permission.ProjectAdmin, ROLE_ACCESS_LATER],
    ],
    [
      "a project admin also in Members",
      [Permission.ProjectAdmin, Permission.ProjectMember],
      [Permission.ProjectAdmin, Permission.ProjectMember, ROLE_ACCESS_LATER],
      [Permission.ProjectAdmin, Permission.ProjectMember, ROLE_ACCESS_LATER],
    ],
    [
      "someone who may only create teams",
      [Permission.CreateProjectTeam, Permission.ReadProjectTeam],
      [],
      [],
    ],
    [
      "a team permission editor who is a viewer",
      [
        Permission.CreateProjectTeam,
        Permission.EditProjectTeamPermissions,
        Permission.Viewer,
      ],
      [Permission.Viewer, ROLE_ACCESS_LATER],
      [],
    ],
    [
      "a key permission editor who is a viewer",
      [
        Permission.CreateProjectApiKey,
        Permission.EditProjectApiKeyPermissions,
        Permission.Viewer,
      ],
      [],
      [Permission.Viewer, ROLE_ACCESS_LATER],
    ],
    [
      "a team permission editor who holds no role",
      [Permission.EditProjectTeamPermissions, Permission.CreateProjectTeam],
      [],
      [],
    ],
    ["a project member", [Permission.ProjectMember], [], []],
    ["a viewer", [Permission.Viewer], [], []],
  ])(
    "%s",
    (
      _name: string,
      permissions: Array<Permission>,
      forTeam: Array<string>,
      forKey: Array<string>,
    ) => {
      holding(permissions);

      expect(
        values(getRoleAccessOptionsForCurrentUser(RoleAccessHolder.Team)),
      ).toEqual(forTeam);
      expect(
        values(getRoleAccessOptionsForCurrentUser(RoleAccessHolder.ApiKey)),
      ).toEqual(forKey);
    },
  );

  test("a master admin gets every card, for a key and for a team", () => {
    isMasterAdminForTest = true;

    for (const holder of HOLDERS) {
      expect(values(getRoleAccessOptionsForCurrentUser(holder))).toEqual([
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
        ROLE_ACCESS_LATER,
      ]);
    }
  });

  test("before the permission snapshot has loaded, nothing is offered", () => {
    allPermissionsForTest = [];
    projectPermissionsForTest = null;

    for (const holder of HOLDERS) {
      expect(getRoleAccessOptionsForCurrentUser(holder)).toEqual([]);
    }
  });

  test("a project admin blocked from Project Admin is offered nothing", () => {
    allPermissionsForTest = [Permission.ProjectAdmin];
    projectPermissionsForTest = {
      projectId: PROJECT_ID,
      permissions: [
        {
          permission: Permission.ProjectAdmin,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.All,
          _type: "UserPermission",
        },
        {
          permission: Permission.ProjectAdmin,
          labelIds: [],
          isBlockPermission: true,
          _type: "UserPermission",
        },
      ],
      _type: "UserTenantAccessPermission",
    };

    expect(getRoleAccessOptionsForCurrentUser(RoleAccessHolder.Team)).toEqual(
      [],
    );
  });

  /*
   * The grant ceiling would let them hand on Project Admin, but a block
   * with no labels on a permission the permission table's create accepts
   * (ProjectOwner) refuses every create on it, on the server - so the form
   * does not ask.
   */
  test("an admin blocked from Project Owner is offered nothing: the block takes the whole table away", () => {
    allPermissionsForTest = [Permission.ProjectAdmin, Permission.ProjectOwner];
    projectPermissionsForTest = {
      projectId: PROJECT_ID,
      permissions: [
        {
          permission: Permission.ProjectAdmin,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.All,
          _type: "UserPermission",
        },
        {
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: true,
          _type: "UserPermission",
        },
      ],
      _type: "UserTenantAccessPermission",
    };

    for (const holder of HOLDERS) {
      expect(getRoleAccessOptionsForCurrentUser(holder)).toEqual([]);
    }
  });

  test("a block with labels takes only part of it: the role they hold is still offered", () => {
    allPermissionsForTest = [Permission.ProjectAdmin, Permission.ProjectOwner];
    projectPermissionsForTest = {
      projectId: PROJECT_ID,
      permissions: [
        {
          permission: Permission.ProjectAdmin,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.All,
          _type: "UserPermission",
        },
        {
          permission: Permission.ProjectOwner,
          labelIds: [new ObjectID("0a000000-0000-4000-8000-0000000000aa")],
          isBlockPermission: true,
          _type: "UserPermission",
        },
      ],
      _type: "UserTenantAccessPermission",
    };

    expect(
      values(getRoleAccessOptionsForCurrentUser(RoleAccessHolder.Team)),
    ).toEqual([Permission.ProjectAdmin, ROLE_ACCESS_LATER]);
  });
});

describe("what a submitted Access value asks for", () => {
  test("each role card asks for its role", () => {
    for (const role of ROLE_ACCESS_ROLES) {
      expect(getRoleAccessRole(role)).toBe(role);
    }
  });

  test("Choose permissions later asks for nothing", () => {
    expect(getRoleAccessRole(ROLE_ACCESS_LATER)).toBeNull();
  });

  test("anything the form never offered asks for nothing", () => {
    for (const value of [
      undefined,
      null,
      "",
      0,
      Permission.ProjectOwner,
      Permission.DeleteProject,
      Permission.IncidentMember,
      ["ProjectAdmin"],
      { value: "ProjectAdmin" },
    ]) {
      expect(getRoleAccessRole(value)).toBeNull();
    }
  });
});

describe("the Access field", () => {
  const options: Array<CardSelectOption> = getRoleAccessOptions({
    holder: RoleAccessHolder.Team,
    canGrant: anyRole,
    canAddPermissions: true,
  });

  test("is a card for each choice, one per row, with Choose permissions later picked", () => {
    const field: ModelField<Team> = getRoleAccessFormField<Team>({
      holder: RoleAccessHolder.Team,
      accessOptions: options,
    });

    expect(field.title).toBe("Access");
    expect(field.fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(field.cardSelectOptions).toBe(options);
    expect(field.cardSelectSingleColumn).toBe(true);
    expect(field.required).toBe(true);
    expect(field.defaultValue).toBe(ROLE_ACCESS_LATER);
    // A plain list: no search box and no catalog layout (four cards).
    expect(field.cardSelectSearchable).toBeUndefined();
    expect(field.cardSelectCatalog).toBeUndefined();
    // Asked on the first page: never folded, never a step of its own.
    expect(field.collapsibleSection).toBeUndefined();
    expect(field.stepId).toBeUndefined();
  });

  test("says what it decides, for a team and for a key", () => {
    expect(
      getRoleAccessFormField<Team>({
        holder: RoleAccessHolder.Team,
        accessOptions: options,
      }).description,
    ).toBe(
      "What the team's members can do. You can change it on the team's page at any time.",
    );
    expect(TEAM_ACCESS_DESCRIPTION).toBe(
      "What the team's members can do. You can change it on the team's page at any time.",
    );

    expect(
      getRoleAccessFormField<ApiKey>({
        holder: RoleAccessHolder.ApiKey,
        accessOptions: options,
      }).description,
    ).toBe(
      "What this key can do. You can change it on the key's page at any time.",
    );
    expect(API_KEY_ACCESS_DESCRIPTION).toBe(
      "What this key can do. You can change it on the key's page at any time.",
    );
  });

  test("is told apart on the page: team-access, api-key-access", () => {
    expect(
      getRoleAccessFormField<Team>({
        holder: RoleAccessHolder.Team,
        accessOptions: options,
      }).dataTestId,
    ).toBe("team-access");
    expect(
      getRoleAccessFormField<ApiKey>({
        holder: RoleAccessHolder.ApiKey,
        accessOptions: options,
      }).dataTestId,
    ).toBe("api-key-access");
  });

  test("is never sent with the record: it is not one of its columns", () => {
    const field: ModelField<Team> = getRoleAccessFormField<Team>({
      holder: RoleAccessHolder.Team,
      accessOptions: options,
    });

    expect(field.formOnly).toBe(true);
    expect(field.field).toBeUndefined();
    expect(field.overrideField).toEqual({ [ROLE_ACCESS_FIELD_KEY]: true });
    expect(field.overrideFieldKey).toBe(ROLE_ACCESS_FIELD_KEY);
    expect(ROLE_ACCESS_FIELD_KEY).toBe("access");
    expect(new Team().hasColumn(ROLE_ACCESS_FIELD_KEY)).toBe(false);
    expect(new ApiKey().hasColumn(ROLE_ACCESS_FIELD_KEY)).toBe(false);
    // Shown although no column's permission covers it: the page decides.
    expect(field.showEvenIfPermissionDoesNotExist).toBe(true);
  });

  test("a new object each time, so one form cannot change another's", () => {
    const first: ModelField<Team> = getRoleAccessFormField<Team>({
      holder: RoleAccessHolder.Team,
      accessOptions: options,
    });
    const second: ModelField<Team> = getRoleAccessFormField<Team>({
      holder: RoleAccessHolder.Team,
      accessOptions: options,
    });

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe("the row a role becomes", () => {
  test("on a team: an allow row for every resource in the project", () => {
    const row: TeamPermission = buildTeamAccessPermission({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      role: Permission.ProjectMember,
    });

    expect(row).toBeInstanceOf(TeamPermission);
    expect(row.teamId?.toString()).toBe(TEAM_ID.toString());
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.permission).toBe(Permission.ProjectMember);
    expect(row.isBlockPermission).toBe(false);
    expect(row.scope).toBe(PermissionScope.All);
    // No labels: the role reaches the whole project.
    expect(row.labels).toBeUndefined();
    expect(row.getCrudApiPath()?.toString()).toBe("/team-permission");
  });

  test("on a key: an allow row with no labels", () => {
    const row: ApiKeyPermission = buildApiKeyAccessPermission({
      apiKeyId: API_KEY_ID,
      projectId: PROJECT_ID,
      role: Permission.Viewer,
    });

    expect(row).toBeInstanceOf(ApiKeyPermission);
    expect(row.apiKeyId?.toString()).toBe(API_KEY_ID.toString());
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.permission).toBe(Permission.Viewer);
    expect(row.isBlockPermission).toBe(false);
    expect(row.labels).toBeUndefined();
    expect(row.getCrudApiPath()?.toString()).toBe("/api-key-permission");
  });
});

describe("giving a new record its access", () => {
  test.each(ROLE_ACCESS_ROLES)(
    "a team given %s: one TeamPermission, created through the team permission endpoint",
    async (role: Permission) => {
      const created: Array<CreateCall> = [];

      await giveRoleAccess({
        holder: RoleAccessHolder.Team,
        holderId: TEAM_ID,
        projectId: PROJECT_ID,
        role: role,
        modelAPI: recordingModelAPI(created),
      });

      expect(created).toHaveLength(1);
      expect(created[0]!.modelType).toBe(TeamPermission);

      const row: TeamPermission = created[0]!.model as TeamPermission;

      expect(row).toEqual(
        buildTeamAccessPermission({
          teamId: TEAM_ID,
          projectId: PROJECT_ID,
          role: role,
        }),
      );
      expect(row.permission).toBe(role);
      expect(row.scope).toBe(PermissionScope.All);
    },
  );

  test("a key: one ApiKeyPermission, created through the key permission endpoint", async () => {
    const created: Array<CreateCall> = [];

    await giveRoleAccess({
      holder: RoleAccessHolder.ApiKey,
      holderId: API_KEY_ID,
      projectId: PROJECT_ID,
      role: Permission.ProjectAdmin,
      modelAPI: recordingModelAPI(created),
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.modelType).toBe(ApiKeyPermission);
    expect(created[0]!.model).toEqual(
      buildApiKeyAccessPermission({
        apiKeyId: API_KEY_ID,
        projectId: PROJECT_ID,
        role: Permission.ProjectAdmin,
      }),
    );
  });

  test("a refusal is the caller's to show", async () => {
    const modelAPI: typeof ModelAPI = {
      create: async (): Promise<never> => {
        throw new Error(
          "You cannot grant ProjectMember because your own access does not include that permission at an equal or broader scope.",
        );
      },
    } as unknown as typeof ModelAPI;

    await expect(
      giveRoleAccess({
        holder: RoleAccessHolder.Team,
        holderId: TEAM_ID,
        projectId: PROJECT_ID,
        role: Permission.ProjectMember,
        modelAPI: modelAPI,
      }),
    ).rejects.toThrow(
      "You cannot grant ProjectMember because your own access does not include that permission at an equal or broader scope.",
    );
  });

  test("goes through the shared ModelAPI when none is handed in", async () => {
    const create: jest.SpyInstance = getJestSpyOn(
      ModelAPI,
      "create",
    ).mockResolvedValue({});

    await giveRoleAccess({
      holder: RoleAccessHolder.Team,
      holderId: TEAM_ID,
      projectId: PROJECT_ID,
      role: Permission.Viewer,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].modelType).toBe(TeamPermission);
  });
});
