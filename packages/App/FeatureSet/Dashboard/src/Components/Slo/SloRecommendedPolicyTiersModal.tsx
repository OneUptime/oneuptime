import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  SloRecommendedPolicyTierToAdd,
  formatSloPolicyTierThreshold,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";
import React, { FunctionComponent, ReactElement } from "react";
import { POLICY_TIER_BUDGET_LEFT_TEMPLATE } from "./SloPolicyTier";

// The starter's button, and the title of the confirmation it opens.
export const USE_RECOMMENDED_POLICY_TITLE: string = translationKey(
  "Use the recommended policy",
);

export interface ComponentProps {
  // What will be added, as the server worked it out for this SLO.
  tiers: Array<SloRecommendedPolicyTierToAdd>;
  isLoading: boolean;
  error: string;
  onSubmit: () => void;
  onClose: () => void;
}

/*
 * The confirmation of "Use the recommended policy": exactly the tiers the
 * request adds, each as the tiers table will show it - its name, the budget
 * left it applies at and what the team does there - and that none of them
 * pages anyone until someone switches that on.
 *
 * What a tier says the team does is OneUptime's starting point, written in
 * English into the tier, so it is listed as written, not translated: it is
 * what the tier will hold.
 */
const SloRecommendedPolicyTiersModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ConfirmModal
      title={USE_RECOMMENDED_POLICY_TITLE}
      description="These are the recommended tiers this SLO does not have yet. They raise no alerts or incidents until you switch that on, and you can edit them afterwards like any other tier."
      submitButtonText="Add tiers"
      onSubmit={props.onSubmit}
      onClose={props.onClose}
      isLoading={props.isLoading}
      error={props.error || undefined}
      disableSubmitButton={props.tiers.length === 0}
    >
      <ul
        data-testid="slo-recommended-policy-tiers"
        className="divide-y divide-gray-100 rounded-md border border-gray-200"
      >
        {props.tiers.map((tier: SloRecommendedPolicyTierToAdd) => {
          return (
            <li
              key={tier.name}
              data-testid="slo-recommended-policy-tier"
              className="px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-sm font-medium text-gray-900">
                  {tier.name}
                </span>
                <span className="flex-shrink-0 text-sm tabular-nums text-gray-700">
                  {translator.translateTemplate(
                    POLICY_TIER_BUDGET_LEFT_TEMPLATE,
                    {
                      threshold: formatSloPolicyTierThreshold(
                        tier.thresholdPercentage,
                      ),
                    },
                  )}
                </span>
              </div>
              {tier.whatWeDo ? (
                <p className="mt-1 text-sm text-gray-600">{tier.whatWeDo}</p>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
    </ConfirmModal>
  );
};

export default SloRecommendedPolicyTiersModal;
