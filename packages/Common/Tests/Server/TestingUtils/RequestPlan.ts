import { PlanType } from "../../../Types/Billing/SubscriptionPlan";

/*
 * The plan a request's props carry on a server with billing, as
 * CommonAPI.getDatabaseCommonInteractionProps adds it: here the highest plan,
 * with the subscription paid, so that no plan decides what a test asks.
 *
 * Props that act in a project and carry no plan are never read as being on
 * any plan (CallerPlan): DatabaseService reads the project's plan for an
 * operation a plan decides, and a check that still has none refuses. A test
 * that builds a member's or an API key's props by hand, to ask something that
 * is not about plans, spreads this into them - as the request it stands for
 * would carry it.
 */
export const ON_HIGHEST_PLAN: {
  currentPlan: PlanType;
  isSubscriptionUnpaid: boolean;
} = {
  currentPlan: PlanType.Enterprise,
  isSubscriptionUnpaid: false,
};
