import { PlanType } from "../Billing/SubscriptionPlan";

// How many workflow runs a project of each plan may have in 30 days.
enum WorkflowPlan {
  "Free" = 0,
  "Enterprise" = 9999999,
  "Growth" = 500,
  "Scale" = 2000,
}

export default WorkflowPlan;

/*
 * The lowest plan whose projects run workflows: what a project on a plan
 * that runs none is told to upgrade to.
 */
export const LOWEST_PLAN_THAT_RUNS_WORKFLOWS: PlanType = PlanType.Growth;

/*
 * Whether a project on this plan runs any workflow at all. A plan of 0 runs
 * (Free) refuses every run, however it is started, so a workflow built there
 * never does anything until the plan changes. An unknown plan - billing off,
 * as on every self-hosted install, or a plan the server does not describe -
 * runs them: the server has the last word.
 */
export function doesPlanRunWorkflows(
  plan: PlanType | string | null | undefined,
): boolean {
  if (!plan) {
    return true;
  }

  const runs: number | undefined = (
    WorkflowPlan as unknown as Record<string, number | undefined>
  )[plan];

  if (typeof runs !== "number") {
    return true;
  }

  return runs > 0;
}

/*
 * What a run refused for its plan's runs says, in the run's log: a plan
 * that runs none says so, and which plan does; a plan whose runs are used
 * up says how many it allows.
 */
export function getWorkflowPlanRefusalMessage(data: {
  plan: PlanType | string;
  runsInLast30Days: number;
}): string {
  if (!doesPlanRunWorkflows(data.plan)) {
    return `Workflows do not run on the ${data.plan} plan. Upgrade to the ${LOWEST_PLAN_THAT_RUNS_WORKFLOWS} plan or above to run them.`;
  }

  const runs: number = (WorkflowPlan as unknown as Record<string, number>)[
    data.plan
  ] as number;

  return `Workflow cannot run because it already ran ${data.runsInLast30Days} in the last 30 days. Your current plan limit is ${runs}`;
}
