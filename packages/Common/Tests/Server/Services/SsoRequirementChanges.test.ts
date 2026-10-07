import Semaphore from "../../../Server/Infrastructure/Semaphore";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import {
  NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
  REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE,
} from "../../../Server/Utils/SsoRequirementChanges";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalSso from "../../../Models/DatabaseModels/GlobalSso";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { UserGlobalAccessPermission } from "../../../Types/Permission";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
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

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * REQUIRING SSO NEEDS A PROVIDER THAT SIGNS PEOPLE IN
 * (Server/Utils/SsoRequirementChanges).
 *
 * The real update path of ProjectService - DatabaseService and the
 * service's hooks - over one project held in memory: only the repository,
 * the permission checks (not under test) and the providers' reads are
 * stubbed. Turning Require SSO for Login on, or requiring another provider,
 * is refused while no provider would sign anyone in to the project, in
 * words that say what to set up first; the check and the write hold the
 * project's lock and the one on the server's sign-in rules. Asking for less
 * - turning it off, clearing the provider - is never refused and takes no
 * lock. The server's own rule is covered with the global providers
 * (Tests/Server/API/GlobalSsoProviderChanges.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OWN_SAML: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const GLOBAL_SAML: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const UNKNOWN_PROVIDER: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const SERVER_LOCK: string = "server";

let storedProject: Record<string, unknown>;
let projectWrites: Array<Record<string, unknown>>;
let ownSamlOn: boolean;
let globalSamlOn: boolean;
let events: Array<string>;

const ownerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      ...ON_HIGHEST_PLAN,
      userGlobalAccessPermission: {
        projectIds: [PROJECT_ID],
      } as unknown as UserGlobalAccessPermission,
    };
  };

const updateProject: (
  data: Record<string, unknown>,
) => Promise<string> = async (
  data: Record<string, unknown>,
): Promise<string> => {
  try {
    await ProjectService.updateOneById({
      id: PROJECT_ID,
      data: data as UpdateBy<Project>["data"],
      props: ownerProps(),
    });
    return "done";
  } catch (err) {
    if (err instanceof BadDataException) {
      return err.message;
    }

    throw err;
  }
};

const locksTaken: () => Array<string> = (): Array<string> => {
  return events.filter((event: string): boolean => {
    return event.startsWith("lock:");
  });
};

beforeEach(() => {
  setTestBillingEnabled(false);

  storedProject = {
    name: "Acme",
    requireSsoForLogin: false,
    requireSsoWithSsoProviderId: null,
  };
  projectWrites = [];
  ownSamlOn = false;
  globalSamlOn = false;
  events = [];

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  // The permission checks are not under test; let the requests through.
  getJestSpyOn(ModelPermission, "checkReadQueryPermission").mockImplementation(
    async (
      _modelType: unknown,
      query: unknown,
      select: unknown,
    ): Promise<unknown> => {
      return { query, select, relationSelect: null };
    },
  );
  getJestSpyOn(
    ModelPermission,
    "checkUpdatePermissionByModel",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    ModelPermission,
    "checkUpdateQueryPermissions",
  ).mockImplementation(async (_modelType: unknown, query: unknown) => {
    return query;
  });
  getJestSpyOn(ModelPermission, "checkTableWritePermission").mockReturnValue(
    undefined,
  );
  getJestSpyOn(ModelPermission, "getUpdatableQuery").mockImplementation(
    async (_modelType: unknown, query: unknown) => {
      return query;
    },
  );

  const auditLogService: { recordUpdate: () => Promise<void> } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("../../../Server/Services/AuditLogService").default;
  getJestSpyOn(auditLogService, "recordUpdate").mockResolvedValue(undefined);

  // The project, one row: every read sees it as it is now, every write lands on it.
  getJestSpyOn(ProjectService, "getRepository").mockReturnValue({
    find: async (): Promise<Array<Project>> => {
      const item: Project = new Project();
      item._id = PROJECT_ID.toString();

      for (const [column, value] of Object.entries(storedProject)) {
        if (value !== null && value !== undefined) {
          (item as unknown as Record<string, unknown>)[column] = value;
        }
      }

      return [item];
    },
    update: async (
      _where: unknown,
      set: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      const written: Record<string, unknown> = { ...set };
      delete written["version"];
      projectWrites.push(written);
      events.push("write");
      Object.assign(storedProject, written);
      return { affected: 1 };
    },
  });
  getJestSpyOn(ProjectService, "onTriggerWorkflow").mockResolvedValue(
    undefined,
  );
  getJestSpyOn(ProjectService, "onTriggerRealtime").mockResolvedValue(
    undefined,
  );

  // The project's own SAML provider, when it is on.
  getJestSpyOn(ProjectSsoService, "findAllBy").mockImplementation(
    async (): Promise<Array<unknown>> => {
      return ownSamlOn
        ? [{ id: OWN_SAML, projectId: PROJECT_ID, isEnabled: true }]
        : [];
    },
  );
  getJestSpyOn(ProjectOidcService, "findAllBy").mockResolvedValue([]);

  // A global SAML provider that signs people in to every project, when it is on.
  getJestSpyOn(GlobalSsoService, "findBy").mockImplementation(
    async (): Promise<Array<GlobalSso>> => {
      if (!globalSamlOn) {
        return [];
      }

      const provider: GlobalSso = new GlobalSso();
      provider.id = GLOBAL_SAML;
      provider.isEnabled = true;
      provider.restrictToAttachedProjects = false;
      return [provider];
    },
  );
  getJestSpyOn(GlobalOidcService, "findBy").mockResolvedValue([]);
  getJestSpyOn(GlobalSsoProjectService, "findAllBy").mockResolvedValue([]);

  getJestSpyOn(GlobalConfigService, "findOneBy").mockImplementation(
    async (): Promise<GlobalConfig> => {
      const config: GlobalConfig = new GlobalConfig();
      config.requireSsoForLogin = false;
      return config;
    },
  );

  getJestSpyOn(Semaphore, "lock").mockImplementation(
    async (data: { key: string }): Promise<unknown> => {
      events.push(`lock:${data.key}`);
      return { key: data.key };
    },
  );
  getJestSpyOn(Semaphore, "release").mockImplementation(
    async (mutex: { key: string }): Promise<void> => {
      events.push(`release:${mutex.key}`);
    },
  );
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("turning Require SSO for Login on for a project", () => {
  test("is refused while no SSO provider signs people in to it, in words that say what to set up first", async () => {
    await expect(updateProject({ requireSsoForLogin: true })).resolves.toBe(
      NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
    );

    expect(projectWrites).toEqual([]);
    expect(storedProject["requireSsoForLogin"]).toBe(false);
    // Both locks were taken for the check and given back at once.
    expect(events).toEqual([
      `lock:${PROJECT_ID.toString()}`,
      `lock:${SERVER_LOCK}`,
      `release:${PROJECT_ID.toString()}`,
      `release:${SERVER_LOCK}`,
    ]);
  });

  test("goes through with one of its own providers on, holding both locks until it is written", async () => {
    ownSamlOn = true;

    await expect(updateProject({ requireSsoForLogin: true })).resolves.toBe(
      "done",
    );

    expect(storedProject["requireSsoForLogin"]).toBe(true);
    expect(events).toEqual([
      `lock:${PROJECT_ID.toString()}`,
      `lock:${SERVER_LOCK}`,
      "write",
      `release:${PROJECT_ID.toString()}`,
      `release:${SERVER_LOCK}`,
    ]);
  });

  test("a global provider that signs people in to every project counts", async () => {
    globalSamlOn = true;

    await expect(updateProject({ requireSsoForLogin: true })).resolves.toBe(
      "done",
    );
  });

  test("the provider it would require must be one that signs people in to it", async () => {
    ownSamlOn = true;

    await expect(
      updateProject({
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: UNKNOWN_PROVIDER,
      }),
    ).resolves.toBe(REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE);
    expect(projectWrites).toEqual([]);

    await expect(
      updateProject({
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: OWN_SAML,
      }),
    ).resolves.toBe("done");
  });

  test("requiring another provider while SSO is required is checked the same way", async () => {
    ownSamlOn = true;
    storedProject["requireSsoForLogin"] = true;
    storedProject["requireSsoWithSsoProviderId"] = OWN_SAML;

    await expect(
      updateProject({ requireSsoWithSsoProviderId: GLOBAL_SAML }),
    ).resolves.toBe(REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE);

    globalSamlOn = true;

    await expect(
      updateProject({ requireSsoWithSsoProviderId: GLOBAL_SAML }),
    ).resolves.toBe("done");
  });

  test("saving back the rule it already has asks for nothing more and is not refused", async () => {
    // Its provider went off since: that is not this write's doing.
    storedProject["requireSsoForLogin"] = true;
    storedProject["requireSsoWithSsoProviderId"] = OWN_SAML;

    await expect(
      updateProject({
        name: "Renamed",
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: OWN_SAML,
      }),
    ).resolves.toBe("done");

    expect(storedProject["name"]).toBe("Renamed");
  });

  test("turning it off, or clearing the provider, is never refused and takes no lock", async () => {
    storedProject["requireSsoForLogin"] = true;
    storedProject["requireSsoWithSsoProviderId"] = OWN_SAML;

    await expect(
      updateProject({ requireSsoWithSsoProviderId: null }),
    ).resolves.toBe("done");
    await expect(updateProject({ requireSsoForLogin: false })).resolves.toBe(
      "done",
    );

    expect(locksTaken()).toEqual([]);
    expect(storedProject["requireSsoForLogin"]).toBe(false);
  });

  test("changing anything else takes no lock", async () => {
    await expect(updateProject({ name: "Renamed" })).resolves.toBe("done");

    expect(locksTaken()).toEqual([]);
  });

  test("a write refused after the check, before it is written, gives both locks back", async () => {
    ownSamlOn = true;
    getJestSpyOn(
      ProjectService,
      "chargeAutoRechargeTurnedOn",
    ).mockRejectedValue(new BadDataException("No card on file"));

    await expect(updateProject({ requireSsoForLogin: true })).resolves.toBe(
      "No card on file",
    );

    expect(projectWrites).toEqual([]);
    expect(events).toEqual([
      `lock:${PROJECT_ID.toString()}`,
      `lock:${SERVER_LOCK}`,
      `release:${PROJECT_ID.toString()}`,
      `release:${SERVER_LOCK}`,
    ]);
  });
});
