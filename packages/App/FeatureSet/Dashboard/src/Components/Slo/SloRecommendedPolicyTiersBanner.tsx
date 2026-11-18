import IconProp from "Common/Types/Icon/IconProp";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { SloRecommendedPolicyTierToAdd } from "Common/Utils/Slo/SloErrorBudgetPolicy";
import React, { FunctionComponent, ReactElement } from "react";

export const SLO_RECOMMENDED_POLICY_TIERS_BANNER_TEST_ID: string =
  "slo-recommended-policy-tiers-banner";

export const ADD_MISSING_POLICY_TIERS_BUTTON_TEST_ID: string =
  "slo-add-missing-policy-tiers";

export const SLO_RECOMMENDED_POLICY_FREEZE_MISSING_TEST_ID: string =
  "slo-recommended-policy-freeze-missing";

export const RECOMMENDED_POLICY_NOT_COMPLETE_TITLE: string = translationKey(
  "Recommended policy not complete",
);

export const ADD_MISSING_POLICY_TIERS_TITLE: string =
  translationKey("Add missing tiers");

export const RECOMMENDED_POLICY_TIERS_MISSING_TEMPLATE: string = translationKey(
  "Not on this SLO yet: {{tiers}}. Nothing is added until you confirm. A disabled tier counts as set up, so disable a tier you do not want instead of deleting it.",
);

export const RECOMMENDED_POLICY_FREEZE_MISSING_TEMPLATE: string =
  translationKey(
    "Until it has {{tier}}, this SLO's policy never freezes deployments.",
  );

export interface ComponentProps {
  // The recommended tiers the SLO does not have, as the server said.
  tiers: Array<SloRecommendedPolicyTierToAdd>;
  // Whether a tier the SLO has freezes deployments already.
  isAnyTierFreezing: boolean;
  // Whether the reader may create tiers, and if not, why.
  createGate: PermissionGateResult;
  // Opens the confirmation of what will be added.
  onAdd: () => void;
}

/*
 * Above the Error Budget Policy table while the SLO's tiers are part of the
 * recommended policy and the rest is missing (#7351) - above all the
 * Caution and Reliability first that "Use the recommended policy" left
 * before #6978 was fixed, without Budget exhausted, the tier that freezes
 * deployments - naming them, with "Add missing tiers". The burn rate rules'
 * banner says the same of missing rules (SloRecommendedBurnRateRulesBanner).
 *
 * A policy of the team's own is never shown one: this is drawn only for
 * tiers that each stand for a recommended one (getSloRecommendedPolicyStanding).
 * Nothing is added by itself: the button opens the confirmation of exactly
 * what will be added. A tier someone does not want is kept disabled rather
 * than deleted - a disabled tier counts as there - and this goes away.
 *
 * The button is hidden only while the permission snapshot has not arrived
 * (PermissionGate); someone who may not create tiers sees it locked, with
 * why, like the table's own Create.
 */
const SloRecommendedPolicyTiersBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.tiers.length === 0) {
    return <></>;
  }

  const showButton: boolean =
    props.createGate.isAllowed || Boolean(props.createGate.disabledReason);

  // OneUptime's own names for the tiers, as they will be created: as written.
  const names: string = props.tiers
    .map((tier: SloRecommendedPolicyTierToAdd): string => {
      return tier.name;
    })
    .join(", ");

  /*
   * Said only while nothing the SLO has freezes deployments, so it is true:
   * a team that switched Freeze Deployments on for a tier of its own is
   * told nothing it knows to be wrong.
   */
  const freezingTier: SloRecommendedPolicyTierToAdd | undefined =
    props.isAnyTierFreezing
      ? undefined
      : props.tiers.find((tier: SloRecommendedPolicyTierToAdd): boolean => {
          return tier.freezesDeployments === true;
        });

  return (
    <AlertBanner
      className="mb-5"
      type={AlertBannerType.Info}
      icon={IconProp.LightBulb}
      title={RECOMMENDED_POLICY_NOT_COMPLETE_TITLE}
      rightElement={
        showButton ? (
          <Button
            title={ADD_MISSING_POLICY_TIERS_TITLE}
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId={ADD_MISSING_POLICY_TIERS_BUTTON_TEST_ID}
            disabled={!props.createGate.isAllowed}
            tooltip={props.createGate.disabledReason}
            onClick={() => {
              if (!props.createGate.isAllowed) {
                return;
              }

              props.onAdd();
            }}
          />
        ) : undefined
      }
      dataTestId={SLO_RECOMMENDED_POLICY_TIERS_BANNER_TEST_ID}
    >
      <>
        <p>
          {translator.translateTemplate(
            RECOMMENDED_POLICY_TIERS_MISSING_TEMPLATE,
            { tiers: names },
          )}
        </p>
        {freezingTier ? (
          <p
            className="mt-1"
            data-testid={SLO_RECOMMENDED_POLICY_FREEZE_MISSING_TEST_ID}
          >
            {translator.translateTemplate(
              RECOMMENDED_POLICY_FREEZE_MISSING_TEMPLATE,
              { tier: freezingTier.name },
            )}
          </p>
        ) : (
          <></>
        )}
      </>
    </AlertBanner>
  );
};

export default SloRecommendedPolicyTiersBanner;
