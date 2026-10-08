import DatabaseConfig from "../../../Server/DatabaseConfig";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import {
  SERVER_SIGN_IN_LOCK_KEY,
  SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
} from "../../../Server/Utils/ProjectSsoProviderChanges";
import {
  NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
  REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE,
  SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE,
} from "../../../Server/Utils/SsoRequirementChanges";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalOidc from "../../../Models/DatabaseModels/GlobalOidc";
import GlobalSso from "../../../Models/DatabaseModels/GlobalSso";
import GlobalSsoProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  mocked["NotificationSlackWebhookOnCreateProject"] = "";

  return mocked;
});

/*
 * A PROJECT IS CREATED WITH A WAY IN (Server/Utils/SsoRequirementChanges.
 * beforeProjectCreate, from ProjectService.onCreatePermitted).
 *
 * The real create path of ProjectService - DatabaseService and the
 * service's hooks - with only the repository, the creator's user row, the
 * project-creation switch, the duplicate-name count, the seeding that
 * follows a create, the server's sign-in rules and the global providers
 * held in memory below. A new project has no SSO provider of its own yet:
 *
 *   - created with Require SSO for Login on, or naming a provider to
 *     require, it is held to the rule an update is held to, and refused in
 *     the same words while no global provider signs people in to every
 *     project - whoever creates it;
 *   - created while the whole server requires SSO, it needs such a provider
 *     too, or its creator could not open it: refused with words that say a
 *     server admin can turn one on - unless the creator is a master admin,
 *     whom the server's rule does not hold;
 *   - the check reads the rules under the lock on the server's sign-in
 *     rules, held until the project is written and given back before the
 *     seeding that follows, or as soon as the create fails.
 */

const USER_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000001");
const GLOBAL_SAML: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000101",
);
const RESTRICTED_SAML: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000102",
);
const GLOBAL_OIDC: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000103",
);
const OTHER_PROJECT: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000201",
);

const SERVER_LOCK: string = SERVER_SIGN_IN_LOCK_KEY;

// The creators: someone signed in to the Dashboard, a server admin, and OneUptime itself.
type Creator = "member" | "masterAdmin" | "root";

// A global provider that is on, and the projects it is attached to.
interface GlobalProvider {
  id: ObjectID;
  restrictToAttachedProjects: boolean;
  attachedTo: Array<ObjectID>;
}

let serverRequiresSso: boolean;
let globalSaml: Array<GlobalProvider>;
let globalOidc: Array<GlobalProvider>;
let creatorIsMasterAdmin: boolean;
let events: Array<string>;
let saved: Array<Project>;
let saveFails: boolean;
let lockBusy: boolean;
let locksUnreachable: boolean;
let lostLocks: Array<string>;

const SEEDERS: Array<string> = [
  "addDefaultIncidentSeverity",
  "addDefaultAlertSeverity",
  "addDefaultProjectTeams",
  "addDefaultMonitorStatus",
  "addDefaultIncidentState",
  "addDefaultScheduledMaintenanceState",
  "addDefaultAlertState",
  "addDefaultIncidentRoles",
  "addDefaultNetworkSiteTypes",
  "addDefaultNetworkDeviceRoles",
];

const propsOf: (creator: Creator) => DatabaseCommonInteractionProps = (
  creator: Creator,
): DatabaseCommonInteractionProps => {
  if (creator === "root") {
    return { userId: USER_ID, isRoot: true };
  }

  return {
    userId: USER_ID,
    ...(creator === "masterAdmin" ? { isMasterAdmin: true } : {}),
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [],
      _type: "UserGlobalAccessPermission",
    },
  } as DatabaseCommonInteractionProps;
};

// Creates a project as `creator`: "created", or the words it was refused in.
const create: (
  creator: Creator,
  rule?: { requireSsoForLogin?: boolean; requireSsoWithSsoProviderId?: ObjectID },
) => Promise<string> = async (
  creator: Creator,
  rule?: { requireSsoForLogin?: boolean; requireSsoWithSsoProviderId?: ObjectID },
): Promise<string> => {
  creatorIsMasterAdmin = creator === "masterAdmin";

  const project: Project = new Project();
  project.name = "Acme";

  if (rule?.requireSsoForLogin !== undefined) {
    project.requireSsoForLogin = rule.requireSsoForLogin;
  }

  if (rule?.requireSsoWithSsoProviderId) {
    project.requireSsoWithSsoProviderId = rule.requireSsoWithSsoProviderId;
  }

  try {
    await ProjectService.create({ data: project, props: propsOf(creator) });
    return "created";
  } catch (err) {
    if (err instanceof BadDataException) {
      return err.message;
    }

    throw err;
  }
};

const lockEvents: () => Array<string> = (): Array<string> => {
  return events.filter((event: string): boolean => {
    return event.startsWith("lock:") || event.startsWith("release:");
  });
};

const providerRows: (
  providers: Array<GlobalProvider>,
  createModel: () => GlobalSso | GlobalOidc,
) => Array<GlobalSso | GlobalOidc> = (
  providers: Array<GlobalProvider>,
  createModel: () => GlobalSso | GlobalOidc,
): Array<GlobalSso | GlobalOidc> => {
  return providers.map((provider: GlobalProvider): GlobalSso | GlobalOidc => {
    const model: GlobalSso | GlobalOidc = createModel();
    model.id = provider.id;
    model.isEnabled = true;
    model.restrictToAttachedProjects = provider.restrictToAttachedProjects;
    return model;
  });
};

beforeEach(() => {
  setTestBillingEnabled(false);

  serverRequiresSso = false;
  globalSaml = [];
  globalOidc = [];
  creatorIsMasterAdmin = false;
  events = [];
  saved = [];
  saveFails = false;
  lockBusy = false;
  locksUnreachable = false;
  lostLocks = [];

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  // The creator: a master admin or not.
  getJestSpyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User();
    user.id = USER_ID;
    user.isMasterAdmin = creatorIsMasterAdmin;
    return user;
  }) as never);
  getJestSpyOn(
    DatabaseConfig,
    "shouldDisableUserProjectCreation",
  ).mockResolvedValue(false as never);
  getJestSpyOn(ProjectService, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );

  // The project row: what is saved, unless the database fails it.
  getJestSpyOn(ProjectService, "getRepository").mockReturnValue({
    save: async (project: Project): Promise<Project> => {
      if (saveFails) {
        throw new Error("The database could not write the project");
      }

      events.push("save");
      project.id = ObjectID.generate();
      saved.push(project);
      return project;
    },
  } as never);
  getJestSpyOn(ProjectService, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectService, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProductAnalytics, "capture").mockReturnValue(undefined);

  // The seeding a create is followed by: the default teams, states and the rest.
  for (const seeder of SEEDERS) {
    getJestSpyOn(ProjectService, seeder).mockImplementation((async () => {
      if (!events.includes("seed")) {
        events.push("seed");
      }
    }) as never);
  }

  // The server's Require SSO for Login, as the Admin Dashboard sets it.
  getJestSpyOn(GlobalConfigService, "findOneBy").mockImplementation((async () => {
    events.push("read:server-rule");
    const config: GlobalConfig = new GlobalConfig();
    config.requireSsoForLogin = serverRequiresSso;
    return config;
  }) as never);

  // The global providers that are on (the check asks for those), and their attachments.
  getJestSpyOn(GlobalSsoService, "findBy").mockImplementation((async () => {
    events.push("read:global-providers");
    return providerRows(globalSaml, (): GlobalSso => {
      return new GlobalSso();
    });
  }) as never);
  getJestSpyOn(GlobalOidcService, "findBy").mockImplementation((async () => {
    return providerRows(globalOidc, (): GlobalOidc => {
      return new GlobalOidc();
    });
  }) as never);
  getJestSpyOn(GlobalSsoProjectService, "findAllBy").mockImplementation(
    (async () => {
      return globalSaml.flatMap(
        (provider: GlobalProvider): Array<GlobalSsoProject> => {
          return provider.attachedTo.map(
            (projectId: ObjectID): GlobalSsoProject => {
              const attachment: GlobalSsoProject = new GlobalSsoProject();
              attachment.id = ObjectID.generate();
              attachment.globalSsoId = provider.id;
              attachment.projectId = projectId;
              attachment.isEnabled = true;
              return attachment;
            },
          );
        },
      );
    }) as never,
  );
  getJestSpyOn(GlobalOidcProjectService, "findAllBy").mockResolvedValue(
    [] as never,
  );

  // The lock on the server's sign-in rules, held in memory.
  getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
  }): Promise<unknown> => {
    if (locksUnreachable) {
      throw new Error("Redis client is not connected");
    }

    if (lockBusy) {
      throw new SemaphoreLockTimeoutError(`Acquire mutex ${data.key} timeout`);
    }

    events.push(`lock:${data.key}`);
    return { key: data.key };
  }) as never);
  getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
    key: string;
  }): Promise<void> => {
    events.push(`release:${mutex.key}`);
  }) as never);
  getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
    key: string;
  }): Promise<boolean> => {
    events.push(`keep:${mutex.key}`);
    return !lostLocks.includes(mutex.key);
  }) as never);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

const everyProject: (id: ObjectID) => GlobalProvider = (
  id: ObjectID,
): GlobalProvider => {
  return { id, restrictToAttachedProjects: false, attachedTo: [] };
};

describe("a project created with Require SSO for Login on", () => {
  test.each(["masterAdmin", "root"] as Array<Creator>)(
    "by %s, is refused while no provider would sign anyone in to it, in the words an update is refused in, and nothing is written",
    async (creator: Creator) => {
      await expect(create(creator, { requireSsoForLogin: true })).resolves.toBe(
        NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
      );

      expect(saved).toEqual([]);
      expect(lockEvents()).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
    },
  );

  test("a project member cannot send it at all: the column is not theirs to write when creating", async () => {
    let refusal: unknown = null;

    try {
      await ProjectService.create({
        data: Object.assign(new Project(), {
          name: "Acme",
          requireSsoForLogin: true,
        }),
        props: propsOf("member"),
      });
    } catch (err) {
      refusal = err;
    }

    expect(refusal).toBeInstanceOf(ColumnWriteRefusedException);
    expect(saved).toEqual([]);
  });

  test("goes through with a global provider that signs people in to every project, the check holding the lock until the project is written", async () => {
    globalSaml = [everyProject(GLOBAL_SAML)];

    await expect(
      create("masterAdmin", { requireSsoForLogin: true }),
    ).resolves.toBe("created");

    expect(saved).toHaveLength(1);
    expect(saved[0]!.requireSsoForLogin).toBe(true);
    expect(
      events.filter((event: string): boolean => {
        return !event.startsWith("keep:");
      }),
    ).toEqual([
      `lock:${SERVER_LOCK}`,
      "read:global-providers",
      "save",
      `release:${SERVER_LOCK}`,
      "seed",
    ]);
  });

  test("a global OIDC provider counts the same", async () => {
    globalOidc = [everyProject(GLOBAL_OIDC)];

    await expect(
      create("masterAdmin", { requireSsoForLogin: true }),
    ).resolves.toBe("created");
  });

  test("a provider restricted to its attached projects counts only while it has none: no project is attached to one created now", async () => {
    globalSaml = [
      { id: RESTRICTED_SAML, restrictToAttachedProjects: true, attachedTo: [] },
    ];

    await expect(
      create("masterAdmin", { requireSsoForLogin: true }),
    ).resolves.toBe("created");

    globalSaml = [
      {
        id: RESTRICTED_SAML,
        restrictToAttachedProjects: true,
        attachedTo: [OTHER_PROJECT],
      },
    ];

    await expect(
      create("masterAdmin", { requireSsoForLogin: true }),
    ).resolves.toBe(NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE);
    expect(saved).toHaveLength(1);
  });

  test("the provider it requires must be one that signs people in to it", async () => {
    globalSaml = [
      everyProject(GLOBAL_SAML),
      {
        id: RESTRICTED_SAML,
        restrictToAttachedProjects: true,
        attachedTo: [OTHER_PROJECT],
      },
    ];

    await expect(
      create("masterAdmin", {
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: RESTRICTED_SAML,
      }),
    ).resolves.toBe(REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE);

    await expect(
      create("masterAdmin", {
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: GLOBAL_OIDC,
      }),
    ).resolves.toBe(REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE);

    expect(saved).toEqual([]);

    await expect(
      create("masterAdmin", {
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: GLOBAL_SAML,
      }),
    ).resolves.toBe("created");
  });

  test("created with it off, it asks nothing of SSO itself", async () => {
    await expect(
      create("masterAdmin", { requireSsoForLogin: false }),
    ).resolves.toBe("created");

    expect(lockEvents()).toEqual([]);
  });
});

describe("a project created while the whole server requires SSO", () => {
  beforeEach(() => {
    serverRequiresSso = true;
  });

  test("is refused while no provider would sign anyone in to a new project, saying a server admin can turn one on, and nothing is written", async () => {
    await expect(create("member")).resolves.toBe(
      SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE,
    );

    expect(SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE).toContain(
      "server admin",
    );
    expect(saved).toEqual([]);
    expect(lockEvents()).toEqual([
      `lock:${SERVER_LOCK}`,
      `release:${SERVER_LOCK}`,
    ]);
  });

  test("goes through with a global provider that signs people in to every project", async () => {
    globalSaml = [everyProject(GLOBAL_SAML)];

    await expect(create("member")).resolves.toBe("created");
    expect(saved).toHaveLength(1);
  });

  test("a provider restricted to projects it is attached to does not sign anyone in to a new one", async () => {
    globalSaml = [
      {
        id: RESTRICTED_SAML,
        restrictToAttachedProjects: true,
        attachedTo: [OTHER_PROJECT],
      },
    ];

    await expect(create("member")).resolves.toBe(
      SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE,
    );
  });

  test("a master admin, whom the server's rule does not hold, is not refused, and the check takes no lock and reads nothing", async () => {
    await expect(create("masterAdmin")).resolves.toBe("created");

    expect(saved).toHaveLength(1);
    expect(lockEvents()).toEqual([]);
    expect(events).not.toContain("read:server-rule");
  });

  test("a master admin's create that names a provider to require is held to the rule an update is held to, the server's rule included", async () => {
    globalSaml = [everyProject(GLOBAL_SAML)];

    await expect(
      create("masterAdmin", { requireSsoWithSsoProviderId: GLOBAL_OIDC }),
    ).resolves.toBe(REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE);
    expect(saved).toEqual([]);

    await expect(
      create("masterAdmin", { requireSsoWithSsoProviderId: GLOBAL_SAML }),
    ).resolves.toBe("created");
  });

  test("OneUptime's own create for someone who is no master admin is held to it, as theirs is", async () => {
    await expect(create("root")).resolves.toBe(
      SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE,
    );
  });

  test("the server's rule is read under the lock, never before it", async () => {
    globalSaml = [everyProject(GLOBAL_SAML)];

    await create("member");

    expect(events.indexOf(`lock:${SERVER_LOCK}`)).toBeLessThan(
      events.indexOf("read:server-rule"),
    );
  });
});

describe("a project created while the server does not require SSO", () => {
  test("goes through, holding the lock on the server's sign-in rules from the read until it is written: a server turning the rule on at that moment reads the project, or is read", async () => {
    await expect(create("member")).resolves.toBe("created");

    expect(
      events.filter((event: string): boolean => {
        return !event.startsWith("keep:");
      }),
    ).toEqual([
      `lock:${SERVER_LOCK}`,
      "read:server-rule",
      "save",
      `release:${SERVER_LOCK}`,
      "seed",
    ]);
  });

  test("reads no provider: none is needed", async () => {
    await create("member");

    expect(events).not.toContain("read:global-providers");
  });

  test("the lock is kept once more after the check, for the write that follows", async () => {
    await create("member");

    expect(events.indexOf(`keep:${SERVER_LOCK}`)).toBeGreaterThan(
      events.indexOf("read:server-rule"),
    );
    expect(events.indexOf(`keep:${SERVER_LOCK}`)).toBeLessThan(
      events.indexOf("save"),
    );
  });
});

describe("the lock the check holds", () => {
  test("a create the database fails gives it back at once", async () => {
    saveFails = true;

    await expect(create("member")).rejects.toThrow(
      "The database could not write the project",
    );

    expect(saved).toEqual([]);
    expect(lockEvents()).toEqual([
      `lock:${SERVER_LOCK}`,
      `release:${SERVER_LOCK}`,
    ]);
  });

  test("is given back once only, when the create succeeds", async () => {
    await create("member");

    expect(
      events.filter((event: string): boolean => {
        return event === `release:${SERVER_LOCK}`;
      }),
    ).toHaveLength(1);
  });

  test("held by another change for longer than a create waits refuses the create: try again in a moment", async () => {
    lockBusy = true;

    await expect(create("member")).resolves.toBe(
      SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
    );
    expect(saved).toEqual([]);
  });

  test("found lost after the check refuses the create, and is given back", async () => {
    lostLocks = [SERVER_LOCK];

    await expect(create("member")).resolves.toBe(
      SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
    );
    expect(saved).toEqual([]);
    expect(lockEvents()).toEqual([
      `lock:${SERVER_LOCK}`,
      `release:${SERVER_LOCK}`,
    ]);
  });

  test("without Valkey the check still runs, unlocked", async () => {
    locksUnreachable = true;
    serverRequiresSso = true;

    await expect(create("member")).resolves.toBe(
      SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE,
    );

    globalSaml = [everyProject(GLOBAL_SAML)];

    await expect(create("member")).resolves.toBe("created");
    expect(lockEvents()).toEqual([]);
  });
});
