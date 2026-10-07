import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ProjectService from "../../../../Server/Services/ProjectService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
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
 * A CHAT ACTION IS HELD TO THE PROJECT'S PLAN, AS THE DASHBOARD IS.
 *
 * Slack and Microsoft Teams actions build a member's props themselves
 * (WorkspaceActionAuthorization.getProjectMemberProps), without the plan an
 * API request carries. Their create check used to read that as "every
 * plan", so paging an on-call policy from chat worked on a plan that does
 * not include on-call. Now the check reads the project's plan where a plan
 * decides the create (CallerPlan.withPlanFor), and refuses with the plan's
 * name below it - the answer the dashboard gives the same person.
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

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

// A project owner in chat: as getProjectMemberProps builds it, with no plan.
function chatMemberProps(): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTeamIds: [],
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectOwner,
            isBlockPermission: false,
            labelIds: [],
          },
        ],
      },
    },
  };
}

// The spy getJestSpyOn hands back.
type SpyInstance = ReturnType<typeof getJestSpyOn>;

let projectPlan: PlanType = PlanType.Free;
let currentPlanSpy: SpyInstance;
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
  projectPlan = PlanType.Free;

  currentPlanSpy = getJestSpyOn(ProjectService, "getCurrentPlan");
  currentPlanSpy.mockImplementation((async () => {
    return { plan: projectPlan, isSubscriptionUnpaid: false };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("WorkspaceActionAuthorization.assertCanCreate on the project's plan", () => {
  test("paging an on-call policy below the plan that includes on-call is refused with the plan's name", async () => {
    const refusal: unknown = await WorkspaceActionAuthorization.assertCanCreate(
      {
        props: chatMemberProps(),
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this incident",
      },
    ).catch((error: unknown): unknown => {
      return error;
    });

    expect(refusal).toBeInstanceOf(PaymentRequiredException);
    expect((refusal as Error).message).toBe(
      "Please upgrade your plan to Growth to access this feature",
    );
    expect(currentPlanSpy).toHaveBeenCalledWith(projectId);
  });

  test("on a plan that includes on-call, it is allowed", async () => {
    projectPlan = PlanType.Growth;

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: chatMemberProps(),
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this incident",
      }),
    ).resolves.toBeUndefined();
  });

  test("a create no plan decides reads no plan", async () => {
    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: chatMemberProps(),
        modelType: IncidentInternalNote,
        action: "add a private note to this incident",
      }),
    ).resolves.toBeUndefined();

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });

  test("nothing is read or refused with billing off", async () => {
    setTestBillingEnabled(false);

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: chatMemberProps(),
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this incident",
      }),
    ).resolves.toBeUndefined();

    expect(currentPlanSpy).not.toHaveBeenCalled();
  });
});
