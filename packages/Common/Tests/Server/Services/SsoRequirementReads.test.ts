import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { UserGlobalAccessPermission } from "../../../Types/Permission";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import logger from "../../../Server/Utils/Logger";
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

type SpyInstance = ReturnType<typeof getJestSpyOn>;

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
 * The SSO requirement columns are read as they are stored, for every caller,
 * in every edition and license state:
 *
 *   Project.requireSsoForLogin
 *   Project.requireSsoWithSsoProviderId
 *   StatusPage.requireSsoForLogin
 *
 * Single sign-on is part of the Community Edition, so a configured
 * requirement is enforced everywhere, and clients must see it: the mobile app
 * decides from Project.requireSsoForLogin whether to start an SSO flow before
 * it shows a project's on-call data, the status page app forces SSO sign-in
 * from StatusPage.requireSsoForLogin, and the Dashboard's settings forms show
 * (and save back) what they read. A read never reports anything but the
 * stored value, and never writes.
 *
 * These tests run the real DatabaseService read path; only the repository and
 * the read-permission check (not under test) are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const PROVIDER_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// Community (billing off and on), every Enterprise license state, the Cloud.
const EVERY_STATE: Array<EditionStateCase> = createEditionStateCases();

// What the database holds. Each read builds fresh entities from it.
type StoredProjectRow = {
  name: string;
  requireSsoForLogin: boolean;
  requireSsoWithSsoProviderId: ObjectID | null;
};

type StoredStatusPageRow = {
  name: string;
  requireSsoForLogin: boolean;
};

type Caller = {
  name: string;
  props: () => DatabaseCommonInteractionProps;
};

let storedProject: StoredProjectRow;
let storedStatusPage: StoredStatusPageRow;
let repositoryWrites: Array<string>;

const userProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      userGlobalAccessPermission: {
        projectIds: [PROJECT_ID],
      } as unknown as UserGlobalAccessPermission,
    };
  };

const masterAdminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return { userId: USER_ID, isMasterAdmin: true };
  };

const CALLERS: Array<Caller> = [
  { name: "a project user", props: userProps },
  { name: "a master admin", props: masterAdminProps },
  {
    name: "an internal root read",
    props: (): DatabaseCommonInteractionProps => {
      return { isRoot: true };
    },
  },
  {
    name: "the write path's internal lookup (root + ignoreHooks)",
    props: (): DatabaseCommonInteractionProps => {
      return { isRoot: true, ignoreHooks: true };
    },
  },
];

const readProject: (
  props: DatabaseCommonInteractionProps,
) => Promise<Project> = async (
  props: DatabaseCommonInteractionProps,
): Promise<Project> => {
  const projects: Array<Project> = await ProjectService.findBy({
    query: { _id: PROJECT_ID.toString() },
    select: {
      _id: true,
      name: true,
      requireSsoForLogin: true,
      requireSsoWithSsoProviderId: true,
    },
    limit: 10,
    skip: 0,
    props,
  });

  expect(projects).toHaveLength(1);

  return projects[0]!;
};

const readProjectById: (
  props: DatabaseCommonInteractionProps,
) => Promise<Project | null> = async (
  props: DatabaseCommonInteractionProps,
): Promise<Project | null> => {
  return await ProjectService.findOneById({
    id: PROJECT_ID,
    select: {
      _id: true,
      name: true,
      requireSsoForLogin: true,
      requireSsoWithSsoProviderId: true,
    },
    props,
  });
};

const readStatusPage: (
  props: DatabaseCommonInteractionProps,
) => Promise<StatusPage> = async (
  props: DatabaseCommonInteractionProps,
): Promise<StatusPage> => {
  const statusPages: Array<StatusPage> = await StatusPageService.findBy({
    query: { _id: STATUS_PAGE_ID.toString() },
    select: { _id: true, name: true, requireSsoForLogin: true },
    limit: 10,
    skip: 0,
    props,
  });

  expect(statusPages).toHaveLength(1);

  return statusPages[0]!;
};

const expectProjectAsStored: (project: Project | null) => void = (
  project: Project | null,
): void => {
  expect(project).not.toBeNull();
  expect(project!.requireSsoForLogin).toBe(storedProject.requireSsoForLogin);

  if (storedProject.requireSsoWithSsoProviderId) {
    expect(project!.requireSsoWithSsoProviderId?.toString()).toBe(
      storedProject.requireSsoWithSsoProviderId.toString(),
    );
  } else {
    expect(project!.requireSsoWithSsoProviderId).toBeFalsy();
  }

  // Everything else is untouched too.
  expect(project!.name).toBe(storedProject.name);
  expect(project!.id?.toString()).toBe(PROJECT_ID.toString());
};

describe("SSO requirement columns are read as stored in every edition", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
    getJestSpyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    getJestSpyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    storedProject = {
      name: "Acme",
      requireSsoForLogin: true,
      requireSsoWithSsoProviderId: PROVIDER_ID,
    };
    storedStatusPage = { name: "Customer Status", requireSsoForLogin: true };
    repositoryWrites = [];

    // The read-permission check is not under test; let the query through.
    getJestSpyOn(
      ModelPermission,
      "checkReadQueryPermission",
    ).mockImplementation(
      async (
        _modelType: unknown,
        query: unknown,
        select: unknown,
      ): Promise<unknown> => {
        return { query, select, relationSelect: null };
      },
    );

    const writeTrap: (name: string) => () => never = (
      name: string,
    ): (() => never) => {
      return (): never => {
        repositoryWrites.push(name);
        throw new Error(`a read must not write (${name})`);
      };
    };

    getJestSpyOn(ProjectService, "getRepository").mockReturnValue({
      find: async (): Promise<Array<Project>> => {
        const project: Project = new Project();
        project._id = PROJECT_ID.toString();
        project.name = storedProject.name;
        project.requireSsoForLogin = storedProject.requireSsoForLogin;

        if (storedProject.requireSsoWithSsoProviderId) {
          project.requireSsoWithSsoProviderId =
            storedProject.requireSsoWithSsoProviderId;
        }

        return [project];
      },
      update: writeTrap("update"),
      save: writeTrap("save"),
      insert: writeTrap("insert"),
      delete: writeTrap("delete"),
    });

    getJestSpyOn(StatusPageService, "getRepository").mockReturnValue({
      find: async (): Promise<Array<StatusPage>> => {
        const statusPage: StatusPage = new StatusPage();
        statusPage._id = STATUS_PAGE_ID.toString();
        statusPage.name = storedStatusPage.name;
        statusPage.requireSsoForLogin = storedStatusPage.requireSsoForLogin;
        return [statusPage];
      },
      update: writeTrap("update"),
      save: writeTrap("save"),
      insert: writeTrap("insert"),
      delete: writeTrap("delete"),
    });
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  test("the matrix covers the Community Edition, lapsed and unknown licenses, and the Cloud", () => {
    expect(
      EVERY_STATE.filter((state: EditionStateCase): boolean => {
        return !state.isLoaded;
      }),
    ).toHaveLength(2);
    expect(
      EVERY_STATE.filter((state: EditionStateCase): boolean => {
        return state.isLoaded && !state.isActive;
      }).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      EVERY_STATE.filter((state: EditionStateCase): boolean => {
        return state.isLoaded && state.billing;
      }).length,
    ).toBeGreaterThan(0);
  });

  describe("Project", () => {
    describe.each(
      EVERY_STATE.map((state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      }),
    )("%s", (_label: string, state: EditionStateCase) => {
      beforeEach(() => {
        state.apply();
      });

      test.each(
        CALLERS.map((caller: Caller): [string, Caller] => {
          return [caller.name, caller];
        }),
      )(
        "%s reads the stored requirement and its provider",
        async (_name: string, caller: Caller) => {
          expectProjectAsStored(await readProject(caller.props()));
        },
      );

      test("findOneById reads the stored requirement too", async () => {
        expectProjectAsStored(await readProjectById(userProps()));
        expectProjectAsStored(await readProjectById(masterAdminProps()));
      });

      test("a project that does not require SSO reads as not required", async () => {
        storedProject.requireSsoForLogin = false;
        storedProject.requireSsoWithSsoProviderId = null;

        for (const caller of CALLERS) {
          const project: Project = await readProject(caller.props());

          expect(project.requireSsoForLogin).toBe(false);
          expect(project.requireSsoWithSsoProviderId).toBeFalsy();
        }
      });

      test("a requirement without a specific provider reads as required, with no provider", async () => {
        storedProject.requireSsoWithSsoProviderId = null;

        const project: Project = await readProject(userProps());

        expect(project.requireSsoForLogin).toBe(true);
        expect(project.requireSsoWithSsoProviderId).toBeFalsy();
      });
    });
  });

  describe("StatusPage", () => {
    describe.each(
      EVERY_STATE.map((state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      }),
    )("%s", (_label: string, state: EditionStateCase) => {
      beforeEach(() => {
        state.apply();
      });

      test.each(
        CALLERS.map((caller: Caller): [string, Caller] => {
          return [caller.name, caller];
        }),
      )(
        "%s reads the stored requirement",
        async (_name: string, caller: Caller) => {
          const statusPage: StatusPage = await readStatusPage(caller.props());

          expect(statusPage.requireSsoForLogin).toBe(true);
          expect(statusPage.name).toBe("Customer Status");
        },
      );

      test("a status page that does not require SSO reads as not required", async () => {
        storedStatusPage.requireSsoForLogin = false;

        expect((await readStatusPage(userProps())).requireSsoForLogin).toBe(
          false,
        );
      });
    });
  });

  describe("the license never changes what a read reports", () => {
    test("a lapse, a renewal and a license without SCIM or audit logs read the same, and nothing is written", async () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid"),
      });

      for (const snapshot of [
        createLicenseSnapshotWithStatus("valid"),
        createLicenseSnapshotWithStatus("expired"),
        createLicenseSnapshotWithStatus("valid"),
        createLicenseSnapshotWithStatus("invalid"),
        createLicenseSnapshot({ features: [] }),
        null,
      ]) {
        fake.setSnapshot(snapshot);

        expectProjectAsStored(await readProject(userProps()));
        expect((await readStatusPage(userProps())).requireSsoForLogin).toBe(
          true,
        );
      }

      expect(repositoryWrites).toEqual([]);
      expect(storedProject.requireSsoForLogin).toBe(true);
      expect(storedProject.requireSsoWithSsoProviderId).toBe(PROVIDER_ID);
      expect(storedStatusPage.requireSsoForLogin).toBe(true);
    });

    test("moving between the Community and the Enterprise image reads the same", async () => {
      expectProjectAsStored(await readProject(userProps()));

      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      expectProjectAsStored(await readProject(userProps()));

      uninstallEnterpriseModule();

      expectProjectAsStored(await readProject(masterAdminProps()));
      expect(repositoryWrites).toEqual([]);
    });

    test("a read never asks the enterprise facade", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });
      const isFeatureActive: SpyInstance = getJestSpyOn(
        EnterpriseEdition,
        "isFeatureActive",
      );

      await readProject(userProps());
      await readProjectById(masterAdminProps());
      await readStatusPage(userProps());

      expect(isFeatureActive).not.toHaveBeenCalled();
    });
  });
});
