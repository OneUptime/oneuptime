import ProjectService, {
  CurrentPlan,
} from "../../../Server/Services/ProjectService";
import StatusPageService, {
  FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE,
  UNPAID_SUBSCRIPTION_STATUS_PAGE_MESSAGE,
} from "../../../Server/Services/StatusPageService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { SpyInstance } from "jest-mock";
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

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  // The Free plan's allowance, pinned at its default: an install can change it.
  Object.defineProperty(mocked, "AllowedStatusPageCountInFreePlan", {
    enumerable: true,
    value: 1,
  });

  return mocked;
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * THE STATUS PAGES A PROJECT'S PLAN ALLOWS, ASKED IN ONE PLACE (#7250).
 *
 * A status page created from the Dashboard, the API or Ask AI is refused
 * by StatusPageService.onBeforeCreate when the project's subscription is
 * unpaid, or when OneUptime Cloud's Free plan has its one status page.
 * Ask AI's publish_status_page asks the same question before its approval
 * card (getCreateRefusal), so the card never promises a page the plan
 * refuses once approved. These pin the answer, and that the create hook
 * refuses with it exactly as it did before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7250aaaa-0000-4000-8000-000000000001",
);

function readsPlan(data: {
  plan: PlanType | null;
  isSubscriptionUnpaid?: boolean;
}): SpyInstance<typeof ProjectService.getCurrentPlan> {
  return jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: data.plan,
    isSubscriptionUnpaid: Boolean(data.isSubscriptionUnpaid),
  } as CurrentPlan);
}

function hasStatusPages(
  count: number,
): SpyInstance<typeof StatusPageService.countBy> {
  return jest
    .spyOn(StatusPageService, "countBy")
    .mockResolvedValue(new PositiveNumber(count));
}

beforeEach(() => {
  setTestBillingEnabled(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("the status pages a project's plan allows", () => {
  test("the Free plan with its one status page refuses another, in the plan's own sentence", async () => {
    readsPlan({ plan: PlanType.Free });
    const count: SpyInstance<typeof StatusPageService.countBy> =
      hasStatusPages(1);

    await expect(
      StatusPageService.getCreateRefusal({ projectId: PROJECT_ID }),
    ).resolves.toBe(FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE);

    // Every status page of the project, counted as OneUptime.
    expect(count).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("the Free plan with none allows its first, and no more than one at once", async () => {
    readsPlan({ plan: PlanType.Free });
    hasStatusPages(0);

    await expect(
      StatusPageService.getCreateRefusal({ projectId: PROJECT_ID }),
    ).resolves.toBeNull();
    // A plan of Ask AI's that publishes two pages asks for both.
    await expect(
      StatusPageService.getCreateRefusal({ projectId: PROJECT_ID, adding: 2 }),
    ).resolves.toBe(FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE);
  });

  test("an unpaid subscription adds none, on any plan, and says what to pay", async () => {
    for (const plan of [PlanType.Free, PlanType.Growth]) {
      readsPlan({ plan: plan, isSubscriptionUnpaid: true });
      const count: SpyInstance<typeof StatusPageService.countBy> =
        hasStatusPages(0);

      await expect(
        StatusPageService.getCreateRefusal({ projectId: PROJECT_ID }),
      ).resolves.toBe(UNPAID_SUBSCRIPTION_STATUS_PAGE_MESSAGE);
      expect(count).not.toHaveBeenCalled();

      jest.restoreAllMocks();
    }
  });

  test("a paid plan has no such limit", async () => {
    for (const plan of [PlanType.Growth, PlanType.Scale, PlanType.Enterprise]) {
      readsPlan({ plan: plan });
      hasStatusPages(40);

      await expect(
        StatusPageService.getCreateRefusal({ projectId: PROJECT_ID }),
      ).resolves.toBeNull();

      jest.restoreAllMocks();
    }
  });

  test("an install without billing has no plans, and reads none", async () => {
    setTestBillingEnabled(false);
    const plan: SpyInstance<typeof ProjectService.getCurrentPlan> = readsPlan({
      plan: PlanType.Free,
      isSubscriptionUnpaid: true,
    });

    await expect(
      StatusPageService.getCreateRefusal({ projectId: PROJECT_ID }),
    ).resolves.toBeNull();
    expect(plan).not.toHaveBeenCalled();
  });

  test("adding none is never refused", async () => {
    const plan: SpyInstance<typeof ProjectService.getCurrentPlan> = readsPlan({
      plan: PlanType.Free,
    });
    hasStatusPages(5);

    await expect(
      StatusPageService.getCreateRefusal({ projectId: PROJECT_ID, adding: 0 }),
    ).resolves.toBeNull();
    expect(plan).not.toHaveBeenCalled();
  });
});

describe("a status page's create refuses exactly as before", () => {
  interface CreateHooks {
    onBeforeCreate: (createBy: CreateBy<StatusPage>) => Promise<unknown>;
  }

  function createBy(): CreateBy<StatusPage> {
    const statusPage: StatusPage = new StatusPage();
    statusPage.name = "Public status";
    statusPage.projectId = PROJECT_ID;

    return {
      data: statusPage,
      props: { isRoot: true },
    } as unknown as CreateBy<StatusPage>;
  }

  test.each([
    {
      name: "the Free plan's one status page",
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
      count: 1,
      refusal: FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE,
    },
    {
      name: "an unpaid subscription",
      plan: PlanType.Growth,
      isSubscriptionUnpaid: true,
      count: 0,
      refusal: UNPAID_SUBSCRIPTION_STATUS_PAGE_MESSAGE,
    },
  ])(
    "$name: refused with the same sentence getCreateRefusal says",
    async (row: {
      plan: PlanType;
      isSubscriptionUnpaid: boolean;
      count: number;
      refusal: string;
    }) => {
      readsPlan({
        plan: row.plan,
        isSubscriptionUnpaid: row.isSubscriptionUnpaid,
      });
      hasStatusPages(row.count);

      await expect(
        (StatusPageService as unknown as CreateHooks).onBeforeCreate(
          createBy(),
        ),
      ).rejects.toThrow(new BadDataException(row.refusal));
    },
  );

  test("the sentences are the ones the create always said", () => {
    expect(FREE_PLAN_STATUS_PAGE_LIMIT_MESSAGE).toBe(
      "You have reached the maximum allowed status page limit for the free plan. Please upgrade your plan to add more status pages.",
    );
    expect(UNPAID_SUBSCRIPTION_STATUS_PAGE_MESSAGE).toBe(
      "Your subscription is unpaid. Please update your payment method and pay all the outstanding invoices to add more status pages.",
    );
  });
});
