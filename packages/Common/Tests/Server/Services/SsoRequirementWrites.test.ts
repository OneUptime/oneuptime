import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import ProjectService, * as ProjectServiceModule from "../../../Server/Services/ProjectService";
import StatusPageService, * as StatusPageServiceModule from "../../../Server/Services/StatusPageService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
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
 * "Require SSO for login" is ordinary configuration in every edition: an
 * administrator can switch it on and off (and pick a required provider) on
 * the Community Edition, on the Enterprise Edition in every license state -
 * valid, trial, grace, lapsed, a license that leaves SCIM and audit logs out,
 * unknown - and on OneUptime Cloud. ProjectService and StatusPageService
 * write exactly what they are given: nothing is dropped, nothing is refused
 * with a 402, and a settings form that saves back what it read keeps the
 * stored requirement.
 *
 * These tests run the real service update path (onBeforeUpdate and the rest
 * of DatabaseService); only the repository, the permission checks (not under
 * test) and the side effects after a write are stubbed. On OneUptime Cloud the
 * Scale plan gate on these columns is BillingPermission's job, not the
 * service's (see Project.requireSsoForLogin's @ColumnBillingAccessControl).
 *
 * Billing and the edition are pinned in every test. Runs without ee/.
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
const OTHER_PROVIDER_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// Community (billing off and on), every Enterprise license state, the Cloud.
const EVERY_STATE: Array<[string, EditionStateCase]> =
  createEditionStateCases().map(
    (state: EditionStateCase): [string, EditionStateCase] => {
      return [state.label, state];
    },
  );

type Caller = {
  name: string;
  props: () => DatabaseCommonInteractionProps;
};

const ownerProps: () => DatabaseCommonInteractionProps =
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

const ADMINISTRATORS: Array<[string, Caller]> = [
  ["a project owner", { name: "a project owner", props: ownerProps }],
  ["a master admin", { name: "a master admin", props: masterAdminProps }],
];

type StoredRow = Record<string, unknown>;

let storedProject: StoredRow;
let storedStatusPage: StoredRow;
let projectWrites: Array<Record<string, unknown>>;
let statusPageWrites: Array<Record<string, unknown>>;

/*
 * A repository over one stored row: find() builds a fresh entity from it (the
 * real read path runs on top), update() applies what the service writes.
 */
const stubRepository: (
  service: typeof ProjectService | typeof StatusPageService,
  id: ObjectID,
  stored: () => StoredRow,
  writes: () => Array<Record<string, unknown>>,
  createItem: () => Project | StatusPage,
) => void = (
  service: typeof ProjectService | typeof StatusPageService,
  id: ObjectID,
  stored: () => StoredRow,
  writes: () => Array<Record<string, unknown>>,
  createItem: () => Project | StatusPage,
): void => {
  getJestSpyOn(service, "getRepository").mockReturnValue({
    find: async (): Promise<Array<Project | StatusPage>> => {
      const item: Project | StatusPage = createItem();
      item._id = id.toString();

      for (const [column, value] of Object.entries(stored())) {
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
      writes().push(written);
      Object.assign(stored(), written);
      return { affected: 1 };
    },
    save: async (): Promise<never> => {
      throw new Error("this update must not go through save()");
    },
  });

  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(undefined);
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);
};

const updateProject: (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => Promise<number> = (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<number> => {
  return ProjectService.updateOneById({
    id: PROJECT_ID,
    data: data as UpdateBy<Project>["data"],
    props,
  });
};

const updateStatusPage: (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => Promise<number> = (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<number> => {
  return StatusPageService.updateOneById({
    id: STATUS_PAGE_ID,
    data: data as UpdateBy<StatusPage>["data"],
    props,
  });
};

const readProject: (
  props: DatabaseCommonInteractionProps,
) => Promise<Project> = async (
  props: DatabaseCommonInteractionProps,
): Promise<Project> => {
  const project: Project | null = await ProjectService.findOneById({
    id: PROJECT_ID,
    select: {
      _id: true,
      name: true,
      requireSsoForLogin: true,
      requireSsoWithSsoProviderId: true,
    },
    props,
  });

  expect(project).not.toBeNull();

  return project!;
};

const readStatusPage: (
  props: DatabaseCommonInteractionProps,
) => Promise<StatusPage> = async (
  props: DatabaseCommonInteractionProps,
): Promise<StatusPage> => {
  const statusPage: StatusPage | null = await StatusPageService.findOneById({
    id: STATUS_PAGE_ID,
    select: { _id: true, name: true, requireSsoForLogin: true },
    props,
  });

  expect(statusPage).not.toBeNull();

  return statusPage!;
};

const providerIdOf: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return value ? (value as ObjectID).toString() : null;
};

describe("SSO requirement writes go through unchanged in every edition", () => {
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
      requireSsoForLogin: false,
      requireSsoWithSsoProviderId: null,
    };
    storedStatusPage = { name: "Customer Status", requireSsoForLogin: false };
    projectWrites = [];
    statusPageWrites = [];

    // The permission checks are not under test; let the requests through.
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
    getJestSpyOn(
      ModelPermission,
      "checkUpdatePermissionByModel",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    ).mockImplementation(
      async (_modelType: unknown, query: unknown): Promise<unknown> => {
        return query;
      },
    );

    const auditLogService: { recordUpdate: () => Promise<void> } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../../Server/Services/AuditLogService").default;
    getJestSpyOn(auditLogService, "recordUpdate").mockResolvedValue(undefined);

    stubRepository(
      ProjectService,
      PROJECT_ID,
      (): StoredRow => {
        return storedProject;
      },
      (): Array<Record<string, unknown>> => {
        return projectWrites;
      },
      (): Project => {
        return new Project();
      },
    );

    stubRepository(
      StatusPageService,
      STATUS_PAGE_ID,
      (): StoredRow => {
        return storedStatusPage;
      },
      (): Array<Record<string, unknown>> => {
        return statusPageWrites;
      },
      (): StatusPage => {
        return new StatusPage();
      },
    );
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe.each(EVERY_STATE)(
    "%s",
    (_label: string, state: EditionStateCase) => {
      beforeEach(() => {
        state.apply();
      });

      describe.each(ADMINISTRATORS)("%s", (_caller: string, caller: Caller) => {
        test("switches a project's requirement on, with a required provider", async () => {
          await expect(
            updateProject(
              {
                requireSsoForLogin: true,
                requireSsoWithSsoProviderId: PROVIDER_ID,
              },
              caller.props(),
            ),
          ).resolves.toBe(1);

          expect(projectWrites).toHaveLength(1);
          expect(projectWrites[0]!["requireSsoForLogin"]).toBe(true);
          expect(
            providerIdOf(projectWrites[0]!["requireSsoWithSsoProviderId"]),
          ).toBe(PROVIDER_ID.toString());
          expect(storedProject["requireSsoForLogin"]).toBe(true);
        });

        test("switches a project's requirement off and clears the provider", async () => {
          storedProject["requireSsoForLogin"] = true;
          storedProject["requireSsoWithSsoProviderId"] = PROVIDER_ID;

          await expect(
            updateProject(
              {
                requireSsoForLogin: false,
                requireSsoWithSsoProviderId: null,
              },
              caller.props(),
            ),
          ).resolves.toBe(1);

          expect(projectWrites).toHaveLength(1);
          expect(storedProject["requireSsoForLogin"]).toBe(false);
          expect(storedProject["requireSsoWithSsoProviderId"]).toBeNull();
        });

        test("changes the required provider", async () => {
          storedProject["requireSsoForLogin"] = true;
          storedProject["requireSsoWithSsoProviderId"] = PROVIDER_ID;

          await updateProject(
            { requireSsoWithSsoProviderId: OTHER_PROVIDER_ID },
            caller.props(),
          );

          expect(
            providerIdOf(storedProject["requireSsoWithSsoProviderId"]),
          ).toBe(OTHER_PROVIDER_ID.toString());
          expect(storedProject["requireSsoForLogin"]).toBe(true);
        });

        test("switches a status page's requirement on and off", async () => {
          await expect(
            updateStatusPage({ requireSsoForLogin: true }, caller.props()),
          ).resolves.toBe(1);
          expect(storedStatusPage["requireSsoForLogin"]).toBe(true);

          await expect(
            updateStatusPage({ requireSsoForLogin: false }, caller.props()),
          ).resolves.toBe(1);
          expect(storedStatusPage["requireSsoForLogin"]).toBe(false);
          expect(statusPageWrites).toHaveLength(2);
        });
      });

      test("the settings form saves back what it read, and the stored requirement stays", async () => {
        storedProject["requireSsoForLogin"] = true;
        storedProject["requireSsoWithSsoProviderId"] = PROVIDER_ID;
        storedStatusPage["requireSsoForLogin"] = true;

        const project: Project = await readProject(ownerProps());

        await updateProject(
          {
            name: "Renamed",
            requireSsoForLogin: project.requireSsoForLogin,
            requireSsoWithSsoProviderId: project.requireSsoWithSsoProviderId,
          },
          ownerProps(),
        );

        expect(storedProject["name"]).toBe("Renamed");
        expect(storedProject["requireSsoForLogin"]).toBe(true);
        expect(providerIdOf(storedProject["requireSsoWithSsoProviderId"])).toBe(
          PROVIDER_ID.toString(),
        );

        const statusPage: StatusPage = await readStatusPage(ownerProps());

        await updateStatusPage(
          {
            name: "Renamed page",
            requireSsoForLogin: statusPage.requireSsoForLogin,
          },
          ownerProps(),
        );

        expect(storedStatusPage["requireSsoForLogin"]).toBe(true);
        expect(storedStatusPage["name"]).toBe("Renamed page");
      });

      test("an update written as a model instance goes through the same way", async () => {
        const data: Project = new Project();
        data.requireSsoForLogin = true;

        await expect(
          ProjectService.updateOneById({
            id: PROJECT_ID,
            data: data as unknown as UpdateBy<Project>["data"],
            props: ownerProps(),
          }),
        ).resolves.toBe(1);

        expect(storedProject["requireSsoForLogin"]).toBe(true);
      });
    },
  );

  describe("the license never decides what is written", () => {
    test("a lapse, a renewal and a license without SCIM or audit logs all accept the same writes", async () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid"),
      });

      let expected: boolean = false;

      for (const snapshot of [
        createLicenseSnapshotWithStatus("expired"),
        createLicenseSnapshotWithStatus("valid"),
        createLicenseSnapshotWithStatus("missing"),
        createLicenseSnapshotWithStatus("invalid"),
        createLicenseSnapshot({ features: [] }),
        null,
      ]) {
        fake.setSnapshot(snapshot);
        expected = !expected;

        await expect(
          updateProject({ requireSsoForLogin: expected }, ownerProps()),
        ).resolves.toBe(1);
        expect(storedProject["requireSsoForLogin"]).toBe(expected);

        await expect(
          updateStatusPage({ requireSsoForLogin: expected }, ownerProps()),
        ).resolves.toBe(1);
        expect(storedStatusPage["requireSsoForLogin"]).toBe(expected);
      }

      expect(projectWrites).toHaveLength(6);
      expect(statusPageWrites).toHaveLength(6);
    });

    test("a requirement write never asks the enterprise facade", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });
      const isFeatureActive: SpyInstance = getJestSpyOn(
        EnterpriseEdition,
        "isFeatureActive",
      );
      const isLoaded: SpyInstance = getJestSpyOn(EnterpriseEdition, "isLoaded");

      await updateProject(
        { requireSsoForLogin: true, requireSsoWithSsoProviderId: PROVIDER_ID },
        ownerProps(),
      );
      await updateStatusPage({ requireSsoForLogin: true }, masterAdminProps());

      expect(isFeatureActive).not.toHaveBeenCalled();
      expect(isLoaded).not.toHaveBeenCalled();
    });

    test("internal root writes go through too", async () => {
      await updateProject({ requireSsoForLogin: true }, { isRoot: true });

      expect(storedProject["requireSsoForLogin"]).toBe(true);
    });

    // The column lists existed only for the removed read mask and write guard.
    test("the services export no SSO requirement column lists", () => {
      expect(
        (ProjectServiceModule as unknown as Record<string, unknown>)[
          "PROJECT_SSO_REQUIREMENT_COLUMNS"
        ],
      ).toBeUndefined();
      expect(
        (StatusPageServiceModule as unknown as Record<string, unknown>)[
          "STATUS_PAGE_SSO_REQUIREMENT_COLUMNS"
        ],
      ).toBeUndefined();
    });
  });
});
