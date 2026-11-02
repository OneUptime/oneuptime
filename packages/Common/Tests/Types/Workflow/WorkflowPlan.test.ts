import { describe, expect, test } from "@jest/globals";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import WorkflowPlan, {
  LOWEST_PLAN_THAT_RUNS_WORKFLOWS,
  doesPlanRunWorkflows,
  getWorkflowPlanRefusalMessage,
} from "../../../Types/Workflow/WorkflowPlan";

/*
 * A project's plan decides whether its workflows run at all, and how many
 * times in 30 days. A plan that runs none must refuse every run, and a plan
 * the server does not know - billing off, as on every self-hosted install -
 * must never be what stops one.
 */

describe("WorkflowPlan", () => {
  test("each paid plan allows more runs than the one below it", () => {
    expect(WorkflowPlan.Free).toBe(0);
    expect(WorkflowPlan.Growth).toBeGreaterThan(WorkflowPlan.Free);
    expect(WorkflowPlan.Scale).toBeGreaterThan(WorkflowPlan.Growth);
    expect(WorkflowPlan.Enterprise).toBeGreaterThan(WorkflowPlan.Scale);
  });

  test("describes every billing plan", () => {
    for (const plan of Object.values(PlanType)) {
      expect(
        typeof (WorkflowPlan as unknown as Record<string, unknown>)[plan],
      ).toBe("number");
    }
  });

  test("the lowest plan that runs workflows is Growth, and it does run them", () => {
    expect(LOWEST_PLAN_THAT_RUNS_WORKFLOWS).toBe(PlanType.Growth);
    expect(doesPlanRunWorkflows(LOWEST_PLAN_THAT_RUNS_WORKFLOWS)).toBe(true);
  });
});

describe("doesPlanRunWorkflows", () => {
  test("the Free plan runs none", () => {
    expect(doesPlanRunWorkflows(PlanType.Free)).toBe(false);
    expect(doesPlanRunWorkflows("Free")).toBe(false);
  });

  test("every paid plan runs them", () => {
    expect(doesPlanRunWorkflows(PlanType.Growth)).toBe(true);
    expect(doesPlanRunWorkflows(PlanType.Scale)).toBe(true);
    expect(doesPlanRunWorkflows(PlanType.Enterprise)).toBe(true);
  });

  test("runs them when there is no plan: billing is off", () => {
    expect(doesPlanRunWorkflows(undefined)).toBe(true);
    expect(doesPlanRunWorkflows(null)).toBe(true);
    expect(doesPlanRunWorkflows("")).toBe(true);
  });

  test("runs them on a plan the server does not describe", () => {
    expect(doesPlanRunWorkflows("Startup")).toBe(true);
  });

  test("reads plan names as written, case and all", () => {
    expect(doesPlanRunWorkflows("free")).toBe(true);
  });

  test("is not fooled by the enum's reverse mapping", () => {
    // A numeric enum also maps each value back to its name: "0" -> "Free".
    expect(doesPlanRunWorkflows("0")).toBe(true);
    expect(doesPlanRunWorkflows("500")).toBe(true);
  });
});

describe("getWorkflowPlanRefusalMessage", () => {
  test("a plan that runs none says so, and names the plan that does", () => {
    expect(
      getWorkflowPlanRefusalMessage({
        plan: PlanType.Free,
        runsInLast30Days: 0,
      }),
    ).toBe(
      "Workflows do not run on the Free plan. Upgrade to the Growth plan or above to run them.",
    );
  });

  test("a plan whose runs are used up says how many it allows", () => {
    expect(
      getWorkflowPlanRefusalMessage({
        plan: PlanType.Growth,
        runsInLast30Days: 500,
      }),
    ).toBe(
      "Workflow cannot run because it already ran 500 in the last 30 days. Your current plan limit is 500",
    );
  });

  test("names each plan's own limit", () => {
    expect(
      getWorkflowPlanRefusalMessage({
        plan: PlanType.Scale,
        runsInLast30Days: 2001,
      }),
    ).toBe(
      `Workflow cannot run because it already ran 2001 in the last 30 days. Your current plan limit is ${WorkflowPlan.Scale}`,
    );
  });
});
