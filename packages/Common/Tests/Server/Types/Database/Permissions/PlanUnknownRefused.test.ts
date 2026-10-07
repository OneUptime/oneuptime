import AuditLog from "../../../../../Models/AnalyticsModels/AuditLog";
import Log from "../../../../../Models/AnalyticsModels/Log";
import RumSession from "../../../../../Models/AnalyticsModels/RumSession";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import ScheduledMaintenanceTemplate from "../../../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import TeamComplianceSetting from "../../../../../Models/DatabaseModels/TeamComplianceSetting";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import AnalyticsModelPermission from "../../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../../../../Server/Types/Database/Permissions/BillingPermission";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import PlanGates from "../../../../../Server/Types/Database/Permissions/PlanGates";
import CallerPlan from "../../../../../Server/Utils/Billing/CallerPlan";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import UserType from "../../../../../Types/UserType";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../../../Spy";
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

jest.mock("../../../../../Server/Utils/Logger");

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../../Enterprise/TestBillingFlag",
    ) as typeof import("../../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * A PLAN THAT IS NOT KNOWN IS NEVER "EVERY PLAN".
 *
 * On OneUptime Cloud (billing on) every table and column a plan sells is
 * checked against the plan the caller's props carry. A request through the
 * API carries its project's plan; props built by hand used not to, and every
 * plan check read "no plan" as "every plan". Now:
 *
 *  - DatabaseService and ModelPermission's async checks read the project's
 *    plan for props that act in a project without one - only for an
 *    operation a plan decides (PlanGates), and only after the refusals that
 *    need no lookup;
 *  - a check that still meets props with no plan refuses, in plain words
 *    (CallerPlan.PLAN_UNKNOWN_MESSAGE), for the table check, the column
 *    check and the analytics checks alike;
 *  - a read across projects holds each project to its own plan.
 *
 * OneUptime itself (root) and server admins need no plan, and nothing is
 * read or refused with billing off. The plans are read from
 * SUBSCRIPTION_PLAN_* in the environment, which this suite sets itself.
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

const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("7a000000-0000-4000-8000-0000000000e1");

type ModelType = { new (): BaseModel };

function grant(permission: Permission): UserPermission {
  return {
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

/*
 * A project owner of PROJECT_ID, built by hand without the project's plan -
 * as every caller that builds its own props used to be.
 */
function ownerWithoutPlan(
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          grant(Permission.ProjectOwner),
          grant(Permission.ProjectAdmin),
        ],
        _type: "UserTenantAccessPermission",
      },
    },
    ...extra,
  };
}

function onPlan(plan: PlanType): Partial<DatabaseCommonInteractionProps> {
  return { currentPlan: plan, isSubscriptionUnpaid: false };
}

function errorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  return null;
}

function expectPlanUnknown(error: unknown): void {
  expect(error).toBeInstanceOf(NotAuthorizedException);
  expect((error as Error).message).toBe(CallerPlan.PLAN_UNKNOWN_MESSAGE);
}

// The spy getJestSpyOn hands back.
type SpyInstance = ReturnType<typeof getJestSpyOn>;

let currentPlanSpy: SpyInstance;
const plansByProject: Map<string, PlanType> = new Map();
const savedPlanEnvironment: Record<string, string | undefined> = {};

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
  plansByProject.clear();
  plansByProject.set(PROJECT_ID.toString(), PlanType.Enterprise);

  currentPlanSpy = getJestSpyOn(ProjectService, "getCurrentPlan");
  currentPlanSpy.mockImplementation((async (projectId: ObjectID) => {
    return {
      plan: plansByProject.get(projectId.toString()) || PlanType.Free,
      isSubscriptionUnpaid: false,
    };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("PlanGates: which reads and writes a plan decides", () => {
  test("a requirement every plan meets decides nothing: none at all, or Free", () => {
    expect(PlanGates.isMetByEveryPlan(undefined)).toBe(true);
    expect(PlanGates.isMetByEveryPlan(null)).toBe(true);
    expect(PlanGates.isMetByEveryPlan(PlanType.Free)).toBe(true);
    expect(PlanGates.isMetByEveryPlan(PlanType.Growth)).toBe(false);
    expect(PlanGates.isMetByEveryPlan(PlanType.Enterprise)).toBe(false);
  });

  test("a table's plan decides the operations it names one for", () => {
    // Label: Growth to create and change, Free to read and delete.
    expect(
      PlanGates.isPlanAtStake(new Label(), DatabaseRequestType.Create),
    ).toBe(true);
    expect(
      PlanGates.isPlanAtStake(new Label(), DatabaseRequestType.Update),
    ).toBe(true);
    expect(PlanGates.isPlanAtStake(new Label(), DatabaseRequestType.Read)).toBe(
      false,
    );
    expect(
      PlanGates.isPlanAtStake(new Label(), DatabaseRequestType.Delete),
    ).toBe(false);
  });

  test("a table that names no plan, written without a paid column, needs none", () => {
    for (const type of [
      DatabaseRequestType.Create,
      DatabaseRequestType.Read,
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]) {
      expect(
        PlanGates.isPlanAtStake(new Monitor(), type, { name: "Checkout" }),
      ).toBe(false);
    }
  });

  test("a create or update that writes a column a plan sells needs the plan", () => {
    expect(
      PlanGates.isPlanAtStake(new StatusPage(), DatabaseRequestType.Create, {
        name: "Acme",
        customCSS: "body { color: #111827; }",
      }),
    ).toBe(true);
    expect(
      PlanGates.isPlanAtStake(new StatusPage(), DatabaseRequestType.Update, {
        customCSS: "body { color: #111827; }",
      }),
    ).toBe(true);
  });

  test("a column the write leaves undefined is not written, and a read writes nothing", () => {
    expect(
      PlanGates.isPlanAtStake(new StatusPage(), DatabaseRequestType.Update, {
        name: "Acme",
        customCSS: undefined,
      }),
    ).toBe(false);
    expect(
      PlanGates.isPlanAtStake(new StatusPage(), DatabaseRequestType.Read, {
        customCSS: "body { color: #111827; }",
      }),
    ).toBe(false);
  });

  test("an analytics table's plan decides as a database table's does", () => {
    expect(
      PlanGates.isAnalyticsPlanAtStake(
        new AuditLog(),
        DatabaseRequestType.Read,
      ),
    ).toBe(true);
    expect(
      PlanGates.isAnalyticsPlanAtStake(new Log(), DatabaseRequestType.Read),
    ).toBe(false);
  });
});

describe("BillingPermissions: a table's plan, for props with no plan", () => {
  test("a project caller is refused where the table names a plan, in plain words", () => {
    expectPlanUnknown(
      errorOf(() => {
        BillingPermissions.checkBillingPermissions(
          TeamComplianceSetting,
          ownerWithoutPlan(),
          DatabaseRequestType.Create,
        );
      }),
    );
  });

  test.each([
    [
      "the table's plan for it is Free",
      TeamComplianceSetting,
      DatabaseRequestType.Read,
    ],
    ["the table names no plan", Monitor, DatabaseRequestType.Create],
    [
      "a project may still read what it has below the plan",
      OnCallDutyPolicySchedule,
      DatabaseRequestType.Read,
    ],
  ])(
    "nothing is refused where %s",
    (_label: string, modelType: ModelType, type: DatabaseRequestType) => {
      expect(
        errorOf(() => {
          BillingPermissions.checkBillingPermissions(
            modelType as never,
            ownerWithoutPlan(),
            type,
          );
        }),
      ).toBeNull();
    },
  );

  test.each([
    ["OneUptime itself", { isRoot: true, tenantId: PROJECT_ID }],
    ["a server admin", { isMasterAdmin: true, userId: USER_ID }],
    ["a caller acting in no project", { userId: USER_ID }],
  ])(
    "%s needs no plan",
    (_label: string, props: DatabaseCommonInteractionProps) => {
      expect(
        errorOf(() => {
          BillingPermissions.checkBillingPermissions(
            TeamComplianceSetting,
            props,
            DatabaseRequestType.Create,
          );
        }),
      ).toBeNull();
    },
  );

  test("nothing is refused with billing off", () => {
    setTestBillingEnabled(false);

    expect(
      errorOf(() => {
        BillingPermissions.checkBillingPermissions(
          TeamComplianceSetting,
          ownerWithoutPlan(),
          DatabaseRequestType.Create,
        );
      }),
    ).toBeNull();
  });

  test("a plan that is known is compared as it always was", () => {
    const below: unknown = errorOf(() => {
      BillingPermissions.checkBillingPermissions(
        TeamComplianceSetting,
        ownerWithoutPlan(onPlan(PlanType.Growth)),
        DatabaseRequestType.Create,
      );
    });

    expect(below).toBeInstanceOf(PaymentRequiredException);
    expect((below as Error).message).toBe(
      "Please upgrade your plan to Scale to access this feature",
    );

    expect(
      errorOf(() => {
        BillingPermissions.checkBillingPermissions(
          TeamComplianceSetting,
          ownerWithoutPlan(onPlan(PlanType.Scale)),
          DatabaseRequestType.Create,
        );
      }),
    ).toBeNull();
  });

  test("the feature check refuses a caller with no plan too", () => {
    expectPlanUnknown(
      errorOf(() => {
        BillingPermissions.checkFeatureIsOnPlan(
          OnCallDutyPolicySchedule,
          ownerWithoutPlan(),
          DatabaseRequestType.Read,
        );
      }),
    );
  });
});

describe("ColumnPermissions: a column's plan, for props with no plan", () => {
  function checkColumns(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType = DatabaseRequestType.Create,
  ): unknown {
    const page: StatusPage = new StatusPage();

    for (const [key, value] of Object.entries(data)) {
      (page as unknown as Record<string, unknown>)[key] = value;
    }

    return errorOf(() => {
      ColumnPermissions.checkDataColumnPermissions(
        StatusPage,
        page,
        props,
        type,
      );
    });
  }

  test("writing a column a plan sells is refused, never read as any plan", () => {
    expectPlanUnknown(
      checkColumns(
        { name: "Acme", customCSS: "body { color: #111827; }" },
        ownerWithoutPlan(),
      ),
    );
    expectPlanUnknown(
      checkColumns(
        { customJavaScript: "console.log('acme');" },
        ownerWithoutPlan(),
        DatabaseRequestType.Update,
      ),
    );
  });

  test("a write that leaves the paid columns alone needs no plan", () => {
    expect(checkColumns({ name: "Acme" }, ownerWithoutPlan())).toBeNull();
  });

  test("nothing is refused with billing off", () => {
    setTestBillingEnabled(false);

    expect(
      checkColumns(
        { customCSS: "body { color: #111827; }" },
        ownerWithoutPlan(),
      ),
    ).toBeNull();
  });

  test("with the plan carried, the column is compared against it", () => {
    const below: unknown = checkColumns(
      { customCSS: "body { color: #111827; }" },
      ownerWithoutPlan(onPlan(PlanType.Free)),
    );

    expect(below).toBeInstanceOf(PaymentRequiredException);
    expect((below as Error).message).toBe(
      "Please upgrade your plan to Growth to access this feature",
    );
    expect(
      checkColumns(
        { customCSS: "body { color: #111827; }" },
        ownerWithoutPlan(onPlan(PlanType.Growth)),
      ),
    ).toBeNull();
  });
});

describe("the analytics checks, for props with no plan", () => {
  test("a create of a table a plan sells is refused", () => {
    // Session replays: Growth.
    expectPlanUnknown(
      errorOf(() => {
        AnalyticsModelPermission.checkCreatePermissions(
          RumSession,
          new RumSession(),
          ownerWithoutPlan(),
        );
      }),
    );
  });

  test("a read reads the project's plan first, and holds the caller to it", async () => {
    plansByProject.set(PROJECT_ID.toString(), PlanType.Growth);

    await expect(
      AnalyticsModelPermission.checkReadPermission(
        AuditLog,
        {},
        null,
        ownerWithoutPlan(),
      ),
    ).rejects.toThrow("Please upgrade your plan to Enterprise");

    expect(currentPlanSpy).toHaveBeenCalledWith(PROJECT_ID);
  });
});

describe("DatabaseService reads the project's plan only when a plan decides", () => {
  class PastTheChecks extends Error {}

  function labelService(): DatabaseService<Label> {
    const service: DatabaseService<Label> = new DatabaseService<Label>(Label);

    // The unique-name check finds no clash, without a database.
    getJestSpyOn(service, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );
    // The create stops just before its insert, once every check has passed.
    getJestSpyOn(service, "assertCreateWillInsert").mockImplementation(
      (): never => {
        throw new PastTheChecks();
      },
    );

    return service;
  }

  function newLabel(): Label {
    const label: Label = new Label();
    label.name = "payments";
    label.color = "#4f46e5" as never;
    return label;
  }

  test("a create the plan decides reads the plan once, and passes on a plan that has it", async () => {
    await expect(
      labelService().create({ data: newLabel(), props: ownerWithoutPlan() }),
    ).rejects.toBeInstanceOf(PastTheChecks);

    expect(currentPlanSpy).toHaveBeenCalledTimes(1);
    expect(currentPlanSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("on a plan that does not have it, the create is refused with the plan's name", async () => {
    plansByProject.set(PROJECT_ID.toString(), PlanType.Free);

    await expect(
      labelService().create({ data: newLabel(), props: ownerWithoutPlan() }),
    ).rejects.toThrow("Please upgrade your plan to Growth");
  });

  test("a caller's own props are left as they were", async () => {
    const props: DatabaseCommonInteractionProps = ownerWithoutPlan();

    await expect(
      labelService().create({ data: newLabel(), props: props }),
    ).rejects.toBeInstanceOf(PastTheChecks);

    expect(props.currentPlan).toBeUndefined();
  });

  test("props that carry the plan are not read again", async () => {
    await expect(
      labelService().create({
        data: newLabel(),
        props: ownerWithoutPlan(onPlan(PlanType.Enterprise)),
      }),
    ).rejects.toBeInstanceOf(PastTheChecks);

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });

  test("a read no plan decides reads nothing", async () => {
    const service: DatabaseService<Label> = new DatabaseService<Label>(Label);
    getJestSpyOn(service, "getRepository").mockReturnValue({
      find: async (): Promise<Array<Label>> => {
        return [];
      },
    } as never);

    await expect(
      service.findBy({
        query: {},
        select: { name: true },
        limit: 10,
        skip: 0,
        props: ownerWithoutPlan(),
      }),
    ).resolves.toEqual([]);

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });

  test("an anonymous caller is refused with a 401 before anything is read", async () => {
    await expect(
      labelService().create({
        data: newLabel(),
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toBeInstanceOf(NotAuthenticatedException);

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });

  test("a credential that may only read is refused before anything is read", async () => {
    await expect(
      labelService().create({
        data: newLabel(),
        props: ownerWithoutPlan({ isReadOnlyCredential: true }),
      }),
    ).rejects.toThrow();

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });

  test("nothing is read with billing off", async () => {
    setTestBillingEnabled(false);

    await expect(
      labelService().create({ data: newLabel(), props: ownerWithoutPlan() }),
    ).rejects.toBeInstanceOf(PastTheChecks);

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });
});

describe("a read across projects holds each project to its own plan", () => {
  function acrossProjects(): DatabaseCommonInteractionProps {
    return {
      userId: USER_ID,
      userType: UserType.User,
      isMultiTenantRequest: true,
      // A plan read for the project the request named reaches no other.
      ...onPlan(PlanType.Enterprise),
      tenantId: PROJECT_ID,
      userGlobalAccessPermission: {
        projectIds: [PROJECT_ID, OTHER_PROJECT_ID],
        globalPermissions: [Permission.Public, Permission.User],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: [grant(Permission.ProjectOwner)],
          _type: "UserTenantAccessPermission",
        },
        [OTHER_PROJECT_ID.toString()]: {
          projectId: OTHER_PROJECT_ID,
          permissions: [grant(Permission.ProjectOwner)],
          _type: "UserTenantAccessPermission",
        },
      },
    };
  }

  // The project each part of the read is scoped to: a raw match on its id.
  function projectsReached(query: unknown): Array<string> {
    const parts: Array<unknown> = Array.isArray(query) ? query : [query];

    return parts
      .map((part: unknown): string => {
        const projectId: {
          _objectLiteralParameters?: Record<string, unknown>;
        } = (part as Record<string, unknown>)["projectId"] as {
          _objectLiteralParameters?: Record<string, unknown>;
        };

        return Object.values(projectId._objectLiteralParameters || {})
          .map(String)
          .join(",");
      })
      .sort();
  }

  test("a project below the table's plan is left out; one on it is read", async () => {
    // Scheduled maintenance templates: Growth to read.
    plansByProject.set(PROJECT_ID.toString(), PlanType.Enterprise);
    plansByProject.set(OTHER_PROJECT_ID.toString(), PlanType.Free);

    const result: { query: unknown } =
      await ModelPermission.checkReadQueryPermission(
        ScheduledMaintenanceTemplate,
        {},
        { _id: true },
        acrossProjects(),
      );

    expect(projectsReached(result.query)).toEqual([PROJECT_ID.toString()]);

    /*
     * The plan the request carried is the named project's own, so only the
     * other project's is read - never taken from the one the request named.
     */
    expect(currentPlanSpy).toHaveBeenCalledTimes(1);
    expect(currentPlanSpy).toHaveBeenCalledWith(OTHER_PROJECT_ID);
  });

  test("every project on the plan is read", async () => {
    plansByProject.set(OTHER_PROJECT_ID.toString(), PlanType.Growth);

    const result: { query: unknown } =
      await ModelPermission.checkReadQueryPermission(
        ScheduledMaintenanceTemplate,
        {},
        { _id: true },
        acrossProjects(),
      );

    expect(projectsReached(result.query)).toEqual(
      [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort(),
    );
  });
});
