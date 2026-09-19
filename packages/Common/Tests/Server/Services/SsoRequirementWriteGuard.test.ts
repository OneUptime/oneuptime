import EditionEnforcement from "../../../Server/Utils/EditionEnforcement";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import ProjectService, {
  PROJECT_SSO_REQUIREMENT_COLUMNS,
} from "../../../Server/Services/ProjectService";
import StatusPageService, {
  STATUS_PAGE_SSO_REQUIREMENT_COLUMNS,
} from "../../../Server/Services/StatusPageService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import { UserGlobalAccessPermission } from "../../../Types/Permission";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import FakeEnterpriseModule, {
  createEditionStateCases,
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
 * The write half of the SSO requirement read mask
 * (EditionEnforcement.guardSsoRequirementWrite, run by ProjectService and
 * StatusPageService onBeforeUpdate).
 *
 * While SSO is not active - the Community Edition, or an Enterprise install
 * whose license lapsed - reads made for a caller report "Require SSO for
 * login" as off and no required provider (SsoRequirementReadMasking.test.ts).
 * The ee SSO settings card (and any API client doing a read-modify-write)
 * then sends that masked value back when it saves. Before this guard, saving
 * wrote requireSsoForLogin=false over a stored true, so when the license was
 * renewed SSO was silently no longer required.
 *
 * Now, while the caller's reads are masked:
 *   - a write of the masked value is dropped and the stored value is kept;
 *   - a write that would set a requirement is refused (402);
 *   - a write left with nothing to save is refused with the same message.
 * Root writes and every write while SSO is active are untouched.
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

const installLapsedLicense: () => FakeEnterpriseModule =
  (): FakeEnterpriseModule => {
    return installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });
  };

const guard: (
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps | null,
  columns?: ReadonlyArray<string>,
) => void = (
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps | null,
  columns?: ReadonlyArray<string>,
): void => {
  EditionEnforcement.guardSsoRequirementWrite({
    props: props === undefined ? ownerProps() : props,
    data,
    columns: columns || PROJECT_SSO_REQUIREMENT_COLUMNS,
  });
};

const catchError: (run: () => unknown) => unknown = (
  run: () => unknown,
): unknown => {
  try {
    run();
  } catch (err) {
    return err;
  }

  return null;
};

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  getJestSpyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  getJestSpyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("EditionEnforcement.guardSsoRequirementWrite", () => {
  test("the columns it guards are the ones the reads mask", () => {
    expect([...PROJECT_SSO_REQUIREMENT_COLUMNS].sort()).toEqual([
      "requireSsoForLogin",
      "requireSsoWithSsoProviderId",
    ]);
    expect([...STATUS_PAGE_SSO_REQUIREMENT_COLUMNS]).toEqual([
      "requireSsoForLogin",
    ]);
  });

  describe("in every deployment state, it acts exactly when reads are masked", () => {
    const states: Array<EditionStateCase> = createEditionStateCases();

    test.each(
      states.map((state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      }),
    )("%s", (_label: string, state: EditionStateCase) => {
      state.apply();

      const isMasked: boolean =
        EditionEnforcement.shouldMaskSsoRequirementOnRead(ownerProps());

      // SSO runs exactly where the state says it does, and only then is nothing masked.
      expect(isMasked).toBe(!state.isActive);

      const data: Record<string, unknown> = {
        requireSsoForLogin: false,
        requireSsoWithSsoProviderId: null,
        name: "Renamed",
      };

      guard(data);

      if (isMasked) {
        expect(data).toEqual({ name: "Renamed" });
      } else {
        expect(data).toEqual({
          requireSsoForLogin: false,
          requireSsoWithSsoProviderId: null,
          name: "Renamed",
        });
      }

      const turningOn: Record<string, unknown> = { requireSsoForLogin: true };
      const error: unknown = catchError((): void => {
        guard(turningOn);
      });

      if (isMasked) {
        expect(error).toBeInstanceOf(PaymentRequiredException);
        expect(turningOn).toEqual({ requireSsoForLogin: true });
      } else {
        expect(error).toBeNull();
        expect(turningOn).toEqual({ requireSsoForLogin: true });
      }
    });
  });

  describe("while SSO is not active (license lapsed)", () => {
    beforeEach(() => {
      installLapsedLicense();
    });

    test("drops a write of the masked value and keeps the rest of the write", () => {
      const data: Record<string, unknown> = {
        requireSsoForLogin: false,
        requireSsoWithSsoProviderId: null,
        name: "Renamed",
      };

      guard(data);

      expect(data).toEqual({ name: "Renamed" });
    });

    test("does the same for a master admin, whose reads are masked too", () => {
      const data: Record<string, unknown> = {
        requireSsoForLogin: false,
        name: "Renamed",
      };

      guard(data, masterAdminProps());

      expect(data).toEqual({ name: "Renamed" });
    });

    test("refuses the settings form's save, which carries nothing but the masked values", () => {
      const data: Record<string, unknown> = {
        requireSsoForLogin: false,
        requireSsoWithSsoProviderId: null,
      };

      const error: unknown = catchError((): void => {
        guard(data);
      });

      expect(error).toBeInstanceOf(PaymentRequiredException);
      expect((error as Error).message).toBe(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE,
      );
    });

    test.each([
      ["switching the requirement on", { requireSsoForLogin: true }],
      [
        "choosing a required provider",
        { requireSsoWithSsoProviderId: OTHER_PROVIDER_ID },
      ],
      [
        "choosing a provider next to the masked flag",
        {
          requireSsoForLogin: false,
          requireSsoWithSsoProviderId: PROVIDER_ID,
          name: "Renamed",
        },
      ],
      ["an odd value a database reads as true", { requireSsoForLogin: "true" }],
      ["a number", { requireSsoForLogin: 1 }],
    ] as Array<[string, Record<string, unknown>]>)(
      "refuses %s, and leaves the write untouched",
      (_label: string, write: Record<string, unknown>) => {
        const data: Record<string, unknown> = { ...write };

        const error: unknown = catchError((): void => {
          guard(data);
        });

        expect(error).toBeInstanceOf(PaymentRequiredException);
        expect(data).toEqual(write);
      },
    );

    test("leaves a write that does not touch the requirement alone", () => {
      const data: Record<string, unknown> = { name: "Renamed" };

      guard(data);

      expect(data).toEqual({ name: "Renamed" });
    });

    test("counts a key left undefined as nothing to save", () => {
      expect(
        catchError((): void => {
          guard({ requireSsoForLogin: false, name: undefined });
        }),
      ).toBeInstanceOf(PaymentRequiredException);
    });

    test("never touches an internal (root) write", () => {
      const switchingOff: Record<string, unknown> = {
        requireSsoForLogin: false,
      };
      const switchingOn: Record<string, unknown> = { requireSsoForLogin: true };

      guard(switchingOff, { isRoot: true });
      guard(switchingOn, { isRoot: true });
      guard(switchingOff, null);

      expect(switchingOff).toEqual({ requireSsoForLogin: false });
      expect(switchingOn).toEqual({ requireSsoForLogin: true });
    });

    test("a renewal lifts it without a restart", () => {
      const fake: FakeEnterpriseModule = installLapsedLicense();

      const lapsedWrite: Record<string, unknown> = {
        requireSsoForLogin: false,
        name: "Renamed",
      };
      guard(lapsedWrite);
      expect(lapsedWrite).toEqual({ name: "Renamed" });

      fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

      const renewedWrite: Record<string, unknown> = {
        requireSsoForLogin: false,
        name: "Renamed",
      };
      guard(renewedWrite);
      expect(renewedWrite).toEqual({
        requireSsoForLogin: false,
        name: "Renamed",
      });
    });
  });

  describe("the refusal explains itself", () => {
    test("on a lapsed Enterprise install it names the license and where to renew it", () => {
      installLapsedLicense();

      const error: unknown = catchError((): void => {
        guard({ requireSsoForLogin: true });
      });

      expect((error as Error).message).toBe(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE,
      );
      expect(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE,
      ).toContain("edition label in the Admin Dashboard header");
      expect(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE,
      ).toContain("The saved setting is kept");
    });

    test("on the Community Edition it names the edition", () => {
      const error: unknown = catchError((): void => {
        guard({ requireSsoForLogin: true });
      });

      expect(error).toBeInstanceOf(PaymentRequiredException);
      expect((error as Error).message).toBe(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_COMMUNITY_MESSAGE,
      );
      expect(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_COMMUNITY_MESSAGE,
      ).toContain("Community Edition");
      expect(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_COMMUNITY_MESSAGE,
      ).toContain(
        "with a valid license (or during its 14-day trial, or the 30-day grace period after a license expires)",
      );
    });

    test("neither message claims anything keeps working", () => {
      for (const message of [
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE,
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_COMMUNITY_MESSAGE,
      ]) {
        expect(message).not.toMatch(/keeps? working|keeps? running/i);
        expect(message).toContain("is not enforced");
      }
    });

    test("an edition check that throws still refuses, with the license message", () => {
      installLapsedLicense();
      getJestSpyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });
      getJestSpyOn(EnterpriseEdition, "isLoaded").mockImplementation(
        (): boolean => {
          throw new Error("edition check exploded");
        },
      );
      getJestSpyOn(
        EditionEnforcement,
        "shouldMaskSsoRequirementOnRead",
      ).mockReturnValue(true);

      const error: unknown = catchError((): void => {
        guard({ requireSsoForLogin: true });
      });

      expect(error).toBeInstanceOf(PaymentRequiredException);
      expect((error as Error).message).toBe(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE,
      );
    });
  });
});

/*
 * The services run the guard from onBeforeUpdate. These go through the real
 * DatabaseService update path; only the repository, the permission checks
 * and the side effects after the write (workflow, realtime, audit) are
 * stubbed.
 */
describe("updates through the services keep a stored requirement while SSO is not active", () => {
  type StoredRow = Record<string, unknown>;

  let storedProject: StoredRow;
  let storedStatusPage: StoredRow;
  let projectWrites: Array<Record<string, unknown>>;
  let statusPageWrites: Array<Record<string, unknown>>;

  const stubService: (
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
    getJestSpyOn(service, "_findBy").mockImplementation(
      async (): Promise<Array<Project | StatusPage>> => {
        const item: Project | StatusPage = createItem();
        item._id = id.toString();
        return [item];
      },
    );

    getJestSpyOn(service, "getRepository").mockReturnValue({
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
    props?: DatabaseCommonInteractionProps,
  ) => Promise<number> = (
    data: Record<string, unknown>,
    props?: DatabaseCommonInteractionProps,
  ): Promise<number> => {
    return ProjectService.updateOneById({
      id: PROJECT_ID,
      data: data as UpdateBy<Project>["data"],
      props: props || ownerProps(),
    });
  };

  const updateStatusPage: (
    data: Record<string, unknown>,
    props?: DatabaseCommonInteractionProps,
  ) => Promise<number> = (
    data: Record<string, unknown>,
    props?: DatabaseCommonInteractionProps,
  ): Promise<number> => {
    return StatusPageService.updateOneById({
      id: STATUS_PAGE_ID,
      data: data as UpdateBy<StatusPage>["data"],
      props: props || ownerProps(),
    });
  };

  beforeEach(() => {
    storedProject = {
      name: "Acme",
      requireSsoForLogin: true,
      requireSsoWithSsoProviderId: PROVIDER_ID,
    };
    storedStatusPage = { name: "Customer Status", requireSsoForLogin: true };
    projectWrites = [];
    statusPageWrites = [];

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

    stubService(
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

    stubService(
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

  describe("Project", () => {
    test("license lapsed: saving the masked value with another change keeps the stored requirement", async () => {
      installLapsedLicense();

      await expect(
        updateProject({
          requireSsoForLogin: false,
          requireSsoWithSsoProviderId: null,
          name: "Renamed",
        }),
      ).resolves.toBe(1);

      expect(projectWrites).toHaveLength(1);
      expect(projectWrites[0]).not.toHaveProperty("requireSsoForLogin");
      expect(projectWrites[0]).not.toHaveProperty(
        "requireSsoWithSsoProviderId",
      );
      expect(storedProject).toEqual({
        name: "Renamed",
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: PROVIDER_ID,
      });
    });

    test("license lapsed: the SSO settings card's save is refused and writes nothing", async () => {
      installLapsedLicense();

      await expect(
        updateProject({
          requireSsoForLogin: false,
          requireSsoWithSsoProviderId: null,
        }),
      ).rejects.toThrow(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE,
      );

      expect(projectWrites).toEqual([]);
      expect(storedProject["requireSsoForLogin"]).toBe(true);
    });

    test("license lapsed: an update written as a model instance is guarded the same way", async () => {
      installLapsedLicense();

      const onlyMasked: Project = new Project();
      onlyMasked.requireSsoForLogin = false;

      await expect(
        ProjectService.updateOneById({
          id: PROJECT_ID,
          data: onlyMasked as unknown as UpdateBy<Project>["data"],
          props: ownerProps(),
        }),
      ).rejects.toBeInstanceOf(PaymentRequiredException);

      const withName: Project = new Project();
      withName.requireSsoForLogin = false;
      withName.name = "Renamed";

      await ProjectService.updateOneById({
        id: PROJECT_ID,
        data: withName as unknown as UpdateBy<Project>["data"],
        props: ownerProps(),
      });

      expect(projectWrites).toHaveLength(1);
      expect(storedProject["name"]).toBe("Renamed");
      expect(storedProject["requireSsoForLogin"]).toBe(true);
    });

    test("license lapsed: a master admin cannot switch it off either", async () => {
      installLapsedLicense();

      await updateProject(
        { requireSsoForLogin: false, name: "Renamed" },
        masterAdminProps(),
      );

      expect(storedProject["requireSsoForLogin"]).toBe(true);
    });

    test("license lapsed: switching it on is refused", async () => {
      storedProject["requireSsoForLogin"] = false;
      installLapsedLicense();

      await expect(
        updateProject({ requireSsoForLogin: true }),
      ).rejects.toBeInstanceOf(PaymentRequiredException);

      expect(projectWrites).toEqual([]);
      expect(storedProject["requireSsoForLogin"]).toBe(false);
    });

    test("Community Edition: the same save keeps the stored requirement", async () => {
      uninstallEnterpriseModule();

      await updateProject({ requireSsoForLogin: false, name: "Renamed" });

      expect(storedProject["requireSsoForLogin"]).toBe(true);
    });

    test("SSO active: an administrator can still switch the requirement off", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid"),
      });

      await updateProject({
        requireSsoForLogin: false,
        requireSsoWithSsoProviderId: null,
      });

      expect(projectWrites).toHaveLength(1);
      expect(storedProject["requireSsoForLogin"]).toBe(false);
      expect(storedProject["requireSsoWithSsoProviderId"]).toBeNull();
    });

    test("internal root writes are never guarded", async () => {
      installLapsedLicense();

      await ProjectService.updateOneById({
        id: PROJECT_ID,
        data: { requireSsoForLogin: false } as UpdateBy<Project>["data"],
        props: { isRoot: true },
      });

      expect(storedProject["requireSsoForLogin"]).toBe(false);
    });

    test("negative control: without the guard, the masked save switches the stored requirement off", async () => {
      installLapsedLicense();
      getJestSpyOn(
        EditionEnforcement,
        "guardSsoRequirementWrite",
      ).mockImplementation((): void => {
        return undefined;
      });

      await updateProject({
        requireSsoForLogin: false,
        requireSsoWithSsoProviderId: null,
        name: "Renamed",
      });

      // This is the bug the guard prevents: renewal would find SSO not required.
      expect(storedProject["requireSsoForLogin"]).toBe(false);
      expect(storedProject["requireSsoWithSsoProviderId"]).toBeNull();
    });
  });

  describe("StatusPage", () => {
    test("license lapsed: saving the masked value with another change keeps the stored requirement", async () => {
      installLapsedLicense();

      await expect(
        updateStatusPage({ requireSsoForLogin: false, name: "Renamed" }),
      ).resolves.toBe(1);

      expect(statusPageWrites).toHaveLength(1);
      expect(statusPageWrites[0]).not.toHaveProperty("requireSsoForLogin");
      expect(storedStatusPage).toEqual({
        name: "Renamed",
        requireSsoForLogin: true,
      });
    });

    test("license lapsed: the SSO settings card's save is refused and writes nothing", async () => {
      installLapsedLicense();

      await expect(
        updateStatusPage({ requireSsoForLogin: false }),
      ).rejects.toThrow(
        EditionEnforcement.SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE,
      );

      expect(statusPageWrites).toEqual([]);
      expect(storedStatusPage["requireSsoForLogin"]).toBe(true);
    });

    test("license lapsed: switching it on is refused", async () => {
      storedStatusPage["requireSsoForLogin"] = false;
      installLapsedLicense();

      await expect(
        updateStatusPage({ requireSsoForLogin: true }),
      ).rejects.toBeInstanceOf(PaymentRequiredException);

      expect(storedStatusPage["requireSsoForLogin"]).toBe(false);
    });

    test("SSO active: an administrator can still switch the requirement off", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("valid"),
      });

      await updateStatusPage({ requireSsoForLogin: false });

      expect(storedStatusPage["requireSsoForLogin"]).toBe(false);
    });

    test("negative control: without the guard, the masked save switches the stored requirement off", async () => {
      installLapsedLicense();
      getJestSpyOn(
        EditionEnforcement,
        "guardSsoRequirementWrite",
      ).mockImplementation((): void => {
        return undefined;
      });

      await updateStatusPage({ requireSsoForLogin: false, name: "Renamed" });

      expect(storedStatusPage["requireSsoForLogin"]).toBe(false);
    });
  });
});
