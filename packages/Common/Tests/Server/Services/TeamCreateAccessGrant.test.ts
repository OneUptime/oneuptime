import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * CREATE TEAM'S ACCESS QUESTION, AGAINST THE SERVER.
 *
 * Create Team (and Create API Key) ask what the new team (or key) may do:
 * Project Admin, Project Member, Viewer, or Choose permissions later. The
 * team request is unchanged; once the team exists the dashboard sends the
 * role as the team's first permission - POST /team-permission, at scope All
 * (Dashboard Components/Permission/RoleAccess). So the server decides,
 * exactly as it does for Add Role on the team's page and for a new key's
 * Access:
 *
 *   - someone who may not add permissions to a team at all (the table's
 *     create ACL) is refused, though they may create the team;
 *   - everyone else may hand on only what they hold for the whole project
 *     (the grant ceiling), so a project admin gives Project Admin and
 *     nothing narrower, and nobody gives what they are blocked from;
 *   - a master admin may give any of them.
 *
 * The dashboard offers a card only when the server would accept it. These
 * run the real dashboard function (getRoleAccessOptionsForCurrentUser, over
 * the permissions a signed-in user's browser holds) and the real server
 * checks - the TeamPermissionService create hook and the create ACL every
 * request goes through - for the exact row the dashboard sends, caller by
 * caller and role by role, for a team and for a key. Only the database
 * lookups (the team, an existing row) are stubbed.
 */

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. Nothing here hashes passwords.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import {
  ROLE_ACCESS_LATER,
  ROLE_ACCESS_ROLES,
  RoleAccessHolder,
  buildApiKeyAccessPermission,
  buildTeamAccessPermission,
  getRoleAccessOptionsForCurrentUser,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Permission/RoleAccess";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import UserUtil from "../../../UI/Utils/User";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

const PROJECT_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("1c000000-0000-4000-8000-000000000002");
const API_KEY_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000003",
);
const USER_ID: ObjectID = new ObjectID("1c000000-0000-4000-8000-000000000004");
const LABEL_ID: ObjectID = new ObjectID("1c000000-0000-4000-8000-000000000005");

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

function allow(
  permission: Permission,
  data?: {
    scope?: PermissionScope | undefined;
    labelIds?: Array<ObjectID> | undefined;
  },
): UserPermission {
  return {
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: false,
    scope: data?.scope || PermissionScope.All,
    _type: "UserPermission",
  };
}

function block(permission: Permission): UserPermission {
  return {
    permission: permission,
    labelIds: [],
    isBlockPermission: true,
    _type: "UserPermission",
  };
}

interface Caller {
  name: string;
  rows: Array<UserPermission>;
  isMasterAdmin?: boolean | undefined;
  // The Access cards Create Team offers this caller: the roles, in order.
  teamRoles: Array<Permission>;
  // The same, on Create API Key.
  apiKeyRoles: Array<Permission>;
}

const ALL_ROLES: Array<Permission> = [
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

const CALLERS: Array<Caller> = [
  {
    name: "a project owner",
    rows: [allow(Permission.ProjectOwner)],
    teamRoles: ALL_ROLES,
    apiKeyRoles: ALL_ROLES,
  },
  {
    name: "a project admin",
    rows: [allow(Permission.ProjectAdmin)],
    teamRoles: [Permission.ProjectAdmin],
    apiKeyRoles: [Permission.ProjectAdmin],
  },
  {
    name: "a project admin who is also in Members",
    rows: [allow(Permission.ProjectAdmin), allow(Permission.ProjectMember)],
    teamRoles: [Permission.ProjectAdmin, Permission.ProjectMember],
    apiKeyRoles: [Permission.ProjectAdmin, Permission.ProjectMember],
  },
  {
    name: "a project admin whose Project Member is only for some labels",
    rows: [
      allow(Permission.ProjectAdmin),
      allow(Permission.ProjectMember, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL_ID],
      }),
    ],
    teamRoles: [Permission.ProjectAdmin],
    apiKeyRoles: [Permission.ProjectAdmin],
  },
  {
    name: "a project admin whose Project Member is only for what they own",
    rows: [
      allow(Permission.ProjectAdmin),
      allow(Permission.ProjectMember, { scope: PermissionScope.Owned }),
    ],
    teamRoles: [Permission.ProjectAdmin],
    apiKeyRoles: [Permission.ProjectAdmin],
  },
  {
    name: "a project admin blocked from Project Admin",
    rows: [allow(Permission.ProjectAdmin), block(Permission.ProjectAdmin)],
    teamRoles: [],
    apiKeyRoles: [],
  },
  {
    /*
     * The grant ceiling alone would let them hand on Project Admin, but a
     * block on a permission the table's create accepts (ProjectOwner)
     * refuses every create on it - so nothing is offered.
     */
    name: "a project owner blocked from Project Owner, who is also an admin",
    rows: [
      allow(Permission.ProjectOwner),
      allow(Permission.ProjectAdmin),
      block(Permission.ProjectOwner),
    ],
    teamRoles: [],
    apiKeyRoles: [],
  },
  {
    // A block with labels takes only part of the table away.
    name: "a project admin blocked from Project Owner on some labels",
    rows: [
      allow(Permission.ProjectAdmin),
      {
        permission: Permission.ProjectOwner,
        labelIds: [LABEL_ID],
        isBlockPermission: true,
        _type: "UserPermission",
      },
    ],
    teamRoles: [Permission.ProjectAdmin],
    apiKeyRoles: [Permission.ProjectAdmin],
  },
  {
    name: "a team permission editor who is a viewer",
    rows: [
      allow(Permission.CreateProjectTeam),
      allow(Permission.EditProjectTeamPermissions),
      allow(Permission.Viewer),
    ],
    teamRoles: [Permission.Viewer],
    apiKeyRoles: [],
  },
  {
    name: "a key permission editor who is a viewer",
    rows: [
      allow(Permission.CreateProjectApiKey),
      allow(Permission.EditProjectApiKeyPermissions),
      allow(Permission.Viewer),
    ],
    teamRoles: [],
    apiKeyRoles: [Permission.Viewer],
  },
  {
    name: "someone who may create teams but not give them permissions",
    rows: [
      allow(Permission.CreateProjectTeam),
      allow(Permission.ReadProjectTeam),
    ],
    teamRoles: [],
    apiKeyRoles: [],
  },
  {
    name: "a project member",
    rows: [allow(Permission.ProjectMember)],
    teamRoles: [],
    apiKeyRoles: [],
  },
  {
    name: "a viewer",
    rows: [allow(Permission.Viewer)],
    teamRoles: [],
    apiKeyRoles: [],
  },
  {
    name: "a master admin",
    rows: [],
    isMasterAdmin: true,
    teamRoles: ALL_ROLES,
    apiKeyRoles: ALL_ROLES,
  },
];

// The request's props, as the server builds them for this caller.
function propsFor(caller: Caller): DatabaseCommonInteractionProps {
  if (caller.isMasterAdmin) {
    return {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      userType: UserType.MasterAdmin,
      isMasterAdmin: true,
      currentPlan: PlanType.Scale,
    };
  }

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    currentPlan: PlanType.Scale,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: caller.rows.map((row: UserPermission): UserPermission => {
          return { ...row, labelIds: [...row.labelIds] };
        }),
      },
    },
  };
}

// The same caller, signed in to the dashboard: what their browser holds.
function signInToDashboard(caller: Caller): void {
  window.localStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  UserUtil.setIsMasterAdmin(Boolean(caller.isMasterAdmin));

  if (caller.isMasterAdmin) {
    return;
  }

  PermissionUtil.setGlobalPermissions({
    _type: "UserGlobalAccessPermission",
    projectIds: [PROJECT_ID],
    globalPermissions: [Permission.Public, Permission.User],
  });
  PermissionUtil.setProjectPermissions({
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: caller.rows,
  });
}

function offeredRoles(
  caller: Caller,
  holder: RoleAccessHolder,
): Array<Permission> {
  signInToDashboard(caller);

  return getRoleAccessOptionsForCurrentUser(holder)
    .map((option: CardSelectOption): string => {
      return option.value;
    })
    .filter((value: string): boolean => {
      return value !== ROLE_ACCESS_LATER;
    }) as Array<Permission>;
}

/*
 * Whether the server creates the row the dashboard sends for this role: the
 * service's create hook (the grant ceiling, the team's own lock) and the
 * create ACL every request passes (ModelPermission.checkCreatePermissions),
 * in that order, as DatabaseService.create runs them.
 */
async function teamServerAccepts(
  caller: Caller,
  role: Permission,
): Promise<boolean> {
  const row: TeamPermission = buildTeamAccessPermission({
    teamId: TEAM_ID,
    projectId: PROJECT_ID,
    role: role,
  });
  const props: DatabaseCommonInteractionProps = propsFor(caller);
  const createBy: CreateBy<TeamPermission> = { data: row, props: props };

  try {
    await callHook(TeamPermissionService, "onBeforeCreate", createBy);
    ModelPermission.checkCreatePermissions(TeamPermission, row, props);
    return true;
  } catch (err) {
    if (err instanceof NotAuthorizedException) {
      return false;
    }

    throw err;
  }
}

async function apiKeyServerAccepts(
  caller: Caller,
  role: Permission,
): Promise<boolean> {
  const row: ApiKeyPermission = buildApiKeyAccessPermission({
    apiKeyId: API_KEY_ID,
    projectId: PROJECT_ID,
    role: role,
  });
  const props: DatabaseCommonInteractionProps = propsFor(caller);
  const createBy: CreateBy<ApiKeyPermission> = { data: row, props: props };

  try {
    await callHook(ApiKeyPermissionService, "onBeforeCreate", createBy);
    ModelPermission.checkCreatePermissions(ApiKeyPermission, row, props);
    return true;
  } catch (err) {
    if (err instanceof NotAuthorizedException) {
      return false;
    }

    throw err;
  }
}

function editableTeam(): Team {
  const team: Team = new Team(TEAM_ID);
  team.projectId = PROJECT_ID;
  team.isPermissionsEditable = true;
  return team;
}

beforeEach(() => {
  // The new team: editable, in this project. No row is on it yet.
  getJestSpyOn(TeamService, "findOneBy").mockResolvedValue(editableTeam());
  getJestSpyOn(TeamPermissionService, "findOneBy").mockResolvedValue(null);

  const apiKey: ApiKey = new ApiKey(API_KEY_ID);
  apiKey.projectId = PROJECT_ID;
  getJestSpyOn(ApiKeyService, "findOneBy").mockResolvedValue(apiKey);
  getJestSpyOn(ApiKeyPermissionService, "findOneBy").mockResolvedValue(null);
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
  PermissionGate.clearPermissionPropsCache();
});

describe("the row a new team's role becomes", () => {
  test("is an allow row at scope All, on the new team, in this project", () => {
    const row: TeamPermission = buildTeamAccessPermission({
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      role: Permission.Viewer,
    });

    expect(row.teamId?.toString()).toBe(TEAM_ID.toString());
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.isBlockPermission).toBe(false);
    expect(row.scope).toBe(PermissionScope.All);
    expect(row.labels).toBeUndefined();
  });
});

describe("Create Team's Access, caller by caller", () => {
  test.each(
    CALLERS.map((caller: Caller): [string, Caller] => {
      return [caller.name, caller];
    }),
  )(
    "%s: offered exactly what the server accepts",
    async (_name: string, caller: Caller) => {
      const offered: Array<Permission> = offeredRoles(
        caller,
        RoleAccessHolder.Team,
      );

      expect(offered).toEqual(caller.teamRoles);

      for (const role of ROLE_ACCESS_ROLES) {
        expect([role, await teamServerAccepts(caller, role)]).toEqual([
          role,
          caller.teamRoles.includes(role),
        ]);
      }
    },
  );

  test("the matrix really compares something: some answers are yes and some no", async () => {
    const answers: Set<boolean> = new Set<boolean>();

    for (const caller of CALLERS) {
      for (const role of ROLE_ACCESS_ROLES) {
        answers.add(await teamServerAccepts(caller, role));
      }
    }

    expect([...answers].sort()).toEqual([false, true]);
  });
});

describe("Create API Key's Access, caller by caller (the same question)", () => {
  test.each(
    CALLERS.map((caller: Caller): [string, Caller] => {
      return [caller.name, caller];
    }),
  )(
    "%s: offered exactly what the server accepts",
    async (_name: string, caller: Caller) => {
      const offered: Array<Permission> = offeredRoles(
        caller,
        RoleAccessHolder.ApiKey,
      );

      expect(offered).toEqual(caller.apiKeyRoles);

      for (const role of ROLE_ACCESS_ROLES) {
        expect([role, await apiKeyServerAccepts(caller, role)]).toEqual([
          role,
          caller.apiKeyRoles.includes(role),
        ]);
      }
    },
  );
});

describe("the refusals a picked role meets", () => {
  test("a project admin giving Project Member is refused by the grant ceiling, by name", async () => {
    const caller: Caller = CALLERS[1]!;
    const createBy: CreateBy<TeamPermission> = {
      data: buildTeamAccessPermission({
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        role: Permission.ProjectMember,
      }),
      props: propsFor(caller),
    };

    await expect(
      callHook(TeamPermissionService, "onBeforeCreate", createBy),
    ).rejects.toThrow(
      "You cannot grant ProjectMember because your own access does not include that permission at an equal or broader scope.",
    );
  });

  test("someone who may only create teams is refused at the table, before any grant is weighed", () => {
    const caller: Caller = CALLERS.find((candidate: Caller): boolean => {
      return candidate.name.startsWith("someone who may create teams");
    })!;

    expect(() => {
      ModelPermission.checkCreatePermissions(
        TeamPermission,
        buildTeamAccessPermission({
          teamId: TEAM_ID,
          projectId: PROJECT_ID,
          role: Permission.Viewer,
        }),
        propsFor(caller),
      );
    }).toThrow(NotAuthorizedException);

    // They may still create the team itself.
    const team: Team = new Team();
    team.name = "Support";
    team.projectId = PROJECT_ID;

    expect(() => {
      ModelPermission.checkCreatePermissions(Team, team, propsFor(caller));
    }).not.toThrow();
  });

  test("the Owners and Admin teams are locked: no role is added to them, even by an owner", async () => {
    const locked: Team = editableTeam();
    locked.isPermissionsEditable = false;
    getJestSpyOn(TeamService, "findOneBy").mockResolvedValue(locked);

    const createBy: CreateBy<TeamPermission> = {
      data: buildTeamAccessPermission({
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        role: Permission.Viewer,
      }),
      props: propsFor(CALLERS[0]!),
    };

    await expect(
      callHook(TeamPermissionService, "onBeforeCreate", createBy),
    ).rejects.toThrow(BadDataException);
  });

  test("a team in another project is not found, whatever the caller holds", async () => {
    const lookup: jest.SpyInstance = getJestSpyOn(
      TeamService,
      "findOneBy",
    ).mockResolvedValue(null);

    const createBy: CreateBy<TeamPermission> = {
      data: buildTeamAccessPermission({
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        role: Permission.Viewer,
      }),
      props: propsFor(CALLERS[0]!),
    };

    await expect(
      callHook(TeamPermissionService, "onBeforeCreate", createBy),
    ).rejects.toThrow("Invalid Team ID");

    // Looked up together with the project the request is for.
    expect(lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: TEAM_ID,
          projectId: PROJECT_ID,
        },
      }),
    );
  });
});

describe("plans", () => {
  test("giving a team its first permission needs the plan creating the team needs", () => {
    expect(new TeamPermission().createBillingPlan).toBe(
      new Team().createBillingPlan,
    );
    expect(new Team().createBillingPlan).toBe(PlanType.Scale);
  });
});
