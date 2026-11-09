import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
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

// The mark of a listed tier that freezes deployments, and what it means.
export const RECOMMENDED_TIER_FREEZES_DEPLOYMENTS_TEXT: string =
  translationKey("Freezes deployments");
export const RECOMMENDED_POLICY_FREEZE_NOTE: string = translationKey(
  "A tier marked Freezes deployments tells CI/CD pipelines that check this SLO to hold back releases while the SLO is in it.",
);

export const RECOMMENDED_POLICY_FREEZE_NOTE_TEST_ID: string =
  "slo-recommended-policy-freeze-note";
export const RECOMMENDED_TIER_FREEZES_TEST_ID: string =
  "slo-recommended-policy-tier-freezes";

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
 * left it applies at, what the team does there and whether it freezes
 * deployments - and that none of them pages anyone until someone switches
 * that on. A tier that freezes deployments is marked, and a line above the
 * list says what that does, so nobody adds a deploy gate without knowing.
 *
 * What a tier says the team does is OneUptime's starting point, written in
 * English into the tier, so it is listed as written, not translated: it is
 * what the tier will hold.
 */
const SloRecommendedPolicyTiersModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const isAnyTierFreezing: boolean = props.tiers.some(
    (tier: SloRecommendedPolicyTierToAdd): boolean => {
      return tier.freezesDeployments === true;
    },
  );

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
      {isAnyTierFreezing ? (
        <p
          data-testid={RECOMMENDED_POLICY_FREEZE_NOTE_TEST_ID}
          className="mb-3 text-sm text-gray-600"
        >
          {translator.translateText(RECOMMENDED_POLICY_FREEZE_NOTE)}
        </p>
      ) : (
        <></>
      )}
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
              {tier.freezesDeployments ? (
                <p
                  data-testid={RECOMMENDED_TIER_FREEZES_TEST_ID}
                  className="mt-2 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200"
                >
                  <Icon icon={IconProp.Lock} className="h-3 w-3" />
                  {translator.translateText(
                    RECOMMENDED_TIER_FREEZES_DEPLOYMENTS_TEXT,
                  )}
                </p>
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
