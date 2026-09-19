import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ProjectService, {
  DEFAULT_PROJECT_AUDIT_LOG_SETTINGS,
  StoredProjectAuditLogSettings,
  widensAuditLogging,
} from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import { EnterpriseLicenseStatus } from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";

/*
 * Audit logging is an Enterprise feature (EnterpriseFeature.AuditLogs), but its
 * switches are ordinary Project columns (enableAuditLogs,
 * storeSystemEventsInAuditLogs, auditLogsRetentionInDays) whose only gate was
 * @ColumnBillingAccessControl - a no-op without billing. So audit logging
 * could be switched on with no license at all. ProjectService now asks the
 * license whenever a write would widen audit logging:
 *
 *   - Community Edition: refused with the Community message;
 *   - Enterprise Edition: allowed only with a license that is valid or in
 *     grace AND includes audit logs, refused with the license message
 *     otherwise;
 *   - never refused: switching off or narrowing, re-saving the settings a
 *     project already has, root writes, and anything with billing on (the
 *     plan gates apply there).
 *
 * Recording itself is not touched here: it follows EnterpriseEdition.isLoaded()
 * (the recorder), never the license.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true). This suite must pass with ee/ deleted: it uses only
 * the fake enterprise module.
 */
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

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// A project owner working in PROJECT_ID.
const OWNER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  isMasterAdmin: true,
};

type Hooks = {
  onBeforeUpdate: (updateBy: UpdateBy<Project>) => Promise<unknown>;
  onBeforeCreate: (createBy: CreateBy<Project>) => Promise<unknown>;
};

const hooks: Hooks = ProjectService as unknown as Hooks;

const storedProject: (
  settings: StoredProjectAuditLogSettings,
  projectId?: ObjectID,
) => Project = (
  settings: StoredProjectAuditLogSettings,
  projectId?: ObjectID,
): Project => {
  const project: Project = new Project();
  project._id = (projectId || PROJECT_ID).toString();

  if (typeof settings.enableAuditLogs === "boolean") {
    project.enableAuditLogs = settings.enableAuditLogs;
  }

  if (typeof settings.storeSystemEventsInAuditLogs === "boolean") {
    project.storeSystemEventsInAuditLogs =
      settings.storeSystemEventsInAuditLogs;
  }

  if (typeof settings.auditLogsRetentionInDays === "number") {
    project.auditLogsRetentionInDays = settings.auditLogsRetentionInDays;
  }

  return project;
};

let findBySpy: jest.SpyInstance;

// The rows an update's query matches, as ProjectService reads them.
const givenStoredProjects: (projects: Array<Project>) => void = (
  projects: Array<Project>,
): void => {
  findBySpy.mockResolvedValue(projects as never);
};

const update: (
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
) => Promise<unknown> = (
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
): Promise<unknown> => {
  return hooks.onBeforeUpdate({
    query: { _id: PROJECT_ID.toString() },
    data: data,
    props: props || OWNER_PROPS,
  } as unknown as UpdateBy<Project>);
};

const COMMUNITY_REFUSAL: PaymentRequiredException =
  new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE);

const LICENSE_REFUSAL: PaymentRequiredException = new PaymentRequiredException(
  EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
);

// Writes that widen a project whose audit logging is off, 30 days, users only.
const WIDENING_WRITES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["switching audit logging on", { enableAuditLogs: true }],
  ["recording system events", { storeSystemEventsInAuditLogs: true }],
  ["keeping entries longer", { auditLogsRetentionInDays: 90 }],
  [
    "the whole settings form, switched on",
    {
      enableAuditLogs: true,
      auditLogsRetentionInDays: 30,
      storeSystemEventsInAuditLogs: false,
    },
  ],
];

const NARROW_PROJECT: StoredProjectAuditLogSettings = {
  enableAuditLogs: false,
  storeSystemEventsInAuditLogs: false,
  auditLogsRetentionInDays: 30,
};

const WIDE_PROJECT: StoredProjectAuditLogSettings = {
  enableAuditLogs: true,
  storeSystemEventsInAuditLogs: true,
  auditLogsRetentionInDays: 90,
};

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();

  findBySpy = jest.spyOn(ProjectService, "findBy");
  givenStoredProjects([storedProject(NARROW_PROJECT)]);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("widensAuditLogging", () => {
  test.each([
    [{ enableAuditLogs: true }, NARROW_PROJECT, true],
    [{ enableAuditLogs: true }, WIDE_PROJECT, false],
    [{ enableAuditLogs: false }, WIDE_PROJECT, false],
    [{ enableAuditLogs: false }, NARROW_PROJECT, false],
    [{ storeSystemEventsInAuditLogs: true }, NARROW_PROJECT, true],
    [{ storeSystemEventsInAuditLogs: true }, WIDE_PROJECT, false],
    [{ storeSystemEventsInAuditLogs: false }, WIDE_PROJECT, false],
    [{ auditLogsRetentionInDays: 31 }, NARROW_PROJECT, true],
    [{ auditLogsRetentionInDays: 30 }, NARROW_PROJECT, false],
    [{ auditLogsRetentionInDays: 7 }, NARROW_PROJECT, false],
    [{ auditLogsRetentionInDays: 180 }, WIDE_PROJECT, true],
    [{ auditLogsRetentionInDays: 7 }, WIDE_PROJECT, false],
    [{ auditLogsRetentionInDays: "90" }, NARROW_PROJECT, true],
    [{ auditLogsRetentionInDays: "30" }, NARROW_PROJECT, false],
    [{ auditLogsRetentionInDays: null }, NARROW_PROJECT, false],
    [{ name: "Renamed" }, NARROW_PROJECT, false],
    [{}, NARROW_PROJECT, false],
    [
      {
        enableAuditLogs: undefined,
        storeSystemEventsInAuditLogs: undefined,
        auditLogsRetentionInDays: undefined,
      },
      NARROW_PROJECT,
      false,
    ],
  ])(
    "writing %j over %j widens: %p",
    (
      requested: Record<string, unknown>,
      current: StoredProjectAuditLogSettings,
      expected: boolean,
    ) => {
      expect(widensAuditLogging(requested, current)).toBe(expected);
    },
  );

  // Fail closed: a value the database might read as "on" is judged as on.
  test.each([["true"], [1], ["yes"], [{}]])(
    "a switch value of %j counts as switching on",
    (value: unknown) => {
      expect(
        widensAuditLogging({ enableAuditLogs: value }, NARROW_PROJECT),
      ).toBe(true);
      expect(
        widensAuditLogging(
          { storeSystemEventsInAuditLogs: value },
          NARROW_PROJECT,
        ),
      ).toBe(true);
    },
  );

  test("a retention that is not a number cannot be judged, so it counts as widening", () => {
    for (const value of ["forever", {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        widensAuditLogging({ auditLogsRetentionInDays: value }, WIDE_PROJECT),
      ).toBe(true);
    }
  });

  test("a project row with no stored values is compared with the defaults", () => {
    expect(widensAuditLogging({ auditLogsRetentionInDays: 7 }, {})).toBe(false);
    expect(widensAuditLogging({ auditLogsRetentionInDays: 8 }, {})).toBe(true);
    expect(
      widensAuditLogging(
        { auditLogsRetentionInDays: 8 },
        { auditLogsRetentionInDays: null },
      ),
    ).toBe(true);
    expect(widensAuditLogging({ enableAuditLogs: true }, {})).toBe(true);
  });

  test("the defaults are the Project columns' own defaults", () => {
    const project: Project = new Project();

    expect(project.getTableColumnMetadata("enableAuditLogs").defaultValue).toBe(
      DEFAULT_PROJECT_AUDIT_LOG_SETTINGS.enableAuditLogs,
    );
    expect(
      project.getTableColumnMetadata("storeSystemEventsInAuditLogs")
        .defaultValue,
    ).toBe(DEFAULT_PROJECT_AUDIT_LOG_SETTINGS.storeSystemEventsInAuditLogs);
    expect(
      project.getTableColumnMetadata("auditLogsRetentionInDays").defaultValue,
    ).toBe(DEFAULT_PROJECT_AUDIT_LOG_SETTINGS.auditLogsRetentionInDays);
  });
});

describe("updating a project's audit log settings, billing off", () => {
  describe("on the Community Edition", () => {
    test.each(WIDENING_WRITES)(
      "%s is refused with the Community message",
      async (_name: string, data: Record<string, unknown>) => {
        await expect(update(data)).rejects.toThrow(COMMUNITY_REFUSAL);
      },
    );

    test("a master admin is refused too", async () => {
      await expect(
        update({ enableAuditLogs: true }, MASTER_ADMIN_PROPS),
      ).rejects.toThrow(COMMUNITY_REFUSAL);
    });

    test("a value the database would read as on is refused as well", async () => {
      await expect(update({ enableAuditLogs: "true" })).rejects.toThrow(
        PaymentRequiredException,
      );
    });
  });

  describe("on the Enterprise Edition without a usable audit-log license", () => {
    test.each([
      "missing",
      "expired",
      "invalid",
    ] as Array<EnterpriseLicenseStatus>)(
      "a %s license refuses every widening write with the license message",
      async (status: EnterpriseLicenseStatus) => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus(status),
        });

        for (const [, data] of WIDENING_WRITES) {
          await expect(update(data)).rejects.toThrow(LICENSE_REFUSAL);
        }
      },
    );

    test("a valid license that does not include audit logs refuses them", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: [
            EnterpriseFeature.SSO,
            EnterpriseFeature.SCIM,
            EnterpriseFeature.TeamCompliance,
            EnterpriseFeature.InstanceHealth,
          ],
        }),
      });

      await expect(update({ enableAuditLogs: true })).rejects.toThrow(
        LICENSE_REFUSAL,
      );
    });

    test("before the first license load (no snapshot) it is refused - fail closed", async () => {
      installFakeEnterpriseModule({ snapshot: null });

      await expect(update({ enableAuditLogs: true })).rejects.toThrow(
        LICENSE_REFUSAL,
      );
    });
  });

  describe("with a license that allows audit logs", () => {
    test.each([
      ["valid, every feature", createLicenseSnapshotWithStatus("valid")],
      ["in grace", createLicenseSnapshotWithStatus("grace")],
      [
        "valid, audit logs only",
        createLicenseSnapshot({ features: [EnterpriseFeature.AuditLogs] }),
      ],
    ])(
      "%s: every widening write is allowed, without reading the project",
      async (
        _name: string,
        snapshot: ReturnType<typeof createLicenseSnapshot>,
      ) => {
        installFakeEnterpriseModule({ snapshot });

        for (const [, data] of WIDENING_WRITES) {
          await expect(update(data)).resolves.toBeDefined();
        }

        expect(findBySpy).not.toHaveBeenCalled();
      },
    );
  });

  describe("what is never refused", () => {
    test.each([
      ["switching audit logging off", { enableAuditLogs: false }],
      [
        "no longer recording system events",
        { storeSystemEventsInAuditLogs: false },
      ],
      ["keeping entries for less time", { auditLogsRetentionInDays: 7 }],
      [
        "the whole form, switched off",
        {
          enableAuditLogs: false,
          storeSystemEventsInAuditLogs: false,
          auditLogsRetentionInDays: 7,
        },
      ],
    ])(
      "%s, on a project that logs everything, on the Community Edition",
      async (_name: string, data: Record<string, unknown>) => {
        givenStoredProjects([storedProject(WIDE_PROJECT)]);

        await expect(update(data)).resolves.toBeDefined();
      },
    );

    test("narrowing with an expired license", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });
      givenStoredProjects([storedProject(WIDE_PROJECT)]);

      await expect(
        update({
          enableAuditLogs: true,
          storeSystemEventsInAuditLogs: false,
          auditLogsRetentionInDays: 30,
        }),
      ).resolves.toBeDefined();
    });

    /*
     * The settings form sends every field. Re-saving a project whose logging
     * is already on (switched on while the license was valid) must work.
     */
    test("re-saving the settings a project already has", async () => {
      givenStoredProjects([storedProject(WIDE_PROJECT)]);

      await expect(
        update({
          enableAuditLogs: true,
          storeSystemEventsInAuditLogs: true,
          auditLogsRetentionInDays: 90,
        }),
      ).resolves.toBeDefined();
    });

    test("a write that switches off, with no audit setting to widen, never asks the license or reads the project", async () => {
      const featureCheck: jest.SpyInstance = jest.spyOn(
        EnterpriseEdition,
        "isFeatureAvailable",
      );

      await expect(update({ enableAuditLogs: false })).resolves.toBeDefined();
      await expect(update({ name: "Renamed" })).resolves.toBeDefined();

      expect(featureCheck).not.toHaveBeenCalled();
      expect(findBySpy).not.toHaveBeenCalled();
    });

    test("internal root writes", async () => {
      await expect(
        update({ enableAuditLogs: true }, { isRoot: true }),
      ).resolves.toBeDefined();
      expect(findBySpy).not.toHaveBeenCalled();
    });
  });

  describe("which projects' settings are compared", () => {
    test("the stored values are read as root, for exactly the update's query", async () => {
      await expect(update({ enableAuditLogs: true })).rejects.toThrow(
        PaymentRequiredException,
      );

      expect(findBySpy).toHaveBeenCalledTimes(1);

      const findBy: {
        query: unknown;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = findBySpy.mock.calls[0]![0] as {
        query: unknown;
        select: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      };

      expect(findBy.query).toEqual({ _id: PROJECT_ID.toString() });
      expect(findBy.props).toEqual({ isRoot: true });
      expect(findBy.select).toMatchObject({
        enableAuditLogs: true,
        storeSystemEventsInAuditLogs: true,
        auditLogsRetentionInDays: true,
      });
    });

    test("one widened project among several is enough to refuse", async () => {
      givenStoredProjects([
        storedProject(WIDE_PROJECT),
        storedProject(
          { enableAuditLogs: false },
          new ObjectID("55555555-5555-4555-8555-555555555555"),
        ),
      ]);

      await expect(
        update(
          { enableAuditLogs: true },
          {
            userId: USER_ID,
            tenantId: PROJECT_ID,
            userGlobalAccessPermission: {
              projectIds: [
                PROJECT_ID,
                new ObjectID("55555555-5555-4555-8555-555555555555"),
              ],
            } as never,
          },
        ),
      ).rejects.toThrow(COMMUNITY_REFUSAL);
    });

    /*
     * The check runs before the permission check. A refusal that depended on
     * a project the caller does not belong to would tell them its settings;
     * the permission check refuses that write anyway.
     */
    test("another tenant's project is not compared, so its settings cannot be probed", async () => {
      givenStoredProjects([storedProject(NARROW_PROJECT, OTHER_PROJECT_ID)]);

      await expect(update({ enableAuditLogs: true })).resolves.toBeDefined();
      await expect(
        update({ auditLogsRetentionInDays: 180 }),
      ).resolves.toBeDefined();
    });

    test("a project the caller belongs to through another membership is compared", async () => {
      givenStoredProjects([storedProject(NARROW_PROJECT, OTHER_PROJECT_ID)]);

      await expect(
        update(
          { enableAuditLogs: true },
          {
            userId: USER_ID,
            tenantId: PROJECT_ID,
            userGlobalAccessPermission: {
              projectIds: [OTHER_PROJECT_ID],
            } as never,
          },
        ),
      ).rejects.toThrow(COMMUNITY_REFUSAL);
    });

    test("a master admin's update is compared with every project it matches", async () => {
      givenStoredProjects([storedProject(NARROW_PROJECT, OTHER_PROJECT_ID)]);

      await expect(
        update({ enableAuditLogs: true }, MASTER_ADMIN_PROPS),
      ).rejects.toThrow(COMMUNITY_REFUSAL);
    });
  });
});

describe("billing on (OneUptime Cloud)", () => {
  test("the license is never asked: the plan gates apply", async () => {
    setTestBillingEnabled(true);

    const featureCheck: jest.SpyInstance = jest.spyOn(
      EnterpriseEdition,
      "isFeatureAvailable",
    );

    await expect(
      ProjectService.assertAuditLogSettingsChangeIsLicensed({
        requested: { enableAuditLogs: true, auditLogsRetentionInDays: 180 },
        props: OWNER_PROPS,
        loadCurrentSettings: async (): Promise<
          Array<StoredProjectAuditLogSettings>
        > => {
          return [NARROW_PROJECT];
        },
      }),
    ).resolves.toBeUndefined();

    expect(featureCheck).not.toHaveBeenCalled();
  });
});

describe("creating a project, billing off", () => {
  const SENTINEL: Error = new Error("reached the user lookup");

  const create: (
    settings: StoredProjectAuditLogSettings,
    props?: DatabaseCommonInteractionProps,
  ) => Promise<unknown> = (
    settings: StoredProjectAuditLogSettings,
    props?: DatabaseCommonInteractionProps,
  ): Promise<unknown> => {
    const project: Project = storedProject(settings);
    project.name = "New project";

    return hooks.onBeforeCreate({
      data: project,
      props: props || { userId: USER_ID },
    } as unknown as CreateBy<Project>);
  };

  let userLookup: jest.SpyInstance;

  beforeEach(() => {
    // The hook goes on to read the user; stopping there proves the audit check passed.
    userLookup = jest
      .spyOn(UserService, "findOneById")
      .mockRejectedValue(SENTINEL as never);
  });

  test.each([
    ["audit logging on", { enableAuditLogs: true }],
    ["system events on", { storeSystemEventsInAuditLogs: true }],
    ["a retention above the default", { auditLogsRetentionInDays: 30 }],
  ])(
    "a new project with %s is refused on the Community Edition, before anything is read",
    async (_name: string, settings: StoredProjectAuditLogSettings) => {
      await expect(create(settings)).rejects.toThrow(COMMUNITY_REFUSAL);
      expect(userLookup).not.toHaveBeenCalled();
    },
  );

  test("a new project with audit logging on is refused with an expired license", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    await expect(create({ enableAuditLogs: true })).rejects.toThrow(
      LICENSE_REFUSAL,
    );
  });

  test.each([
    ["the defaults", DEFAULT_PROJECT_AUDIT_LOG_SETTINGS],
    ["no audit settings at all", {}],
    ["audit logging off", { enableAuditLogs: false }],
  ])(
    "a new project with %s is created as before",
    async (_name: string, settings: StoredProjectAuditLogSettings) => {
      await expect(create(settings)).rejects.toBe(SENTINEL);
    },
  );

  test("a new project with audit logging on is created with a valid license", async () => {
    installFakeEnterpriseModule();

    await expect(create({ enableAuditLogs: true })).rejects.toBe(SENTINEL);
  });

  test("root creates are not checked", async () => {
    await expect(
      create({ enableAuditLogs: true }, { userId: USER_ID, isRoot: true }),
    ).rejects.toBe(SENTINEL);
  });
});

/*
 * EnterpriseFeature.AuditLogs used to be referenced by nothing but its own
 * enum, so no license could ever withhold audit logs. Keep it wired.
 */
describe("EnterpriseFeature.AuditLogs is enforced by production code", () => {
  const SERVER_ROOT: string = path.resolve(__dirname, "../../../Server");

  const listSourceFiles: (directory: string) => Array<string> = (
    directory: string,
  ): Array<string> => {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      const fullPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...listSourceFiles(fullPath));
      } else if (entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }

    return files;
  };

  test("ProjectService gates the audit log settings on it", () => {
    const source: string = fs.readFileSync(
      path.join(SERVER_ROOT, "Services/ProjectService.ts"),
      "utf8",
    );

    expect(source).toContain(
      "EnterpriseEdition.isFeatureAvailable(EnterpriseFeature.AuditLogs)",
    );
    expect(source).toContain(
      "EnterpriseEdition.assertFeatureAvailable(EnterpriseFeature.AuditLogs)",
    );
  });

  test("it is referenced outside the enum that declares it", () => {
    const enumFile: string = path.join(
      SERVER_ROOT,
      "Enterprise/EnterpriseFeature.ts",
    );

    const referencing: Array<string> = listSourceFiles(SERVER_ROOT).filter(
      (file: string): boolean => {
        return (
          file !== enumFile &&
          fs.readFileSync(file, "utf8").includes("EnterpriseFeature.AuditLogs")
        );
      },
    );

    expect(referencing.length).toBeGreaterThan(0);
  });
});
