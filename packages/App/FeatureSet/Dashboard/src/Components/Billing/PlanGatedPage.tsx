import EnterpriseFeatureUpgrade, {
  ComponentProps as EnterpriseFeatureUpgradeProps,
  EnterpriseUpgradeReason,
} from "../EnterpriseEdition/EnterpriseFeatureUpgrade";
import {
  EnterpriseRequiredPlan,
  isKnownToBeBelowPlan,
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
 *
 * A paid feature can always be switched off, on any plan: below the plan,
 * `belowPlan` is drawn under the upsell - the page's switches for what a
 * trial (or a move to a lower plan) left on, which the server lets go back
 * to their defaults whatever the plan. It draws nothing while nothing is
 * left on, and only once the project's plan is known to be below
 * (isKnownToBeBelowPlan): not while the plan loads, when the upsell shows
 * for every project.
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
  /*
   * Under the upsell, below the plan only: what can still be switched off
   * there (see above).
   */
  belowPlan?: ReactNode | undefined;
}

const PlanGatedPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!isPlanFeatureEligible(props.requiredPlan)) {
    return (
      <>
        <EnterpriseFeatureUpgrade
          {...props.upsell}
          requiredPlan={props.requiredPlan}
          reason={EnterpriseUpgradeReason.Plan}
        />
        {props.belowPlan && isKnownToBeBelowPlan(props.requiredPlan) ? (
          props.belowPlan
        ) : (
          <></>
        )}
      </>
    );
  }

  return <>{props.children}</>;
};

export default PlanGatedPage;
