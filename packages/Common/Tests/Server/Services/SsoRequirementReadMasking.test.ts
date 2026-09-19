import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import { EnterpriseLicenseStatus } from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { UserGlobalAccessPermission } from "../../../Types/Permission";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
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

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * On the Community Edition, SSO requirements are not enforced (the SSO login
 * routes are part of the Enterprise Edition). Clients decide from the stored
 * columns whether to start an SSO flow - the mobile app hides a project's
 * on-call pages and schedules behind an SSO login when Project.requireSsoForLogin
 * is true, and app-store builds cannot be patched - so reads made for a caller
 * report the EFFECTIVE value instead (design v2 section 0, runtime review F4):
 *
 *   Project.requireSsoForLogin          -> false
 *   Project.requireSsoWithSsoProviderId -> null
 *   StatusPage.requireSsoForLogin       -> false
 *
 * and nothing else changes:
 *   - internal reads (root, and the ignoreHooks lookups the write path uses)
 *     see the stored value,
 *   - the Enterprise Edition (any license state) is never masked,
 *   - the stored row is never written, so moving back to the Enterprise
 *     Edition restores enforcement exactly as configured.
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

const ENTERPRISE_STATUSES: ReadonlyArray<EnterpriseLicenseStatus> = [
  "valid",
  "grace",
  "expired",
  "missing",
  "invalid",
];

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

let storedProject: StoredProjectRow;
let storedStatusPage: StoredStatusPageRow;
let projectRepositoryWrites: Array<string>;

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

const expectProjectMasked: (project: Project) => void = (
  project: Project,
): void => {
  expect(project.requireSsoForLogin).toBe(false);
  expect(project.requireSsoWithSsoProviderId).toBeNull();
  // Everything else is untouched.
  expect(project.name).toBe("Acme");
  expect(project.id?.toString()).toBe(PROJECT_ID.toString());
};

const expectProjectRaw: (project: Project) => void = (
  project: Project,
): void => {
  expect(project.requireSsoForLogin).toBe(true);
  expect(project.requireSsoWithSsoProviderId?.toString()).toBe(
    PROVIDER_ID.toString(),
  );
  expect(project.name).toBe("Acme");
};

describe("SSO requirement columns are read as their effective value on the Community Edition", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();

    storedProject = {
      name: "Acme",
      requireSsoForLogin: true,
      requireSsoWithSsoProviderId: PROVIDER_ID,
    };
    storedStatusPage = { name: "Customer Status", requireSsoForLogin: true };
    projectRepositoryWrites = [];

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
        projectRepositoryWrites.push(name);
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
    });
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe("Project", () => {
    for (const billing of [false, true]) {
      test(`Community Edition (billing=${billing}): a user's read is masked`, async () => {
        setTestBillingEnabled(billing);

        expectProjectMasked(await readProject(userProps()));
      });

      test(`Community Edition (billing=${billing}): a master admin's read is masked`, async () => {
        setTestBillingEnabled(billing);

        expectProjectMasked(await readProject(masterAdminProps()));
      });

      for (const status of ENTERPRISE_STATUSES) {
        test(`Enterprise Edition (billing=${billing}, ${status} license): reads are never masked`, async () => {
          setTestBillingEnabled(billing);
          installFakeEnterpriseModule({
            snapshot: createLicenseSnapshotWithStatus(status),
          });

          expectProjectRaw(await readProject(userProps()));
          expectProjectRaw(await readProject(masterAdminProps()));
        });
      }
    }

    test("internal root reads see the stored value on the Community Edition", async () => {
      expectProjectRaw(await readProject({ isRoot: true }));
    });

    test("the write path's internal lookups (root + ignoreHooks) see the stored value", async () => {
      expectProjectRaw(await readProject({ isRoot: true, ignoreHooks: true }));
    });

    test("a masked read leaves the stored row alone, and the Enterprise Edition sees it again", async () => {
      expectProjectMasked(await readProject(userProps()));

      expect(projectRepositoryWrites).toEqual([]);
      expect(storedProject.requireSsoForLogin).toBe(true);
      expect(storedProject.requireSsoWithSsoProviderId).toBe(PROVIDER_ID);

      installFakeEnterpriseModule();

      expectProjectRaw(await readProject(userProps()));
    });

    test("a project that does not require SSO reads the same on both editions", async () => {
      storedProject.requireSsoForLogin = false;
      storedProject.requireSsoWithSsoProviderId = null;

      const onCommunity: Project = await readProject(userProps());

      installFakeEnterpriseModule();

      const onEnterprise: Project = await readProject(userProps());

      expect(onCommunity.requireSsoForLogin).toBe(false);
      expect(onEnterprise.requireSsoForLogin).toBe(false);
    });
  });

  describe("StatusPage", () => {
    for (const billing of [false, true]) {
      test(`Community Edition (billing=${billing}): a caller's read is masked`, async () => {
        setTestBillingEnabled(billing);

        const statusPage: StatusPage = await readStatusPage(userProps());

        expect(statusPage.requireSsoForLogin).toBe(false);
        expect(statusPage.name).toBe("Customer Status");
      });

      for (const status of ENTERPRISE_STATUSES) {
        test(`Enterprise Edition (billing=${billing}, ${status} license): reads are never masked`, async () => {
          setTestBillingEnabled(billing);
          installFakeEnterpriseModule({
            snapshot: createLicenseSnapshotWithStatus(status),
          });

          expect((await readStatusPage(userProps())).requireSsoForLogin).toBe(
            true,
          );
        });
      }
    }

    test("internal root reads see the stored value on the Community Edition", async () => {
      expect((await readStatusPage({ isRoot: true })).requireSsoForLogin).toBe(
        true,
      );
    });

    test("a masked read leaves the stored row alone", async () => {
      await readStatusPage(userProps());

      expect(storedStatusPage.requireSsoForLogin).toBe(true);

      installFakeEnterpriseModule();

      expect((await readStatusPage(userProps())).requireSsoForLogin).toBe(true);
    });
  });

  describe("the hooks themselves", () => {
    test("ProjectService.onFindSuccess only rewrites values that are present", async () => {
      const selected: Project = new Project();
      selected.requireSsoForLogin = true;
      selected.requireSsoWithSsoProviderId = PROVIDER_ID;

      const unselected: Project = new Project();
      unselected.name = "Other";

      const result: { carryForward: Array<Project> } = await (
        ProjectService as any
      ).onFindSuccess(
        { findBy: { query: {}, props: userProps() }, carryForward: null },
        [selected, unselected],
      );

      expect(result.carryForward).toEqual([selected, unselected]);
      expect(selected.requireSsoForLogin).toBe(false);
      expect(selected.requireSsoWithSsoProviderId).toBeNull();
      expect(unselected.requireSsoForLogin).toBeUndefined();
      expect(unselected.requireSsoWithSsoProviderId).toBeUndefined();
    });

    test("StatusPageService.onFindSuccess only rewrites values that are present", async () => {
      const selected: StatusPage = new StatusPage();
      selected.requireSsoForLogin = true;

      const unselected: StatusPage = new StatusPage();

      await (StatusPageService as any).onFindSuccess(
        { findBy: { query: {}, props: userProps() }, carryForward: null },
        [selected, unselected],
      );

      expect(selected.requireSsoForLogin).toBe(false);
      expect(unselected.requireSsoForLogin).toBeUndefined();
    });
  });
});
