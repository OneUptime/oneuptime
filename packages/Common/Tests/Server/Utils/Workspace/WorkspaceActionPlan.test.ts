import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CallerPlan from "../../../../Server/Utils/Billing/CallerPlan";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
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

/*
 * THE PROPS A CHAT ACTS WITH CARRY THE PROJECT'S PLAN, AS A DASHBOARD
 * REQUEST'S DO.
 *
 * A customer on OneUptime Cloud: `/oneuptime page @nitin test` answered
 * "Could not page: OneUptime could not confirm which plan this project is
 * on, so nothing was changed." - every time. The member's props were built
 * without the plan, and the page's own check (OnCallPageService, before it
 * creates anything) refuses props that carry none wherever a plan decides,
 * never reading "no plan" as any plan. getProjectMemberProps now gives them
 * the project's plan, as CommonAPI gives an API request's.
 */
describe("WorkspaceActionAuthorization.getProjectMemberProps on the project's plan", () => {
  beforeEach(() => {
    const membership: TeamMember = new TeamMember();
    membership.teamId = ObjectID.generate();

    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([membership]);
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    // Nor a blocked person (WorkspaceActionAuthorization asks that too).
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(
        chatMemberProps().userTenantAccessPermission![projectId.toString()]!,
      );
  });

  test("billing on: the props carry the project's plan, read once", async () => {
    projectPlan = PlanType.Growth;

    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      });

    expect(props.currentPlan).toBe(PlanType.Growth);
    expect(props.isSubscriptionUnpaid).toBe(false);
    expect(currentPlanSpy).toHaveBeenCalledTimes(1);
    expect(currentPlanSpy).toHaveBeenCalledWith(projectId);
  });

  test("billing on: a check made before anything is created - as a page's is - passes on the plan that includes it", async () => {
    projectPlan = PlanType.Growth;

    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      });

    expect(() => {
      ModelPermission.checkTableWritePermission(
        OnCallDutyPolicyExecutionLog,
        props,
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test("billing on: the same check is refused with the plan it needs below that plan, never 'could not confirm'", async () => {
    projectPlan = PlanType.Free;

    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      });

    let refusal: unknown = null;

    try {
      ModelPermission.checkTableWritePermission(
        OnCallDutyPolicyExecutionLog,
        props,
        DatabaseRequestType.Create,
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(PaymentRequiredException);
    expect((refusal as Error).message).toBe(
      "Please upgrade your plan to Growth to access this feature",
    );
  });

  test("before: props without the plan were refused by that check as 'could not confirm which plan'", () => {
    // The props getProjectMemberProps used to hand out, with billing on.
    let refusal: unknown = null;

    try {
      ModelPermission.checkTableWritePermission(
        OnCallDutyPolicyExecutionLog,
        chatMemberProps(),
        DatabaseRequestType.Create,
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(CallerPlan.PLAN_UNKNOWN_MESSAGE);
  });

  test("billing on: a plan that cannot be read refuses the action with that sentence, never 'any plan'", async () => {
    currentPlanSpy.mockImplementation((async () => {
      throw new BadDataException("Project does not have any plans");
    }) as never);

    const refusal: unknown =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      }).catch((error: unknown): unknown => {
        return error;
      });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(CallerPlan.PLAN_UNKNOWN_MESSAGE);
  });

  test("billing off: no plan is read, and the props carry none", async () => {
    setTestBillingEnabled(false);

    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      });

    expect(props.currentPlan).toBeUndefined();
    expect(currentPlanSpy).not.toHaveBeenCalled();
    expect(() => {
      ModelPermission.checkTableWritePermission(
        OnCallDutyPolicyExecutionLog,
        props,
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test("not a member: refused as before, and no plan is read for them", async () => {
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);

    await expect(
      WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      }),
    ).rejects.toThrow(
      WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    );
    expect(currentPlanSpy).not.toHaveBeenCalled();
  });
});
