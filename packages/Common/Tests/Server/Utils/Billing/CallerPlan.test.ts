import ProjectService from "../../../../Server/Services/ProjectService";
import CallerPlan from "../../../../Server/Utils/Billing/CallerPlan";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE PLAN A CALLER IS HELD TO IS ALWAYS KNOWN (CallerPlan).
 *
 * Every plan check reads the project's plan off the props it is handed. A
 * request through the API carries it (CommonAPI); props built anywhere else -
 * a workflow step, a chat action, one project of a read across projects -
 * used to carry none, and "no plan" read as "every plan". These pin the one
 * place that fills it in, and refuses when it is still missing:
 *
 *   - only props that act in a project, on a server with billing, are held
 *     to a plan: OneUptime itself, a server admin, a read naming no project
 *     and a server without billing are not;
 *   - the plan is read for the project the props name, once, onto a copy -
 *     the caller's own object is never changed;
 *   - one project of a read across projects is read on ITS plan, never on
 *     the plan of the project the request happened to name;
 *   - a plan that cannot be read is an error, and a check that still meets
 *     no plan refuses in plain words.
 */

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

const PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("c1000000-0000-4000-8000-000000000003");

let getCurrentPlan: SpyInstance<typeof ProjectService.getCurrentPlan>;

// The plan each project is on, as ProjectService would read it.
const plans: Map<string, PlanType> = new Map<string, PlanType>();

function memberProps(
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    ...extra,
  };
}

beforeEach(() => {
  setTestBillingEnabled(true);
  plans.clear();
  plans.set(PROJECT_ID.toString(), PlanType.Growth);
  plans.set(OTHER_PROJECT_ID.toString(), PlanType.Free);

  getCurrentPlan = jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockImplementation(async (projectId: ObjectID) => {
      const plan: PlanType | undefined = plans.get(projectId.toString());

      if (!plan) {
        throw new BadDataException("Project does not have any plans");
      }

      return { plan: plan, isSubscriptionUnpaid: false };
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("isPlanMissing", () => {
  test("props acting in a project with no plan, on a server with billing", () => {
    expect(CallerPlan.isPlanMissing(memberProps())).toBe(true);
  });

  test("not when the props carry the plan", () => {
    expect(
      CallerPlan.isPlanMissing(memberProps({ currentPlan: PlanType.Free })),
    ).toBe(false);
  });

  test("not on a server without billing", () => {
    setTestBillingEnabled(false);

    expect(CallerPlan.isPlanMissing(memberProps())).toBe(false);
  });

  test("not for OneUptime itself", () => {
    expect(
      CallerPlan.isPlanMissing({ isRoot: true, tenantId: PROJECT_ID }),
    ).toBe(false);
  });

  test("not for a server admin", () => {
    expect(CallerPlan.isPlanMissing(memberProps({ isMasterAdmin: true }))).toBe(
      false,
    );
  });

  test("not for props that name no project", () => {
    expect(CallerPlan.isPlanMissing(memberProps({ tenantId: undefined }))).toBe(
      false,
    );
  });

  test("an API key or a workflow step is held to the plan like a person", () => {
    expect(
      CallerPlan.isPlanMissing({
        userType: UserType.API,
        tenantId: PROJECT_ID,
      }),
    ).toBe(true);
    expect(
      CallerPlan.isPlanMissing({
        userType: UserType.Workflow,
        tenantId: PROJECT_ID,
      }),
    ).toBe(true);
  });
});

describe("assertPlanKnown", () => {
  test("refuses props whose plan is missing, in plain words", () => {
    expect(() => {
      CallerPlan.assertPlanKnown(memberProps());
    }).toThrow(NotAuthorizedException);
    expect(() => {
      CallerPlan.assertPlanKnown(memberProps());
    }).toThrow(CallerPlan.PLAN_UNKNOWN_MESSAGE);
  });

  test("lets everyone else through", () => {
    expect(() => {
      CallerPlan.assertPlanKnown(memberProps({ currentPlan: PlanType.Free }));
      CallerPlan.assertPlanKnown({ isRoot: true, tenantId: PROJECT_ID });
      CallerPlan.assertPlanKnown(memberProps({ isMasterAdmin: true }));
      CallerPlan.assertPlanKnown(memberProps({ tenantId: undefined }));
    }).not.toThrow();

    setTestBillingEnabled(false);

    expect(() => {
      CallerPlan.assertPlanKnown(memberProps());
    }).not.toThrow();
  });

  test("names no plan and no project in its message", () => {
    expect(CallerPlan.PLAN_UNKNOWN_MESSAGE).not.toMatch(/undefined|null/);
    expect(CallerPlan.PLAN_UNKNOWN_MESSAGE).toContain("plan");
  });
});

describe("withPlan", () => {
  test("reads the plan of the project the props name, onto a copy", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();

    const withPlan: DatabaseCommonInteractionProps =
      await CallerPlan.withPlan(props);

    expect(getCurrentPlan).toHaveBeenCalledTimes(1);
    expect(getCurrentPlan.mock.calls[0]![0].toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(withPlan.currentPlan).toBe(PlanType.Growth);
    expect(withPlan.isSubscriptionUnpaid).toBe(false);
    expect(withPlan.userId).toBe(USER_ID);
    expect(withPlan.tenantId).toBe(PROJECT_ID);

    // The caller's own object is left as it was.
    expect(withPlan).not.toBe(props);
    expect(props.currentPlan).toBeUndefined();
    expect(props.isSubscriptionUnpaid).toBeUndefined();
  });

  test("carries an unpaid subscription", async () => {
    getCurrentPlan.mockImplementation(async () => {
      return { plan: PlanType.Scale, isSubscriptionUnpaid: true };
    });

    const withPlan: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
      memberProps(),
    );

    expect(withPlan.currentPlan).toBe(PlanType.Scale);
    expect(withPlan.isSubscriptionUnpaid).toBe(true);
  });

  test("returns props that carry a plan, or need none, as they are", async () => {
    const withPlan: DatabaseCommonInteractionProps = memberProps({
      currentPlan: PlanType.Free,
    });
    const root: DatabaseCommonInteractionProps = {
      isRoot: true,
      tenantId: PROJECT_ID,
    };
    const admin: DatabaseCommonInteractionProps = memberProps({
      isMasterAdmin: true,
    });
    const acrossProjects: DatabaseCommonInteractionProps = memberProps({
      tenantId: undefined,
    });

    expect(await CallerPlan.withPlan(withPlan)).toBe(withPlan);
    expect(await CallerPlan.withPlan(root)).toBe(root);
    expect(await CallerPlan.withPlan(admin)).toBe(admin);
    expect(await CallerPlan.withPlan(acrossProjects)).toBe(acrossProjects);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  test("reads nothing on a server without billing", async () => {
    setTestBillingEnabled(false);
    const props: DatabaseCommonInteractionProps = memberProps();

    expect(await CallerPlan.withPlan(props)).toBe(props);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  test("a plan that cannot be read is an error, never 'any plan'", async () => {
    plans.clear();

    await expect(CallerPlan.withPlan(memberProps())).rejects.toThrow(
      "Project does not have any plans",
    );
  });

  test("a plan read back as none stays missing, so the checks refuse", async () => {
    getCurrentPlan.mockImplementation(async () => {
      return { plan: null, isSubscriptionUnpaid: false };
    });

    const withPlan: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
      memberProps(),
    );

    expect(withPlan.currentPlan).toBeUndefined();
    expect(CallerPlan.isPlanMissing(withPlan)).toBe(true);
  });
});

describe("inProject", () => {
  test("reads the project on its own plan", async () => {
    const projectProps: DatabaseCommonInteractionProps =
      await CallerPlan.inProject(
        memberProps({ tenantId: undefined, isMultiTenantRequest: true }),
        OTHER_PROJECT_ID,
      );

    expect(projectProps.tenantId).toBe(OTHER_PROJECT_ID);
    expect(projectProps.isMultiTenantRequest).toBe(false);
    expect(projectProps.currentPlan).toBe(PlanType.Free);
  });

  test("never on the plan of the project the request named", async () => {
    // A request in PROJECT_ID (Growth) reading across the caller's projects.
    const requestProps: DatabaseCommonInteractionProps = memberProps({
      currentPlan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      isMultiTenantRequest: true,
    });

    const otherProject: DatabaseCommonInteractionProps =
      await CallerPlan.inProject(requestProps, OTHER_PROJECT_ID);

    expect(otherProject.currentPlan).toBe(PlanType.Free);
    expect(getCurrentPlan).toHaveBeenCalledTimes(1);

    // The request's own props keep their plan.
    expect(requestProps.currentPlan).toBe(PlanType.Growth);
    expect(requestProps.tenantId).toBe(PROJECT_ID);
  });

  test("keeps the plan it already has for the same project", async () => {
    const sameProject: DatabaseCommonInteractionProps =
      await CallerPlan.inProject(
        memberProps({ currentPlan: PlanType.Enterprise }),
        new ObjectID(PROJECT_ID.toString().toUpperCase()),
      );

    expect(sameProject.currentPlan).toBe(PlanType.Enterprise);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  test("inProjectWithoutPlan drops a plan read for another project and reads nothing", () => {
    const projectProps: DatabaseCommonInteractionProps =
      CallerPlan.inProjectWithoutPlan(
        memberProps({
          currentPlan: PlanType.Growth,
          isSubscriptionUnpaid: true,
        }),
        OTHER_PROJECT_ID,
      );

    expect(projectProps.tenantId).toBe(OTHER_PROJECT_ID);
    expect(projectProps.currentPlan).toBeUndefined();
    expect(projectProps.isSubscriptionUnpaid).toBeUndefined();
    expect(CallerPlan.isPlanMissing(projectProps)).toBe(true);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });
});
