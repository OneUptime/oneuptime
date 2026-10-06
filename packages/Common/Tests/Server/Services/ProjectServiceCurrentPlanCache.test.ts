import ProjectService, {
  CurrentPlan,
  ProjectService as ProjectServiceClass,
} from "../../../Server/Services/ProjectService";
import BillingService from "../../../Server/Services/BillingService";
import PlanDowngradeOwnerNotice from "../../../Server/Utils/Billing/PlanDowngradeOwnerNotice";
import Project from "../../../Models/DatabaseModels/Project";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
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

  // changePlan announces every plan change on this webhook: never in a test.
  mocked["NotificationSlackWebhookOnSubscriptionUpdate"] = "";

  return mocked;
});

/*
 * A project's plan is read once a minute per server (ProjectService.
 * getCurrentPlan), and what the project's API keys and SCIM connections may
 * do turns on it (PlanCutoffCredentialAccess). So how soon a downgrade or an
 * upgrade takes effect is this cache: at once on the server that made the
 * change - changePlan drops the entry - and within the cache's minute on
 * every other server.
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
  "7e000000-0000-4000-8000-000000000001",
);

const START: number = new Date("2026-10-06T12:00:00.000Z").getTime();

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

  setTestBillingEnabled(false);
});

// The project row: what the database holds, changed by the updates below.
let stored: Record<string, unknown>;
let now: number;
let findOneById: ReturnType<typeof getJestSpyOn>;
let notifyIfStopped: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  setTestBillingEnabled(true);

  now = START;
  getJestSpyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  stored = {
    paymentProviderPlanId: "price_growth_month",
    paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
    paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Active,
    paymentProviderCustomerId: "cus_1",
    paymentProviderSubscriptionId: "sub_1",
    paymentProviderMeteredSubscriptionId: "sub_metered_1",
    paymentProviderSubscriptionSeats: 3,
    trialEndsAt: OneUptimeDate.getSomeDaysAgo(30),
  };

  findOneById = getJestSpyOn(ProjectService, "findOneById").mockImplementation(
    async (): Promise<Project> => {
      const project: Project = new Project();
      project._id = PROJECT_ID.toString();
      Object.assign(project, stored);
      return project;
    },
  );

  getJestSpyOn(ProjectService, "updateOneById").mockImplementation(
    async (data: unknown): Promise<void> => {
      Object.assign(stored, (data as { data: Record<string, unknown> }).data);
    },
  );

  getJestSpyOn(BillingService, "hasPaymentMethods").mockResolvedValue(true);
  getJestSpyOn(BillingService, "changePlan").mockResolvedValue({
    subscriptionId: "sub_2",
    meteredSubscriptionId: "sub_metered_2",
    subscriptionIdsPendingCancellation: [],
  });
  getJestSpyOn(BillingService, "getSubscriptionStatus").mockResolvedValue(
    SubscriptionStatus.Active,
  );

  notifyIfStopped = getJestSpyOn(
    PlanDowngradeOwnerNotice,
    "notifyIfStopped",
  ).mockResolvedValue(undefined);

  ProjectService.forgetCurrentPlan(PROJECT_ID);
});

afterEach(() => {
  ProjectService.forgetCurrentPlan(PROJECT_ID);
  jest.restoreAllMocks();
});

const readPlan: () => Promise<PlanType | null> =
  async (): Promise<PlanType | null> => {
    const plan: CurrentPlan = await ProjectService.getCurrentPlan(PROJECT_ID);
    return plan.plan;
  };

describe("a project's plan, cached on each server", () => {
  test("is read once and served from the cache within the minute", async () => {
    expect(await readPlan()).toBe(PlanType.Growth);
    expect(await readPlan()).toBe(PlanType.Growth);

    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("is cached for a minute", () => {
    expect(ProjectServiceClass.CURRENT_PLAN_CACHE_TTL_MS).toBe(60_000);
  });

  /*
   * Another server's change reaches this one when its entry expires: the
   * plan written elsewhere is read on the first request after the minute.
   */
  test("expires after the minute, and a change made elsewhere is read then", async () => {
    expect(await readPlan()).toBe(PlanType.Growth);

    // Another server moves the project to Free.
    stored["paymentProviderPlanId"] = "price_free_month";

    now = START + ProjectServiceClass.CURRENT_PLAN_CACHE_TTL_MS - 1;
    expect(await readPlan()).toBe(PlanType.Growth);
    expect(findOneById).toHaveBeenCalledTimes(1);

    now = START + ProjectServiceClass.CURRENT_PLAN_CACHE_TTL_MS + 1;
    expect(await readPlan()).toBe(PlanType.Free);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("is dropped at once by forgetCurrentPlan", async () => {
    expect(await readPlan()).toBe(PlanType.Growth);

    stored["paymentProviderPlanId"] = "price_scale_month";
    ProjectService.forgetCurrentPlan(PROJECT_ID);

    expect(await readPlan()).toBe(PlanType.Scale);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  /*
   * A read under way when the plan changes may hold the old plan. It is
   * answered, but not cached: cached, it would put the old plan back for
   * another minute, after forgetCurrentPlan had dropped it.
   */
  test("a read that was under way when the plan changed is not cached", async () => {
    let finishRead: () => void = (): void => {};

    findOneById.mockImplementationOnce(async (): Promise<Project> => {
      // What the database held when the read started: the old plan.
      const project: Project = new Project();
      project._id = PROJECT_ID.toString();
      Object.assign(project, stored);

      await new Promise<void>((resolve: () => void) => {
        finishRead = resolve;
      });

      return project;
    });

    const readUnderWay: Promise<PlanType | null> = readPlan();

    // The plan changes on this server while that read is under way.
    stored["paymentProviderPlanId"] = "price_free_month";
    ProjectService.forgetCurrentPlan(PROJECT_ID);

    finishRead();
    expect(await readUnderWay).toBe(PlanType.Growth);

    // The next request reads the plan again, and gets the new one.
    expect(await readPlan()).toBe(PlanType.Free);
    expect(findOneById).toHaveBeenCalledTimes(2);

    // And that read, which no change raced, is cached as before.
    expect(await readPlan()).toBe(PlanType.Free);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  test("forgets only the project it is asked to", async () => {
    const otherProjectId: ObjectID = new ObjectID(
      "7e000000-0000-4000-8000-000000000002",
    );

    await readPlan();
    await ProjectService.getCurrentPlan(otherProjectId);
    expect(findOneById).toHaveBeenCalledTimes(2);

    ProjectService.forgetCurrentPlan(otherProjectId);

    await readPlan();
    await ProjectService.getCurrentPlan(otherProjectId);
    expect(findOneById).toHaveBeenCalledTimes(3);

    ProjectService.forgetCurrentPlan(otherProjectId);
  });
});

describe("a plan change on this server", () => {
  test("a downgrade applies to the very next request", async () => {
    expect(await readPlan()).toBe(PlanType.Growth);

    await ProjectService.changePlan({
      projectId: PROJECT_ID,
      paymentProviderPlanId: "price_free_month",
    });

    expect(await readPlan()).toBe(PlanType.Free);
  });

  test("an upgrade applies to the very next request", async () => {
    stored["paymentProviderPlanId"] = "price_free_month";
    expect(await readPlan()).toBe(PlanType.Free);

    await ProjectService.changePlan({
      projectId: PROJECT_ID,
      paymentProviderPlanId: "price_growth_year",
    });

    expect(await readPlan()).toBe(PlanType.Growth);
  });

  test("tells the owners what the move stopped, with the old plan and the new one", async () => {
    await ProjectService.changePlan({
      projectId: PROJECT_ID,
      paymentProviderPlanId: "price_free_month",
    });

    expect(notifyIfStopped).toHaveBeenCalledTimes(1);

    const notice: {
      projectId: ObjectID;
      fromPlanId: string;
      toPlanId: string;
    } = notifyIfStopped.mock.calls[0]![0] as {
      projectId: ObjectID;
      fromPlanId: string;
      toPlanId: string;
    };

    expect(String(notice.projectId)).toBe(PROJECT_ID.toString());
    expect(notice.fromPlanId).toBe("price_growth_month");
    expect(notice.toPlanId).toBe("price_free_month");
  });

  test("a plan change that does not go through tells nobody and keeps the cache", async () => {
    getJestSpyOn(BillingService, "hasPaymentMethods").mockResolvedValue(false);

    expect(await readPlan()).toBe(PlanType.Growth);

    await expect(
      ProjectService.changePlan({
        projectId: PROJECT_ID,
        paymentProviderPlanId: "price_free_month",
      }),
    ).rejects.toThrow();

    expect(notifyIfStopped).not.toHaveBeenCalled();
    expect(await readPlan()).toBe(PlanType.Growth);
  });
});

describe("a reactivated subscription", () => {
  test("applies its new status to the very next request", async () => {
    stored["paymentProviderSubscriptionStatus"] = SubscriptionStatus.Canceled;

    expect(
      (await ProjectService.getCurrentPlan(PROJECT_ID)).isSubscriptionUnpaid,
    ).toBe(true);

    await ProjectService.reactiveSubscription(PROJECT_ID);

    expect(
      (await ProjectService.getCurrentPlan(PROJECT_ID)).isSubscriptionUnpaid,
    ).toBe(false);
  });
});
