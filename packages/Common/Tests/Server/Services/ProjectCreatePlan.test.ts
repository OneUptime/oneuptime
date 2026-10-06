import DatabaseConfig from "../../../Server/DatabaseConfig";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
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
 * A new project's own settings are checked against the plan it is created
 * on.
 *
 * A project holds settings a plan sells - its audit logs, sold on
 * Enterprise - and they need that plan when the project is created with
 * them, as when they are changed later (@ColumnBillingAccessControl, the
 * create's column check). Every other record is checked against its
 * project's plan, which the request carries (the tenant header). A project
 * being created has no plan yet but the one it is being created on, so
 * ProjectService.onBeforeCreate hands the create's column check props on
 * that plan (getNewProjectProps):
 *
 *   - not the plan of the project the request was sent from: a request sent
 *     from an Enterprise project does not let a new Free project start with
 *     audit logs on, and one sent from a Free project does not stop a new
 *     Enterprise project from starting with them;
 *   - not none, when the request was sent from no project at all (a first
 *     project), which used to ask no plan;
 *   - the request's own props are left as they were.
 *
 * Settings at their defaults - every project the dashboard creates - are
 * created on every plan, and with billing off nothing changes.
 *
 * Runs the real hook and the real DatabaseService create path; only the
 * user lookup, the project-creation switch, the duplicate-name count and
 * the repository are stubbed. Nothing is saved: the repository's save
 * answers REACHED_SAVE, which is how a create that passed every check
 * shows here.
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

const PLAN_IDS: ReadonlyArray<[string, PlanType]> = [
  ["price_free_month", PlanType.Free],
  ["price_free_year", PlanType.Free],
  ["price_growth_month", PlanType.Growth],
  ["price_growth_year", PlanType.Growth],
  ["price_scale_month", PlanType.Scale],
  ["price_scale_year", PlanType.Scale],
  ["price_enterprise_month", PlanType.Enterprise],
  ["price_enterprise_year", PlanType.Enterprise],
];

const ENTERPRISE_REFUSAL: string =
  "Please upgrade your plan to Enterprise to access this feature";

const REACHED_SAVE: string = "REACHED_SAVE";

const USER_ID: ObjectID = new ObjectID("5d000000-0000-4000-8000-000000000001");
const SENDING_PROJECT_ID: ObjectID = new ObjectID(
  "5d000000-0000-4000-8000-000000000002",
);

/*
 * A signed-in dashboard user creating a project. `sentFrom` is the project
 * the request was sent from (its tenant header) and the plan that project
 * is on, as CommonAPI reads them; absent for a request sent from no
 * project.
 */
const creator: (sentFrom?: {
  plan: PlanType;
}) => DatabaseCommonInteractionProps = (sentFrom?: {
  plan: PlanType;
}): DatabaseCommonInteractionProps => {
  const props: DatabaseCommonInteractionProps = {
    userId: USER_ID,
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [],
      _type: "UserGlobalAccessPermission",
    },
  } as DatabaseCommonInteractionProps;

  if (sentFrom) {
    props.tenantId = SENDING_PROJECT_ID;
    props.currentPlan = sentFrom.plan;
    props.isSubscriptionUnpaid = false;
  }

  return props;
};

type ProjectSettings = Partial<
  Pick<
    Project,
    | "enableAuditLogs"
    | "storeSystemEventsInAuditLogs"
    | "auditLogsRetentionInDays"
  >
>;

const newProject: (planId: string, settings?: ProjectSettings) => Project = (
  planId: string,
  settings?: ProjectSettings,
): Project => {
  const project: Project = new Project();
  project.name = "Acme";
  project.paymentProviderPlanId = planId;

  for (const [column, value] of Object.entries(settings || {})) {
    project.setColumnValue(column, value);
  }

  return project;
};

const runOnBeforeCreate: (
  project: Project,
  props: DatabaseCommonInteractionProps,
) => Promise<CreateBy<Project>> = async (
  project: Project,
  props: DatabaseCommonInteractionProps,
): Promise<CreateBy<Project>> => {
  const result: OnCreate<Project> = await (
    ProjectService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<Project>,
      ) => Promise<OnCreate<Project>>;
    }
  ).onBeforeCreate({
    data: project,
    props,
  } as CreateBy<Project>);

  return result.createBy;
};

// The create's column check, as it runs after the hook.
const checkColumns: (createBy: CreateBy<Project>) => string = (
  createBy: CreateBy<Project>,
): string => {
  try {
    ColumnPermissions.checkDataColumnPermissions(
      Project,
      createBy.data,
      createBy.props,
      DatabaseRequestType.Create,
    );

    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return err.message;
    }

    throw err;
  }
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

const savedPlanEnvironment: Record<string, string | undefined> = {};

let save: Mock<() => Promise<never>>;

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

  getJestSpyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  getJestSpyOn(UserService, "findOneById").mockResolvedValue(
    new User() as never,
  );
  getJestSpyOn(
    DatabaseConfig,
    "shouldDisableUserProjectCreation",
  ).mockResolvedValue(false as never);
  getJestSpyOn(ProjectService, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );

  save = jest.fn(async (): Promise<never> => {
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

describe("ProjectService.getNewProjectProps", () => {
  test("is the caller's props on the new project's plan, with no unpaid subscription", () => {
    const props: DatabaseCommonInteractionProps = creator({
      plan: PlanType.Enterprise,
    });
    props.isSubscriptionUnpaid = true;

    const result: DatabaseCommonInteractionProps =
      ProjectService.getNewProjectProps(props, PlanType.Free);

    expect(result).toEqual({
      ...props,
      currentPlan: PlanType.Free,
      isSubscriptionUnpaid: false,
    });
    expect(result.userId).toEqual(USER_ID);
    expect(result.userGlobalAccessPermission).toBe(
      props.userGlobalAccessPermission,
    );
  });

  test("is a copy: the request's own props keep the plan of the project it was sent from", () => {
    const props: DatabaseCommonInteractionProps = creator({
      plan: PlanType.Scale,
    });

    const result: DatabaseCommonInteractionProps =
      ProjectService.getNewProjectProps(props, PlanType.Growth);

    expect(result).not.toBe(props);
    expect(props.currentPlan).toBe(PlanType.Scale);
    expect(props.tenantId).toEqual(SENDING_PROJECT_ID);
    expect(result.currentPlan).toBe(PlanType.Growth);
  });
});

describe("on OneUptime Cloud (billing on), ProjectService.onBeforeCreate", () => {
  test.each(PLAN_IDS)(
    "a project created on %s is checked against its own plan (%s)",
    async (planId: string, plan: PlanType) => {
      const createBy: CreateBy<Project> = await runOnBeforeCreate(
        newProject(planId),
        creator(),
      );

      expect(createBy.data.planName).toBe(plan);
      expect(createBy.props.currentPlan).toBe(plan);
      expect(createBy.props.isSubscriptionUnpaid).toBe(false);
      expect(createBy.props.userId).toEqual(USER_ID);
    },
  );

  test.each([
    PlanType.Free,
    PlanType.Growth,
    PlanType.Scale,
    PlanType.Enterprise,
  ])(
    "a request sent from a project on %s: the new project's plan replaces it, and the request's props are left as they were",
    async (sendingPlan: PlanType) => {
      const props: DatabaseCommonInteractionProps = creator({
        plan: sendingPlan,
      });

      const createBy: CreateBy<Project> = await runOnBeforeCreate(
        newProject("price_growth_month"),
        props,
      );

      expect(createBy.props.currentPlan).toBe(PlanType.Growth);
      expect(createBy.props).not.toBe(props);
      expect(props.currentPlan).toBe(sendingPlan);
    },
  );
});

describe("on OneUptime Cloud (billing on), the create's column check after the hook", () => {
  test.each([
    ["price_free_month", PlanType.Free],
    ["price_growth_year", PlanType.Growth],
    ["price_scale_month", PlanType.Scale],
  ] as Array<[string, PlanType]>)(
    "a project created on %s (%s) with audit logs on is refused, naming Enterprise",
    async (planId: string) => {
      for (const settings of [
        { enableAuditLogs: true },
        { storeSystemEventsInAuditLogs: true },
        { auditLogsRetentionInDays: 90 },
      ] as Array<ProjectSettings>) {
        expect([
          settings,
          checkColumns(
            await runOnBeforeCreate(newProject(planId, settings), creator()),
          ),
        ]).toEqual([settings, ENTERPRISE_REFUSAL]);
      }
    },
  );

  test("a project created on Enterprise with audit logs on, longer retention and system events is allowed", async () => {
    expect(
      checkColumns(
        await runOnBeforeCreate(
          newProject("price_enterprise_month", {
            enableAuditLogs: true,
            storeSystemEventsInAuditLogs: true,
            auditLogsRetentionInDays: 180,
          }),
          creator(),
        ),
      ),
    ).toBe("allowed");
  });

  test.each(PLAN_IDS)(
    "a project created on %s with its audit settings at their defaults is allowed",
    async (planId: string) => {
      expect(
        checkColumns(
          await runOnBeforeCreate(
            newProject(planId, {
              enableAuditLogs: false,
              storeSystemEventsInAuditLogs: false,
              auditLogsRetentionInDays: 7,
            }),
            creator(),
          ),
        ),
      ).toBe("allowed");
    },
  );

  test("sent from an Enterprise project, a new Free project with audit logs on is still refused", async () => {
    expect(
      checkColumns(
        await runOnBeforeCreate(
          newProject("price_free_month", { enableAuditLogs: true }),
          creator({ plan: PlanType.Enterprise }),
        ),
      ),
    ).toBe(ENTERPRISE_REFUSAL);
  });

  test("sent from a Free project, a new Enterprise project with audit logs on is allowed", async () => {
    expect(
      checkColumns(
        await runOnBeforeCreate(
          newProject("price_enterprise_year", { enableAuditLogs: true }),
          creator({ plan: PlanType.Free }),
        ),
      ),
    ).toBe("allowed");
  });

  test("negative control: without the hook's props, a request sent from no project carries no plan, and the column check asks none", () => {
    const project: Project = newProject("price_free_month", {
      enableAuditLogs: true,
    });

    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        Project,
        project,
        creator(),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });
});

describe("on OneUptime Cloud (billing on), through ProjectService.create", () => {
  test("a project the dashboard creates (a name and a plan) is created on Free", async () => {
    expect(await createProject(newProject("price_free_month"), creator())).toBe(
      REACHED_SAVE,
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("a Free project created with audit logs on is refused, and nothing is saved", async () => {
    expect(
      await createProject(
        newProject("price_free_month", { enableAuditLogs: true }),
        creator(),
      ),
    ).toBe(ENTERPRISE_REFUSAL);
    expect(save).not.toHaveBeenCalled();
  });

  test("sent from an Enterprise project, a Free project created with audit logs on is refused, and nothing is saved", async () => {
    expect(
      await createProject(
        newProject("price_free_year", {
          enableAuditLogs: true,
          storeSystemEventsInAuditLogs: true,
        }),
        creator({ plan: PlanType.Enterprise }),
      ),
    ).toBe(ENTERPRISE_REFUSAL);
    expect(save).not.toHaveBeenCalled();
  });

  test("an Enterprise project created with audit logs on is created, wherever the request was sent from", async () => {
    for (const props of [
      creator(),
      creator({ plan: PlanType.Free }),
      creator({ plan: PlanType.Enterprise }),
    ]) {
      expect(
        await createProject(
          newProject("price_enterprise_month", { enableAuditLogs: true }),
          props,
        ),
      ).toBe(REACHED_SAVE);
    }

    expect(save).toHaveBeenCalledTimes(3);
  });
});

describe("on a self-hosted install (billing off)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test("the hook leaves the props as they were: no plan is asked", async () => {
    const props: DatabaseCommonInteractionProps = creator();

    const createBy: CreateBy<Project> = await runOnBeforeCreate(
      newProject("price_free_month"),
      props,
    );

    expect(createBy.props).toBe(props);
    expect(createBy.props.currentPlan).toBeUndefined();
  });

  test("the column check asks no plan for audit settings, whatever the props carry", () => {
    for (const plan of [PlanType.Free, PlanType.Growth]) {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          Project,
          newProject("price_free_month", {
            enableAuditLogs: true,
            auditLogsRetentionInDays: 90,
          }),
          creator({ plan }),
          DatabaseRequestType.Create,
        );
      }).not.toThrow();
    }
  });
});
