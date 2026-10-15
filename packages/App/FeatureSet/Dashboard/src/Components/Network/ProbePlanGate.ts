import { isKnownToBeBelowPlan } from "../../Enterprise/EnterpriseEligibility";
import Probe from "Common/Models/DatabaseModels/Probe";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";

/*
 * The plan adding a probe needs, when the project is known to be below it.
 *
 * On OneUptime Cloud the server refuses to add a probe below the plan Probe's
 * create is sold on (@TableBillingAccessControl). The Network first-run
 * path's probe step and the "Add a probe" dialog read this to say so before
 * anything is asked (NetworkProbeSetup says why).
 *
 * Only a plan KNOWN to be below counts (isKnownToBeBelowPlan): never with
 * billing off, which is every self-hosted server, and never while the
 * project's plan loads or is one the Dashboard cannot read. Then the probe is
 * offered as before, and the server has the last word.
 */

// The plan the server asks of a new probe, read from the model as it reads it.
export const PROBE_CREATE_PLAN: PlanType | null =
  new Probe().getCreateBillingPlan() || null;

export function getPlanNeededToAddProbe(): PlanType | null {
  if (!PROBE_CREATE_PLAN) {
    return null;
  }

  return isKnownToBeBelowPlan(PROBE_CREATE_PLAN) ? PROBE_CREATE_PLAN : null;
}
