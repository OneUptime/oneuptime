import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import {
  BILLING_ENABLED,
  IS_ENTERPRISE_EDITION,
  getAllEnvVars,
} from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * Whether the current project may use an enterprise feature, and so whether a
 * shell shows the feature or its upsell card.
 *
 * Two different questions depending on where the Dashboard runs:
 *
 *   - OneUptime Cloud (billing on): does the project's PLAN reach the tier the
 *     feature's model is sold at? Checked first, and on its own - the Cloud
 *     runs the Enterprise image, so the edition flag is always true there and
 *     would otherwise unlock every feature on every plan.
 *   - Self-hosted (billing off): is this the Enterprise Edition? The server
 *     writes the EFFECTIVE edition into env.js (true only when the ee code is
 *     actually loaded), so this is never true on a Community image even when
 *     IS_ENTERPRISE_EDITION=true was set by hand.
 *
 * A lapsed license does NOT make a self-hosted feature ineligible: the ee
 * screens stay reachable and show their own banner, because admins must
 * still see what is configured (read-only), read the audit logs recorded so
 * far, disable a compromised provider or replace a leaked SCIM token, and be
 * told that SSO sign-in, SCIM and audit logging are off until a license is
 * activated.
 */

// The plans an enterprise feature can be sold at on OneUptime Cloud.
export type EnterpriseRequiredPlan = PlanType.Scale | PlanType.Enterprise;

/*
 * SSO, OIDC, SCIM and team compliance: @TableBillingAccessControl on
 * ProjectSso, ProjectOidc, ProjectSCIM, StatusPageSso, StatusPageOidc,
 * StatusPageSCIM and TeamComplianceSetting all say Scale. The upsell used to
 * demand Enterprise, which walled Scale customers off from features their
 * plan includes.
 */
export const IDENTITY_REQUIRED_PLAN: EnterpriseRequiredPlan = PlanType.Scale;

// Audit logs are recorded for Enterprise-plan projects only.
export const AUDIT_LOGS_REQUIRED_PLAN: EnterpriseRequiredPlan =
  PlanType.Enterprise;

/*
 * Whether `currentPlan` is at or above `requiredPlan`, using the plan order
 * the Cloud configures (SUBSCRIPTION_PLAN_* in env.js) - the same comparison
 * the server's BillingPermission makes. An unknown plan, or plans that cannot
 * be ordered, count as "not eligible": the server would refuse the write
 * anyway, and the upsell explains why.
 */
export const isPlanAtLeast: (
  requiredPlan: PlanType,
  currentPlan: PlanType | null,
) => boolean = (
  requiredPlan: PlanType,
  currentPlan: PlanType | null,
): boolean => {
  if (!currentPlan) {
    return false;
  }

  if (currentPlan === requiredPlan) {
    return true;
  }

  try {
    return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
      requiredPlan,
      currentPlan,
      getAllEnvVars(),
    );
  } catch {
    return false;
  }
};

/*
 * ProjectUtil.getCurrentPlan() throws when the project's plan id is not one
 * of the configured plans. An upsell check must never take the page down with
 * it, so that reads as "no plan".
 */
export const getCurrentPlanOrNull: () => PlanType | null =
  (): PlanType | null => {
    try {
      return ProjectUtil.getCurrentPlan();
    } catch {
      return null;
    }
  };

export const isEnterpriseFeatureEligible: (
  requiredPlan?: EnterpriseRequiredPlan,
) => boolean = (
  requiredPlan: EnterpriseRequiredPlan = IDENTITY_REQUIRED_PLAN,
): boolean => {
  if (BILLING_ENABLED) {
    return isPlanAtLeast(requiredPlan, getCurrentPlanOrNull());
  }

  return IS_ENTERPRISE_EDITION;
};
