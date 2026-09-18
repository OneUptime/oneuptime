import Label from "../../../Models/DatabaseModels/Label";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The grant site itself: AccessTokenService.refreshUserTenantAccessPermission
 * is where a signed-in member's permission set is built from their teams, and
 * it is the only place Permission.ProjectUser enters that set.
 *
 * Pinning the helper alone is not enough. The helper could keep passing while
 * the call to it is deleted, and the symptom would be issue #3305 all over
 * again - every table in the dashboard refusing a domain-scoped member, with
 * every unit test still green. So this drives the real service and asserts on
 * what it hands back and on what it writes to the cache.
 *
 * The database and Redis are mocked at the module boundary; the permission
 * logic under test is real.
 */

const mockSetJSON: jest.Mock = jest.fn();
const mockGetJSONObject: jest.Mock = jest.fn();
const mockTeamMemberFindBy: jest.Mock = jest.fn();
const mockTeamPermissionFindBy: jest.Mock = jest.fn();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
 */
jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setJSON: (...args: Array<unknown>) => {
        return mockSetJSON(...args);
      },
      getJSONObject: (...args: Array<unknown>) => {
        return mockGetJSONObject(...args);
      },
    },
  };
});

jest.mock("../../../Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>) => {
        return mockTeamMemberFindBy(...args);
      },
    },
  };
});

jest.mock("../../../Server/Services/TeamPermissionService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>) => {
        return mockTeamPermissionFindBy(...args);
      },
    },
  };
});

import AccessTokenService from "../../../Server/Services/AccessTokenService";

const userId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const teamId: ObjectID = ObjectID.generate();

type MakeTeamMemberFunction = () => TeamMember;

const makeTeamMember: MakeTeamMemberFunction = (): TeamMember => {
  const teamMember: TeamMember = new TeamMember();
  teamMember.teamId = teamId;
  teamMember.projectId = projectId;
  teamMember.userId = userId;
  return teamMember;
};

type MakeTeamPermissionFunction = (
  permission: Permission,
  labels?: Array<Label>,
) => TeamPermission;

const makeTeamPermission: MakeTeamPermissionFunction = (
  permission: Permission,
  labels: Array<Label> = [],
): TeamPermission => {
  const teamPermission: TeamPermission = new TeamPermission();
  teamPermission.permission = permission;
  teamPermission.labels = labels;
  teamPermission.isBlockPermission = false;
  return teamPermission;
};

type PermissionNamesFunction = (
  permission: UserTenantAccessPermission | null,
) => Array<Permission>;

const permissionNames: PermissionNamesFunction = (
  permission: UserTenantAccessPermission | null,
): Array<Permission> => {
  return (permission?.permissions || []).map((row: UserPermission) => {
    return row.permission;
  });
};

describe("AccessTokenService.refreshUserTenantAccessPermission", () => {
  beforeEach(() => {
    mockSetJSON.mockReset();
    mockGetJSONObject.mockReset();
    mockTeamMemberFindBy.mockReset();
    mockTeamPermissionFindBy.mockReset();
    mockSetJSON.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a member whose only role is Monitor Viewer comes back with ProjectUser", async () => {
    mockTeamMemberFindBy.mockResolvedValue([makeTeamMember()] as never);
    mockTeamPermissionFindBy.mockResolvedValue([
      makeTeamPermission(Permission.MonitorViewer),
    ] as never);

    const permission: UserTenantAccessPermission | null =
      await AccessTokenService.refreshUserTenantAccessPermission(
        userId,
        projectId,
      );

    expect(permissionNames(permission)).toEqual([
      Permission.CurrentUser,
      Permission.UnAuthorizedSsoUser,
      Permission.MonitorViewer,
      Permission.ProjectUser,
    ]);
  });

  /*
   * The cached copy has to carry it too, or the grant lasts exactly one request
   * and every later one is served the snapshot without it.
   */
  test("the snapshot written to the cache carries it as well", async () => {
    mockTeamMemberFindBy.mockResolvedValue([makeTeamMember()] as never);
    mockTeamPermissionFindBy.mockResolvedValue([
      makeTeamPermission(Permission.IncidentViewer),
    ] as never);

    await AccessTokenService.refreshUserTenantAccessPermission(
      userId,
      projectId,
    );

    expect(mockSetJSON).toHaveBeenCalledTimes(1);

    const cached: UserTenantAccessPermission = mockSetJSON.mock
      .calls[0]![2] as UserTenantAccessPermission;

    expect(permissionNames(cached)).toContain(Permission.ProjectUser);
    expect(mockSetJSON.mock.calls[0]![0]).toBe("project-permissions");
    expect(mockSetJSON.mock.calls[0]![1]).toBe(
      `${userId.toString()}:${projectId.toString()}`,
    );
  });

  /*
   * Membership is the whole condition. A user who belongs to no team of this
   * project never reaches the grant - the service returns null before it, and
   * nothing is cached for them.
   */
  test("a user who is in no team of this project gets nothing at all", async () => {
    mockTeamMemberFindBy.mockResolvedValue([] as never);

    const permission: UserTenantAccessPermission | null =
      await AccessTokenService.refreshUserTenantAccessPermission(
        userId,
        projectId,
      );

    expect(permission).toBeNull();
    expect(mockSetJSON).not.toHaveBeenCalled();
    expect(mockTeamPermissionFindBy).not.toHaveBeenCalled();
  });

  /*
   * The team's own rows are untouched by the grant, labels and all - a
   * label-scoped role must not come back unrestricted.
   */
  test("a label-scoped role keeps its labels", async () => {
    const label: Label = new Label();
    label._id = ObjectID.generate().toString();

    mockTeamMemberFindBy.mockResolvedValue([makeTeamMember()] as never);
    mockTeamPermissionFindBy.mockResolvedValue([
      makeTeamPermission(Permission.MonitorViewer, [label]),
    ] as never);

    const permission: UserTenantAccessPermission | null =
      await AccessTokenService.refreshUserTenantAccessPermission(
        userId,
        projectId,
      );

    const monitorViewer: UserPermission | undefined =
      permission?.permissions.find((row: UserPermission) => {
        return row.permission === Permission.MonitorViewer;
      });

    expect(monitorViewer?.labelIds).toHaveLength(1);
    expect(monitorViewer?.labelIds[0]?.toString()).toBe(label._id);

    const projectUser: UserPermission | undefined =
      permission?.permissions.find((row: UserPermission) => {
        return row.permission === Permission.ProjectUser;
      });

    expect(projectUser?.labelIds).toEqual([]);
  });

  test("an administrator does not end up with it twice", async () => {
    mockTeamMemberFindBy.mockResolvedValue([makeTeamMember()] as never);
    mockTeamPermissionFindBy.mockResolvedValue([
      makeTeamPermission(Permission.ProjectAdmin),
      makeTeamPermission(Permission.ProjectUser),
    ] as never);

    const permission: UserTenantAccessPermission | null =
      await AccessTokenService.refreshUserTenantAccessPermission(
        userId,
        projectId,
      );

    expect(
      permissionNames(permission).filter((name: Permission) => {
        return name === Permission.ProjectUser;
      }),
    ).toHaveLength(1);
  });
});
