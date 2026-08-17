import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { BILLING_ENABLED } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";

/**
 * Whether this project is on the Free plan of a billed (cloud) deployment -
 * the one case where a user is about to incur pay-as-you-go charges without
 * having already agreed to a paid plan.
 *
 * Fails CLOSED: billing disabled (self-hosted, where nothing is charged), no
 * project cached yet, or a plan this deployment does not recognise all return
 * false. Saying nothing is the right answer when we cannot be sure the user
 * would be billed - quoting a price to someone who will never see an invoice
 * is worse than staying quiet.
 */
export function isProjectOnFreePlan(): boolean {
  if (!BILLING_ENABLED) {
    return false;
  }

  let currentPlan: PlanType | null = null;

  try {
    currentPlan = ProjectUtil.getCurrentPlan();
  } catch {
    /*
     * getCurrentPlan throws (BadDataException) when the project carries a
     * plan id that is not in this deployment's SUBSCRIPTION_PLAN_* table.
     * That must never take a page down over a billing notice.
     */
    return false;
  }

  return currentPlan === PlanType.Free;
}
