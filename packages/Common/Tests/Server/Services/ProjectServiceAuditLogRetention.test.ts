import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ProjectService, {
  StoredProjectAuditLogSettings,
  widensAuditLogging,
} from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Project from "../../../Models/DatabaseModels/Project";
import {
  AUDIT_LOG_MAX_RETENTION_IN_DAYS,
  AUDIT_LOG_MIN_RETENTION_IN_DAYS,
  AUDIT_LOG_RETENTION_ERROR,
} from "../../../Types/AuditLog/AuditLogRetention";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

/*
 * THE SERVER HOLDS THE AUDIT LOG RETENTION TO 7 TO 180 DAYS (#6383).
 *
 * The settings form checked 7 to 180 in the browser, and nothing on the
 * server did: an API call stored -3, 0 or 3. For -3 the recorder kept
 * entries a day while a failing export reckoned a week, so its "will start
 * losing entries" email came after they were gone. ProjectService now
 * refuses a retention that is not a whole number of days from 7 to 180, on
 * create and on update, with one plain sentence
 * (Common/Types/AuditLog/AuditLogRetention):
 *
 *   - before the project is read or the license asked, as a teammate, a
 *     master admin or OneUptime itself, with billing on or off;
 *   - a number written as text, as the form sends it, is stored as the
 *     number it is;
 *   - a write that leaves the retention out is not judged on it, so a
 *     project that stores a value from before keeps saving everything else;
 *   - a stored value outside the range is compared, when a write could keep
 *     entries longer, as the retention the recorder keeps for it;
 *   - who may set it is unchanged: the column's permissions and, on
 *     OneUptime Cloud, its plan.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true). This suite passes with ee/ deleted: it uses only the
 * fake enterprise module.
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
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// A project owner working in PROJECT_ID.
const OWNER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

const CALLERS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["a project owner", OWNER_PROPS],
  ["a master admin", { userId: USER_ID, isMasterAdmin: true }],
  ["OneUptime itself (root)", { isRoot: true }],
];

const REFUSAL: BadDataException = new BadDataException(
  AUDIT_LOG_RETENTION_ERROR,
);

const COMMUNITY_REFUSAL: PaymentRequiredException =
  new PaymentRequiredException(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE);

// Every retention the server refuses, and why it would have been wrong.
const REFUSED: Array<[string, unknown]> = [
  ["-3, which the recorder kept for a day", -3],
  ["0", 0],
  ["0.5", 0.5],
  ["1", 1],
  ["3, under the form's minimum", 3],
  ["6", 6],
  ["7.5, which Postgres cannot store in a whole-number column", 7.5],
  ["181", 181],
  ["500", 500],
  ["no value (null), which the column cannot hold", null],
  ["blank text", ""],
  ["text", "a week"],
  ['"-3", written as text', "-3"],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["a switch", true],
];

type Hooks = {
  onBeforeUpdate: (updateBy: UpdateBy<Project>) => Promise<unknown>;
  onBeforeCreate: (createBy: CreateBy<Project>) => Promise<unknown>;
};

const hooks: Hooks = ProjectService as unknown as Hooks;

let findBySpy: jest.SpyInstance;
let featureCheck: jest.SpyInstance;
let userLookup: jest.SpyInstance;

// The create hook goes on to read its user; reaching that proves the checks passed.
const SENTINEL: Error = new Error("reached the user lookup");

const storedProject: (settings: StoredProjectAuditLogSettings) => Project = (
  settings: StoredProjectAuditLogSettings,
): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableAuditLogs = Boolean(settings.enableAuditLogs);
  project.storeSystemEventsInAuditLogs = Boolean(
    settings.storeSystemEventsInAuditLogs,
  );

  if (typeof settings.auditLogsRetentionInDays === "number") {
    project.auditLogsRetentionInDays = settings.auditLogsRetentionInDays;
  }

  return project;
};

// The rows an update's query matches, as ProjectService reads them.
const givenStoredProjects: (projects: Array<Project>) => void = (
  projects: Array<Project>,
): void => {
  findBySpy.mockResolvedValue(projects as never);
};

// An update of PROJECT_ID.
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

// A new project with this retention, as the API builds it from the request.
const create: (
  retention: unknown,
  props?: DatabaseCommonInteractionProps,
) => Promise<unknown> = (
  retention: unknown,
  props?: DatabaseCommonInteractionProps,
): Promise<unknown> => {
  const project: Project = new Project();
  project.name = "New project";
  (project as unknown as Record<string, unknown>)["auditLogsRetentionInDays"] =
    retention;

  return hooks.onBeforeCreate({
    data: project,
    props: props || { userId: USER_ID },
  } as unknown as CreateBy<Project>);
};

// A self-hosted Enterprise Edition whose license includes audit logs.
const licensed: () => void = (): void => {
  installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
  });
};

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();

  findBySpy = jest.spyOn(ProjectService, "findBy");
  stubRowsCallerMayWriteLikeFindBy(ProjectService, findBySpy);
  givenStoredProjects([storedProject({ auditLogsRetentionInDays: 30 })]);
  featureCheck = jest.spyOn(EnterpriseEdition, "isFeatureAvailable");
  userLookup = jest
    .spyOn(UserService, "findOneById")
    .mockRejectedValue(SENTINEL as never);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a retention outside 7 to 180 days is refused", () => {
  test.each(REFUSED)(
    "%s: refused on update with the range, before the project is read or the license asked",
    async (_name: string, value: unknown) => {
      licensed();

      await expect(update({ auditLogsRetentionInDays: value })).rejects.toThrow(
        REFUSAL,
      );
      expect(findBySpy).not.toHaveBeenCalled();
      expect(featureCheck).not.toHaveBeenCalled();
    },
  );

  test.each(REFUSED)(
    "%s: refused on create with the range, before anything is read",
    async (_name: string, value: unknown) => {
      licensed();

      await expect(create(value)).rejects.toThrow(REFUSAL);
      expect(userLookup).not.toHaveBeenCalled();
      expect(featureCheck).not.toHaveBeenCalled();
    },
  );

  test.each(CALLERS)(
    "whoever writes it - %s - with billing on or off",
    async (_name: string, props: DatabaseCommonInteractionProps) => {
      for (const billing of [false, true]) {
        setTestBillingEnabled(billing);

        await expect(
          update({ auditLogsRetentionInDays: -3 }, props),
        ).rejects.toThrow(REFUSAL);
        await expect(
          update({ auditLogsRetentionInDays: 500 }, props),
        ).rejects.toThrow(REFUSAL);
      }
    },
  );

  test("with the rest of the settings form, the whole write is refused", async () => {
    licensed();

    await expect(
      update({
        enableAuditLogs: true,
        auditLogsRetentionInDays: 3,
        storeSystemEventsInAuditLogs: true,
      }),
    ).rejects.toThrow(REFUSAL);
  });

  test("the message is the one sentence the form's range gives, never the database's", async () => {
    licensed();

    const refusal: unknown = await update({
      auditLogsRetentionInDays: 7.5,
    }).catch((error: unknown) => {
      return error;
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as BadDataException).message).toBe(
      `Audit log retention must be a whole number of days from ${AUDIT_LOG_MIN_RETENTION_IN_DAYS} to ${AUDIT_LOG_MAX_RETENTION_IN_DAYS}.`,
    );
  });
});

describe("a retention from 7 to 180 days is kept", () => {
  test.each([[7], [8], [30], [90], [179], [180]])(
    "%p days, on update and on create",
    async (days: number) => {
      licensed();

      const data: Record<string, unknown> = { auditLogsRetentionInDays: days };

      await expect(update(data)).resolves.toBeDefined();
      expect(data["auditLogsRetentionInDays"]).toBe(days);
      await expect(create(days)).rejects.toBe(SENTINEL);
    },
  );

  test('a number written as text, as the form sends it, is stored as the number: "30" as 30', async () => {
    licensed();

    const data: Record<string, unknown> = { auditLogsRetentionInDays: " 30 " };

    await expect(update(data)).resolves.toBeDefined();
    expect(data["auditLogsRetentionInDays"]).toBe(30);

    const project: Project = new Project();
    project.name = "New project";
    (project as unknown as Record<string, unknown>)[
      "auditLogsRetentionInDays"
    ] = "90";

    await expect(
      hooks.onBeforeCreate({
        data: project,
        props: { userId: USER_ID },
      } as unknown as CreateBy<Project>),
    ).rejects.toBe(SENTINEL);
    expect(project.auditLogsRetentionInDays).toBe(90);
  });

  test("the default, 7, is created on the Community Edition as before", async () => {
    await expect(create(7)).rejects.toBe(SENTINEL);
  });
});

describe("a project that stores a value from before the server checked it", () => {
  test.each([[-3], [0], [3], [500]])(
    "storing %p, it still saves everything else: a write without the retention is not judged on it",
    async (stored: number) => {
      givenStoredProjects([
        storedProject({ auditLogsRetentionInDays: stored }),
      ]);

      await expect(update({ name: "Renamed project" })).resolves.toBeDefined();
      await expect(update({ enableAuditLogs: false })).resolves.toBeDefined();
      await expect(
        update({ storeSystemEventsInAuditLogs: false }),
      ).resolves.toBeDefined();
    },
  );

  test("a Project instance that does not set the retention is not judged on it", async () => {
    const rename: Project = new Project();
    rename.name = "Renamed project";

    expect("auditLogsRetentionInDays" in rename).toBe(true);
    await expect(
      update(rename as unknown as Record<string, unknown>),
    ).resolves.toBeDefined();
  });

  /*
   * On the Community Edition a write that keeps entries longer is refused
   * (ProjectServiceAuditLogLicense). A project storing -3 keeps them 7 days,
   * so saving the form with 7 keeps them no longer, and 8 does.
   */
  test("storing -3, saving 7 keeps entries no longer than the 7 days they are kept now; 8 does", async () => {
    givenStoredProjects([storedProject({ auditLogsRetentionInDays: -3 })]);

    await expect(
      update({ auditLogsRetentionInDays: 7 }),
    ).resolves.toBeDefined();
    await expect(update({ auditLogsRetentionInDays: 8 })).rejects.toThrow(
      COMMUNITY_REFUSAL,
    );
  });

  test("storing 500, saving 180 keeps entries no longer than the 180 days they are kept now", async () => {
    givenStoredProjects([
      storedProject({
        enableAuditLogs: true,
        auditLogsRetentionInDays: 500,
      }),
    ]);

    await expect(
      update({
        enableAuditLogs: true,
        auditLogsRetentionInDays: 180,
        storeSystemEventsInAuditLogs: false,
      }),
    ).resolves.toBeDefined();
  });

  test.each([
    // [written, stored, keeps entries longer]
    [7, -3, false],
    [8, -3, true],
    [7, 3, false],
    [30, 3, true],
    [180, 500, false],
    [7, 500, false],
    [7, 0, false],
    [8, null, true],
    [7, null, false],
  ])(
    "writing %p over a stored %p keeps entries longer: %p",
    (written: number, stored: number | null, widens: boolean) => {
      expect(
        widensAuditLogging(
          { auditLogsRetentionInDays: written },
          { auditLogsRetentionInDays: stored },
        ),
      ).toBe(widens);
    },
  );
});

describe("who may set the retention is unchanged", () => {
  test("a Project Owner, a Project Admin, or permission to edit the project; on OneUptime Cloud, the Enterprise plan", () => {
    const project: Project = new Project();

    expect(
      [
        ...(project.getColumnAccessControlFor("auditLogsRetentionInDays")
          ?.update || []),
      ].sort(),
    ).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditProject,
      ].sort(),
    );
    expect(
      project.getColumnBillingAccessControl("auditLogsRetentionInDays")?.update,
    ).toBe(PlanType.Enterprise);
  });

  test("a value in the range is still a widening write the license is asked about", async () => {
    await expect(update({ auditLogsRetentionInDays: 90 })).rejects.toThrow(
      COMMUNITY_REFUSAL,
    );
    expect(featureCheck).toHaveBeenCalled();
  });
});

describe("applyAuditLogRetentionRules", () => {
  test("a write that leaves the retention out is left as it is", () => {
    const data: { auditLogsRetentionInDays?: unknown; name?: string } = {
      name: "Renamed project",
    };

    ProjectService.applyAuditLogRetentionRules(data);

    expect(data).toEqual({ name: "Renamed project" });
  });

  test("a retention in the range is stored as its number", () => {
    for (const [written, stored] of [
      [7, 7],
      ["30", 30],
      [" 180 ", 180],
    ] as Array<[unknown, number]>) {
      const data: { auditLogsRetentionInDays?: unknown } = {
        auditLogsRetentionInDays: written,
      };

      ProjectService.applyAuditLogRetentionRules(data);

      expect(data.auditLogsRetentionInDays).toBe(stored);
    }
  });

  test.each(REFUSED)(
    "%s is refused with the range",
    (_name: string, value: unknown) => {
      expect(() => {
        ProjectService.applyAuditLogRetentionRules({
          auditLogsRetentionInDays: value,
        });
      }).toThrow(REFUSAL);
    },
  );
});
