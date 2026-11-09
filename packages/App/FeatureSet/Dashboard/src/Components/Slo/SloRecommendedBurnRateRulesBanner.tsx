import IconProp from "Common/Types/Icon/IconProp";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { PermissionGateResult } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { SloRecommendedBurnRateRuleToAdd } from "Common/Utils/Slo/SloRecommendedBurnRateRules";
import React, { FunctionComponent, ReactElement } from "react";

export const SLO_RECOMMENDED_BURN_RATE_RULES_BANNER_TEST_ID: string =
  "slo-recommended-burn-rate-rules-banner";

export const ADD_RECOMMENDED_BURN_RATE_RULES_BUTTON_TEST_ID: string =
  "slo-add-recommended-burn-rate-rules";

export interface ComponentProps {
  // The recommended rules the SLO does not have, as the server said.
  rules: Array<SloRecommendedBurnRateRuleToAdd>;
  // Whether the reader may create burn rate rules, and if not, why.
  createGate: PermissionGateResult;
  // Opens the confirmation of what will be added.
  onAdd: () => void;
}

/*
 * Above the Burn Rate Rules table while the SLO is missing one of the rules
 * OneUptime recommends - an SLO created before Slow leak existed, or one
 * whose rule was deleted - naming them, with "Add recommended rules". It is
 * not a card button: the table folds those into its ⋯ menu, where the
 * people it is for (owners of SLOs from before the rule existed) would never
 * find it.
 *
 * Nothing is added by itself: the button opens a confirmation of exactly
 * what will be added. Someone who does not want a recommended rule keeps it
 * disabled rather than deleting it - a disabled rule counts as there - and
 * this goes away for good.
 *
 * The button is hidden only while there is nothing honest to say about it:
 * the permission snapshot has not arrived yet (PermissionGate). Someone who
 * may not create rules sees it locked, with why, like the table's Create.
 */
const SloRecommendedBurnRateRulesBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const showButton: boolean =
    props.createGate.isAllowed || Boolean(props.createGate.disabledReason);

  const names: string = props.rules
    .map((rule: SloRecommendedBurnRateRuleToAdd): string => {
      return rule.name;
    })
    .join(", ");

  // Only while a recommended rule is missing.
  return props.rules.length > 0 ? (
    <AlertBanner
      className="mb-5"
      type={AlertBannerType.Info}
      icon={IconProp.LightBulb}
      title="Recommended rules not set up"
      rightElement={
        showButton ? (
          <Button
            title="Add recommended rules"
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId={ADD_RECOMMENDED_BURN_RATE_RULES_BUTTON_TEST_ID}
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
      dataTestId={SLO_RECOMMENDED_BURN_RATE_RULES_BANNER_TEST_ID}
    >
      <p>
        {translator.translateTemplate(
          "Not on this SLO yet: {{rules}}. Nothing is added until you confirm. A disabled rule counts as set up, so disable a rule you do not want instead of deleting it.",
          { rules: names },
        )}
      </p>
    </AlertBanner>
  ) : (
    <></>
  );
};

export default SloRecommendedBurnRateRulesBanner;
