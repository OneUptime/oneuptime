import EnterpriseFeatureUpgrade, {
  ComponentProps as EnterpriseFeatureUpgradeProps,
  EnterpriseUpgradeReason,
} from "../EnterpriseEdition/EnterpriseFeatureUpgrade";
import {
  EnterpriseRequiredPlan,
  isPlanFeatureEligible,
} from "../../Enterprise/EnterpriseEligibility";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * A page every edition includes that OneUptime Cloud sells on a plan (single
 * sign-on is on Scale): the page itself or, on the Cloud for a project below
 * that plan, the plan upsell card.
 *
 * Only the plan is checked (isPlanFeatureEligible). With billing off, which
 * is every self-hosted install whatever its edition or license, the page
 * always shows. The check runs on every render, not once on mount, so the
 * page appears as soon as the project's plan has loaded or been upgraded. It
 * lives in this wrapper, not in the page, so the page's hooks always run in
 * the same order.
 */

// The upsell card's own props; its plan comes from `requiredPlan`.
export type PlanGatedPageUpsellProps = Omit<
  EnterpriseFeatureUpgradeProps,
  "requiredPlan" | "reason"
>;

export interface ComponentProps {
  // The Cloud plan the feature is sold at (see EnterpriseEligibility).
  requiredPlan: EnterpriseRequiredPlan;
  upsell: PlanGatedPageUpsellProps;
  // The page, rendered only when the project's plan includes the feature.
  children: ReactNode;
}

const PlanGatedPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!isPlanFeatureEligible(props.requiredPlan)) {
    return (
      <EnterpriseFeatureUpgrade
        {...props.upsell}
        requiredPlan={props.requiredPlan}
        reason={EnterpriseUpgradeReason.Plan}
      />
    );
  }

  return <>{props.children}</>;
};

export default PlanGatedPage;
