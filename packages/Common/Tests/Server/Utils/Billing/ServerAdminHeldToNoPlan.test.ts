import RumSession from "../../../../Models/AnalyticsModels/RumSession";
import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import Label from "../../../../Models/DatabaseModels/Label";
import CommonAPI from "../../../../Server/API/CommonAPI";
import ProjectService from "../../../../Server/Services/ProjectService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import AnalyticsModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BillingPermissions from "../../../../Server/Types/Database/Permissions/BillingPermission";
import ColumnPermissions from "../../../../Server/Types/Database/Permissions/ColumnPermission";
import CallerPlan from "../../../../Server/Utils/Billing/CallerPlan";
import {
  ExpressRequest,
  OneUptimeRequest,
} from "../../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import Email from "../../../../Types/Email";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import UserType from "../../../../Types/UserType";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../../Spy";
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

jest.mock("../../../../Server/Utils/Logger");

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * ONE RULE: A SERVER ADMIN ACTING IN A PROJECT IS HELD TO NO PLAN.
 *
 * Server admins (master admins) used to be held to a project's plan in one
 * place and not in another: a request through the API read the project's
 * plan for everyone (CommonAPI), so a custom route that checked a plan - a
 * test send, starting a GitHub connection, the on-call timeline - refused a
 * server admin below it, while the CRUD path and everything that read the
 * plan through CallerPlan let one through. Now there is one rule, in
 * CallerPlan, on every path:
 *
 *  - a request through the API reads no plan for a server admin, and their
 *    props carry none - so nothing below can hold them to one;
 *  - every plan check lets OneUptime itself and a server admin through, even
 *    should their props carry a plan (an unpaid one too), so an operator can
 *    always fix a project;
 *  - everyone else is held to their project's plan exactly as before, and a
 *    server admin who is no longer one is held to it like anyone else.
 *
 * Billing on, the plans are read from SUBSCRIPTION_PLAN_* in the
 * environment, which this suite sets itself; billing off, nothing is read.
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
  "5a000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5a000000-0000-4000-8000-0000000000e1");

const GROWTH_REFUSAL: string =
  "Please upgrade your plan to Growth to access this feature";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

let currentPlanSpy: SpyInstance;
let projectPlan: PlanType | null;
let projectUnpaid: boolean;
const savedPlanEnvironment: Record<string, string | undefined> = {};

function grant(permission: Permission): UserPermission {
  return {
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

// A project owner of PROJECT_ID; a server admin when `isMasterAdmin`.
function ownerProps(
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: extra.isMasterAdmin ? UserType.MasterAdmin : UserType.User,
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

const SERVER_ADMIN: Partial<DatabaseCommonInteractionProps> = {
  isMasterAdmin: true,
};

function onPlan(
  plan: PlanType,
  isSubscriptionUnpaid: boolean = false,
): Partial<DatabaseCommonInteractionProps> {
  return { currentPlan: plan, isSubscriptionUnpaid: isSubscriptionUnpaid };
}

function errorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  return null;
}

// A signed-in request to PROJECT_ID, as the session middleware leaves it.
function requestFrom(options: { isMasterAdmin: boolean }): ExpressRequest {
  const fields: Partial<OneUptimeRequest> = {
    userType: options.isMasterAdmin ? UserType.MasterAdmin : UserType.User,
    tenantId: PROJECT_ID,
    userAuthorization: {
      userId: USER_ID,
      email: new Email("operator@example.com"),
      name: new Name("Olga Operator"),
      isMasterAdmin: options.isMasterAdmin,
      isGlobalLogin: true,
    },
  };

  return { headers: {}, ...fields } as unknown as ExpressRequest;
}

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
  projectPlan = PlanType.Free;
  projectUnpaid = false;

  currentPlanSpy = getJestSpyOn(ProjectService, "getCurrentPlan");
  currentPlanSpy.mockImplementation((async () => {
    return { plan: projectPlan, isSubscriptionUnpaid: projectUnpaid };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("CallerPlan: who a plan holds", () => {
  test("OneUptime itself and a server admin are held to no plan, whatever their props carry", () => {
    expect(CallerPlan.isHeldToNoPlan({ isRoot: true })).toBe(true);
    expect(CallerPlan.isHeldToNoPlan(ownerProps(SERVER_ADMIN))).toBe(true);
    expect(
      CallerPlan.isHeldToNoPlan(
        ownerProps({ ...SERVER_ADMIN, ...onPlan(PlanType.Free) }),
      ),
    ).toBe(true);
    expect(CallerPlan.isHeldToNoPlan(ownerProps())).toBe(false);
  });

  test("a member, an API key and a workflow step acting in a project are held to its plan", () => {
    expect(CallerPlan.isHeldToPlan(ownerProps())).toBe(true);
    expect(
      CallerPlan.isHeldToPlan({ userType: UserType.API, tenantId: PROJECT_ID }),
    ).toBe(true);
    expect(
      CallerPlan.isHeldToPlan({
        userType: UserType.Workflow,
        tenantId: PROJECT_ID,
      }),
    ).toBe(true);
  });

  test("a server admin acting in a project is not held to its plan, nor is its plan missing", () => {
    expect(CallerPlan.isHeldToPlan(ownerProps(SERVER_ADMIN))).toBe(false);
    expect(CallerPlan.isPlanMissing(ownerProps(SERVER_ADMIN))).toBe(false);
  });

  test("nothing is held to a plan with billing off, or without a project", () => {
    expect(CallerPlan.isHeldToPlan({ userId: USER_ID })).toBe(false);

    setTestBillingEnabled(false);

    expect(CallerPlan.isHeldToPlan(ownerProps())).toBe(false);
    expect(CallerPlan.isPlanMissing(ownerProps())).toBe(false);
  });

  test("withPlan reads no plan for a server admin, and gives one to everyone else it holds", async () => {
    const admin: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
      ownerProps(SERVER_ADMIN),
    );

    expect(admin.currentPlan).toBeUndefined();
    expect(currentPlanSpy).not.toHaveBeenCalled();

    const member: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
      ownerProps(),
    );

    expect(member.currentPlan).toBe(PlanType.Free);
    expect(currentPlanSpy).toHaveBeenCalledTimes(1);
  });
});

describe("a request through the API (CommonAPI) follows the one rule", () => {
  test("a server admin's request reads no plan and carries none", async () => {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(
        requestFrom({ isMasterAdmin: true }),
      );

    expect(props.isMasterAdmin).toBe(true);
    expect(props.tenantId?.toString()).toBe(PROJECT_ID.toString());
    expect(props.currentPlan).toBeUndefined();
    expect(props.isSubscriptionUnpaid).toBeUndefined();
    expect(currentPlanSpy).not.toHaveBeenCalled();
  });

  test("a member's request carries its project's plan, read once", async () => {
    projectUnpaid = true;

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(
        requestFrom({ isMasterAdmin: false }),
      );

    expect(props.isMasterAdmin).toBeUndefined();
    expect(props.currentPlan).toBe(PlanType.Free);
    expect(props.isSubscriptionUnpaid).toBe(true);
    expect(currentPlanSpy).toHaveBeenCalledTimes(1);
    expect(currentPlanSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("a project with no plan yet: a member's request carries none, and its checks refuse", async () => {
    projectPlan = null;

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(
        requestFrom({ isMasterAdmin: false }),
      );

    expect(props.currentPlan).toBeUndefined();

    const refusal: unknown = errorOf(() => {
      BillingPermissions.checkFeatureIsOnPlan(
        Label,
        props,
        DatabaseRequestType.Create,
      );
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(CallerPlan.PLAN_UNKNOWN_MESSAGE);
  });

  test("with billing off, no plan is read for anyone", async () => {
    setTestBillingEnabled(false);

    for (const isMasterAdmin of [true, false]) {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(
          requestFrom({ isMasterAdmin }),
        );

      expect(props.currentPlan).toBeUndefined();
    }

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });

  test("what the request carries decides the checks: a server admin passes a plan check a member below it fails", async () => {
    const admin: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(
        requestFrom({ isMasterAdmin: true }),
      );
    const member: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(
        requestFrom({ isMasterAdmin: false }),
      );

    expect(
      errorOf(() => {
        BillingPermissions.checkFeatureIsOnPlan(
          Label,
          admin,
          DatabaseRequestType.Create,
        );
      }),
    ).toBeNull();

    const refusal: unknown = errorOf(() => {
      BillingPermissions.checkFeatureIsOnPlan(
        Label,
        member,
        DatabaseRequestType.Create,
      );
    });

    expect(refusal).toBeInstanceOf(PaymentRequiredException);
    expect((refusal as Error).message).toBe(GROWTH_REFUSAL);
  });
});

describe("every plan check lets a server admin through, even with a plan on their props", () => {
  test("a table's plan (Labels need Growth to create)", () => {
    for (const check of [
      BillingPermissions.checkBillingPermissions,
      BillingPermissions.checkFeatureIsOnPlan,
    ]) {
      expect(
        errorOf(() => {
          check(
            Label,
            ownerProps({ ...SERVER_ADMIN, ...onPlan(PlanType.Free) }),
            DatabaseRequestType.Create,
          );
        }),
      ).toBeNull();

      expect(
        errorOf(() => {
          check(
            Label,
            ownerProps(onPlan(PlanType.Free)),
            DatabaseRequestType.Create,
          );
        }),
      ).toBeInstanceOf(PaymentRequiredException);
    }
  });

  test("an unpaid subscription holds a member, never a server admin", () => {
    expect(
      errorOf(() => {
        BillingPermissions.checkBillingPermissions(
          Label,
          ownerProps({
            ...SERVER_ADMIN,
            ...onPlan(PlanType.Enterprise, true),
          }),
          DatabaseRequestType.Create,
        );
      }),
    ).toBeNull();

    expect(
      errorOf(() => {
        BillingPermissions.checkBillingPermissions(
          Label,
          ownerProps(onPlan(PlanType.Enterprise, true)),
          DatabaseRequestType.Create,
        );
      }),
    ).toBeInstanceOf(PaymentRequiredException);
  });

  test("a column's plan (a public dashboard needs Growth)", () => {
    const write: () => Dashboard = (): Dashboard => {
      const dashboard: Dashboard = new Dashboard();
      dashboard.isPublicDashboard = true;
      return dashboard;
    };

    expect(
      errorOf(() => {
        ColumnPermissions.checkDataColumnPermissions(
          Dashboard,
          write(),
          ownerProps({ ...SERVER_ADMIN, ...onPlan(PlanType.Free) }),
          DatabaseRequestType.Create,
        );
      }),
    ).toBeNull();

    const refusal: unknown = errorOf(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Dashboard,
        write(),
        ownerProps(onPlan(PlanType.Free)),
        DatabaseRequestType.Create,
      );
    });

    expect(refusal).toBeInstanceOf(PaymentRequiredException);
  });

  test("an analytics table's plan (session replays need Growth)", () => {
    expect(
      errorOf(() => {
        AnalyticsModelPermission.checkCreatePermissions(
          RumSession,
          new RumSession(),
          ownerProps({ ...SERVER_ADMIN, ...onPlan(PlanType.Free) }),
        );
      }),
    ).toBeNull();

    expect(
      errorOf(() => {
        AnalyticsModelPermission.checkCreatePermissions(
          RumSession,
          new RumSession(),
          ownerProps(onPlan(PlanType.Free)),
        );
      }),
    ).toBeInstanceOf(PaymentRequiredException);
  });

  test("a server admin who is no longer one is held to the plan like anyone else", () => {
    const formerAdmin: DatabaseCommonInteractionProps = ownerProps({
      isMasterAdmin: false,
      ...onPlan(PlanType.Free),
    });

    expect(
      errorOf(() => {
        BillingPermissions.checkFeatureIsOnPlan(
          Label,
          formerAdmin,
          DatabaseRequestType.Create,
        );
      }),
    ).toBeInstanceOf(PaymentRequiredException);
  });

  test("on the plan, a member passes the same checks", () => {
    expect(
      errorOf(() => {
        BillingPermissions.checkFeatureIsOnPlan(
          Label,
          ownerProps(ON_HIGHEST_PLAN),
          DatabaseRequestType.Create,
        );
      }),
    ).toBeNull();
  });
});

describe("the CRUD create path follows the same rule", () => {
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

  test("a server admin creates what the project's plan does not include, and no plan is read", async () => {
    await expect(
      labelService().create({
        data: newLabel(),
        props: ownerProps(SERVER_ADMIN),
      }),
    ).rejects.toBeInstanceOf(PastTheChecks);

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });

  test("a member on that plan is refused with the plan's name", async () => {
    await expect(
      labelService().create({ data: newLabel(), props: ownerProps() }),
    ).rejects.toThrow("Please upgrade your plan to Growth");
  });

  test("with billing off, both create, and no plan is read", async () => {
    setTestBillingEnabled(false);

    for (const props of [ownerProps(SERVER_ADMIN), ownerProps()]) {
      await expect(
        labelService().create({ data: newLabel(), props: props }),
      ).rejects.toBeInstanceOf(PastTheChecks);
    }

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });
});
