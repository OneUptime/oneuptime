import OnCallPageService, {
  OnCallPageRecordType,
} from "../../../Server/Services/OnCallPageService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import CallerPlan from "../../../Server/Utils/Billing/CallerPlan";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import User from "../../../Models/DatabaseModels/User";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
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

jest.mock("../../../Server/Utils/Logger");

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
 * A PAGE IS CHECKED ON THE CALLER'S PLAN - READ HERE WHEN THEIR PROPS DO NOT
 * CARRY IT.
 *
 * OnCallPageService.page asks, before it reads or creates anything, whether
 * the caller may start an on-call run - a check that, on OneUptime Cloud,
 * holds them to the project's plan and refuses props that carry none. Props
 * built outside an API request - a chat's - came without the plan, and every
 * `/oneuptime page` on Cloud was refused: "OneUptime could not confirm which
 * plan this project is on, so nothing was changed." The page now reads the
 * plan for its own check, as the create itself does (CallerPlan.withPlanFor).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000f1",
);
const JANE: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000f1");
const NITIN: ObjectID = new ObjectID("20000000-0000-4000-8000-0000000000f2");

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

// A member's props as a chat builds them: no plan carried.
function chatMember(): DatabaseCommonInteractionProps {
  return {
    userId: NITIN,
    tenantId: PROJECT_ID,
    userTeamIds: [],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectMember,
            isBlockPermission: false,
            labelIds: [],
          },
        ],
      },
    },
  };
}

function janeUser(): User {
  const user: User = new User();
  user.id = JANE;
  return user;
}

describe("OnCallPageService.page on the caller's plan", () => {
  const savedPlanEnvironment: Record<string, string | undefined> = {};
  let projectPlan: PlanType;
  let planReads: number;
  let isPlanUnreadable: boolean;
  // The props each step after the check was handed.
  let resolvedWith: Array<DatabaseCommonInteractionProps>;
  let directPages: number;

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
    projectPlan = PlanType.Growth;
    planReads = 0;
    isPlanUnreadable = false;
    resolvedWith = [];
    directPages = 0;

    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockImplementation((async () => {
        planReads++;

        if (isPlanUnreadable) {
          throw new BadDataException("Project does not have any plans");
        }

        return { plan: projectPlan, isSubscriptionUnpaid: false };
      }) as never);

    // What the page does after its check, stood in for.
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "checkCallerMayCreate")
      .mockResolvedValue(undefined as never);

    const pageService: Record<string, unknown> =
      OnCallPageService as unknown as Record<string, unknown>;

    jest
      .spyOn(
        pageService as { resolveTargets: () => Promise<unknown> },
        "resolveTargets",
      )
      .mockImplementation((async (request: {
        props: DatabaseCommonInteractionProps;
      }) => {
        resolvedWith.push(request.props);
        return {
          users: [janeUser()],
          teams: [],
          schedules: [],
          policies: [],
          notFound: [],
        };
      }) as never);
    jest
      .spyOn(
        pageService as { resolveRecord: () => Promise<unknown> },
        "resolveRecord",
      )
      .mockResolvedValue({
        type: OnCallPageRecordType.Alert,
        id: ObjectID.generate(),
        label: "Alert #1",
        title: "test",
        url: URL.fromString("https://oneuptime.test/dashboard/alerts/1"),
        isNew: true,
      } as never);
    jest
      .spyOn(OnCallPageService, "waitUntilRecordIsSetUp")
      .mockResolvedValue(undefined);
    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "startDirectPage")
      .mockImplementation((async () => {
        directPages++;
        return {
          executionLogId: ObjectID.generate(),
          outcome: { paged: [], notPaged: [] },
        };
      }) as never);
    jest
      .spyOn(
        pageService as { nameOutcome: () => Promise<unknown> },
        "nameOutcome",
      )
      .mockResolvedValue({ paged: [], notPaged: [] } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setTestBillingEnabled(false);
  });

  function pageJane(
    props: DatabaseCommonInteractionProps,
  ): ReturnType<typeof OnCallPageService.page> {
    return OnCallPageService.page({
      projectId: PROJECT_ID,
      targets: { userIds: [JANE] },
      about: { newAlert: { title: "test" } },
      props: props,
      maxWaitForRecordInMs: 0,
    });
  }

  test("a chat's props, on the plan that includes on-call: the plan is read once, and the page goes out on it", async () => {
    await pageJane(chatMember());

    expect(planReads).toBe(1);
    expect(directPages).toBe(1);
    expect(resolvedWith).toHaveLength(1);
    expect(resolvedWith[0]!.currentPlan).toBe(PlanType.Growth);
    expect(resolvedWith[0]!.userId!.toString()).toBe(NITIN.toString());
  });

  test("the caller's own props object is left as it was", async () => {
    const props: DatabaseCommonInteractionProps = chatMember();

    await pageJane(props);

    expect(props.currentPlan).toBeUndefined();
  });

  test("below that plan: refused with the plan it needs - never 'could not confirm' - before anything is read", async () => {
    projectPlan = PlanType.Free;

    const refusal: unknown = await pageJane(chatMember()).catch(
      (error: unknown): unknown => {
        return error;
      },
    );

    expect(refusal).toBeInstanceOf(PaymentRequiredException);
    expect((refusal as Error).message).toBe(
      "Please upgrade your plan to Growth to access this feature",
    );
    expect(resolvedWith).toEqual([]);
    expect(directPages).toBe(0);
  });

  test("a plan that cannot be read: nothing is paged - never paged on 'any plan'", async () => {
    isPlanUnreadable = true;

    await expect(pageJane(chatMember())).rejects.toBeInstanceOf(
      BadDataException,
    );
    expect(resolvedWith).toEqual([]);
    expect(directPages).toBe(0);
  });

  test("props that carry the plan already: not read again", async () => {
    await pageJane({ ...chatMember(), currentPlan: PlanType.Growth });

    expect(planReads).toBe(0);
    expect(directPages).toBe(1);
  });

  test("billing off: no plan is read, and the page goes out", async () => {
    setTestBillingEnabled(false);

    await pageJane(chatMember());

    expect(planReads).toBe(0);
    expect(directPages).toBe(1);
  });

  test("before: the same check, on props without the plan, refused with 'could not confirm which plan'", () => {
    // What the page's check met for a chat before it read the plan itself.
    let refusal: unknown = null;

    try {
      CallerPlan.assertPlanKnown(chatMember());
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(CallerPlan.PLAN_UNKNOWN_MESSAGE);
  });
});
