import DatabaseConfig from "../../../Server/DatabaseConfig";
import BillingService from "../../../Server/Services/BillingService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService, {
  ProjectCreateCarryForward,
} from "../../../Server/Services/ProjectService";
import PromoCodeService from "../../../Server/Services/PromoCodeService";
import UserService from "../../../Server/Services/UserService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import UpdatePermission from "../../../Server/Types/Database/Permissions/UpdatePermission";
import logger from "../../../Server/Utils/Logger";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import PromoCode from "../../../Models/DatabaseModels/PromoCode";
import ResellerPlan from "../../../Models/DatabaseModels/ResellerPlan";
import User from "../../../Models/DatabaseModels/User";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

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
 * WHERE A PROJECT WAS BOUGHT IS ONEUPTIME'S TO SAY.
 *
 * A project bought through a reseller records the reseller, the plan it
 * sold and the license (Project.reseller, resellerPlan, resellerLicenseId):
 * the Billing page shows them, the reseller's own tier changes find the
 * project by them, and billing reads them. OneUptime writes them - from the
 * reseller's promo code a project is created with, and from the reseller's
 * own tier changes - and no caller does:
 *
 *   - creating a project with any of them is refused, whoever creates it,
 *     with billing on or off (the API's create, which the dashboard's
 *     project picker uses);
 *   - a project created from a reseller's promo code - the sign-up a
 *     reseller sends people to - gets them from the promo code, written
 *     after the create's checks so they are not held against its creator;
 *   - changing them is refused to every project role, the owner's included
 *     (the API's update); master admins, OneUptime's staff, may.
 *
 * Runs the real hook and the real DatabaseService create path; only the
 * user lookup, the promo code, the project-creation switch, the
 * duplicate-name count, the server's sign-in rules and the repository are
 * stubbed. Nothing is saved: the repository's save answers REACHED_SAVE.
 */

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const REACHED_SAVE: string = "REACHED_SAVE";

const USER_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000001");
const USER_EMAIL: string = "buyer@example.com";
const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000002",
);
const RESELLER_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000003",
);
const RESELLER_PLAN_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000004",
);
const OTHER_RESELLER_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000005",
);
const LICENSE_ID: string = "reseller-license-1";
const PROMO_CODE: string = "RESELLER-PROMO";

// The five columns that say where a project was bought.
const RESELLER_COLUMNS: Array<string> = [
  "reseller",
  "resellerId",
  "resellerPlan",
  "resellerPlanId",
  "resellerLicenseId",
];

// What a caller might send for each, under each of its names.
const RESELLER_WRITES: Array<[string, unknown]> = [
  ["resellerId", OTHER_RESELLER_ID],
  ["reseller", { _id: OTHER_RESELLER_ID.toString() }],
  ["resellerPlanId", RESELLER_PLAN_ID],
  ["resellerPlan", { _id: RESELLER_PLAN_ID.toString() }],
  ["resellerLicenseId", LICENSE_ID],
];

const REFUSAL: RegExp =
  /User is not allowed to create on reseller(Id|Plan|PlanId|LicenseId)? column of Project/;

// A signed-in dashboard user creating a project, from no project.
const creator: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return {
      userId: USER_ID,
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public, Permission.User],
        projectIds: [],
        _type: "UserGlobalAccessPermission",
      },
    } as DatabaseCommonInteractionProps;
  };

// A member of the project, holding `permissions` in it.
const member: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
};

const PROJECT_ROLES: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.EditProject,
  Permission.ManageProjectBilling,
  Permission.BillingAdmin,
  Permission.BillingMember,
];

const newProject: (
  planId: string,
  write?: [string, unknown] | undefined,
  promoCode?: string | undefined,
) => Project = (
  planId: string,
  write?: [string, unknown] | undefined,
  promoCode?: string | undefined,
): Project => {
  const project: Project = new Project();
  project.name = "Acme";
  project.paymentProviderPlanId = planId;

  if (promoCode) {
    project.paymentProviderPromoCode = promoCode;
  }

  if (write) {
    (project as unknown as Dictionary<unknown>)[write[0]] = write[1];
  }

  return project;
};

// The whole create, through ProjectService.create: its refusal, or REACHED_SAVE.
const createProject: (
  project: Project,
  props: DatabaseCommonInteractionProps,
) => Promise<string> = async (
  project: Project,
  props: DatabaseCommonInteractionProps,
): Promise<string> => {
  try {
    await ProjectService.create({ data: project, props });
    return "created";
  } catch (err) {
    return (err as Error).message;
  }
};

const runOnBeforeCreate: (
  project: Project,
  props: DatabaseCommonInteractionProps,
) => Promise<OnCreate<Project>> = async (
  project: Project,
  props: DatabaseCommonInteractionProps,
): Promise<OnCreate<Project>> => {
  return await (
    ProjectService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<Project>,
      ) => Promise<OnCreate<Project>>;
    }
  ).onBeforeCreate({
    data: project,
    props,
  } as CreateBy<Project>);
};

// The promo code a reseller's activation made for the buyer.
const resellerPromoCode: () => PromoCode = (): PromoCode => {
  const promoCode: PromoCode = new PromoCode();
  promoCode.promoCodeId = PROMO_CODE;
  promoCode.userEmail = new Email(USER_EMAIL);
  promoCode.isPromoCodeUsed = false;
  promoCode.planType = PlanType.Growth;
  promoCode.resellerId = RESELLER_ID;
  promoCode.resellerPlanId = RESELLER_PLAN_ID;
  promoCode.resellerLicenseId = LICENSE_ID;

  const plan: ResellerPlan = new ResellerPlan();
  plan._id = RESELLER_PLAN_ID.toString();
  plan.planType = PlanType.Growth;
  promoCode.resellerPlan = plan;

  return promoCode;
};

const savedPlanEnvironment: Record<string, string | undefined> = {};

let save: Mock<(data: Project) => Promise<never>>;
let saved: Array<Project> = [];
let findPromoCode: Mock<() => Promise<PromoCode | null>>;

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);
});

afterAll(() => {
  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  setTestBillingEnabled(true);
  saved = [];

  getJestSpyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  const user: User = new User();
  user.email = new Email(USER_EMAIL);
  getJestSpyOn(UserService, "findOneById").mockResolvedValue(user as never);

  getJestSpyOn(
    DatabaseConfig,
    "shouldDisableUserProjectCreation",
  ).mockResolvedValue(false as never);
  getJestSpyOn(ProjectService, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  // The server does not require SSO for everyone: a new project needs no provider.
  getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(
    new GlobalConfig() as never,
  );

  findPromoCode = jest.fn(async (): Promise<PromoCode | null> => {
    return null;
  });
  getJestSpyOn(PromoCodeService, "findOneBy").mockImplementation(
    findPromoCode as never,
  );
  getJestSpyOn(BillingService, "isPromoCodeValid").mockResolvedValue(
    true as never,
  );

  save = jest.fn(async (data: Project): Promise<never> => {
    saved.push(data);
    throw new Error(REACHED_SAVE);
  });

  getJestSpyOn(ProjectService, "getRepository").mockReturnValue({
    save,
  } as never);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the columns that say where a project was bought", () => {
  const accessControl: Dictionary<ColumnAccessControl> =
    new Project().getColumnAccessControlForAllColumns();

  test.each(RESELLER_COLUMNS)(
    "%s takes no caller's create or update",
    (column: string) => {
      expect(accessControl[column]).toBeDefined();
      expect(accessControl[column]!.create).toEqual([]);
      expect(accessControl[column]!.update).toEqual([]);
    },
  );

  test.each(RESELLER_COLUMNS)(
    "%s is still read by the project's billing readers, beside the plan",
    (column: string) => {
      // resellerLicenseId was never readable; the reseller and its plan are.
      if (column === "resellerLicenseId") {
        expect(accessControl[column]!.read).toEqual([]);
        return;
      }

      expect([...accessControl[column]!.read].sort()).toEqual(
        [...accessControl["planName"]!.read].sort(),
      );
    },
  );
});

describe("creating a project (the API's create) with billing on", () => {
  test.each(RESELLER_WRITES)(
    "with %s is refused, and nothing is saved",
    async (column: string, value: unknown) => {
      expect(
        await createProject(
          newProject("price_growth_month", [column, value]),
          creator(),
        ),
      ).toMatch(REFUSAL);
      expect(save).not.toHaveBeenCalled();
    },
  );

  test("without them is created, with no reseller", async () => {
    expect(
      await createProject(newProject("price_growth_month"), creator()),
    ).toBe(REACHED_SAVE);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.resellerId).toBeUndefined();
    expect(saved[0]!.resellerPlanId).toBeUndefined();
    expect(saved[0]!.resellerLicenseId).toBeUndefined();
  });
});

describe("creating a project (the API's create) with billing off", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test.each(RESELLER_WRITES)(
    "with %s is refused, and nothing is saved",
    async (column: string, value: unknown) => {
      expect(
        await createProject(
          newProject("price_growth_month", [column, value]),
          creator(),
        ),
      ).toMatch(REFUSAL);
      expect(save).not.toHaveBeenCalled();
    },
  );
});

describe("a project created from a reseller's promo code (the sign-up a reseller sends people to)", () => {
  beforeEach(() => {
    findPromoCode.mockImplementation(async (): Promise<PromoCode | null> => {
      return resellerPromoCode();
    });
  });

  test("records the promo code's reseller, plan and license, written by OneUptime", async () => {
    expect(
      await createProject(
        newProject("price_growth_month", undefined, PROMO_CODE),
        creator(),
      ),
    ).toBe(REACHED_SAVE);

    expect(saved).toHaveLength(1);
    expect(saved[0]!.resellerId?.toString()).toBe(RESELLER_ID.toString());
    expect(saved[0]!.resellerPlanId?.toString()).toBe(
      RESELLER_PLAN_ID.toString(),
    );
    expect(saved[0]!.resellerLicenseId).toBe(LICENSE_ID);
  });

  test("the hook does not write them before the create's column check, which runs after it", async () => {
    const onCreate: OnCreate<Project> = await runOnBeforeCreate(
      newProject("price_growth_month", undefined, PROMO_CODE),
      creator(),
    );

    expect(onCreate.createBy.data.resellerId).toBeUndefined();
    expect(onCreate.createBy.data.reseller).toBeUndefined();
    expect(onCreate.createBy.data.resellerPlanId).toBeUndefined();
    expect(onCreate.createBy.data.resellerPlan).toBeUndefined();
    expect(onCreate.createBy.data.resellerLicenseId).toBeUndefined();

    // It hands them to the step after every check instead.
    const carryForward: ProjectCreateCarryForward =
      onCreate.carryForward as ProjectCreateCarryForward;

    expect(carryForward.resellerFromPromoCode?.resellerId?.toString()).toBe(
      RESELLER_ID.toString(),
    );
    expect(carryForward.resellerFromPromoCode?.resellerPlanId?.toString()).toBe(
      RESELLER_PLAN_ID.toString(),
    );
    expect(carryForward.resellerFromPromoCode?.resellerLicenseId).toBe(
      LICENSE_ID,
    );

    // The project the promo code made holds the column check to nothing it wrote.
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Project,
        onCreate.createBy.data,
        onCreate.createBy.props,
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test.each(RESELLER_WRITES)(
    "a create that also names %s itself is refused, and nothing is saved",
    async (column: string, value: unknown) => {
      expect(
        await createProject(
          newProject("price_growth_month", [column, value], PROMO_CODE),
          creator(),
        ),
      ).toMatch(REFUSAL);
      expect(save).not.toHaveBeenCalled();
    },
  );

  test("a promo code with no reseller records none", async () => {
    findPromoCode.mockImplementation(async (): Promise<PromoCode | null> => {
      const promoCode: PromoCode = resellerPromoCode();
      delete promoCode.resellerId;
      delete promoCode.resellerPlanId;
      delete promoCode.resellerLicenseId;
      return promoCode;
    });

    expect(
      await createProject(
        newProject("price_growth_month", undefined, PROMO_CODE),
        creator(),
      ),
    ).toBe(REACHED_SAVE);
    expect(saved[0]!.resellerId).toBeUndefined();
    expect(saved[0]!.resellerPlanId).toBeUndefined();
    expect(saved[0]!.resellerLicenseId).toBeUndefined();
  });

  test("a promo code made for someone else creates nothing", async () => {
    findPromoCode.mockImplementation(async (): Promise<PromoCode | null> => {
      const promoCode: PromoCode = resellerPromoCode();
      promoCode.userEmail = new Email("someone-else@example.com");
      return promoCode;
    });

    expect(
      await createProject(
        newProject("price_growth_month", undefined, PROMO_CODE),
        creator(),
      ),
    ).toBe(
      "This promocode is assigned to a different user and cannot be used.",
    );
    expect(save).not.toHaveBeenCalled();
  });
});

describe("ProjectService.writeResellerFromPromoCode", () => {
  test("writes the reseller and its plan under their ID columns, dropping a relation beside them", () => {
    const project: Project = new Project();
    (project as unknown as Dictionary<unknown>)["reseller"] = {
      _id: OTHER_RESELLER_ID.toString(),
    };

    ProjectService.writeResellerFromPromoCode(project, {
      resellerId: RESELLER_ID,
      resellerPlanId: RESELLER_PLAN_ID,
      resellerLicenseId: LICENSE_ID,
    });

    expect(project.resellerId?.toString()).toBe(RESELLER_ID.toString());
    expect(project.reseller).toBeUndefined();
    expect(project.resellerPlanId?.toString()).toBe(
      RESELLER_PLAN_ID.toString(),
    );
    expect(project.resellerLicenseId).toBe(LICENSE_ID);
  });

  test("writes nothing for a project created without one", () => {
    const project: Project = new Project();

    ProjectService.writeResellerFromPromoCode(project, undefined);

    expect(project.resellerId).toBeUndefined();
    expect(project.resellerPlanId).toBeUndefined();
    expect(project.resellerLicenseId).toBeUndefined();
  });
});

describe("changing where a project was bought (the API's update)", () => {
  test.each(PROJECT_ROLES)(
    "is refused to a member holding %s, for every column",
    (permission: Permission) => {
      for (const [column, value] of RESELLER_WRITES) {
        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            Project,
            { [column]: value } as unknown as Project,
            member([permission]),
            DatabaseRequestType.Update,
          );
        }).toThrow(
          `User is not allowed to update on ${column} column of Project`,
        );
      }
    },
  );

  test("is refused to a member holding every project role at once", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Project,
        { resellerPlanId: RESELLER_PLAN_ID } as unknown as Project,
        member(PROJECT_ROLES),
        DatabaseRequestType.Update,
      );
    }).toThrow(
      "User is not allowed to update on resellerPlanId column of Project",
    );
  });

  test("is refused when clearing them too", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Project,
        { resellerId: null } as unknown as Project,
        member([Permission.ProjectOwner]),
        DatabaseRequestType.Update,
      );
    }).toThrow("User is not allowed to update on resellerId column of Project");
  });

  test("a master admin, OneUptime's staff, may change them", async () => {
    const query: Record<string, unknown> = { _id: PROJECT_ID.toString() };

    await expect(
      UpdatePermission.checkUpdatePermissions(
        Project,
        { ...query } as never,
        {
          resellerId: RESELLER_ID,
          resellerPlanId: RESELLER_PLAN_ID,
        } as never,
        { userId: USER_ID, isMasterAdmin: true },
      ),
    ).resolves.toEqual(query);
  });

  test("the owner still renames the project", () => {
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Project,
        { name: "Renamed" } as unknown as Project,
        member([Permission.ProjectOwner]),
        DatabaseRequestType.Update,
      );
    }).not.toThrow();
  });
});
