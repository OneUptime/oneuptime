import UserMiddleware, {
  MULTI_TENANT_PROJECT_LOOKUPS_AT_ONCE,
} from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import { ExpressRequest } from "../../../Server/Utils/Express";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import BadDataException from "../../../Types/Exception/BadDataException";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import { uninstallEnterpriseModule } from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");
jest.mock("../../../Server/Services/AccessTokenService");
jest.mock("../../../Server/Services/GlobalConfigService");
jest.mock("../../../Server/Services/ProjectService");
jest.mock("../../../Server/Services/TeamMemberService");
jest.mock("../../../Server/Services/UserService");
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});
// See UserAuthorization.test.ts: replaced with a factory, never required.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

/*
 * A REQUEST ACROSS SOMEONE'S PROJECTS ASKS A BOUNDED NUMBER OF QUESTIONS OF
 * THE DATABASE, AND NEVER MORE THAN A FEW AT ONCE.
 *
 * The dashboard's header sends five requests across the person's projects
 * on every page (counts of open incidents, alerts, episodes, invitations).
 * Each used to ask every project's questions at once - blocked? its
 * sign-in rule? its SSO providers? their permission set? - so once the
 * per-server answers ran out, someone in 300 projects sent 600 reads of the
 * project table together, and as many permission rebuilds as the cache had
 * lost.
 *
 * Pinned here, with the services stubbed at their boundary:
 *   - every project's row is read first, in one call
 *     (ProjectService.loadAccessRules), and a failure refuses the request
 *     before any project is asked about;
 *   - the per-project questions - still each project's own getters, so a
 *     read that fails refuses the request as before - run at most
 *     MULTI_TENANT_PROJECT_LOOKUPS_AT_ONCE at a time;
 *   - the permission sets are read once, for the projects the person may
 *     open, with the global permission the list came from;
 *   - each project is answered as before: blocked or gone left out, an SSO
 *     requirement not met answered with the default set, a member with
 *     their set, a non-member left out.
 * The middleware statement counts on a real Postgres are
 * SignInStatementsPostgres.
 */

const USER_ID: ObjectID = new ObjectID("c3000000-0000-4000-8000-000000000001");

let projectNumber: number = 0;

type NewProjectIdFunction = () => ObjectID;

const newProjectId: NewProjectIdFunction = (): ObjectID => {
  projectNumber++;
  return new ObjectID(
    `c3100000-0000-4000-8000-${projectNumber.toString(16).padStart(12, "0")}`,
  );
};

type ProjectsFunction = (count: number) => Array<ObjectID>;

const projects: ProjectsFunction = (count: number): Array<ObjectID> => {
  const ids: Array<ObjectID> = [];

  for (let i: number = 0; i < count; i++) {
    ids.push(newProjectId());
  }

  return ids;
};

type SetOfFunction = (projectId: ObjectID) => UserTenantAccessPermission;

const setOf: SetOfFunction = (
  projectId: ObjectID,
): UserTenantAccessPermission => {
  return {
    _type: "UserTenantAccessPermission",
    projectId,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };
};

const request: ExpressRequest = {
  headers: {},
  cookies: {},
} as unknown as ExpressRequest;

const masterAdminRequest: ExpressRequest = {
  headers: {},
  cookies: {},
  userAuthorization: { isMasterAdmin: true },
} as unknown as ExpressRequest;

let blocked: Set<string>;
let gone: Set<string>;
let ssoRequired: Set<string>;
let ssoMet: Set<string>;
let nonMembers: Set<string>;
let order: Array<string>;

let loadAccessRules: jest.SpyInstance;
let isProjectBlocked: jest.SpyInstance;
let getRequireSsoForLogin: jest.SpyInstance;
let getRequireSsoWithSsoProviderId: jest.SpyInstance;
let getGlobalRequireSsoForLogin: jest.SpyInstance;
let isSsoSatisfiedForProject: jest.SpyInstance;
let getUserTenantAccessPermissions: jest.SpyInstance;
let getUserTenantAccessPermission: jest.SpyInstance;

type KeyFunction = (projectId: ObjectID) => string;

const key: KeyFunction = (projectId: ObjectID): string => {
  return projectId.toString().toLowerCase();
};

type ResolveFunction = (
  projectIds: Array<ObjectID>,
  options?: {
    req?: ExpressRequest;
    userGlobalAccessPermission?: UserGlobalAccessPermission;
  },
) => Promise<Dictionary<UserTenantAccessPermission> | null>;

const resolve: ResolveFunction = async (
  projectIds: Array<ObjectID>,
  options?: {
    req?: ExpressRequest;
    userGlobalAccessPermission?: UserGlobalAccessPermission;
  },
): Promise<Dictionary<UserTenantAccessPermission> | null> => {
  return await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
    options?.req || request,
    USER_ID,
    projectIds,
    options?.userGlobalAccessPermission,
  );
};

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();

  blocked = new Set<string>();
  gone = new Set<string>();
  ssoRequired = new Set<string>();
  ssoMet = new Set<string>();
  nonMembers = new Set<string>();
  order = [];

  loadAccessRules = getJestSpyOn(
    ProjectService,
    "loadAccessRules",
  ).mockImplementation(async () => {
    order.push("loadAccessRules");
  });

  isProjectBlocked = getJestSpyOn(
    ProjectService,
    "isProjectBlocked",
  ).mockImplementation(async (projectId: ObjectID) => {
    order.push("question");
    return blocked.has(key(projectId));
  });

  getRequireSsoForLogin = getJestSpyOn(
    ProjectService,
    "getRequireSsoForLogin",
  ).mockImplementation(async (projectId: ObjectID) => {
    if (gone.has(key(projectId))) {
      throw new BadDataException("Project not found");
    }

    return ssoRequired.has(key(projectId));
  });

  getRequireSsoWithSsoProviderId = getJestSpyOn(
    ProjectService,
    "getRequireSsoWithSsoProviderId",
  ).mockResolvedValue(null);

  getGlobalRequireSsoForLogin = getJestSpyOn(
    GlobalConfigService,
    "getRequireSsoForLogin",
  ).mockResolvedValue(false);

  isSsoSatisfiedForProject = getJestSpyOn(
    UserMiddleware,
    "isSsoSatisfiedForProject",
  ).mockImplementation(async (data: { projectId: ObjectID }) => {
    return ssoMet.has(key(data.projectId));
  });

  getUserTenantAccessPermissions = getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermissions",
  ).mockImplementation(async (_userId: ObjectID, ids: Array<ObjectID>) => {
    order.push("permissions");

    const sets: Map<string, UserTenantAccessPermission | null> = new Map();

    for (const projectId of ids) {
      sets.set(
        key(projectId),
        nonMembers.has(key(projectId)) ? null : setOf(projectId),
      );
    }

    return sets;
  });

  getUserTenantAccessPermission = getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermission",
  );
});

afterEach(() => {
  jest.clearAllMocks();
  uninstallEnterpriseModule();
});

describe("what a request across projects reads", () => {
  test("every project's row first, in one call; then each project's questions; then every permission set at once", async () => {
    const ids: Array<ObjectID> = projects(300);
    const globalPermission: UserGlobalAccessPermission = {
      _type: "UserGlobalAccessPermission",
      projectIds: ids,
      globalPermissions: [],
    };

    const result: Dictionary<UserTenantAccessPermission> | null = await resolve(
      ids,
      { userGlobalAccessPermission: globalPermission },
    );

    expect(loadAccessRules).toHaveBeenCalledTimes(1);
    expect(loadAccessRules).toHaveBeenCalledWith(ids);
    expect(order[0]).toBe("loadAccessRules");
    expect(order[order.length - 1]).toBe("permissions");

    expect(getUserTenantAccessPermissions).toHaveBeenCalledTimes(1);
    expect(getUserTenantAccessPermissions).toHaveBeenCalledWith(USER_ID, ids, {
      userGlobalAccessPermission: globalPermission,
    });
    // Never one project's set at a time.
    expect(getUserTenantAccessPermission).not.toHaveBeenCalled();

    expect(Object.keys(result || {})).toHaveLength(300);
  });

  test("no projects: nothing is read", async () => {
    await expect(resolve([])).resolves.toBeNull();

    expect(loadAccessRules).not.toHaveBeenCalled();
    expect(getUserTenantAccessPermissions).not.toHaveBeenCalled();
  });

  test("the server's own rule is read once, whatever the number of projects, and not for a master admin", async () => {
    await resolve(projects(50));
    expect(getGlobalRequireSsoForLogin).toHaveBeenCalledTimes(1);

    getGlobalRequireSsoForLogin.mockClear();
    await resolve(projects(50), { req: masterAdminRequest });
    expect(getGlobalRequireSsoForLogin).not.toHaveBeenCalled();
  });
});

describe(`at most ${MULTI_TENANT_PROJECT_LOOKUPS_AT_ONCE} projects are asked about at once`, () => {
  test("is a few, far fewer than a pool's connections", () => {
    expect(MULTI_TENANT_PROJECT_LOOKUPS_AT_ONCE).toBeGreaterThanOrEqual(1);
    expect(MULTI_TENANT_PROJECT_LOOKUPS_AT_ONCE).toBeLessThanOrEqual(8);
  });

  type MeasureFunction = (
    spy: jest.SpyInstance,
    answer: (projectId: ObjectID) => unknown,
  ) => { maxInFlight: () => number };

  // Each answer waits a moment, so the questions in flight together can be counted.
  const measure: MeasureFunction = (
    spy: jest.SpyInstance,
    answer: (projectId: ObjectID) => unknown,
  ): { maxInFlight: () => number } => {
    let inFlight: number = 0;
    let maxInFlight: number = 0;

    spy.mockImplementation(async (arg: unknown) => {
      const projectId: ObjectID =
        arg instanceof ObjectID
          ? arg
          : (arg as { projectId: ObjectID }).projectId;

      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);

      await new Promise<void>((done: () => void) => {
        setTimeout(done, 2);
      });

      inFlight--;
      return answer(projectId);
    });

    return {
      maxInFlight: (): number => {
        return maxInFlight;
      },
    };
  };

  test("whether each is blocked: 40 projects, never more than the cap in flight, and the cap reached", async () => {
    const counted: { maxInFlight: () => number } = measure(
      isProjectBlocked,
      () => {
        return false;
      },
    );

    await resolve(projects(40));

    expect(isProjectBlocked).toHaveBeenCalledTimes(40);
    expect(counted.maxInFlight()).toBe(MULTI_TENANT_PROJECT_LOOKUPS_AT_ONCE);
  });

  test("whether each one's SSO requirement is met - the question that still reads the database", async () => {
    const ids: Array<ObjectID> = projects(40);
    getGlobalRequireSsoForLogin.mockResolvedValue(true);

    const counted: { maxInFlight: () => number } = measure(
      isSsoSatisfiedForProject,
      () => {
        return true;
      },
    );

    const result: Dictionary<UserTenantAccessPermission> | null =
      await resolve(ids);

    expect(isSsoSatisfiedForProject).toHaveBeenCalledTimes(40);
    expect(counted.maxInFlight()).toBe(MULTI_TENANT_PROJECT_LOOKUPS_AT_ONCE);
    expect(Object.keys(result || {})).toHaveLength(40);
  });

  test("fewer projects than the cap are all asked about at once", async () => {
    const counted: { maxInFlight: () => number } = measure(
      isProjectBlocked,
      () => {
        return false;
      },
    );

    await resolve(projects(2));

    expect(counted.maxInFlight()).toBe(2);
  });
});

describe("each project is answered as before", () => {
  test("blocked or gone: left out, and its permissions not read; SSO not met: the default set; a non-member: left out", async () => {
    const [member, isBlocked, isGone, notSignedIn, signedIn, nonMember] =
      projects(6);

    blocked.add(key(isBlocked!));
    gone.add(key(isGone!));
    ssoRequired.add(key(notSignedIn!));
    ssoRequired.add(key(signedIn!));
    ssoMet.add(key(signedIn!));
    nonMembers.add(key(nonMember!));

    const ids: Array<ObjectID> = [
      member!,
      isBlocked!,
      isGone!,
      notSignedIn!,
      signedIn!,
      nonMember!,
    ];

    const result: Dictionary<UserTenantAccessPermission> | null =
      await resolve(ids);

    // In the order asked.
    expect(Object.keys(result || {})).toEqual([
      member!.toString(),
      notSignedIn!.toString(),
      signedIn!.toString(),
    ]);
    expect(result![member!.toString()]).toEqual(setOf(member!));
    expect(result![signedIn!.toString()]).toEqual(setOf(signedIn!));
    expect(result![notSignedIn!.toString()]).toEqual(
      UserPermissionUtil.getDefaultUserTenantAccessPermission(notSignedIn!),
    );

    // Only the projects the person may open have their sets read.
    expect(getUserTenantAccessPermissions).toHaveBeenCalledWith(
      USER_ID,
      [member, signedIn, nonMember],
      { userGlobalAccessPermission: undefined },
    );

    // The pinned provider is read only where SSO is required.
    expect(getRequireSsoWithSsoProviderId).toHaveBeenCalledTimes(2);
  });

  test("a master admin keeps a blocked project", async () => {
    const [isBlocked] = projects(1);
    blocked.add(key(isBlocked!));
    isProjectBlocked.mockClear();

    const result: Dictionary<UserTenantAccessPermission> | null = await resolve(
      [isBlocked!],
      { req: masterAdminRequest },
    );

    expect(Object.keys(result || {})).toEqual([isBlocked!.toString()]);
    expect(isProjectBlocked).not.toHaveBeenCalled();
  });

  test("nothing the person may open: null, and no permission set read", async () => {
    const ids: Array<ObjectID> = projects(3);

    for (const projectId of ids) {
      blocked.add(key(projectId));
    }

    await expect(resolve(ids)).resolves.toBeNull();
    expect(getUserTenantAccessPermissions).not.toHaveBeenCalled();
  });

  test("a project whose id is written in capitals is answered by its own key", async () => {
    const [projectId] = projects(1);
    const capitals: ObjectID = new ObjectID(
      projectId!.toString().toUpperCase(),
    );

    const result: Dictionary<UserTenantAccessPermission> | null = await resolve(
      [capitals],
    );

    expect(Object.keys(result || {})).toEqual([capitals.toString()]);
  });
});

describe("a read that fails refuses the whole request", () => {
  test("the rows' read: before any project is asked about", async () => {
    loadAccessRules.mockRejectedValue(new Error("pool exhausted"));

    await expect(resolve(projects(10))).rejects.toThrow("pool exhausted");

    expect(isProjectBlocked).not.toHaveBeenCalled();
    expect(getUserTenantAccessPermissions).not.toHaveBeenCalled();
  });

  test("one project's blocked status", async () => {
    const ids: Array<ObjectID> = projects(10);

    isProjectBlocked.mockImplementation(async (projectId: ObjectID) => {
      if (projectId.toString() === ids[6]!.toString()) {
        throw new Error("statement timeout");
      }

      return false;
    });

    await expect(resolve(ids)).rejects.toThrow("statement timeout");
    expect(getUserTenantAccessPermissions).not.toHaveBeenCalled();
  });

  test("one project's sign-in rule - never 'not required'", async () => {
    const ids: Array<ObjectID> = projects(5);

    getRequireSsoForLogin.mockImplementation(async (projectId: ObjectID) => {
      if (projectId.toString() === ids[3]!.toString()) {
        throw new Error("database down");
      }

      return false;
    });

    await expect(resolve(ids)).rejects.toThrow("database down");
  });

  test("one project's SSO providers", async () => {
    const ids: Array<ObjectID> = projects(5);
    ssoRequired.add(key(ids[2]!));
    isSsoSatisfiedForProject.mockRejectedValue(new Error("provider lookup"));

    await expect(resolve(ids)).rejects.toThrow("provider lookup");
  });

  test("the permission sets' read", async () => {
    getUserTenantAccessPermissions.mockRejectedValue(
      new Error("cache unavailable"),
    );

    await expect(resolve(projects(5))).rejects.toThrow("cache unavailable");
  });
});
